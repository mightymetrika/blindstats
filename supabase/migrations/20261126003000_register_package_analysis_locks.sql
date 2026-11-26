-- v47a: independently versioned multi-file locks for existing v0.3/v0.4 transformations.
-- Do not enable package transformations in this migration. Historical RPCs stay intact.
begin;
alter table public.analysis_locks
  drop constraint analysis_locks_transformation_schema_version_fk,
  drop constraint analysis_locks_schema_version_valid,
  add constraint analysis_locks_schema_version_valid check (schema_version in ('0.3', '0.4', '0.5')),
  add column transformation_schema_version text generated always as (
    case when schema_version = '0.5' then analysis_lock_receipt_text::jsonb #>> '{blinding,schemaVersion}' else schema_version end
  ) stored;
alter table public.analysis_locks
  add constraint analysis_locks_transformation_schema_version_valid check (transformation_schema_version is not null),
  add constraint analysis_locks_transformation_schema_version_fk
    foreign key (transformation_record_id, transformation_schema_version)
    references public.blinding_transformations (id, schema_version) on delete restrict;

-- The legacy artifact fields for a v0.5 lock identify the exact downloadable
-- analysis-lock manifest, which contains the individual file identities.
create function public.register_package_analysis_lock(p_workflow_id uuid, p_analysis_lock_receipt_text text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  w public.blinding_workflows%rowtype;
  t public.blinding_transformations%rowtype;
  r jsonb;
  b jsonb;
  a jsonb;
  names text[] := array[]::text[];
  ids text[] := array[]::text[];
  digest text;
  record_id uuid;
  lock_uuid uuid;
  created_at timestamptz;
  receipt_size integer;
  -- ECMAScript trim whitespace, matching the browser parser for nonblank fields.
  trim_chars constant text := pg_catalog.chr(9)||pg_catalog.chr(10)||pg_catalog.chr(11)||pg_catalog.chr(12)||pg_catalog.chr(13)||' '||pg_catalog.chr(160)||pg_catalog.chr(5760)||pg_catalog.chr(8192)||pg_catalog.chr(8193)||pg_catalog.chr(8194)||pg_catalog.chr(8195)||pg_catalog.chr(8196)||pg_catalog.chr(8197)||pg_catalog.chr(8198)||pg_catalog.chr(8199)||pg_catalog.chr(8200)||pg_catalog.chr(8201)||pg_catalog.chr(8202)||pg_catalog.chr(8232)||pg_catalog.chr(8233)||pg_catalog.chr(8239)||pg_catalog.chr(8287)||pg_catalog.chr(12288)||pg_catalog.chr(65279);
begin
  if actor is null then raise exception using errcode = '42501', message = 'Authentication required.'; end if;
  select * into w from public.blinding_workflows where id = p_workflow_id for update;
  if not found then raise exception 'Blinding workflow not found.'; end if;
  if not public.has_study_capability(w.study_id, 'analysis.lock') then
    raise exception using errcode = '42501', message = 'You are not authorized to register an analysis lock.';
  end if;
  if w.state <> 'blinded' or w.active_plan_version_id is null then raise exception 'Analysis lock requires a blinded workflow and active plan.'; end if;
  select * into t from public.blinding_transformations where workflow_id = w.id and study_id = w.study_id;
  if not found or t.plan_version_id is distinct from w.active_plan_version_id or t.schema_version not in ('0.3','0.4') then
    raise exception 'Registered historical transformation and active plan required.';
  end if;
  receipt_size := pg_catalog.octet_length(p_analysis_lock_receipt_text);
  if receipt_size is null or receipt_size not between 1 and 262144 then raise exception 'Analysis-lock receipt size is invalid.'; end if;
  r := p_analysis_lock_receipt_text::jsonb;
  if pg_catalog.jsonb_typeof(r) is distinct from 'object' then raise exception 'Invalid lock receipt.'; end if;
  if not (r ?& array['schemaVersion','receiptType','lockId','createdAt','blinding','analysisArtifacts'])
    or (select count(*) from pg_catalog.jsonb_object_keys(r)) <> 6
    or r->'schemaVersion' is distinct from '"0.5"'::jsonb
    or r->'receiptType' is distinct from '"analysis_lock"'::jsonb
    or pg_catalog.jsonb_typeof(r->'lockId') is distinct from 'string'
    or pg_catalog.jsonb_typeof(r->'createdAt') is distinct from 'string'
    or (r->>'createdAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then
    raise exception 'Invalid package lock metadata.';
  end if;
  lock_uuid := (r->>'lockId')::uuid;
  created_at := (r->>'createdAt')::timestamptz;
  if lock_uuid::text <> (r->>'lockId') or pg_catalog.to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> (r->>'createdAt') then
    raise exception 'Noncanonical lock identity or timestamp.';
  end if;
  b := r->'blinding';
  if pg_catalog.jsonb_typeof(b) is distinct from 'object' then raise exception 'Invalid blinding reference.'; end if;
  if not (b ?& array['schemaVersion','transformationId','blindingReceiptSha256','datasetCommitmentSha256'])
    or (select count(*) from pg_catalog.jsonb_object_keys(b)) <> 4
    or b->'schemaVersion' is distinct from pg_catalog.to_jsonb(t.schema_version)
    or b->'transformationId' is distinct from pg_catalog.to_jsonb(t.transformation_id::text)
    or b->'blindingReceiptSha256' is distinct from pg_catalog.to_jsonb(t.public_receipt_sha256)
    or b->'datasetCommitmentSha256' is distinct from pg_catalog.to_jsonb(t.blinded_artifact_sha256) then
    raise exception 'Lock does not match registered blinding receipt and dataset commitment.';
  end if;
  if pg_catalog.jsonb_typeof(r->'analysisArtifacts') is distinct from 'array' then raise exception 'Invalid analysis artifacts.'; end if;
  if pg_catalog.jsonb_array_length(r->'analysisArtifacts') not between 1 and 100 then raise exception 'Select between 1 and 100 analysis artifacts.'; end if;
  for a in select value from pg_catalog.jsonb_array_elements(r->'analysisArtifacts') loop
    if pg_catalog.jsonb_typeof(a) is distinct from 'object' then raise exception 'Invalid analysis artifact.'; end if;
    if not (a ?& array['artifactId','filename','sha256','byteLength'])
      or (select count(*) from pg_catalog.jsonb_object_keys(a)) <> 4
      or pg_catalog.jsonb_typeof(a->'artifactId') is distinct from 'string'
      or pg_catalog.btrim(a->>'artifactId',trim_chars) = ''
      or pg_catalog.jsonb_typeof(a->'filename') is distinct from 'string'
      or pg_catalog.btrim(a->>'filename',trim_chars) = ''
      or (a->>'filename') in ('.','..')
      or pg_catalog.strpos(a->>'filename','/') > 0 or pg_catalog.strpos(a->>'filename',pg_catalog.chr(92)) > 0
      or (a->>'filename') ~ '[[:cntrl:]]'
      or pg_catalog.jsonb_typeof(a->'sha256') is distinct from 'string'
      or (a->>'sha256') !~ '^[0-9a-f]{64}$'
      or pg_catalog.jsonb_typeof(a->'byteLength') is distinct from 'number'
      or (a->>'byteLength') !~ '^[0-9]+$' then
      raise exception 'Invalid analysis artifact metadata.';
    end if;
    if (a->>'byteLength')::numeric > 9007199254740991 then raise exception 'Invalid analysis artifact byte length.'; end if;
    if (a->>'filename') = any(names) or (a->>'artifactId') = any(ids) then raise exception 'Duplicate analysis artifact identity.'; end if;
    names := pg_catalog.array_append(names,a->>'filename');
    ids := pg_catalog.array_append(ids,a->>'artifactId');
  end loop;
  digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_analysis_lock_receipt_text,'UTF8')),'hex');
  insert into public.analysis_locks (
    workflow_id,study_id,transformation_record_id,plan_version_id,lock_id,schema_version,receipt_created_at,
    blinding_receipt_sha256,blinded_artifact_sha256,analysis_artifact_filename,analysis_artifact_sha256,
    analysis_artifact_byte_length,analysis_lock_receipt_sha256,analysis_lock_receipt_text,registered_by
  ) values (
    w.id,w.study_id,t.id,t.plan_version_id,lock_uuid,'0.5',created_at,t.public_receipt_sha256,t.blinded_artifact_sha256,
    'analysis-lock-receipt.json',digest,receipt_size,digest,p_analysis_lock_receipt_text,actor
  ) on conflict(lock_id) do nothing returning id into record_id;
  if record_id is not null then return record_id; end if;
  select id into record_id from public.analysis_locks where lock_id=lock_uuid and workflow_id=w.id and analysis_lock_receipt_sha256=digest;
  if found then return record_id; end if;
  raise exception 'Analysis-lock identifier already registered with different content.';
end;
$$;
revoke all on function public.register_package_analysis_lock(uuid,text) from public;
grant execute on function public.register_package_analysis_lock(uuid,text) to authenticated;

comment on column public.analysis_locks.analysis_artifact_sha256 is
  'For historical locks: SHA-256 of analysis file. For schema 0.5: SHA-256 of exact analysis-lock manifest receipt; member hashes are in receipt text.';
comment on column public.analysis_locks.analysis_artifact_byte_length is
  'For schema 0.5: byte length of the exact manifest receipt, not sum of member file lengths.';
commit;
