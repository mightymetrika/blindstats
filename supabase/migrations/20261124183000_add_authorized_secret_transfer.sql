-- v46 candidate 4. No secret may be staged before authorization. A separate
-- bucket/table prevents old dataset RPCs from granting access to a secret.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('blindstats-secret-v1','blindstats-secret-v1',false,16384,array['application/octet-stream']);

create table public.unblinding_secret_transfers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.unblinding_requests(id) on delete restrict,
  sender_id uuid not null references auth.users(id) on delete restrict,
  recipient_id uuid not null references auth.users(id) on delete restrict,
  storage_path text not null unique,
  plaintext_sha256 text not null check (plaintext_sha256 ~ '^[0-9a-f]{64}$'),
  transfer_mode text not null check (transfer_mode in ('managed_at_rest_v1','recipient_e2ee_v1')),
  object_sha256 text check (object_sha256 ~ '^[0-9a-f]{64}$'),
  object_byte_length integer check (object_byte_length between 1 and 16384),
  envelope jsonb,
  created_at timestamptz not null default clock_timestamp(),
  ready_at timestamptz,
  check (sender_id <> recipient_id),
  check ((ready_at is null and object_sha256 is null and object_byte_length is null and envelope is null)
      or (ready_at is not null and object_sha256 is not null and object_byte_length is not null and envelope is not null))
);
create table public.unblinding_secret_transfer_events (
  id bigint generated always as identity primary key,
  transfer_id uuid not null references public.unblinding_secret_transfers(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check(event_type in ('upload_initiated','upload_completed','download_granted','download_verified')),
  occurred_at timestamptz not null default clock_timestamp()
);
alter table public.unblinding_secret_transfers enable row level security;
alter table public.unblinding_secret_transfer_events enable row level security;
revoke all on public.unblinding_secret_transfers, public.unblinding_secret_transfer_events from anon, authenticated;
grant select on public.unblinding_secret_transfers, public.unblinding_secret_transfer_events to authenticated;

-- Match the durable request, active plan, transformation and independent
-- authorization. The requesting analyst must still hold the assigned role.
create function public.secret_release_allowed(p_request_id uuid,p_recipient_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.unblinding_requests r
    join public.unblinding_authorizations a on a.request_id=r.id and a.workflow_id=r.workflow_id and a.study_id=r.study_id and a.plan_version_id=r.plan_version_id
    join public.blinding_workflows w on w.id=r.workflow_id and w.study_id=r.study_id and w.active_plan_version_id=r.plan_version_id
    join public.blinding_plan_versions p on p.id=r.plan_version_id and p.workflow_id=r.workflow_id
    join public.blinding_transformations t on t.id=r.transformation_record_id and t.workflow_id=r.workflow_id and t.plan_version_id=r.plan_version_id
    where r.id=p_request_id and r.requested_by=p_recipient_id
      and w.state='unblinding_authorized' and p.authorization_policy='independent'
      and a.authorization_policy='independent' and a.authorized_by<>r.requested_by
      and (not p.require_analysis_lock or r.analysis_lock_id is not null)
      and public.is_research_transfer_analyst(r.study_id,p_recipient_id)
  );
$$;
create function public.secret_transfer_actor_allowed(p_request_id uuid,p_recipient_id uuid,p_actor uuid,p_sender boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_actor=auth.uid() and public.secret_release_allowed(p_request_id,p_recipient_id)
    and exists (select 1 from public.unblinding_requests r
      join public.blinding_transformations t on t.id=r.transformation_record_id
      where r.id=p_request_id and (case when p_sender then
        t.registered_by=p_actor and public.is_research_transfer_custodian(r.study_id,p_actor)
        else p_actor=p_recipient_id and public.is_research_transfer_analyst(r.study_id,p_actor) end));
$$;
-- Historical metadata remains visible to the original parties with current
-- roles, but no new secret download is permitted after unblinding completes.
create function public.can_read_secret_transfer_metadata(p_request_id uuid,p_sender_id uuid,p_recipient_id uuid,p_ready boolean)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists (select 1 from public.unblinding_requests r where r.id=p_request_id
  and ((p_sender_id=auth.uid() and public.is_research_transfer_custodian(r.study_id,auth.uid()))
    or (p_ready and p_recipient_id=auth.uid() and r.requested_by=auth.uid()
      and public.is_research_transfer_analyst(r.study_id,auth.uid()))));
$$;
create policy secret_transfer_read on public.unblinding_secret_transfers for select to authenticated
using (public.can_read_secret_transfer_metadata(request_id,sender_id,recipient_id,ready_at is not null));
create policy secret_transfer_event_read on public.unblinding_secret_transfer_events for select to authenticated
using (exists(select 1 from public.unblinding_secret_transfers t where t.id=transfer_id));

create function public.initiate_unblinding_secret_transfer(p_request_id uuid,p_plaintext_sha256 text,p_transfer_mode text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.unblinding_requests%rowtype; existing public.unblinding_secret_transfers%rowtype; v_id uuid:=gen_random_uuid();
begin
  select * into r from public.unblinding_requests where id=p_request_id;
  if not found or not coalesce(public.secret_transfer_actor_allowed(p_request_id,r.requested_by,auth.uid(),true),false) then
    raise exception using errcode='42501',message='Authorized custodian secret release required.';
  end if;
  if p_plaintext_sha256 is null or p_plaintext_sha256 !~ '^[0-9a-f]{64}$' or p_transfer_mode is null or p_transfer_mode not in ('managed_at_rest_v1','recipient_e2ee_v1') then
    raise exception 'Invalid secret transfer metadata.';
  end if;
  if p_transfer_mode='managed_at_rest_v1' and exists(select 1 from public.research_transfers t where t.transformation_record_id=r.transformation_record_id and t.recipient_id=r.requested_by and t.transfer_mode='recipient_e2ee_v1') then
    raise exception 'Recipient-only delivery is required for this secret.';
  end if;
  if p_transfer_mode='recipient_e2ee_v1' and not exists(select 1 from public.research_transfer_public_keys k where k.study_id=r.study_id and k.user_id=r.requested_by) then
    raise exception 'Recipient encryption key required.';
  end if;
  select * into existing from public.unblinding_secret_transfers where request_id=r.id;
  if found then
    -- Allow retry before an object is stored; never overwrite an existing object.
    if existing.ready_at is null and existing.sender_id=auth.uid() and existing.plaintext_sha256=p_plaintext_sha256 and existing.transfer_mode=p_transfer_mode then return existing.id; end if;
    raise exception 'A secret transfer already exists for this request.';
  end if;
  insert into public.unblinding_secret_transfers(id,request_id,sender_id,recipient_id,storage_path,plaintext_sha256,transfer_mode)
    values(v_id,r.id,auth.uid(),r.requested_by,r.study_id::text||'/'||v_id::text||'.bin',p_plaintext_sha256,p_transfer_mode);
  insert into public.unblinding_secret_transfer_events(transfer_id,actor_id,event_type) values(v_id,auth.uid(),'upload_initiated');
  return v_id;
end; $$;

create function public.complete_unblinding_secret_transfer(p_transfer_id uuid,p_object_sha256 text,p_object_byte_length integer,p_envelope jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.unblinding_secret_transfers%rowtype; v_size bigint;
begin
  select * into t from public.unblinding_secret_transfers where id=p_transfer_id for update;
  if not found or t.ready_at is not null or t.sender_id is distinct from auth.uid() or not coalesce(public.secret_transfer_actor_allowed(t.request_id,t.recipient_id,auth.uid(),true),false) then
    raise exception using errcode='42501',message='Authorized pending secret transfer required.';
  end if;
  if p_object_sha256 is null or p_object_sha256 !~ '^[0-9a-f]{64}$' or p_object_byte_length is null or p_object_byte_length not between 1 and 16384 or jsonb_typeof(p_envelope) is distinct from 'object' or char_length(p_envelope::text)>2500 then raise exception 'Invalid secret object metadata.'; end if;
  if t.transfer_mode='managed_at_rest_v1' then
    if p_object_sha256 is distinct from t.plaintext_sha256 or p_envelope is distinct from '{"version":"v46-managed-atrest-1"}'::jsonb then raise exception 'Invalid managed secret metadata.'; end if;
  elsif p_object_byte_length<17 or p_envelope->>'version' is distinct from 'v46-ecdh-hkdf-aes256gcm-1' or coalesce(p_envelope->>'salt','') !~ '^[A-Za-z0-9+/]{22}==$' or coalesce(p_envelope->>'iv','') !~ '^[A-Za-z0-9+/]{16}$' or jsonb_typeof(p_envelope->'ephemeralPublicJwk') is distinct from 'object' or p_envelope->'ephemeralPublicJwk' ? 'd' then raise exception 'Invalid encrypted secret envelope.'; end if;
  select (o.metadata->>'size')::bigint into v_size from storage.objects o where o.bucket_id='blindstats-secret-v1' and o.name=t.storage_path;
  if not found or v_size is distinct from p_object_byte_length then raise exception 'Stored secret missing or size mismatch.'; end if;
  update public.unblinding_secret_transfers set ready_at=clock_timestamp(),object_sha256=p_object_sha256,object_byte_length=p_object_byte_length,envelope=p_envelope where id=t.id;
  insert into public.unblinding_secret_transfer_events(transfer_id,actor_id,event_type) values(t.id,auth.uid(),'upload_completed');
end; $$;

create function public.authorize_unblinding_secret_download(p_transfer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.unblinding_secret_transfers%rowtype;
begin
  select * into t from public.unblinding_secret_transfers where id=p_transfer_id and ready_at is not null;
  if not found or not coalesce(public.secret_transfer_actor_allowed(t.request_id,t.recipient_id,auth.uid(),false),false) then raise exception using errcode='42501',message='Authorized requesting analyst required.'; end if;
  insert into public.unblinding_secret_transfer_events(transfer_id,actor_id,event_type) values(t.id,auth.uid(),'download_granted');
  return jsonb_build_object('path',t.storage_path,'mode',t.transfer_mode,'sha256',t.object_sha256,'byteLength',t.object_byte_length);
end; $$;
create function public.acknowledge_unblinding_secret_transfer(p_transfer_id uuid,p_plaintext_sha256 text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.unblinding_secret_transfers%rowtype;
begin
  select * into t from public.unblinding_secret_transfers where id=p_transfer_id and ready_at is not null;
  if not found or t.plaintext_sha256 is distinct from p_plaintext_sha256 or not coalesce(public.secret_transfer_actor_allowed(t.request_id,t.recipient_id,auth.uid(),false),false) or not exists(select 1 from public.unblinding_secret_transfer_events e where e.transfer_id=t.id and e.actor_id=auth.uid() and e.event_type='download_granted') then raise exception using errcode='42501',message='Authorized secret retrieval required.'; end if;
  insert into public.unblinding_secret_transfer_events(transfer_id,actor_id,event_type) values(t.id,auth.uid(),'download_verified');
end; $$;

-- Restrictive policies also guard against other permissive Storage policies.
create policy secret_storage_insert on storage.objects for insert to authenticated with check (
 bucket_id='blindstats-secret-v1' and exists(select 1 from public.unblinding_secret_transfers t where t.storage_path=name and t.ready_at is null and t.sender_id=auth.uid() and public.secret_transfer_actor_allowed(t.request_id,t.recipient_id,auth.uid(),true)));
create policy secret_storage_insert_guard on storage.objects as restrictive for insert to authenticated,anon with check (
 bucket_id<>'blindstats-secret-v1' or exists(select 1 from public.unblinding_secret_transfers t where t.storage_path=name and t.ready_at is null and t.sender_id=auth.uid() and public.secret_transfer_actor_allowed(t.request_id,t.recipient_id,auth.uid(),true)));
create policy secret_storage_no_read on storage.objects as restrictive for select to authenticated,anon using (bucket_id<>'blindstats-secret-v1');
create policy secret_storage_no_update on storage.objects as restrictive for update to authenticated,anon using (bucket_id<>'blindstats-secret-v1') with check (bucket_id<>'blindstats-secret-v1');
create policy secret_storage_no_delete on storage.objects as restrictive for delete to authenticated,anon using (bucket_id<>'blindstats-secret-v1');
revoke all on function public.secret_release_allowed(uuid,uuid),public.secret_transfer_actor_allowed(uuid,uuid,uuid,boolean),public.can_read_secret_transfer_metadata(uuid,uuid,uuid,boolean),public.initiate_unblinding_secret_transfer(uuid,text,text),public.complete_unblinding_secret_transfer(uuid,text,integer,jsonb),public.authorize_unblinding_secret_download(uuid),public.acknowledge_unblinding_secret_transfer(uuid,text) from public,anon,authenticated;
grant execute on function public.secret_transfer_actor_allowed(uuid,uuid,uuid,boolean),public.can_read_secret_transfer_metadata(uuid,uuid,uuid,boolean),public.initiate_unblinding_secret_transfer(uuid,text,text),public.complete_unblinding_secret_transfer(uuid,text,integer,jsonb),public.authorize_unblinding_secret_download(uuid),public.acknowledge_unblinding_secret_transfer(uuid,text) to authenticated;
commit;
