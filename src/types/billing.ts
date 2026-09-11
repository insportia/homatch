// HOMATCH — billing types.
//
// These mirror what the server actually returns. Note what is NOT here:
// there is no landed cost, no standard price, no profit pool, no margin and no
// provider budget. Those columns are not granted to the client at the database
// level, so a type that named them would be describing data the frontend can
// never receive.

export type PlanCode = 'FREE' | 'VIP' | 'PREMIUM';
export type QualityTier = 'STANDARD' | 'ENHANCED' | 'MAXIMUM';
export type Funding = 'INCLUDED' | 'PAYG' | 'UNAVAILABLE';
export type LotKind = 'PURCHASED' | 'MEMBERSHIP' | 'PROMOTIONAL' | 'ADJUSTMENT';

/** How a customer-facing rate is named. Never a percentage of our margin. */
export type MemberRateKey = 'rate_standard' | 'rate_vip' | 'rate_best';

export interface ProductEntitlement {
  product_code: string;
  name: string;
  quality_tier: QualityTier;
  included_per_period: number;
  included_used: number;
  included_remaining: number;
  period: 'CALENDAR_MONTH' | 'BILLING_CYCLE';
  period_key: string;
  result_ceiling: number | null;
  priority_level: number;
  /** PAYG is unlimited on every plan; this is only false behind a kill switch. */
  payg_available: boolean;
  billing_mode: 'FIXED' | 'VARIABLE' | 'FREE';
}

export interface BillingEntitlements {
  plan_code: PlanCode;
  plan_name: string;
  quality_tier: QualityTier;
  badge_key: string | null;
  priority_level: number;
  member_rate_key: MemberRateKey;
  /** Daily AI Chat fair-use ceiling. Not a credit cost: chat never bills. */
  ai_fair_use_daily: number;
  membership_credits_grant: number;
  membership_rollover_cap: number;
  subscription: {
    id: string;
    status: 'ACTIVE' | 'CANCELLED' | 'PAST_DUE' | 'EXPIRED';
    current_period_start: string;
    current_period_end: string;
    cancel_at_period_end: boolean;
  } | null;
  wallet: {
    balance: number;
    /** Held by an open reservation. Excluded from balance. */
    reserved: number;
    credits_per_usd: number;
  };
  products: ProductEntitlement[];
  /** Decided server-side against unique indexes, never in the browser. */
  first_topup_promo_available: boolean;
}

export interface ExecutionQuote {
  product_code: string;
  plan_code: PlanCode;
  quality_tier: QualityTier;
  funding: Funding;
  included_remaining: number;
  unit_credits?: number;
  estimate_min_credits: number;
  estimate_max_credits: number;
  /** The ceiling the customer consents to. Settlement can never exceed it. */
  authorized_max_credits: number;
  result_ceiling: number | null;
  credits_per_usd?: number;
  member_rate_key?: MemberRateKey;
}

export interface BillingPlanRow {
  code: PlanCode;
  name: string;
  monthly_price_cents: number;
  membership_credits_grant: number;
  membership_rollover_cap: number;
  quality_tier: QualityTier;
  badge_key: string | null;
  priority_level: number;
  /** i18n key for "Most Popular" / "Best Value". Admin-configurable, may be null. */
  marketing_label_key: string | null;
  sort_order: number;
}

export interface TopupPack {
  code: string;
  amount_cents: number;
  credits: number;
  sort_order: number;
}

export interface FirstTopupPromo {
  code: string;
  name: string;
  min_amount_cents: number;
  bonus_match_bps: number;
  max_bonus_credits: number;
  enabled: boolean;
}

export interface EntitlementMatrixRow {
  product_code: string;
  plan_code: PlanCode;
  included_per_period: number;
  period: 'CALENDAR_MONTH' | 'BILLING_CYCLE';
  quality_tier: QualityTier;
  result_ceiling: number | null;
  priority_level: number;
}

export interface BillingCatalogue {
  plans: BillingPlanRow[];
  topupPacks: TopupPack[];
  firstTopupPromo: FirstTopupPromo | null;
  entitlementMatrix: EntitlementMatrixRow[];
  creditsPerUsd: number;
}

export interface CreditLot {
  id: string;
  kind: LotKind;
  credits_granted: number;
  credits_consumed: number;
  credits_reserved: number;
  credits_available: number;
  /** null for PURCHASED: purchased credits do not expire. */
  expires_at: string | null;
  granted_at: string;
  plan_code: PlanCode | null;
  status: 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED';
}

export interface UsageReservation {
  id: string;
  product_code: string;
  status: 'RESERVED' | 'SETTLED' | 'RELEASED' | 'EXPIRED' | 'CANCELLED';
  plan_code_snapshot: PlanCode;
  quality_tier_snapshot: QualityTier;
  estimate_min_credits: number;
  estimate_max_credits: number;
  authorized_max_credits: number;
  reserved_credits: number;
  settled_credits: number;
  released_credits: number;
  created_at: string;
  settled_at: string | null;
}

/**
 * Replayed from real charged executions. `eligible` is false when the customer
 * has no paid history, and in that case the UI must show nothing rather than a
 * hypothetical.
 */
export interface UpgradeSavings {
  eligible: boolean;
  reason?: 'NO_PAID_USAGE_YET' | 'INVALID_TARGET';
  targetPlan: PlanCode;
  windowDays?: number;
  runsConsidered?: number;
  creditsChargedActual?: number;
  creditsOnTargetPlan?: number;
  creditsSavedOnRates?: number;
  monthlyMembershipCredits?: number;
  monthlyPriceCents?: number;
  byProduct?: Record<string, { actual: number; target: number; runs: number }>;
}

/** Attached to a paid product's response so the UI can show what was taken. */
export interface ExecutionBilling {
  funding: Funding;
  planCode: PlanCode;
  qualityTier: QualityTier;
  creditsCharged: number;
  creditsAuthorized: number;
}

/**
 * What a customer is OFFERED when their balance cannot cover the full
 * estimate.
 *
 * The product deliberately does not have a dead-end "Insufficient balance"
 * state. Either the balance buys a scoped search (`PAYG_PARTIAL`), or it is
 * genuinely too small to produce anything worth having and the customer is
 * asked to top up (`TOPUP_REQUIRED`) rather than having their last few Credits
 * spent on a search that cannot work.
 */
export type BudgetOfferKind =
  | 'INCLUDED'        // covered by the plan's monthly allowance
  | 'PAYG_FULL'       // balance covers the full estimate
  | 'PAYG_PARTIAL'    // best effort: search with what they have
  | 'TOPUP_REQUIRED'  // below the product's minimum viable budget
  | 'UNAVAILABLE';    // kill switch or unpriced product

export interface BudgetOffer extends ExecutionQuote {
  offer: BudgetOfferKind;
  available_balance?: number;
  /** Below this, the product refuses to run rather than waste the balance. */
  min_viable_budget_credits?: number;
  /** What we would hold if they accept. Never more than their balance. */
  offered_authorized_max_credits?: number;
  credits_short_of_full?: number;
  credits_short_of_viable?: number;
}
