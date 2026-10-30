/*
 * OWNER UNLIMITED AND ADMIN ACCESS GRANTS, client side (20261208110000 / 110100).
 *
 * Pure helpers over the server's answer (entitlement_status_for_me → access, features[].source).
 * The browser never decides who is the owner or who is unlimited: it only reads `access.unlimited`
 * and each feature's `source`, which the one SQL resolver (saas_access_resolve) produced.
 * No imports beyond types, so node tests load this file directly.
 */
import type { EntitlementStatus, FeatureStatus } from './service';

type T = (k: string, v?: Record<string, string>) => string;

/** Owner or an active Unlimited grant: every credit balance, top-up and plan purchase is hidden. */
export function hasUnlimitedAccess(status: EntitlementStatus | null | undefined): boolean {
  return status?.access?.unlimited === true;
}

/** Owner, or an unlimited admin grant for this feature: shown as "Unlimited access", never as a plan. */
export function isUnlimitedSource(f: FeatureStatus | null | undefined): boolean {
  return f?.source === 'OWNER' || (f?.source === 'GRANT' && f.unlimited === true);
}

/**
 * What an entry point says about the next use, in the resolver's precedence: owner / unlimited
 * grant, a limited grant, the first-use trial, the plan, a legacy balance. Null when there is
 * nothing true to say. Never a made-up number, never a balance for an unlimited account.
 */
export function featureAccessText(status: EntitlementStatus, f: FeatureStatus, t: T): string | null {
  if (isUnlimitedSource(f)) return t('acc_unlimited');
  if (f.source === 'GRANT' && (f.remaining ?? 0) > 0) return t('acc_grant_remaining', { remaining: String(f.remaining) });
  if (f.trialAvailable) return t(f.feature === 'VERIFY' ? 'sub_badge_first_free_verify' : f.feature === 'CONTRACT_ANALYSIS' ? 'sub_badge_first_free_contract' : 'sub_badge_first_free');
  if (f.included && f.unlimited) return t('sub_badge_included_unlimited');
  if (f.included && (f.remaining ?? 0) > 0) return t('sub_badge_included', { remaining: String(f.remaining) });
  if (status.hasLegacyBalance && !hasUnlimitedAccess(status)) return t('sub_badge_legacy');
  return null;
}

/** Server refusals that mean "you may not do this": one message for all of them. */
export const ACCESS_FORBIDDEN_CODES = ['FORBIDDEN', 'FORBIDDEN_SELF', 'OWNER_ONLY', 'OWNER_PROTECTED', 'insufficient_privilege'];
export function isAccessForbidden(message: string): boolean {
  return ACCESS_FORBIDDEN_CODES.some((c) => message.includes(c));
}

/**
 * Expiry for a grant duration choice; null = permanent. A custom date ends at the end of that day
 * in Tbilisi (UTC+4). A missing or malformed custom date throws INVALID_EXPIRY: it is never
 * silently turned into "permanent".
 */
export function grantExpiry(choice: '7' | '30' | '90' | 'CUSTOM' | 'PERMANENT', customDate: string | null, now = Date.now()): string | null {
  if (choice === 'PERMANENT') return null;
  if (choice === 'CUSTOM') {
    if (!customDate || !/^\d{4}-\d{2}-\d{2}$/.test(customDate)) throw new Error('INVALID_EXPIRY');
    return new Date(`${customDate}T23:59:59+04:00`).toISOString();
  }
  return new Date(now + Number(choice) * 86_400_000).toISOString();
}
