-- Allow persistent authorized unblinding to complete without an AnalysisLock
-- when the active immutable BlindingPlan explicitly does not require one.
--
-- request_unblinding() and authorize_unblinding() already honor
-- require_analysis_lock. The original completion registration did not: its
-- table schema and RPC required AnalysisLock metadata unconditionally.
--
-- This migration aligns completion with the active Plan while preserving the
-- existing strong validation whenever a request is bound to an AnalysisLock.

begin;

alter table public.unblinding_completions
  alter column analysis_lock_id drop not null,
  alter column analysis_lock_receipt_sha256 drop not null,
  alter column analysis_artifact_filename drop not null,
  alter column analysis_artifact_sha256 drop not null,
  alter column analysis_artifact_byte_length drop not null;

alter table public.unblinding_completions
  add constraint unblinding_completions_analysis_lock_metadata_consistent
  check (
    (
      analysis_lock_id is null
      and analysis_lock_receipt_sha256 is null
      and analysis_artifact_filename is null
      and analysis_artifact_sha256 is null
      and analysis_artifact_byte_length is null
    )
    or
    (
      analysis_lock_id is not null
      and analysis_lock_receipt_sha256 is not null
      and analysis_artifact_filename is not null
      and analysis_artifact_sha256 is not null
      and analysis_artifact_byte_length is not null
    )
  );

create or replace function public.register_unblinding_completion(
  p_workflow_id uuid,
  p_request_id uuid,
  p_unblinding_id uuid,
  p_receipt_created_at timestamptz,
  p_transformation_id uuid,
  p_lock_id uuid,
  p_selected_column text,
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
  v_selected_column text;
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
    transformation.selected_column,
    transformation.source_artifact_sha256,
    transformation.blinded_artifact_sha256,
    transformation.public_receipt_sha256
  into
    v_transformation_id,
    v_transformation_plan_version_id,
    v_selected_column,
    v_source_artifact_sha256,
    v_blinded_artifact_sha256,
    v_public_receipt_sha256
  from public.blinding_transformations as transformation
  where transformation.id = v_transformation_record_id
    and transformation.workflow_id = p_workflow_id
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

  if p_selected_column is distinct from v_selected_column then
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

  if p_selected_column is null
    or btrim(p_selected_column) = ''
  then
    raise exception 'Selected column cannot be blank.';
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
    selected_column,
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
    '0.3',
    p_receipt_created_at,
    v_selected_column,
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

revoke all on function public.register_unblinding_completion(
  uuid,
  uuid,
  uuid,
  timestamptz,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  text
)
  from public;

grant execute on function public.register_unblinding_completion(
  uuid,
  uuid,
  uuid,
  timestamptz,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  text
)
  to authenticated;

comment on column public.unblinding_completions.analysis_lock_id is
  'Registered AnalysisLock bound to the authorized request, or NULL when the active BlindingPlan did not require a lock and the request intentionally omitted one.';

comment on function public.register_unblinding_completion(
  uuid,
  uuid,
  uuid,
  timestamptz,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  text
) is
  'Registers safe metadata after authorized browser-local unblinding and atomically transitions unblinding_authorized to unblinded. AnalysisLock metadata is required exactly when the authorized request is bound to a lock. The function does not receive the secret, plaintext mapping, or final receipt text.';

commit;
