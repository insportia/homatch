-- Verify: one admin-editable fixed price, charged only on delivery; 30-day
-- report validity (20261127090000_verify_fixed_price_validity.sql).
-- Runs after the migration, on a fresh scratch database (never production).
do $$
declare
  a_auth uuid := '00000000-0000-4000-8000-0000000001a1';   -- admin
  a_row  uuid := '00000000-0000-4000-8000-0000000001a2';
  c_auth uuid := '00000000-0000-4000-8000-0000000001c1';   -- customer
  c_row  uuid := '00000000-0000-4000-8000-0000000001c2';
  j uuid; j2 uuid; j3 uuid; j4 uuid; j5 uuid; jold uuid; jfail uuid;
  r jsonb; q jsonb; bal numeric; n integer; v_exp timestamptz; v_cut timestamptz;
begin
  insert into public.users (id, auth_id, is_admin, email) values (a_row, a_auth, true, 'admin@example.test'), (c_row, c_auth, false, 'c@example.test');
  insert into public.credit_accounts (user_id, balance) values (c_row, 200);
  insert into public.credit_lots (user_id, kind, credits_granted, source_type) values (c_row, 'PURCHASED', 200, 'TOPUP');

  -- F0. The migration made VERIFY a fixed $1.90 = 19 credits, recorded in the audit log.
  q := public.verify_fixed_price();
  if q->>'mode' <> 'FIXED' or (q->>'cents')::numeric <> 190 or (q->>'credits')::numeric <> 19 then raise exception 'F0: %', q; end if;
  if (select pricing_kind from public.finance_services where service_key = 'verify') <> 'FIXED' then raise exception 'F0: finance service not FIXED'; end if;
  if not exists (select 1 from public.admin_audit_log where action = 'VERIFY_PRICE_UPDATED' and entity_id = 'VERIFY') then raise exception 'F0: no audit row'; end if;

  -- F1. The launch quote shows the one price, the same for every engine.
  perform set_config('request.jwt.claim.sub', c_auth::text, true);
  q := public.verify_launch_quote();
  if q->>'priceMode' <> 'FIXED' or (q->>'maxCredits')::numeric <> 19 or (q->>'usdCents')::numeric <> 190 or (q->>'validityDays')::int <> 30 then raise exception 'F1: %', q; end if;
  perform set_config('request.jwt.claim.sub', '', true);

  -- F2. A purchase holds exactly 19 and the gate never pauses it, however costly the run.
  insert into public.research_jobs (user_id, result_json) values (c_auth, '{"_cost":{"identity":{"input_tokens":900000,"output_tokens":90000}}}') returning id into j;
  r := public.verify_billing_open(j, c_auth, 'verify:fixed:j:s1', false, null, 19);
  if not (r->>'ok')::boolean or (r->>'reservedCredits')::numeric <> 19 or r->>'priceMode' <> 'FIXED' then raise exception 'F2: %', r; end if;
  if (public.verify_budget_gate(j, 'SYNTHESIS')->>'decision') <> 'GO' then raise exception 'F2: gate paused a fixed-price run'; end if;
  if (public.verify_billing_state(j)->>'canExtend')::boolean then raise exception 'F2: a fixed run offers an extension'; end if;

  -- F3. A refresh / retried start never holds twice.
  r := public.verify_billing_open(j, c_auth, 'verify:fixed:j:s1', false, null, 19);
  if not (r->>'duplicate')::boolean then raise exception 'F3: %', r; end if;
  if (select count(*) from public.usage_reservations where job_ref = j::text) <> 1 then raise exception 'F3: two reservations'; end if;

  -- F4. Delivered: exactly 19 credits, once, whatever the cost; closing again charges nothing more.
  r := public.verify_billing_close(j, 'COMPLETE');
  if (r->>'charged')::numeric <> 19 then raise exception 'F4: charged %', r; end if;
  r := public.verify_billing_close(j, 'COMPLETE');
  if (select charged_total_credits from public.verify_billing where job_id = j) <> 19 then raise exception 'F4: double charge'; end if;
  select balance into bal from public.credit_accounts where user_id = c_row;
  if bal <> 181 then raise exception 'F4: balance % (expected 181)', bal; end if;
  if not (select needs_review from public.verify_billing where job_id = j) then raise exception 'F4: a run above its price is not flagged for finance'; end if;

  -- F5. Stopped, then resumed, then delivered: the stop is free, the delivery is 19.
  insert into public.research_jobs (user_id) values (c_auth) returning id into j2;
  perform public.verify_billing_open(j2, c_auth, 'verify:fixed:j2:s1', false, null, 19);
  r := public.verify_billing_close(j2, 'STOPPED');
  if (r->>'charged')::numeric <> 0 then raise exception 'F5: a stop was charged %', r; end if;
  select balance into bal from public.credit_accounts where user_id = c_row;
  if bal <> 181 then raise exception 'F5: balance after stop %', bal; end if;
  r := public.verify_billing_open(j2, c_auth, 'verify:fixed:j2:r1:s2', true, 1, null);
  if not (r->>'ok')::boolean or (r->>'reservedCredits')::numeric <> 19 then raise exception 'F5: resume %', r; end if;
  if (select count(*) from public.verify_billing_authorizations where job_id = j2) <> 1 then raise exception 'F5: resume added an authorisation'; end if;
  r := public.verify_billing_close(j2, 'COMPLETE');
  if (select charged_total_credits from public.verify_billing where job_id = j2) <> 19 then raise exception 'F5: delivered %', r; end if;

  -- F6. A failed run costs nothing.
  insert into public.research_jobs (user_id) values (c_auth) returning id into j3;
  perform public.verify_billing_open(j3, c_auth, 'verify:fixed:j3:s1', false, null, 19);
  r := public.verify_billing_close(j3, 'SYSTEM_FAILED');
  if (r->>'charged')::numeric <> 0 or (select charged_total_credits from public.verify_billing where job_id = j3) <> 0 then raise exception 'F6: %', r; end if;

  -- F7. Only an admin may change the price; a price that is not whole credits is refused, never rounded.
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', c_auth::text, true);
  begin perform public.admin_set_verify_price(2500, 'customer tries'); raise exception 'F7: customer changed the price';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub', a_auth::text, true);
  begin perform public.admin_set_verify_price(195, 'half credit'); raise exception 'F7: 19.5 credits accepted';
  exception when others then if sqlerrm not like '%PRICE_NOT_WHOLE_CREDITS%' then raise; end if; end;
  begin perform public.admin_set_verify_price(250, ''); raise exception 'F7: no reason accepted';
  exception when others then if sqlerrm not like '%REASON_REQUIRED%' then raise; end if; end;

  -- F8. A job started at 19 keeps 19 when the admin moves the price to 25 mid-run.
  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into public.research_jobs (user_id) values (c_auth) returning id into j4;
  perform public.verify_billing_open(j4, c_auth, 'verify:fixed:j4:s1', false, null, 19);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  q := public.admin_set_verify_price(250, 'test increase');
  if (q->>'credits')::numeric <> 25 then raise exception 'F8: %', q; end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.verify_billing_close(j4, 'COMPLETE');
  if (select charged_total_credits from public.verify_billing where job_id = j4) <> 19 then raise exception 'F8: price change was retroactive'; end if;

  -- F9. A start quoted at 19 after the change is refused, not debited 25; quoted at 25 it charges 25.
  insert into public.research_jobs (user_id) values (c_auth) returning id into j5;
  r := public.verify_billing_open(j5, c_auth, 'verify:fixed:j5:s1', false, null, 19);
  if r->>'reason' <> 'PRICE_CHANGED' or (r->>'priceCredits')::numeric <> 25 then raise exception 'F9: %', r; end if;
  if exists (select 1 from public.verify_billing where job_id = j5) then raise exception 'F9: a refused start left a billing row'; end if;
  r := public.verify_billing_open(j5, c_auth, 'verify:fixed:j5:s1b', false, null, 25);
  perform public.verify_billing_close(j5, 'COMPLETE');
  if (select charged_total_credits from public.verify_billing where job_id = j5) <> 25 then raise exception 'F9: charged % at 25', (select charged_total_credits from public.verify_billing where job_id = j5); end if;

  -- F10. Restored to 19; history shows every change with its reason.
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', a_auth::text, true);
  q := public.admin_set_verify_price(190, 'test restore');
  select count(*) into n from public.admin_verify_price_history(20);
  if n < 3 then raise exception 'F10: history has % rows', n; end if;
  if (select reason from public.admin_verify_price_history(1)) <> 'test restore' then raise exception 'F10: newest reason'; end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  if (public.verify_fixed_price()->>'credits')::numeric <> 19 then raise exception 'F10: not restored'; end if;

  -- F11. 30-day validity: registered when the report is delivered, from completed_at.
  -- (now() is after the migration's cutover; an earlier completion is F14.)
  update public.research_jobs set status = 'COMPLETE', completed_at = now(), synthesis_state = 'PENDING' where id = j;
  if exists (select 1 from public.retention_records where source_id = j) then raise exception 'F11: registered before READY'; end if;
  update public.research_jobs set synthesis_state = 'READY' where id = j;
  select expires_at into v_exp from public.retention_records where product = 'VERIFY_REPORT' and source_id = j;
  if v_exp is distinct from public.retention_expiry(now()) or v_exp - now() <> interval '30 days' then raise exception 'F11: expires_at %', v_exp; end if;
  if (select available_at from public.retention_records where source_id = j) <> now() then raise exception 'F11: available_at is not completed_at'; end if;
  if public.retention_access_blocked('VERIFY_REPORT', j) then raise exception 'F11: blocked before its deadline'; end if;

  -- F12. The boundary: available one minute before the deadline, refused from the exact deadline on.
  insert into public.research_jobs (user_id) values (c_auth) returning id into jold;
  update public.research_jobs set status = 'COMPLETE', completed_at = now(), synthesis_state = 'READY' where id = jold;
  update public.retention_records set expires_at = now() + interval '1 minute' where source_id = jold;  -- 29 days 23:59 later
  if public.retention_access_blocked('VERIFY_REPORT', jold) then raise exception 'F12: blocked a minute early'; end if;
  update public.retention_records set expires_at = now() where source_id = jold;  -- the deadline, reached
  if not public.retention_access_blocked('VERIFY_REPORT', jold) then raise exception 'F12: still open at the deadline'; end if;
  -- F13. Expiry removes access, never the money or the audit trail.
  if not exists (select 1 from public.verify_billing where job_id = j) or not exists (select 1 from public.usage_reservations where job_ref = j::text)
     or not exists (select 1 from public.research_jobs where id = jold) then raise exception 'F13: records deleted'; end if;

  -- F14. A failed job gets no expiry; a report delivered before the cutover stays permanent.
  insert into public.research_jobs (user_id, status, synthesis_state) values (c_auth, 'FAILED', 'NONE') returning id into jfail;
  update public.research_jobs set synthesis_state = 'FAILED', completed_at = now() where id = jfail;
  if exists (select 1 from public.retention_records where source_id = jfail) then raise exception 'F14: failed job registered'; end if;
  select (value->>'effective_at')::timestamptz into v_cut from public.admin_settings where key = 'verify_report_validity';
  insert into public.research_jobs (user_id) values (c_auth) returning id into j3;
  update public.research_jobs set status = 'COMPLETE', completed_at = v_cut - interval '1 second', synthesis_state = 'READY' where id = j3;
  if exists (select 1 from public.retention_records where source_id = j3) then raise exception 'F14: a pre-cutover report was given an expiry'; end if;

  -- F15. A regenerated report never moves its expiry.
  update public.research_jobs set synthesis_state = 'PENDING' where id = j;
  update public.research_jobs set synthesis_state = 'READY' where id = j;
  if (select count(*) from public.retention_records where source_id = j) <> 1
     or (select expires_at from public.retention_records where source_id = j) <> v_exp then raise exception 'F15: expiry moved'; end if;

  raise notice 'verify_fixed_price: F0-F15 passed';
end $$;

-- Jobs opened before the fixed price keep the cost-based path (in-flight safety).
do $$
declare
  u uuid := '00000000-0000-4000-8000-0000000001d1';
  j uuid; r jsonb;
begin
  insert into public.users (id, auth_id) values (u, u);
  insert into public.credit_accounts (user_id, balance) values (u, 100);
  insert into public.credit_lots (user_id, kind, credits_granted, source_type) values (u, 'PURCHASED', 100, 'TOPUP');
  insert into public.research_jobs (user_id, result_json) values (u, '{"_cost":{"identity":{"input_tokens":200000,"output_tokens":20000}}}') returning id into j;
  -- A billing row from before the migration: no price snapshot.
  update public.billable_products set billing_mode = 'VARIABLE' where code = 'VERIFY';
  r := public.verify_billing_open(j, u, 'verify:legacy:j:s1');
  update public.billable_products set billing_mode = 'FIXED' where code = 'VERIFY';
  update public.verify_billing set price_mode = null where job_id = j;
  if (r->>'reservedCredits')::numeric <> 25 then raise exception 'L1: legacy open %', r; end if;
  r := public.verify_billing_close(j, 'COMPLETE');
  if (r->>'priceMode') is not null then raise exception 'L1: legacy job closed as fixed %', r; end if;
  if (r->>'charged')::numeric = 19 then raise exception 'L1: legacy job charged the fixed price'; end if;
  raise notice 'verify_fixed_price: in-flight cost-based job closed on its own rules (charged %)', r->>'charged';
end $$;
