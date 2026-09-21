-- Remove an unused local variable from request_unblinding().
-- No behavior change. This follow-up migration is required because
-- 20260921221000 has already been applied remotely.

begin;

create or replace function public.request_unblinding(
  p_workflow_id uuid,
  p_analysis_lock_id uuid default null
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
  v_authorization_policy text;

  v_transformation_record_id uuid;
  v_transformation_plan_version_id uuid;

  v_existing_request_id uuid;
  v_existing_requested_by uuid;
  v_existing_analysis_lock_id uuid;

  v_request_id uuid;
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
    'unblinding.request'
  ) then
    raise exception using
      errcode = '42501',
      message = 'You are not authorized to request unblinding.';
  end if;


  if v_state <> 'blinded' then
    raise exception
      'Unblinding can only be requested while the workflow is blinded.';
  end if;


  if v_active_plan_version_id is null then
    raise exception
      'The active BlindingPlan version could not be verified.';
  end if;


  select
    plan.require_analysis_lock,
    plan.authorization_policy
  into
    v_require_analysis_lock,
    v_authorization_policy
  from public.blinding_plan_versions as plan
  where plan.id = v_active_plan_version_id
    and plan.workflow_id = p_workflow_id
    and plan.study_id = v_study_id;

  if not found then
    raise exception
      'The active BlindingPlan version could not be loaded.';
  end if;


  select
    transformation.id,
    transformation.plan_version_id
  into
    v_transformation_record_id,
    v_transformation_plan_version_id
  from public.blinding_transformations as transformation
  where transformation.workflow_id = p_workflow_id
    and transformation.study_id = v_study_id;

  if not found then
    raise exception
      'Registered blinding transformation not found.';
  end if;


  if v_transformation_plan_version_id
      is distinct from v_active_plan_version_id
  then
    raise exception
      'Registered blinding transformation is not bound to the active BlindingPlan.';
  end if;


  if v_require_analysis_lock
    and p_analysis_lock_id is null
  then
    raise exception
      'The active BlindingPlan requires a registered analysis lock before unblinding can be requested.';
  end if;


  if p_analysis_lock_id is not null then
    perform 1
    from public.analysis_locks as lock
    where lock.id = p_analysis_lock_id
      and lock.workflow_id = p_workflow_id
      and lock.study_id = v_study_id
      and lock.transformation_record_id = v_transformation_record_id
      and lock.plan_version_id = v_active_plan_version_id;

    if not found then
      raise exception
        'Selected analysis lock does not belong to the active blinded workflow and Plan.';
    end if;
  end if;


  select
    request.id,
    request.requested_by,
    request.analysis_lock_id
  into
    v_existing_request_id,
    v_existing_requested_by,
    v_existing_analysis_lock_id
  from public.unblinding_requests as request
  where request.workflow_id = p_workflow_id;

  if found then
    if v_existing_requested_by = v_user_id
      and v_existing_analysis_lock_id
        is not distinct from p_analysis_lock_id
    then
      return v_existing_request_id;
    end if;

    raise exception
      'An unblinding request is already registered for this workflow.';
  end if;


  insert into public.unblinding_requests (
    workflow_id,
    study_id,
    plan_version_id,
    transformation_record_id,
    analysis_lock_id,
    requested_by
  )
  values (
    p_workflow_id,
    v_study_id,
    v_active_plan_version_id,
    v_transformation_record_id,
    p_analysis_lock_id,
    v_user_id
  )
  returning id
  into v_request_id;


  return v_request_id;
end;
$$;

commit;
