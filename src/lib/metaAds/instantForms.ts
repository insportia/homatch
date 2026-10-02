// META ADS — CAN THIS CUSTOMER COLLECT LEADS ON FACEBOOK/INSTAGRAM? Pure.
//
// Instant Forms (goal LEADS_ON_META) need three Meta permissions beyond the
// base connection (leads_retrieval, pages_manage_ads, pages_manage_metadata —
// _shared/metaAds.ts INSTANT_FORM_SCOPES), a selected Page that can read its
// forms, and the Page's Lead Ads Terms accepted on Meta's own page. One state,
// decided here for the builder and the server alike, in this order:
//
//   DISABLED                 the admin switched the goal off
//   PAGE_UNAVAILABLE         no Facebook Page selected
//   PERMISSIONS_MISSING      the stored Meta token lacks a lead permission —
//                            reconnecting Meta grants it (the login
//                            configuration requests all three)
//   META_ERROR               the last check could not read Meta
//   FORM_ACCESS_UNAVAILABLE  Meta refused reading the Page's forms
//   TERMS_REQUIRED           Meta says the Page has not accepted the terms
//   TERMS_UNKNOWN            not confirmed either way (never checked, or Meta
//                            gave no answer) — checked again, never assumed,
//                            and never shown as "not accepted"
//   READY                    permissions, form access and accepted terms
//
// TERMS EVIDENCE (leadTermsEvidence) is separate from readiness. A
// leadgen_tos_accepted read with a token WITHOUT the lead permissions is not
// evidence at all: production showed Meta answering `false` to such a token
// for a Page whose terms page reads "Accepted". Accepted is proven by Meta's
// field being true, an acceptance time, or the Page already owning a lead form
// (Meta lets no form exist on a Page that never accepted). Required is only
// Meta's `false` read WITH the lead permissions, or Meta refusing a form for
// the terms. HOMATCH never accepts, simulates or stores consent.

/** Mirrors _shared/metaAds.ts INSTANT_FORM_SCOPES (a test keeps them equal) — for Admin display. */
export const INSTANT_FORM_PERMISSIONS = ['leads_retrieval', 'pages_manage_ads', 'pages_manage_metadata'] as const;

export type InstantFormsState =
  | 'READY' | 'PERMISSIONS_MISSING' | 'TERMS_REQUIRED' | 'TERMS_UNKNOWN'
  | 'FORM_ACCESS_UNAVAILABLE' | 'PAGE_UNAVAILABLE' | 'META_ERROR' | 'DISABLED';

export type LeadTerms = 'ACCEPTED' | 'REQUIRED' | 'UNKNOWN';

/** Meta's official acceptance page for a Page (opened in a Meta window, never embedded or copied). */
export const LEAD_TERMS_URL = (pageId: string) => `https://www.facebook.com/ads/leadgen/tos?page_id=${encodeURIComponent(pageId)}`;

/** What the last check read from Meta for the selected Page (stored in its asset capabilities). */
export interface LeadCheck {
  /** Meta's leadgen_tos_accepted: true / false as answered; null = no answer. */
  tosField?: boolean | null;
  /** Meta returned a leadgen_tos_acceptance_time. */
  acceptanceTime?: boolean | null;
  /** The token that read tosField held every lead permission. */
  readWithLeadPermissions?: boolean | null;
  /** /{page}/leadgen_forms answered (true) or was refused (false); null = not tried. */
  formsReadable?: boolean | null;
  /** How many forms the Page already has (null = unknown). */
  formsCount?: number | null;
  /** Meta refused creating a form because of the terms. */
  createRefusedForTerms?: boolean | null;
  /** The check could not read Meta at all (a named reason). */
  error?: string | null;
}

export function leadTermsEvidence(c: LeadCheck | null | undefined): LeadTerms {
  if (!c) return 'UNKNOWN';
  if (c.tosField === true || c.acceptanceTime === true || (c.formsCount ?? 0) > 0) return 'ACCEPTED';
  if (c.createRefusedForTerms === true) return 'REQUIRED';
  if (c.tosField === false && c.readWithLeadPermissions === true) return 'REQUIRED';
  return 'UNKNOWN';
}

export function instantFormsState(input: {
  goalEnabled: boolean;
  granted: readonly string[] | null | undefined;
  required: readonly string[];
  /** The selected Page's last check (null = never checked). */
  check: LeadCheck | null | undefined;
  /** A Facebook Page is selected (forms live on the Page). Defaults to true. */
  pageSelected?: boolean;
  /** MOCK mode grants everything; nothing reaches Meta. */
  mock?: boolean;
}): InstantFormsState {
  if (!input.goalEnabled) return 'DISABLED';
  if (input.mock) return 'READY';
  if (input.pageSelected === false) return 'PAGE_UNAVAILABLE';
  const granted = input.granted ?? [];
  if (!input.required.every((s) => granted.includes(s))) return 'PERMISSIONS_MISSING';
  const c = input.check;
  if (c?.error) return 'META_ERROR';
  if (c?.formsReadable === false) return 'FORM_ACCESS_UNAVAILABLE';
  const terms = leadTermsEvidence(c);
  if (terms === 'REQUIRED') return 'TERMS_REQUIRED';
  // Ready only on Meta's own evidence: terms accepted AND the forms readable.
  if (terms === 'ACCEPTED' && c?.formsReadable === true) return 'READY';
  return 'TERMS_UNKNOWN';
}

/** What remains once the terms are accepted — "Terms accepted ✓ · next: …". */
export function afterTerms(input: Parameters<typeof instantFormsState>[0]): InstantFormsState {
  return instantFormsState({ ...input, check: { ...(input.check ?? {}), tosField: true, createRefusedForTerms: false, formsReadable: input.check?.formsReadable ?? true } });
}

/** Read the stored check back from a PAGE asset's capabilities. */
export function leadCheckOf(caps: Record<string, unknown> | null | undefined): LeadCheck | null {
  if (!caps || caps.leadgen_tos_checked_at == null) return null;
  const b = (v: unknown) => (typeof v === 'boolean' ? v : null);
  return {
    tosField: b(caps.leadgen_tos_accepted),
    acceptanceTime: b(caps.leadgen_tos_acceptance_time),
    readWithLeadPermissions: b(caps.leadgen_tos_read_with_lead_permissions),
    formsReadable: b(caps.leadgen_forms_readable),
    formsCount: typeof caps.leadgen_forms_count === 'number' ? caps.leadgen_forms_count : null,
    createRefusedForTerms: b(caps.leadgen_create_refused_for_terms),
    error: typeof caps.leadgen_check_error === 'string' ? caps.leadgen_check_error : null,
  };
}

/** Meta refused a form because the Page has not accepted the Lead Ads terms (its message names them). */
export function isTermsRefusal(message: string | null | undefined): boolean {
  return /terms of service|lead ?ads? terms|leadgen.?tos|accept the .*terms/i.test(String(message ?? ''));
}

/** The required permissions this connection lacks — for Admin only. */
export function missingInstantFormScopes(granted: readonly string[] | null | undefined, required: readonly string[]): string[] {
  const g = granted ?? [];
  return required.filter((s) => !g.includes(s));
}

/**
 * Why a connection lacks the Instant Form permissions — for Admin. DECLINED:
 * the customer unticked them at login (reconnect fixes it). NOT_REQUESTED: the
 * Facebook Login for Business configuration never asked for them (declined is
 * empty), so no reconnect can grant them until the app's configuration adds
 * them (and Meta grants Advanced Access for non-role users).
 */
export function instantFormsCause(c: { granted_scopes?: readonly string[] | null; declined_scopes?: readonly string[] | null }): 'DECLINED' | 'NOT_REQUESTED' {
  const missing = missingInstantFormScopes(c.granted_scopes, INSTANT_FORM_PERMISSIONS);
  return missing.some((s) => (c.declined_scopes ?? []).includes(s)) ? 'DECLINED' : 'NOT_REQUESTED';
}

/** Every way the round trip can end — each with its own sentence. */
export type TermsOutcome =
  | 'IDLE' | 'WAITING' | 'CHECKING' | 'ACCEPTED' | 'NOT_ACCEPTED' | 'UNCONFIRMED'
  | 'POPUP_BLOCKED' | 'META_ERROR' | 'SESSION_EXPIRED' | 'PAGE_CHANGED' | 'TIMEOUT';

/** Decide the outcome from Meta's answer — pure, so the tests read the same rule. UNKNOWN is never "not accepted". */
export function termsOutcome(r: { pageAtOpen: string | null; pageNow: string | null; terms: LeadTerms | null | undefined; windowOpen: boolean }): TermsOutcome {
  if (r.pageAtOpen && r.pageNow && r.pageAtOpen !== r.pageNow) return 'PAGE_CHANGED';
  if (r.terms === 'ACCEPTED') return 'ACCEPTED';
  if (r.terms === 'REQUIRED') return r.windowOpen ? 'WAITING' : 'NOT_ACCEPTED';
  return r.windowOpen ? 'WAITING' : 'UNCONFIRMED';
}
