-- Register a successfully created browser-local blinded package without storing
-- the source dataset, blinded dataset, unblinding secret, or plaintext mapping.
--
-- Registration preserves the exact public blinding receipt and safe artifact
-- metadata, binds the transformation to the active immutable BlindingPlan
-- version, and atomically moves the workflow from setup to blinded.
--
-- The public receipt contains the encrypted/sealed mapping, not the plaintext
-- mapping. The unblinding secret remains outside server custody.

begin;


create table public.blinding_transformations (
  id uuid primary key default gen_random_uuid(),

  workflow_id uuid not null,
  study_id uuid not null,
  plan_version_id uuid not null,

  transformation_id uuid not null,
  schema_version text not null,
  transformation_type text not null,
  receipt_created_at timestamptz not null,

  selected_column text not null,
  category_count integer not null,
  row_count integer not null,
  column_count integer not null,

  source_artifact_sha256 text not null,
  blinded_artifact_sha256 text not null,

  public_receipt_sha256 text not null,
  public_receipt_text text not null,

  registered_by uuid not null
    references auth.users(id) on delete restrict,
  registered_at timestamptz not null default now(),

  constraint blinding_transformations_workflow_study_fk
    foreign key (workflow_id, study_id)
    references public.blinding_workflows(id, study_id)
    on delete cascade,

  constraint blinding_transformations_plan_workflow_fk
    foreign key (plan_version_id, workflow_id)
    references public.blinding_plan_versions(id, workflow_id)
    on delete restrict,

  constraint blinding_transformations_workflow_unique
    unique (workflow_id),

  constraint blinding_transformations_transformation_id_unique
    unique (transformation_id),

  constraint blinding_transformations_id_workflow_unique
    unique (id, workflow_id),

  constraint blinding_transformations_schema_version_valid
    check (schema_version = '0.3'),

  constraint blinding_transformations_type_valid
    check (
      transformation_type = 'categorical_label_permutation'
    ),

  constraint blinding_transformations_selected_column_nonblank
    check (btrim(selected_column) <> ''),

  constraint blinding_transformations_category_count_valid
    check (category_count >= 2),

  constraint blinding_transformations_row_count_valid
    check (row_count >= 1),

  constraint blinding_transformations_column_count_valid
    check (column_count >= 1),

  constraint blinding_transformations_category_count_within_rows
    check (category_count <= row_count),

  constraint blinding_transformations_source_sha256_format
    check (
      source_artifact_sha256 ~ '^[0-9a-f]{64}$'
    ),

  constraint blinding_transformations_blinded_sha256_format
    check (
      blinded_artifact_sha256 ~ '^[0-9a-f]{64}$'
    ),

  constraint blinding_transformations_public_receipt_sha256_format
    check (
      public_receipt_sha256 ~ '^[0-9a-f]{64}$'
    ),

  constraint blinding_transformations_public_receipt_nonblank
    check (char_length(public_receipt_text) > 0)
);


create index blinding_transformations_study_registered_idx
  on public.blinding_transformations(study_id, registered_at desc);

create index blinding_transformations_plan_version_idx
  on public.blinding_transformations(plan_version_id);


alter table public.blinding_transformations enable row level security;


create policy blinding_transformations_select_for_members
on public.blinding_transformations
for select
to authenticated
using (
  public.is_study_member(study_id)
);


revoke all on table public.blinding_transformations
  from anon, authenticated;

grant select on table public.blinding_transformations
  to authenticated;


-- Registration is deliberately performed through one controlled database
-- function rather than ordinary client INSERT / UPDATE permissions.
--
-- The function:
--   1. authenticates the caller;
--   2. locks the workflow row;
--   3. requires blinding.create capability;
--   4. requires workflow state = setup;
--   5. requires an active immutable BlindingPlan version;
--   6. validates the supported schema-0.3 public receipt structure;
--   7. computes SHA-256 from the exact UTF-8 receipt text server-side;
--   8. records the exact public receipt and safe transformation metadata;
--   9. binds the transformation to the active plan version; and
--  10. atomically moves the workflow to blinded.

create or replace function public.register_blinding_transformation(
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
  v_key_count integer;

  v_transformation_id uuid;
  v_schema_version text;
  v_transformation_type text;
  v_receipt_created_at_text text;
  v_receipt_created_at timestamptz;

  v_selected_column text;
  v_category_count integer;
  v_row_count integer;
  v_column_count integer;

  v_source_artifact_sha256 text;
  v_blinded_artifact_sha256 text;
  v_public_receipt_sha256 text;

  v_sealed_mapping jsonb;
  v_algorithm jsonb;

  v_transformation_record_id uuid;
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
    'blinding.create'
  ) then
    raise exception using
      errcode = '42501',
      message = 'You are not authorized to create or register a blinded package.';
  end if;


  if v_state <> 'setup' then
    raise exception
      'Blinded-package registration requires workflow state setup.';
  end if;


  if v_active_plan_version_id is null then
    raise exception
      'An active BlindingPlan version is required before blinding.';
  end if;


  if not exists (
    select 1
    from public.blinding_plan_versions as plan
    where plan.id = v_active_plan_version_id
      and plan.workflow_id = p_workflow_id
      and plan.study_id = v_study_id
  ) then
    raise exception
      'The active BlindingPlan version could not be verified.';
  end if;


  if p_public_receipt_text is null
    or char_length(p_public_receipt_text) = 0
  then
    raise exception
      'Public blinding receipt cannot be empty.';
  end if;


  -- Compute the exact receipt identity from the exact UTF-8 text received by
  -- the server. Do not trust a caller-supplied digest for this durable record.

  v_public_receipt_sha256 :=
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          p_public_receipt_text,
          'UTF8'
        )
      ),
      'hex'
    );


  begin
    v_receipt := p_public_receipt_text::jsonb;
  exception
    when others then
      raise exception
        'Public blinding receipt must contain valid JSON.';
  end;


  if pg_catalog.jsonb_typeof(v_receipt) <> 'object' then
    raise exception
      'Public blinding receipt must contain a JSON object.';
  end if;


  -- Require the exact supported top-level schema. This also rejects accidental
  -- registration of receipts containing plaintext mapping or secret fields.

  select count(*)
  into v_key_count
  from pg_catalog.jsonb_object_keys(v_receipt);

  if v_key_count <> 12
    or not (
      v_receipt ?& array[
        'schemaVersion',
        'transformationId',
        'createdAt',
        'transformationType',
        'selectedColumn',
        'categoryCount',
        'rowCount',
        'columnCount',
        'sourceArtifact',
        'blindedArtifact',
        'sealedMapping',
        'algorithm'
      ]
    )
  then
    raise exception
      'Public blinding receipt has unexpected structure.';
  end if;


  if pg_catalog.jsonb_typeof(v_receipt -> 'schemaVersion') <> 'string'
    or pg_catalog.jsonb_typeof(v_receipt -> 'transformationId') <> 'string'
    or pg_catalog.jsonb_typeof(v_receipt -> 'createdAt') <> 'string'
    or pg_catalog.jsonb_typeof(v_receipt -> 'transformationType') <> 'string'
    or pg_catalog.jsonb_typeof(v_receipt -> 'selectedColumn') <> 'string'
    or pg_catalog.jsonb_typeof(v_receipt -> 'categoryCount') <> 'number'
    or pg_catalog.jsonb_typeof(v_receipt -> 'rowCount') <> 'number'
    or pg_catalog.jsonb_typeof(v_receipt -> 'columnCount') <> 'number'
  then
    raise exception
      'Public blinding receipt contains invalid field types.';
  end if;


  if pg_catalog.jsonb_typeof(
    v_receipt -> 'sourceArtifact'
  ) <> 'object'
  then
    raise exception
      'Public blinding receipt source artifact is invalid.';
  end if;

  select count(*)
  into v_key_count
  from pg_catalog.jsonb_object_keys(
    v_receipt -> 'sourceArtifact'
  );

  if v_key_count <> 1
    or not (
      (v_receipt -> 'sourceArtifact') ? 'sha256'
    )
    or pg_catalog.jsonb_typeof(
      v_receipt #> '{sourceArtifact,sha256}'
    ) <> 'string'
  then
    raise exception
      'Public blinding receipt source artifact has unexpected structure.';
  end if;


  if pg_catalog.jsonb_typeof(
    v_receipt -> 'blindedArtifact'
  ) <> 'object'
  then
    raise exception
      'Public blinding receipt blinded artifact is invalid.';
  end if;

  select count(*)
  into v_key_count
  from pg_catalog.jsonb_object_keys(
    v_receipt -> 'blindedArtifact'
  );

  if v_key_count <> 1
    or not (
      (v_receipt -> 'blindedArtifact') ? 'sha256'
    )
    or pg_catalog.jsonb_typeof(
      v_receipt #> '{blindedArtifact,sha256}'
    ) <> 'string'
  then
    raise exception
      'Public blinding receipt blinded artifact has unexpected structure.';
  end if;


  v_sealed_mapping := v_receipt -> 'sealedMapping';

  if pg_catalog.jsonb_typeof(v_sealed_mapping) <> 'object' then
    raise exception
      'Public blinding receipt sealed mapping is invalid.';
  end if;

  select count(*)
  into v_key_count
  from pg_catalog.jsonb_object_keys(v_sealed_mapping);

  if v_key_count <> 7
    or not (
      v_sealed_mapping ?& array[
        'algorithm',
        'keyLength',
        'tagLength',
        'encoding',
        'aadScheme',
        'ivHex',
        'ciphertextHex'
      ]
    )
    or pg_catalog.jsonb_typeof(v_sealed_mapping -> 'algorithm') <> 'string'
    or pg_catalog.jsonb_typeof(v_sealed_mapping -> 'keyLength') <> 'number'
    or pg_catalog.jsonb_typeof(v_sealed_mapping -> 'tagLength') <> 'number'
    or pg_catalog.jsonb_typeof(v_sealed_mapping -> 'encoding') <> 'string'
    or pg_catalog.jsonb_typeof(v_sealed_mapping -> 'aadScheme') <> 'string'
    or pg_catalog.jsonb_typeof(v_sealed_mapping -> 'ivHex') <> 'string'
    or pg_catalog.jsonb_typeof(v_sealed_mapping -> 'ciphertextHex') <> 'string'
  then
    raise exception
      'Public blinding receipt sealed mapping has unexpected structure.';
  end if;


  v_algorithm := v_receipt -> 'algorithm';

  if pg_catalog.jsonb_typeof(v_algorithm) <> 'object' then
    raise exception
      'Public blinding receipt algorithm metadata is invalid.';
  end if;

  select count(*)
  into v_key_count
  from pg_catalog.jsonb_object_keys(v_algorithm);

  if v_key_count <> 2
    or not (
      v_algorithm ?& array[
        'neutralLabelScheme',
        'mappingAssignment'
      ]
    )
    or pg_catalog.jsonb_typeof(
      v_algorithm -> 'neutralLabelScheme'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      v_algorithm -> 'mappingAssignment'
    ) <> 'string'
  then
    raise exception
      'Public blinding receipt algorithm metadata has unexpected structure.';
  end if;


  v_schema_version :=
    v_receipt ->> 'schemaVersion';

  v_transformation_type :=
    v_receipt ->> 'transformationType';

  v_receipt_created_at_text :=
    v_receipt ->> 'createdAt';

  v_selected_column :=
    v_receipt ->> 'selectedColumn';

  v_source_artifact_sha256 :=
    v_receipt #>> '{sourceArtifact,sha256}';

  v_blinded_artifact_sha256 :=
    v_receipt #>> '{blindedArtifact,sha256}';


  if v_schema_version is distinct from '0.3' then
    raise exception
      'Unsupported public blinding receipt schema version.';
  end if;


  if v_transformation_type is distinct from
    'categorical_label_permutation'
  then
    raise exception
      'Unsupported blinding transformation type.';
  end if;


  if v_selected_column is null
    or btrim(v_selected_column) = ''
  then
    raise exception
      'Selected blinding column cannot be blank.';
  end if;


  if v_receipt_created_at_text is null
    or v_receipt_created_at_text !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  then
    raise exception
      'Public blinding receipt creation timestamp is invalid.';
  end if;


  begin
    v_transformation_id :=
      (v_receipt ->> 'transformationId')::uuid;

    v_receipt_created_at :=
      v_receipt_created_at_text::timestamptz;

    v_category_count :=
      (v_receipt ->> 'categoryCount')::integer;

    v_row_count :=
      (v_receipt ->> 'rowCount')::integer;

    v_column_count :=
      (v_receipt ->> 'columnCount')::integer;
  exception
    when others then
      raise exception
        'Public blinding receipt contains invalid transformation metadata.';
  end;


  if v_category_count < 2 then
    raise exception
      'Public blinding receipt category count must be at least 2.';
  end if;


  if v_row_count < 1 then
    raise exception
      'Public blinding receipt row count must be at least 1.';
  end if;


  if v_column_count < 1 then
    raise exception
      'Public blinding receipt column count must be at least 1.';
  end if;


  if v_category_count > v_row_count then
    raise exception
      'Public blinding receipt category count cannot exceed row count.';
  end if;


  if v_source_artifact_sha256 is null
    or v_source_artifact_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception
      'Public blinding receipt source artifact SHA-256 is invalid.';
  end if;


  if v_blinded_artifact_sha256 is null
    or v_blinded_artifact_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception
      'Public blinding receipt blinded artifact SHA-256 is invalid.';
  end if;


  begin
    if (v_sealed_mapping ->> 'algorithm')
        is distinct from 'AES-GCM'
      or ((v_sealed_mapping ->> 'keyLength')::integer)
        is distinct from 256
      or ((v_sealed_mapping ->> 'tagLength')::integer)
        is distinct from 128
      or (v_sealed_mapping ->> 'encoding')
        is distinct from 'hex'
      or (v_sealed_mapping ->> 'aadScheme')
        is distinct from 'blindstats_blinding_mapping_aad_v1'
    then
      raise exception
        'Public blinding receipt sealed-mapping parameters are invalid.';
    end if;
  exception
    when invalid_text_representation
      or numeric_value_out_of_range
    then
      raise exception
        'Public blinding receipt sealed-mapping parameters are invalid.';
  end;


  if (v_sealed_mapping ->> 'ivHex')
      !~ '^[0-9a-f]{24}$'
  then
    raise exception
      'Public blinding receipt sealed-mapping IV is invalid.';
  end if;


  if char_length(
      v_sealed_mapping ->> 'ciphertextHex'
    ) < 32
    or (v_sealed_mapping ->> 'ciphertextHex')
      !~ '^[0-9a-f]+$'
    or mod(
      char_length(v_sealed_mapping ->> 'ciphertextHex'),
      2
    ) <> 0
  then
    raise exception
      'Public blinding receipt sealed-mapping ciphertext is invalid.';
  end if;


  if (v_algorithm ->> 'neutralLabelScheme')
      is distinct from 'Group_<letters>'
    or (v_algorithm ->> 'mappingAssignment')
      is distinct from 'web_crypto_random_permutation'
  then
    raise exception
      'Public blinding receipt algorithm metadata is unsupported.';
  end if;


  insert into public.blinding_transformations (
    workflow_id,
    study_id,
    plan_version_id,
    transformation_id,
    schema_version,
    transformation_type,
    receipt_created_at,
    selected_column,
    category_count,
    row_count,
    column_count,
    source_artifact_sha256,
    blinded_artifact_sha256,
    public_receipt_sha256,
    public_receipt_text,
    registered_by
  )
  values (
    p_workflow_id,
    v_study_id,
    v_active_plan_version_id,
    v_transformation_id,
    v_schema_version,
    v_transformation_type,
    v_receipt_created_at,
    v_selected_column,
    v_category_count,
    v_row_count,
    v_column_count,
    v_source_artifact_sha256,
    v_blinded_artifact_sha256,
    v_public_receipt_sha256,
    p_public_receipt_text,
    v_user_id
  )
  returning id
  into v_transformation_record_id;


  update public.blinding_workflows
  set state = 'blinded'
  where id = p_workflow_id
    and study_id = v_study_id
    and state = 'setup';

  if not found then
    raise exception
      'Blinding workflow could not be transitioned to blinded.';
  end if;


  return v_transformation_record_id;
end;
$$;


revoke all on function public.register_blinding_transformation(
  uuid,
  text
)
  from public;

grant execute on function public.register_blinding_transformation(
  uuid,
  text
)
  to authenticated;


comment on table public.blinding_transformations is
  'Immutable server registration of a browser-local blinding transformation. Stores the exact public receipt and safe artifact metadata, but not source/blinded dataset contents, the unblinding secret, or the plaintext mapping.';

comment on column public.blinding_transformations.plan_version_id is
  'Immutable BlindingPlan version active when this transformation was registered.';

comment on column public.blinding_transformations.receipt_created_at is
  'Browser-generated timestamp contained in the public receipt. This is not an independently trusted timestamp.';

comment on column public.blinding_transformations.registered_at is
  'Trusted server timestamp for successful transformation registration.';

comment on column public.blinding_transformations.public_receipt_text is
  'Exact public blinding receipt text registered by blindstats. Stored as text so later artifact identity is not changed by JSON normalization.';

comment on column public.blinding_transformations.public_receipt_sha256 is
  'Server-computed SHA-256 of the exact UTF-8 public-receipt text registered by blindstats.';


commit;
