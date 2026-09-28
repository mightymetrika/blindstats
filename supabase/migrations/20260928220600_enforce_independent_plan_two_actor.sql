-- Enforce two-actor readiness for independent unblinding authorization.
--
-- The application already prevents activation of an Independent BlindingPlan
-- unless at least one Study member can request unblinding and a different Study
-- member can authorize it. This migration moves the same invariant into the
-- database activation boundary so direct RPC calls cannot bypass it.

begin;

create or replace function public.activate_blinding_plan(
  p_workflow_id uuid,
  p_acknowledge_weaker_policies boolean default false
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

  v_protection_targets text[];
  v_protection_rationale text;
  v_require_analysis_lock boolean;
  v_authorization_policy text;

  v_warning_acknowledgements text[] := '{}'::text[];
  v_version_id uuid;
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
    'blinding.configure'
  ) then
    raise exception using
      errcode = '42501',
      message = 'You are not authorized to activate this BlindingPlan.';
  end if;

  if v_state <> 'setup' then
    raise exception 'BlindingPlan activation requires workflow state setup.';
  end if;

  if v_active_plan_version_id is not null then
    raise exception 'An active BlindingPlan version already exists.';
  end if;

  select
    draft.protection_targets,
    draft.protection_rationale,
    draft.require_analysis_lock,
    draft.authorization_policy
  into
    v_protection_targets,
    v_protection_rationale,
    v_require_analysis_lock,
    v_authorization_policy
  from public.blinding_plan_drafts as draft
  where draft.workflow_id = p_workflow_id
    and draft.study_id = v_study_id;

  if not found then
    raise exception 'BlindingPlan draft not found.';
  end if;

  if cardinality(v_protection_targets) <> 1
    or v_protection_targets[1] is null
    or btrim(v_protection_targets[1]) = ''
  then
    raise exception 'A protection target is required before activation.';
  end if;

  if char_length(v_protection_targets[1]) > 200 then
    raise exception 'Protection target must be 200 characters or fewer.';
  end if;

  if not v_require_analysis_lock then
    if not p_acknowledge_weaker_policies then
      raise exception
        'Activation requires acknowledgement that analysis lock is not required.';
    end if;

    v_warning_acknowledgements :=
      array_append(
        v_warning_acknowledgements,
        'analysis_lock_not_required'
      );
  end if;

  if v_authorization_policy = 'independent' then
    if not exists (
      select 1
      from public.study_capabilities as requester
      join public.study_capabilities as authorizer
        on authorizer.study_id = requester.study_id
       and authorizer.user_id <> requester.user_id
      where requester.study_id = v_study_id
        and requester.capability = 'unblinding.request'
        and authorizer.capability = 'unblinding.authorize'
    ) then
      raise exception
        'Independent authorization requires different Study members for unblinding request and authorization.';
    end if;
  end if;

  if v_authorization_policy = 'self_authorization' then
    if not p_acknowledge_weaker_policies then
      raise exception
        'Activation requires acknowledgement that self-authorization is permitted.';
    end if;

    v_warning_acknowledgements :=
      array_append(
        v_warning_acknowledgements,
        'self_authorization_permitted'
      );
  end if;

  insert into public.blinding_plan_versions (
    workflow_id,
    study_id,
    version_number,
    protection_targets,
    protection_rationale,
    require_analysis_lock,
    authorization_policy,
    warning_acknowledgements,
    activated_by
  )
  values (
    p_workflow_id,
    v_study_id,
    1,
    v_protection_targets,
    v_protection_rationale,
    v_require_analysis_lock,
    v_authorization_policy,
    v_warning_acknowledgements,
    v_user_id
  )
  returning id into v_version_id;

  update public.blinding_workflows
  set active_plan_version_id = v_version_id
  where id = p_workflow_id;

  return v_version_id;
end;
$$;

revoke all on function public.activate_blinding_plan(uuid, boolean)
  from public;

grant execute on function public.activate_blinding_plan(uuid, boolean)
  to authenticated;

comment on function public.activate_blinding_plan(uuid, boolean) is
  'Activates immutable BlindingPlan v1. Independent authorization requires different Study members to hold unblinding.request and unblinding.authorize.';

commit;
