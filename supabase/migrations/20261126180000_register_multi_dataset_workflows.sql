-- v47a: registered v0.5 multi-dataset workflow. Historical receipt bytes and
-- legacy RPCs are retained. Managed dataset delivery is deferred to v47b.
begin;

alter table public.blinding_transformations
  drop constraint blinding_transformations_schema_version_valid,
  drop constraint blinding_transformations_selection_by_version,
  add constraint blinding_transformations_schema_version_valid check (schema_version in ('0.3','0.4','0.5')),
  add constraint blinding_transformations_selection_by_version check (
    (schema_version = '0.3' and selected_column is not null and btrim(selected_column) <> '' and category_count is not null and selected_columns is null)
    or (schema_version = '0.4' and selected_column is null and category_count is null and selected_columns is not null
      and case when pg_catalog.jsonb_typeof(selected_columns) = 'array' then pg_catalog.jsonb_array_length(selected_columns) between 1 and column_count else false end)
    or (schema_version = '0.5' and selected_column is null and category_count is null and selected_columns is null
      and source_artifact_sha256 = blinded_artifact_sha256)
  );
alter table public.unblinding_completions
  drop constraint unblinding_completions_schema_version_valid,
  drop constraint unblinding_completions_selection_by_version,
  add constraint unblinding_completions_schema_version_valid check (schema_version in ('0.3','0.4','0.5')),
  add constraint unblinding_completions_selection_by_version check (
    (schema_version = '0.3' and selected_column is not null and btrim(selected_column) <> '' and selected_columns is null)
    or (schema_version = '0.4' and selected_column is null and selected_columns is not null
      and case when pg_catalog.jsonb_typeof(selected_columns) = 'array' then pg_catalog.jsonb_array_length(selected_columns) >= 1 else false end)
    or (schema_version = '0.5' and selected_column is null and selected_columns is null
      and source_artifact_sha256 = blinded_artifact_sha256)
  );
comment on column public.blinding_transformations.source_artifact_sha256 is 'For v0.5, the manifest SHA-256 commits to all source and blinded identities. Historical schemas retain their single-file SHA-256.';
comment on column public.blinding_transformations.blinded_artifact_sha256 is 'For v0.5, the manifest SHA-256, not a dataset file hash. Individual file hashes are in the exact public receipt.';
comment on column public.blinding_transformations.selected_columns is 'Historical v0.4 selected columns. NULL for v0.5; dataset-qualified selections and groups reside in the public manifest.';
comment on column public.unblinding_completions.selected_columns is 'Historical v0.4 selected columns. NULL for v0.5; selection is bound by the registered manifest commitment.';

-- Strict, bounded shape validation and canonical serialization compatible with
-- the browser's fixed-order JSON.stringify(manifest). Use json (not jsonb)
-- here to detect duplicate object keys before PostgreSQL normalizes them.
create function public.package_v05_canonical(j json, shape text)
returns text language plpgsql stable set search_path = '' as $$
declare
  keys text[];
  shapes text[];
  item json;
  child_shape text;
  scalar text;
  result text := '';
  n integer := 0;
  trim_chars constant text := pg_catalog.chr(9)||pg_catalog.chr(10)||pg_catalog.chr(11)||pg_catalog.chr(12)||pg_catalog.chr(13)||' '||pg_catalog.chr(160)||pg_catalog.chr(5760)||pg_catalog.chr(8192)||pg_catalog.chr(8193)||pg_catalog.chr(8194)||pg_catalog.chr(8195)||pg_catalog.chr(8196)||pg_catalog.chr(8197)||pg_catalog.chr(8198)||pg_catalog.chr(8199)||pg_catalog.chr(8200)||pg_catalog.chr(8201)||pg_catalog.chr(8202)||pg_catalog.chr(8232)||pg_catalog.chr(8233)||pg_catalog.chr(8239)||pg_catalog.chr(8287)||pg_catalog.chr(12288)||pg_catalog.chr(65279);
begin
  case shape
    when 'receipt' then keys := array['schemaVersion','receiptType','transformationId','createdAt','manifest','manifestSha256','sealedMapping']; shapes := array['version','receipt_type','uuid','timestamp','manifest','hash','sealed'];
    when 'manifest' then keys := array['datasets','mappingGroups']; shapes := array['datasets','groups'];
    when 'dataset' then keys := array['datasetId','format','rowCount','columnCount','selectedVariables','source','blinded']; shapes := array['nonblank','format','positive','positive','variables','source','blinded'];
    when 'variable' then keys := array['id','name']; shapes := array['nonblank','nonblank'];
    when 'source' then keys := array['sha256','byteLength']; shapes := array['hash','positive'];
    when 'blinded' then keys := array['filename','sha256','byteLength']; shapes := array['filename','hash','positive'];
    when 'group' then keys := array['groupId','members','categoryCount']; shapes := array['nonblank','members','categories'];
    when 'member' then keys := array['datasetId','variableId']; shapes := array['nonblank','nonblank'];
    when 'sealed' then keys := array['algorithm','aadScheme','ivHex','ciphertextHex']; shapes := array['algorithm','aad','iv','ciphertext'];
    when 'datasets' then child_shape := 'dataset';
    when 'variables' then child_shape := 'variable';
    when 'groups' then child_shape := 'group';
    when 'members' then child_shape := 'member';
    else null;
  end case;
  if keys is not null then
    if pg_catalog.json_typeof(j) is distinct from 'object' then raise exception 'Invalid package % object.', shape; end if;
    if (select count(*) from pg_catalog.json_each(j)) <> pg_catalog.cardinality(keys) then raise exception 'Invalid package % keys.', shape; end if;
    for i in 1..pg_catalog.cardinality(keys) loop
      item := j->(keys[i]);
      if item is null then raise exception 'Missing package % key.', shape; end if;
      if i > 1 then result := result || ','; end if;
      result := result || pg_catalog.to_json(keys[i])::text || ':' || public.package_v05_canonical(item,shapes[i]);
    end loop;
    return '{' || result || '}';
  end if;
  if child_shape is not null then
    if pg_catalog.json_typeof(j) is distinct from 'array' then raise exception 'Invalid package % array.', shape; end if;
    if pg_catalog.json_array_length(j) < 1 or (shape = 'datasets' and pg_catalog.json_array_length(j) > 20) then raise exception 'Invalid package % count.', shape; end if;
    for item in select value from pg_catalog.json_array_elements(j) loop
      if n > 0 then result := result || ','; end if;
      result := result || public.package_v05_canonical(item,child_shape);
      n := n + 1;
    end loop;
    return '[' || result || ']';
  end if;
  scalar := j #>> '{}';
  if shape in ('positive','categories') then
    if pg_catalog.json_typeof(j) is distinct from 'number' or scalar !~ '^[0-9]+$' then raise exception 'Invalid package integer.'; end if;
    if scalar::numeric > 9007199254740991 or scalar::numeric < (case when shape = 'categories' then 2 else 1 end) then raise exception 'Invalid package integer range.'; end if;
    return scalar;
  end if;
  if pg_catalog.json_typeof(j) is distinct from 'string' or pg_catalog.btrim(scalar,trim_chars) = '' then raise exception 'Invalid package % string.', shape; end if;
  if not (case shape
    when 'nonblank' then true
    when 'version' then scalar = '0.5'
    when 'receipt_type' then scalar = 'blinding_package'
    when 'uuid' then scalar = (scalar::uuid)::text
    when 'timestamp' then scalar ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' and pg_catalog.to_char(scalar::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = scalar
    when 'format' then scalar in ('csv','tsv','xlsx')
    when 'filename' then pg_catalog.char_length(scalar) <= 160 and scalar ~ '^[A-Za-z0-9][A-Za-z0-9._ -]*[.](csv|tsv|xlsx)$' and pg_catalog.strpos(scalar,'..') = 0
    when 'hash' then scalar ~ '^[0-9a-f]{64}$'
    when 'algorithm' then scalar = 'AES-GCM'
    when 'aad' then scalar = 'blindstats_package_mapping_aad_v1'
    when 'iv' then scalar ~ '^[0-9a-f]{24}$'
    when 'ciphertext' then scalar ~ '^[0-9a-f]+$' and pg_catalog.char_length(scalar) >= 32 and pg_catalog.mod(pg_catalog.char_length(scalar),2) = 0
    else false end) then raise exception 'Invalid package % value.', shape; end if;
  return pg_catalog.to_json(scalar)::text;
end;
$$;
revoke all on function public.package_v05_canonical(json,text) from public,anon,authenticated;

create function public.register_package_blinding_transformation(p_workflow_id uuid,p_public_receipt_text text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  w public.blinding_workflows%rowtype;
  raw_receipt json;
  r jsonb;
  m jsonb;
  d jsonb;
  v jsonb;
  g jsonb;
  member jsonb;
  member_key jsonb;
  selected_keys jsonb[] := array[]::jsonb[];
  used_keys jsonb[] := array[]::jsonb[];
  dataset_ids text[] := array[]::text[];
  filenames text[] := array[]::text[];
  variable_ids text[];
  variable_names text[];
  group_ids text[] := array[]::text[];
  group_rows numeric;
  total_rows bigint := 0;
  total_columns bigint := 0;
  digest text;
  manifest_digest text;
  record_id uuid;
begin
  if actor is null then raise exception using errcode='42501',message='Authentication required.'; end if;
  select * into w from public.blinding_workflows where id=p_workflow_id for update;
  if not found or not public.has_study_capability(w.study_id,'blinding.create') then raise exception using errcode='42501',message='Blinding creation not authorized.'; end if;
  if w.state <> 'setup' or w.active_plan_version_id is null or not exists (
    select 1 from public.blinding_plan_versions p where p.id=w.active_plan_version_id and p.workflow_id=w.id and p.study_id=w.study_id
  ) then raise exception 'Package registration requires setup and an active plan.'; end if;
  if p_public_receipt_text is null or pg_catalog.octet_length(p_public_receipt_text) not between 1 and 524288 then raise exception 'Package receipt size is invalid.'; end if;
  raw_receipt := p_public_receipt_text::json;
  perform public.package_v05_canonical(raw_receipt,'receipt');
  r := raw_receipt::jsonb;
  m := r->'manifest';
  manifest_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(public.package_v05_canonical(raw_receipt->'manifest','manifest'),'UTF8')),'hex');
  if manifest_digest is distinct from r->>'manifestSha256' then raise exception 'Package manifest hash mismatch.'; end if;
  for d in select value from pg_catalog.jsonb_array_elements(m->'datasets') loop
    if (d->>'datasetId') = any(dataset_ids) or (d#>>'{blinded,filename}') = any(filenames) then raise exception 'Duplicate package dataset or filename.'; end if;
    if pg_catalog.right(d#>>'{blinded,filename}',pg_catalog.char_length(d->>'format')+1) <> ('.'||(d->>'format')) then raise exception 'Dataset filename does not match format.'; end if;
    if (d->>'rowCount')::numeric > 2147483647 or (d->>'columnCount')::numeric > 2147483647 then raise exception 'Package dataset dimensions too large.'; end if;
    dataset_ids := pg_catalog.array_append(dataset_ids,d->>'datasetId');
    filenames := pg_catalog.array_append(filenames,d#>>'{blinded,filename}');
    total_rows := total_rows + (d->>'rowCount')::bigint;
    total_columns := total_columns + (d->>'columnCount')::bigint;
    if pg_catalog.jsonb_array_length(d->'selectedVariables') > (d->>'columnCount')::numeric then raise exception 'Invalid selected variable count.'; end if;
    variable_ids := array[]::text[]; variable_names := array[]::text[];
    for v in select value from pg_catalog.jsonb_array_elements(d->'selectedVariables') loop
      if (v->>'id') = any(variable_ids) or (v->>'name') = any(variable_names) then raise exception 'Duplicate selected variable.'; end if;
      variable_ids := pg_catalog.array_append(variable_ids,v->>'id');
      variable_names := pg_catalog.array_append(variable_names,v->>'name');
      selected_keys := pg_catalog.array_append(selected_keys,pg_catalog.jsonb_build_array(d->>'datasetId',v->>'id'));
    end loop;
  end loop;
  if total_rows > 2147483647 or total_columns > 2147483647 then raise exception 'Aggregate dataset dimensions too large.'; end if;
  for g in select value from pg_catalog.jsonb_array_elements(m->'mappingGroups') loop
    if (g->>'groupId') = any(group_ids) then raise exception 'Duplicate mapping group.'; end if;
    group_ids := pg_catalog.array_append(group_ids,g->>'groupId');
    group_rows := 0;
    for member in select value from pg_catalog.jsonb_array_elements(g->'members') loop
      member_key := pg_catalog.jsonb_build_array(member->>'datasetId',member->>'variableId');
      if not (member_key = any(selected_keys)) or member_key = any(used_keys) then raise exception 'Unknown or repeated mapping group member.'; end if;
      used_keys := pg_catalog.array_append(used_keys,member_key);
      select group_rows + (ds.value->>'rowCount')::numeric into group_rows from pg_catalog.jsonb_array_elements(m->'datasets') ds where ds.value->>'datasetId'=member->>'datasetId';
    end loop;
    if (g->>'categoryCount')::numeric > group_rows then raise exception 'Mapping category count exceeds observations.'; end if;
  end loop;
  if pg_catalog.cardinality(used_keys) <> pg_catalog.cardinality(selected_keys) then raise exception 'Mapping groups must cover the exact selected variables.'; end if;
  digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_public_receipt_text,'UTF8')),'hex');
  insert into public.blinding_transformations(workflow_id,study_id,plan_version_id,transformation_id,schema_version,transformation_type,receipt_created_at,selected_column,category_count,selected_columns,row_count,column_count,source_artifact_sha256,blinded_artifact_sha256,public_receipt_sha256,public_receipt_text,registered_by)
  values(w.id,w.study_id,w.active_plan_version_id,(r->>'transformationId')::uuid,'0.5','categorical_label_permutation',(r->>'createdAt')::timestamptz,null,null,null,total_rows::integer,total_columns::integer,manifest_digest,manifest_digest,digest,p_public_receipt_text,actor)
  returning id into record_id;
  update public.blinding_workflows set state='blinded' where id=w.id and study_id=w.study_id and state='setup';
  if not found then raise exception 'Package registration could not transition workflow.'; end if;
  return record_id;
end;
$$;
revoke all on function public.register_package_blinding_transformation(uuid,text) from public,anon,authenticated;
grant execute on function public.register_package_blinding_transformation(uuid,text) to authenticated;

-- Extend the applied v0.5 lock function; preserve every other check.
create or replace function public.register_package_analysis_lock(p_workflow_id uuid, p_analysis_lock_receipt_text text)
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
  if not found or t.plan_version_id is distinct from w.active_plan_version_id or t.schema_version not in ('0.3','0.4','0.5') then
    raise exception 'Registered transformation and active plan required.';
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

-- Keep the same request/authorization/plan/lock checks as v0.4, with
-- manifest commitments in place of single-file identities. No mapping payload.
create function public.register_package_unblinding_completion(
  p_workflow_id uuid,
  p_request_id uuid,
  p_unblinding_id uuid,
  p_receipt_created_at timestamptz,
  p_transformation_id uuid,
  p_lock_id uuid,
  p_source_artifact_sha256 text,
  p_blinding_receipt_sha256 text,
  p_blinded_artifact_sha256 text,
  p_unblinding_secret_sha256 text,
  p_analysis_lock_receipt_sha256 text,
  p_analysis_artifact_filename text,
  p_analysis_artifact_sha256 text,
  p_analysis_artifact_byte_length bigint,
  p_unblinding_receipt_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;

  v_study_id uuid;
  v_state text;
  v_active_plan_version_id uuid;
  v_require_analysis_lock boolean;

  v_request_plan_version_id uuid;
  v_transformation_record_id uuid;
  v_analysis_lock_id uuid;

  v_authorization_id uuid;
  v_authorization_plan_version_id uuid;

  v_transformation_id uuid;
  v_transformation_plan_version_id uuid;
  v_source_artifact_sha256 text;
  v_blinded_artifact_sha256 text;
  v_public_receipt_sha256 text;

  v_lock_id uuid;
  v_lock_plan_version_id uuid;
  v_lock_transformation_record_id uuid;
  v_lock_blinding_receipt_sha256 text;
  v_lock_blinded_artifact_sha256 text;
  v_lock_receipt_sha256 text;
  v_analysis_artifact_filename text;
  v_analysis_artifact_sha256 text;
  v_analysis_artifact_byte_length bigint;

  v_existing_completion_id uuid;
  v_existing_unblinding_id uuid;
  v_existing_receipt_sha256 text;
  v_existing_completed_by uuid;

  v_completion_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  select
    workflow.study_id,
    workflow.state,
    workflow.active_plan_version_id
  into
    v_study_id,
    v_state,
    v_active_plan_version_id
  from public.blinding_workflows as workflow
  where workflow.id = p_workflow_id
  for update;

  if not found then
    raise exception 'Blinding workflow not found.';
  end if;

  if not public.has_study_capability(
    v_study_id,
    'unblinded.receive'
  ) then
    raise exception using
      errcode = '42501',
      message = 'You are not authorized to receive unblinded information.';
  end if;

  -- Make an exact retry idempotent even after the first successful call has
  -- already transitioned the workflow to unblinded.
  select
    completion.id,
    completion.unblinding_id,
    completion.unblinding_receipt_sha256,
    completion.completed_by
  into
    v_existing_completion_id,
    v_existing_unblinding_id,
    v_existing_receipt_sha256,
    v_existing_completed_by
  from public.unblinding_completions as completion
  where completion.workflow_id = p_workflow_id
    and completion.request_id = p_request_id and completion.schema_version = '0.5';

  if found then
    if v_existing_unblinding_id = p_unblinding_id
      and v_existing_receipt_sha256 = p_unblinding_receipt_sha256
      and v_existing_completed_by = v_user_id
    then
      return v_existing_completion_id;
    end if;

    raise exception
      'An unblinding completion is already registered for this workflow.';
  end if;

  if v_state <> 'unblinding_authorized' then
    raise exception
      'Unblinding completion requires the workflow to be unblinding authorized.';
  end if;

  if v_active_plan_version_id is null then
    raise exception
      'The active BlindingPlan version could not be verified.';
  end if;

  select plan.require_analysis_lock
  into v_require_analysis_lock
  from public.blinding_plan_versions as plan
  where plan.id = v_active_plan_version_id
    and plan.workflow_id = p_workflow_id
    and plan.study_id = v_study_id;

  if not found then
    raise exception
      'The active BlindingPlan version could not be loaded.';
  end if;

  select
    request.plan_version_id,
    request.transformation_record_id,
    request.analysis_lock_id
  into
    v_request_plan_version_id,
    v_transformation_record_id,
    v_analysis_lock_id
  from public.unblinding_requests as request
  where request.id = p_request_id
    and request.workflow_id = p_workflow_id
    and request.study_id = v_study_id;

  if not found then
    raise exception 'Authorized unblinding request not found.';
  end if;

  if v_request_plan_version_id
      is distinct from v_active_plan_version_id
  then
    raise exception
      'Unblinding request is not bound to the active BlindingPlan.';
  end if;

  if v_require_analysis_lock
    and v_analysis_lock_id is null
  then
    raise exception
      'The active BlindingPlan requires the authorized request to be bound to a registered AnalysisLock.';
  end if;

  select
    auth_event.id,
    auth_event.plan_version_id
  into
    v_authorization_id,
    v_authorization_plan_version_id
  from public.unblinding_authorizations as auth_event
  where auth_event.request_id = p_request_id
    and auth_event.workflow_id = p_workflow_id
    and auth_event.study_id = v_study_id;

  if not found then
    raise exception 'Unblinding authorization not found.';
  end if;

  if v_authorization_plan_version_id
      is distinct from v_active_plan_version_id
  then
    raise exception
      'Unblinding authorization is not bound to the active BlindingPlan.';
  end if;

  select
    transformation.transformation_id,
    transformation.plan_version_id,
    transformation.source_artifact_sha256,
    transformation.blinded_artifact_sha256,
    transformation.public_receipt_sha256
  into
    v_transformation_id,
    v_transformation_plan_version_id,
    v_source_artifact_sha256,
    v_blinded_artifact_sha256,
    v_public_receipt_sha256
  from public.blinding_transformations as transformation
  where transformation.id = v_transformation_record_id
    and transformation.workflow_id = p_workflow_id
    and transformation.study_id = v_study_id
    and transformation.schema_version = '0.5';

  if not found then
    raise exception 'Registered blinding transformation not found.';
  end if;

  if v_transformation_plan_version_id
      is distinct from v_active_plan_version_id
  then
    raise exception
      'Registered blinding transformation is not bound to the active BlindingPlan.';
  end if;

  if v_analysis_lock_id is not null then
    select
      lock.lock_id,
      lock.plan_version_id,
      lock.transformation_record_id,
      lock.blinding_receipt_sha256,
      lock.blinded_artifact_sha256,
      lock.analysis_lock_receipt_sha256,
      lock.analysis_artifact_filename,
      lock.analysis_artifact_sha256,
      lock.analysis_artifact_byte_length
    into
      v_lock_id,
      v_lock_plan_version_id,
      v_lock_transformation_record_id,
      v_lock_blinding_receipt_sha256,
      v_lock_blinded_artifact_sha256,
      v_lock_receipt_sha256,
      v_analysis_artifact_filename,
      v_analysis_artifact_sha256,
      v_analysis_artifact_byte_length
    from public.analysis_locks as lock
    where lock.id = v_analysis_lock_id
      and lock.workflow_id = p_workflow_id
      and lock.study_id = v_study_id
      and lock.schema_version = '0.5';

    if not found then
      raise exception 'Request-selected AnalysisLock not found.';
    end if;

    if v_lock_plan_version_id
        is distinct from v_active_plan_version_id
      or v_lock_transformation_record_id
        is distinct from v_transformation_record_id
    then
      raise exception
        'Request-selected AnalysisLock is not bound to the authorized workflow artifact chain.';
    end if;

    if v_lock_blinding_receipt_sha256
        is distinct from v_public_receipt_sha256
      or v_lock_blinded_artifact_sha256
        is distinct from v_blinded_artifact_sha256
    then
      raise exception
        'Request-selected AnalysisLock does not match the registered blinding transformation.';
    end if;

    if p_lock_id is distinct from v_lock_id then
      raise exception
        'Unblinding receipt lock identifier does not match the request-selected AnalysisLock.';
    end if;

    if p_analysis_lock_receipt_sha256
        is distinct from v_lock_receipt_sha256
    then
      raise exception
        'Unblinding receipt AnalysisLock receipt hash does not match the request-selected AnalysisLock.';
    end if;

    if p_analysis_artifact_filename
        is distinct from v_analysis_artifact_filename
      or p_analysis_artifact_sha256
        is distinct from v_analysis_artifact_sha256
      or p_analysis_artifact_byte_length
        is distinct from v_analysis_artifact_byte_length
    then
      raise exception
        'Unblinding receipt analysis artifact identity does not match the request-selected AnalysisLock.';
    end if;

    if p_analysis_lock_receipt_sha256 is null
      or p_analysis_lock_receipt_sha256 !~ '^[0-9a-f]{64}$'
      or p_analysis_artifact_sha256 is null
      or p_analysis_artifact_sha256 !~ '^[0-9a-f]{64}$'
    then
      raise exception
        'Unblinding completion contains an invalid AnalysisLock SHA-256 digest.';
    end if;

    if p_analysis_artifact_filename is null
      or btrim(p_analysis_artifact_filename) = ''
    then
      raise exception 'Analysis artifact filename cannot be blank.';
    end if;

    if p_analysis_artifact_byte_length is null
      or p_analysis_artifact_byte_length < 1
    then
      raise exception 'Analysis artifact byte length must be positive.';
    end if;
  else
    if p_lock_id is not null
      or p_analysis_lock_receipt_sha256 is not null
      or p_analysis_artifact_filename is not null
      or p_analysis_artifact_sha256 is not null
      or p_analysis_artifact_byte_length is not null
    then
      raise exception
        'Unblinding completion must omit AnalysisLock metadata when the authorized request is not bound to an AnalysisLock.';
    end if;
  end if;

  -- Verify browser-reported nonsecret receipt fields against the durable
  -- server-side artifact chain. The secret hash and final receipt hash are safe
  -- client-reported completion metadata; the secret and released mapping stay
  -- local and therefore cannot be independently recomputed by the server.
  if p_transformation_id is distinct from v_transformation_id then
    raise exception
      'Unblinding receipt transformation identifier does not match the registered transformation.';
  end if;

  if p_source_artifact_sha256 is distinct from v_source_artifact_sha256 then
    raise exception
      'Unblinding receipt source artifact hash does not match the registered transformation.';
  end if;

  if p_blinding_receipt_sha256 is distinct from v_public_receipt_sha256 then
    raise exception
      'Unblinding receipt public receipt hash does not match the registered transformation.';
  end if;

  if p_blinded_artifact_sha256 is distinct from v_blinded_artifact_sha256 then
    raise exception
      'Unblinding receipt blinded artifact hash does not match the registered transformation.';
  end if;

  if p_source_artifact_sha256 is null
    or p_source_artifact_sha256 !~ '^[0-9a-f]{64}$'
    or p_blinding_receipt_sha256 is null
    or p_blinding_receipt_sha256 !~ '^[0-9a-f]{64}$'
    or p_blinded_artifact_sha256 is null
    or p_blinded_artifact_sha256 !~ '^[0-9a-f]{64}$'
    or p_unblinding_secret_sha256 is null
    or p_unblinding_secret_sha256 !~ '^[0-9a-f]{64}$'
    or p_unblinding_receipt_sha256 is null
    or p_unblinding_receipt_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception
      'Unblinding completion contains an invalid SHA-256 digest.';
  end if;

  insert into public.unblinding_completions (
    workflow_id,
    study_id,
    plan_version_id,
    request_id,
    authorization_id,
    transformation_record_id,
    analysis_lock_id,
    unblinding_id,
    schema_version,
    receipt_created_at,
    source_artifact_sha256,
    blinding_receipt_sha256,
    blinded_artifact_sha256,
    unblinding_secret_sha256,
    analysis_lock_receipt_sha256,
    analysis_artifact_filename,
    analysis_artifact_sha256,
    analysis_artifact_byte_length,
    unblinding_receipt_sha256,
    completed_by
  )
  values (
    p_workflow_id,
    v_study_id,
    v_active_plan_version_id,
    p_request_id,
    v_authorization_id,
    v_transformation_record_id,
    v_analysis_lock_id,
    p_unblinding_id,
    '0.5',
    p_receipt_created_at,
    v_source_artifact_sha256,
    v_public_receipt_sha256,
    v_blinded_artifact_sha256,
    p_unblinding_secret_sha256,
    v_lock_receipt_sha256,
    v_analysis_artifact_filename,
    v_analysis_artifact_sha256,
    v_analysis_artifact_byte_length,
    p_unblinding_receipt_sha256,
    v_user_id
  )
  returning id
  into v_completion_id;

  update public.blinding_workflows
  set state = 'unblinded'
  where id = p_workflow_id
    and study_id = v_study_id
    and state = 'unblinding_authorized';

  if not found then
    raise exception
      'Unable to transition workflow to unblinded.';
  end if;

  return v_completion_id;
end;
$$;
revoke all on function public.register_package_unblinding_completion(uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,text,text,text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.register_package_unblinding_completion(uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,text,text,text,text,text,bigint,text) to authenticated;

-- A manifest hash is not a transferable dataset hash. Prevent legacy CSV
-- RPCs from accepting manifest bytes in lieu of a registered file.
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
    where t.workflow_id = p_workflow_id and t.study_id = v_study_id and t.schema_version in ('0.3','0.4');
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
    where t.workflow_id = p_workflow_id and t.study_id = v_study_id and t.schema_version in ('0.3','0.4');
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


commit;
