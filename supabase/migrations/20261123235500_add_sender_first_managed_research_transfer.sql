-- v46 candidate 3: sender-first managed file delivery, preserving the existing
-- recipient-key encrypted transfers. Apply ONLY to BlindStats DEVELOPMENT.
-- Managed objects are protected by Supabase encryption at rest and TLS, NOT
-- end-to-end encrypted. Authorized server operators can access file contents.
begin;

alter table public.research_transfers
  add column transfer_mode text not null default 'recipient_e2ee_v1'
    check (transfer_mode in ('recipient_e2ee_v1', 'managed_at_rest_v1'));

-- Original 17-byte minimum was specific to GCM ciphertext. A managed CSV can
-- be smaller; preserve the 5 MiB limit and enforce ciphertext minimum below.
alter table public.research_transfers
  drop constraint if exists research_transfers_ciphertext_byte_length_check;
alter table public.research_transfers
  add constraint research_transfers_object_byte_length_check
  check (ciphertext_byte_length between 1 and 5242880);

create function public.enforce_research_transfer_format_v46()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.transfer_mode is distinct from old.transfer_mode then
    raise exception 'Research transfer mode cannot change.';
  end if;
  if new.state = 'ready' then
    if new.transfer_mode = 'managed_at_rest_v1' then
      if new.envelope->>'version' is distinct from 'v46-managed-atrest-1'
        or new.ciphertext_sha256 is distinct from new.plaintext_sha256 then
        raise exception 'Managed transfer must match the registered plaintext hash.';
      end if;
    elsif new.transfer_mode = 'recipient_e2ee_v1' then
      if new.envelope->>'version' is distinct from 'v46-ecdh-hkdf-aes256gcm-1'
        or new.ciphertext_byte_length < 17 then
        raise exception 'Invalid recipient-encrypted transfer format.';
      end if;
    else
      raise exception 'Invalid transfer mode.';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_research_transfer_format_v46
before insert or update on public.research_transfers
for each row execute function public.enforce_research_transfer_format_v46();
revoke all on function public.enforce_research_transfer_format_v46() from public;


-- Existing ciphertext columns are used as the stored-object checksum and
-- size for managed mode. The stored object is PLAINTEXT CSV in managed mode;
-- its SHA-256 MUST equal the registered blinded-artifact digest. Legacy
-- encrypted mode retains its original ciphertext semantics.
create or replace function public.initiate_managed_research_transfer(
  p_workflow_id uuid, p_recipient_id uuid, p_filename text,
  p_plaintext_sha256 text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_study_id uuid;
  v_transformation_id uuid;
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
  then
    raise exception using errcode = '42501', message = 'An assigned analyst account is required.';
  end if;
  select t.id, t.blinded_artifact_sha256
    into v_transformation_id, v_registered_hash
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
    where transformation_record_id = v_transformation_id
      and recipient_id = p_recipient_id;
  if found then
    if v_existing.state = 'pending'
      and v_existing.transfer_mode = 'managed_at_rest_v1'
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
     sender_id, recipient_id, storage_path, filename, plaintext_sha256, transfer_mode)
  values (v_id, v_study_id, p_workflow_id, v_transformation_id,
    v_actor, p_recipient_id, v_study_id::text || '/' || v_id::text || '.bin',
    p_filename, p_plaintext_sha256, 'managed_at_rest_v1');
  insert into public.research_transfer_events(transfer_id, actor_id, event_type)
    values(v_id, v_actor, 'upload_initiated');
  return v_id;
end;
$$;

create or replace function public.complete_managed_research_transfer(
  p_transfer_id uuid, p_object_sha256 text, p_object_byte_length integer
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_transfer public.research_transfers%rowtype;
  v_object_size bigint;
begin
  select * into v_transfer from public.research_transfers
    where id = p_transfer_id for update;
  if not found or v_transfer.state <> 'pending'
    or v_transfer.transfer_mode <> 'managed_at_rest_v1'
    or v_transfer.sender_id is distinct from v_actor
    or not public.is_research_transfer_custodian(v_transfer.study_id, v_actor)
    or not exists (select 1 from public.blinding_workflows w
      where w.id = v_transfer.workflow_id and w.state = 'blinded')
  then
    raise exception using errcode = '42501', message = 'Pending managed custodian transfer required.';
  end if;
  if p_object_sha256 is distinct from v_transfer.plaintext_sha256
    or p_object_byte_length not between 1 and 5242880
  then
    raise exception 'Managed object must match the registered blinded dataset.';
  end if;
  select (o.metadata->>'size')::bigint into v_object_size
    from storage.objects o
    where o.bucket_id = 'blindstats-research-v1' and o.name = v_transfer.storage_path;
  if not found or v_object_size is distinct from p_object_byte_length then
    raise exception 'Stored object missing or size does not match.';
  end if;
  update public.research_transfers
    set state = 'ready', ciphertext_sha256 = p_object_sha256,
        ciphertext_byte_length = p_object_byte_length,
        envelope = '{"version":"v46-managed-atrest-1"}'::jsonb,
        ready_at = clock_timestamp()
    where id = p_transfer_id;
  insert into public.research_transfer_events(transfer_id, actor_id, event_type)
    values(p_transfer_id, v_actor, 'upload_completed');
end;
$$;

-- Exactly one authorized read grant produces a structured description of
-- the object. The app server still must verify SHA-256 before sending bytes.
create or replace function public.authorize_research_transfer_download_v2(
  p_transfer_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
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
  return jsonb_build_object(
    'path', v_transfer.storage_path,
    'mode', v_transfer.transfer_mode,
    'sha256', v_transfer.ciphertext_sha256,
    'byteLength', v_transfer.ciphertext_byte_length
  );
end;
$$;

-- Server-side callers cannot select/alter this table directly; reusing the
-- existing restricted Storage INSERT policy and the audited download route.
revoke all on function public.initiate_managed_research_transfer(uuid, uuid, text, text),
  public.complete_managed_research_transfer(uuid, text, integer),
  public.authorize_research_transfer_download_v2(uuid) from public;
grant execute on function public.initiate_managed_research_transfer(uuid, uuid, text, text),
  public.complete_managed_research_transfer(uuid, text, integer),
  public.authorize_research_transfer_download_v2(uuid) to authenticated;

commit;
