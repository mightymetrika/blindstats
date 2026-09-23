-- Minimal second-actor support for independent unblinding authorization.
--
-- Adds one narrow manager operation:
--   existing authenticated account email
--     -> Study membership
--     -> unblinding.authorize capability
--
-- Also hardens authorize_unblinding() so callers without authorization for the
-- request's Study cannot use a known request UUID to learn whether it exists.

begin;

create or replace function public.add_independent_authorizer_by_email(
  p_study_id uuid,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_target_user_id uuid;
  v_normalized_email text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  if not public.has_study_capability(
    p_study_id,
    'membership.manage'
  )
    or not public.has_study_capability(
      p_study_id,
      'capability.manage'
    )
  then
    raise exception using
      errcode = '42501',
      message = 'You are not authorized to add a Study authorizer.';
  end if;

  v_normalized_email := lower(btrim(coalesce(p_email, '')));

  if v_normalized_email = ''
    or char_length(v_normalized_email) > 320
  then
    raise exception
      'A valid account email is required.';
  end if;

  select account.id
  into v_target_user_id
  from auth.users as account
  where lower(account.email) = v_normalized_email
  limit 1;

  if not found then
    raise exception
      'No existing blindstats account was found for that email. The person must create an account first.';
  end if;

  if v_target_user_id = v_user_id then
    raise exception
      'Independent authorization requires a different authenticated account.';
  end if;

  insert into public.study_memberships (
    study_id,
    user_id,
    added_by
  )
  values (
    p_study_id,
    v_target_user_id,
    v_user_id
  )
  on conflict (study_id, user_id) do nothing;

  insert into public.study_capabilities (
    study_id,
    user_id,
    capability,
    granted_by
  )
  values (
    p_study_id,
    v_target_user_id,
    'unblinding.authorize',
    v_user_id
  )
  on conflict (study_id, user_id, capability) do nothing;

  return v_target_user_id;
end;
$$;

revoke all on function public.add_independent_authorizer_by_email(uuid, text)
  from public;

grant execute on function public.add_independent_authorizer_by_email(uuid, text)
  to authenticated;

comment on function public.add_independent_authorizer_by_email(uuid, text) is
  'Adds an existing different authenticated account to a Study and grants only unblinding.authorize. Requires membership.manage and capability.manage.';


create or replace function public.authorize_unblinding(
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_workflow_id uuid;
  v_study_id uuid;
  v_state text;
  v_active_plan_version_id uuid;
  v_request_plan_version_id uuid;
  v_request_transformation_record_id uuid;
  v_request_analysis_lock_id uuid;
  v_requested_by uuid;
  v_require_analysis_lock boolean;
  v_authorization_policy text;
  v_transformation_plan_version_id uuid;
  v_existing_authorization_id uuid;
  v_existing_authorized_by uuid;
  v_authorization_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  -- Resolve only requests the current actor is permitted to authorize.
  -- This avoids revealing request existence across Study boundaries.
  select
    request.workflow_id,
    request.study_id
  into
    v_workflow_id,
    v_study_id
  from public.unblinding_requests as request
  where request.id = p_request_id
    and exists (
      select 1
      from public.study_capabilities as permission
      where permission.study_id = request.study_id
        and permission.user_id = v_user_id
        and permission.capability = 'unblinding.authorize'
    );

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Unblinding request not found or you are not authorized to authorize it.';
  end if;

  select
    workflow.state,
    workflow.active_plan_version_id
  into
    v_state,
    v_active_plan_version_id
  from public.blinding_workflows as workflow
  where workflow.id = v_workflow_id
    and workflow.study_id = v_study_id
  for update;

  if not found then
    raise exception
      'Blinding workflow not found.';
  end if;

  select
    request.plan_version_id,
    request.transformation_record_id,
    request.analysis_lock_id,
    request.requested_by
  into
    v_request_plan_version_id,
    v_request_transformation_record_id,
    v_request_analysis_lock_id,
    v_requested_by
  from public.unblinding_requests as request
  where request.id = p_request_id
    and request.workflow_id = v_workflow_id
    and request.study_id = v_study_id
  for update;

  if not found then
    raise exception
      'Unblinding request not found.';
  end if;

  select
    existing_authorization.id,
    existing_authorization.authorized_by
  into
    v_existing_authorization_id,
    v_existing_authorized_by
  from public.unblinding_authorizations as existing_authorization
  where existing_authorization.request_id = p_request_id;

  if found then
    if v_existing_authorized_by = v_user_id then
      return v_existing_authorization_id;
    end if;

    raise exception
      'This unblinding request has already been authorized.';
  end if;

  if v_state <> 'blinded' then
    raise exception
      'Unblinding authorization requires workflow state blinded.';
  end if;

  if v_active_plan_version_id is null
    or v_request_plan_version_id
      is distinct from v_active_plan_version_id
  then
    raise exception
      'Unblinding request is not bound to the active BlindingPlan.';
  end if;

  select
    plan.require_analysis_lock,
    plan.authorization_policy
  into
    v_require_analysis_lock,
    v_authorization_policy
  from public.blinding_plan_versions as plan
  where plan.id = v_active_plan_version_id
    and plan.workflow_id = v_workflow_id
    and plan.study_id = v_study_id;

  if not found then
    raise exception
      'The active BlindingPlan version could not be loaded.';
  end if;

  select transformation.plan_version_id
  into v_transformation_plan_version_id
  from public.blinding_transformations as transformation
  where transformation.id = v_request_transformation_record_id
    and transformation.workflow_id = v_workflow_id
    and transformation.study_id = v_study_id;

  if not found
    or v_transformation_plan_version_id
      is distinct from v_active_plan_version_id
  then
    raise exception
      'Unblinding request is not bound to the active registered transformation.';
  end if;

  if v_require_analysis_lock then
    if v_request_analysis_lock_id is null then
      raise exception
        'The active BlindingPlan requires a registered analysis lock before unblinding can be authorized.';
    end if;

    perform 1
    from public.analysis_locks as lock
    where lock.id = v_request_analysis_lock_id
      and lock.workflow_id = v_workflow_id
      and lock.study_id = v_study_id
      and lock.transformation_record_id = v_request_transformation_record_id
      and lock.plan_version_id = v_active_plan_version_id;

    if not found then
      raise exception
        'The selected analysis lock is not valid for this unblinding request.';
    end if;
  end if;

  if v_authorization_policy = 'independent'
    and v_user_id = v_requested_by
  then
    raise exception
      'Independent authorization requires a different authenticated Study member with unblinding.authorize capability.';
  end if;

  insert into public.unblinding_authorizations (
    request_id,
    workflow_id,
    study_id,
    plan_version_id,
    authorization_policy,
    authorized_by
  )
  values (
    p_request_id,
    v_workflow_id,
    v_study_id,
    v_active_plan_version_id,
    v_authorization_policy,
    v_user_id
  )
  returning id
  into v_authorization_id;

  update public.blinding_workflows
  set state = 'unblinding_authorized'
  where id = v_workflow_id
    and study_id = v_study_id
    and state = 'blinded';

  if not found then
    raise exception
      'Unable to transition workflow to unblinding authorized.';
  end if;

  return v_authorization_id;
end;
$$;

revoke all on function public.authorize_unblinding(uuid)
  from public;

grant execute on function public.authorize_unblinding(uuid)
  to authenticated;

comment on function public.authorize_unblinding(uuid) is
  'Authorizes one governed unblinding request. The caller must hold unblinding.authorize for the request Study; independent policy additionally requires a different authenticated account from the requester. Successful authorization transitions blinded to unblinding_authorized without exposing the mapping.';

commit;
