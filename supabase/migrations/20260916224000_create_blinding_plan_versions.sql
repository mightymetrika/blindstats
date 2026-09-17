-- Activate an immutable BlindingPlan v1 without yet moving the workflow to
-- the blinded state.
--
-- Plan activation freezes the current governance draft as a durable historical
-- record. The workflow remains in setup until a later successful blinding
-- transformation is created and registered.

begin;

create table public.blinding_plan_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null,
  study_id uuid not null,
  version_number integer not null,
  protection_targets text[] not null,
  protection_rationale text,
  require_analysis_lock boolean not null,
  authorization_policy text not null,
  warning_acknowledgements text[] not null default '{}'::text[],
  activated_by uuid not null
    references auth.users(id) on delete restrict,
  activated_at timestamptz not null default now(),

  constraint blinding_plan_versions_workflow_study_fk
    foreign key (workflow_id, study_id)
    references public.blinding_workflows(id, study_id)
    on delete cascade,

  constraint blinding_plan_versions_version_positive
    check (version_number >= 1),

  constraint blinding_plan_versions_workflow_version_unique
    unique (workflow_id, version_number),

  constraint blinding_plan_versions_id_workflow_unique
    unique (id, workflow_id),

  constraint blinding_plan_versions_protection_target_count
    check (cardinality(protection_targets) = 1),

  constraint blinding_plan_versions_protection_target_nonblank
    check (
      protection_targets[1] is not null
      and btrim(protection_targets[1]) <> ''
    ),

  constraint blinding_plan_versions_protection_target_length
    check (char_length(protection_targets[1]) <= 200),

  constraint blinding_plan_versions_rationale_length
    check (
      protection_rationale is null
      or char_length(protection_rationale) <= 1000
    ),

  constraint blinding_plan_versions_authorization_policy_valid
    check (
      authorization_policy in (
        'independent',
        'self_authorization'
      )
    ),

  constraint blinding_plan_versions_warning_codes_valid
    check (
      warning_acknowledgements
      <@ array[
        'analysis_lock_not_required',
        'self_authorization_permitted'
      ]::text[]
    ),

  constraint blinding_plan_versions_lock_warning_recorded
    check (
      require_analysis_lock
      or 'analysis_lock_not_required' = any(warning_acknowledgements)
    ),

  constraint blinding_plan_versions_self_auth_warning_recorded
    check (
      authorization_policy <> 'self_authorization'
      or 'self_authorization_permitted' = any(warning_acknowledgements)
    )
);

create index blinding_plan_versions_workflow_version_idx
  on public.blinding_plan_versions(workflow_id, version_number desc);

create index blinding_plan_versions_study_idx
  on public.blinding_plan_versions(study_id);


alter table public.blinding_workflows
  add column active_plan_version_id uuid;

alter table public.blinding_workflows
  add constraint blinding_workflows_active_plan_version_fk
  foreign key (active_plan_version_id, id)
  references public.blinding_plan_versions(id, workflow_id)
  on delete restrict;


-- Once an active plan exists, the ordinary setup draft is frozen. A later
-- amendment workflow can explicitly create a new editable draft/version rather
-- than silently changing Plan v1.

drop policy blinding_plan_drafts_update_for_configurators_in_setup
  on public.blinding_plan_drafts;

create policy blinding_plan_drafts_update_for_configurators_before_activation
on public.blinding_plan_drafts
for update
to authenticated
using (
  public.has_study_capability(study_id, 'blinding.configure')
  and exists (
    select 1
    from public.blinding_workflows as workflow
    where workflow.id = public.blinding_plan_drafts.workflow_id
      and workflow.study_id = public.blinding_plan_drafts.study_id
      and workflow.state = 'setup'
      and workflow.active_plan_version_id is null
  )
)
with check (
  public.has_study_capability(study_id, 'blinding.configure')
  and exists (
    select 1
    from public.blinding_workflows as workflow
    where workflow.id = public.blinding_plan_drafts.workflow_id
      and workflow.study_id = public.blinding_plan_drafts.study_id
      and workflow.state = 'setup'
      and workflow.active_plan_version_id is null
  )
);


alter table public.blinding_plan_versions enable row level security;

create policy blinding_plan_versions_select_for_members
on public.blinding_plan_versions
for select
to authenticated
using (
  public.is_study_member(study_id)
);

revoke all on table public.blinding_plan_versions
  from anon, authenticated;

grant select on table public.blinding_plan_versions
  to authenticated;


-- Activation is a single server-side transaction:
--   1. lock the workflow row;
--   2. verify authorization and setup state;
--   3. validate the draft;
--   4. record any acknowledged weaker-policy warnings;
--   5. create immutable Plan v1;
--   6. point the workflow at that active version.
--
-- The workflow deliberately remains in setup. A later successful blinding
-- transformation will be responsible for the transition to blinded.

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


comment on table public.blinding_plan_versions is
  'Immutable historical BlindingPlan snapshots. Normal authenticated clients receive SELECT only; activation occurs through the controlled activate_blinding_plan function.';

comment on column public.blinding_workflows.active_plan_version_id is
  'Current immutable BlindingPlan version. A non-null value does not itself mean that a blinded package has been created or that workflow state is blinded.';

commit;
