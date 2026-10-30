/*
 * SUBSCRIPTIONS, client side (owner decision 2026-10-29).
 *
 * Every answer here is DERIVED on the server: the plan catalogue (saas_public_plans via
 * saas-checkout), what this account may do (entitlement_status_for_me), whether a checkout was
 * paid (saas-checkout status). The browser never decides an entitlement, a price or a payment.
 */
import { supabase } from '@/db/supabase';

export type PlanCode = 'STANDARD' | 'VIP' | 'UNLIMITED';
export type FeatureCode = 'VERIFY' | 'CONTRACT_ANALYSIS' | 'PREMIUM_DISCOVERY' | 'HOMI_UNLIMITED' | 'INTERNAL_SEARCH' | 'INTERNAL_MATCHING' | 'INTERNAL_UNLOCK_FREE';

export interface PlanEntitlement { enabled: boolean; limit: number | null; unlimited: boolean }
export interface PublicPlan {
  code: PlanCode;
  name: string;
  priceTetri: number;
  currency: 'GEL';
  vatInclusive: boolean;
  priorityTier: number;
  entitlements: Partial<Record<FeatureCode, PlanEntitlement>>;
}
export interface PlansResponse {
  currency: 'GEL';
  plans: PublicPlan[];
  trials: FeatureCode[];
  paymentsConnected: boolean;
  liveProvider: 'BOG' | 'TBC' | null;
  autoRenewAvailable: boolean;
}

/** Who pays for this feature now, decided by saas_access_resolve (20261208110000). */
export type AccessSource = 'OWNER' | 'GRANT' | 'TRIAL' | 'PLAN' | 'LEGACY_CREDITS' | 'NONE';
export type GrantKind = 'UNLIMITED' | 'PLAN' | 'CUSTOM';
export interface GrantAllowance { feature: FeatureCode; unlimited: boolean; limit: number | null; period: 'TOTAL' | 'MONTHLY' }
export interface AccessGrantSummary {
  id: string;
  kind: GrantKind;
  planCode: PlanCode | null;
  startsAt: string;
  expiresAt: string | null;
  permanent: boolean;
  allowances: GrantAllowance[];
}
export interface AccessStatus {
  owner: boolean;
  /** Owner, or an active Unlimited grant: every credit / top-up surface is hidden. */
  unlimited: boolean;
  source: 'OWNER' | 'GRANT' | 'PLAN' | 'NONE';
  grants: AccessGrantSummary[];
}
export interface FeatureStatus {
  feature: FeatureCode;
  kind: 'QUOTA' | 'BOOLEAN';
  /** Absent on a server older than 20261208110000. */
  source?: AccessSource;
  grant?: { id: string; kind: GrantKind; planCode: PlanCode | null; period: string; expiresAt: string | null; permanent: boolean };
  included: boolean;
  unlimited: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
  trialEnabled: boolean;
  trialState: 'UNUSED' | 'RESERVED' | 'CONSUMED' | 'RELEASED';
  trialAvailable: boolean;
}
export interface SubscriptionStatus {
  id: string;
  planCode: PlanCode;
  status: 'ACTIVE' | 'PAST_DUE' | 'EXPIRED';
  hasAccess: boolean;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  pendingPlanCode: PlanCode | null;
  nextPeriodPaid: boolean;
  nextPeriodPlanCode: PlanCode | null;
  graceUntil: string | null;
  recurring: boolean;
  renewalOpensAt: string;
}
export interface EntitlementStatus {
  plan: PlanCode | 'FREE';
  subscription: SubscriptionStatus | null;
  features: FeatureStatus[];
  accountEligibleForTrials: boolean;
  legacyBalance: number;
  hasLegacyBalance: boolean;
  /** Absent on a server older than 20261208110000: treated as an ordinary account. */
  access?: AccessStatus;
}

export { grantExpiry, hasUnlimitedAccess, isAccessForbidden } from './access';

export function formatGel(tetri: number, locale = 'ka-GE'): string {
  const gel = tetri / 100;
  return new Intl.NumberFormat(locale, { minimumFractionDigits: gel % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(gel);
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('saas-checkout', { body });
  if (error) {
    // supabase-js puts the JSON body of a non-2xx answer on error.context.
    let code = 'REQUEST_FAILED';
    try {
      const ctx = (error as { context?: Response }).context;
      const j = ctx ? await ctx.json() : null;
      if (j?.error) code = String(j.error);
    } catch { /* keep the generic code */ }
    throw new SubscriptionError(code);
  }
  return data as T;
}

export class SubscriptionError extends Error {
  constructor(public code: string) { super(code); }
}

/* A malformed answer (an old function, a proxy page) is an error, never a half-shaped object a
   page would crash on. */
export async function getPlans(): Promise<PlansResponse> {
  const r = await invoke<PlansResponse>({ action: 'plans' });
  if (!r || !Array.isArray(r.plans)) throw new SubscriptionError('BAD_RESPONSE');
  return r;
}

export async function getEntitlementStatus(): Promise<EntitlementStatus> {
  const { data, error } = await supabase.rpc('entitlement_status_for_me');
  if (error) throw new SubscriptionError(error.message);
  const st = data as EntitlementStatus | null;
  if (!st || typeof st !== 'object' || !Array.isArray(st.features)) throw new SubscriptionError('BAD_RESPONSE');
  return st;
}

export interface CheckoutStart { checkoutId: string; kind: string; planCode: PlanCode; amountTetri: number; redirectUrl: string; sandbox: boolean }
export const startCheckout = (planCode: PlanCode, opts: { autoRenew?: boolean; sandbox?: boolean } = {}) =>
  invoke<CheckoutStart>({ action: 'create', planCode, autoRenew: opts.autoRenew === true, ...(opts.sandbox ? { provider: 'SANDBOX' } : {}) });

export interface CheckoutState { checkoutId: string; status: string; planCode: PlanCode; kind: string; amountTetri: number; provider: string; sandbox: boolean }
export const checkoutStatus = (checkoutId: string) => invoke<CheckoutState>({ action: 'status', checkoutId });
export const completeSandbox = (checkoutId: string, outcome: 'success' | 'fail') =>
  invoke<Record<string, unknown>>({ action: 'sandbox-complete', checkoutId, outcome });

export async function subscriptionAction(action: 'CANCEL' | 'UNDO_CANCEL' | 'DOWNGRADE' | 'UNDO_DOWNGRADE', planCode?: PlanCode) {
  const { data, error } = await supabase.rpc('saas_my_subscription_action', { p_action: action, p_plan_code: planCode ?? null });
  if (error) throw new SubscriptionError(error.message);
  const r = data as { ok: boolean; reason?: string };
  if (!r.ok) throw new SubscriptionError(r.reason ?? 'REFUSED');
  return r;
}

/** The server's refusal codes that mean "show the plans", not "top up". */
export const SUBSCRIBE_CODES: ReadonlySet<string> = new Set(['SUBSCRIPTION_REQUIRED', 'ALLOWANCE_EXHAUSTED']);
export function isSubscribeCode(code: unknown): boolean {
  return typeof code === 'string' && SUBSCRIBE_CODES.has(code);
}

/* ── Admin (server re-checks is_admin on every call) ── */
export interface AdminOverview {
  plans: Array<{ code: PlanCode; name: string; price_gel_tetri: number; enabled: boolean; priority_tier: number; vat_inclusive: boolean }>;
  features: Array<{ feature: FeatureCode; kind: string; trial_enabled: boolean; reservation_ttl_minutes: number }>;
  entitlements: Array<{ plan_code: PlanCode; feature: FeatureCode; enabled: boolean; limit_per_period: number | null; unlimited: boolean }>;
  settings: Record<string, unknown>;
  sandboxGrantsAccess: boolean;
  counts: { active: number; pastDue: number; expired: number; trialsConsumed: number };
}
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new SubscriptionError(error.message);
  return data as T;
}
export const adminOverview = () => rpc<AdminOverview>('admin_saas_overview');
export const adminSubscriptions = (search: string | null) => rpc<Array<Record<string, unknown>>>('admin_saas_subscriptions', { p_search: search, p_limit: 50 });
export const adminPaymentEvents = () => rpc<Array<Record<string, unknown>>>('admin_saas_payment_events', { p_limit: 50 });
export const adminAudit = () => rpc<Array<Record<string, unknown>>>('admin_saas_audit', { p_limit: 50 });
export const adminSetPlan = (code: PlanCode, priceTetri: number | null, enabled: boolean | null, reason: string) =>
  rpc('admin_saas_set_plan', { p_code: code, p_price_tetri: priceTetri, p_enabled: enabled, p_priority_tier: null, p_reason: reason });
export const adminSetEntitlement = (plan: PlanCode, feature: FeatureCode, enabled: boolean, limit: number | null, unlimited: boolean, reason: string) =>
  rpc('admin_saas_set_entitlement', { p_plan: plan, p_feature: feature, p_enabled: enabled, p_limit: limit, p_unlimited: unlimited, p_reason: reason });
export const adminSetTrial = (feature: FeatureCode, enabled: boolean, reason: string) =>
  rpc('admin_saas_set_trial', { p_feature: feature, p_enabled: enabled, p_reason: reason });
export const adminSetSetting = (key: string, value: unknown, reason: string) =>
  rpc('admin_saas_set_setting', { p_key: key, p_value: value, p_reason: reason });
export const adminSupport = (action: 'GRANT' | 'EXTEND' | 'CANCEL_NOW' | 'CANCEL_AT_PERIOD_END', userId: string, plan: PlanCode | null, days: number | null, reason: string) =>
  rpc('admin_saas_support', { p_action: action, p_user_id: userId, p_plan: plan, p_days: days, p_reason: reason });

export interface AdminProvider {
  id: 'SANDBOX' | 'BOG' | 'TBC';
  configured: boolean; recurring: boolean; refunds: boolean; lookup: boolean; test: boolean;
  missingSecrets?: string[]; callbackUrl: string; successUrl: string; failUrl: string;
}
export const adminProviders = () => invoke<{ liveProvider: string | null; providers: AdminProvider[] }>({ action: 'admin-providers' });
export const adminConnectivity = (provider: string) => invoke<{ ok: boolean; detail?: string; reason?: string }>({ action: 'admin-connectivity', provider });
export const adminRefund = (checkoutId: string, reason: string, amountTetri?: number) =>
  invoke<{ ok: boolean }>({ action: 'admin-refund', checkoutId, reason, ...(amountTetri ? { amountTetri } : {}) });

/* ── Admin → User access (20261208110100; the server re-checks admin, self, owner on every call) ── */
export interface AdminAccessUserRow {
  id: string; email: string | null; fullName: string | null; username: string | null;
  isAdmin: boolean; owner: boolean; suspended: boolean; createdAt: string;
  plan: PlanCode | null; activeGrants: number; unlimited: boolean;
}
export interface AdminGrantAllowance extends GrantAllowance {
  countedSince: string; windowStart: string; used: number; remaining: number | null;
}
export interface AdminGrant {
  id: string; userId: string; kind: GrantKind; planCode: PlanCode | null; status: 'ACTIVE' | 'REVOKED';
  live: boolean; expired: boolean; startsAt: string; expiresAt: string | null; permanent: boolean;
  reason: string; createdBy: string; createdAt: string; updatedAt: string;
  revokedAt: string | null; revokeReason: string | null;
  allowances: AdminGrantAllowance[];
}
export interface AdminAccessUsage {
  id: string; feature: FeatureCode; funding: AccessSource; state: 'RESERVED' | 'COMMITTED' | 'RELEASED';
  planCode: string | null; grantId: string | null; jobRef: string | null; reservedAt: string;
  committedAt: string | null; releasedAt: string | null; releaseReason: string | null; overAllowance: boolean;
}
export interface AdminAccessEvent {
  id: string; grantId: string | null; action: 'GRANTED' | 'MODIFIED' | 'REVOKED' | 'ALLOWANCE_RESET';
  actorId: string; actorEmail: string | null; previous: AdminGrant | null; new: AdminGrant | null;
  reason: string; expiresAt: string | null; createdAt: string;
}
export interface AdminAccessDetail {
  user: { id: string; email: string | null; fullName: string | null; username: string | null; isAdmin: boolean; owner: boolean;
          accountType: string | null; suspended: boolean; createdAt: string; verified: boolean };
  manageable: boolean;
  status: EntitlementStatus;
  grants: AdminGrant[];
  usage: AdminAccessUsage[];
  events: AdminAccessEvent[];
  legacyBalance: number;
}
export interface AllowanceInput { feature: FeatureCode; unlimited?: boolean; limit?: number | null; period?: 'TOTAL' | 'MONTHLY'; remove?: boolean }

export const adminAccessUsers = (search: string | null) =>
  rpc<AdminAccessUserRow[]>('admin_access_users', { p_search: search, p_limit: 30 }).then((r) => r ?? []);
export const adminAccessUser = (userId: string) => rpc<AdminAccessDetail>('admin_access_user', { p_user_id: userId });
export const adminAccessGrant = (userId: string, kind: GrantKind, planCode: PlanCode | null, allowances: AllowanceInput[] | null,
  expiresAt: string | null, reason: string) =>
  rpc<AdminGrant>('admin_access_grant', { p_user_id: userId, p_kind: kind, p_plan_code: planCode, p_allowances: allowances, p_expires_at: expiresAt, p_reason: reason });
export const adminAccessUpdate = (grantId: string, expiryMode: 'KEEP' | 'PERMANENT' | 'DATE', expiresAt: string | null,
  allowances: AllowanceInput[] | null, reason: string) =>
  rpc<AdminGrant>('admin_access_grant_update', { p_grant_id: grantId, p_expiry_mode: expiryMode, p_expires_at: expiresAt, p_allowances: allowances, p_reason: reason });
export const adminAccessRevoke = (grantId: string, reason: string) =>
  rpc<AdminGrant>('admin_access_grant_revoke', { p_grant_id: grantId, p_reason: reason, p_confirm: 'REVOKE' });
export const adminAccessReset = (grantId: string, feature: FeatureCode | null, reason: string) =>
  rpc<AdminGrant>('admin_access_allowance_reset', { p_grant_id: grantId, p_feature: feature, p_reason: reason });
