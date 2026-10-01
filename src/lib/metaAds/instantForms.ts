// META ADS — CAN THIS CUSTOMER COLLECT LEADS ON FACEBOOK/INSTAGRAM? Pure.
//
// Instant Forms (goal LEADS_ON_META) need Meta permissions beyond the base
// connection: leads_retrieval, pages_manage_ads and pages_manage_metadata
// (_shared/metaAds.ts INSTANT_FORM_SCOPES). Each needs Advanced Access from
// Meta App Review, and with Facebook Login for Business they are granted only
// if the login configuration asks for them — a customer cannot add them by
// reconnecting until it does. So the state is decided here, once, for the
// builder and the server alike:
//   AVAILABLE    the connection holds every required permission;
//   RECONNECT    another connection already holds them — the configuration
//                offers them, so reconnecting Meta once grants them;
//   COMING_SOON  nobody can be granted them yet (App Review / configuration
//                pending): safely unavailable, said in product words;
//   DISABLED     the admin switched the goal off.
// Customers never see a permission name; Admin sees the technical reason.

/** Mirrors _shared/metaAds.ts INSTANT_FORM_SCOPES (a test keeps them equal) — for Admin display. */
export const INSTANT_FORM_PERMISSIONS = ['leads_retrieval', 'pages_manage_ads', 'pages_manage_metadata'] as const;

export type InstantFormsState = 'AVAILABLE' | 'RECONNECT' | 'COMING_SOON' | 'DISABLED';

export function instantFormsState(input: {
  goalEnabled: boolean;
  granted: readonly string[] | null | undefined;
  required: readonly string[];
  /** Some connection on this platform already holds every required permission. */
  offeredByLogin: boolean;
  /** MOCK mode grants everything; nothing reaches Meta. */
  mock?: boolean;
}): InstantFormsState {
  if (!input.goalEnabled) return 'DISABLED';
  if (input.mock) return 'AVAILABLE';
  const granted = input.granted ?? [];
  if (input.required.every((s) => granted.includes(s))) return 'AVAILABLE';
  return input.offeredByLogin ? 'RECONNECT' : 'COMING_SOON';
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
