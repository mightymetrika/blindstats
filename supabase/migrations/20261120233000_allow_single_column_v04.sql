-- v0.4 is the canonical protocol for new one-column and multi-column blinding.
-- This is a non-destructive, additive migration: keep all historical v0.3
-- functions, rows, grants and already-applied migrations unchanged.
-- Apply to Development only until explicitly approved for Production.

begin;

-- Preserve v0.3 rows while allowing selected_columns of length ONE for v0.4.
alter table public.blinding_transformations
  drop constraint blinding_transformations_selection_by_version;
alter table public.blinding_transformations
  add constraint blinding_transformations_selection_by_version
  check (
    (schema_version = '0.3'
      and selected_column is not null
      and btrim(selected_column) <> ''
      and category_count is not null
      and selected_columns is null)
    or
    (schema_version = '0.4'
      and selected_column is null
      and category_count is null
      and selected_columns is not null
      and case when pg_catalog.jsonb_typeof(selected_columns) = 'array'
        then pg_catalog.jsonb_array_length(selected_columns) between 1 and column_count
        else false end)
  );

alter table public.unblinding_completions
  drop constraint unblinding_completions_selection_by_version;
alter table public.unblinding_completions
  add constraint unblinding_completions_selection_by_version
  check (
    (schema_version = '0.3'
      and selected_column is not null
      and btrim(selected_column) <> ''
      and selected_columns is null)
    or
    (schema_version = '0.4'
      and selected_column is null
      and selected_columns is not null
      and case when pg_catalog.jsonb_typeof(selected_columns) = 'array'
        then pg_catalog.jsonb_array_length(selected_columns) >= 1
        else false end)
  );

-- Retain the existing authenticated EXECUTE grants. Only widen the safe,
-- version-specific v0.4 column-count validation; all role/plan/state/receipt
-- and hash checks are carried forward verbatim.
create or replace function public.register_multi_blinding_transformation(
  p_workflow_id uuid,
  p_public_receipt_text text
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

  v_receipt jsonb;
  v_selected jsonb;
  v_item jsonb;
  v_sealed jsonb;
  v_algorithm jsonb;
  v_key_count integer;
  v_selected_count integer;
  v_names text[] := array[]::text[];
  v_column text;
  v_categories_numeric numeric;
  v_row_count integer;
  v_column_count integer;

  v_transformation_id uuid;
  v_created_at_text text;
  v_created_at timestamptz;
  v_source_sha256 text;
  v_blinded_sha256 text;
  v_receipt_sha256 text;
  v_record_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select workflow.study_id, workflow.state, workflow.active_plan_version_id
    into v_study_id, v_state, v_active_plan_version_id
  from public.blinding_workflows as workflow
  where workflow.id = p_workflow_id
  for update;

  if not found then
    raise exception 'Blinding workflow not found.';
  end if;
  if not public.has_study_capability(v_study_id, 'blinding.create') then
    raise exception using errcode = '42501',
      message = 'You are not authorized to create or register a blinded package.';
  end if;
  if v_state <> 'setup' then
    raise exception 'Blinded-package registration requires workflow state setup.';
  end if;
  if v_active_plan_version_id is null or not exists (
    select 1 from public.blinding_plan_versions as plan
    where plan.id = v_active_plan_version_id
      and plan.workflow_id = p_workflow_id
      and plan.study_id = v_study_id
  ) then
    raise exception 'An active BlindingPlan version is required before blinding.';
  end if;

  if p_public_receipt_text is null or char_length(p_public_receipt_text) = 0 then
    raise exception 'Public blinding receipt cannot be empty.';
  end if;

  -- Digest the exact UTF-8 receipt text rather than normalized JSON.
  v_receipt_sha256 := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_public_receipt_text, 'UTF8')),
    'hex'
  );
  begin
    v_receipt := p_public_receipt_text::jsonb;
  exception when others then
    raise exception 'Public blinding receipt must contain valid JSON.';
  end;

  if pg_catalog.jsonb_typeof(v_receipt) is distinct from 'object' then
    raise exception 'Public blinding receipt must contain a JSON object.';
  end if;
  select count(*) into v_key_count
    from pg_catalog.jsonb_object_keys(v_receipt);
  if v_key_count <> 11 or not (v_receipt ?& array[
    'schemaVersion', 'transformationId', 'createdAt', 'transformationType',
    'selectedColumns', 'rowCount', 'columnCount', 'sourceArtifact',
    'blindedArtifact', 'sealedMapping', 'algorithm'
  ]) then
    raise exception 'Public blinding receipt has unexpected structure.';
  end if;

  if pg_catalog.jsonb_typeof(v_receipt -> 'schemaVersion') is distinct from 'string'
    or (v_receipt ->> 'schemaVersion') <> '0.4'
    or pg_catalog.jsonb_typeof(v_receipt -> 'transformationId') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_receipt -> 'createdAt') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_receipt -> 'transformationType') is distinct from 'string'
    or (v_receipt ->> 'transformationType') <> 'categorical_label_permutation'
    or pg_catalog.jsonb_typeof(v_receipt -> 'rowCount') is distinct from 'number'
    or pg_catalog.jsonb_typeof(v_receipt -> 'columnCount') is distinct from 'number'
  then
    raise exception 'Public blinding receipt contains unsupported metadata.';
  end if;

  v_created_at_text := v_receipt ->> 'createdAt';
  if v_created_at_text is null or v_created_at_text !~
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  then
    raise exception 'Public blinding receipt creation timestamp is invalid.';
  end if;

  begin
    v_transformation_id := (v_receipt ->> 'transformationId')::uuid;
    v_created_at := v_created_at_text::timestamptz;
    -- Use numeric before integer to prevent silently accepting decimals.
    if (v_receipt ->> 'rowCount')::numeric <> pg_catalog.trunc((v_receipt ->> 'rowCount')::numeric)
      or (v_receipt ->> 'columnCount')::numeric <> pg_catalog.trunc((v_receipt ->> 'columnCount')::numeric)
    then
      raise exception 'Row and column counts must be whole numbers.';
    end if;
    v_row_count := (v_receipt ->> 'rowCount')::integer;
    v_column_count := (v_receipt ->> 'columnCount')::integer;
  exception when others then
    raise exception 'Public blinding receipt contains invalid transformation metadata.';
  end;
  if v_row_count < 1 or v_column_count < 1 then
    raise exception 'Public blinding receipt requires at least one row and one column.';
  end if;

  v_selected := v_receipt -> 'selectedColumns';
  if pg_catalog.jsonb_typeof(v_selected) is distinct from 'array' then
    raise exception 'Selected columns must be an array.';
  end if;
  v_selected_count := pg_catalog.jsonb_array_length(v_selected);
  if v_selected_count < 1 or v_selected_count > v_column_count then
    raise exception 'Selected column count is invalid.';
  end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(v_selected) loop
    if pg_catalog.jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'Each selected column must be an object.';
    end if;
    select count(*) into v_key_count from pg_catalog.jsonb_object_keys(v_item);
    if v_key_count <> 2 or not (v_item ?& array['column', 'categoryCount'])
      or pg_catalog.jsonb_typeof(v_item -> 'column') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_item -> 'categoryCount') is distinct from 'number'
    then
      raise exception 'Selected column metadata has unexpected structure.';
    end if;
    v_column := v_item ->> 'column';
    if v_column is null or btrim(v_column) = '' or v_column = any(v_names) then
      raise exception 'Selected column names must be nonblank and unique.';
    end if;
    v_names := pg_catalog.array_append(v_names, v_column);
    begin
      v_categories_numeric := (v_item ->> 'categoryCount')::numeric;
    exception when others then
      raise exception 'Selected category count is invalid.';
    end;
    if v_categories_numeric <> pg_catalog.trunc(v_categories_numeric)
      or v_categories_numeric < 2 or v_categories_numeric > v_row_count
    then
      raise exception 'Selected category count must be an integer between 2 and row count.';
    end if;
  end loop;

  if pg_catalog.jsonb_typeof(v_receipt -> 'sourceArtifact') is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_receipt -> 'blindedArtifact') is distinct from 'object'
  then
    raise exception 'Blinding artifact identities are invalid.';
  end if;
  select count(*) into v_key_count
    from pg_catalog.jsonb_object_keys(v_receipt -> 'sourceArtifact');
  if v_key_count <> 1 or not ((v_receipt -> 'sourceArtifact') ? 'sha256')
    or pg_catalog.jsonb_typeof(v_receipt #> '{sourceArtifact,sha256}') is distinct from 'string'
  then
    raise exception 'Source artifact identity has unexpected structure.';
  end if;
  select count(*) into v_key_count
    from pg_catalog.jsonb_object_keys(v_receipt -> 'blindedArtifact');
  if v_key_count <> 1 or not ((v_receipt -> 'blindedArtifact') ? 'sha256')
    or pg_catalog.jsonb_typeof(v_receipt #> '{blindedArtifact,sha256}') is distinct from 'string'
  then
    raise exception 'Blinded artifact identity has unexpected structure.';
  end if;
  v_source_sha256 := v_receipt #>> '{sourceArtifact,sha256}';
  v_blinded_sha256 := v_receipt #>> '{blindedArtifact,sha256}';
  if v_source_sha256 is null or v_source_sha256 !~ '^[0-9a-f]{64}$'
    or v_blinded_sha256 is null or v_blinded_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Blinding artifact hashes are invalid.';
  end if;

  v_sealed := v_receipt -> 'sealedMapping';
  if pg_catalog.jsonb_typeof(v_sealed) is distinct from 'object' then
    raise exception 'Public blinding receipt sealed mapping is invalid.';
  end if;
  select count(*) into v_key_count from pg_catalog.jsonb_object_keys(v_sealed);
  if v_key_count <> 7 or not (v_sealed ?& array[
    'algorithm', 'keyLength', 'tagLength', 'encoding', 'aadScheme',
    'ivHex', 'ciphertextHex'
  ]) or pg_catalog.jsonb_typeof(v_sealed -> 'algorithm') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_sealed -> 'keyLength') is distinct from 'number'
    or pg_catalog.jsonb_typeof(v_sealed -> 'tagLength') is distinct from 'number'
    or pg_catalog.jsonb_typeof(v_sealed -> 'encoding') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_sealed -> 'aadScheme') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_sealed -> 'ivHex') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_sealed -> 'ciphertextHex') is distinct from 'string'
  then
    raise exception 'Public blinding receipt sealed mapping has unexpected structure.';
  end if;
  if (v_sealed ->> 'algorithm') <> 'AES-GCM'
    or (v_sealed ->> 'keyLength') <> '256'
    or (v_sealed ->> 'tagLength') <> '128'
    or (v_sealed ->> 'encoding') <> 'hex'
    or (v_sealed ->> 'aadScheme') <> 'blindstats_blinding_mapping_aad_v2'
    or (v_sealed ->> 'ivHex') !~ '^[0-9a-f]{24}$'
    or (v_sealed ->> 'ciphertextHex') !~ '^[0-9a-f]{32,}$'
    or mod(char_length(v_sealed ->> 'ciphertextHex'), 2) <> 0
  then
    raise exception 'Public blinding receipt sealed-mapping parameters are invalid.';
  end if;

  v_algorithm := v_receipt -> 'algorithm';
  if pg_catalog.jsonb_typeof(v_algorithm) is distinct from 'object' then
    raise exception 'Public blinding receipt algorithm metadata is invalid.';
  end if;
  select count(*) into v_key_count from pg_catalog.jsonb_object_keys(v_algorithm);
  if v_key_count <> 2 or not (v_algorithm ?& array['neutralLabelScheme', 'mappingAssignment'])
    or pg_catalog.jsonb_typeof(v_algorithm -> 'neutralLabelScheme') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_algorithm -> 'mappingAssignment') is distinct from 'string'
    or (v_algorithm ->> 'neutralLabelScheme') <> 'Group_<letters>'
    or (v_algorithm ->> 'mappingAssignment') <> 'web_crypto_random_permutation'
  then
    raise exception 'Public blinding receipt algorithm metadata is invalid.';
  end if;

  insert into public.blinding_transformations (
    workflow_id, study_id, plan_version_id, transformation_id,
    schema_version, transformation_type, receipt_created_at,
    selected_column, category_count, selected_columns, row_count, column_count,
    source_artifact_sha256, blinded_artifact_sha256, public_receipt_sha256,
    public_receipt_text, registered_by
  ) values (
    p_workflow_id, v_study_id, v_active_plan_version_id, v_transformation_id,
    '0.4', 'categorical_label_permutation', v_created_at,
    null, null, v_selected, v_row_count, v_column_count,
    v_source_sha256, v_blinded_sha256, v_receipt_sha256,
    p_public_receipt_text, v_user_id
  ) returning id into v_record_id;

  update public.blinding_workflows
  set state = 'blinded'
  where id = p_workflow_id and study_id = v_study_id and state = 'setup';
  if not found then
    raise exception 'Blinding workflow could not be transitioned to blinded.';
  end if;
  return v_record_id;
end;
$$;

create or replace function public.register_multi_unblinding_completion(
  p_workflow_id uuid,
  p_request_id uuid,
  p_unblinding_id uuid,
  p_receipt_created_at timestamptz,
  p_transformation_id uuid,
  p_lock_id uuid,
  p_selected_columns jsonb,
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
  v_selected_columns jsonb;
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
  where completion.workflow_id = p_workflow_id;

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
    transformation.selected_columns,
    transformation.source_artifact_sha256,
    transformation.blinded_artifact_sha256,
    transformation.public_receipt_sha256
  into
    v_transformation_id,
    v_transformation_plan_version_id,
    v_selected_columns,
    v_source_artifact_sha256,
    v_blinded_artifact_sha256,
    v_public_receipt_sha256
  from public.blinding_transformations as transformation
  where transformation.id = v_transformation_record_id
    and transformation.workflow_id = p_workflow_id
    and transformation.study_id = v_study_id
    and transformation.schema_version = '0.4';

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
      and lock.study_id = v_study_id;

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

  if p_selected_columns is distinct from v_selected_columns then
    raise exception
      'Unblinding receipt selected column does not match the registered transformation.';
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

  if p_selected_columns is null
    or pg_catalog.jsonb_typeof(p_selected_columns) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_selected_columns) < 1
  then
    raise exception 'Selected column metadata must contain at least one column.';
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
    selected_columns,
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
    '0.4',
    p_receipt_created_at,
    v_selected_columns,
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

comment on function public.register_multi_blinding_transformation(uuid, text) is
  'Registers canonical v0.4 blinding receipts with one or more selected categorical columns; historical v0.3 RPC remains intact.';

-- Do not touch existing public.register_blinding_transformation,
-- public.register_analysis_lock or public.register_unblinding_completion.
commit;
