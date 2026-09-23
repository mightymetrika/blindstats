-- Establish the first narrow two-party analyst-blinding role separation.
--
-- The assigning user becomes the operational blinding custodian for this
-- Study: they retain blinding creation / configuration and unblinding
-- authorization, but lose the analyst-side capabilities.
--
-- The selected existing account becomes the blinded analyst for this Study:
-- they receive only analysis.lock, unblinding.request, and unblinded.receive.
-- They do not receive blinding.create or unblinding.authorize.

begin;

create or replace function public.assign_blinded_analyst_by_email(
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

  if not public.has_study_capability(p_study_id, 'membership.manage')
    or not public.has_study_capability(p_study_id, 'capability.manage')
  then
    raise exception using
      errcode = '42501',
      message = 'You are not authorized to assign a blinded analyst.';
  end if;

  if not public.has_study_capability(p_study_id, 'blinding.configure')
    or not public.has_study_capability(p_study_id, 'blinding.create')
    or not public.has_study_capability(p_study_id, 'unblinding.authorize')
  then
    raise exception
      'The assigning account does not have the custodian capabilities required for two-party analyst blinding.';
  end if;

  v_normalized_email := lower(btrim(coalesce(p_email, '')));

  if v_normalized_email = ''
    or char_length(v_normalized_email) > 320
  then
    raise exception 'A valid account email is required.';
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
      'The blinded analyst must use a different authenticated account.';
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

  -- The analyst role is intentionally narrow and exact for this first
  -- two-party workflow. Existing Study capabilities for the selected account
  -- are replaced by the three analyst-side capabilities.
  delete from public.study_capabilities
  where study_id = p_study_id
    and user_id = v_target_user_id;

  insert into public.study_capabilities (
    study_id,
    user_id,
    capability,
    granted_by
  )
  select
    p_study_id,
    v_target_user_id,
    capability,
    v_user_id
  from unnest(
    array[
      'analysis.lock',
      'unblinding.request',
      'unblinded.receive'
    ]::text[]
  ) as capability;

  -- The assigning user becomes the custodian side of the two-party split.
  -- They keep Study management, blinding creation/configuration, and
  -- unblinding authorization, but cannot perform the analyst-side workflow.
  delete from public.study_capabilities
  where study_id = p_study_id
    and user_id = v_user_id
    and capability in (
      'analysis.lock',
      'unblinding.request',
      'unblinded.receive'
    );

  return v_target_user_id;
end;
$$;

revoke all on function public.assign_blinded_analyst_by_email(uuid, text)
  from public;

grant execute on function public.assign_blinded_analyst_by_email(uuid, text)
  to authenticated;

comment on function public.assign_blinded_analyst_by_email(uuid, text) is
  'Configures a narrow two-party analyst-blinding split for one Study. The selected existing account receives only analysis.lock, unblinding.request, and unblinded.receive; the assigning custodian loses those analyst-side capabilities while retaining blinding and authorization responsibilities.';

commit;
