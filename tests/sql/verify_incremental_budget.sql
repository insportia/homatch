-- Verify incremental budget (owner rule 2026-10-10): 25 to start, +25 per
-- explicit approval, at most four authorisations / 100 credits, cumulative
-- across every stop and continuation. Real wallet functions (fixture).
do $$
declare
  u uuid := '00000000-0000-4000-8000-0000000000e1';
  poor uuid := '00000000-0000-4000-8000-0000000000e2';
  j1 uuid; j2 uuid; j3 uuid; j4 uuid; j5 uuid;
  r jsonb; g jsonb; p jsonb; c jsonb;
  a numeric; b numeric; total numeric; bal0 numeric; n integer; cents numeric; j6 uuid; j7 uuid;
  small constant jsonb := '{"identity":{"input_tokens":100000,"output_tokens":10000}}';
  medium constant jsonb := '{"identity":{"input_tokens":100000,"output_tokens":10000},"official_collection":{"input_tokens":300000,"output_tokens":30000}}';
begin
  insert into public.credit_accounts (user_id, balance) values (u, 500), (poor, 30);
  insert into public.credit_lots (user_id, kind, credits_granted, source_type) values (u, 'PURCHASED', 500, 'TOPUP'), (poor, 'PURCHASED', 30, 'TOPUP');
  insert into public.research_jobs (user_id) values (u) returning id into j1;
  insert into public.research_jobs (user_id) values (u) returning id into j2;
  insert into public.research_jobs (user_id) values (poor) returning id into j3;
  insert into public.research_jobs (user_id) values (u) returning id into j4;
  insert into public.research_jobs (user_id) values (u) returning id into j5;
  insert into public.research_jobs (user_id) values (u) returning id into j6;
  insert into public.research_jobs (user_id) values (u) returning id into j7;

  -- F. The formula at the brief's landed costs (landed + 10 % contingency) / 0.45 × 1.18, rounded UP to 0.01.
  if (public.verify_price_for_cost(10)->>'credits')::numeric  <> 2.89  then raise exception 'F: $0.10 → %', public.verify_price_for_cost(10); end if;
  if (public.verify_price_for_cost(35)->>'credits')::numeric  <> 10.10 then raise exception 'F: $0.35 → %', public.verify_price_for_cost(35); end if;
  if (public.verify_price_for_cost(70)->>'credits')::numeric  <> 20.20 then raise exception 'F: $0.70 → %', public.verify_price_for_cost(70); end if;
  if (public.verify_price_for_cost(100)->>'credits')::numeric <> 28.85 then raise exception 'F: $1.00 → %', public.verify_price_for_cost(100); end if;
  -- VAT once (owner rule 2026-10-10): raw provider $0.10 is the eligible cost — no 18 % uplift
  -- (the global billing_cogs_tax_bps stays 1800 for other products and is not used by Verify).
  if public.verify_cost_cents(10) <> 10 or public.billing_landed_cogs_cents(10, 0, 0, 0) <> 11.8 then raise exception 'F: Verify cost uplifted'; end if;
  if (public.verify_price_for_cost(public.verify_cost_cents(10))->>'credits')::numeric <> 2.89 then raise exception 'F: raw $0.10'; end if;
  -- VAT is 18 % of the VAT-exclusive price; margin is 55 % of it over landed + contingency.
  p := public.verify_price_for_cost(70);
  if (p->>'vatCents')::numeric <> round((p->>'netCents')::numeric * 0.18, 4) then raise exception 'F: VAT %', p; end if;
  if round(1 - (70 + 7) / (p->>'netCents')::numeric, 4) <> 0.5500 then raise exception 'F: margin %', p; end if;

  -- P. The $1 profit floor (owner rule 2026-10-10) on a COMPLETED report:
  --    net = max((landed + 10 %) / 0.45, landed + $1.00); gross = net × 1.18, credits rounded up.
  p := public.verify_price_for_cost(10, true);
  if (p->>'credits')::numeric <> 12.98 or (p->>'profitCents')::numeric < 100 or not (p->>'floorApplied')::boolean then raise exception 'P: $0.10 %', p; end if;
  p := public.verify_price_for_cost(35, true);
  if (p->>'credits')::numeric <> 15.93 or (p->>'profitCents')::numeric < 100 or not (p->>'floorApplied')::boolean then raise exception 'P: $0.35 %', p; end if;
  p := public.verify_price_for_cost(70, true);
  if (p->>'credits')::numeric <> 20.20 or (p->>'profitCents')::numeric < 100 or (p->>'floorApplied')::boolean then raise exception 'P: $0.70 %', p; end if;
  -- Higher costs: the 55 % margin already leaves more than $1, so nothing is added.
  foreach cents in array array[100, 250, 500, 1500]::numeric[] loop
    p := public.verify_price_for_cost(cents, true);
    if (p->>'floorApplied')::boolean or (p->>'netCents')::numeric <> (p->>'marginNetCents')::numeric
       or (p->>'credits')::numeric <> (public.verify_price_for_cost(cents, false)->>'credits')::numeric then raise exception 'P: extra $1 at %: %', cents, p; end if;
    if round(1 - (cents * 1.10) / (p->>'netCents')::numeric, 4) < 0.5500 then raise exception 'P: margin below 55 %% at %', cents; end if;
  end loop;
  if (public.verify_price_for_cost(100, true)->>'credits')::numeric <> 28.85 then raise exception 'P: $1.00'; end if;
  -- Every cost from 0.01 ¢ to $20: the charged credits, back in VAT-exclusive dollars,
  -- still leave ≥ $1 over the landed cost and ≥ the 55 % margin price (rounding never eats either).
  for n in 0..400 loop
    cents := n * 5 + 0.01;
    p := public.verify_price_for_cost(cents, true);
    if (p->>'credits')::numeric * 10 / 1.18 < cents + 100 - 0.0001 then raise exception 'P: rounding ate the floor at %: %', cents, p; end if;
    if (p->>'credits')::numeric * 10 / 1.18 < (p->>'marginNetCents')::numeric - 0.0001 then raise exception 'P: rounding ate the margin at %', cents; end if;
    -- VAT once: 18 % of the VAT-exclusive price, nothing else on top.
    if (p->>'grossCents')::numeric <> (p->>'netCents')::numeric + (p->>'vatCents')::numeric
       or abs((p->>'vatCents')::numeric - (p->>'netCents')::numeric * 0.18) > 0.0001 then raise exception 'P: VAT at %: %', cents, p; end if;
  end loop;
  -- No input tax is invented; a genuinely non-recoverable one is a policy number, applied once to the cost.
  if public.verify_cost_cents(35) <> 35 then raise exception 'P: invented input tax'; end if;
  -- A stopped/partial session is not a completed report: margin only, no floor.
  if (public.verify_price_for_cost(10, false)->>'floorApplied')::boolean or (public.verify_price_for_cost(10, false)->>'credits')::numeric <> 2.89 then raise exception 'P: floor on a non-completed charge'; end if;

  -- I1. Initial authorisation: exactly 25, recorded with its own id and key.
  r := public.verify_billing_open(j1, u, 'verify:' || j1 || ':s1');
  if (r->>'reservedCredits')::numeric <> 25 or (r->>'authorizations')::int <> 1 then raise exception 'I1: %', r; end if;
  if (select kind || ':' || credits::text || ':' || idempotency_key from public.verify_billing_authorizations where job_id = j1)
     <> 'INITIAL:25.0000:verify:' || j1 || ':auth1' then raise exception 'I1: ledger row'; end if;
  -- An extension cannot be asked while a session is open: it is the same session.
  r := public.verify_billing_open(j1, u, 'verify:' || j1 || ':x', true, 1);
  if not (r->>'duplicate')::boolean or (r->>'authorizations')::int <> 1 then raise exception 'I1: extension while open %', r; end if;

  -- G. The gate before a stage: GO when it fits, AWAIT when it does not and +25 is possible.
  g := public.verify_budget_gate(j1, 'IDENTITY');
  if g->>'decision' <> 'GO' then raise exception 'G: %', g; end if;
  update public.research_jobs set result_json = jsonb_build_object('_cost', jsonb_build_object('identity',
    jsonb_build_object('input_tokens', 2600000, 'output_tokens', 200000))) where id = j1;   -- $7.60 raw: far beyond 25
  update public.research_jobs set result_json = jsonb_build_object('_cost', jsonb_build_object('identity',
    jsonb_build_object('input_tokens', 200000, 'output_tokens', 15000))) where id = j1;    -- ≈ 19.7 credits used
  g := public.verify_budget_gate(j1, 'MARKET');
  if g->>'decision' <> 'AWAIT' or (g->>'projectedCredits')::numeric <= 25 then raise exception 'G: await %', g; end if;
  if (public.verify_budget_gate(gen_random_uuid(), 'MARKET'))->>'decision' <> 'NONE' then raise exception 'G: none'; end if;
  -- The synthesis is priced as the completed report (floor included) and covers the report it writes.
  g := public.verify_budget_gate(j1, 'SYNTHESIS');
  if (g->>'projectedCredits')::numeric <> (public.verify_price_for_cost((public.verify_job_cost(j1)->>'landedCents')::numeric
       + public.verify_cost_cents(4), true)->>'credits')::numeric then raise exception 'G: synthesis + report %', g; end if;

  -- E. Awaiting approval holds nothing: what was used is settled, the rest returned.
  select balance into bal0 from public.credit_accounts where user_id = u;
  r := public.verify_billing_close(j1, 'STOPPED');
  a := (r->>'charged')::numeric;
  if a <= 0 or a >= 25 or (r->>'released')::numeric <> 25 - a then raise exception 'E: hold %', r; end if;
  if (select reserved from public.credit_accounts where user_id = u) <> 0 then raise exception 'E: still reserved while awaiting'; end if;
  -- The customer approves +25: the remaining authorisation (50 − used) is reserved, one new ledger row.
  r := public.verify_billing_open(j1, u, 'verify:' || j1 || ':r1:s2', true, 1);
  if not (r->>'ok')::boolean or (r->>'authorizedTotal')::numeric <> 50 or (r->>'reservedCredits')::numeric <> 50 - a then raise exception 'E: extend %', r; end if;
  -- A double click (same screen, expected = 1) is the same extension.
  r := public.verify_billing_open(j1, u, 'verify:' || j1 || ':r1:s2b', true, 1);
  if not (r->>'duplicate')::boolean then raise exception 'E: double click %', r; end if;
  if (select count(*) from public.verify_billing_authorizations where job_id = j1) <> 2 then raise exception 'E: two extensions'; end if;
  -- The investigation finishes: the cumulative price, minus what the first session already charged.
  update public.research_jobs set result_json = jsonb_build_object('_cost', jsonb_build_object(
    'identity', jsonb_build_object('input_tokens', 200000, 'output_tokens', 15000),
    'market', jsonb_build_object('input_tokens', 100000, 'output_tokens', 10000))) where id = j1;
  r := public.verify_billing_close(j1, 'COMPLETE');
  b := (r->>'charged')::numeric;
  total := (public.verify_price_for_cost((public.verify_job_cost(j1)->>'landedCents')::numeric, true)->>'credits')::numeric;
  if a + b <> total then raise exception 'E: cumulative % + % <> %', a, b, total; end if;
  if (select balance from public.credit_accounts where user_id = u) <> 500 - total then raise exception 'E: wallet % vs %', (select balance from public.credit_accounts where user_id = u), 500 - total; end if;
  if (select reserved from public.credit_accounts where user_id = u) <> 0 then raise exception 'E: unused credits not released'; end if;
  -- Contingency is a price component only: the recorded cost is the landed cost, never more.
  if exists (select 1 from public.usage_events ue join public.verify_billing_sessions s on s.reservation_id = ue.reservation_id
              where s.job_id = j1 and ue.landed_cogs_cents > (public.verify_job_cost(j1)->>'landedCents')::numeric) then
    raise exception 'E: contingency recorded as cost';
  end if;
  if (select sum(ue.landed_cogs_cents) from public.usage_events ue join public.verify_billing_sessions s on s.reservation_id = ue.reservation_id where s.job_id = j1)
     <> (public.verify_job_cost(j1)->>'landedCents')::numeric then raise exception 'E: landed cost logged twice or lost'; end if;

  -- L. 25 → 50 → 75 → 100, never a fifth; the charge never passes 100.
  perform public.verify_billing_open(j2, u, 'verify:' || j2 || ':s1');
  update public.research_jobs set result_json = jsonb_build_object('_cost', jsonb_build_object('identity',
    jsonb_build_object('input_tokens', 20000000, 'output_tokens', 2000000))) where id = j2;          -- $64 raw
  for n in 2..4 loop
    perform public.verify_billing_close(j2, 'STOPPED');
    r := public.verify_billing_open(j2, u, 'verify:' || j2 || ':s' || n, true, n - 1);
    if (r->>'authorizedTotal')::numeric <> 25 * n then raise exception 'L: step % %', n, r; end if;
  end loop;
  perform public.verify_billing_close(j2, 'STOPPED');
  r := public.verify_billing_open(j2, u, 'verify:' || j2 || ':s5', true, 4);
  if r->>'reason' <> 'BUDGET_LIMIT' or (r->>'maxBudget')::numeric <> 100 then raise exception 'L: fifth %', r; end if;
  if (select count(*) from public.verify_billing_authorizations where job_id = j2) <> 4 then raise exception 'L: count'; end if;
  if (select charged_total_credits from public.verify_billing where job_id = j2) <> 100 then raise exception 'L: charged %', (select charged_total_credits from public.verify_billing where job_id = j2); end if;
  if not (select needs_review from public.verify_billing where job_id = j2) then raise exception 'L: overrun not flagged for finance'; end if;
  if (public.verify_billing_state(j2)->>'canExtend')::boolean then raise exception 'L: can extend at 100'; end if;

  -- S. A stale screen (expected 1 when 2 exist) cannot authorise anything.
  perform public.verify_billing_open(j4, u, 'verify:' || j4 || ':s1');
  update public.research_jobs set result_json = jsonb_build_object('_cost', small) where id = j4;
  perform public.verify_billing_close(j4, 'STOPPED');
  perform public.verify_billing_open(j4, u, 'verify:' || j4 || ':s2', true, 1);
  perform public.verify_billing_close(j4, 'STOPPED');
  r := public.verify_billing_open(j4, u, 'verify:' || j4 || ':s3', true, 1);
  if r->>'reason' <> 'STALE_REQUEST' or (r->>'authorizations')::int <> 2 then raise exception 'S: %', r; end if;
  -- A plain continuation (no approval) reserves what is left, adds no authorisation.
  r := public.verify_billing_open(j4, u, 'verify:' || j4 || ':s4');
  if (r->>'authorizedTotal')::numeric <> 50 or (r->>'authorizations')::int <> 2 then raise exception 'S: continue %', r; end if;
  -- A failure after extensions releases the open session (earlier settled work stays charged).
  select charged_total_credits into a from public.verify_billing where job_id = j4;
  r := public.verify_billing_close(j4, 'SYSTEM_FAILED');
  if (r->>'charged')::numeric <> 0 or (select charged_total_credits from public.verify_billing where job_id = j4) <> a then raise exception 'S: failure %', r; end if;

  -- N. Not enough balance for the extension: nothing authorised, nothing held.
  perform public.verify_billing_open(j3, poor, 'verify:' || j3 || ':s1');
  update public.research_jobs set result_json = jsonb_build_object('_cost', small) where id = j3;
  perform public.verify_billing_close(j3, 'STOPPED');
  update public.credit_accounts set balance = 1 where user_id = poor;
  r := public.verify_billing_open(j3, poor, 'verify:' || j3 || ':s2', true, 1);
  if r->>'reason' <> 'INSUFFICIENT_CREDITS' then raise exception 'N: %', r; end if;
  if (select count(*) from public.verify_billing_authorizations where job_id = j3) <> 1
     or (select authorized_total_credits from public.verify_billing where job_id = j3) <> 25 then raise exception 'N: authorised without money'; end if;

  -- U. No unnecessary question: a typical investigation (p95 stages) passes every gate,
  --    synthesis and its $1 floor included, inside the first 25.
  r := public.verify_billing_open(j6, u, 'verify:' || j6 || ':s1');
  update public.research_jobs set result_json = jsonb_build_object('_cost', jsonb_build_object(
    'identity', jsonb_build_object('input_tokens', 40000, 'output_tokens', 4000))) where id = j6;
  foreach c in array array['"IDENTITY"', '"OFFICIAL"', '"OFFICIAL_COLLECTION"', '"FINANCIAL_ENTITY"', '"PUBLIC_RESEARCH"', '"MARKET"', '"SYNTHESIS"']::jsonb[] loop
    g := public.verify_budget_gate(j6, c #>> '{}');
    if g->>'decision' <> 'GO' then raise exception 'U: asked unnecessarily at %: %', c, g; end if;
  end loop;
  r := public.verify_billing_close(j6, 'COMPLETE');
  if (r->>'charged')::numeric < (public.verify_price_for_cost((public.verify_job_cost(j6)->>'landedCents')::numeric, true)->>'credits')::numeric
     then raise exception 'U: floor not charged on a completed report %', r; end if;
  -- A system failure is refunded in full: no floor, no charge, everything released.
  r := public.verify_billing_open(j5, u, 'verify:' || j5 || ':s1');
  update public.research_jobs set result_json = jsonb_build_object('_cost', small) where id = j5;
  r := public.verify_billing_close(j5, 'SYSTEM_FAILED');
  if (r->>'charged')::numeric <> 0 or (r->>'released')::numeric <> 25
     or (select state from public.verify_billing where job_id = j5) <> 'RELEASED' then raise exception 'U: failure not refunded %', r; end if;
  -- A customer stop (partial report): incurred work at the margin price, no floor.
  r := public.verify_billing_open(j7, u, 'verify:' || j7 || ':s0');
  update public.research_jobs set result_json = jsonb_build_object('_cost', small) where id = j7;
  r := public.verify_billing_close(j7, 'STOPPED');
  if (r->>'charged')::numeric <> (public.verify_price_for_cost((public.verify_job_cost(j7)->>'landedCents')::numeric, false)->>'credits')::numeric
     then raise exception 'U: partial charged with the floor %', r; end if;
  update public.verify_billing set charged_total_credits = 0 where job_id = j7;   -- isolate the next case
  r := public.verify_billing_open(j7, u, 'verify:' || j7 || ':s1');
  update public.research_jobs set result_json = jsonb_build_object('_cost', small) where id = j7;
  update public.verify_billing set authorized_total_credits = 10 where job_id = j7;
  -- (an authorisation too small for the floor: charged up to it, never beyond; recorded for finance)
  r := public.verify_billing_close(j7, 'COMPLETE');
  if (r->>'charged')::numeric <> 10 or not (select needs_review from public.verify_billing where job_id = j7) then raise exception 'U: floor beyond authorisation %', r; end if;
  if not exists (select 1 from public.usage_events ue join public.verify_billing_sessions s on s.reservation_id = ue.reservation_id
                 where s.job_id = j7 and (ue.metadata->>'profit_floor_shortfall')::boolean) then raise exception 'U: floor shortfall not recorded'; end if;

  -- Q. The launch asks for 25, not the 100 maximum.
  if (public.verify_launch_quote()->>'maxCredits')::numeric <> 25 then raise exception 'Q: %', public.verify_launch_quote(); end if;

  raise notice 'verify incremental budget: all checks passed';
end;
$$;
