// HOMATCH EMAIL STUDIO — who may receive a marketing email.
//
// The authoritative rule is in Postgres (email_studio_lead_eligibility), evaluated at
// review AND again at the moment of sending. This is the same rule as a pure
// function, in the same order, so the editor can explain a reason code and tests can
// pin the policy. An unlocked email address alone is never consent.

export type EligibilityReason =
  | 'NOT_UNLOCKED'
  | 'ACCOUNT_UNAVAILABLE'
  | 'BLOCKED'
  | 'NO_MARKETING_CONSENT'
  | 'EMAIL_NOT_SHARED'
  | 'NOT_ACCEPTING_OFFERS'
  | 'MARKETING_OPT_OUT'
  | 'NO_EMAIL'
  | 'SUPPRESSED';

export const ELIGIBILITY_REASONS: readonly EligibilityReason[] = [
  'NOT_UNLOCKED', 'ACCOUNT_UNAVAILABLE', 'BLOCKED', 'NO_MARKETING_CONSENT', 'EMAIL_NOT_SHARED',
  'NOT_ACCEPTING_OFFERS', 'MARKETING_OPT_OUT', 'NO_EMAIL', 'SUPPRESSED',
];

export interface LeadFacts {
  unlocked: boolean;
  suspended: boolean;
  blocked: boolean;
  /** lead_contact_preferences (defaults when no row: offers true, others false). */
  acceptMarketingEmail: boolean;
  shareEmailOnUnlock: boolean;
  acceptPropertyOffers: boolean;
  /** notification_preferences.marketing_opt_in — null when the member never saved that screen. */
  marketingOptIn: boolean | null;
  email: string | null;
  /** Studio suppression (unsubscribe / hard bounce / complaint) or the seller's own outreach list. */
  suppressed: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** null = eligible; otherwise the first reason that excludes the member. */
export function eligibilityReason(f: LeadFacts): EligibilityReason | null {
  if (!f.unlocked) return 'NOT_UNLOCKED';
  if (f.suspended) return 'ACCOUNT_UNAVAILABLE';
  if (f.blocked) return 'BLOCKED';
  if (!f.acceptMarketingEmail) return 'NO_MARKETING_CONSENT';
  if (!f.shareEmailOnUnlock) return 'EMAIL_NOT_SHARED';
  if (!f.acceptPropertyOffers) return 'NOT_ACCEPTING_OFFERS';
  if (f.marketingOptIn === false) return 'MARKETING_OPT_OUT';
  if (!f.email || !EMAIL_RE.test(f.email)) return 'NO_EMAIL';
  if (f.suppressed) return 'SUPPRESSED';
  return null;
}

export function isEligibilityReason(value: unknown): value is EligibilityReason {
  return typeof value === 'string' && (ELIGIBILITY_REASONS as readonly string[]).includes(value);
}

/** i18n key that explains a reason to the seller (never revealing the member's data). */
export function reasonKey(reason: string | null | undefined): string {
  switch (reason) {
    case 'NOT_UNLOCKED': return 'es_reason_not_unlocked';
    case 'ACCOUNT_UNAVAILABLE': return 'es_reason_unavailable';
    case 'BLOCKED': return 'es_reason_blocked';
    case 'NO_MARKETING_CONSENT': return 'es_reason_no_consent';
    case 'EMAIL_NOT_SHARED': return 'es_reason_email_not_shared';
    case 'NOT_ACCEPTING_OFFERS': return 'es_reason_no_offers';
    case 'MARKETING_OPT_OUT': return 'es_reason_marketing_opt_out';
    case 'NO_EMAIL': return 'es_reason_no_email';
    case 'SUPPRESSED': return 'es_reason_suppressed';
    default: return 'es_reason_eligible';
  }
}

export interface EligibilityRow {
  unlockId: string | null;
  matchId: string | null;
  displayName: string | null;
  language: string | null;
  eligible: boolean;
  reason: string | null;
}

export interface EligibilitySummary {
  total: number;
  eligibleCount: number;
  reasons: Record<string, number>;
  items: EligibilityRow[];
}

/** Parse the RPC's answer defensively; an item without an unlock is never selectable. */
export function parseEligibility(raw: unknown): EligibilitySummary {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const items = (Array.isArray(obj.items) ? obj.items : []).map((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    const unlockId = typeof r.unlockId === 'string' ? r.unlockId : null;
    return {
      unlockId,
      matchId: typeof r.matchId === 'string' ? r.matchId : null,
      displayName: typeof r.displayName === 'string' ? r.displayName : null,
      language: typeof r.language === 'string' ? r.language : null,
      eligible: r.eligible === true && unlockId !== null,
      reason: typeof r.reason === 'string' ? r.reason : null,
    };
  });
  const reasons: Record<string, number> = {};
  const rawReasons = (obj.reasons && typeof obj.reasons === 'object' ? obj.reasons : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(rawReasons)) if (typeof v === 'number') reasons[k] = v;
  return {
    total: typeof obj.total === 'number' ? obj.total : items.length,
    eligibleCount: items.filter((i) => i.eligible).length,
    reasons,
    items,
  };
}
