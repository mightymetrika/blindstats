-- v46 operator-only lifecycle. No object or research record is deleted by migration.
begin;
create table public.research_storage_cleanup_attempts (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null check (bucket_id in ('blindstats-research-v1','blindstats-secret-v1')),
  transfer_id uuid not null,
  storage_path text not null,
  reason text not null check (reason in ('completed_secret','incomplete_dataset','incomplete_secret')),
  operator_label text not null check (char_length(operator_label) between 1 and 100),
  initiated_at timestamptz not null default clock_timestamp(),
  confirmed_at timestamptz,
  confirmed_by_label text check (char_length(confirmed_by_label) between 1 and 100),
  check ((confirmed_at is null) = (confirmed_by_label is null))
);
create unique index research_storage_cleanup_one_open_attempt
  on public.research_storage_cleanup_attempts(bucket_id,transfer_id) where confirmed_at is null;
alter table public.research_storage_cleanup_attempts enable row level security;
revoke all on public.research_storage_cleanup_attempts from public,anon,authenticated,service_role;

-- Completion must be durably registered AND the workflow terminal. Ready CSVs
-- are never cleanup candidates. A stale active pending row is review-only.
-- The immediate override is only for named synthetic integration fixtures; the
-- operator CLI additionally restricts it to the exact Development project.
create function public.list_research_storage_cleanup(
  p_transfer_id uuid default null, p_synthetic_immediate boolean default false
) returns table(bucket_id text, transfer_id uuid, storage_path text, reason text,
  eligible boolean, object_present boolean, completion_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with transfers as (
    select 'blindstats-research-v1'::text as bucket_id,t.id as transfer_id,t.storage_path,
      t.created_at,t.study_id,t.workflow_id,null::uuid as request_id,'incomplete_dataset'::text as reason
      from public.research_transfers t where t.state='pending'
    union all
    select 'blindstats-secret-v1',t.id,t.storage_path,t.created_at,r.study_id,r.workflow_id,r.id,
      case when t.ready_at is null then 'incomplete_secret' else 'completed_secret' end
      from public.unblinding_secret_transfers t join public.unblinding_requests r on r.id=t.request_id
  ), candidates as (
    select t.bucket_id,t.transfer_id,t.storage_path,t.reason,t.created_at,
      c.registered_at as completion_at,
      (w.state='unblinded' and c.id is not null and
        (c.registered_at <= now()-interval '24 hours' or
          (p_synthetic_immediate is true and s.name like '[INTEGRATION TEST]%'))) as eligible,
      exists(select 1 from storage.objects o where o.bucket_id=t.bucket_id and o.name=t.storage_path) as object_present,
      exists(select 1 from public.research_storage_cleanup_attempts a where a.bucket_id=t.bucket_id
        and a.transfer_id=t.transfer_id and a.confirmed_at is null) as open_attempt
    from transfers t join public.studies s on s.id=t.study_id
    join public.blinding_workflows w on w.id=t.workflow_id and w.study_id=t.study_id
    left join public.unblinding_completions c on c.workflow_id=t.workflow_id and c.study_id=t.study_id
      and (t.request_id is null or c.request_id=t.request_id)
    where (p_transfer_id is null or t.transfer_id=p_transfer_id)
      and t.storage_path=t.study_id::text||'/'||t.transfer_id::text||'.bin'
      and (p_synthetic_immediate is not true or s.name like '[INTEGRATION TEST]%')
  )
  select c.bucket_id,c.transfer_id,c.storage_path,c.reason,c.eligible,c.object_present,c.completion_at
  from candidates c where
    (c.eligible and (c.object_present or c.open_attempt))
    or (not c.eligible and c.reason<>'completed_secret' and c.created_at <= now()-interval '24 hours')
  order by c.eligible desc,c.created_at,c.transfer_id limit 100;
$$;

-- Write intent before using Storage API. Retry the same open intent after an
-- interrupted run. A later reappearing object creates a new audited attempt.
create function public.begin_research_storage_cleanup(p_bucket_id text,p_transfer_id uuid,
  p_operator_label text,p_synthetic_immediate boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_candidate record; v_id uuid;
begin
  if p_operator_label is null or char_length(btrim(p_operator_label)) not between 1 and 100 then
    raise exception 'Operator label required.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_bucket_id||p_transfer_id::text,0));
  select * into v_candidate from public.list_research_storage_cleanup(p_transfer_id,p_synthetic_immediate) c
    where c.bucket_id=p_bucket_id and c.eligible;
  if not found then raise exception 'Transfer is not eligible for cleanup.'; end if;
  select a.id into v_id from public.research_storage_cleanup_attempts a
    where a.bucket_id=p_bucket_id and a.transfer_id=p_transfer_id and a.confirmed_at is null;
  if found then return v_id; end if;
  insert into public.research_storage_cleanup_attempts(bucket_id,transfer_id,storage_path,reason,operator_label)
    values(p_bucket_id,p_transfer_id,v_candidate.storage_path,v_candidate.reason,btrim(p_operator_label)) returning id into v_id;
  return v_id;
end; $$;

-- Confirm only after Storage API succeeded (or a prior attempt removed the
-- object) and database Storage metadata no longer lists it. This does not
-- assert provider backup erasure or deletion from recipients' computers.
create function public.confirm_research_storage_cleanup(p_attempt_id uuid,p_operator_label text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.research_storage_cleanup_attempts%rowtype;
begin
  if p_operator_label is null or char_length(btrim(p_operator_label)) not between 1 and 100 then
    raise exception 'Operator label required.';
  end if;
  select * into a from public.research_storage_cleanup_attempts where id=p_attempt_id for update;
  if not found then raise exception 'Unknown cleanup attempt.'; end if;
  if exists(select 1 from storage.objects o where o.bucket_id=a.bucket_id and o.name=a.storage_path) then
    raise exception 'Storage object still exists.';
  end if;
  if a.confirmed_at is not null then return; end if;
  update public.research_storage_cleanup_attempts set confirmed_at=clock_timestamp(),confirmed_by_label=btrim(p_operator_label)
    where id=a.id;
end; $$;

revoke all on function public.list_research_storage_cleanup(uuid,boolean),
  public.begin_research_storage_cleanup(text,uuid,text,boolean),
  public.confirm_research_storage_cleanup(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.list_research_storage_cleanup(uuid,boolean),
  public.begin_research_storage_cleanup(text,uuid,text,boolean),
  public.confirm_research_storage_cleanup(uuid,text) to service_role;
-- Read-only operator audit, no direct mutation through service-role Data API.
grant select on public.research_storage_cleanup_attempts to service_role;
commit;
