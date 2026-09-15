-- Persistent blinding-workflow setup and editable BlindingPlan draft.
--
-- This migration intentionally stops at the setup state. It does not yet
-- register blinded artifacts, activate immutable plan versions, or persist
-- substantive research-file contents.

begin;

create table public.blinding_workflows (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null
    references public.studies(id) on delete cascade,
  state text not null default 'setup',
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blinding_workflows_state_valid
    check (
      state in (
        'setup',
        'blinded',
        'unblinding_authorized',
        'unblinded',
        'cancelled',
        'closed_without_unblinding'
      )
    ),
  constraint blinding_workflows_id_study_unique
    unique (id, study_id)
);

create index blinding_workflows_study_created_idx
  on public.blinding_workflows(study_id, created_at desc);

create table public.blinding_plan_drafts (
  workflow_id uuid primary key,
  study_id uuid not null,
  blinding_targets text[] not null default '{}'::text[],
  protection_rationale text,
  require_analysis_lock boolean not null default true,
  authorization_policy text not null default 'independent',
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blinding_plan_drafts_workflow_study_fk
    foreign key (workflow_id, study_id)
    references public.blinding_workflows(id, study_id)
    on delete cascade,
  constraint blinding_plan_drafts_target_count
    check (cardinality(blinding_targets) <= 1),
  constraint blinding_plan_drafts_rationale_length
    check (
      protection_rationale is null
      or char_length(protection_rationale) <= 1000
    ),
  constraint blinding_plan_drafts_authorization_policy_valid
    check (
      authorization_policy in (
        'independent',
        'self_authorization'
      )
    )
);

create index blinding_plan_drafts_study_idx
  on public.blinding_plan_drafts(study_id);

create trigger blinding_workflows_set_updated_at
before update on public.blinding_workflows
for each row
execute function public.set_updated_at();

create trigger blinding_plan_drafts_set_updated_at
before update on public.blinding_plan_drafts
for each row
execute function public.set_updated_at();

-- Every workflow starts with exactly one editable draft plan.
create or replace function public.bootstrap_blinding_plan_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.blinding_plan_drafts (
    workflow_id,
    study_id,
    created_by
  )
  values (
    new.id,
    new.study_id,
    new.created_by
  );

  return new;
end;
$$;

create trigger on_blinding_workflow_created
after insert on public.blinding_workflows
for each row
execute function public.bootstrap_blinding_plan_draft();

alter table public.blinding_workflows enable row level security;
alter table public.blinding_plan_drafts enable row level security;

create policy blinding_workflows_select_for_members
on public.blinding_workflows
for select
to authenticated
using (
  public.is_study_member(study_id)
);

create policy blinding_workflows_insert_for_configurators
on public.blinding_workflows
for insert
to authenticated
with check (
  public.has_study_capability(study_id, 'blinding.configure')
  and created_by = (select auth.uid())
  and state = 'setup'
);

create policy blinding_plan_drafts_select_for_members
on public.blinding_plan_drafts
for select
to authenticated
using (
  public.is_study_member(study_id)
);

create policy blinding_plan_drafts_update_for_configurators_in_setup
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
  )
);

revoke all on table public.blinding_workflows
  from anon, authenticated;

revoke all on table public.blinding_plan_drafts
  from anon, authenticated;

grant select on table public.blinding_workflows
  to authenticated;

grant insert (study_id) on table public.blinding_workflows
  to authenticated;

grant select on table public.blinding_plan_drafts
  to authenticated;

grant update (
  blinding_targets,
  protection_rationale,
  require_analysis_lock,
  authorization_policy
)
on table public.blinding_plan_drafts
to authenticated;

revoke all on function public.bootstrap_blinding_plan_draft()
  from public;

commit;
