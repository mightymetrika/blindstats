-- Milestone 1: persistent Study foundation.
--
-- This migration creates:
--   - application profiles linked to Supabase Auth users;
--   - persistent studies;
--   - study membership;
--   - capability-based study authorization;
--   - RLS policies for the initial platform slice.
--
-- Research-file contents are intentionally not stored here.

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length
    check (
      display_name is null
      or char_length(display_name) <= 100
    )
);

create table public.studies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  lifecycle text not null default 'active',
  created_by uuid default auth.uid()
    references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studies_name_valid
    check (
      char_length(btrim(name)) between 1 and 200
    ),
  constraint studies_description_length
    check (
      description is null
      or char_length(description) <= 2000
    ),
  constraint studies_lifecycle_valid
    check (
      lifecycle in ('active', 'archived')
    )
);

create table public.study_memberships (
  study_id uuid not null
    references public.studies(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  added_by uuid default auth.uid()
    references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (study_id, user_id)
);

create table public.study_capabilities (
  study_id uuid not null,
  user_id uuid not null,
  capability text not null,
  granted_by uuid default auth.uid()
    references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (study_id, user_id, capability),
  foreign key (study_id, user_id)
    references public.study_memberships(study_id, user_id)
    on delete cascade,
  constraint study_capabilities_value_valid
    check (
      capability in (
        'study.manage',
        'membership.manage',
        'capability.manage',
        'blinding.configure',
        'blinding.create',
        'analysis.lock',
        'unblinding.request',
        'unblinding.authorize',
        'unblinded.receive',
        'audit.view'
      )
    )
);

create index study_memberships_user_id_idx
  on public.study_memberships(user_id);

create index study_capabilities_user_study_idx
  on public.study_capabilities(user_id, study_id);


-- Keep mutable timestamps server-controlled.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create trigger studies_set_updated_at
before update on public.studies
for each row
execute function public.set_updated_at();


-- Create the application's profile row when Supabase Auth creates a user.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    user_id,
    display_name
  )
  values (
    new.id,
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '')
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_auth_user();


-- Backfill profiles if any Auth users already exist when this migration runs.

insert into public.profiles (
  user_id,
  display_name
)
select
  id,
  nullif(btrim(raw_user_meta_data ->> 'display_name'), '')
from auth.users
on conflict (user_id) do nothing;


-- RLS helper functions.
--
-- SECURITY DEFINER is used narrowly so policies can query membership/capability
-- tables without recursive RLS evaluation. The search path is empty and every
-- referenced relation is schema-qualified.

create or replace function public.is_study_member(
  target_study_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.study_memberships as membership
    where membership.study_id = target_study_id
      and membership.user_id = auth.uid()
  );
$$;

create or replace function public.has_study_capability(
  target_study_id uuid,
  target_capability text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.study_capabilities as permission
    where permission.study_id = target_study_id
      and permission.user_id = auth.uid()
      and permission.capability = target_capability
  );
$$;


-- Creating a Study automatically establishes the creator's membership and
-- initial capabilities in the same database transaction.

create or replace function public.bootstrap_study_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is null then
    raise exception 'A Study must have a creator when it is created.';
  end if;

  insert into public.study_memberships (
    study_id,
    user_id,
    added_by
  )
  values (
    new.id,
    new.created_by,
    new.created_by
  );

  insert into public.study_capabilities (
    study_id,
    user_id,
    capability,
    granted_by
  )
  select
    new.id,
    new.created_by,
    capability,
    new.created_by
  from unnest(
    array[
      'study.manage',
      'membership.manage',
      'capability.manage',
      'blinding.configure',
      'blinding.create',
      'analysis.lock',
      'unblinding.request',
      'unblinding.authorize',
      'unblinded.receive',
      'audit.view'
    ]::text[]
  ) as capability;

  return new;
end;
$$;

create trigger on_study_created
after insert on public.studies
for each row
execute function public.bootstrap_study_creator();


-- Row Level Security is explicit even though the Supabase project also uses
-- automatic RLS for new public tables.

alter table public.profiles enable row level security;
alter table public.studies enable row level security;
alter table public.study_memberships enable row level security;
alter table public.study_capabilities enable row level security;


-- Profiles.
--
-- Milestone 1 exposes only a user's own profile. Shared-study profile
-- visibility can be added when the member-management UI requires it.

create policy profiles_select_own
on public.profiles
for select
to authenticated
using (
  (select auth.uid()) = user_id
);

create policy profiles_update_own
on public.profiles
for update
to authenticated
using (
  (select auth.uid()) = user_id
)
with check (
  (select auth.uid()) = user_id
);


-- Studies.

create policy studies_select_for_members
on public.studies
for select
to authenticated
using (
  public.is_study_member(id)
);

create policy studies_insert_for_authenticated_users
on public.studies
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and created_by = (select auth.uid())
);

create policy studies_update_for_managers
on public.studies
for update
to authenticated
using (
  public.has_study_capability(id, 'study.manage')
)
with check (
  public.has_study_capability(id, 'study.manage')
);


-- Memberships.

create policy study_memberships_select_for_members
on public.study_memberships
for select
to authenticated
using (
  public.is_study_member(study_id)
);

create policy study_memberships_insert_for_managers
on public.study_memberships
for insert
to authenticated
with check (
  public.has_study_capability(study_id, 'membership.manage')
);

create policy study_memberships_delete_for_managers
on public.study_memberships
for delete
to authenticated
using (
  public.has_study_capability(study_id, 'membership.manage')
);


-- Capabilities.

create policy study_capabilities_select_for_members
on public.study_capabilities
for select
to authenticated
using (
  public.is_study_member(study_id)
);

create policy study_capabilities_insert_for_managers
on public.study_capabilities
for insert
to authenticated
with check (
  public.has_study_capability(study_id, 'capability.manage')
);

create policy study_capabilities_delete_for_managers
on public.study_capabilities
for delete
to authenticated
using (
  public.has_study_capability(study_id, 'capability.manage')
);


-- Explicit Data API grants.
--
-- The project was configured not to expose new tables automatically, so the
-- authenticated role receives only the operations required by this milestone.
-- The anon role receives no table access.

revoke all on table public.profiles
  from anon, authenticated;

revoke all on table public.studies
  from anon, authenticated;

revoke all on table public.study_memberships
  from anon, authenticated;

revoke all on table public.study_capabilities
  from anon, authenticated;


grant select on table public.profiles
  to authenticated;

grant update (display_name) on table public.profiles
  to authenticated;


grant select on table public.studies
  to authenticated;

grant insert (name, description) on table public.studies
  to authenticated;

grant update (name, description, lifecycle) on table public.studies
  to authenticated;


grant select on table public.study_memberships
  to authenticated;

grant insert (study_id, user_id) on table public.study_memberships
  to authenticated;

grant delete on table public.study_memberships
  to authenticated;


grant select on table public.study_capabilities
  to authenticated;

grant insert (study_id, user_id, capability) on table public.study_capabilities
  to authenticated;

grant delete on table public.study_capabilities
  to authenticated;


-- Trigger functions should not be directly callable through the API.

revoke all on function public.set_updated_at()
  from public;

revoke all on function public.handle_new_auth_user()
  from public;

revoke all on function public.bootstrap_study_creator()
  from public;


-- RLS helper functions expose only boolean authorization checks.

revoke all on function public.is_study_member(uuid)
  from public;

revoke all on function public.has_study_capability(uuid, text)
  from public;

grant execute on function public.is_study_member(uuid)
  to authenticated;

grant execute on function public.has_study_capability(uuid, text)
  to authenticated;