// HOMATCH — billing / plans / wallet (frontend data access)
//
// THE ONE RULE THIS FILE FOLLOWS
//
// Nothing here computes a price, an allowance, a quality tier or an
// eligibility. Every one of those is decided server-side and read from
// billing_my_entitlements() / billing_quote_for_me() / the billing Edge
// Function. The frontend renders answers; it never derives them.
//
// That is not ceremony. A discount computed in the browser is a discount a
// customer can edit, and an allowance counted in the browser is one that
// resets when they open a second tab.

import { supabase } from '@/db/supabase';
import type {
  BillingEntitlements,
  BillingCatalogue,
  BudgetOffer,
  ExecutionQuote,
  UpgradeSavings,
  CreditLot,
  UsageReservation,
  BillingPlanRow,
} from '@/types/billing';

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('billing', { body });
  if (error) {
    const msg = await error?.context?.text?.().catch(() => error.message);
    throw new Error(typeof msg === 'string' ? msg : error.message);
  }
  return data as T;
}

// ── Entitlements ────────────────────────────────────────────────────────────

/**
 * What this customer may do right now: plan, quality tier per product,
 * included runs remaining, wallet balance, and whether the once-per-account
 * activation offer is still open.
 *
 * Read through the RPC rather than the Edge Function so it is one round trip
 * and works the moment a session exists.
 */
export async function getMyEntitlements(): Promise<BillingEntitlements | null> {
  const { data, error } = await supabase.rpc('billing_my_entitlements');
  if (error) {
    console.error('[billing] entitlements failed', error.message);
    return null;
  }
  return (data as BillingEntitlements) ?? null;
}

/**
 * What one execution of a product would cost, for this customer, on their
 * plan. Returns funding: 'INCLUDED' when it is covered by their monthly
 * allowance and costs nothing.
 */
export async function getQuote(productCode: string, expectedUnits = 1): Promise<ExecutionQuote | null> {
  const { data, error } = await supabase.rpc('billing_quote_for_me', {
    p_product_code: productCode,
    p_expected_units: expectedUnits,
  });
  if (error) {
    console.error('[billing] quote failed', error.message);
    return null;
  }
  return (data as ExecutionQuote) ?? null;
}

/**
 * What this customer can actually afford right now, and what to offer them.
 *
 * A balance short of the estimate is not a failure: the server returns
 * PAYG_PARTIAL with the budget it would authorise, and the UI offers "search
 * with your current balance" instead of a dead end. Below the product's
 * minimum viable budget it returns TOPUP_REQUIRED, because spending someone's
 * last 2 Credits on a search that cannot produce anything is worse than
 * saying so.
 *
 * The decision is the server's. This only renders it.
 */
export async function getBudgetOffer(productCode: string, expectedUnits = 1): Promise<BudgetOffer | null> {
  const { data, error } = await supabase.rpc('billing_budget_offer', {
    p_product_code: productCode,
    p_expected_units: expectedUnits,
  });
  if (error) {
    console.error('[billing] budget offer failed', error.message);
    return null;
  }
  return (data as BudgetOffer) ?? null;
}

// ── Public catalogue (works signed out) ─────────────────────────────────────

export async function getCatalogue(): Promise<BillingCatalogue> {
  // The pricing page must render for a signed-out visitor, so this sends the
  // ANON key as the bearer token rather than a user session. The function is
  // deployed with verify_jwt=true and the anon key is a valid JWT, so the
  // gateway is satisfied without the endpoint being left unauthenticated.
  // A signed-in visitor's own token would work equally well; the catalogue is
  // identical either way because it contains no per-customer data.
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/billing?action=catalogue`;
  const res = await fetch(url, {
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`Catalogue unavailable (${res.status})`);
  return (await res.json()) as BillingCatalogue;
}

// ── Wallet detail ───────────────────────────────────────────────────────────

/**
 * The provenance behind the balance. Purchased credits never expire;
 * membership and promotional credits carry their own expiry, and the wallet UI
 * says so rather than showing one undifferentiated number.
 */
export async function getMyCreditLots(userId: string): Promise<CreditLot[]> {
  const { data } = await supabase
    .from('credit_lots')
    .select('id, kind, credits_granted, credits_consumed, credits_reserved, credits_available, expires_at, granted_at, plan_code, status')
    .eq('user_id', userId)
    .neq('status', 'EXPIRED')
    .gt('credits_available', 0)
    .order('kind')
    .order('expires_at', { nullsFirst: false });
  return (data as CreditLot[]) ?? [];
}

/** Open and recent holds, so a customer can see money that is committed but not spent. */
export async function getMyReservations(userId: string, limit = 20): Promise<UsageReservation[]> {
  const { data } = await supabase
    .from('usage_reservations')
    .select('id, product_code, status, plan_code_snapshot, quality_tier_snapshot, estimate_min_credits, estimate_max_credits, authorized_max_credits, reserved_credits, settled_credits, released_credits, created_at, settled_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data as UsageReservation[]) ?? [];
}

// ── Subscriptions ───────────────────────────────────────────────────────────

/*
 * startSubscription, cancelSubscription and getUpgradeSavings lived here.
 *
 * There are no subscriptions to start, none to cancel, and no upgrade whose
 * savings could be replayed -- and production never had one to begin with:
 * user_subscriptions has always been empty. The billing function still
 * answers those actions, so history and any in-flight caller are unaffected;
 * nothing in the product asks for them any more.
 */

// ── Top-up ──────────────────────────────────────────────────────────────────

export async function startTopUp(opts: { packCode?: string; amountUsd?: number }): Promise<{
  success?: boolean;
  checkoutUrl?: string;
  mock?: boolean;
  amountCents?: number;
  creditsToIssue?: number;
  bonusCredits?: number;
  totalCredits?: number;
  message?: string;
  error?: string;
  minAmountCents?: number;
}> {
  const { data, error } = await supabase.functions.invoke('credits-topup', {
    body: {
      ...opts,
      successUrl: `${window.location.origin}/credits?topup=success`,
      cancelUrl: `${window.location.origin}/credits?topup=cancelled`,
    },
  });
  if (error) {
    const msg = await error?.context?.text?.().catch(() => error.message);
    try {
      const parsed = JSON.parse(typeof msg === 'string' ? msg : '{}');
      return { success: false, ...parsed };
    } catch {
      return { success: false, error: typeof msg === 'string' ? msg : error.message };
    }
  }
  return data;
}

// ── Campaign budget ─────────────────────────────────────────────────────────
//
// WALLET BALANCE IS NOT CAMPAIGN BUDGET.
//
// The balance is everything the customer owns. The campaign budget is the most
// they are willing to let ONE search consume, and it is the number that ends up
// in usage_reservations.authorized_max_credits, where a schema CHECK stops
// settlement from ever exceeding it.
//
// The presets, which one is recommended, and whether a custom amount is allowed
// are all admin settings read by billing_my_budget_choices(). Nothing here
// invents a ladder, and the affordability of each rung is decided against the
// server's view of the balance rather than the browser's.

export interface BudgetChoice {
  credits: number;
  affordable: boolean;
  viable: boolean;
  recommended: boolean;
}

export interface BudgetChoices {
  ok: boolean;
  reason?: string;
  product_code?: string;
  balance?: number;
  min_viable?: number;
  allow_custom?: boolean;
  recommended?: number;
  presets?: BudgetChoice[];
}

export async function getBudgetChoices(productCode: string): Promise<BudgetChoices | null> {
  const { data, error } = await supabase.rpc('billing_my_budget_choices', {
    p_product_code: productCode,
  });
  if (error) return null;
  return (data ?? null) as BudgetChoices | null;
}

/**
 * The rung to select before the customer touches anything.
 *
 * The recommended preset when they can afford it, otherwise the largest they
 * can — never their whole balance by default, and never a rung below what the
 * product needs to produce anything worth having.
 */
export function defaultBudget(choices: BudgetChoices | null): number | null {
  const usable = (choices?.presets ?? []).filter((p) => p.affordable && p.viable);
  if (usable.length === 0) return null;
  const recommended = usable.find((p) => p.recommended);
  return (recommended ?? usable[usable.length - 1]).credits;
}

// ── Card activation ─────────────────────────────────────────────────────────
//
// The offer that replaced the registration grant. An account now starts at
// zero and earns its first credits by proving a real payment method exists.
//
// EVERY DECISION HERE IS THE SERVER'S. Whether the offer may be shown, how
// many credits it is worth, how many times it has been waved away and whether
// it has already been claimed all arrive from billing_my_activation_offer().
// None of it is cached in the browser, because a customer who clears their
// storage must not get a second bonus, and one who switches device must not
// lose the offer.

export interface ActivationOffer {
  eligible: boolean;
  already_claimed: boolean;
  has_payment_method: boolean;
  credits: number;
  credits_per_usd: number;
  dismissals: number;
  max_reminders: number;
  cooldown_hours: number;
  last_dismissed_at: string | null;
}

export async function getActivationOffer(): Promise<ActivationOffer | null> {
  const { data, error } = await supabase.rpc('billing_my_activation_offer');
  if (error) return null;
  return (data ?? null) as ActivationOffer | null;
}

/**
 * Whether to put the offer in front of the customer right now.
 *
 * Claimed is permanent and silent. Otherwise the first showing is free, and
 * each later one waits out the cooldown and respects the reminder budget --
 * which is how "do not spam the user" is expressed as a rule rather than a
 * hope. The persistent dashboard entry point is NOT governed by this: it is
 * always available and never counts as a reminder.
 */
export function shouldPromptActivation(offer: ActivationOffer | null, now = Date.now()): boolean {
  if (!offer || !offer.eligible || offer.already_claimed) return false;
  if (offer.dismissals === 0) return true;
  if (offer.dismissals > offer.max_reminders) return false;
  if (!offer.last_dismissed_at) return true;
  const since = now - new Date(offer.last_dismissed_at).getTime();
  return since >= offer.cooldown_hours * 3_600_000;
}

export async function recordOfferStep(
  step: 'OFFER_SHOWN' | 'OFFER_DISMISSED' | 'CTA_CLICKED',
  metadata: Record<string, unknown> = {},
): Promise<void> {
  /* Analytics must never break the screen it measures. */
  await supabase.rpc('billing_record_offer_step', {
    p_promo_code: 'CARD_ACTIVATION',
    p_step: step,
    p_metadata: metadata,
  }).then(undefined, () => undefined);
}

export interface ProviderCapabilityReport {
  provider: string;
  capabilities: {
    oneTimePayment: boolean | 'unknown';
    zeroAmountSetup: boolean | 'unknown';
    reusablePaymentMethod: boolean | 'unknown';
    instrumentFingerprint: boolean | 'unknown';
    refunds: boolean | 'unknown';
    webhooks: boolean | 'unknown';
    legalInvoice: boolean | 'unknown';
    minAmountCents: number | null;
    maxAmountCents: number | null;
    currencies: string[];
    simulated: boolean;
    notes: string;
  };
}

export async function getPaymentCapabilities(): Promise<ProviderCapabilityReport | null> {
  const { data, error } = await supabase.functions.invoke('payment-method-setup', {
    body: { action: 'capabilities' },
  });
  if (error) return null;
  return data as ProviderCapabilityReport;
}

export async function startCardSetup(): Promise<{
  ok: boolean;
  setupUrl?: string;
  setupId?: string;
  mock?: boolean;
  code?: string;
  message?: string;
}> {
  const { data, error } = await supabase.functions.invoke('payment-method-setup', {
    body: {
      action: 'start',
      returnUrl: `${window.location.origin}/credits?setup=return`,
      cancelUrl: `${window.location.origin}/credits?setup=cancelled`,
    },
  });
  if (error) return { ok: false, code: 'REQUEST_FAILED', message: error.message };
  return data;
}

export async function confirmCardSetup(setupId: string): Promise<{
  ok: boolean;
  granted?: boolean;
  credits?: number;
  balanceAfter?: number | null;
  card?: { brand: string | null; last4: string | null };
  code?: string;
  reason?: string | null;
}> {
  const { data, error } = await supabase.functions.invoke('payment-method-setup', {
    body: { action: 'confirm', setupId },
  });
  if (error) return { ok: false, code: 'REQUEST_FAILED' };
  return data;
}

// ── Display helpers ─────────────────────────────────────────────────────────
//
// Formatting only. The conversion RATE is never assumed: it arrives from the
// server on every entitlements payload, so changing credits_per_usd changes
// what the UI prints without a deploy.

export function creditsToUsd(credits: number, creditsPerUsd: number): number {
  if (!creditsPerUsd) return 0;
  return credits / creditsPerUsd;
}

export function formatCredits(credits: number): string {
  // Whole numbers read as whole numbers; fractional charges keep their
  // precision, because "13.4 Credits" is the honest figure and rounding it to
  // 13 would misstate what was taken.
  const rounded = Math.round(credits * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

// ── The price card, as an admin edits it ────────────────────────────────────
//
// WHY THESE TWO GO THROUGH THE TABLE AND NOT THE EDGE FUNCTION
//
// Everything above reads DERIVED answers — a quote, an entitlement, a savings
// figure — and those are decided server-side precisely so the browser cannot
// influence them. This is the opposite kind of call: the plan catalogue is
// input, not output, and the row an admin is editing is the source rather than
// a rendering of it.
//
// The authority is the database. RLS (billing_plans_admin_write) restricts
// every row to is_admin(), and the column grants decide how much of a row is
// writable at all: `code`, `config` and the internal margin lever are not,
// and rows cannot be created or deleted from here. So a non-admin calling
// this gets no rows, and an admin calling it with extra fields gets a
// privilege error rather than a silent write. See
// 20260913130000_billing_plans_admin_can_edit_the_price_card.sql.

/** Every plan, including the disabled ones. Admin-only by RLS. */
export async function listPlansForAdmin(): Promise<BillingPlanRow[]> {
  const { data, error } = await supabase
    .from('billing_plans')
    .select('code, name, monthly_price_cents, membership_credits_grant, membership_rollover_cap, quality_tier, badge_key, priority_level, marketing_label_key, sort_order, enabled')
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BillingPlanRow[];
}

/** The fields an admin may change. Anything absent here is not writable. */
export type PlanPatch = Partial<Pick<
  BillingPlanRow,
  'name' | 'monthly_price_cents' | 'membership_credits_grant'
  | 'membership_rollover_cap' | 'quality_tier' | 'badge_key'
  | 'priority_level' | 'marketing_label_key' | 'sort_order'
>> & { enabled?: boolean };

export async function updatePlan(code: string, patch: PlanPatch): Promise<void> {
  const { error } = await supabase
    .from('billing_plans')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('code', code);
  if (error) throw new Error(error.message);
}
