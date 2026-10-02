// META ADS — CAN THIS CUSTOMER COLLECT LEADS ON FACEBOOK/INSTAGRAM? Pure.
//
// Instant Forms (goal LEADS_ON_META) need Meta permissions beyond the base
// connection: leads_retrieval, pages_manage_ads and pages_manage_metadata
// (_shared/metaAds.ts INSTANT_FORM_SCOPES). Each needs Advanced Access from
// Meta App Review, and with Facebook Login for Business they are granted only
// if the login configuration asks for them — a customer cannot add them by
// reconnecting until it does. So the state is decided here, once, for the
// builder and the server alike:
//   AVAILABLE       every permission held AND Meta reports the Page's Lead
//                   Ads Terms accepted;
//   TERMS_REQUIRED  Meta reports the Page has not accepted its Lead Ads Terms:
//                   the owner accepts them in Meta's own window (one CTA);
//   PAGE_REQUIRED   no Facebook Page selected;
//   RECONNECT       another connection already holds the permissions — the
//                   configuration offers them, so reconnecting grants them;
//   COMING_SOON     nobody can be granted them yet (App Review / configuration
//                   pending): the capability does not exist for this app yet;
//   RECHECK         permissions held, but Meta has not confirmed the terms
//                   (never read, or Meta did not answer): check again;
//   DISABLED        the admin switched the goal off.
// Customers never see a permission name; Admin sees the technical reason.

/** Mirrors _shared/metaAds.ts INSTANT_FORM_SCOPES (a test keeps them equal) — for Admin display. */
export const INSTANT_FORM_PERMISSIONS = ['leads_retrieval', 'pages_manage_ads', 'pages_manage_metadata'] as const;

export type InstantFormsState =
  | 'AVAILABLE' | 'TERMS_REQUIRED' | 'PAGE_REQUIRED' | 'RECONNECT' | 'COMING_SOON' | 'RECHECK' | 'DISABLED';

/**
 * Meta's Lead Ads Terms are accepted PER PAGE by a person, on Meta's own page
 * (LEAD_TERMS_URL). HOMATCH only reads the Page's `leadgen_tos_accepted`
 * field: true / false as Meta says, null when Meta did not answer, undefined
 * when it was never read. HOMATCH never accepts, simulates or stores consent.
 */
export type TermsAccepted = boolean | null | undefined;

/** Meta's official acceptance page for a Page (opened in a Meta window, never embedded or copied). */
export const LEAD_TERMS_URL = (pageId: string) => `https://www.facebook.com/ads/leadgen/tos?page_id=${encodeURIComponent(pageId)}`;

export function instantFormsState(input: {
  goalEnabled: boolean;
  granted: readonly string[] | null | undefined;
  required: readonly string[];
  /** Some connection on this platform already holds every required permission. */
  offeredByLogin: boolean;
  /** The selected Page's leadgen_tos_accepted, as Meta last reported it. */
  termsAccepted: TermsAccepted;
  /** A Facebook Page is selected (forms live on the Page). Defaults to true. */
  pageSelected?: boolean;
  /** MOCK mode grants everything; nothing reaches Meta. */
  mock?: boolean;
}): InstantFormsState {
  if (!input.goalEnabled) return 'DISABLED';
  if (input.mock) return 'AVAILABLE';
  if (input.pageSelected === false) return 'PAGE_REQUIRED';
  // The one thing the owner can do right now, in Meta's own window — shown first.
  if (input.termsAccepted === false) return 'TERMS_REQUIRED';
  const granted = input.granted ?? [];
  if (!input.required.every((s) => granted.includes(s))) return input.offeredByLogin ? 'RECONNECT' : 'COMING_SOON';
  // Ready only when Meta itself confirmed the terms; unknown is checked again, never assumed.
  return input.termsAccepted === true ? 'AVAILABLE' : 'RECHECK';
}

/** What remains once the terms are accepted — "Terms accepted ✓ · next: …". */
export function afterTerms(input: Parameters<typeof instantFormsState>[0]): InstantFormsState {
  return instantFormsState({ ...input, termsAccepted: true });
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

/** Decide the outcome from Meta's answer — pure, so the tests read the same rule. */
export function termsOutcome(r: { pageAtOpen: string | null; pageNow: string | null; terms: boolean | null | undefined; windowOpen: boolean }): TermsOutcome {
  if (r.pageAtOpen && r.pageNow && r.pageAtOpen !== r.pageNow) return 'PAGE_CHANGED';
  if (r.terms === true) return 'ACCEPTED';
  if (r.terms === false) return r.windowOpen ? 'WAITING' : 'NOT_ACCEPTED';
  return r.windowOpen ? 'WAITING' : 'UNCONFIRMED';
}
