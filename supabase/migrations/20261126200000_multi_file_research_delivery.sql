-- v47b: per-file registered package delivery and independent Study supporting files.
-- Reuse private bucket, Study roles, protected download route and operator cleanup.
-- No existing row or object is deleted or reinterpreted.
begin;

alter table public.research_transfers
  add column file_purpose text not null default 'legacy_dataset',
  add column artifact_id text,
  add column plaintext_byte_length integer,
  add column abandoned_at timestamptz,
  alter column workflow_id drop not null,
  alter column transformation_record_id drop not null,
  add constraint research_transfers_study_fk foreign key (study_id) references public.studies(id) on delete restrict,
  drop constraint research_transfers_transformation_record_id_recipient_id_key,
  add constraint research_transfer_file_identity check (
    (file_purpose='legacy_dataset' and workflow_id is not null and transformation_record_id is not null
      and artifact_id is null and plaintext_byte_length is null and abandoned_at is null)
    or (file_purpose='package_dataset' and workflow_id is not null and transformation_record_id is not null
      and artifact_id is not null and btrim(artifact_id)<>'' and plaintext_byte_length is not null)
    or (file_purpose='supporting' and workflow_id is null and transformation_record_id is null
      and artifact_id is null and plaintext_byte_length is not null)
  ),
  add constraint research_transfer_plaintext_size check (plaintext_byte_length between 1 and 4194304
      - case when transfer_mode='recipient_e2ee_v1' then 16 else 0 end),
  add constraint research_transfer_abandoned_pending check (abandoned_at is null or state='pending');
create unique index research_transfers_legacy_recipient_unique on public.research_transfers(transformation_record_id,recipient_id)
  where file_purpose='legacy_dataset';
create unique index research_transfers_package_recipient_unique on public.research_transfers(transformation_record_id,recipient_id,artifact_id)
  where file_purpose='package_dataset' and abandoned_at is null;
create unique index research_transfers_supporting_recipient_unique on public.research_transfers(study_id,recipient_id,filename,plaintext_sha256)
  where file_purpose='supporting' and abandoned_at is null;

alter table public.research_transfer_events drop constraint research_transfer_events_event_type_check,
  add constraint research_transfer_events_event_type_check check (event_type in
  ('upload_initiated','upload_completed','download_granted','download_verified','upload_abandoned'));

-- Existing envelope and storage hashes retain their exact semantics. New E2EE
-- objects use a separate domain including purpose, transfer ID and file identity.
create or replace function public.enforce_research_transfer_format_v46()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' then
    if new.transfer_mode is distinct from old.transfer_mode then raise exception 'Research transfer mode cannot change.'; end if;
    if new.file_purpose<>'legacy_dataset' or old.file_purpose<>'legacy_dataset' then
      if (new.id,new.study_id,new.workflow_id,new.transformation_record_id,new.sender_id,new.recipient_id,new.storage_path,
        new.filename,new.plaintext_sha256,new.plaintext_byte_length,new.artifact_id,new.file_purpose,new.created_at)
        is distinct from (old.id,old.study_id,old.workflow_id,old.transformation_record_id,old.sender_id,old.recipient_id,old.storage_path,
        old.filename,old.plaintext_sha256,old.plaintext_byte_length,old.artifact_id,old.file_purpose,old.created_at)
        or old.abandoned_at is not null or old.state='ready' then
        raise exception 'Registered research file identity is immutable.';
      end if;
    end if;
  end if;
  if new.state='ready' then
    if new.transfer_mode='managed_at_rest_v1' then
      if new.envelope->>'version' is distinct from (case when new.file_purpose='legacy_dataset' then 'v46-managed-atrest-1' else 'v47-managed-atrest-1' end)
        or new.ciphertext_sha256 is distinct from new.plaintext_sha256 then
        raise exception 'Managed transfer must match the registered plaintext hash.';
      end if;
    elsif new.transfer_mode='recipient_e2ee_v1' then
      if new.envelope->>'version' is distinct from (case when new.file_purpose='legacy_dataset' then 'v46-ecdh-hkdf-aes256gcm-1' else 'v47-research-file-ecdh-hkdf-aes256gcm-1' end)
        or new.ciphertext_byte_length<17 then raise exception 'Invalid recipient-encrypted transfer format.'; end if;
    else raise exception 'Invalid transfer mode.';
    end if;
    if new.file_purpose<>'legacy_dataset' and new.ciphertext_byte_length is distinct from
      (new.plaintext_byte_length + case when new.transfer_mode='recipient_e2ee_v1' then 16 else 0 end) then
      raise exception 'Stored file size does not match registered file identity.';
    end if;
  end if;
  return new;
end; $$;

-- Do not let supporting files become an unblinding-secret workflow. Names
-- are conservative; the browser also checks known secret JSON payloads.
-- Neither filename rules nor local detection can classify arbitrary contents.
create function public.safe_supporting_research_filename(p_name text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(p_name=btrim(p_name) and char_length(p_name) between 1 and 160
    and p_name ~* '^[A-Za-z0-9][A-Za-z0-9._ -]*[.](pdf|docx|txt|md|csv|tsv|xlsx|r|rmd|qmd|py|sas|sps|do|json|yaml|yml|ipynb|pptx|rtf)$'
    and strpos(p_name,'..')=0
    and p_name !~* 'unblind.*secret|unblind.*receipt|released.*mapping'
    and p_name !~* '^(con|prn|aux|nul|com[1-9]|lpt[1-9])[.]',false);
$$;
revoke all on function public.safe_supporting_research_filename(text) from public,anon,authenticated;

create function public.initiate_research_file(p_study_id uuid,p_workflow_id uuid,p_recipient_id uuid,
  p_file_purpose text,p_artifact_id text,p_filename text,p_plaintext_sha256 text,p_plaintext_byte_length integer,
  p_transfer_mode text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_mode text; v_record uuid; v_receipt jsonb; v_file jsonb;
  v_existing public.research_transfers%rowtype; v_id uuid:=gen_random_uuid();
begin
  if not public.is_research_transfer_custodian(p_study_id,v_actor)
    or p_recipient_id is null or v_actor=p_recipient_id
    or not public.is_research_transfer_analyst(p_study_id,p_recipient_id) then
    raise exception 'Custodian and distinct assigned analyst required.' using errcode='42501';
  end if;
  -- Serialize initiation for this Study, including concurrent duplicate sends.
  select s.file_protection into v_mode from public.studies s where s.id=p_study_id and s.lifecycle='active' for update;
  if not found or v_mode is distinct from p_transfer_mode then raise exception 'Active Study and matching file protection required.' using errcode='42501'; end if;
  if v_mode='recipient_e2ee_v1' and not exists(select 1 from public.research_transfer_public_keys k where k.study_id=p_study_id and k.user_id=p_recipient_id) then
    raise exception 'Authorized analyst recipient with a registered key required.';
  end if;
  if p_plaintext_sha256 is null or p_plaintext_sha256 !~ '^[0-9a-f]{64}$'
    or p_plaintext_byte_length is null or p_plaintext_byte_length not between 1 and (4194304-case when v_mode='recipient_e2ee_v1' then 16 else 0 end) then
    raise exception 'Valid file hash and size within the 4 MiB limit required.';
  end if;
  if p_file_purpose='package_dataset' then
    select t.id,t.public_receipt_text::jsonb into v_record,v_receipt from public.blinding_transformations t
      join public.blinding_workflows w on w.id=t.workflow_id and w.study_id=t.study_id
      where t.workflow_id=p_workflow_id and t.study_id=p_study_id and t.schema_version='0.5' and w.state='blinded';
    if not found then raise exception 'Registered v0.5 blinded workflow required.'; end if;
    select d.value->'blinded' into v_file from jsonb_array_elements(v_receipt#>'{manifest,datasets}') d where d.value->>'datasetId'=p_artifact_id;
    if not found or v_file->>'filename' is distinct from p_filename or v_file->>'sha256' is distinct from p_plaintext_sha256
      or (v_file->>'byteLength')::numeric is distinct from p_plaintext_byte_length::numeric then
      raise exception 'Dataset identity, filename, SHA-256 and length must match the registered package.';
    end if;
    select * into v_existing from public.research_transfers where transformation_record_id=v_record and recipient_id=p_recipient_id
      and file_purpose='package_dataset' and artifact_id=p_artifact_id and abandoned_at is null;
  elsif p_file_purpose='supporting' then
    if p_workflow_id is not null or p_artifact_id is not null or not public.safe_supporting_research_filename(p_filename) then
      raise exception 'A safe independent supporting filename is required.';
    end if;
    select * into v_existing from public.research_transfers where study_id=p_study_id and recipient_id=p_recipient_id
      and file_purpose='supporting' and filename=p_filename and plaintext_sha256=p_plaintext_sha256 and abandoned_at is null;
  else raise exception 'Unsupported research file purpose.';
  end if;
  if v_existing.id is not null then
    if v_existing.state='pending' and v_existing.sender_id=v_actor and v_existing.transfer_mode=v_mode
      and v_existing.plaintext_byte_length=p_plaintext_byte_length and not exists(select 1 from storage.objects o
        where o.bucket_id='blindstats-research-v1' and o.name=v_existing.storage_path) then
      return v_existing.id;
    end if;
    raise exception 'File already sent or pending with a stored object. Review the transfer before retrying.';
  end if;
  insert into public.research_transfers(id,study_id,workflow_id,transformation_record_id,sender_id,recipient_id,storage_path,
    filename,plaintext_sha256,transfer_mode,file_purpose,artifact_id,plaintext_byte_length)
  values(v_id,p_study_id,p_workflow_id,v_record,v_actor,p_recipient_id,p_study_id::text||'/'||v_id::text||'.bin',
    p_filename,p_plaintext_sha256,v_mode,p_file_purpose,p_artifact_id,p_plaintext_byte_length);
  insert into public.research_transfer_events(transfer_id,actor_id,event_type) values(v_id,v_actor,'upload_initiated');
  return v_id;
end; $$;

create function public.complete_research_file(p_transfer_id uuid,p_object_sha256 text,p_object_byte_length integer,p_envelope jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare t public.research_transfers%rowtype; v_actor uuid:=auth.uid(); v_size bigint; v_jwk jsonb;
begin
  select * into t from public.research_transfers where id=p_transfer_id for update;
  if not found or t.file_purpose not in ('package_dataset','supporting') or t.state<>'pending' or t.abandoned_at is not null
    or t.sender_id is distinct from v_actor or not public.is_research_transfer_custodian(t.study_id,v_actor)
    or not public.is_research_transfer_analyst(t.study_id,t.recipient_id)
    or not exists(select 1 from public.studies s where s.id=t.study_id and s.lifecycle='active' and s.file_protection=t.transfer_mode)
    or (t.file_purpose='package_dataset' and not exists(select 1 from public.blinding_workflows w where w.id=t.workflow_id and w.study_id=t.study_id and w.state='blinded')) then
    raise exception 'Authorized pending research file required.' using errcode='42501';
  end if;
  if p_object_sha256 is null or p_object_sha256 !~ '^[0-9a-f]{64}$'
    or p_object_byte_length is distinct from (t.plaintext_byte_length+case when t.transfer_mode='recipient_e2ee_v1' then 16 else 0 end)
    or jsonb_typeof(p_envelope) is distinct from 'object' or char_length(p_envelope::text)>2500 then
    raise exception 'Invalid research file metadata.';
  end if;
  if t.transfer_mode='managed_at_rest_v1' then
    if p_envelope is distinct from '{"version":"v47-managed-atrest-1"}'::jsonb or p_object_sha256 is distinct from t.plaintext_sha256 then
      raise exception 'Managed file hash and envelope must match.';
    end if;
  else
    v_jwk:=p_envelope->'ephemeralPublicJwk';
    if p_envelope->>'version' is distinct from 'v47-research-file-ecdh-hkdf-aes256gcm-1'
      or (select count(*) from jsonb_object_keys(p_envelope))<>4
      or coalesce(p_envelope->>'salt','') !~ '^[A-Za-z0-9+/]{22}==$'
      or coalesce(p_envelope->>'iv','') !~ '^[A-Za-z0-9+/]{16}$'
      or jsonb_typeof(v_jwk) is distinct from 'object' then raise exception 'Invalid recipient envelope.'; end if;
    if (select count(*) from jsonb_object_keys(v_jwk))<>4 or v_jwk->>'kty' is distinct from 'EC' or v_jwk->>'crv' is distinct from 'P-256'
      or coalesce(v_jwk->>'x','') !~ '^[A-Za-z0-9_-]{43}$' or coalesce(v_jwk->>'y','') !~ '^[A-Za-z0-9_-]{43}$' or v_jwk ? 'd' then
      raise exception 'Invalid ephemeral public key.';
    end if;
  end if;
  select (o.metadata->>'size')::bigint into v_size from storage.objects o where o.bucket_id='blindstats-research-v1' and o.name=t.storage_path;
  if not found or v_size is distinct from p_object_byte_length then raise exception 'Stored object missing or size mismatch.'; end if;
  update public.research_transfers set state='ready',ciphertext_sha256=p_object_sha256,ciphertext_byte_length=p_object_byte_length,
    envelope=p_envelope,ready_at=clock_timestamp() where id=t.id;
  insert into public.research_transfer_events(transfer_id,actor_id,event_type) values(t.id,v_actor,'upload_completed');
end; $$;

-- Abandon only a pending v47 file. No client deletes Storage; new retry uses
-- a new immutable ID and encryption context. Ready files can never be abandoned.
create function public.abandon_research_file(p_transfer_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare t public.research_transfers%rowtype; v_actor uuid:=auth.uid();
begin
  select * into t from public.research_transfers where id=p_transfer_id for update;
  if not found or t.file_purpose='legacy_dataset' or t.state<>'pending' or t.sender_id is distinct from v_actor
    or not public.is_research_transfer_custodian(t.study_id,v_actor) then raise exception 'Pending custodian research file required.' using errcode='42501'; end if;
  if t.abandoned_at is not null then return; end if;
  update public.research_transfers set abandoned_at=clock_timestamp() where id=t.id;
  insert into public.research_transfer_events(transfer_id,actor_id,event_type) values(t.id,v_actor,'upload_abandoned');
end; $$;

-- Keep the old RPCs callable for historical records only, and preserve their
-- previous argument signatures. New file completion must pass the v47 checks.
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
  if not found or v_transfer.file_purpose <> 'legacy_dataset' or v_transfer.state <> 'pending'
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
  if not found or v_transfer.file_purpose <> 'legacy_dataset' or v_transfer.state <> 'pending'
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

-- All authenticated insertion paths still require the exact pending object
-- and distinct roles; independent supporting files need no workflow.
drop policy research_transfer_storage_insert_guard on storage.objects;
create policy research_transfer_storage_insert_guard on storage.objects
  as restrictive for insert to authenticated with check (
    bucket_id<>'blindstats-research-v1' or exists (
      select 1 from public.research_transfers t
      where t.storage_path=storage.objects.name and t.state='pending' and t.abandoned_at is null
        and t.sender_id=(select auth.uid())
        and public.is_research_transfer_custodian(t.study_id,(select auth.uid()))
        and public.is_research_transfer_analyst(t.study_id,t.recipient_id)
        and (t.file_purpose='legacy_dataset' or exists(select 1 from public.studies s where s.id=t.study_id and s.lifecycle='active' and s.file_protection=t.transfer_mode))
        and (t.file_purpose='supporting' or exists(select 1 from public.blinding_workflows w where w.id=t.workflow_id and w.study_id=t.study_id and w.state='blinded'))
    ));
-- Existing permissive insert policy, restrictive read/update/delete/anonymous
-- policies, recipient RLS, download authorization and acknowledgements remain.

alter table public.research_storage_cleanup_attempts drop constraint research_storage_cleanup_attempts_reason_check,
  add constraint research_storage_cleanup_attempts_reason_check check (reason in ('completed_secret','incomplete_dataset','incomplete_secret','incomplete_research_file'));

-- Preserve original terminal-workflow cleanup; extend to v47 abandoned
-- files after a grace period (or named synthetic fixtures in Development).
-- Stale un-abandoned independent files remain review-only. Never ready files.
create or replace function public.list_research_storage_cleanup(
  p_transfer_id uuid default null,p_synthetic_immediate boolean default false
) returns table(bucket_id text,transfer_id uuid,storage_path text,reason text,
  eligible boolean,object_present boolean,completion_at timestamptz)
language sql stable security definer set search_path='' as $$
  with transfers as (
    select 'blindstats-research-v1'::text as bucket_id,t.id as transfer_id,t.storage_path,t.created_at,t.study_id,t.workflow_id,
      null::uuid as request_id,case when t.file_purpose='legacy_dataset' then 'incomplete_dataset' else 'incomplete_research_file' end as reason,
      t.abandoned_at from public.research_transfers t where t.state='pending'
    union all
    select 'blindstats-secret-v1',t.id,t.storage_path,t.created_at,r.study_id,r.workflow_id,r.id,
      case when t.ready_at is null then 'incomplete_secret' else 'completed_secret' end,null::timestamptz
      from public.unblinding_secret_transfers t join public.unblinding_requests r on r.id=t.request_id
  ), candidates as (
    select t.bucket_id,t.transfer_id,t.storage_path,t.reason,t.created_at,c.registered_at as completion_at,
      (coalesce(w.state='unblinded' and c.id is not null and
        (c.registered_at<=now()-interval '24 hours' or (p_synthetic_immediate is true and s.name like '[INTEGRATION TEST]%')),false)
       or (t.abandoned_at is not null and (t.abandoned_at<=now()-interval '24 hours' or (p_synthetic_immediate is true and s.name like '[INTEGRATION TEST]%')))) as eligible,
      exists(select 1 from storage.objects o where o.bucket_id=t.bucket_id and o.name=t.storage_path) as object_present,
      exists(select 1 from public.research_storage_cleanup_attempts a where a.bucket_id=t.bucket_id and a.transfer_id=t.transfer_id and a.confirmed_at is null) as open_attempt
    from transfers t join public.studies s on s.id=t.study_id
    left join public.blinding_workflows w on w.id=t.workflow_id and w.study_id=t.study_id
    left join public.unblinding_completions c on c.workflow_id=t.workflow_id and c.study_id=t.study_id and (t.request_id is null or c.request_id=t.request_id)
    where (p_transfer_id is null or t.transfer_id=p_transfer_id)
      and t.storage_path=t.study_id::text||'/'||t.transfer_id::text||'.bin'
      and (p_synthetic_immediate is not true or s.name like '[INTEGRATION TEST]%')
  ) select c.bucket_id,c.transfer_id,c.storage_path,c.reason,c.eligible,c.object_present,c.completion_at from candidates c
  where (c.eligible and (c.object_present or c.open_attempt))
    or (not c.eligible and c.reason<>'completed_secret' and c.created_at<=now()-interval '24 hours')
  order by c.eligible desc,c.created_at,c.transfer_id limit 100;
$$;

revoke all on function public.initiate_research_file(uuid,uuid,uuid,text,text,text,text,integer,text),
  public.complete_research_file(uuid,text,integer,jsonb),public.abandon_research_file(uuid) from public,anon,authenticated;
grant execute on function public.initiate_research_file(uuid,uuid,uuid,text,text,text,text,integer,text),
  public.complete_research_file(uuid,text,integer,jsonb),public.abandon_research_file(uuid) to authenticated;
commit;
