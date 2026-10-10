/* ══════════════════════════════════════════════════════════════════════
 * VERIFY — CREDIT BUDGET, LIVE USAGE, STOP & RESUME
 * ══════════════════════════════════════════════════════════════════════
 *
 * A Verify investigation runs against an authorised BUDGET (25 credits by
 * default), not a fixed price:
 *
 *   start   the remaining authorised budget is RESERVED through the existing
 *           wallet (wallet_reserve: lots, ledger, idempotency key);
 *   run     the job's real, metered cost (AI tokens and searches priced from
 *           provider_price_book, CAPTCHA solves, Apify runs) is priced live;
 *   stop    what was legitimately incurred is SETTLED (wallet_settle), the
 *           rest RELEASED; the job keeps every collected result;
 *   resume  only the budget that is still unused is reserved again;
 *   finish  the final cumulative price is settled, the remainder released.
 *
 * THE PRICE (all numeric, never floating point; policy in
 * billable_products.config.verify_budget, VAT rate in admin_settings):
 *
 *   landed     = billing_landed_cogs_cents(metered provider cost)   (existing
 *                definition: provider cost + billing_cogs_tax_bps + fees)
 *   contingency= landed × contingency_bps                (a PRICE component,
 *                never recorded as incurred cost)
 *   net        = (landed + contingency) / (1 − target_margin_bps)  VAT-exclusive
 *   vat        = net × vat_rate_bps                   (output VAT, when applied)
 *   gross      = net + vat                              VAT-inclusive charge
 *   credits    = gross → credits (credits_per_usd), rounded UP to
 *                billing_credit_rounding_dp, then capped at the authorisation.
 *
 * The 55 % target margin is Verify's own policy (config.verify_budget). It is
 * NOT billing_plans.profit_share_to_customer_bps and does not touch
 * billing_price_quote(), other products or any plan. HOMATCH is PAYG-only
 * (docs/claude/BILLING.md): no plan allowance funds a Verify and no plan
 * changes its price; the plan code is only snapshotted on the reservation, as
 * wallet_reserve already does.
 *
 * CUMULATIVE, NEVER TWICE. Every settlement prices the job's TOTAL metered
 * cost and charges only the difference to what earlier sessions of the same
 * job already charged. Work reused on resume (stored results, shared queue
 * results, cache hits) adds no cost, so it adds no charge. The authorised
 * total only grows by an explicit, recorded authorisation.
 *
 * FAILURE POLICY. A system-caused failure releases the whole open
 * reservation (charges nothing). A stop by the customer settles what was
 * incurred. A missing rate is never a silent zero: the policy's documented
 * fallback rate is used and the line is marked FALLBACK; with no fallback the
 * line is UNPRICED, the charge covers the priced part only and the session is
 * flagged for finance review.
 *
 * OFF BY DEFAULT: admin_settings.verify_billing_enabled = false. Until the
 * owner switches it on, Verify behaves exactly as before.
 * ══════════════════════════════════════════════════════════════════════ */

-- research_jobs is on every status poll: never queue behind a long lock.
set local lock_timeout = '5s';

-- ── 1. Policy (data, not code) ──────────────────────────────────────────
update public.billable_products
   set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('verify_budget', jsonb_build_object(
         -- Owner rule (2026-10-10): 25 to start, +25 per explicit approval,
         -- at most four authorisations, never more than 100 per investigation.
         'initial_credits', 25,
         'increment_credits', 25,
         'max_budget_credits', 100,
         'max_authorizations', 4,
         -- Conservative raw provider USD a stage may cost, checked BEFORE it
         -- starts (production p95 per stage 2026-10-10, rounded up; the ads
         -- Actor at its own hard ceiling). Not a charge: what is charged is
         -- always the metered cost.
         'stage_estimates_usd', jsonb_build_object(
           'IDENTITY', 0.15, 'OFFICIAL', 0.05, 'OFFICIAL_COLLECTION', 0.09, 'FINANCIAL_ENTITY', 0.02,
           'PUBLIC_RESEARCH', 0.23, 'MARKET', 0.29, 'DEVELOPER_ADS', 0.50, 'SYNTHESIS', 0.02, 'REPORT', 0.02, 'DEFAULT', 0.10),
         'target_margin_bps', 5500,
         'contingency_bps', 1000,
         -- Owner rule (2026-10-10): a completed report leaves HOMATCH at least
         -- $1.00 of VAT-exclusive revenue above its eligible landed cost. A
         -- floor, not a fee: the price is the HIGHER of the margin price and
         -- the floor price, never their sum.
         'min_net_profit_usd', 1.00,
         'apply_output_vat', true,
         'reservation_ttl_hours', 12,
         'budget_guard_bps', 9000,
         'system_failure_charge', 'NONE',
         'ai_models', jsonb_build_object('default', 'gpt-5.6-terra', 'synthesis', 'gpt-5.6-luna', 'verify_synthesis', 'gpt-5.6-luna'),
         'fallback_usd', jsonb_build_object('CAPTCHA_SOLVE', 0.003),
         'note', 'Verify credit budget (owner brief 2026-10-10). net = max((landed + contingency) / 0.45, landed + $1.00 on a completed report), plus VAT; capped at the authorised budget.'
       )),
       updated_at = now()
 where code = 'VERIFY';

insert into public.admin_settings (key, value, description)
values ('verify_billing_enabled', 'false'::jsonb,
        'Verify credit budget: reserve 25 credits at start, +25 per explicit customer approval up to 100, charge the metered and priced cost, release the rest. false = Verify is not charged (previous behaviour).')
on conflict (key) do nothing;

-- ── 2. Job control columns: durable stop intent, pause, resume count ────
alter table public.research_jobs add column if not exists pause_requested_at timestamptz;
alter table public.research_jobs add column if not exists paused_at timestamptz;
alter table public.research_jobs add column if not exists resume_count integer not null default 0;

-- ── 3. Budget and sessions ──────────────────────────────────────────────
create table if not exists public.verify_billing (
  -- RESTRICT: a job that ever held money keeps its billing history.
  job_id                   uuid primary key references public.research_jobs(id) on delete restrict,
  user_id                  uuid not null,
  authorized_total_credits numeric(12,4) not null check (authorized_total_credits >= 0),
  charged_total_credits    numeric(12,4) not null default 0 check (charged_total_credits >= 0),
  -- Landed cost already covered by settled sessions (for usage_events deltas).
  landed_charged_cents     numeric(14,4) not null default 0,
  state                    text not null default 'ACTIVE'
                           check (state in ('ACTIVE','PAUSED','SETTLED','RELEASED')),
  needs_review             boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint verify_billing_never_over_authorised check (charged_total_credits <= authorized_total_credits)
);

create table if not exists public.verify_billing_sessions (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid not null references public.verify_billing(job_id) on delete restrict,
  seq                   integer not null,
  reservation_id        uuid not null,
  reserved_credits      numeric(12,4) not null,
  charged_before        numeric(12,4) not null,
  state                 text not null default 'RESERVED'
                        check (state in ('RESERVED','SETTLED','RELEASED','EXPIRED')),
  outcome               text,
  charged_credits       numeric(12,4),
  released_credits      numeric(12,4),
  cost                  jsonb,
  price                 jsonb,
  created_at            timestamptz not null default now(),
  closed_at             timestamptz,
  unique (job_id, seq)
);
-- Every authorisation the customer gave, one row each: its own id and key.
-- The authorised total is their sum; (job_id, seq) makes a double approval
-- one approval, and the policy bounds seq (four) and the total (100).
create table if not exists public.verify_billing_authorizations (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.verify_billing(job_id) on delete restrict,
  seq              integer not null check (seq >= 1),
  kind             text not null check (kind in ('INITIAL', 'EXTENSION')),
  credits          numeric(12,4) not null check (credits > 0),
  idempotency_key  text not null unique,
  reservation_id   uuid,
  created_at       timestamptz not null default now(),
  unique (job_id, seq)
);
alter table public.verify_billing_authorizations enable row level security;
alter table public.verify_billing_authorizations force row level security;
revoke all on public.verify_billing_authorizations from public, anon, authenticated;
grant select, insert on public.verify_billing_authorizations to service_role;

-- At most one open session per job: a second concurrent open cannot exist.
create unique index if not exists verify_billing_one_open_session
  on public.verify_billing_sessions(job_id) where state = 'RESERVED';

alter table public.verify_billing enable row level security;
alter table public.verify_billing force row level security;
alter table public.verify_billing_sessions enable row level security;
alter table public.verify_billing_sessions force row level security;
revoke all on public.verify_billing from public, anon, authenticated;
revoke all on public.verify_billing_sessions from public, anon, authenticated;
grant select, insert, update on public.verify_billing to service_role;
grant select, insert, update on public.verify_billing_sessions to service_role;

-- ── 4. Policy reader ────────────────────────────────────────────────────
create or replace function public.verify_budget_policy()
returns jsonb
language sql stable security definer set search_path to ''
as $$
  select coalesce((select p.config->'verify_budget' from public.billable_products p where p.code = 'VERIFY'), '{}'::jsonb)
      || jsonb_build_object(
           'vat_rate_bps', public.billing_setting_num('vat_rate_bps', 1800),
           'credits_per_usd', public.billing_setting_num('credits_per_usd', 10),
           'rounding_dp', public.billing_setting_num('billing_credit_rounding_dp', 2),
           'enabled', public.billing_setting_bool('verify_billing_enabled', false));
$$;

-- ── 5. The price of a landed cost ───────────────────────────────────────
-- net (VAT-exclusive) = max( (landed + contingency) / (1 − margin),
--                            landed + min_net_profit   ← completed reports only )
-- gross = net × (1 + VAT), in credits rounded UP to the credit precision.
-- `landed` already carries the non-recoverable taxes (billing_landed_cogs_cents);
-- contingency is a price component only, never recorded as a cost.
create or replace function public.verify_price_for_cost(p_landed_cents numeric, p_completed boolean default false)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare
  v_pol jsonb := public.verify_budget_policy();
  v_landed numeric := round(greatest(coalesce(p_landed_cents, 0), 0), 4);
  v_m numeric := coalesce((v_pol->>'target_margin_bps')::numeric, 5500);
  v_c numeric := coalesce((v_pol->>'contingency_bps')::numeric, 0);
  v_floor numeric := case when coalesce(p_completed, false)
                          then round(greatest(coalesce(public.verify_num(v_pol->>'min_net_profit_usd'), 0), 0) * 100, 4) else 0 end;
  v_vat_bps numeric := case when coalesce((v_pol->>'apply_output_vat')::boolean, true)
                            then coalesce((v_pol->>'vat_rate_bps')::numeric, 0) else 0 end;
  v_dp integer := coalesce((v_pol->>'rounding_dp')::integer, 2);
  v_cont numeric; v_margin_net numeric; v_floor_net numeric; v_net numeric; v_vat numeric; v_gross numeric; v_exact numeric; v_credits numeric;
begin
  if v_m < 0 or v_m >= 10000 then raise exception 'VERIFY_INVALID_MARGIN'; end if;
  v_cont       := round(v_landed * v_c / 10000, 4);
  v_margin_net := round((v_landed + v_cont) / (1 - v_m / 10000), 4);
  v_floor_net  := v_landed + v_floor;
  v_net   := greatest(v_margin_net, v_floor_net);
  v_vat   := round(v_net * v_vat_bps / 10000, 4);
  v_gross := v_net + v_vat;
  v_exact := public.billing_cents_to_credits(v_gross);
  -- Round UP to the credit precision: rounding never eats the margin or the floor.
  v_credits := ceil(v_exact * power(10, v_dp)) / power(10, v_dp);
  return jsonb_build_object(
    'landedCents', v_landed, 'contingencyCents', v_cont, 'netCents', v_net,
    'vatCents', v_vat, 'vatRateBps', v_vat_bps, 'grossCents', v_gross,
    'targetMarginBps', v_m, 'contingencyBps', v_c,
    'marginNetCents', v_margin_net, 'minProfitCents', v_floor, 'floorApplied', v_floor_net > v_margin_net,
    'profitCents', v_net - v_landed,
    'creditsExact', v_exact, 'credits', v_credits);
end;
$$;

-- ── 6a. Safe readers ─────────────────────────────────────────────────────
-- A malformed stored number reads as NULL (unknown), never an exception that
-- would block a settlement or a release.
create or replace function public.verify_num(p text)
returns numeric
language sql immutable set search_path to ''
as $$
  select case when p ~ '^\s*-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?\s*$' then p::numeric end;
$$;

-- Was the job paused at this moment? Work done for others while this job was
-- stopped (a shared producer that kept running for another customer) is not
-- billed to it.
create or replace function public.verify_job_paused_at(p_result jsonb, p_at timestamptz)
returns boolean
language sql immutable set search_path to ''
as $$
  select coalesce(p_at is not null and (
    exists (
      select 1 from jsonb_array_elements(case when jsonb_typeof(p_result->'_pauseHistory') = 'array' then p_result->'_pauseHistory' else '[]'::jsonb end) h(v)
       where (h.v->>'at') ~ '^\d{4}-' and p_at >= (h.v->>'at')::timestamptz
         and p_at < coalesce(case when (h.v->>'resumedAt') ~ '^\d{4}-' then (h.v->>'resumedAt')::timestamptz end, 'infinity'::timestamptz))
    or coalesce((p_result->'_pause'->>'at') ~ '^\d{4}-' and p_at >= (p_result->'_pause'->>'at')::timestamptz, false)), false);
$$;

-- ── 6. What a job has cost so far (metered, priced now) ─────────────────
create or replace function public.verify_job_cost(p_job_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare
  j public.research_jobs;
  v_pol jsonb := public.verify_budget_policy();
  v_lines jsonb := '[]'::jsonb;
  v_usd numeric := 0;
  v_unpriced integer := 0;
  v_fallback integer := 0;
  s record;
  v_model text;
  v_in numeric; v_cin numeric; v_out numeric; v_ws numeric;
  r_in numeric; r_cin numeric; r_out numeric; r_ws numeric;
  v_line numeric;
  v_state text;
  v_events integer;
  v_solves numeric := 0;
  v_rate numeric;
  e record;
begin
  select * into j from public.research_jobs where id = p_job_id;
  if not found then return null; end if;

  -- AI research stages (usage stored per stage when each stage completes).
  for s in
    select key, value from jsonb_each(coalesce(
      case when jsonb_typeof(j.result_json->'costUsage') = 'object' then j.result_json->'costUsage' end,
      case when jsonb_typeof(j.result_json->'_cost') = 'object' then j.result_json->'_cost' end,
      '{}'::jsonb))
  loop
    continue when jsonb_typeof(s.value) <> 'object';
    v_model := coalesce(v_pol->'ai_models'->>s.key, v_pol->'ai_models'->>'default', 'gpt-5.6-terra');
    v_in  := greatest(coalesce(public.verify_num(s.value->>'input_tokens'), 0), 0);
    v_cin := greatest(coalesce(public.verify_num(s.value->'input_tokens_details'->>'cached_tokens'), 0), 0);
    v_out := greatest(coalesce(public.verify_num(s.value->>'output_tokens'), 0), 0);
    v_ws  := greatest(coalesce(public.verify_num(coalesce(j.result_json->'webSearchCalls', j.result_json->'_searches')->>s.key), 0), 0);
    r_in  := public.price_per_unit_at('OPENAI', v_model, 'INPUT_TOKEN', now());
    r_cin := public.price_per_unit_at('OPENAI', v_model, 'CACHED_INPUT_TOKEN', now());
    r_out := public.price_per_unit_at('OPENAI', v_model, 'OUTPUT_TOKEN', now());
    r_ws  := public.price_per_unit_at('OPENAI', v_model, 'WEB_SEARCH_CALL', now());
    if r_in is null or r_out is null or (v_cin > 0 and r_cin is null) or (v_ws > 0 and r_ws is null) then
      v_state := 'UNPRICED'; v_unpriced := v_unpriced + 1; v_line := null;
    else
      v_state := 'PRICED';
      v_line := round(greatest(v_in - v_cin, 0) * r_in + v_cin * coalesce(r_cin, 0) + v_out * r_out + v_ws * coalesce(r_ws, 0), 6);
      v_usd := v_usd + v_line;
    end if;
    v_lines := v_lines || jsonb_build_object('kind', 'AI', 'stage', s.key, 'units', v_in + v_out, 'searches', v_ws, 'usd', v_line, 'state', v_state);
  end loop;

  -- The report synthesis (verify-synthesis), stored on the job when written.
  if jsonb_typeof(j.synthesis_json->'_usage') = 'object' then
    v_model := coalesce(j.synthesis_json->'_usage'->>'model', v_pol->'ai_models'->>'verify_synthesis', 'gpt-5.6-luna');
    v_in  := greatest(coalesce(public.verify_num(j.synthesis_json->'_usage'->>'inputTokens'), 0), 0);
    v_cin := greatest(coalesce(public.verify_num(j.synthesis_json->'_usage'->>'cachedTokens'), 0), 0);
    v_out := greatest(coalesce(public.verify_num(j.synthesis_json->'_usage'->>'outputTokens'), 0), 0);
    r_in  := public.price_per_unit_at('OPENAI', v_model, 'INPUT_TOKEN', now());
    r_cin := public.price_per_unit_at('OPENAI', v_model, 'CACHED_INPUT_TOKEN', now());
    r_out := public.price_per_unit_at('OPENAI', v_model, 'OUTPUT_TOKEN', now());
    if r_in is null or r_out is null then
      v_state := 'UNPRICED'; v_unpriced := v_unpriced + 1; v_line := null;
    else
      v_state := 'PRICED';
      v_line := round(greatest(v_in - v_cin, 0) * r_in + v_cin * coalesce(r_cin, 0) + v_out * r_out, 6);
      v_usd := v_usd + v_line;
    end if;
    v_lines := v_lines || jsonb_build_object('kind', 'AI', 'stage', 'report', 'units', v_in + v_out, 'usd', v_line, 'state', v_state);
  end if;

  -- CAPTCHA. Durable per-attempt records (queue mode) are authoritative;
  -- without them, the solves the job's own results report are counted.
  -- Results reused from another job (queue: shared/cache) cost this job
  -- nothing and are not counted.
  select count(*) into v_events from public.verify_captcha_events where job_id = p_job_id;
  if v_events > 0 then
    declare
      v_known numeric; v_unknown integer;
    begin
      select coalesce(sum(cost_usd) filter (where cost_usd is not null), 0),
             count(*) filter (where cost_usd is null and outcome in ('ACCEPTED', 'REJECTED', 'NO_CHANGE'))
        into v_known, v_unknown
        from public.verify_captcha_events ev
       where ev.job_id = p_job_id and not public.verify_job_paused_at(j.result_json, ev.created_at);
      v_state := 'PRICED';
      if v_unknown > 0 then
        v_rate := coalesce(public.price_per_unit_at('2CAPTCHA', 'recaptcha_v2', 'SOLVE', now()), (v_pol->'fallback_usd'->>'CAPTCHA_SOLVE')::numeric);
        if v_rate is null then v_state := 'UNPRICED'; v_unpriced := v_unpriced + 1;
        else v_state := 'FALLBACK'; v_fallback := v_fallback + 1; v_known := v_known + v_unknown * v_rate; end if;
      end if;
      v_usd := v_usd + v_known;
      v_lines := v_lines || jsonb_build_object('kind', 'CAPTCHA', 'units', v_events, 'usd', round(v_known, 6), 'state', v_state);
    end;
  else
    for e in
      select c.value as c
        from jsonb_array_elements(coalesce(j.result_json->'browserOfficial'->'results', '[]'::jsonb)) r(value)
       cross join lateral jsonb_array_elements(case when jsonb_typeof(r.value->'captchaResolution') = 'array' then r.value->'captchaResolution' else '[]'::jsonb end) c(value)
       where not (r.value ? 'queue')
    loop
      if e.c->>'outcome' in ('ACCEPTED', 'REJECTED', 'NO_CHANGE') then
        v_solves := v_solves + greatest(coalesce(public.verify_num(e.c->>'attempts'), 1), 1);
      end if;
    end loop;
    if v_solves > 0 then
      v_rate := public.price_per_unit_at('2CAPTCHA', 'recaptcha_v2', 'SOLVE', now());
      v_state := 'PRICED';
      if v_rate is null then
        v_rate := (v_pol->'fallback_usd'->>'CAPTCHA_SOLVE')::numeric;
        v_state := case when v_rate is null then 'UNPRICED' else 'FALLBACK' end;
      end if;
      if v_rate is null then v_unpriced := v_unpriced + 1; v_line := null;
      else
        if v_state = 'FALLBACK' then v_fallback := v_fallback + 1; end if;
        v_line := round(v_solves * v_rate, 6); v_usd := v_usd + v_line;
      end if;
      v_lines := v_lines || jsonb_build_object('kind', 'CAPTCHA', 'units', v_solves, 'usd', v_line, 'state', v_state);
    end if;
  end if;

  -- Provider runs recorded against the job (developer advertising Actor).
  -- OpenAI work is priced above from the job's own usage; its cost_events
  -- rows (written for finance when the job completes) are the same spend and
  -- are never counted twice. PARTIAL is a floor (counted, and flagged).
  for e in
    select provider, operation_type, count(*) as n,
           sum(case when pricing_state is null or pricing_state in ('ACTUAL', 'ESTIMATED', 'PARTIAL') then greatest(cost_usd, 0) else 0 end) as usd,
           bool_or(pricing_state in ('UNPRICED', 'PARTIAL')) as unpriced
      from public.cost_events ce
     where ce.job_id = p_job_id and ce.provider::text <> 'OPENAI'
       and not public.verify_job_paused_at(j.result_json, ce."timestamp")
     group by provider, operation_type
  loop
    v_usd := v_usd + coalesce(e.usd, 0);
    if e.unpriced then v_unpriced := v_unpriced + 1; end if;
    v_lines := v_lines || jsonb_build_object('kind', 'PROVIDER', 'provider', e.provider, 'operation', e.operation_type,
      'units', e.n, 'usd', round(coalesce(e.usd, 0), 6), 'state', case when e.unpriced then 'UNPRICED' else 'PRICED' end);
  end loop;

  return jsonb_build_object(
    'rawUsd', round(v_usd, 6),
    'landedCents', public.billing_landed_cogs_cents(round(v_usd * 100, 4), 0, 0, 0),
    'unpricedLines', v_unpriced,
    'fallbackLines', v_fallback,
    'state', case when v_unpriced > 0 then 'PARTIAL' when v_fallback > 0 then 'FALLBACK' else 'PRICED' end,
    'lines', v_lines,
    'at', now());
end;
$$;

-- ── 7. Open a budget session (start, continue, or an approved +25) ──────
-- Reserves what is left of the authorised total. The first open authorises
-- the initial 25; p_extend = an explicit customer approval of one more
-- increment (+25), refused past four authorisations or 100 credits. The
-- amount is policy, never a client value. p_expected_authorizations is the
-- count the customer's screen showed: a double click (or an approval made
-- from a stale screen) is therefore exactly one extension.
create or replace function public.verify_billing_open(
  p_job_id uuid, p_user_id uuid, p_idempotency_key text,
  p_extend boolean default false, p_expected_authorizations integer default null)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_pol jsonb := public.verify_budget_policy();
  v_initial numeric := coalesce((v_pol->>'initial_credits')::numeric, 25);
  v_inc numeric := coalesce((v_pol->>'increment_credits')::numeric, 25);
  v_max numeric := coalesce((v_pol->>'max_budget_credits')::numeric, 100);
  v_max_auth integer := coalesce((v_pol->>'max_authorizations')::integer, 4);
  v_b public.verify_billing;
  v_s public.verify_billing_sessions;
  v_count integer;
  v_new numeric := 0;
  v_kind text;
  v_remaining numeric;
  v_res record;
  v_seq integer;
  v_can_extend boolean;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if not exists (select 1 from public.research_jobs where id = p_job_id and user_id = p_user_id) then
    raise exception 'JOB_NOT_OWNED';
  end if;

  insert into public.verify_billing (job_id, user_id, authorized_total_credits)
  values (p_job_id, p_user_id, 0)
  on conflict (job_id) do nothing;
  -- Serialises every open, approval, stop and settlement of this job.
  select * into v_b from public.verify_billing where job_id = p_job_id for update;
  select count(*) into v_count from public.verify_billing_authorizations where job_id = p_job_id;
  v_can_extend := v_count < v_max_auth and v_b.authorized_total_credits + v_inc <= v_max;

  select * into v_s from public.verify_billing_sessions where job_id = p_job_id and state = 'RESERVED';
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'sessionId', v_s.id, 'reservationId', v_s.reservation_id,
      'reservedCredits', v_s.reserved_credits, 'authorizedTotal', v_b.authorized_total_credits, 'chargedTotal', v_b.charged_total_credits,
      'authorizations', v_count);
  end if;

  -- A session already opened under this key (a retried request after it closed) is not reopened.
  if exists (select 1 from public.verify_billing_sessions vs join public.usage_reservations r on r.id = vs.reservation_id
              where vs.job_id = p_job_id and r.idempotency_key = p_idempotency_key) then
    return jsonb_build_object('ok', false, 'reason', 'SESSION_ALREADY_CLOSED');
  end if;

  if v_count = 0 then
    v_new := v_initial; v_kind := 'INITIAL';
  elsif p_extend then
    if p_expected_authorizations is not null and p_expected_authorizations <> v_count then
      return jsonb_build_object('ok', false, 'reason', 'STALE_REQUEST', 'authorizations', v_count,
        'authorizedTotal', v_b.authorized_total_credits, 'chargedTotal', v_b.charged_total_credits);
    end if;
    if not v_can_extend then
      return jsonb_build_object('ok', false, 'reason', 'BUDGET_LIMIT', 'authorizations', v_count,
        'authorizedTotal', v_b.authorized_total_credits, 'chargedTotal', v_b.charged_total_credits, 'maxBudget', v_max);
    end if;
    v_new := v_inc; v_kind := 'EXTENSION';
  end if;

  v_remaining := round(v_b.authorized_total_credits + v_new - v_b.charged_total_credits, 4);
  if v_remaining <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'BUDGET_EXHAUSTED', 'canExtend', v_can_extend, 'authorizations', v_count,
      'authorizedTotal', v_b.authorized_total_credits, 'chargedTotal', v_b.charged_total_credits);
  end if;

  begin
    select * into v_res from public.wallet_reserve(p_user_id, 'VERIFY', v_remaining, p_idempotency_key, 0, v_remaining, p_job_id::text,
      jsonb_build_object('verify_job_id', p_job_id, 'session', coalesce((select max(seq) from public.verify_billing_sessions where job_id = p_job_id), 0) + 1,
                         'authorized_total', v_b.authorized_total_credits + v_new, 'charged_before', v_b.charged_total_credits,
                         'authorization', case when v_new > 0 then v_kind end));
  exception when others then
    -- Nothing was held: a job that never held money leaves no billing row.
    if not exists (select 1 from public.verify_billing_sessions where job_id = p_job_id)
       and not exists (select 1 from public.verify_billing_authorizations where job_id = p_job_id) then
      delete from public.verify_billing where job_id = p_job_id;
    end if;
    if sqlerrm like '%INSUFFICIENT_CREDITS%' or sqlerrm like '%CREDIT_ACCOUNT_NOT_FOUND%' then
      return jsonb_build_object('ok', false, 'reason', 'INSUFFICIENT_CREDITS', 'requiredCredits', v_remaining,
        'availableCredits', coalesce((select balance from public.credit_accounts where user_id = p_user_id), 0),
        'authorizations', v_count, 'canExtend', v_can_extend);
    elsif sqlerrm like '%BELOW_MIN_VIABLE_BUDGET%' then
      return jsonb_build_object('ok', false, 'reason', 'BUDGET_EXHAUSTED', 'canExtend', v_can_extend, 'authorizations', v_count,
        'authorizedTotal', v_b.authorized_total_credits, 'chargedTotal', v_b.charged_total_credits);
    end if;
    raise;
  end;

  if v_res.was_duplicate and not exists (select 1 from public.usage_reservations r where r.id = v_res.reservation_id and r.job_ref = p_job_id::text and r.status = 'RESERVED') then
    raise exception 'IDEMPOTENCY_KEY_REUSED';
  end if;
  -- The authorisation counts only once the money it stands for is held.
  if v_new > 0 then
    insert into public.verify_billing_authorizations (job_id, seq, kind, credits, idempotency_key, reservation_id)
    values (p_job_id, v_count + 1, v_kind, v_new, 'verify:' || p_job_id || ':auth' || (v_count + 1), v_res.reservation_id);
    update public.verify_billing set authorized_total_credits = authorized_total_credits + v_new, updated_at = now()
     where job_id = p_job_id returning * into v_b;
    v_count := v_count + 1;
  end if;

  -- A Verify can outlive the generic reservation TTL; the job keeps it alive.
  update public.usage_reservations
     set expires_at = now() + make_interval(hours => coalesce((v_pol->>'reservation_ttl_hours')::integer, 12))
   where id = v_res.reservation_id and status = 'RESERVED';

  select coalesce(max(seq), 0) + 1 into v_seq from public.verify_billing_sessions where job_id = p_job_id;
  insert into public.verify_billing_sessions (job_id, seq, reservation_id, reserved_credits, charged_before)
  values (p_job_id, v_seq, v_res.reservation_id, v_res.reserved_credits, v_b.charged_total_credits)
  returning * into v_s;
  update public.verify_billing set state = 'ACTIVE', updated_at = now() where job_id = p_job_id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'sessionId', v_s.id, 'reservationId', v_s.reservation_id,
    'reservedCredits', v_s.reserved_credits, 'authorizedTotal', v_b.authorized_total_credits, 'chargedTotal', v_b.charged_total_credits,
    'authorizations', v_count, 'extended', v_kind = 'EXTENSION', 'balanceAfter', v_res.balance_after);
end;
$$;

-- What a research stage may cost at most, in credits, priced the Verify way
-- from the policy's conservative estimate. Used BEFORE the stage starts.
create or replace function public.verify_stage_credits(p_stage text)
returns numeric
language plpgsql stable security definer set search_path to ''
as $$
declare
  v_pol jsonb := public.verify_budget_policy();
  v_usd numeric := coalesce(public.verify_num(v_pol->'stage_estimates_usd'->>upper(coalesce(p_stage, ''))),
                            public.verify_num(v_pol->'stage_estimates_usd'->>'DEFAULT'), 0.10);
begin
  return (public.verify_price_for_cost(public.billing_landed_cogs_cents(round(greatest(v_usd, 0) * 100, 4), 0, 0, 0))->>'credits')::numeric;
end;
$$;

-- ── 8. Live state (also keeps a long-running reservation alive) ─────────
create or replace function public.verify_billing_state(p_job_id uuid)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_pol jsonb := public.verify_budget_policy();
  v_b public.verify_billing;
  v_s public.verify_billing_sessions;
  v_cost jsonb;
  v_price jsonb;
  v_total numeric;
  v_accrued numeric := 0;
  v_last public.verify_billing_sessions;
begin
  select * into v_b from public.verify_billing where job_id = p_job_id;
  if not found then return null; end if;
  select * into v_s from public.verify_billing_sessions where job_id = p_job_id and state = 'RESERVED';
  select * into v_last from public.verify_billing_sessions where job_id = p_job_id and state <> 'RESERVED' order by seq desc limit 1;
  if v_s.id is not null then
    begin
      v_cost := public.verify_job_cost(p_job_id);
      v_price := public.verify_price_for_cost((v_cost->>'landedCents')::numeric);
      v_total := least((v_price->>'credits')::numeric, v_b.authorized_total_credits);
      v_accrued := least(greatest(v_total - v_s.charged_before, 0), v_s.reserved_credits);
    exception when others then
      v_cost := jsonb_build_object('state', 'PARTIAL', 'error', left(sqlerrm, 200));
      v_accrued := 0;
    end;
    update public.usage_reservations
       set expires_at = now() + make_interval(hours => coalesce((v_pol->>'reservation_ttl_hours')::integer, 12))
     where id = v_s.reservation_id and status = 'RESERVED' and expires_at < now() + interval '2 hours';
  end if;
  return jsonb_build_object(
    'state', v_b.state,
    'authorizedTotal', v_b.authorized_total_credits,
    'chargedTotal', v_b.charged_total_credits,
    'reserved', coalesce(v_s.reserved_credits, 0),
    'accrued', v_accrued,
    'used', v_b.charged_total_credits + v_accrued,
    'remaining', greatest(v_b.authorized_total_credits - v_b.charged_total_credits - v_accrued, 0),
    'authorizations', (select count(*) from public.verify_billing_authorizations where job_id = p_job_id),
    'increment', coalesce((v_pol->>'increment_credits')::numeric, 25),
    'incrementUsdCents', round(coalesce((v_pol->>'increment_credits')::numeric, 25) / nullif(coalesce((v_pol->>'credits_per_usd')::numeric, 10), 0) * 100, 2),
    'maxBudget', coalesce((v_pol->>'max_budget_credits')::numeric, 100),
    'canExtend', (select count(*) from public.verify_billing_authorizations where job_id = p_job_id) < coalesce((v_pol->>'max_authorizations')::integer, 4)
                 and v_b.authorized_total_credits + coalesce((v_pol->>'increment_credits')::numeric, 25) <= coalesce((v_pol->>'max_budget_credits')::numeric, 100),
    'usageState', case when v_s.id is null then 'SETTLED' when v_cost->>'state' = 'PARTIAL' then 'CALCULATING' else 'LIVE' end,
    'lastSession', case when v_last.id is null then null else jsonb_build_object(
        'outcome', v_last.outcome, 'charged', v_last.charged_credits, 'released', v_last.released_credits, 'closedAt', v_last.closed_at) end,
    'budgetGuard', v_s.id is not null and (v_b.charged_total_credits + v_accrued) >= v_b.authorized_total_credits * coalesce((v_pol->>'budget_guard_bps')::numeric, 9000) / 10000,
    'sessions', (select count(*) from public.verify_billing_sessions where job_id = p_job_id));
end;
$$;

-- ── 8b. The gate before every chargeable stage ──────────────────────────
-- The question is the real one: would the investigation's cumulative price,
-- after this stage at its conservative estimate, still be inside what the
-- customer authorised? (The synthesis also covers the report it writes and
-- is priced as the completed report, $1 floor included.) No percentage
-- threshold ever interrupts a run.
-- GO      it fits
-- AWAIT   it does not, and one more authorisation is possible: ask first
-- LIMIT   it does not, and the 100-credit maximum is reached
-- NONE    this job is not budgeted (billing off) or holds no open session
create or replace function public.verify_budget_gate(p_job_id uuid, p_stage text)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_pol jsonb := public.verify_budget_policy();
  v_b public.verify_billing;
  v_stage text := upper(coalesce(p_stage, ''));
  v_landed numeric;
  v_usd numeric;
  v_add numeric;
  v_proj numeric;
  v_n integer;
  v_can boolean;
begin
  select * into v_b from public.verify_billing where job_id = p_job_id;
  if not found or v_b.state <> 'ACTIVE'
     or not exists (select 1 from public.verify_billing_sessions where job_id = p_job_id and state = 'RESERVED') then
    return jsonb_build_object('decision', 'NONE');
  end if;
  begin
    v_landed := (public.verify_job_cost(p_job_id)->>'landedCents')::numeric;
  exception when others then
    v_landed := v_b.landed_charged_cents;
  end;
  v_usd := coalesce(public.verify_num(v_pol->'stage_estimates_usd'->>v_stage), public.verify_num(v_pol->'stage_estimates_usd'->>'DEFAULT'), 0.10);
  if v_stage = 'SYNTHESIS' then
    v_usd := v_usd + coalesce(public.verify_num(v_pol->'stage_estimates_usd'->>'REPORT'), public.verify_num(v_pol->'stage_estimates_usd'->>'DEFAULT'), 0.10);
  end if;
  v_add := public.billing_landed_cogs_cents(round(greatest(v_usd, 0) * 100, 4), 0, 0, 0);
  v_proj := (public.verify_price_for_cost(coalesce(v_landed, 0) + v_add, v_stage in ('SYNTHESIS', 'REPORT'))->>'credits')::numeric;
  select count(*) into v_n from public.verify_billing_authorizations where job_id = p_job_id;
  v_can := v_n < coalesce((v_pol->>'max_authorizations')::integer, 4)
           and v_b.authorized_total_credits + coalesce((v_pol->>'increment_credits')::numeric, 25) <= coalesce((v_pol->>'max_budget_credits')::numeric, 100);
  return jsonb_build_object(
    'decision', case when v_proj <= v_b.authorized_total_credits then 'GO' when v_can then 'AWAIT' else 'LIMIT' end,
    'stage', v_stage, 'projectedCredits', v_proj,
    'shortfall', greatest(v_proj - v_b.authorized_total_credits, 0),
    'authorizedTotal', v_b.authorized_total_credits, 'authorizations', v_n);
end;
$$;

-- ── 9. Close the open session: settle what was incurred, release the rest ─
-- p_outcome: COMPLETE | STOPPED | PARTIAL (charged) or SYSTEM_FAILED (released).
create or replace function public.verify_billing_close(p_job_id uuid, p_outcome text)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_b public.verify_billing;
  v_s public.verify_billing_sessions;
  v_r record;
  v_cost jsonb;
  v_price jsonb;
  v_total numeric;
  v_charge numeric;
  v_set record;
  v_rel record;
  v_landed numeric;
  v_review boolean := false;
begin
  if p_outcome not in ('COMPLETE', 'STOPPED', 'PARTIAL', 'SYSTEM_FAILED') then raise exception 'VERIFY_BAD_OUTCOME'; end if;
  select * into v_b from public.verify_billing where job_id = p_job_id for update;
  if not found then return jsonb_build_object('ok', true, 'billing', false); end if;
  select * into v_s from public.verify_billing_sessions where job_id = p_job_id and state = 'RESERVED' for update;
  if not found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'state', v_b.state, 'chargedTotal', v_b.charged_total_credits);
  end if;

  select * into v_r from public.usage_reservations where id = v_s.reservation_id for update;
  -- Released behind our back (expiry sweep): nothing left to charge. Recorded
  -- for finance review; the customer is never charged outside a reservation.
  if v_r.status <> 'RESERVED' then
    update public.verify_billing_sessions set state = 'EXPIRED', outcome = p_outcome, charged_credits = 0,
           released_credits = v_s.reserved_credits, closed_at = now() where id = v_s.id;
    update public.verify_billing set state = case when p_outcome = 'STOPPED' then 'PAUSED' when p_outcome = 'SYSTEM_FAILED' then 'RELEASED' else 'SETTLED' end,
           needs_review = true, updated_at = now() where job_id = p_job_id;
    return jsonb_build_object('ok', true, 'expired', true, 'charged', 0, 'released', v_s.reserved_credits);
  end if;

  -- Pricing is best-effort here: a cost that cannot be computed must never
  -- keep a customer's money held. It then charges nothing and is flagged.
  begin
    v_cost := public.verify_job_cost(p_job_id);
    v_price := public.verify_price_for_cost((v_cost->>'landedCents')::numeric, p_outcome = 'COMPLETE');
    v_landed := (v_cost->>'landedCents')::numeric;
    v_review := (v_cost->>'state') = 'PARTIAL';
  exception when others then
    v_cost := jsonb_build_object('state', 'ERROR', 'error', left(sqlerrm, 200));
    v_price := null; v_landed := null; v_review := true;
  end;

  if p_outcome = 'SYSTEM_FAILED' or v_price is null then
    select * into v_rel from public.wallet_release(v_s.reservation_id,
      case when p_outcome = 'SYSTEM_FAILED' then 'verify_system_failure' else 'verify_cost_unavailable' end,
      jsonb_build_object('provider', 'verify', 'provider_operation', 'verify_session', 'landed_cogs_cents', greatest(coalesce(v_landed, 0) - v_b.landed_charged_cents, 0),
                         'metadata', jsonb_build_object('verify_job_id', p_job_id, 'session', v_s.seq, 'cost', v_cost)));
    update public.verify_billing_sessions set state = 'RELEASED', outcome = p_outcome, charged_credits = 0,
           released_credits = v_s.reserved_credits, cost = v_cost, price = v_price, closed_at = now() where id = v_s.id;
    update public.verify_billing
       set state = case when p_outcome = 'SYSTEM_FAILED' then 'RELEASED' when p_outcome = 'STOPPED' then 'PAUSED' else 'SETTLED' end,
           -- The released session's cost is logged on the release; never again on a later settle.
           landed_charged_cents = greatest(landed_charged_cents, coalesce(v_landed, 0)),
           needs_review = needs_review or v_review, updated_at = now()
     where job_id = p_job_id;
    return jsonb_build_object('ok', true, 'charged', 0, 'released', v_s.reserved_credits, 'chargedTotal', v_b.charged_total_credits);
  end if;

  v_total := least((v_price->>'credits')::numeric, v_b.authorized_total_credits);
  v_charge := round(least(greatest(v_total - v_s.charged_before, 0), v_s.reserved_credits), 4);

  select * into v_set from public.wallet_settle(v_s.reservation_id, v_charge,
    jsonb_build_object(
      'provider', 'verify', 'provider_operation', 'verify_session',
      'raw_provider_cost_cents', round(greatest(((v_cost->>'rawUsd')::numeric * 100) - coalesce((select max(((x.cost->>'rawUsd')::numeric) * 100) from public.verify_billing_sessions x where x.job_id = p_job_id and x.state = 'SETTLED'), 0), 0), 4),
      'landed_cogs_cents', greatest(v_landed - v_b.landed_charged_cents, 0),
      'tax_cents', 0,
      'metadata', jsonb_build_object('verify_job_id', p_job_id, 'session', v_s.seq, 'outcome', p_outcome,
                                     'price', v_price, 'cost_state', v_cost->>'state', 'charged_before', v_s.charged_before,
                                     'overrun_credits', greatest((v_price->>'credits')::numeric - v_b.authorized_total_credits, 0),
                                     -- The $1 floor could not be met inside the customer's authorisation:
                                     -- never charged beyond it; recorded for finance instead.
                                     'profit_floor_shortfall', (v_price->>'floorApplied')::boolean and (v_price->>'credits')::numeric > v_b.authorized_total_credits)),
    case p_outcome when 'COMPLETE' then 'SUCCESS' when 'STOPPED' then 'CANCELLED' else 'PARTIAL' end);

  update public.verify_billing_sessions
     set state = 'SETTLED', outcome = p_outcome, charged_credits = v_set.settled_credits,
         released_credits = v_set.released_credits, cost = v_cost, price = v_price, closed_at = now()
   where id = v_s.id;
  update public.verify_billing
     set charged_total_credits = charged_total_credits + v_set.settled_credits,
         landed_charged_cents = greatest(landed_charged_cents, v_landed),
         state = case when p_outcome = 'STOPPED' then 'PAUSED' else 'SETTLED' end,
         -- A priced cost above everything the customer authorised is absorbed
         -- by HOMATCH, never charged, and recorded for finance review.
         needs_review = needs_review or v_review or v_set.clamped
                        or (v_price->>'credits')::numeric > v_b.authorized_total_credits,
         updated_at = now()
   where job_id = p_job_id
  returning * into v_b;
  return jsonb_build_object('ok', true, 'charged', v_set.settled_credits, 'released', v_set.released_credits,
    'chargedTotal', v_b.charged_total_credits, 'authorizedTotal', v_b.authorized_total_credits, 'clamped', v_set.clamped);
end;
$$;

-- ── 10. Queue tasks of a paused job: make room for their continuation ──
-- Cancelled/failed tasks keep their row (history, provenance) under an
-- archived dedupe key, so resuming enqueues them again through the normal
-- cache / single-flight path. Succeeded tasks are kept and never re-run.
create or replace function public.verify_job_requeue_unfinished(p_job_id uuid)
returns integer
language plpgsql security definer set search_path to ''
as $$
declare v_n integer;
begin
  update public.verify_tasks
     set dedupe_key = dedupe_key || '#a' || substr(md5(id::text || now()::text), 1, 6), updated_at = now()
   where job_id = p_job_id and state in ('CANCELLED', 'FAILED', 'DEAD')
     and dedupe_key !~ '#a[0-9a-f]{6}$';
  get diagnostics v_n = row_count;
  -- The job's own tasks still waiting or running are wanted again.
  update public.verify_tasks set cancel_requested = false, updated_at = now()
   where job_id = p_job_id and state in ('QUEUED', 'RUNNING') and cancel_requested;
  return v_n;
end;
$$;

-- ── 11. The launch quote a signed-in customer sees ───────────────────────
-- Credits, the USD reference value, the customer's own available balance and
-- the display currencies that have a configured rate. No cost, margin or VAT.
create or replace function public.verify_launch_quote()
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare
  v_pol jsonb := public.verify_budget_policy();
  -- The launch asks for the INITIAL authorisation only (25), never the 100 maximum.
  v_max numeric := coalesce((v_pol->>'initial_credits')::numeric, 25);
  v_uid uuid := auth.uid();
begin
  return jsonb_build_object(
    'enabled', coalesce((v_pol->>'enabled')::boolean, false),
    'maxCredits', v_max,
    'usdCents', public.billing_credits_to_cents(v_max),
    'availableCredits', case when v_uid is null then null else coalesce((select balance from public.credit_accounts where user_id = v_uid), 0) end,
    -- fx_rates: units of USD per one unit of the currency, effective now.
    'currencies', coalesce((
      select jsonb_agg(jsonb_build_object('code', r.base_currency, 'usdPerUnit', r.rate, 'asOf', r.effective_from) order by r.base_currency)
        from public.fx_rates r
       where r.quote_currency = 'USD' and r.base_currency <> 'USD'
         and r.effective_from <= now() and (r.effective_to is null or r.effective_to > now())), '[]'::jsonb));
end;
$$;

-- ── 12. Grants ──────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.verify_budget_policy()',
    'public.verify_num(text)',
    'public.verify_job_paused_at(jsonb, timestamptz)',
    'public.verify_price_for_cost(numeric, boolean)',
    'public.verify_job_cost(uuid)',
    'public.verify_billing_open(uuid, uuid, text, boolean, integer)',
    'public.verify_stage_credits(text)',
    'public.verify_budget_gate(uuid, text)',
    'public.verify_billing_state(uuid)',
    'public.verify_billing_close(uuid, text)',
    'public.verify_job_requeue_unfinished(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke execute on function %s from anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke all on function public.verify_launch_quote() from public, anon;
grant execute on function public.verify_launch_quote() to authenticated, service_role;
