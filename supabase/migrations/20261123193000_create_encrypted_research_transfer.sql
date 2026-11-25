-- v46: one encrypted, single-recipient blinded-CSV transfer per registered
-- transformation. The application never stores plaintext dataset or private key.
-- Storage is private: authenticated users may INSERT only after a governed
-- initiation. Every download requires an authenticated server route that
-- audits the authorization before using a server-only Storage credential.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('blindstats-research-v1', 'blindstats-research-v1', false, 5242880,
        array['application/octet-stream'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880,
      allowed_mime_types = array['application/octet-stream'];

-- Study-specific immutable public key and recipient-only encrypted backup.
create table public.research_transfer_public_keys (
  study_id uuid not null,
  user_id uuid not null,
  public_jwk jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (study_id, user_id),
  foreign key (study_id, user_id)
    references public.study_memberships(study_id, user_id) on delete cascade
);

create table public.research_transfer_key_backups (
  study_id uuid not null,
  user_id uuid not null,
  wrapped_private_key text not null,
  salt text not null,
  iv text not null,
  iterations integer not null default 600000 check (iterations = 600000),
  created_at timestamptz not null default clock_timestamp(),
  primary key (study_id, user_id),
  foreign key (study_id, user_id)
    references public.research_transfer_public_keys(study_id, user_id) on delete cascade
);

create table public.research_transfers (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null,
  workflow_id uuid not null,
  transformation_record_id uuid not null,
  sender_id uuid not null references auth.users(id) on delete restrict,
  recipient_id uuid not null references auth.users(id) on delete restrict,
  storage_backend text not null default 'supabase_managed_v1'
    check (storage_backend = 'supabase_managed_v1'),
  storage_path text not null unique,
  filename text not null check (char_length(filename) between 1 and 160),
  plaintext_sha256 text not null check (plaintext_sha256 ~ '^[0-9a-f]{64}$'),
  ciphertext_sha256 text check (ciphertext_sha256 ~ '^[0-9a-f]{64}$'),
  ciphertext_byte_length integer check (ciphertext_byte_length between 17 and 5242880),
  envelope jsonb,
  state text not null default 'pending' check (state in ('pending', 'ready')),
  created_at timestamptz not null default clock_timestamp(),
  ready_at timestamptz,
  unique (transformation_record_id, recipient_id),
  foreign key (workflow_id, study_id)
    references public.blinding_workflows(id, study_id) on delete restrict,
  foreign key (transformation_record_id, workflow_id)
    references public.blinding_transformations(id, workflow_id) on delete restrict,
  check (sender_id <> recipient_id),
  check ((state = 'pending' and ready_at is null and ciphertext_sha256 is null
          and ciphertext_byte_length is null and envelope is null)
      or (state = 'ready' and ready_at is not null and ciphertext_sha256 is not null
          and ciphertext_byte_length is not null and envelope is not null))
);
create index research_transfers_recipient_idx
  on public.research_transfers(recipient_id, state, created_at desc);
create index research_transfers_study_idx
  on public.research_transfers(study_id, workflow_id);

-- Server timestamps; append-only via security-definer functions (no client writes).
create table public.research_transfer_events (
  id bigint generated always as identity primary key,
  transfer_id uuid not null references public.research_transfers(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (event_type in
    ('upload_initiated', 'upload_completed', 'download_granted', 'download_verified')),
  occurred_at timestamptz not null default clock_timestamp()
);
create index research_transfer_events_transfer_idx
  on public.research_transfer_events(transfer_id, occurred_at);

alter table public.research_transfer_public_keys enable row level security;
alter table public.research_transfer_key_backups enable row level security;
alter table public.research_transfers enable row level security;
alter table public.research_transfer_events enable row level security;

-- Existing capability permissions are authoritative; no new study role is
-- granted, and independent authorizers are deliberately excluded.
create or replace function public.is_research_transfer_custodian(p_study_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null
    and exists (select 1 from public.study_memberships m
      where m.study_id = p_study_id and m.user_id = auth.uid())
    and exists (select 1 from public.study_capabilities c
      where c.study_id = p_study_id and c.user_id = p_user_id
        and c.capability = 'blinding.create')
    and exists (select 1 from public.study_capabilities c
      where c.study_id = p_study_id and c.user_id = p_user_id
        and c.capability = 'blinding.configure')
    and exists (select 1 from public.study_capabilities c
      where c.study_id = p_study_id and c.user_id = p_user_id
        and c.capability = 'unblinding.authorize')
    and not exists (select 1 from public.study_capabilities c
      where c.study_id = p_study_id and c.user_id = p_user_id
        and c.capability in ('analysis.lock', 'unblinding.request', 'unblinded.receive'));
$$;
create or replace function public.is_research_transfer_analyst(p_study_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null
    and exists (select 1 from public.study_memberships m
      where m.study_id = p_study_id and m.user_id = auth.uid())
    and exists (select 1 from public.study_capabilities c
      where c.study_id = p_study_id and c.user_id = p_user_id
        and c.capability = 'analysis.lock')
    and exists (select 1 from public.study_capabilities c
      where c.study_id = p_study_id and c.user_id = p_user_id
        and c.capability = 'unblinding.request')
    and exists (select 1 from public.study_capabilities c
      where c.study_id = p_study_id and c.user_id = p_user_id
        and c.capability = 'unblinded.receive')
    and not exists (select 1 from public.study_capabilities c
      where c.study_id = p_study_id and c.user_id = p_user_id
        and c.capability in ('blinding.create', 'blinding.configure', 'unblinding.authorize'));
$$;

create policy research_transfer_public_keys_read
on public.research_transfer_public_keys for select to authenticated
using (public.is_study_member(study_id)
  and (user_id = (select auth.uid())
       or public.is_research_transfer_custodian(study_id, (select auth.uid()))));
create policy research_transfer_key_backups_read_own
on public.research_transfer_key_backups for select to authenticated
using (user_id = (select auth.uid())
  and public.is_research_transfer_analyst(study_id, (select auth.uid())));
create policy research_transfers_read
on public.research_transfers for select to authenticated
using ((sender_id = (select auth.uid())
          and public.is_research_transfer_custodian(study_id, (select auth.uid())))
    or (recipient_id = (select auth.uid()) and state = 'ready'
          and public.is_research_transfer_analyst(study_id, (select auth.uid()))));
create policy research_transfer_events_read
on public.research_transfer_events for select to authenticated
using (exists (select 1 from public.research_transfers t where t.id = transfer_id
  and ((t.sender_id = (select auth.uid())
        and public.is_research_transfer_custodian(t.study_id, (select auth.uid())))
     or (t.recipient_id = (select auth.uid()) and t.state = 'ready'
        and public.is_research_transfer_analyst(t.study_id, (select auth.uid()))))));

revoke all on table public.research_transfer_public_keys,
  public.research_transfer_key_backups, public.research_transfers,
  public.research_transfer_events
  from anon, authenticated;
grant select on table public.research_transfer_public_keys,
  public.research_transfer_key_backups, public.research_transfers,
  public.research_transfer_events to authenticated;

create or replace function public.register_research_transfer_key(
  p_study_id uuid, p_public_jwk jsonb, p_wrapped_private_key text,
  p_salt text, p_iv text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  if not public.is_research_transfer_analyst(p_study_id, v_actor) then
    raise exception using errcode = '42501', message = 'Analyst access required.';
  end if;
  if jsonb_typeof(p_public_jwk) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_public_jwk)) <> 4
    or p_public_jwk->>'kty' is distinct from 'EC'
    or p_public_jwk->>'crv' is distinct from 'P-256'
    or coalesce(p_public_jwk->>'x', '') !~ '^[A-Za-z0-9_-]{43}$'
    or coalesce(p_public_jwk->>'y', '') !~ '^[A-Za-z0-9_-]{43}$'
    or p_public_jwk ? 'd'
    or char_length(coalesce(p_wrapped_private_key, '')) not between 100 and 4000
    or coalesce(p_salt, '') !~ '^[A-Za-z0-9+/]{22}==$'
    or coalesce(p_iv, '') !~ '^[A-Za-z0-9+/]{16}$'
  then
    raise exception 'Invalid research-transfer key material.';
  end if;
  insert into public.research_transfer_public_keys(study_id, user_id, public_jwk)
  values(p_study_id, v_actor, p_public_jwk);
  insert into public.research_transfer_key_backups
    (study_id, user_id, wrapped_private_key, salt, iv)
  values(p_study_id, v_actor, p_wrapped_private_key, p_salt, p_iv);
end;
$$;

create or replace function public.initiate_research_transfer(
  p_workflow_id uuid, p_recipient_id uuid, p_filename text,
  p_plaintext_sha256 text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_study_id uuid;
  v_transformation_record_id uuid;
  v_registered_hash text;
  v_id uuid := gen_random_uuid();
  v_existing public.research_transfers%rowtype;
begin
  select w.study_id into v_study_id from public.blinding_workflows w
    where w.id = p_workflow_id and w.state = 'blinded';
  if not found or not public.is_research_transfer_custodian(v_study_id, v_actor) then
    raise exception using errcode = '42501', message = 'Custodian access to a blinded workflow required.';
  end if;
  if v_actor = p_recipient_id
    or not public.is_research_transfer_analyst(v_study_id, p_recipient_id)
    or not exists (select 1 from public.research_transfer_public_keys k
      where k.study_id = v_study_id and k.user_id = p_recipient_id)
  then
    raise exception using errcode = '42501', message = 'Authorized analyst recipient with a registered key required.';
  end if;
  select t.id, t.blinded_artifact_sha256
    into v_transformation_record_id, v_registered_hash
    from public.blinding_transformations t
    where t.workflow_id = p_workflow_id and t.study_id = v_study_id;
  if not found or v_registered_hash is distinct from p_plaintext_sha256 then
    raise exception 'Dataset SHA-256 must match the registered blinded transformation.';
  end if;
  if p_filename is null or char_length(p_filename) not between 1 and 160
     or p_filename !~ '^[A-Za-z0-9][A-Za-z0-9._ -]*[.]csv$'
     or position('..' in p_filename) > 0
  then
    raise exception 'A safe CSV filename is required.';
  end if;
  select * into v_existing from public.research_transfers
    where transformation_record_id = v_transformation_record_id
      and recipient_id = p_recipient_id;
  if found then
    if v_existing.state = 'pending'
      and v_existing.sender_id = v_actor
      and v_existing.filename = p_filename
      and v_existing.plaintext_sha256 = p_plaintext_sha256
    then
      return v_existing.id;
    end if;
    raise exception 'Transfer already exists for this transformation and recipient.';
  end if;
  insert into public.research_transfers
    (id, study_id, workflow_id, transformation_record_id,
     sender_id, recipient_id, storage_path, filename, plaintext_sha256)
  values(v_id, v_study_id, p_workflow_id, v_transformation_record_id,
    v_actor, p_recipient_id, v_study_id::text || '/' || v_id::text || '.bin',
    p_filename, p_plaintext_sha256);
  insert into public.research_transfer_events(transfer_id, actor_id, event_type)
    values(v_id, v_actor, 'upload_initiated');
  return v_id;
end;
$$;

create or replace function public.complete_research_transfer(
  p_transfer_id uuid, p_ciphertext_sha256 text,
  p_ciphertext_byte_length integer, p_envelope jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_transfer public.research_transfers%rowtype;
  v_object_size bigint;
begin
  select * into v_transfer from public.research_transfers
    where id = p_transfer_id for update;
  if not found or v_transfer.state <> 'pending'
    or v_transfer.sender_id is distinct from v_actor
    or not public.is_research_transfer_custodian(v_transfer.study_id, v_actor)
    or not exists (select 1 from public.blinding_workflows w
      where w.id = v_transfer.workflow_id and w.state = 'blinded')
  then
    raise exception using errcode = '42501', message = 'Pending custodian transfer required.';
  end if;
  if p_ciphertext_sha256 is null or p_ciphertext_sha256 !~ '^[0-9a-f]{64}$'
    or p_ciphertext_byte_length not between 17 and 5242880
    or jsonb_typeof(p_envelope) is distinct from 'object'
    or p_envelope->>'version' is distinct from 'v46-ecdh-hkdf-aes256gcm-1'
    or char_length(p_envelope::text) > 2500
    or coalesce(p_envelope->>'salt', '') !~ '^[A-Za-z0-9+/]{22}==$'
    or coalesce(p_envelope->>'iv', '') !~ '^[A-Za-z0-9+/]{16}$'
    or jsonb_typeof(p_envelope->'ephemeralPublicJwk') is distinct from 'object'
    or p_envelope->'ephemeralPublicJwk' ? 'd'
  then
    raise exception 'Invalid encrypted transfer envelope.';
  end if;
  select (o.metadata->>'size')::bigint into v_object_size
    from storage.objects o
    where o.bucket_id = 'blindstats-research-v1' and o.name = v_transfer.storage_path;
  if not found or v_object_size is distinct from p_ciphertext_byte_length then
    raise exception 'Stored ciphertext missing or does not match the reported size.';
  end if;
  update public.research_transfers
    set state = 'ready', ciphertext_sha256 = p_ciphertext_sha256,
        ciphertext_byte_length = p_ciphertext_byte_length, envelope = p_envelope,
        ready_at = clock_timestamp()
    where id = p_transfer_id;
  insert into public.research_transfer_events(transfer_id, actor_id, event_type)
    values(p_transfer_id, v_actor, 'upload_completed');
end;
$$;

create or replace function public.authorize_research_transfer_download(
  p_transfer_id uuid
) returns text language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_transfer public.research_transfers%rowtype;
begin
  select * into v_transfer from public.research_transfers
    where id = p_transfer_id and state = 'ready';
  if not found or v_transfer.recipient_id is distinct from v_actor
    or not public.is_research_transfer_analyst(v_transfer.study_id, v_actor)
  then
    raise exception using errcode = '42501', message = 'Authorized analyst transfer required.';
  end if;
  insert into public.research_transfer_events(transfer_id, actor_id, event_type)
  values (p_transfer_id, v_actor, 'download_granted');
  return v_transfer.storage_path;
end;
$$;

create or replace function public.acknowledge_research_transfer(
  p_transfer_id uuid, p_plaintext_sha256 text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_transfer public.research_transfers%rowtype;
begin
  select * into v_transfer from public.research_transfers
    where id = p_transfer_id and state = 'ready';
  if not found or v_transfer.recipient_id is distinct from v_actor
    or not public.is_research_transfer_analyst(v_transfer.study_id, v_actor)
    or v_transfer.plaintext_sha256 is distinct from p_plaintext_sha256
  then
    raise exception using errcode = '42501', message = 'Authorized analyst verification required.';
  end if;
  insert into public.research_transfer_events(transfer_id, actor_id, event_type)
  values (p_transfer_id, v_actor, 'download_verified');
end;
$$;

-- There is deliberately NO SELECT policy for this bucket: clients must not
-- mint shareable signed download URLs or bypass download authorization/audit.
-- A server-only route uses the service-role key *after* the recipient RPC.
create policy research_transfer_storage_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'blindstats-research-v1'
    and exists (select 1 from public.research_transfers t
      where t.storage_path = name and t.state = 'pending'
        and t.sender_id = (select auth.uid())
        and public.is_research_transfer_custodian(t.study_id, (select auth.uid())))
  );
revoke all on function public.is_research_transfer_custodian(uuid, uuid),
  public.is_research_transfer_analyst(uuid, uuid),
  public.register_research_transfer_key(uuid, jsonb, text, text, text),
  public.initiate_research_transfer(uuid, uuid, text, text),
  public.complete_research_transfer(uuid, text, integer, jsonb),
  public.authorize_research_transfer_download(uuid),
  public.acknowledge_research_transfer(uuid, text) from public;
grant execute on function public.is_research_transfer_custodian(uuid, uuid),
  public.is_research_transfer_analyst(uuid, uuid),
  public.register_research_transfer_key(uuid, jsonb, text, text, text),
  public.initiate_research_transfer(uuid, uuid, text, text),
  public.complete_research_transfer(uuid, text, integer, jsonb),
  public.authorize_research_transfer_download(uuid),
  public.acknowledge_research_transfer(uuid, text) to authenticated;

commit;
