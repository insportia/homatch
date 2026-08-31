-- ============================================================
-- HOMATCH — Pricing / Payment / Wallet foundation (part 2 of 2)
-- New tables + atomic wallet functions. Requires part 1's enum
-- values to already be committed.
-- ============================================================

-- 1. Fixed-price research products (Master Prompt §2, §3, §8, §30).
--    price_cents is the customer-facing, VAT-INCLUSIVE retail price.
CREATE TABLE IF NOT EXISTS public.research_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('TELEGRAM','FACEBOOK','GOOGLE')),
  unit_count integer NOT NULL DEFAULT 1000,
  price_cents integer NOT NULL,
  vat_rate_bps integer NOT NULL DEFAULT 1800,
  reference_cogs_cents integer NOT NULL,
  target_contribution_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.research_products IS 'Fixed Homatch retail research packs. price_cents is VAT-inclusive; provider COGS never shown to customers (Master Prompt §21).';
COMMENT ON COLUMN public.research_products.price_cents IS 'Customer-facing VAT-inclusive retail price for the whole pack, in integer cents.';

INSERT INTO public.research_products (code, name, category, unit_count, price_cents, vat_rate_bps, reference_cogs_cents, target_contribution_cents, sort_order) VALUES
  ('TELEGRAM_1K',        'Telegram Research — 1,000 requests',      'TELEGRAM', 1000, 763, 1800, 146, 500, 1),
  ('FACEBOOK_1K',        'Facebook Research — 1,000 records',       'FACEBOOK', 1000, 767, 1800, 150, 500, 2),
  ('GOOGLE_STANDARD_1K', 'Google Research (Standard) — 1,000 searches', 'GOOGLE', 1000, 661, 1800, 60,  500, 3),
  ('GOOGLE_PRIORITY_1K', 'Google Research (Priority) — 1,000 searches', 'GOOGLE', 1000, 732, 1800, 120, 500, 4),
  ('GOOGLE_LIVE_1K',     'Google Research (Live) — 1,000 searches',     'GOOGLE', 1000, 826, 1800, 200, 500, 5)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.research_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY research_products_read_enabled ON public.research_products
  FOR SELECT USING (enabled = true OR public.is_admin());
CREATE POLICY research_products_admin_write ON public.research_products
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY research_products_service_all ON public.research_products
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 2. Wallet reservations — RESERVE -> CAPTURE / RELEASE lifecycle
--    (Master Prompt §19, §20).
CREATE TABLE IF NOT EXISTS public.credit_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  product_code text NOT NULL REFERENCES public.research_products(code),
  credits_amount numeric(12,4) NOT NULL,
  status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','CAPTURED','RELEASED')),
  ledger_reserve_id uuid REFERENCES public.credit_ledger(id),
  ledger_capture_id uuid REFERENCES public.credit_ledger(id),
  ledger_release_id uuid REFERENCES public.credit_ledger(id),
  reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes')
);
CREATE INDEX IF NOT EXISTS idx_credit_reservations_user ON public.credit_reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_reservations_status ON public.credit_reservations(status) WHERE status = 'RESERVED';

ALTER TABLE public.credit_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY credit_reservations_read_own ON public.credit_reservations
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
CREATE POLICY credit_reservations_service_all ON public.credit_reservations
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 3. Purchased research-pack balances (Master Prompt §17, §20).
CREATE TABLE IF NOT EXISTS public.research_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  product_code text NOT NULL REFERENCES public.research_products(code),
  reservation_id uuid REFERENCES public.credit_reservations(id),
  payment_id uuid REFERENCES public.payments(id),
  units_purchased integer NOT NULL,
  units_used integer NOT NULL DEFAULT 0,
  units_remaining integer NOT NULL,
  price_cents_snapshot integer NOT NULL,
  vat_rate_bps_snapshot integer NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXHAUSTED','EXPIRED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_research_purchases_user ON public.research_purchases(user_id);

ALTER TABLE public.research_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY research_purchases_read_own ON public.research_purchases
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
CREATE POLICY research_purchases_service_all ON public.research_purchases
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 4. Provider treasury — internal COGS/budget tracking, NEVER
--    exposed to customers (Master Prompt §21, §24).
CREATE TABLE IF NOT EXISTS public.research_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code text UNIQUE NOT NULL,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  kill_switch boolean NOT NULL DEFAULT true,
  billing_model text NOT NULL DEFAULT 'PAYG' CHECK (billing_model IN ('SUBSCRIPTION','PAYG')),
  billing_currency text NOT NULL DEFAULT 'USD',
  reference_cost_usd_cents integer,
  included_usage integer,
  current_usage integer NOT NULL DEFAULT 0,
  estimated_cogs_cents integer NOT NULL DEFAULT 0,
  actual_cogs_cents integer,
  daily_cap_cents integer,
  monthly_cap_cents integer,
  daily_spend_cents integer NOT NULL DEFAULT 0,
  monthly_spend_cents integer NOT NULL DEFAULT 0,
  health_status text NOT NULL DEFAULT 'NOT_CONFIGURED' CHECK (health_status IN ('ACTIVE','DEGRADED','DOWN','LOCKED','NOT_CONFIGURED')),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  notes text,
  effective_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.research_providers IS 'Internal provider treasury/COGS tracking (Master Prompt §21/§24). Admin-only — must never be exposed to customers.';

INSERT INTO public.research_providers (provider_code, display_name, enabled, kill_switch, billing_model, billing_currency, reference_cost_usd_cents, included_usage, health_status, notes) VALUES
  ('TGSTAT',    'TGStat (Telegram Search API)', false, true,  'SUBSCRIPTION', 'USD', 14600, 100000, 'NOT_CONFIGURED', 'Preferred Telegram provider per product spec. Not yet integrated — no TGStat client exists in the codebase and no API credentials are configured. Reference cost is a planning estimate only ($146 / 100,000 requests) and must be confirmed with the admin once a real TGStat account and billing-currency conversion are set up.'),
  ('DATAFORSEO','DataForSEO (Google SERPs)',     true,  false, 'PAYG',        'USD', NULL,  NULL,   'ACTIVE',         'Real DataForSEO integration already exists in _shared/providers.ts and has a passing health check in production.'),
  ('BRIGHTDATA','Bright Data (Facebook Groups)', false, true,  'PAYG',        'USD', NULL,  NULL,   'NOT_CONFIGURED', 'Placeholder only today. No live Bright Data integration or credentials exist yet; enable once a Facebook-Groups-compliant provider account is configured.'),
  ('APIFY',     'Apify (fallback, paid execution disabled)', false, true, 'PAYG', 'USD', NULL, NULL, 'LOCKED', 'Paid Apify execution is disabled by product policy (Master Prompt §7) even though credentials are configured and a health check has passed. Keep as an optional future fallback only — do not enable without an explicit decision to allow paid runs.')
ON CONFLICT (provider_code) DO NOTHING;

ALTER TABLE public.research_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY research_providers_admin_only ON public.research_providers
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY research_providers_service_all ON public.research_providers
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 5. Research cache / dedup / provenance — "the business advantage"
--    (Master Prompt §25-29). Service-role managed; admins can read
--    it for the cache-savings KPI, customers never touch it directly.
CREATE TABLE IF NOT EXISTS public.research_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text UNIQUE NOT NULL,
  provider text NOT NULL,
  source_platform text,
  source_reference text,
  query_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  market text,
  language text,
  normalized_intent text,
  result_json jsonb,
  content_hash text,
  confidence numeric(4,3),
  freshness_status text NOT NULL DEFAULT 'FRESH' CHECK (freshness_status IN ('LIVE','FRESH','AGING','STALE')),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz NOT NULL DEFAULT now(),
  retention_expires_at timestamptz,
  created_by_user_id uuid REFERENCES public.users(id),
  hit_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_research_cache_content_hash ON public.research_cache(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_research_cache_freshness ON public.research_cache(freshness_status);
COMMENT ON TABLE public.research_cache IS 'Normalized, deduplicated external-research results with full provenance. Search this before calling any paid provider (Master Prompt §25/§26/§28).';

ALTER TABLE public.research_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY research_cache_admin_read ON public.research_cache
  FOR SELECT USING (public.is_admin());
CREATE POLICY research_cache_service_all ON public.research_cache
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 6. Admin audit log (Master Prompt §51).
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES public.users(id),
  action text NOT NULL,
  target_type text,
  target_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON public.admin_audit_log(created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_audit_log_admin_read ON public.admin_audit_log
  FOR SELECT USING (public.is_admin());
CREATE POLICY admin_audit_log_service_all ON public.admin_audit_log
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 7. Atomic wallet functions, mirroring the existing
--    atomic_external_match_unlock(...) pattern (SECURITY DEFINER,
--    row locks, immutable ledger rows for every balance change).

-- 7a. Fix the pre-existing non-atomic read-then-write race in
--     payment-webhook's top-up path (Master Prompt §11/§14/§15).
CREATE OR REPLACE FUNCTION public.credit_topup_atomic(
  p_user_id uuid,
  p_credits numeric,
  p_reference text,
  p_payment_id uuid DEFAULT NULL
) RETURNS TABLE(ledger_entry_id uuid, balance_after numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_before numeric;
  v_after numeric;
  v_ledger uuid;
begin
  if p_user_id is null or p_credits is null or p_credits <= 0 then
    raise exception 'INVALID_ARGUMENT';
  end if;

  select ca.balance into v_before from public.credit_accounts ca where ca.user_id = p_user_id for update;
  if not found then
    insert into public.credit_accounts(user_id, balance) values (p_user_id, 0);
    v_before := 0;
  end if;

  v_after := v_before + p_credits;
  update public.credit_accounts set balance = v_after, updated_at = now() where user_id = p_user_id;

  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference, payment_id)
  values (p_user_id, p_credits, v_before, v_after, 'TOP_UP', p_reference, p_payment_id)
  returning id into v_ledger;

  return query select v_ledger, v_after;
end;
$function$;

-- 7b. RESERVE: hold funds for a fixed-price research product.
--     Callable by the owning authenticated user (self-service
--     purchase flow) or the service role.
CREATE OR REPLACE FUNCTION public.reserve_credits_for_product(
  p_user_id uuid,
  p_product_code text,
  p_reference text DEFAULT NULL
) RETURNS TABLE(reservation_id uuid, ledger_entry_id uuid, credits_reserved numeric, balance_after numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_product record;
  v_price_credits numeric;
  v_before numeric;
  v_after numeric;
  v_ledger uuid;
  v_reservation uuid;
begin
  if p_user_id is null or p_product_code is null then raise exception 'INVALID_ARGUMENT'; end if;
  if auth.role() <> 'service_role' and p_user_id <> public.auth_user_id() then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_product from public.research_products where code = p_product_code and enabled = true;
  if not found then raise exception 'PRODUCT_NOT_FOUND_OR_DISABLED'; end if;

  v_price_credits := v_product.price_cents::numeric / 100;

  select ca.balance into v_before from public.credit_accounts ca where ca.user_id = p_user_id for update;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  if v_before < v_price_credits then raise exception 'INSUFFICIENT_CREDITS'; end if;

  v_after := v_before - v_price_credits;
  update public.credit_accounts set balance = v_after, updated_at = now() where user_id = p_user_id;

  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference)
  values (p_user_id, -v_price_credits, v_before, v_after, 'SERVICE_RESERVE', coalesce(p_reference, 'product:' || p_product_code))
  returning id into v_ledger;

  insert into public.credit_reservations(user_id, product_code, credits_amount, status, ledger_reserve_id, reference)
  values (p_user_id, p_product_code, v_price_credits, 'RESERVED', v_ledger, p_reference)
  returning id into v_reservation;

  return query select v_reservation, v_ledger, v_price_credits, v_after;
end;
$function$;

-- 7c. CAPTURE: finalize a reservation after successful fulfillment
--     and open the purchased-unit balance. Service-role only —
--     triggered by backend fulfillment logic, never the client.
CREATE OR REPLACE FUNCTION public.capture_credit_reservation(
  p_reservation_id uuid,
  p_units_purchased integer DEFAULT 1000
) RETURNS TABLE(reservation_id uuid, ledger_entry_id uuid, purchase_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_res record;
  v_product record;
  v_balance numeric;
  v_ledger uuid;
  v_purchase uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;

  select * into v_res from public.credit_reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status <> 'RESERVED' then raise exception 'RESERVATION_NOT_ACTIVE'; end if;

  select * into v_product from public.research_products where code = v_res.product_code;
  select ca.balance into v_balance from public.credit_accounts ca where ca.user_id = v_res.user_id;

  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference)
  values (v_res.user_id, 0, v_balance, v_balance, 'SERVICE_CAPTURE', 'reservation:' || p_reservation_id::text)
  returning id into v_ledger;

  update public.credit_reservations set status = 'CAPTURED', ledger_capture_id = v_ledger, updated_at = now()
  where id = p_reservation_id;

  insert into public.research_purchases(user_id, product_code, reservation_id, units_purchased, units_remaining, price_cents_snapshot, vat_rate_bps_snapshot, status)
  values (v_res.user_id, v_res.product_code, p_reservation_id, p_units_purchased, p_units_purchased, v_product.price_cents, v_product.vat_rate_bps, 'ACTIVE')
  returning id into v_purchase;

  return query select p_reservation_id, v_ledger, v_purchase;
end;
$function$;

-- 7d. RELEASE: refund a reservation back to available balance when
--     fulfillment could not happen (Master Prompt §19/§20). Service
--     role only.
CREATE OR REPLACE FUNCTION public.release_credit_reservation(
  p_reservation_id uuid,
  p_reason text DEFAULT 'provider_execution_failed'
) RETURNS TABLE(reservation_id uuid, ledger_entry_id uuid, balance_after numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_res record;
  v_before numeric;
  v_after numeric;
  v_ledger uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;

  select * into v_res from public.credit_reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status <> 'RESERVED' then raise exception 'RESERVATION_NOT_ACTIVE'; end if;

  select ca.balance into v_before from public.credit_accounts ca where ca.user_id = v_res.user_id for update;
  v_after := v_before + v_res.credits_amount;
  update public.credit_accounts set balance = v_after, updated_at = now() where user_id = v_res.user_id;

  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference)
  values (v_res.user_id, v_res.credits_amount, v_before, v_after, 'SERVICE_RELEASE', coalesce(p_reason, 'released') || ':' || p_reservation_id::text)
  returning id into v_ledger;

  update public.credit_reservations set status = 'RELEASED', ledger_release_id = v_ledger, updated_at = now()
  where id = p_reservation_id;

  return query select p_reservation_id, v_ledger, v_after;
end;
$function$;
