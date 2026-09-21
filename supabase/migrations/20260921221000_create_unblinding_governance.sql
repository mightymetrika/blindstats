-- Persistent unblinding request and authorization governance.
--
-- Request, authorization, and actual mapping exposure are separate events.
-- A request leaves the workflow blinded. A valid authorization changes:
--
--   blinded -> unblinding_authorized
--
-- Actual unblinding is intentionally left for a later vertical slice.
-- Independent authorization requires a different authenticated Study member
-- who holds the unblinding.authorize capability.

begin;

create table public.unblinding_requests (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null,
  study_id uuid not null,
  plan_version_id uuid not null,
  transformation_record_id uuid not null,
  analysis_lock_id uuid,
  requested_by uuid not null
    references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),

  constraint unblinding_requests_workflow_study_fk
    foreign key (workflow_id, study_id)
    references public.blinding_workflows(id, study_id)
    on delete cascade,

  constraint unblinding_requests_plan_workflow_fk
    foreign key (plan_version_id, workflow_id)
    references public.blinding_plan_versions(id, workflow_id)
    on delete restrict,

  constraint unblinding_requests_transformation_workflow_fk
    foreign key (transformation_record_id, workflow_id)
    references public.blinding_transformations(id, workflow_id)
    on delete restrict,

  constraint unblinding_requests_analysis_lock_workflow_fk
    foreign key (analysis_lock_id, workflow_id)
    references public.analysis_locks(id, workflow_id)
    on delete restrict,

  constraint unblinding_requests_workflow_unique
    unique (workflow_id),

  constraint unblinding_requests_id_workflow_unique
    unique (id, workflow_id)
);

create index unblinding_requests_study_requested_idx
  on public.unblinding_requests(study_id, requested_at desc);

create table public.unblinding_authorizations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  workflow_id uuid not null,
  study_id uuid not null,
  plan_version_id uuid not null,
  authorization_policy text not null,
  authorized_by uuid not null
    references auth.users(id) on delete restrict,
  authorized_at timestamptz not null default now(),

  constraint unblinding_authorizations_request_workflow_fk
    foreign key (request_id, workflow_id)
    references public.unblinding_requests(id, workflow_id)
    on delete restrict,

  constraint unblinding_authorizations_workflow_study_fk
    foreign key (workflow_id, study_id)
    references public.blinding_workflows(id, study_id)
    on delete cascade,

  constraint unblinding_authorizations_plan_workflow_fk
    foreign key (plan_version_id, workflow_id)
    references public.blinding_plan_versions(id, workflow_id)
    on delete restrict,

  constraint unblinding_authorizations_request_unique
    unique (request_id),

  constraint unblinding_authorizations_workflow_unique
    unique (workflow_id),

  constraint unblinding_authorizations_policy_valid
    check (
      authorization_policy in (
        'independent',
        'self_authorization'
      )
    )
);

create index unblinding_authorizations_study_authorized_idx
  on public.unblinding_authorizations(study_id, authorized_at desc);

alter table public.unblinding_requests enable row level security;
alter table public.unblinding_authorizations enable row level security;

create policy unblinding_requests_select_for_members
on public.unblinding_requests
for select
to authenticated
using (public.is_study_member(study_id));

create policy unblinding_authorizations_select_for_members
on public.unblinding_authorizations
for select
to authenticated
using (public.is_study_member(study_id));

revoke all on table public.unblinding_requests
  from anon, authenticated;
revoke all on table public.unblinding_authorizations
  from anon, authenticated;

grant select on table public.unblinding_requests
  to authenticated;
grant select on table public.unblinding_authorizations
  to authenticated;

-- Create one durable unblinding request for a blinded workflow.
-- If the active Plan requires an AnalysisLock, the caller must explicitly
-- select one registered lock. No "latest lock" is chosen implicitly.
-- A request does not authorize or perform unblinding.

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
  v_transformation_record_id uuid;
  v_transformation_plan_version_id uuid;
  v_valid_analysis_lock_id uuid;
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
    transformation.id,
    transformation.plan_version_id
  into
    v_transformation_record_id,
    v_transformation_plan_version_id
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

  if v_require_analysis_lock
    and p_analysis_lock_id is null
  then
    raise exception
      'The active BlindingPlan requires a registered analysis lock before unblinding can be requested.';
  end if;

  if p_analysis_lock_id is not null then
    select lock.id
    into v_valid_analysis_lock_id
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

  -- One ordinary unblinding request is supported per workflow in this first
  -- implementation. Repeating the exact same request by the same actor is
  -- idempotent.
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
  returning id into v_request_id;

  return v_request_id;
end;
$$;

-- Authorize one existing request. A successful authorization is a durable event
-- and atomically transitions blinded -> unblinding_authorized. It does not
-- expose the mapping.
--
-- self_authorization: the requester may also authorize if they hold the
--                     unblinding.authorize capability.
-- independent:        authorized_by must differ from requested_by, and the
--                     authorizer must hold unblinding.authorize.

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

  -- Resolve workflow first, then lock workflow -> request consistently.
  select
    request.workflow_id,
    request.study_id
  into
    v_workflow_id,
    v_study_id
  from public.unblinding_requests as request
  where request.id = p_request_id;

  if not found then
    raise exception 'Unblinding request not found.';
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
    raise exception 'Blinding workflow not found.';
  end if;

  if not public.has_study_capability(
    v_study_id,
    'unblinding.authorize'
  ) then
    raise exception using
      errcode = '42501',
      message = 'You are not authorized to authorize unblinding.';
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
    raise exception 'Unblinding request not found.';
  end if;

  -- Repeating a successful authorization by the same actor is idempotent.
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
  returning id into v_authorization_id;

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

revoke all on function public.request_unblinding(uuid, uuid)
  from public;
grant execute on function public.request_unblinding(uuid, uuid)
  to authenticated;

revoke all on function public.authorize_unblinding(uuid)
  from public;
grant execute on function public.authorize_unblinding(uuid)
  to authenticated;

comment on table public.unblinding_requests is
  'Immutable request to unblind a registered blinded workflow. Records the exact active Plan, registered transformation, requester, and selected registered AnalysisLock when applicable. It does not authorize or expose unblinded information.';

comment on column public.unblinding_requests.analysis_lock_id is
  'Specific registered AnalysisLock selected for this request. Required when the active BlindingPlan requires analysis locking; optional otherwise.';

comment on column public.unblinding_requests.requested_at is
  'Trusted server timestamp for the durable unblinding request.';

comment on table public.unblinding_authorizations is
  'Immutable authorization event for an unblinding request. Independent policy requires authorized_by to differ from requested_by. Successful authorization moves the workflow to unblinding_authorized but does not expose the protected mapping.';

comment on column public.unblinding_authorizations.authorization_policy is
  'Authorization policy copied from the immutable active BlindingPlan at successful authorization: independent or self_authorization.';

comment on column public.unblinding_authorizations.authorized_at is
  'Trusted server timestamp for successful unblinding authorization.';

commit;
