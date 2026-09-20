-- Register browser-local analysis-lock receipts without storing the analysis
-- artifact itself.
--
-- AnalysisLock remains an event/artifact, not a universal workflow state.
-- Multiple lock records may exist for one blinded workflow.
--
-- The exact schema-0.3 lock receipt is preserved as text, hashed server-side,
-- and checked against the already registered blinding transformation.

begin;

create table public.analysis_locks (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null,
  study_id uuid not null,
  transformation_record_id uuid not null,
  plan_version_id uuid not null,
  lock_id uuid not null,
  schema_version text not null,
  receipt_created_at timestamptz not null,
  blinding_receipt_sha256 text not null,
  blinded_artifact_sha256 text not null,
  analysis_artifact_filename text not null,
  analysis_artifact_sha256 text not null,
  analysis_artifact_byte_length bigint not null,
  analysis_lock_receipt_sha256 text not null,
  analysis_lock_receipt_text text not null,
  registered_by uuid not null references auth.users(id) on delete restrict,
  registered_at timestamptz not null default now(),

  constraint analysis_locks_workflow_study_fk
    foreign key (workflow_id, study_id)
    references public.blinding_workflows(id, study_id)
    on delete cascade,

  constraint analysis_locks_transformation_workflow_fk
    foreign key (transformation_record_id, workflow_id)
    references public.blinding_transformations(id, workflow_id)
    on delete restrict,

  constraint analysis_locks_plan_workflow_fk
    foreign key (plan_version_id, workflow_id)
    references public.blinding_plan_versions(id, workflow_id)
    on delete restrict,

  constraint analysis_locks_lock_id_unique unique (lock_id),
  constraint analysis_locks_id_workflow_unique unique (id, workflow_id),
  constraint analysis_locks_schema_version_valid check (schema_version = '0.3'),
  constraint analysis_locks_blinding_receipt_sha256_format
    check (blinding_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  constraint analysis_locks_blinded_artifact_sha256_format
    check (blinded_artifact_sha256 ~ '^[0-9a-f]{64}$'),
  constraint analysis_locks_analysis_artifact_filename_nonblank
    check (btrim(analysis_artifact_filename) <> ''),
  constraint analysis_locks_analysis_artifact_sha256_format
    check (analysis_artifact_sha256 ~ '^[0-9a-f]{64}$'),
  constraint analysis_locks_analysis_artifact_byte_length_valid
    check (analysis_artifact_byte_length >= 1),
  constraint analysis_locks_receipt_sha256_format
    check (analysis_lock_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  constraint analysis_locks_receipt_nonblank
    check (char_length(analysis_lock_receipt_text) > 0)
);

create index analysis_locks_workflow_registered_idx
  on public.analysis_locks(workflow_id, registered_at desc);

create index analysis_locks_study_registered_idx
  on public.analysis_locks(study_id, registered_at desc);

create index analysis_locks_transformation_idx
  on public.analysis_locks(transformation_record_id);

alter table public.analysis_locks enable row level security;

create policy analysis_locks_select_for_members
on public.analysis_locks
for select
to authenticated
using (public.is_study_member(study_id));

revoke all on table public.analysis_locks from anon, authenticated;
grant select on table public.analysis_locks to authenticated;

create or replace function public.register_analysis_lock(
  p_workflow_id uuid,
  p_analysis_lock_receipt_text text
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

  v_transformation_record_id uuid;
  v_transformation_plan_version_id uuid;
  v_registered_transformation_id uuid;
  v_registered_public_receipt_sha256 text;
  v_registered_blinded_artifact_sha256 text;

  v_receipt jsonb;
  v_key_count integer;

  v_schema_version text;
  v_receipt_type text;
  v_lock_id uuid;
  v_receipt_created_at_text text;
  v_receipt_created_at timestamptz;

  v_receipt_transformation_id uuid;
  v_blinding_receipt_sha256 text;
  v_blinded_artifact_sha256 text;

  v_analysis_artifact_filename text;
  v_analysis_artifact_sha256 text;
  v_analysis_artifact_byte_length_text text;
  v_analysis_artifact_byte_length bigint;

  v_analysis_lock_receipt_sha256 text;
  v_lock_record_id uuid;

  v_existing_lock_record_id uuid;
  v_existing_workflow_id uuid;
  v_existing_receipt_sha256 text;
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

  if not public.has_study_capability(v_study_id, 'analysis.lock') then
    raise exception using
      errcode = '42501',
      message = 'You are not authorized to register an analysis lock.';
  end if;

  if v_state <> 'blinded' then
    raise exception
      'Analysis-lock registration requires workflow state blinded.';
  end if;

  if v_active_plan_version_id is null then
    raise exception
      'The active BlindingPlan version could not be verified.';
  end if;

  select
    transformation.id,
    transformation.plan_version_id,
    transformation.transformation_id,
    transformation.public_receipt_sha256,
    transformation.blinded_artifact_sha256
  into
    v_transformation_record_id,
    v_transformation_plan_version_id,
    v_registered_transformation_id,
    v_registered_public_receipt_sha256,
    v_registered_blinded_artifact_sha256
  from public.blinding_transformations as transformation
  where transformation.workflow_id = p_workflow_id
    and transformation.study_id = v_study_id;

  if not found then
    raise exception 'Registered blinding transformation not found.';
  end if;

  if v_transformation_plan_version_id
      is distinct from v_active_plan_version_id
  then
    raise exception
      'Registered blinding transformation is not bound to the active BlindingPlan.';
  end if;

  if p_analysis_lock_receipt_text is null
    or char_length(p_analysis_lock_receipt_text) = 0
  then
    raise exception 'Analysis-lock receipt cannot be empty.';
  end if;

  v_analysis_lock_receipt_sha256 :=
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(p_analysis_lock_receipt_text, 'UTF8')
      ),
      'hex'
    );

  begin
    v_receipt := p_analysis_lock_receipt_text::jsonb;
  exception
    when others then
      raise exception 'Analysis-lock receipt must contain valid JSON.';
  end;

  if pg_catalog.jsonb_typeof(v_receipt) <> 'object' then
    raise exception 'Analysis-lock receipt must contain a JSON object.';
  end if;

  select count(*)
  into v_key_count
  from pg_catalog.jsonb_object_keys(v_receipt);

  if v_key_count <> 6
    or not (
      v_receipt ?& array[
        'schemaVersion',
        'receiptType',
        'lockId',
        'createdAt',
        'blinding',
        'analysisArtifact'
      ]
    )
  then
    raise exception 'Analysis-lock receipt has unexpected structure.';
  end if;

  if pg_catalog.jsonb_typeof(v_receipt -> 'schemaVersion') <> 'string'
    or pg_catalog.jsonb_typeof(v_receipt -> 'receiptType') <> 'string'
    or pg_catalog.jsonb_typeof(v_receipt -> 'lockId') <> 'string'
    or pg_catalog.jsonb_typeof(v_receipt -> 'createdAt') <> 'string'
  then
    raise exception 'Analysis-lock receipt contains invalid field types.';
  end if;

  if pg_catalog.jsonb_typeof(v_receipt -> 'blinding') <> 'object' then
    raise exception 'Analysis-lock blinding reference is invalid.';
  end if;

  select count(*)
  into v_key_count
  from pg_catalog.jsonb_object_keys(v_receipt -> 'blinding');

  if v_key_count <> 3
    or not (
      (v_receipt -> 'blinding') ?& array[
        'transformationId',
        'blindingReceiptSha256',
        'blindedArtifactSha256'
      ]
    )
    or pg_catalog.jsonb_typeof(
      v_receipt #> '{blinding,transformationId}'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      v_receipt #> '{blinding,blindingReceiptSha256}'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      v_receipt #> '{blinding,blindedArtifactSha256}'
    ) <> 'string'
  then
    raise exception 'Analysis-lock blinding reference has unexpected structure.';
  end if;

  if pg_catalog.jsonb_typeof(v_receipt -> 'analysisArtifact') <> 'object' then
    raise exception 'Analysis-lock analysis artifact is invalid.';
  end if;

  select count(*)
  into v_key_count
  from pg_catalog.jsonb_object_keys(v_receipt -> 'analysisArtifact');

  if v_key_count <> 3
    or not (
      (v_receipt -> 'analysisArtifact') ?& array[
        'filename',
        'sha256',
        'byteLength'
      ]
    )
    or pg_catalog.jsonb_typeof(
      v_receipt #> '{analysisArtifact,filename}'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      v_receipt #> '{analysisArtifact,sha256}'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      v_receipt #> '{analysisArtifact,byteLength}'
    ) <> 'number'
  then
    raise exception 'Analysis-lock analysis artifact has unexpected structure.';
  end if;

  v_schema_version := v_receipt ->> 'schemaVersion';
  v_receipt_type := v_receipt ->> 'receiptType';
  v_receipt_created_at_text := v_receipt ->> 'createdAt';
  v_blinding_receipt_sha256 :=
    v_receipt #>> '{blinding,blindingReceiptSha256}';
  v_blinded_artifact_sha256 :=
    v_receipt #>> '{blinding,blindedArtifactSha256}';
  v_analysis_artifact_filename :=
    v_receipt #>> '{analysisArtifact,filename}';
  v_analysis_artifact_sha256 :=
    v_receipt #>> '{analysisArtifact,sha256}';
  v_analysis_artifact_byte_length_text :=
    v_receipt #>> '{analysisArtifact,byteLength}';

  if v_schema_version is distinct from '0.3' then
    raise exception 'Unsupported analysis-lock receipt schema version.';
  end if;

  if v_receipt_type is distinct from 'analysis_lock' then
    raise exception 'Unsupported analysis-lock receipt type.';
  end if;

  if v_receipt_created_at_text is null
    or v_receipt_created_at_text !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  then
    raise exception 'Analysis-lock receipt creation timestamp is invalid.';
  end if;

  if v_analysis_artifact_filename is null
    or btrim(v_analysis_artifact_filename) = ''
  then
    raise exception 'Analysis artifact filename cannot be blank.';
  end if;

  if v_blinding_receipt_sha256 is null
    or v_blinding_receipt_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Analysis-lock blinding receipt SHA-256 is invalid.';
  end if;

  if v_blinded_artifact_sha256 is null
    or v_blinded_artifact_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Analysis-lock blinded artifact SHA-256 is invalid.';
  end if;

  if v_analysis_artifact_sha256 is null
    or v_analysis_artifact_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Analysis artifact SHA-256 is invalid.';
  end if;

  if v_analysis_artifact_byte_length_text is null
    or v_analysis_artifact_byte_length_text !~ '^[0-9]+$'
  then
    raise exception 'Analysis artifact byte length is invalid.';
  end if;

  begin
    v_lock_id := (v_receipt ->> 'lockId')::uuid;
    v_receipt_created_at := v_receipt_created_at_text::timestamptz;
    v_receipt_transformation_id :=
      (v_receipt #>> '{blinding,transformationId}')::uuid;
    v_analysis_artifact_byte_length :=
      v_analysis_artifact_byte_length_text::bigint;
  exception
    when others then
      raise exception 'Analysis-lock receipt contains invalid lock metadata.';
  end;

  if v_analysis_artifact_byte_length < 1 then
    raise exception 'Analysis artifact byte length must be at least 1.';
  end if;

  if v_receipt_transformation_id
      is distinct from v_registered_transformation_id
  then
    raise exception
      'Analysis-lock receipt does not refer to the registered blinding transformation.';
  end if;

  if v_blinding_receipt_sha256
      is distinct from v_registered_public_receipt_sha256
  then
    raise exception
      'Analysis-lock receipt does not match the registered public blinding receipt.';
  end if;

  if v_blinded_artifact_sha256
      is distinct from v_registered_blinded_artifact_sha256
  then
    raise exception
      'Analysis-lock receipt does not match the registered blinded artifact.';
  end if;

  insert into public.analysis_locks (
    workflow_id,
    study_id,
    transformation_record_id,
    plan_version_id,
    lock_id,
    schema_version,
    receipt_created_at,
    blinding_receipt_sha256,
    blinded_artifact_sha256,
    analysis_artifact_filename,
    analysis_artifact_sha256,
    analysis_artifact_byte_length,
    analysis_lock_receipt_sha256,
    analysis_lock_receipt_text,
    registered_by
  )
  values (
    p_workflow_id,
    v_study_id,
    v_transformation_record_id,
    v_transformation_plan_version_id,
    v_lock_id,
    v_schema_version,
    v_receipt_created_at,
    v_blinding_receipt_sha256,
    v_blinded_artifact_sha256,
    v_analysis_artifact_filename,
    v_analysis_artifact_sha256,
    v_analysis_artifact_byte_length,
    v_analysis_lock_receipt_sha256,
    p_analysis_lock_receipt_text,
    v_user_id
  )
  on conflict (lock_id) do nothing
  returning id into v_lock_record_id;

  if v_lock_record_id is not null then
    return v_lock_record_id;
  end if;

  -- A concurrent or repeated registration may already have inserted this
  -- lock_id. Treat an exact repeat as idempotent; reject any conflicting reuse.

  select
    existing.id,
    existing.workflow_id,
    existing.analysis_lock_receipt_sha256
  into
    v_existing_lock_record_id,
    v_existing_workflow_id,
    v_existing_receipt_sha256
  from public.analysis_locks as existing
  where existing.lock_id = v_lock_id;

  if found
    and v_existing_workflow_id = p_workflow_id
    and v_existing_receipt_sha256 = v_analysis_lock_receipt_sha256
  then
    return v_existing_lock_record_id;
  end if;

  raise exception
    'Analysis-lock identifier is already registered with different content.';
end;
$$;

revoke all on function public.register_analysis_lock(uuid, text) from public;
grant execute on function public.register_analysis_lock(uuid, text)
  to authenticated;

comment on table public.analysis_locks is
  'Immutable registration of browser-local analysis-lock receipts. Stores safe lock metadata and the exact lock receipt, but not analysis-artifact contents. Multiple lock records may exist for one blinded workflow.';

comment on column public.analysis_locks.plan_version_id is
  'Immutable BlindingPlan version bound to the registered blinding transformation referenced by this lock.';

comment on column public.analysis_locks.receipt_created_at is
  'Browser-generated timestamp contained in the analysis-lock receipt. This is not an independently trusted timestamp.';

comment on column public.analysis_locks.registered_at is
  'Trusted server timestamp for successful analysis-lock registration.';

comment on column public.analysis_locks.analysis_lock_receipt_text is
  'Exact analysis-lock receipt text registered by blindstats. Stored as text so later artifact identity is not changed by JSON normalization.';

comment on column public.analysis_locks.analysis_lock_receipt_sha256 is
  'Server-computed SHA-256 of the exact UTF-8 analysis-lock receipt text registered by blindstats.';

comment on column public.analysis_locks.analysis_artifact_sha256 is
  'SHA-256 of the exact analysis artifact bytes supplied locally when the analysis-lock receipt was created. The artifact contents are not stored by blindstats.';

commit;
