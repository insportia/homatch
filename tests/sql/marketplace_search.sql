-- MARKETPLACE SEARCH FOUNDATION: behavioural checks after applying
-- 20261010100000_marketplace_search_foundation.sql twice (run-marketplace.sh).
do $$
declare
  u uuid; s uuid; r uuid; n int; v jsonb;
begin
  insert into public.users default values returning id into u;

  -- switch seeded OFF
  if (select value #>> '{}' from public.admin_settings where key = 'marketplace_search_enabled') <> 'false' then
    raise exception 'marketplace_search_enabled is not seeded false';
  end if;

  -- a plan kind exists and defaults to DISCOVERY
  insert into public.discovery_search_plans(direction, user_id, market, plan) values ('SUPPLY', u, 'GE', '{}') returning id into s;
  if (select plan_kind from public.discovery_search_plans where id = s) <> 'DISCOVERY' then raise exception 'plan_kind default'; end if;
  begin
    update public.discovery_search_plans set plan_kind = 'OTHER' where id = s;
    raise exception 'bad plan_kind accepted';
  exception when check_violation then null; end;

  -- a worker cannot be enabled unless ACTIVE
  begin
    insert into public.discovery_marketplace_workers(worker_id, source_key, source_name, execution_mode, enabled)
    values ('test-worker', 'source-a', 'A', 'BROWSER', true);
    raise exception 'enabled REGISTERED worker accepted';
  exception when check_violation then null; end;
  insert into public.discovery_marketplace_workers(worker_id, source_key, source_name, execution_mode, state, enabled,
    supported_markets, supported_property_types, supported_transaction_types, token_hash)
  values ('test-worker', 'source-a', 'A', 'BROWSER', 'PROVEN', false, '{GE}', '{APARTMENT}', '{BUY}', repeat('a', 64));

  insert into public.discovery_marketplace_searches(user_id, search_plan_id, idempotency_key, status, brief, request, deadline_at)
  values (u, s, 'key-000001', 'DISPATCHING', '{}', '{}', now() + interval '10 minutes') returning id into s;
  insert into public.discovery_marketplace_worker_runs(search_id, worker_id, request, deadline_at)
  values (s, 'test-worker', '{}', now() + interval '5 minutes') returning id into r;

  -- a PROVEN (not ACTIVE) worker gets nothing
  select count(*) into n from public.claim_marketplace_worker_runs('test-worker', 5);
  if n <> 0 then raise exception 'non-active worker claimed work'; end if;
  update public.discovery_marketplace_workers set state = 'ACTIVE', enabled = true where worker_id = 'test-worker';
  select count(*) into n from public.claim_marketplace_worker_runs('test-worker', 5);
  if n <> 1 then raise exception 'active worker could not claim (%)', n; end if;
  select count(*) into n from public.claim_marketplace_worker_runs('test-worker', 5);
  if n <> 0 then raise exception 'claimed twice'; end if;
  if (select status from public.discovery_marketplace_worker_runs where id = r) <> 'SEARCHING' then raise exception 'claim did not start the run'; end if;

  -- listings are unique per search/source/id; unsafe URLs refused
  insert into public.discovery_marketplace_listings(search_id, worker_run_id, source_key, source_listing_id, exact_url, raw, observed_at)
  values (s, r, 'source-a', '1', 'https://a.example/1', '{}', now());
  begin
    insert into public.discovery_marketplace_listings(search_id, worker_run_id, source_key, source_listing_id, exact_url, raw, observed_at)
    values (s, r, 'source-a', '2', 'javascript:alert(1)', '{}', now());
    raise exception 'unsafe url accepted';
  exception when check_violation then null; end;

  insert into public.discovery_marketplace_properties(search_id, property_key, result_group, rank, score, view, internal)
  values (s, 'source-a:1', 'BEST', 1, 0.9, '{"sourceCount":1}', '{"components":{}}');

  -- bad status refused
  begin
    update public.discovery_marketplace_searches set status = 'DONE' where id = s;
    raise exception 'bad search status accepted';
  exception when check_violation then null; end;

  -- admin RPC: refuses non-admins, answers admins
  begin
    perform public.admin_marketplace_search_intelligence(null);
    raise exception 'a non-admin was answered';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  perform set_config('app.admin', 'on', true);
  v := public.admin_marketplace_search_intelligence(null);
  if not (v ? 'workers' and v ? 'searches' and v ? 'enabled') then raise exception 'overview sections: %', v; end if;
  if (v ->> 'enabled')::boolean then raise exception 'reports enabled'; end if;
  if v::text like '%' || repeat('a', 64) || '%' then raise exception 'token hash leaked'; end if;
  v := public.admin_marketplace_search_intelligence(s);
  if jsonb_array_length(v -> 'worker_runs') <> 1 or jsonb_array_length(v -> 'properties') <> 1 then raise exception 'detail: %', v; end if;
  perform set_config('app.admin', '', true);

  -- cascade: deleting a search removes its runs, listings, properties
  delete from public.discovery_marketplace_searches where id = s;
  if exists (select 1 from public.discovery_marketplace_listings where search_id = s) then raise exception 'cascade'; end if;

  raise notice 'MARKETPLACE SEARCH CHECKS: PASS';
end $$;

-- concurrency: runs of one search are claimable in parallel by different workers; per-provider and
-- global bounds hold; the retry budget is enforced; a claim sets an independent lease.
do $$
declare u uuid; s1 uuid; s2 uuid; n int; lease timestamptz;
begin
  insert into public.users default values returning id into u;
  insert into public.discovery_marketplace_workers(worker_id, source_key, source_name, execution_mode, state, enabled, max_concurrency, max_attempts)
  values ('w-a', 'a', 'A', 'HTTP', 'ACTIVE', true, 1, 2), ('w-b', 'b', 'B', 'BROWSER', 'ACTIVE', true, 2, 3);
  insert into public.discovery_marketplace_searches(user_id, idempotency_key, status, brief, request) values (u, 'conc-00001', 'DISPATCHING', '{}', '{}') returning id into s1;
  insert into public.discovery_marketplace_searches(user_id, idempotency_key, status, brief, request) values (u, 'conc-00002', 'DISPATCHING', '{}', '{}') returning id into s2;
  insert into public.discovery_marketplace_worker_runs(search_id, worker_id, request, deadline_at) values
    (s1, 'w-a', '{}', now() + interval '10 minutes'), (s2, 'w-a', '{}', now() + interval '10 minutes'),
    (s1, 'w-b', '{}', now() + interval '10 minutes'), (s2, 'w-b', '{}', now() + interval '10 minutes');

  -- w-b is not blocked by w-a: both workers hold leases on the SAME search at once
  select count(*) into n from public.claim_marketplace_worker_runs('w-a', 5, 60);
  if n <> 1 then raise exception 'per-provider bound 1 gave %', n; end if;
  select count(*) into n from public.claim_marketplace_worker_runs('w-b', 5, 60);
  if n <> 2 then raise exception 'w-b should claim both runs in parallel, got %', n; end if;
  select count(*) into n from public.claim_marketplace_worker_runs('w-a', 5, 60);
  if n <> 0 then raise exception 'w-a exceeded its bound (%)', n; end if;
  select lease_expires_at into lease from public.discovery_marketplace_worker_runs where worker_id = 'w-a' and status = 'SEARCHING';
  if lease is null or lease > now() + interval '61 seconds' then raise exception 'lease not set/capped: %', lease; end if;

  -- global bound: 3 live leases, limit 3 → nothing more for anyone
  insert into public.admin_settings(key, value) values ('marketplace_max_concurrent_runs', '3'::jsonb)
    on conflict (key) do update set value = excluded.value;
  update public.discovery_marketplace_workers set max_concurrency = 5 where worker_id = 'w-a';
  select count(*) into n from public.claim_marketplace_worker_runs('w-a', 5, 60);
  if n <> 0 then raise exception 'global bound ignored (%)', n; end if;

  -- an expired lease frees its slot
  update public.discovery_marketplace_worker_runs set lease_expires_at = now() - interval '1 second' where worker_id = 'w-b';
  select count(*) into n from public.claim_marketplace_worker_runs('w-a', 5, 60);
  if n <> 1 then raise exception 'expired leases still counted (%)', n; end if;

  -- retry budget: a re-queued run past max_attempts is never claimed again
  update public.discovery_marketplace_worker_runs set status = 'QUEUED', attempts = 2, lease_expires_at = null where worker_id = 'w-a';
  select count(*) into n from public.claim_marketplace_worker_runs('w-a', 5, 60);
  if n <> 0 then raise exception 'claimed beyond max_attempts (%)', n; end if;

  update public.admin_settings set value = '40'::jsonb where key = 'marketplace_max_concurrent_runs';
  raise notice 'MARKETPLACE CONCURRENCY CHECKS: PASS';
end $$;

-- privileges: customers cannot read or write any marketplace table directly; the hash column is never granted
do $$
begin
  if has_table_privilege('authenticated', 'public.discovery_marketplace_listings', 'insert') then raise exception 'authenticated can insert listings'; end if;
  if has_table_privilege('anon', 'public.discovery_marketplace_searches', 'select') then raise exception 'anon can read searches'; end if;
  if has_column_privilege('authenticated', 'public.discovery_marketplace_workers', 'token_hash', 'select') then raise exception 'token_hash readable'; end if;
  if has_function_privilege('authenticated', 'public.claim_marketplace_worker_runs(text, integer, integer)', 'execute') then raise exception 'claim callable by users'; end if;
  raise notice 'MARKETPLACE PRIVILEGE CHECKS: PASS';
end $$;

-- rate limit: per user, per operation, burst then daily window, retry-after, service-role only.
do $$
declare a uuid; b uuid; r jsonb; i int;
begin
  insert into public.users default values returning id into a;
  insert into public.users default values returning id into b;
  for i in 1..3 loop
    r := public.consume_marketplace_rate_limit(a, 'mps_understand', 3, 600, 5, 86400);
    if not (r->>'allowed')::boolean then raise exception 'call % refused early: %', i, r; end if;
  end loop;
  r := public.consume_marketplace_rate_limit(a, 'mps_understand', 3, 600, 5, 86400);
  if (r->>'allowed')::boolean or r->>'window' <> 'BURST' then raise exception 'burst not enforced: %', r; end if;
  if (r->>'retry_after_seconds')::int not between 1 and 600 then raise exception 'retry-after: %', r; end if;
  r := public.consume_marketplace_rate_limit(b, 'mps_understand', 3, 600, 5, 86400);
  if not (r->>'allowed')::boolean then raise exception 'another user was limited: %', r; end if;
  r := public.consume_marketplace_rate_limit(a, 'other_op', 3, 600, 5, 86400);
  if not (r->>'allowed')::boolean then raise exception 'another operation was limited: %', r; end if;
  -- daily window: age the burst out, then the daily limit holds
  update public.rate_limit_events set created_at = now() - interval '20 minutes' where user_id = a and operation = 'mps_understand';
  r := public.consume_marketplace_rate_limit(a, 'mps_understand', 3, 600, 5, 86400);
  if not (r->>'allowed')::boolean then raise exception 'burst window did not slide: %', r; end if;
  r := public.consume_marketplace_rate_limit(a, 'mps_understand', 3, 600, 5, 86400);
  r := public.consume_marketplace_rate_limit(a, 'mps_understand', 3, 600, 5, 86400);
  if (r->>'allowed')::boolean or r->>'window' <> 'DAILY' then raise exception 'daily not enforced: %', r; end if;
  if has_function_privilege('authenticated', 'public.consume_marketplace_rate_limit(uuid, text, integer, integer, integer, integer)', 'execute') then
    raise exception 'rate limit callable by users';
  end if;
  raise notice 'MARKETPLACE RATE LIMIT CHECKS: PASS';
end $$;
