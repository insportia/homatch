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

export async function startSubscription(planCode: 'VIP' | 'PREMIUM'): Promise<{
  success?: boolean; checkoutUrl?: string; mock?: boolean; message?: string; error?: string;
}> {
  return invoke({
    action: 'subscribe',
    planCode,
    successUrl: `${window.location.origin}/pricing?subscribed=1`,
    cancelUrl: `${window.location.origin}/pricing?cancelled=1`,
  });
}

export async function cancelSubscription(): Promise<{
  success?: boolean; cancelAtPeriodEnd?: boolean; activeUntil?: string; creditsRetained?: boolean; error?: string;
}> {
  return invoke({ action: 'cancel' });
}

/**
 * What a plan WOULD have saved this customer, replayed from their real charged
 * executions at current pricing. Returns eligible:false when they have no paid
 * history — the product must never show an invented savings figure.
 */
export async function getUpgradeSavings(targetPlan: 'VIP' | 'PREMIUM'): Promise<UpgradeSavings> {
  return invoke({ action: 'upgrade-savings', targetPlan });
}

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
