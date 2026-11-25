-- Study-scoped file policy, immutable from creation. Preserve historical
-- transfers and backups; never reinterpret managed bytes as E2EE ciphertext.
begin;
alter table public.studies add column file_protection text not null
  default 'managed_at_rest_v1' check (file_protection in ('managed_at_rest_v1','recipient_e2ee_v1'));
-- Prior recipient-encrypted transfers imply strict protection for future files.
update public.studies s set file_protection='recipient_e2ee_v1'
where exists(select 1 from public.research_transfers t where t.study_id=s.id and t.transfer_mode='recipient_e2ee_v1')
   or exists(select 1 from public.unblinding_secret_transfers t join public.unblinding_requests r on r.id=t.request_id
      where r.study_id=s.id and t.transfer_mode='recipient_e2ee_v1');
-- Don't silently strand an unfinished historical transfer in a mixed-mode Study.
do $$ begin
  if exists(select 1 from public.research_transfers t join public.studies s on s.id=t.study_id
    where t.state='pending' and t.transfer_mode<>s.file_protection)
  or exists(select 1 from public.unblinding_secret_transfers t join public.unblinding_requests r on r.id=t.request_id
    join public.studies s on s.id=r.study_id where t.ready_at is null and t.transfer_mode<>s.file_protection) then
    raise exception 'Resolve mixed-mode pending transfers before applying Study protection policy.';
  end if;
end $$;
grant insert(file_protection) on public.studies to authenticated;
-- No update grant; trigger also rejects changes via other SQL paths.
create function public.enforce_immutable_study_file_protection() returns trigger
language plpgsql set search_path='' as $$ begin
  if new.file_protection is distinct from old.file_protection then
    raise exception 'Study file protection cannot change after creation.' using errcode='42501';
  end if;
  return new;
end $$;
create trigger enforce_immutable_study_file_protection before update on public.studies
for each row execute function public.enforce_immutable_study_file_protection();

-- Membership revocation still removes all researcher access through RLS.
-- Preserve the encrypted backup if membership is later restored, rather than
-- cascading away the only key that can open existing recipient-encrypted files.
alter table public.research_transfer_public_keys
  drop constraint research_transfer_public_keys_study_id_user_id_fkey,
  add constraint research_transfer_public_keys_study_id_fkey foreign key (study_id) references public.studies(id) on delete cascade,
  add constraint research_transfer_public_keys_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

-- Prevent reuse of identical public keys across Studies or recipients. Existing
-- browser-generated keys are independent. Fail rather than mutate duplicate keys.
create unique index research_transfer_public_key_unique_material
  on public.research_transfer_public_keys (
    (decode(translate(public_jwk->>'x','-_','+/')||'=','base64')),
    (decode(translate(public_jwk->>'y','-_','+/')||'=','base64'))
  );

create function public.enforce_study_file_protection_v46() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_study_id uuid; v_policy text;
begin
  if tg_table_name='unblinding_secret_transfers' then
    select r.study_id into v_study_id from public.unblinding_requests r where r.id=new.request_id;
  else
    v_study_id:=new.study_id;
  end if;
  select s.file_protection into v_policy from public.studies s where s.id=v_study_id;
  if tg_table_name='research_transfer_public_keys' then
    if v_policy is distinct from 'recipient_e2ee_v1' then
      raise exception 'Study does not require recipient-only encryption.' using errcode='42501';
    end if;
  elsif new.transfer_mode is distinct from v_policy then
    raise exception 'Transfer mode does not match Study file protection.' using errcode='42501';
  end if;
  return new;
end $$;
-- Existing ready transfers are intentionally unaffected, including their
-- retrieval and acknowledgements. New inserts must match the Study policy.
create trigger enforce_dataset_study_protection before insert on public.research_transfers
for each row execute function public.enforce_study_file_protection_v46();
create trigger enforce_secret_study_protection before insert on public.unblinding_secret_transfers
for each row execute function public.enforce_study_file_protection_v46();
create trigger enforce_key_study_protection before insert on public.research_transfer_public_keys
for each row execute function public.enforce_study_file_protection_v46();
revoke all on function public.enforce_immutable_study_file_protection() from public,anon,authenticated;
revoke all on function public.enforce_study_file_protection_v46() from public,anon,authenticated;

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
  if (select s.file_protection from public.studies s where s.id=v_study_id) is distinct from 'recipient_e2ee_v1' then
    raise exception 'Transfer mode does not match Study file protection.' using errcode='42501';
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
      and v_existing.transfer_mode = 'recipient_e2ee_v1'
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
  if (select s.file_protection from public.studies s where s.id=v_study_id) is distinct from 'managed_at_rest_v1' then
    raise exception 'Transfer mode does not match Study file protection.' using errcode='42501';
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

create or replace function public.initiate_unblinding_secret_transfer(p_request_id uuid,p_plaintext_sha256 text,p_transfer_mode text)
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
  if (select s.file_protection from public.studies s where s.id=r.study_id) is distinct from p_transfer_mode then
    raise exception 'Transfer mode does not match Study file protection.' using errcode='42501';
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

commit;
