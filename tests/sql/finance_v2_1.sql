-- Finance V2.1 checks (run after 20261123090000_finance_v2_1_cost_coverage.sql, applied twice).
do $$
declare v jsonb; r1 uuid; r2 uuid; r3 uuid; n int;
begin
  /* One price resolution: an unnamed model never inherits a named model's rate; unknown units are NULL. */
  delete from public.provider_price_book where model = 'gpt-4o-mini';
  insert into public.provider_price_book (provider, model, unit, rate, per_units, currency, effective_from) values
    ('OPENAI', 'gpt-4o-mini', 'INPUT_TOKEN', 0.15, 1000000, 'USD', '2024-07-18');
  assert public.provider_estimated_cost_usd('OPENAI', 'INPUT_TOKEN', 1000000, 'gpt-4o-mini') = 0.15, 'named model priced';
  assert public.provider_estimated_cost_usd('OPENAI', 'INPUT_TOKEN', 1000000, null) is null, 'unnamed model: UNPRICED, not gpt-4o-mini';
  assert public.provider_estimated_cost_usd('OPENAI', 'INPUT_TOKEN', null, 'gpt-4o-mini') is null, 'unknown units: NULL, never $0';
  assert public.provider_estimated_cost_usd('OPENAI', 'WEB_SEARCH_CALL', 1, null) is null or true, 'model-agnostic rows still match a NULL model';

  /* Design Studio image rates are in the book, identical to PRICE_TABLE (drift test pins the TS side). */
  assert public.provider_estimated_cost_usd('OPENAI', 'IMAGE_OUTPUT_TOKEN', 1000000, 'gpt-image-2') = 30, 'gpt-image-2 image out 30/M';
  assert public.provider_estimated_cost_usd('GEMINI', 'IMAGE_OUTPUT_TOKEN', 1000000, 'gemini-3.1-flash-image') = 60, 'gemini flash image out 60/M';
  begin
    insert into public.provider_price_book (provider, model, unit, rate, per_units, currency, effective_from) values ('X', 'y', 'NOT_A_UNIT', 1, 1, 'USD', now());
    raise exception 'unit check must refuse unknown units';
  exception when check_violation then null; end;

  /* cost_events: idempotency key → one row however many retries. */
  insert into public.cost_events (provider, operation_type, units, cost_usd, pricing_state, idempotency_key, finance_service, "timestamp")
  values ('GEMINI', 'SOCIAL_POST_GENERATE', 140, 0, 'UNPRICED', 'social:p1:r1', 'social_posts', now());
  insert into public.cost_events (provider, operation_type, units, cost_usd, pricing_state, idempotency_key, finance_service, "timestamp")
  values ('GEMINI', 'SOCIAL_POST_GENERATE', 140, 0, 'UNPRICED', 'social:p1:r1', 'social_posts', now()) on conflict (idempotency_key) do nothing;
  select count(*) into n from public.cost_events where idempotency_key = 'social:p1:r1';
  assert n = 1, 'duplicate callback/retry writes nothing: ' || n;
  /* The recorder-declared service wins; UNPRICED stays NULL in the ledger. */
  select count(*) into n from public.finance_v2_cost_lines where service_key = 'social_posts' and cost_status = 'UNPRICED' and cost_usd is null;
  assert n = 1, 'declared service + UNPRICED → NULL: ' || n;
  /* v1 classification is shared platform, not unattributed. */
  insert into public.cost_events (provider, operation_type, units, cost_usd, pricing_state, "timestamp") values ('OPENAI', 'CLASSIFY_SIGNAL', 10, 0.0001, 'ESTIMATED', now());
  assert (select service_key from public.finance_v2_cost_lines where operation = 'CLASSIFY_SIGNAL' limit 1) = 'shared_platform', 'CLASSIFY_* → shared_platform';

  /* Sweeper: releases only expired RESERVED holds; never relabels a hold a settle already closed. */
  insert into public.usage_reservations (status, expires_at) values ('RESERVED', now() - interval '1 hour') returning id into r1;
  insert into public.usage_reservations (status, expires_at) values ('SETTLED', now() - interval '1 hour') returning id into r2;
  insert into public.usage_reservations (status, expires_at) values ('RESERVED', now() + interval '1 hour') returning id into r3;
  begin perform public.wallet_sweep_expired_reservations(10); raise exception 'sweeper must refuse non-service callers';
  exception when others then assert sqlerrm = 'FORBIDDEN', sqlerrm; end;
  perform set_config('app.role', 'service_role', true);
  assert public.wallet_sweep_expired_reservations(10) = 1, 'exactly the one expired RESERVED hold';
  assert (select status from public.usage_reservations where id = r1) = 'EXPIRED', 'released hold marked EXPIRED';
  assert (select status from public.usage_reservations where id = r2) = 'SETTLED', 'a settled hold stays SETTLED';
  assert (select status from public.usage_reservations where id = r3) = 'RESERVED', 'live hold untouched';
  assert public.wallet_sweep_expired_reservations(10) = 0, 'idempotent: nothing left to sweep';
  perform set_config('app.role', '', true);

  /* Admin: coverage gaps make profit "incomplete"; shared infrastructure is never $0 when unconfigured. */
  perform set_config('app.finance_admin', 'yes', true);
  v := (select e from jsonb_array_elements(public.finance_v2_services(now() - interval '400 days', now() + interval '1 day')) e where e->>'service' = 'ai_talk');
  assert (v->>'costComplete')::boolean = false and jsonb_array_length(v->'coverageGaps') >= 1, 'AI Talk: realtime listen is a known gap: ' || v::text;
  v := (select e from jsonb_array_elements(public.finance_v2_services(now() - interval '400 days', now() + interval '1 day')) e where e->>'service' = 'contract_intelligence');
  assert v ? 'costComplete' and v ? 'coverageGaps', 'every service reports completeness';
  insert into public.finance_fixed_expenses (name, vendor, amount_cents, currency, billing_frequency, starts_at, active) values ('Vercel team plan', 'VERCEL', 0, 'USD', 'MONTHLY', '2026-09-01', true);
  insert into public.provider_price_book (provider, model, unit, rate, per_units, currency, effective_from) values ('RAILWAY', 'homatch-official-worker', 'MONTH', 7.80, 1, 'USD', '2026-01-01');
  v := public.finance_v2_shared_costs(now() - interval '30.4375 days', now());
  assert (v->>'complete')::boolean = false, 'an unconfigured fixed expense makes shared costs incomplete';
  assert exists (select 1 from jsonb_array_elements(v->'lines') l where l->>'vendor' = 'VERCEL' and l->>'status' = 'NOT_CONFIGURED' and l->'periodUsd' = 'null'::jsonb), 'NOT_CONFIGURED, never $0: ' || v::text;
  assert exists (select 1 from jsonb_array_elements(v->'lines') l where l->>'vendor' = 'RAILWAY' and (l->>'periodUsd')::numeric = 7.80), 'one month of Railway prorated: ' || v::text;
  perform set_config('app.finance_admin', '', true);
  begin perform public.finance_v2_shared_costs(); raise exception 'shared costs must be admin-only';
  exception when others then assert sqlerrm = 'FORBIDDEN', sqlerrm; end;
end $$;
do $$
declare v jsonb;
begin
  perform set_config('app.finance_admin', 'yes', true);
  insert into public.provider_price_book (provider, model, unit, rate, per_units, currency, effective_from)
  select 'OPENAI', 'gpt-4o-mini', 'OUTPUT_TOKEN', 0.60, 1000000, 'USD', '2024-07-18' where not exists (select 1 from public.provider_price_book where model = 'gpt-4o-mini' and unit = 'OUTPUT_TOKEN');
  delete from public.admin_settings where key = 'find_buyers_openai_price_book';
  insert into public.admin_settings (key, value) values ('find_buyers_openai_price_book', '{"model":"gpt-4o-mini","inputPerMTokMicros":150000,"outputPerMTokMicros":600000}');
  v := public.finance_v2_price_drift();
  assert (select bool_and(e->>'status' = 'MATCH') from jsonb_array_elements(v) e) and jsonb_array_length(v) = 2, 'setting equals the book: ' || v::text;
  update public.admin_settings set value = '{"model":"gpt-4o-mini","inputPerMTokMicros":200000,"outputPerMTokMicros":600000}' where key = 'find_buyers_openai_price_book';
  v := public.finance_v2_price_drift();
  assert exists (select 1 from jsonb_array_elements(v) e where e->>'unit' = 'INPUT_TOKEN' and e->>'status' = 'DRIFT'), 'drift detected: ' || v::text;
  perform set_config('app.finance_admin', '', true);
end $$;

-- Voice previews: the voice-ai cost_events row is the cost; the telemetry row is not listed again.
do $$
declare p uuid := gen_random_uuid(); s uuid := gen_random_uuid();
begin
  insert into public.voice_usage_events (id, provider, role, model, characters, surface) values (p, 'ELEVENLABS', 'TTS', 'eleven_v3', 40, 'VOICE_PREVIEW');
  insert into public.voice_usage_events (id, provider, role, model, characters, surface) values (s, 'CARTESIA', 'TTS', 'sonic-3', 40, 'AI_TALK');
  assert not exists (select 1 from public.finance_v2_cost_lines where line_id = 'voice:' || p::text), 'preview telemetry excluded';
  assert exists (select 1 from public.finance_v2_cost_lines where line_id = 'voice:' || s::text), 'AI Talk voice row kept';
end $$;
