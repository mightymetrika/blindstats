-- v46 release hardening: no data deletion or historical migration edits.
begin;

-- Keep buffered authenticated Vercel downloads below its 4.5 MB limit.
-- Fail rather than strand existing larger Development objects. An operator
-- must resolve any such object explicitly before applying this migration.
do $$
begin
  if exists (select 1 from public.research_transfers where ciphertext_byte_length > 4194304)
    or exists (select 1 from storage.objects where bucket_id = 'blindstats-research-v1'
      and (metadata->>'size')::bigint > 4194304) then
    raise exception 'Existing research object exceeds 4 MiB; review it before migration.';
  end if;
end;
$$;
update storage.buckets set public=false, file_size_limit=4194304
where id='blindstats-research-v1';
alter table public.research_transfers add constraint research_transfer_hosted_size_limit
  check (ciphertext_byte_length <= 4194304);

-- Restrictive policies AND with all permissive policies, including policies
-- that might be added for unrelated Storage buckets in the future.
create policy research_transfer_storage_insert_guard on storage.objects
  as restrictive for insert to authenticated with check (
    bucket_id <> 'blindstats-research-v1' or exists (
      select 1 from public.research_transfers t
      join public.blinding_workflows w on w.id=t.workflow_id and w.study_id=t.study_id
      where t.storage_path=storage.objects.name and t.state='pending' and w.state='blinded'
        and t.sender_id=(select auth.uid())
        and public.is_research_transfer_custodian(t.study_id,(select auth.uid()))
        and public.is_research_transfer_analyst(t.study_id,t.recipient_id)
    ));
create policy research_transfer_storage_no_anon_insert on storage.objects
  as restrictive for insert to anon with check (bucket_id <> 'blindstats-research-v1');
create policy research_transfer_storage_no_read on storage.objects
  as restrictive for select to authenticated, anon using (bucket_id <> 'blindstats-research-v1');
create policy research_transfer_storage_no_update on storage.objects
  as restrictive for update to authenticated, anon using (bucket_id <> 'blindstats-research-v1')
  with check (bucket_id <> 'blindstats-research-v1');
create policy research_transfer_storage_no_delete on storage.objects
  as restrictive for delete to authenticated, anon using (bucket_id <> 'blindstats-research-v1');
commit;
