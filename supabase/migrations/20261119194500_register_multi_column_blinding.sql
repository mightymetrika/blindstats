-- Add an opt-in 0.4 registration path for multiple categorical columns.
-- Preserve the original 0.3 RPC and its registered receipts unchanged.
-- A separate security-definer RPC is used so old clients retain old semantics.
-- No source CSV, blinded CSV, plaintext mapping, or secret is stored.

begin;

alter table public.blinding_transformations
  add column selected_columns jsonb,
  alter column selected_column drop not null,
  alter column category_count drop not null;

alter table public.blinding_transformations
  drop constraint blinding_transformations_schema_version_valid,
  drop constraint blinding_transformations_selected_column_nonblank;

alter table public.blinding_transformations
  add constraint blinding_transformations_schema_version_valid
    check (schema_version in ('0.3', '0.4')),
  add constraint blinding_transformations_selection_by_version
    check (
      (
        schema_version = '0.3'
        and selected_column is not null
        and btrim(selected_column) <> ''
        and category_count is not null
        and selected_columns is null
      )
      or
      (
        schema_version = '0.4'
        and selected_column is null
        and category_count is null
        and selected_columns is not null
        and case
          when pg_catalog.jsonb_typeof(selected_columns) = 'array'
          then pg_catalog.jsonb_array_length(selected_columns) between 2 and column_count
          else false
        end
      )
    );

comment on column public.blinding_transformations.selected_columns is
  'Nonsecret [{column, categoryCount}] selection metadata for multi-variable schema 0.4. NULL for historical 0.3.';

-- The original public.register_blinding_transformation(uuid, text) remains
-- unchanged, including its 0.3-only parser, permissions, and workflow rules.
create function public.register_multi_blinding_transformation(
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
  if v_row_count < 1 or v_column_count < 2 then
    raise exception 'Public blinding receipt requires rows and at least two columns.';
  end if;

  v_selected := v_receipt -> 'selectedColumns';
  if pg_catalog.jsonb_typeof(v_selected) is distinct from 'array' then
    raise exception 'Selected columns must be an array.';
  end if;
  v_selected_count := pg_catalog.jsonb_array_length(v_selected);
  if v_selected_count < 2 or v_selected_count > v_column_count then
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

revoke all on function public.register_multi_blinding_transformation(uuid, text)
  from public;
grant execute on function public.register_multi_blinding_transformation(uuid, text)
  to authenticated;

comment on function public.register_multi_blinding_transformation(uuid, text) is
  'Register schema 0.4 multi-variable blinded packages only, with strict metadata validation and unchanged capability/state/plan requirements. Plaintext data and unblinding secrets are never accepted.';

commit;
