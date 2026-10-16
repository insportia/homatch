// THE PUBLISHING DOMAIN — pure, no Deno or network APIs, so node:test runs it.
//
// What a portal supports, what a listing must contain, and the publication state
// machine. index.ts owns I/O (auth, database, the one page fetch) and asks this
// file every question that has a right answer.
//
// THE HONEST CAPABILITY TABLE (researched 2026-10-15):
//
//   MyHome.ge and SS.ge publish NO authorized listing-submission API. Creating a
//   listing happens in the owner's own logged-in portal session, behind the
//   portal's SMS/OTP verification. HOMATCH therefore never submits on the owner's
//   behalf and never asks for portal passwords, cookies or OTP codes. The
//   supported flow is a MANUAL HANDOFF: HOMATCH prepares a portal-ready copy, the
//   owner publishes it on the portal, pastes the resulting listing URL back, and
//   HOMATCH checks the PUBLIC listing page. Only that check sets PUBLISHED.
//
//   Unpublishing is likewise done on the portal; HOMATCH confirms the public page
//   is gone (HTTP 404/410). An owner may attest a removal the check cannot see —
//   that is recorded as owner-attested, never as a portal confirmation.

export type PortalId = 'myhome' | 'ssge';

export interface Portal {
  id: PortalId;
  name: string;
  domains: string[];
  /** Where the owner creates a listing on the portal. */
  createUrl: string;
  mode: 'MANUAL_HANDOFF';
  api: false;
  /** Photo ceiling the portal enforces, when known. */
  maxPhotos: number | null;
  /** The listing reference in a public listing URL. */
  externalId: (url: URL) => string | null;
}

export const PORTALS: Portal[] = [
  {
    id: 'myhome',
    name: 'MyHome.ge',
    domains: ['myhome.ge'],
    createUrl: 'https://statements.myhome.ge/ka/statement/create?referrer=myhome',
    mode: 'MANUAL_HANDOFF',
    api: false,
    maxPhotos: 16,
    // https://www.myhome.ge/ka/pr/12345678/...
    externalId: (url) => url.pathname.match(/\/pr\/(\d{5,12})(?:\/|$)/)?.[1] ?? null,
  },
  {
    id: 'ssge',
    name: 'SS.ge',
    domains: ['ss.ge'],
    createUrl: 'https://home.ss.ge/ka/udzravi-qoneba',
    mode: 'MANUAL_HANDOFF',
    api: false,
    maxPhotos: null,
    // https://home.ss.ge/ka/udzravi-qoneba/qiravdeba-3-otaxiani-bina-...-31234567
    externalId: (url) => url.pathname.replace(/\/+$/, '').match(/(?:^|[/-])(\d{6,12})$/)?.[1] ?? null,
  },
];

export const portalById = (id: unknown): Portal | null => PORTALS.find((p) => p.id === id) ?? null;

/** The registry as the browser sees it: data only, no functions. */
export function publicRegistry() {
  return PORTALS.map(({ externalId: _ignored, ...rest }) => ({ ...rest, publishing: 'MANUAL_HANDOFF', verification: 'PUBLIC_PAGE_CHECK' }));
}

/* ── The listing ──────────────────────────────────────────────────────── */

export const PROPERTY_TYPES = ['APARTMENT', 'HOUSE', 'VILLA', 'COMMERCIAL', 'LAND', 'OFFICE', 'PENTHOUSE', 'STUDIO', 'TOWNHOUSE', 'OTHER'];
export const DEAL_TYPES = ['SALE', 'RENT', 'DAILY_RENT'];
export const CURRENCIES = ['USD', 'GEL', 'EUR'];
export const CONDITIONS = ['NEW', 'GOOD', 'NEEDS_RENOVATION', 'UNDER_CONSTRUCTION'];
export const AMENITIES = ['parking', 'balcony', 'terrace', 'elevator', 'furnished', 'air_conditioning', 'central_heating', 'yard', 'security', 'storage'];
export const HOMATCH_MAX_PHOTOS = 30;

export interface Listing {
  title: string;
  description: { ka: string; en: string; ru: string };
  propertyType: string;
  dealType: string;
  price: number | null;
  currency: string;
  area: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  totalFloors: number | null;
  condition: string;
  city: string;
  district: string;
  street: string;
  streetNumber: string;
  amenities: string[];
  /** property_photos ids, in publication order. The photos stay the property's own. */
  photos: string[];
  contactName: string;
  /** E.164 after the edge function's phone check. Private: shown to the owner only. */
  contactPhone: string;
  portalTargets: PortalId[];
}

const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const longText = (v: unknown, max = 6000) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '');
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const oneOf = (v: unknown, list: string[], fallback = '') => {
  const s = text(v).toUpperCase();
  return list.includes(s) ? s : fallback;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whatever the browser sent, reduced to the listing shape. Unknown keys are dropped. */
export function normalizeListing(raw: Record<string, unknown> | null | undefined): Listing {
  const r = (raw ?? {}) as Record<string, any>;
  const d = r.description && typeof r.description === 'object' ? r.description : {};
  return {
    title: text(r.title, 140),
    description: { ka: longText(d.ka), en: longText(d.en), ru: longText(d.ru) },
    propertyType: oneOf(r.propertyType, PROPERTY_TYPES),
    dealType: oneOf(r.dealType, DEAL_TYPES),
    price: num(r.price),
    currency: oneOf(r.currency, CURRENCIES, 'USD'),
    area: num(r.area),
    rooms: num(r.rooms),
    bedrooms: num(r.bedrooms),
    bathrooms: num(r.bathrooms),
    floor: num(r.floor),
    totalFloors: num(r.totalFloors),
    condition: oneOf(r.condition, CONDITIONS),
    city: text(r.city, 80),
    district: text(r.district, 80),
    street: text(r.street, 120),
    streetNumber: text(r.streetNumber, 20),
    amenities: [...new Set((Array.isArray(r.amenities) ? r.amenities : []).map((a: unknown) => text(a, 40)).filter((a: string) => AMENITIES.includes(a)))],
    photos: [...new Set((Array.isArray(r.photos) ? r.photos : []).map((p: unknown) => text(p, 40)).filter((p: string) => UUID.test(p)))].slice(0, HOMATCH_MAX_PHOTOS),
    contactName: text(r.contactName, 80),
    contactPhone: text(r.contactPhone, 32),
    portalTargets: [...new Set((Array.isArray(r.portalTargets) ? r.portalTargets : []).filter((p: unknown) => portalById(p)))] as PortalId[],
  };
}

export interface Problem { field: string; code: string; portal?: PortalId }

/**
 * What stands between this listing and a portal.
 *
 * `listing`: problems that block every portal. `portals[id]`: the extra ones a
 * specific portal adds. A DRAFT may be saved with problems; a publication may
 * only be prepared for a portal whose list is empty.
 */
export function validateListing(x: Listing): { listing: Problem[]; portals: Record<string, Problem[]>; ready: boolean } {
  const p: Problem[] = [];
  if (!x.title) p.push({ field: 'title', code: 'REQUIRED' });
  if (!x.description.ka && !x.description.en && !x.description.ru) p.push({ field: 'description', code: 'REQUIRED' });
  if (!x.propertyType) p.push({ field: 'propertyType', code: 'REQUIRED' });
  if (!x.dealType) p.push({ field: 'dealType', code: 'REQUIRED' });
  if (!(x.price != null && x.price > 0)) p.push({ field: 'price', code: 'POSITIVE_REQUIRED' });
  if (!(x.area != null && x.area > 0)) p.push({ field: 'area', code: 'POSITIVE_REQUIRED' });
  if (!x.city) p.push({ field: 'city', code: 'REQUIRED' });
  if (!x.street) p.push({ field: 'street', code: 'REQUIRED' });
  if (!x.contactName) p.push({ field: 'contactName', code: 'REQUIRED' });
  if (!/^\+[1-9]\d{7,14}$/.test(x.contactPhone)) p.push({ field: 'contactPhone', code: 'VALID_PHONE_REQUIRED' });
  if (x.photos.length < 1) p.push({ field: 'photos', code: 'PHOTO_REQUIRED' });
  for (const k of ['rooms', 'bedrooms', 'bathrooms', 'totalFloors'] as const) {
    const v = x[k];
    if (v != null && (!Number.isInteger(v) || v < 0 || v > 500)) p.push({ field: k, code: 'INVALID_INTEGER' });
  }
  if (x.floor != null && (!Number.isInteger(x.floor) || x.floor < -5 || x.floor > 300)) p.push({ field: 'floor', code: 'INVALID_INTEGER' });
  if (x.floor != null && x.totalFloors != null && x.floor > x.totalFloors) p.push({ field: 'floor', code: 'EXCEEDS_TOTAL_FLOORS' });
  if (x.bedrooms != null && x.rooms != null && x.bedrooms > x.rooms) p.push({ field: 'bedrooms', code: 'EXCEEDS_ROOMS' });
  const portals: Record<string, Problem[]> = {};
  for (const portal of PORTALS) {
    const extra: Problem[] = [];
    if (portal.maxPhotos != null && x.photos.length > portal.maxPhotos) extra.push({ field: 'photos', code: 'TOO_MANY_PHOTOS', portal: portal.id });
    if (portal.id === 'myhome' && !x.description.ka) extra.push({ field: 'description.ka', code: 'GEORGIAN_DESCRIPTION_REQUIRED', portal: portal.id });
    portals[portal.id] = extra;
  }
  return { listing: p, portals, ready: p.length === 0 };
}

/* ── Linking an external listing ──────────────────────────────────────── */

/** A pasted portal URL → the canonical https URL and the portal's listing id, or a reason. */
export function parseExternalUrl(portalId: PortalId, input: unknown): { url: string; externalId: string } | { error: string } {
  const portal = portalById(portalId);
  if (!portal) return { error: 'PORTAL_UNKNOWN' };
  let url: URL;
  try { url = new URL(String(input ?? '').trim()); } catch { return { error: 'INVALID_URL' }; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return { error: 'HTTPS_PORTAL_URL_REQUIRED' };
  if (!hostAllowed(portal, url.hostname)) return { error: 'URL_NOT_ON_PORTAL' };
  const externalId = portal.externalId(url);
  if (!externalId) return { error: 'LISTING_ID_NOT_FOUND_IN_URL' };
  url.hash = '';
  url.search = '';
  return { url: url.toString(), externalId };
}

export function hostAllowed(portal: Portal, hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return portal.domains.some((d) => h === d || h.endsWith(`.${d}`));
}

/* ── The page check ───────────────────────────────────────────────────── */

export type CheckOutcome = { result: 'LIVE' } | { result: 'GONE'; code: string } | { result: 'UNKNOWN'; code: string };

/**
 * What one fetch of the public listing page proves.
 *
 * LIVE needs BOTH a 200 and the listing's own id in the page: a portal that
 * redirects a deleted listing to a search page answers 200 too. GONE is only an
 * explicit 404 / 410. Everything else — blocked, rate-limited, timed out, a page
 * without the id — proves nothing and is UNKNOWN.
 */
export function classifyCheck(input: { status: number | 'TIMEOUT' | 'NETWORK' | 'REDIRECT_OFF_PORTAL'; body?: string; externalId: string }): CheckOutcome {
  const { status, body = '', externalId } = input;
  if (status === 404 || status === 410) return { result: 'GONE', code: `HTTP_${status}` };
  if (status === 200) return body.includes(externalId) ? { result: 'LIVE' } : { result: 'UNKNOWN', code: 'LISTING_ID_NOT_IN_PAGE' };
  if (status === 'TIMEOUT') return { result: 'UNKNOWN', code: 'PORTAL_TIMEOUT' };
  if (status === 'NETWORK') return { result: 'UNKNOWN', code: 'PORTAL_UNREACHABLE' };
  if (status === 'REDIRECT_OFF_PORTAL') return { result: 'UNKNOWN', code: 'REDIRECTED_OFF_PORTAL' };
  if (status === 401 || status === 403) return { result: 'UNKNOWN', code: 'PORTAL_BLOCKED_CHECK' };
  if (status === 429) return { result: 'UNKNOWN', code: 'PORTAL_RATE_LIMITED' };
  if (status >= 500) return { result: 'UNKNOWN', code: 'PORTAL_ERROR' };
  return { result: 'UNKNOWN', code: `HTTP_${status}` };
}

/* ── The publication state machine ────────────────────────────────────── */

export type Status = 'HANDOFF_READY' | 'VERIFYING' | 'PUBLISHED' | 'VERIFICATION_FAILED' | 'UNPUBLISH_REQUESTED' | 'UNPUBLISHED' | 'REMOVED_EXTERNALLY';

export interface Publication {
  status: Status;
  revision: number;
  external_id: string | null;
  external_url: string | null;
  listing_version: number | null;
  check_attempts: number;
  last_checked_at: string | null;
  next_check_at: string | null;
  published_at: string | null;
  last_error: string | null;
}

export type Command =
  | { type: 'PREPARE'; listingVersion: number }
  | { type: 'LINK'; url: string; externalId: string; listingVersion: number }
  | { type: 'CHECK'; outcome: CheckOutcome }
  | { type: 'RETRY' }
  | { type: 'REQUEST_UNPUBLISH' }
  | { type: 'CONFIRM_REMOVED' }
  | { type: 'MARK_UPDATED'; listingVersion: number };

/** Verification attempts while VERIFYING before the publication is marked failed. */
export const MAX_VERIFY_ATTEMPTS = 5;
/** Minimum spacing between checks of one publication: 60 s doubling, capped at 6 h. */
export function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts), 6 * 3_600_000);
}

const LIVE_STATES: Status[] = ['VERIFYING', 'PUBLISHED', 'UNPUBLISH_REQUESTED'];
export const isLive = (s: Status | null | undefined) => !!s && LIVE_STATES.includes(s);

/**
 * The next row, the event kind, or the reason the command is refused.
 * `current` is null when no publication exists yet for this portal.
 */
export function transition(current: Publication | null, cmd: Command, now: Date): { set: Partial<Publication>; kind: string; detail?: Record<string, unknown> } | { error: string } {
  const at = now.toISOString();
  const s = current?.status ?? null;
  switch (cmd.type) {
    case 'PREPARE':
      if (s && !['UNPUBLISHED', 'REMOVED_EXTERNALLY', 'HANDOFF_READY', 'VERIFICATION_FAILED'].includes(s)) return { error: 'PUBLICATION_ALREADY_ACTIVE' };
      if (s === 'HANDOFF_READY' && current?.listing_version === cmd.listingVersion) return { error: 'NO_CHANGE' };
      return { kind: 'HANDOFF_PREPARED', set: { status: 'HANDOFF_READY', listing_version: cmd.listingVersion, external_id: null, external_url: null, check_attempts: 0, next_check_at: null, published_at: null, last_error: null } };
    case 'LINK':
      if (!s || !['HANDOFF_READY', 'VERIFICATION_FAILED', 'VERIFYING'].includes(s)) return { error: 'PREPARE_FIRST' };
      return { kind: 'EXTERNAL_LISTING_LINKED', detail: { externalId: cmd.externalId }, set: { status: 'VERIFYING', external_id: cmd.externalId, external_url: cmd.url, listing_version: cmd.listingVersion, check_attempts: 0, next_check_at: at, last_error: null } };
    case 'CHECK': {
      if (!current || !s || !LIVE_STATES.includes(s) || !current.external_id) return { error: 'NOTHING_TO_CHECK' };
      if (current.next_check_at && Date.parse(current.next_check_at) > now.getTime()) return { error: 'CHECK_TOO_SOON' };
      const attempts = current.check_attempts + 1;
      const base = { last_checked_at: at, check_attempts: attempts, next_check_at: new Date(now.getTime() + backoffMs(attempts)).toISOString() };
      const o = cmd.outcome;
      const code = o.result === 'LIVE' ? null : o.code;
      if (s === 'VERIFYING') {
        if (o.result === 'LIVE') return { kind: 'PUBLICATION_CONFIRMED', set: { ...base, status: 'PUBLISHED', published_at: at, check_attempts: 0, next_check_at: new Date(now.getTime() + backoffMs(0)).toISOString(), last_error: null } };
        if (o.result === 'GONE' || attempts >= MAX_VERIFY_ATTEMPTS) return { kind: 'VERIFICATION_FAILED', detail: { code }, set: { ...base, status: 'VERIFICATION_FAILED', last_error: code } };
        return { kind: 'VERIFICATION_PENDING', detail: { code }, set: { ...base, last_error: code } };
      }
      if (s === 'PUBLISHED') {
        if (o.result === 'LIVE') return { kind: 'PUBLICATION_SYNCED', set: { ...base, check_attempts: 0, next_check_at: new Date(now.getTime() + backoffMs(0)).toISOString(), last_error: null } };
        if (o.result === 'GONE') return { kind: 'REMOVED_ON_PORTAL', detail: { code }, set: { ...base, status: 'REMOVED_EXTERNALLY', last_error: code } };
        return { kind: 'SYNC_INCONCLUSIVE', detail: { code }, set: { ...base, last_error: code } };
      }
      // UNPUBLISH_REQUESTED
      if (o.result === 'GONE') return { kind: 'UNPUBLISH_CONFIRMED', detail: { code }, set: { ...base, status: 'UNPUBLISHED', last_error: null } };
      return { kind: o.result === 'LIVE' ? 'STILL_LIVE_ON_PORTAL' : 'SYNC_INCONCLUSIVE', detail: { code: code ?? 'STILL_LIVE' }, set: { ...base, last_error: code ?? 'STILL_LIVE' } };
    }
    case 'RETRY':
      if (s !== 'VERIFICATION_FAILED') return { error: 'NOT_FAILED' };
      if (!current?.external_url) return { kind: 'RETRY', set: { status: 'HANDOFF_READY', check_attempts: 0, next_check_at: null, last_error: null } };
      return { kind: 'RETRY', set: { status: 'VERIFYING', check_attempts: 0, next_check_at: at, last_error: null } };
    case 'REQUEST_UNPUBLISH':
      if (s !== 'PUBLISHED' && s !== 'VERIFYING') return { error: 'NOT_PUBLISHED' };
      return { kind: 'UNPUBLISH_REQUESTED', set: { status: 'UNPUBLISH_REQUESTED', check_attempts: 0, next_check_at: at } };
    case 'CONFIRM_REMOVED':
      if (s !== 'UNPUBLISH_REQUESTED' && s !== 'REMOVED_EXTERNALLY') return { error: 'NOT_UNPUBLISHING' };
      return { kind: 'REMOVAL_ATTESTED_BY_OWNER', detail: { attestedBy: 'OWNER' }, set: { status: 'UNPUBLISHED', next_check_at: null } };
    case 'MARK_UPDATED':
      if (s !== 'PUBLISHED') return { error: 'NOT_PUBLISHED' };
      if (current?.listing_version === cmd.listingVersion) return { error: 'NO_CHANGE' };
      return { kind: 'PORTAL_COPY_UPDATED', detail: { listingVersion: cmd.listingVersion }, set: { listing_version: cmd.listingVersion, next_check_at: at } };
  }
}
