-- Behaviour of 20261112100000_find_buyers_clear_results (applied twice before this runs).
\set ON_ERROR_STOP on
do $$
declare
  prop uuid := 'aaaaaaaa-0000-0000-0000-00000000c1ea';
  prop2 uuid := 'aaaaaaaa-0000-0000-0000-00000000c1eb';
  pv jsonb; res jsonb; res2 jsonb; n int; ok boolean;
begin
  /* a stranger can neither preview nor clear someone else's property */
  perform set_config('app.uid', '22222222-2222-2222-2222-222222222222', true);
  begin perform public.find_buyers_clear_results(prop); raise exception 'stranger cleared'; exception when others then
    if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  begin perform public.find_buyers_clear_results_preview(prop); raise exception 'stranger previewed'; exception when others then
    if sqlerrm <> 'FORBIDDEN' then raise; end if; end;

  perform set_config('app.uid', '11111111-1111-1111-1111-111111111111', true);
  pv := public.find_buyers_clear_results_preview(prop);
  if (pv->>'leads')::int <> 2 then raise exception 'preview leads %', pv; end if;            -- finished search, current, not rejected
  if (pv->>'legacyMatches')::int <> 1 then raise exception 'preview legacy %', pv; end if;   -- NEW only (UNLOCKED kept, REJECTED not shown)
  if (pv->>'legacyUnlockedKept')::int <> 1 then raise exception 'preview unlocked %', pv; end if;
  if not (pv->>'activeCampaign')::boolean then raise exception 'preview active %', pv; end if;
  /* the preview changes nothing */
  select count(*) into n from public.find_buyers_leads where owner_cleared_at is not null;
  if n <> 0 then raise exception 'preview wrote'; end if;

  res := public.find_buyers_clear_results(prop);
  /* the counts are what the preview showed; the rejected and the stale lead are stamped, not counted */
  if (res->>'leadsCleared')::int <> (pv->>'leads')::int then raise exception 'cleared leads % vs preview %', res, pv; end if;
  if (res->>'legacyMatchesCleared')::int <> (pv->>'legacyMatches')::int then raise exception 'cleared legacy % vs preview %', res, pv; end if;
  select count(*) into n from public.find_buyers_leads where property_id = prop and owner_cleared_at is not null;
  if n <> 4 then raise exception 'stamped leads: %', n; end if;                              -- 2 shown + rejected + stale; not the running search's
  select count(*) into n from public.matches where property_id = prop and owner_cleared_at is not null;
  if n <> 2 then raise exception 'stamped legacy: %', n; end if;                             -- NEW + REJECTED, never UNLOCKED
  /* the running search's lead is untouched and still current */
  select count(*) into n from public.find_buyers_current_leads where property_id = prop;
  if n <> 1 then raise exception 'current leads after clear: %', n; end if;
  select count(*) into n from public.matches where property_id = prop and job_id = 'bbbbbbbb-0000-0000-0000-00000000d0e2' and owner_cleared_at is null;
  if n <> 1 then raise exception 'running search legacy match cleared'; end if;
  select count(*) into n from public.matches where property_id = prop and status = 'UNLOCKED' and owner_cleared_at is null;
  if n <> 1 then raise exception 'unlocked contact hidden'; end if;
  /* the stranger's rows are untouched; nothing was deleted */
  select count(*) into n from public.matches where property_id = prop2 and owner_cleared_at is null;
  if n <> 1 then raise exception 'other property touched'; end if;
  select count(*) into n from public.find_buyers_leads where property_id = prop;
  if n <> 5 then raise exception 'rows deleted: %', n; end if;
  /* the finished search is marked; the running one is not; its opportunities stay hidden */
  select owner_cleared_at is not null into ok from public.find_buyers_campaigns where matching_job_id = 'bbbbbbbb-0000-0000-0000-00000000d0e1';
  if not ok then raise exception 'finished campaign not marked'; end if;
  select owner_cleared_at is null into ok from public.find_buyers_campaigns where matching_job_id = 'bbbbbbbb-0000-0000-0000-00000000d0e2';
  if not ok then raise exception 'running campaign marked'; end if;
  select count(*) into n from public.find_buyers_research_opportunities('bbbbbbbb-0000-0000-0000-00000000d0e1');
  if n <> 0 then raise exception 'opportunities of a cleared search shown'; end if;
  /* idempotent */
  res2 := public.find_buyers_clear_results(prop);
  if (res2->>'leadsCleared')::int <> 0 or (res2->>'legacyMatchesCleared')::int <> 0 then raise exception 'not idempotent %', res2; end if;
end $$;
select has_function_privilege('anon', 'public.find_buyers_clear_results(uuid)', 'execute') as anon_can_clear;
select 'FIND BUYERS CLEAR RESULTS CHECKS PASS';
