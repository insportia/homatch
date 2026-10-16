// THE PUBLISHING WORKSPACE'S PURE MODEL — no React, no Supabase, so node:test runs it.
//
// The server (supabase/functions/publishing-engine/domain.ts) owns validation and the
// publication state machine. This file only READS what it returns: the counts on the
// overview, the label a status wears, whether a portal copy is behind the listing, and
// the first draft of a listing built from the owner's existing property.

export type PortalId = 'myhome' | 'ssge';
export type PublicationStatus =
  | 'HANDOFF_READY' | 'VERIFYING' | 'PUBLISHED' | 'VERIFICATION_FAILED'
  | 'UNPUBLISH_REQUESTED' | 'UNPUBLISHED' | 'REMOVED_EXTERNALLY';

export interface PortalInfo {
  id: PortalId;
  name: string;
  domains: string[];
  createUrl: string;
  maxPhotos: number | null;
  publishing: 'MANUAL_HANDOFF';
  verification: 'PUBLIC_PAGE_CHECK';
}

export interface ListingDraft {
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
  photos: string[];
  contactName: string;
  contactPhone: string;
  portalTargets: PortalId[];
}

export interface Problem { field: string; code: string; portal?: PortalId }
export interface Validation { listing: Problem[]; portals: Record<string, Problem[]>; ready: boolean }

export interface ListingRow {
  id: string;
  version: number;
  status: 'DRAFT' | 'READY';
  payload: ListingDraft;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  validation: Validation;
}

export interface PublicationRow {
  id: string;
  listing_id: string;
  portal_id: PortalId;
  status: PublicationStatus;
  revision: number;
  external_id: string | null;
  external_url: string | null;
  listing_version: number | null;
  check_attempts: number;
  last_checked_at: string | null;
  next_check_at: string | null;
  published_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: number;
  kind: string;
  portal_id: PortalId | null;
  from_status: string | null;
  to_status: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export const AMENITIES = ['parking', 'balcony', 'terrace', 'elevator', 'furnished', 'air_conditioning', 'central_heating', 'yard', 'security', 'storage'];
export const PROPERTY_TYPES = ['APARTMENT', 'HOUSE', 'VILLA', 'COMMERCIAL', 'LAND', 'OFFICE', 'PENTHOUSE', 'STUDIO', 'TOWNHOUSE', 'OTHER'];
export const DEAL_TYPES = ['SALE', 'RENT', 'DAILY_RENT'];
export const CURRENCIES = ['USD', 'GEL', 'EUR'];
export const CONDITIONS = ['NEW', 'GOOD', 'NEEDS_RENOVATION', 'UNDER_CONSTRUCTION'];

/** The four tones a status can wear: verified-live, in progress, needs action, quiet. */
export type Tone = 'live' | 'pending' | 'problem' | 'quiet';
export function toneOf(status: PublicationStatus | null): Tone {
  switch (status) {
    case 'PUBLISHED': return 'live';
    case 'HANDOFF_READY': case 'VERIFYING': case 'UNPUBLISH_REQUESTED': return 'pending';
    case 'VERIFICATION_FAILED': case 'REMOVED_EXTERNALLY': return 'problem';
    default: return 'quiet';
  }
}

/** The portal copy was published from an older listing version and the owner has edited since. */
export function isOutdated(p: PublicationRow, listing: Pick<ListingRow, 'version'>): boolean {
  return p.status === 'PUBLISHED' && p.listing_version != null && p.listing_version < listing.version;
}

export function needsAttention(listing: ListingRow, pubs: PublicationRow[]): boolean {
  if (listing.archived_at) return false;
  return pubs.some((p) => toneOf(p.status) === 'problem' || isOutdated(p, listing));
}

export type ListingFilter = 'ALL' | 'DRAFT' | 'PUBLISHED' | 'PENDING' | 'ATTENTION' | 'ARCHIVED';

export function matchesFilter(filter: ListingFilter, listing: ListingRow, pubs: PublicationRow[]): boolean {
  if (filter === 'ARCHIVED') return !!listing.archived_at;
  if (listing.archived_at) return false;
  switch (filter) {
    case 'DRAFT': return !listing.validation.ready;
    case 'PUBLISHED': return pubs.some((p) => p.status === 'PUBLISHED');
    case 'PENDING': return pubs.some((p) => toneOf(p.status) === 'pending');
    case 'ATTENTION': return needsAttention(listing, pubs);
    default: return true;
  }
}

export interface Overview {
  total: number;
  drafts: number;
  active: number;
  pending: number;
  failed: number;
  attention: number;
  archived: number;
}

/** The overview numbers. Publications are counted per portal; listings per listing. */
export function overview(listings: ListingRow[], pubs: PublicationRow[]): Overview {
  const by = groupPublications(pubs);
  const live = listings.filter((l) => !l.archived_at);
  const livePubs = pubs.filter((p) => live.some((l) => l.id === p.listing_id));
  return {
    total: live.length,
    drafts: live.filter((l) => !l.validation.ready).length,
    active: livePubs.filter((p) => p.status === 'PUBLISHED').length,
    pending: livePubs.filter((p) => toneOf(p.status) === 'pending').length,
    failed: livePubs.filter((p) => toneOf(p.status) === 'problem').length,
    attention: live.filter((l) => needsAttention(l, by.get(l.id) ?? [])).length,
    archived: listings.length - live.length,
  };
}

export function groupPublications(pubs: PublicationRow[]): Map<string, PublicationRow[]> {
  const m = new Map<string, PublicationRow[]>();
  for (const p of pubs) m.set(p.listing_id, [...(m.get(p.listing_id) ?? []), p]);
  return m;
}

/** Which language a description is written in, by script — good enough to place it. */
export function scriptOf(text: string): 'ka' | 'ru' | 'en' {
  if (/[Ⴀ-ჿ]/.test(text)) return 'ka';
  if (/[Ѐ-ӿ]/.test(text)) return 'ru';
  return 'en';
}

interface SourceProperty {
  title?: string | null;
  property_type?: string | null;
  transaction_type?: string | null;
  contact_phone_e164?: string | null;
  facts?: object | null;
  photos?: Array<{ id: string; is_cover?: boolean; display_order?: number | null }> | null;
}

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** A first draft from the property the owner already has: nothing is retyped, nothing is invented. */
export function draftFromProperty(p: SourceProperty, contactName: string): ListingDraft {
  const f = (p.facts ?? {}) as Record<string, unknown>;
  const description = { ka: '', en: '', ru: '' };
  const text = s(f.description);
  if (text) description[scriptOf(text)] = text;
  const amenities = AMENITIES.filter((a) => (a === 'central_heating' ? f.heating === 'CENTRAL' : f[a] === true));
  const photos = [...(p.photos ?? [])]
    .sort((a, b) => Number(b.is_cover ?? false) - Number(a.is_cover ?? false) || Number(a.display_order ?? 0) - Number(b.display_order ?? 0))
    .map((x) => x.id)
    .slice(0, 16);
  const type = s(p.property_type).toUpperCase();
  const deal = s(p.transaction_type).toUpperCase();
  return {
    title: s(p.title),
    description,
    propertyType: PROPERTY_TYPES.includes(type) ? type : '',
    dealType: deal === 'RENT' ? 'RENT' : deal ? 'SALE' : '',
    price: n(f.total_price),
    currency: CURRENCIES.includes(s(f.currency).toUpperCase()) ? s(f.currency).toUpperCase() : 'USD',
    area: n(f.area),
    rooms: n(f.rooms),
    bedrooms: n(f.bedrooms),
    bathrooms: n(f.bathrooms),
    floor: n(f.floor),
    totalFloors: n(f.total_floors),
    condition: CONDITIONS.includes(s(f.condition)) ? s(f.condition) : '',
    city: s(f.city),
    district: s(f.district),
    street: s(f.address),
    streetNumber: '',
    amenities,
    photos,
    contactName: s(contactName),
    contactPhone: s(p.contact_phone_e164),
    portalTargets: ['myhome', 'ssge'],
  };
}

/** The plain-text block an owner pastes into a portal's description field. */
export function handoffText(d: ListingDraft, lang: 'ka' | 'en' | 'ru'): string {
  const body = d.description[lang] || d.description.ka || d.description.en || d.description.ru;
  return [d.title, '', body].join('\n').trim();
}

/* ── The guided journey ──────────────────────────────────────────────────
 * Eight steps, each DONE only when the server's own state says so. A step is
 * never ticked because a button was clicked: "published" needs a publication the
 * server verified on the portal's public page.
 */
export const JOURNEY = ['select', 'review', 'media', 'portal', 'open', 'publish', 'link', 'verified'] as const;
export type JourneyStep = typeof JOURNEY[number];
export type StepState = 'done' | 'current' | 'todo';

export function journey(input: {
  saved: boolean;
  validation: Validation | null;
  draft: Pick<ListingDraft, 'photos' | 'description' | 'portalTargets'>;
  publications: Pick<PublicationRow, 'status' | 'external_url'>[];
}): Record<JourneyStep, StepState> {
  const { saved, validation, draft, publications } = input;
  const media = draft.photos.length > 0 && !!(draft.description.ka || draft.description.en || draft.description.ru);
  const done: Record<JourneyStep, boolean> = {
    select: true,
    review: saved && !!validation && validation.listing.filter((p) => p.field !== 'photos' && p.field !== 'description').length === 0,
    media: saved && media,
    portal: draft.portalTargets.length > 0 && publications.length > 0,
    open: publications.length > 0,
    publish: publications.some((p) => !!p.external_url),
    link: publications.some((p) => !!p.external_url),
    verified: publications.some((p) => p.status === 'PUBLISHED'),
  };
  const out = {} as Record<JourneyStep, StepState>;
  let current = false;
  for (const step of JOURNEY) {
    if (done[step]) out[step] = 'done';
    else if (!current) { out[step] = 'current'; current = true; } else out[step] = 'todo';
  }
  return out;
}
