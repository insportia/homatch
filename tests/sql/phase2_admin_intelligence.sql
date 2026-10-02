-- admin_discovery_intelligence: refuses non-admins, answers admins with every section.
do $$
declare v jsonb;
begin
  insert into public.supply_entities(observation_count, source_count, city) values (3, 2, 'batumi');
  insert into public.supply_observations(adapter_id, structured_quality) values ('telegram-community', 0.8);
  insert into public.supply_resolution_decisions(verdict) values ('LIKELY_SAME_ENTITY');
  begin
    perform public.admin_discovery_intelligence();
    raise exception 'a non-admin was answered';
  exception when others then
    if sqlerrm <> 'FORBIDDEN' then raise; end if;
  end;
  perform set_config('app.admin', 'on', true);
  v := public.admin_discovery_intelligence();
  if not (v ? 'runs' and v ? 'queue' and v ? 'live_checks' and v ? 'supply_by_adapter' and v ? 'entities'
          and v ? 'resolution_7d' and v ? 'matches' and v ? 'community_supply' and v ? 'plans_7d') then
    raise exception 'missing section: %', v;
  end if;
  if (v->'entities'->>'multi_source')::int < 1 then raise exception 'clusters not counted'; end if;
  if (v->'community_supply'->>'stored_as_supply')::int < 1 then raise exception 'community supply not counted'; end if;
  raise notice 'ADMIN INTELLIGENCE CHECKS: PASS';
end $$;
