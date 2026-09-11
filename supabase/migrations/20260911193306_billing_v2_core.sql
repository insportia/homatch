-- HOMATCH BILLING v2 — part 2 of 4: the schema.
--
-- Additive only. Nothing existing is dropped, renamed or retyped.
-- credit_accounts / credit_ledger / credit_reservations / research_products /
-- research_purchases keep working exactly as they do today; this builds the
-- generic layer around them.
--
-- WHAT THIS ADDS, AND WHY EACH ONE IS NOT A DUPLICATE OF SOMETHING THAT
-- ALREADY EXISTS
--
--   billing_plans              no plan table existed. users.plan was a
--                              free-text column read in one edge function.
--   billable_products          research_products is the FIXED-price pack
--                              catalogue (buy 1,000 Telegram lookups). This is
--                              the EXECUTION catalogue (run one Verify).
--                              Different billing shape, different lifecycle.
--   product_plan_entitlements  nothing existed.
--   user_subscriptions         nothing existed.
--   credit_lots                credit_accounts.balance is one opaque number
--                              with no provenance, so "purchased credits
--                              survive a downgrade" was unanswerable. Lots give
--                              every credit an origin and an expiry. balance
--                              stays as the materialised total.
--   usage_reservations         credit_reservations is welded to
--                              research_products.code and to a FIXED price
--                              known up front. Variable-cost execution needs
--                              estimate/authorize/settle-to-actual. The old
--                              table keeps serving the old flow untouched.
--   usage_events               cost_events records what a PROVIDER cost us,
--                              keyed to jobs. This records what a CUSTOMER was
--                              charged and the landed COGS behind it.
--   allowance_consumptions     nothing existed. Append-only, not a counter.

ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.credit_ledger.metadata IS
  'Provenance for the entry: lot ids and amounts drawn, reservation id, product code, plan at the time. Never customer-visible pricing internals.';

-- Reserved funds are not spendable and not gone. balance keeps meaning
-- "available to spend right now" so every existing caller is unaffected.
ALTER TABLE public.credit_accounts
  ADD COLUMN IF NOT EXISTS reserved numeric(18,4) NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.credit_accounts.reserved IS
  'Credits held by an open reservation. balance excludes these. balance + reserved = total owned.';

DO $$ BEGIN
  ALTER TABLE public.credit_accounts
    ADD CONSTRAINT credit_accounts_reserved_non_negative CHECK (reserved >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.credit_accounts VALIDATE CONSTRAINT credit_accounts_reserved_non_negative;

-- ── 1. Plans ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_plans (
  code text PRIMARY KEY,
  name text NOT NULL,
  monthly_price_cents integer NOT NULL DEFAULT 0,
  -- Credits granted at the start of every billing cycle. FREE gets none.
  membership_credits_grant numeric(18,4) NOT NULL DEFAULT 0,
  -- Ceiling on the MEMBERSHIP bucket. Roughly one unused cycle of rollover.
  membership_rollover_cap numeric(18,4) NOT NULL DEFAULT 0,
  quality_tier text NOT NULL DEFAULT 'STANDARD'
    CHECK (quality_tier IN ('STANDARD','ENHANCED','MAXIMUM')),
  -- Share of the base profit pool handed back to the customer as a pricing
  -- concession. FREE 0, VIP 2500 (25%), PREMIUM 5000 (50%). Internal only:
  -- customers are shown "VIP Member Rates", never a percentage of our margin.
  profit_share_to_customer_bps integer NOT NULL DEFAULT 0
    CHECK (profit_share_to_customer_bps BETWEEN 0 AND 10000),
  badge_key text,
  priority_level integer NOT NULL DEFAULT 0,
  ai_fair_use_key text NOT NULL DEFAULT 'ai_chat_daily_limit_free',
  marketing_label_key text,
  sort_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.billing_plans IS
  'The three consumer plans. Every limit lives here or in product_plan_entitlements, never hardcoded in a component.';
COMMENT ON COLUMN public.billing_plans.profit_share_to_customer_bps IS
  'INTERNAL. Fraction of base_profit_pool conceded to the member. Never expose to customers or render as a percentage in any customer-facing surface.';

INSERT INTO public.billing_plans
  (code, name, monthly_price_cents, membership_credits_grant, membership_rollover_cap,
   quality_tier, profit_share_to_customer_bps, badge_key, priority_level,
   ai_fair_use_key, marketing_label_key, sort_order)
VALUES
  ('FREE',    'Free',    0,     0,   0,   'STANDARD',    0, NULL,           0, 'ai_chat_daily_limit_free', NULL,               1),
  ('VIP',     'VIP',     900,  90, 180,  'ENHANCED',  2500, 'badge_vip',    1, 'ai_chat_daily_limit_vip',  'plan_label_popular',2),
  ('PREMIUM', 'Premium', 2900, 290, 580, 'MAXIMUM',   5000, 'badge_premium',2, 'ai_chat_daily_limit_premium','plan_label_best_value',3)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_plans_read ON public.billing_plans
  FOR SELECT TO anon, authenticated USING (enabled = true OR public.is_admin());
CREATE POLICY billing_plans_admin_write ON public.billing_plans
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY billing_plans_service ON public.billing_plans
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 2. Billable product registry ───────────────────────────
-- Adding AI_CALL or EMAIL_CAMPAIGN later is an INSERT here plus rows in
-- product_plan_entitlements. No wallet, ledger, reservation, pricing or
-- subscription change is required, which is the extensibility requirement.
CREATE TABLE IF NOT EXISTS public.billable_products (
  code text PRIMARY KEY,
  name text NOT NULL,
  billing_mode text NOT NULL DEFAULT 'VARIABLE'
    CHECK (billing_mode IN ('FIXED','VARIABLE','FREE')),
  requires_reservation boolean NOT NULL DEFAULT true,
  -- Standard (FREE-plan) retail price for one reference execution, in cents.
  standard_retail_cents integer NOT NULL DEFAULT 0,
  -- Planning reference for landed COGS. The real figure comes from usage_events
  -- after execution; this drives the quote before it.
  reference_landed_cogs_cents numeric(12,4) NOT NULL DEFAULT 0,
  -- Loss protection. No plan discount may push a price under this margin.
  min_gross_margin_bps integer NOT NULL DEFAULT 3000
    CHECK (min_gross_margin_bps BETWEEN 0 AND 9999),
  estimate_strategy text NOT NULL DEFAULT 'RANGE'
    CHECK (estimate_strategy IN ('FIXED','RANGE','PER_UNIT')),
  pricing_version integer NOT NULL DEFAULT 1,
  -- enabled        = the product exists and can run.
  -- pricing_active = it may charge. AI_CALL / EMAIL_CAMPAIGN are registered so
  --                  the architecture is proven extensible, with pricing
  --                  explicitly OFF until their economics are designed.
  enabled boolean NOT NULL DEFAULT true,
  pricing_active boolean NOT NULL DEFAULT true,
  kill_switch boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.billable_products IS
  'Execution catalogue. research_products is the separate fixed-size research PACK catalogue and is unrelated.';
COMMENT ON COLUMN public.billable_products.pricing_active IS
  'false = registered but must never be charged for. AI_CALL and EMAIL_CAMPAIGN ship this way on purpose: their pricing is a separate future design.';

INSERT INTO public.billable_products
  (code, name, billing_mode, requires_reservation, standard_retail_cents,
   reference_landed_cogs_cents, min_gross_margin_bps, estimate_strategy,
   enabled, pricing_active, sort_order, config)
VALUES
  ('VERIFY', 'Property Verification', 'VARIABLE', true, 50, 11.8000, 3000, 'RANGE', true, true, 1,
   '{"estimate_spread_bps":2500}'::jsonb),
  ('FIND_CLIENTS', 'Find Clients', 'VARIABLE', true, 250, 59.0000, 3000, 'RANGE', true, true, 2,
   '{"estimate_spread_bps":3000}'::jsonb),
  ('CONTRACT_INTELLIGENCE', 'Contract Intelligence', 'VARIABLE', true, 80, 18.8800, 3000, 'RANGE', true, true, 3,
   '{"estimate_spread_bps":2000}'::jsonb),
  ('BROKER_FINDER', 'Broker Finder', 'VARIABLE', true, 120, 28.3200, 3000, 'RANGE', true, true, 4,
   '{"estimate_spread_bps":2500}'::jsonb),
  ('EMAIL_CAMPAIGN', 'Email Campaigns', 'VARIABLE', true, 0, 0, 3000, 'PER_UNIT', false, false, 90,
   '{"scope_note":"Registered so the wallet/ledger/reservation/entitlement layer is provably extensible. Pricing and allowances are a separate future design and must not be invented here."}'::jsonb),
  ('AI_CALL', 'AI Call Center', 'VARIABLE', true, 0, 0, 3000, 'PER_UNIT', false, false, 91,
   '{"scope_note":"Registered so the wallet/ledger/reservation/entitlement layer is provably extensible. Pricing and allowances are a separate future design and must not be invented here."}'::jsonb)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.billable_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY billable_products_admin ON public.billable_products
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY billable_products_service ON public.billable_products
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Superseded by 20260911194005, which replaces this with a security_invoker
-- view plus column grants. Kept here so a replay from zero matches history.
CREATE OR REPLACE VIEW public.billable_products_public
WITH (security_invoker = false) AS
  SELECT code, name, billing_mode, requires_reservation, estimate_strategy,
         enabled, pricing_active, kill_switch, sort_order
  FROM public.billable_products
  WHERE enabled = true;
GRANT SELECT ON public.billable_products_public TO anon, authenticated;

-- ── 3. Entitlements: what a plan gets, per product ─────────
CREATE TABLE IF NOT EXISTS public.product_plan_entitlements (
  product_code text NOT NULL REFERENCES public.billable_products(code) ON DELETE CASCADE,
  plan_code text NOT NULL REFERENCES public.billing_plans(code) ON DELETE CASCADE,
  included_per_period integer NOT NULL DEFAULT 0,
  period text NOT NULL DEFAULT 'CALENDAR_MONTH'
    CHECK (period IN ('CALENDAR_MONTH','BILLING_CYCLE')),
  quality_tier text NOT NULL DEFAULT 'STANDARD'
    CHECK (quality_tier IN ('STANDARD','ENHANCED','MAXIMUM')),
  result_ceiling integer,
  provider_budget_ceiling_cents integer,
  priority_level integer NOT NULL DEFAULT 0,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_code, plan_code)
);
COMMENT ON TABLE public.product_plan_entitlements IS
  'The whole plan matrix. A paid plan never has a smaller included_per_period than FREE.';

-- The base allowance is identical on every plan. Upgrading buys a BETTER
-- execution of the same included benefit, never more or fewer of them. Result
-- ceilings and provider budgets are where the plans differ.
INSERT INTO public.product_plan_entitlements
  (product_code, plan_code, included_per_period, period, quality_tier, result_ceiling, provider_budget_ceiling_cents, priority_level)
VALUES
  ('VERIFY','FREE',    3,'CALENDAR_MONTH','STANDARD', NULL,  40, 0),
  ('VERIFY','VIP',     3,'BILLING_CYCLE', 'ENHANCED', NULL, 120, 1),
  ('VERIFY','PREMIUM', 3,'BILLING_CYCLE', 'MAXIMUM',  NULL, 300, 2),
  ('FIND_CLIENTS','FREE',    1,'CALENDAR_MONTH','STANDARD', 10,  200, 0),
  ('FIND_CLIENTS','VIP',     1,'BILLING_CYCLE', 'ENHANCED', 30,  600, 1),
  ('FIND_CLIENTS','PREMIUM', 1,'BILLING_CYCLE', 'MAXIMUM',  75, 1500, 2),
  ('CONTRACT_INTELLIGENCE','FREE',    1,'CALENDAR_MONTH','STANDARD', NULL,  60, 0),
  ('CONTRACT_INTELLIGENCE','VIP',     1,'BILLING_CYCLE', 'ENHANCED', NULL, 180, 1),
  ('CONTRACT_INTELLIGENCE','PREMIUM', 1,'BILLING_CYCLE', 'MAXIMUM',  NULL, 450, 2),
  ('BROKER_FINDER','FREE',    1,'CALENDAR_MONTH','STANDARD',  5,  90, 0),
  ('BROKER_FINDER','VIP',     1,'BILLING_CYCLE', 'ENHANCED', 15, 270, 1),
  ('BROKER_FINDER','PREMIUM', 1,'BILLING_CYCLE', 'MAXIMUM',  40, 700, 2),
  -- Zero included, pricing inactive. Placeholders only.
  ('EMAIL_CAMPAIGN','FREE',    0,'CALENDAR_MONTH','STANDARD', NULL, NULL, 0),
  ('EMAIL_CAMPAIGN','VIP',     0,'BILLING_CYCLE', 'ENHANCED', NULL, NULL, 1),
  ('EMAIL_CAMPAIGN','PREMIUM', 0,'BILLING_CYCLE', 'MAXIMUM',  NULL, NULL, 2),
  ('AI_CALL','FREE',    0,'CALENDAR_MONTH','STANDARD', NULL, NULL, 0),
  ('AI_CALL','VIP',     0,'BILLING_CYCLE', 'ENHANCED', NULL, NULL, 1),
  ('AI_CALL','PREMIUM', 0,'BILLING_CYCLE', 'MAXIMUM',  NULL, NULL, 2)
ON CONFLICT (product_code, plan_code) DO NOTHING;

ALTER TABLE public.product_plan_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY ppe_read ON public.product_plan_entitlements
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY ppe_admin_write ON public.product_plan_entitlements
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY ppe_service ON public.product_plan_entitlements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- "Paid plans must never lose a benefit that FREE users receive." Stated as a
-- constraint so a future admin edit cannot quietly break it.
CREATE OR REPLACE FUNCTION public.product_plan_entitlements_paid_never_worse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
declare
  v_free integer;
  v_min  integer;
begin
  select included_per_period into v_free
    from public.product_plan_entitlements
   where product_code = NEW.product_code and plan_code = 'FREE';

  if NEW.plan_code = 'FREE' then
    select min(included_per_period) into v_min
      from public.product_plan_entitlements
     where product_code = NEW.product_code and plan_code <> 'FREE';
    if v_min is not null and v_min < NEW.included_per_period then
      raise exception 'PAID_PLAN_WOULD_BE_WORSE_THAN_FREE: a paid plan has % included, FREE would have %', v_min, NEW.included_per_period;
    end if;
  elsif v_free is not null and NEW.included_per_period < v_free then
    raise exception 'PAID_PLAN_WOULD_BE_WORSE_THAN_FREE: % on % would get % included, FREE gets %',
      NEW.plan_code, NEW.product_code, NEW.included_per_period, v_free;
  end if;

  return NEW;
end;
$fn$;
REVOKE EXECUTE ON FUNCTION public.product_plan_entitlements_paid_never_worse() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ppe_paid_never_worse ON public.product_plan_entitlements;
CREATE TRIGGER trg_ppe_paid_never_worse
  BEFORE INSERT OR UPDATE ON public.product_plan_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.product_plan_entitlements_paid_never_worse();

-- ── 4. Subscriptions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan_code text NOT NULL REFERENCES public.billing_plans(code),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','CANCELLED','PAST_DUE','EXPIRED')),
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  provider text,
  provider_subscription_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One live subscription per customer. Upgrades supersede, never stack.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_user_subscriptions_one_active
  ON public.user_subscriptions(user_id) WHERE status IN ('ACTIVE','PAST_DUE');
CREATE UNIQUE INDEX IF NOT EXISTS uidx_user_subscriptions_provider_sub
  ON public.user_subscriptions(provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_period_end
  ON public.user_subscriptions(current_period_end) WHERE status = 'ACTIVE';

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_subscriptions_read_own ON public.user_subscriptions
  FOR SELECT TO authenticated USING (user_id = public.auth_user_id() OR public.is_admin());
-- No client-side INSERT/UPDATE at all: a subscription only ever changes from a
-- verified provider webhook running as the service role.
CREATE POLICY user_subscriptions_service ON public.user_subscriptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.user_subscriptions(id) ON DELETE SET NULL,
  event_type text NOT NULL
    CHECK (event_type IN ('CREATED','RENEWED','UPGRADED','DOWNGRADED','CANCELLED','REACTIVATED','EXPIRED','GRANT_ISSUED','GRANT_SKIPPED')),
  plan_code text REFERENCES public.billing_plans(code),
  previous_plan_code text REFERENCES public.billing_plans(code),
  -- Every consequential subscription act is idempotent on this key, so a
  -- redelivered renewal webhook cannot grant a second month of credits.
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_subscription_events_idem
  ON public.subscription_events(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_subscription_events_user
  ON public.subscription_events(user_id, created_at DESC);

ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscription_events_read_own ON public.subscription_events
  FOR SELECT TO authenticated USING (user_id = public.auth_user_id() OR public.is_admin());
CREATE POLICY subscription_events_service ON public.subscription_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 5. Credit lots: every credit knows where it came from ──
CREATE TABLE IF NOT EXISTS public.credit_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind text NOT NULL
    CHECK (kind IN ('PURCHASED','MEMBERSHIP','PROMOTIONAL','ADJUSTMENT')),
  credits_granted numeric(18,4) NOT NULL CHECK (credits_granted > 0),
  credits_consumed numeric(18,4) NOT NULL DEFAULT 0 CHECK (credits_consumed >= 0),
  credits_reserved numeric(18,4) NOT NULL DEFAULT 0 CHECK (credits_reserved >= 0),
  credits_expired  numeric(18,4) NOT NULL DEFAULT 0 CHECK (credits_expired >= 0),
  -- Generated, so "available" can never drift from its parts.
  credits_available numeric(18,4)
    GENERATED ALWAYS AS (credits_granted - credits_consumed - credits_reserved - credits_expired) STORED,
  -- PURCHASED lots are NULL here: purchased credits do not expire.
  expires_at timestamptz,
  granted_at timestamptz NOT NULL DEFAULT now(),
  source_type text NOT NULL,
  source_ref text,
  plan_code text REFERENCES public.billing_plans(code),
  ledger_entry_id uuid REFERENCES public.credit_ledger(id),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','EXHAUSTED','EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_lots_not_overdrawn
    CHECK (credits_consumed + credits_reserved + credits_expired <= credits_granted),
  -- A PURCHASED lot with an expiry would silently break the "purchased credits
  -- never expire" promise, so the schema refuses to store one.
  CONSTRAINT credit_lots_purchased_never_expire
    CHECK (kind <> 'PURCHASED' OR expires_at IS NULL)
);
-- The spend-order index: promotional first, then membership, then purchased,
-- each by soonest expiry. Matches the ORDER BY in wallet_reserve() exactly.
CREATE INDEX IF NOT EXISTS idx_credit_lots_spend_order
  ON public.credit_lots(user_id, kind, expires_at NULLS LAST, granted_at)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_credit_lots_expiring
  ON public.credit_lots(expires_at) WHERE status = 'ACTIVE' AND expires_at IS NOT NULL;
-- Idempotent granting: one lot per (user, source_type, source_ref).
CREATE UNIQUE INDEX IF NOT EXISTS uidx_credit_lots_source
  ON public.credit_lots(user_id, source_type, source_ref) WHERE source_ref IS NOT NULL;

COMMENT ON TABLE public.credit_lots IS
  'Provenance buckets behind credit_accounts.balance. Invariant, asserted by billing_wallet_integrity(): balance = SUM(credits_available) and reserved = SUM(credits_reserved).';

ALTER TABLE public.credit_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY credit_lots_read_own ON public.credit_lots
  FOR SELECT TO authenticated USING (user_id = public.auth_user_id() OR public.is_admin());
CREATE POLICY credit_lots_service ON public.credit_lots
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 6. Generic reservations: estimate -> authorize -> settle ──
CREATE TABLE IF NOT EXISTS public.usage_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  product_code text NOT NULL REFERENCES public.billable_products(code),
  status text NOT NULL DEFAULT 'RESERVED'
    CHECK (status IN ('RESERVED','SETTLED','RELEASED','EXPIRED','CANCELLED')),
  -- The job finishes under the plan it started under. Cancelling Premium
  -- mid-search must not downgrade a running Maximum search.
  plan_code_snapshot text NOT NULL REFERENCES public.billing_plans(code),
  quality_tier_snapshot text NOT NULL
    CHECK (quality_tier_snapshot IN ('STANDARD','ENHANCED','MAXIMUM')),
  pricing_version_snapshot integer NOT NULL DEFAULT 1,
  profit_share_bps_snapshot integer NOT NULL DEFAULT 0,
  result_ceiling_snapshot integer,
  provider_budget_ceiling_cents_snapshot integer,
  estimate_min_credits numeric(18,4) NOT NULL DEFAULT 0,
  estimate_max_credits numeric(18,4) NOT NULL DEFAULT 0,
  -- The hard ceiling the customer consented to. The backend must never settle
  -- above this, whatever the provider ends up costing.
  authorized_max_credits numeric(18,4) NOT NULL CHECK (authorized_max_credits >= 0),
  reserved_credits numeric(18,4) NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  settled_credits numeric(18,4) NOT NULL DEFAULT 0 CHECK (settled_credits >= 0),
  released_credits numeric(18,4) NOT NULL DEFAULT 0 CHECK (released_credits >= 0),
  -- Allowance-funded runs reserve 0 credits and point at their slot.
  allowance_consumption_id uuid,
  job_ref text,
  idempotency_key text NOT NULL,
  ledger_reserve_id uuid REFERENCES public.credit_ledger(id),
  ledger_capture_id uuid REFERENCES public.credit_ledger(id),
  ledger_release_id uuid REFERENCES public.credit_ledger(id),
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '60 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CONSTRAINT usage_reservations_settle_within_authorization
    CHECK (settled_credits <= authorized_max_credits)
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_usage_reservations_idem
  ON public.usage_reservations(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_usage_reservations_user
  ON public.usage_reservations(user_id, created_at DESC);
-- Drives the stale-reservation sweeper. A crashed worker must not strand a
-- customer's funds.
CREATE INDEX IF NOT EXISTS idx_usage_reservations_open
  ON public.usage_reservations(expires_at) WHERE status = 'RESERVED';
CREATE INDEX IF NOT EXISTS idx_usage_reservations_job
  ON public.usage_reservations(job_ref) WHERE job_ref IS NOT NULL;

ALTER TABLE public.usage_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY usage_reservations_read_own ON public.usage_reservations
  FOR SELECT TO authenticated USING (user_id = public.auth_user_id() OR public.is_admin());
CREATE POLICY usage_reservations_service ON public.usage_reservations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Which lots a reservation drew on, so settlement returns the unused part to
-- the same buckets it came from. A promotional credit released back into the
-- purchased bucket would be a withdrawable-cash bug.
CREATE TABLE IF NOT EXISTS public.credit_lot_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.usage_reservations(id) ON DELETE CASCADE,
  lot_id uuid NOT NULL REFERENCES public.credit_lots(id) ON DELETE RESTRICT,
  allocated_credits numeric(18,4) NOT NULL CHECK (allocated_credits >= 0),
  settled_credits numeric(18,4) NOT NULL DEFAULT 0 CHECK (settled_credits >= 0),
  released_credits numeric(18,4) NOT NULL DEFAULT 0 CHECK (released_credits >= 0),
  spend_rank integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_lot_allocations_balanced
    CHECK (settled_credits + released_credits <= allocated_credits)
);
CREATE INDEX IF NOT EXISTS idx_credit_lot_allocations_res
  ON public.credit_lot_allocations(reservation_id, spend_rank);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_credit_lot_allocations_pair
  ON public.credit_lot_allocations(reservation_id, lot_id);

ALTER TABLE public.credit_lot_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY cla_read_own ON public.credit_lot_allocations
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.usage_reservations r
       WHERE r.id = credit_lot_allocations.reservation_id
         AND r.user_id = public.auth_user_id()));
CREATE POLICY cla_service ON public.credit_lot_allocations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 7. Actual-usage / COGS accounting ──────────────────────
CREATE TABLE IF NOT EXISTS public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES public.usage_reservations(id) ON DELETE SET NULL,
  product_code text NOT NULL REFERENCES public.billable_products(code),
  plan_code text NOT NULL REFERENCES public.billing_plans(code),
  quality_tier text NOT NULL,
  pricing_version integer NOT NULL DEFAULT 1,
  provider text,
  provider_operation text,
  provider_request_id text,
  model text,
  input_tokens bigint,
  cached_tokens bigint,
  output_tokens bigint,
  search_count integer,
  provider_units numeric(18,4),
  enrichment_units numeric(18,4),
  duration_ms integer,
  -- Internal economics. Never returned by any customer-facing RPC or view, and
  -- not granted at the column level to anon/authenticated (20260911194022).
  raw_provider_cost_cents numeric(14,4) NOT NULL DEFAULT 0,
  ai_cost_cents numeric(14,4) NOT NULL DEFAULT 0,
  tax_cents numeric(14,4) NOT NULL DEFAULT 0,
  fee_cents numeric(14,4) NOT NULL DEFAULT 0,
  landed_cogs_cents numeric(14,4) NOT NULL DEFAULT 0,
  -- Customer-facing side.
  charged_credits numeric(18,4) NOT NULL DEFAULT 0,
  reserved_credits numeric(18,4) NOT NULL DEFAULT 0,
  released_credits numeric(18,4) NOT NULL DEFAULT 0,
  -- true when the run came out of the plan's included allowance rather than
  -- the wallet. These are the free-allowance COGS in the CAC report.
  allowance_funded boolean NOT NULL DEFAULT false,
  -- false when Homatch ate the cost: our bug, a provider failure, or a
  -- cancellation before useful output.
  billable boolean NOT NULL DEFAULT true,
  outcome text NOT NULL DEFAULT 'SUCCESS'
    CHECK (outcome IN ('SUCCESS','PARTIAL','FAILED','CANCELLED','TIMEOUT')),
  failure_reason text,
  job_ref text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_events_user_product
  ON public.usage_events(user_id, product_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_created ON public.usage_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_reservation
  ON public.usage_events(reservation_id) WHERE reservation_id IS NOT NULL;

COMMENT ON TABLE public.usage_events IS
  'What a customer was charged and what it actually cost us. Admin/service only: raw_provider_cost_cents and landed_cogs_cents must never reach a customer.';

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
-- No customer SELECT policy on the raw table by design - the COGS columns live
-- here. Customers read their own history through the entitlement layer.
CREATE POLICY usage_events_admin_read ON public.usage_events
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY usage_events_service ON public.usage_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 8. Included-allowance consumption (append-only) ────────
-- Remaining allowance is COUNT(*) over this table for the current period.
-- Nothing is ever reset; the period key simply changes. That is why there is
-- no cron job resetting a mutable counter anywhere in this system.
CREATE TABLE IF NOT EXISTS public.allowance_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  product_code text NOT NULL REFERENCES public.billable_products(code),
  -- 'CAL:2026-09' for FREE, 'SUB:<subscription id>:<cycle start>' for paid.
  period_key text NOT NULL,
  slot_index integer NOT NULL CHECK (slot_index >= 1),
  plan_code text NOT NULL REFERENCES public.billing_plans(code),
  quality_tier text NOT NULL,
  reservation_id uuid REFERENCES public.usage_reservations(id) ON DELETE SET NULL,
  job_ref text,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- The atomicity guarantee: two concurrent 4th-Verify attempts cannot both take
-- slot 3.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_allowance_slot
  ON public.allowance_consumptions(user_id, product_code, period_key, slot_index)
  WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_allowance_lookup
  ON public.allowance_consumptions(user_id, product_code, period_key)
  WHERE released_at IS NULL;

ALTER TABLE public.allowance_consumptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY allowance_read_own ON public.allowance_consumptions
  FOR SELECT TO authenticated USING (user_id = public.auth_user_id() OR public.is_admin());
CREATE POLICY allowance_service ON public.allowance_consumptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $$ BEGIN
  ALTER TABLE public.usage_reservations
    ADD CONSTRAINT usage_reservations_allowance_fk
    FOREIGN KEY (allowance_consumption_id)
    REFERENCES public.allowance_consumptions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 9. Top-up packs and promotions ─────────────────────────
CREATE TABLE IF NOT EXISTS public.topup_packs (
  code text PRIMARY KEY,
  amount_cents integer NOT NULL CHECK (amount_cents >= 100),
  credits numeric(18,4) NOT NULL CHECK (credits > 0),
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- $1 = 10 Credits at every size. The only bonus is the once-per-customer
-- activation promo below, deliberately NOT baked into a pack.
INSERT INTO public.topup_packs (code, amount_cents, credits, sort_order) VALUES
  ('USD_1',   100,   10, 1),
  ('USD_5',   500,   50, 2),
  ('USD_10', 1000,  100, 3),
  ('USD_25', 2500,  250, 4),
  ('USD_50', 5000,  500, 5)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.topup_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY topup_packs_read ON public.topup_packs
  FOR SELECT TO anon, authenticated USING (enabled = true OR public.is_admin());
CREATE POLICY topup_packs_admin ON public.topup_packs
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY topup_packs_service ON public.topup_packs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.promotions (
  code text PRIMARY KEY,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  -- 'FIRST_TOPUP' is the only kind today. New kinds are new rows, not new
  -- tables.
  kind text NOT NULL DEFAULT 'FIRST_TOPUP',
  min_amount_cents integer NOT NULL DEFAULT 100,
  -- Promotional credits granted, as a multiple of the purchased credits.
  -- 10000 bps = match the purchase 1:1, i.e. pay $1 -> 10 purchased + 10 promo.
  bonus_match_bps integer NOT NULL DEFAULT 10000,
  max_bonus_credits numeric(18,4) NOT NULL DEFAULT 10,
  bonus_expires_after_days integer,
  max_redemptions_per_user integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.promotions
  (code, name, kind, min_amount_cents, bonus_match_bps, max_bonus_credits, bonus_expires_after_days)
VALUES
  ('FIRST_TOPUP_DOUBLE', 'Balance Activation — double value', 'FIRST_TOPUP', 100, 10000, 10, NULL)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY promotions_read ON public.promotions
  FOR SELECT TO anon, authenticated USING (enabled = true OR public.is_admin());
CREATE POLICY promotions_admin ON public.promotions
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY promotions_service ON public.promotions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Eligibility is enforced here, atomically, by unique indexes. Not in the
-- frontend, and not by an application-level "have we already?" read.
CREATE TABLE IF NOT EXISTS public.promotion_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  promo_code text NOT NULL REFERENCES public.promotions(code),
  payment_id uuid REFERENCES public.payments(id),
  -- Whatever stable identity the payment provider gives us for the instrument
  -- (Stripe payment_method fingerprint). NULL when the provider offers none;
  -- the per-user index still holds.
  payment_fingerprint text,
  credits_granted numeric(18,4) NOT NULL,
  lot_id uuid REFERENCES public.credit_lots(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_promo_redemption_user
  ON public.promotion_redemptions(user_id, promo_code);
-- Same card, second account: still one bonus.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_promo_redemption_fingerprint
  ON public.promotion_redemptions(promo_code, payment_fingerprint)
  WHERE payment_fingerprint IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_promo_redemption_payment
  ON public.promotion_redemptions(payment_id) WHERE payment_id IS NOT NULL;

ALTER TABLE public.promotion_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY promo_redemptions_read_own ON public.promotion_redemptions
  FOR SELECT TO authenticated USING (user_id = public.auth_user_id() OR public.is_admin());
CREATE POLICY promo_redemptions_service ON public.promotion_redemptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 10. Pricing config versions ────────────────────────────
-- Scalar levers stay in admin_settings (the established pattern); this captures
-- the whole resolved config at each publish so a historical job's economics can
-- be reconstructed exactly, even after a dozen admin edits.
CREATE TABLE IF NOT EXISTS public.pricing_versions (
  version integer PRIMARY KEY,
  config jsonb NOT NULL,
  note text,
  published_by uuid REFERENCES public.users(id),
  published_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pricing_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY pricing_versions_admin ON public.pricing_versions
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY pricing_versions_service ON public.pricing_versions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 11. Config levers ──────────────────────────────────────
INSERT INTO public.admin_settings (key, value, description) VALUES
  ('credits_per_usd', '10'::jsonb,
   'Credits issued per US dollar. 10 => 1 Credit = $0.10 of Homatch service value. Changing this does NOT redenominate existing balances; that is a deliberate one-off migration.'),
  ('billing_min_topup_cents', '100'::jsonb,
   'Minimum wallet activation / top-up, in cents. $1.'),
  ('billing_min_gross_margin_bps', '3000'::jsonb,
   'Global minimum gross margin floor (3000 = 30%). billable_products.min_gross_margin_bps overrides per product. No plan discount may price below this.'),
  ('billing_cogs_tax_bps', '1800'::jsonb,
   'Additional non-recoverable cost applied on top of raw provider + AI cost when computing landed COGS (1800 = 18%). Separate from payments.vat_rate_bps, which is output VAT on a sale.'),
  ('billing_cogs_fee_bps', '0'::jsonb,
   'Variable payment/transaction fee folded into landed COGS, in basis points. 0 until a real provider fee schedule is known.'),
  ('billing_credit_rounding_dp', '2'::jsonb,
   'Decimal places customer credit charges are rounded to.'),
  ('billing_reservation_ttl_minutes', '60'::jsonb,
   'How long an unsettled reservation is held before the sweeper releases it back to the wallet.'),
  ('billing_payg_enabled', 'true'::jsonb,
   'Global PAYG kill switch. false stops every credit-charging execution; included allowances and free products are unaffected.'),
  ('billing_membership_grants_enabled', 'true'::jsonb,
   'Kill switch for recurring VIP/Premium credit grants.'),
  ('billing_first_topup_promo_enabled', 'true'::jsonb,
   'Kill switch for the once-per-customer wallet activation bonus.'),
  ('billing_pricing_version', '1'::jsonb,
   'Current pricing config version stamped onto every reservation and usage event.'),
  ('ai_chat_daily_limit_vip', '400'::jsonb,
   'AI Chat daily message fair-use ceiling for VIP. Not a credit charge - ordinary chat never touches the wallet.'),
  ('ai_chat_daily_limit_premium', '1500'::jsonb,
   'AI Chat daily message fair-use ceiling for Premium. High enough to feel unlimited to a human; exists only to stop automation.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.pricing_versions (version, config, note) VALUES
  (1, jsonb_build_object(
        'credits_per_usd', 10,
        'cogs_tax_bps', 1800,
        'cogs_fee_bps', 0,
        'min_gross_margin_bps', 3000,
        'plans', (SELECT jsonb_object_agg(code, jsonb_build_object(
                    'monthly_price_cents', monthly_price_cents,
                    'membership_credits_grant', membership_credits_grant,
                    'membership_rollover_cap', membership_rollover_cap,
                    'profit_share_to_customer_bps', profit_share_to_customer_bps))
                  FROM public.billing_plans),
        'products', (SELECT jsonb_object_agg(code, jsonb_build_object(
                    'standard_retail_cents', standard_retail_cents,
                    'reference_landed_cogs_cents', reference_landed_cogs_cents,
                    'min_gross_margin_bps', min_gross_margin_bps))
                  FROM public.billable_products)),
      'Initial published pricing configuration.')
ON CONFLICT (version) DO NOTHING;

-- ── 12. updated_at upkeep ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.billing_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
begin NEW.updated_at := now(); return NEW; end;
$fn$;
REVOKE EXECUTE ON FUNCTION public.billing_touch_updated_at() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'billing_plans','billable_products','product_plan_entitlements','user_subscriptions',
    'credit_lots','usage_reservations','topup_packs','promotions'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_touch ON public.%1$s;
       CREATE TRIGGER trg_%1$s_touch BEFORE UPDATE ON public.%1$s
       FOR EACH ROW EXECUTE FUNCTION public.billing_touch_updated_at();', t);
  END LOOP;
END $$;
