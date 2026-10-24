// MATCHING WORKSPACE — the client for the two matching products and their switches
// (migration 20261129090000_curated_leads_marketplace.sql).
//
//   HOMATCH Internal Matches   → internal_leads_feed_v2 (existing feed, new filters) + the existing
//                                internal unlock (atomic-unlock kind internal_leads) — reused from
//                                services/homatchLeads.ts, never re-implemented here.
//   External Leads Database    → curated_leads_catalog / curated_leads_quote / atomic-unlock kind
//                                curated_leads. Every price and charge is the server's.
//   Unlocked leads → email     → curated_leads_save_to_list / internal_leads_save_to_list, which write
//                                into the EXISTING outreach contact lists (no second contact manager).
import { supabase } from '@/db/supabase';
import { type LeadFeed, type LeadFilter, type LeadItem, type LeadQuery, UnlockError } from './homatchLeads';

export { UnlockError };

/* ── switches ────────────────────────────────────────────────────────────── */

export interface CuratedPrice { credits: number; cents: number; active: boolean }

export interface WorkspaceState {
  /** Matching Maintenance Mode: the workspace shows the coming-soon announcement. */
  maintenance: boolean;
  /** HOMATCH Internal Matches: discovery and new unlocks. */
  internal: boolean;
  /** External Leads Database: catalog, filters, prices and purchases. */
  curated: boolean;
  /** The "Unlocked Leads" entry in the workspace (ownership is never affected). */
  unlockedLibrary: boolean;
  /** Legacy paid Apify / Actor discovery — always hidden from customers; reported for admin only. */
  externalDiscovery: boolean;
  curatedPrice: CuratedPrice | null;
}

/** Shown until the server answers: nothing sellable, nothing hidden that is owned. */
export const UNKNOWN_STATE: WorkspaceState = {
  maintenance: false, internal: false, curated: false, unlockedLibrary: true, externalDiscovery: false, curatedPrice: null,
};

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

export function normalizeState(raw: unknown): WorkspaceState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const p = (r.curatedPrice && typeof r.curatedPrice === 'object' ? r.curatedPrice : null) as Record<string, unknown> | null;
  return {
    maintenance: bool(r.maintenance, false),
    internal: bool(r.internal, false),
    curated: bool(r.curated, false),
    unlockedLibrary: bool(r.unlockedLibrary, true),
    externalDiscovery: bool(r.externalDiscovery, false),
    curatedPrice: p ? { credits: Number(p.credits ?? 0), cents: Number(p.cents ?? 0), active: p.active === true } : null,
  };
}

export async function getWorkspaceState(): Promise<WorkspaceState> {
  const { data, error } = await supabase.rpc('matching_workspace_state');
  if (error) throw error;
  return normalizeState(data);
}

/* ── shared filter model ─────────────────────────────────────────────────── */

export type Interest = 'BUY' | 'RENT' | 'INVEST';
export type Channel = 'PHONE' | 'WHATSAPP' | 'TELEGRAM' | 'FACEBOOK' | 'LINKEDIN' | 'SOCIAL';
export type LeadCategoryCode = 'PRIVATE' | 'CORPORATE' | 'DIASPORA' | 'EXPAT' | 'OTHER';
export type SourceClass = 'PARTNER' | 'EVENT' | 'WEB_FORM' | 'REFERRAL' | 'DIRECTORY' | 'OTHER';

export interface MatchingFilters {
  countries: string[];      // ISO-3166 alpha-2, upper case
  languages: string[];      // ISO-639 codes, lower case; 'unknown' = none recorded
  interests: Interest[];
  channels: Channel[];
  categories: LeadCategoryCode[];
  sources: SourceClass[];
  q: string;
  addedSince: string | null;    // yyyy-mm-dd
  verifiedSince: string | null; // yyyy-mm-dd
  location: string;
}

export const EMPTY_FILTERS: MatchingFilters = {
  countries: [], languages: [], interests: [], channels: [], categories: [], sources: [],
  q: '', addedSince: null, verifiedSince: null, location: '',
};

/** Only what is set travels; the server applies every filter. */
export function filterPayload(f: MatchingFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['countries', 'languages', 'interests', 'channels', 'categories', 'sources'] as const) if (f[k].length) out[k] = f[k];
  if (f.q.trim()) out.q = f.q.trim();
  if (f.location.trim()) out.location = f.location.trim();
  if (f.addedSince) out.addedSince = f.addedSince;
  if (f.verifiedSince) out.verifiedSince = f.verifiedSince;
  return out;
}

export function activeFilterCount(f: MatchingFilters): number {
  return f.countries.length + f.languages.length + f.interests.length + f.channels.length + f.categories.length
    + f.sources.length + (f.q.trim() ? 1 : 0) + (f.location.trim() ? 1 : 0) + (f.addedSince ? 1 : 0) + (f.verifiedSince ? 1 : 0);
}

/* ── External Leads Database ─────────────────────────────────────────────── */

export type CatalogView = 'AVAILABLE' | 'UNLOCKED';
export type CatalogSort = 'NEWEST' | 'NAME' | 'COUNTRY' | 'VERIFIED' | 'UNLOCKED';
export const CATALOG_PAGE_SIZES = [100, 200, 500] as const;
export type CatalogPageSize = typeof CATALOG_PAGE_SIZES[number];

export interface CuratedChannels {
  email: boolean; phone: boolean; whatsapp: boolean; telegram: boolean; facebook: boolean; linkedin: boolean; otherSocial: boolean;
}

export interface CuratedLead {
  id: string;
  /** AVAILABLE view: first name + last initial. */
  displayName?: string;
  country: string;
  languages: string[];
  interests: Interest[];
  category: LeadCategoryCode | null;
  city: string | null;
  region: string | null;
  preferredLocation: string | null;
  budget: { min: number | null; max: number | null; currency: string | null } | null;
  propertyType: string | null;
  investmentPrefs: string | null;
  description: string | null;
  addedAt: string;
  lastVerifiedAt: string | null;
  channels: CuratedChannels;
  /* UNLOCKED view only. */
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
  whatsapp?: string | null;
  telegram?: string | null;
  facebook?: string | null;
  linkedin?: string | null;
  otherSocial?: string | null;
  unlockedAt?: string;
  creditsCharged?: number;
}

export interface CatalogPage {
  view: CatalogView;
  page: number;
  pageSize: number;
  total: number;
  counts: { available: number; unlocked: number };
  facets: { countries: Record<string, number>; languages: Record<string, number>; interests: Record<string, number> };
  price: CuratedPrice | null;
  items: CuratedLead[];
}

export interface CatalogQuery {
  view: CatalogView;
  filters: MatchingFilters;
  sort: CatalogSort;
  page: number;       // 1-based
  pageSize: CatalogPageSize;
}

/** A Postgres refusal → a stable code the UI can translate. */
export function serverCode(e: unknown): string {
  const m = String((e as { message?: string } | null)?.message ?? e ?? '');
  for (const k of ['SERVICE_DISABLED', 'INSUFFICIENT_CREDITS', 'PRICE_CHANGED', 'NOTHING_SELECTED', 'TOO_MANY_SELECTED',
    'PRODUCT_DISABLED', 'FORBIDDEN', 'NOT_FOUND', 'INVALID_LANGUAGE']) if (m.includes(k)) return k;
  return 'INTERNAL';
}

export async function getCatalog(q: CatalogQuery): Promise<CatalogPage> {
  const { data, error } = await supabase.rpc('curated_leads_catalog', {
    p: { view: q.view, filters: filterPayload(q.filters), sort: q.sort, page: q.page, pageSize: String(q.pageSize) },
  });
  if (error) throw new UnlockError(serverCode(error));
  const d = (data ?? {}) as Partial<CatalogPage>;
  return {
    view: (d.view ?? q.view) as CatalogView, page: Number(d.page ?? q.page), pageSize: Number(d.pageSize ?? q.pageSize),
    total: Number(d.total ?? 0),
    counts: { available: Number(d.counts?.available ?? 0), unlocked: Number(d.counts?.unlocked ?? 0) },
    facets: { countries: d.facets?.countries ?? {}, languages: d.facets?.languages ?? {}, interests: d.facets?.interests ?? {} },
    price: d.price ? { credits: Number(d.price.credits), cents: Number(d.price.cents), active: d.price.active === true } : null,
    items: (d.items ?? []) as CuratedLead[],
  };
}

/**
 * What a purchase acts on: explicit ids (a lead, several, a page) or everything matching the
 * filters minus deselected ids — resolved by the server, never a list of the database.
 */
export type CuratedSelection =
  | { mode: 'ids'; ids: string[] }
  | { mode: 'all'; filters: MatchingFilters; exclude: string[] };

function selectionPayload(s: CuratedSelection): Record<string, unknown> {
  return s.mode === 'ids' ? { ids: s.ids } : { allMatching: true, filters: filterPayload(s.filters), exclude: s.exclude };
}

export interface CuratedQuote {
  selected: number;
  alreadyUnlocked: number;
  newCount: number;
  unitCredits: number;
  totalCredits: number;
  active: boolean;
  maxPerPurchase: number;
  balance: number | null;
}

export async function quoteCurated(s: CuratedSelection): Promise<CuratedQuote> {
  const { data, error } = await supabase.rpc('curated_leads_quote', { p: selectionPayload(s) });
  if (error) throw new UnlockError(serverCode(error));
  const q = (data ?? {}) as Record<string, unknown>;
  return {
    selected: Number(q.selected ?? 0), alreadyUnlocked: Number(q.alreadyUnlocked ?? 0), newCount: Number(q.newCount ?? 0),
    unitCredits: Number(q.unitCredits ?? 0), totalCredits: Number(q.totalCredits ?? 0), active: q.active === true,
    maxPerPurchase: Number(q.maxPerPurchase ?? 5000), balance: q.balance == null ? null : Number(q.balance),
  };
}

export interface CuratedUnlockResult {
  batchId: string;
  unlocked: string[];
  unlockedCount: number;
  alreadyUnlocked: number;
  chargedCredits: number;
  unitCredits: number;
  balanceAfter: number | null;
  /** The account's standing "HOMATCH Curated Leads" email list (null when nothing new was unlocked). */
  listId: string | null;
  duplicate: boolean;
}

/** A fresh key per confirmed click; reuse it only to retry that same click. */
export function newCuratedUnlockKey(): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `clu:${rnd}`;
}

/** expectedCredits = the total the customer confirmed; the server refuses to charge more. */
export async function unlockCurated(s: CuratedSelection, expectedCredits: number, idempotencyKey: string): Promise<CuratedUnlockResult> {
  const { data, error } = await supabase.functions.invoke('atomic-unlock', {
    body: { kind: 'curated_leads', ...selectionPayload(s), expectedCredits, idempotencyKey },
  });
  if (error) {
    let code = 'INTERNAL';
    try {
      const body = await (error as { context?: Response }).context?.json?.();
      if (body && typeof body.error === 'string') code = body.error;
    } catch { /* keep INTERNAL */ }
    throw new UnlockError(code);
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    batchId: String(r.batchId ?? ''), unlocked: (r.unlocked ?? []) as string[], unlockedCount: Number(r.unlockedCount ?? 0),
    alreadyUnlocked: Number(r.alreadyUnlocked ?? 0), chargedCredits: Number(r.chargedCredits ?? 0),
    unitCredits: Number(r.unitCredits ?? 0), balanceAfter: r.balanceAfter == null ? null : Number(r.balanceAfter),
    listId: typeof r.listId === 'string' ? r.listId : null, duplicate: r.duplicate === true,
  };
}

/* ── HOMATCH Internal Matches (existing feed and unlock) ─────────────────── */

export type InternalView = 'AVAILABLE' | 'UNLOCKED';

export interface InternalLead extends LeadItem {
  interest?: Interest;
  country?: string | null;
}

export interface InternalPage extends Omit<LeadFeed, 'items' | 'facets'> {
  items: InternalLead[];
  facets: LeadFeed['facets'] & { countries: Record<string, number>; languages: Record<string, number>; interests: Record<string, number> };
  /** Every id matching the filters (≤ 500, in page order), only when asked for. */
  ids: string[] | null;
  /** Internal matching switched off (or maintenance): only members already unlocked are returned. */
  disabled: boolean;
}

export const INTERNAL_PAGE_SIZE = 100;

export interface InternalQuery {
  view: InternalView;
  filters: MatchingFilters;
  sort: LeadQuery['sort'];
  page: number;          // 1-based
  withIds?: boolean;
  /** The feed's own criteria (EXACT / NEARBY / VIP, strength, confidence, searcher, freshness). */
  criteria?: LeadFilter[];
  district?: string | null;
  propertyType?: string | null;
}

export async function getInternalPage(propertyId: string, q: InternalQuery): Promise<InternalPage> {
  const f = filterPayload(q.filters);
  const { data, error } = await supabase.rpc('internal_leads_feed_v2', {
    p_property_id: propertyId,
    p: {
      filters: [...(q.criteria ?? []).filter((c) => c !== 'LOCKED' && c !== 'UNLOCKED'), q.view === 'UNLOCKED' ? 'UNLOCKED' : 'LOCKED'],
      sort: q.sort, limit: INTERNAL_PAGE_SIZE, offset: (Math.max(1, q.page) - 1) * INTERNAL_PAGE_SIZE,
      district: q.district ?? null, propertyType: q.propertyType ?? null,
      countries: f.countries ?? [], languages: f.languages ?? [], interests: f.interests ?? [], q: f.q ?? null,
      withIds: q.withIds === true,
    },
  });
  if (error) throw new UnlockError(serverCode(error));
  const base = (data ?? {}) as Record<string, unknown> & { facets?: Record<string, unknown> };
  const fac = (base.facets ?? {}) as Record<string, unknown>;
  return {
    total: Number(base.total ?? 0),
    counts: (base.counts ?? {}) as LeadFeed['counts'],
    prices: (base.prices ?? { STANDARD: 3, EXACT: 5, PREMIUM: 10, MORTGAGE: 3, active: false }) as LeadFeed['prices'],
    lastSeenAt: (base.lastSeenAt as string | null) ?? null,
    preferences: null,
    items: (base.items ?? []) as InternalLead[],
    facets: {
      districts: Array.isArray(fac.districts) ? (fac.districts as unknown[]).map(String) : [],
      propertyTypes: Array.isArray(fac.propertyTypes) ? (fac.propertyTypes as unknown[]).map(String) : [],
      countries: (fac.countries ?? {}) as Record<string, number>,
      languages: (fac.languages ?? {}) as Record<string, number>,
      interests: (fac.interests ?? {}) as Record<string, number>,
    },
    ids: Array.isArray(base.ids) ? (base.ids as unknown[]).map(String) : null,
    disabled: base.disabled === true,
  };
}

export { getLeadContact as getInternalContact, newUnlockKey as newInternalUnlockKey, quoteUnlock as quoteInternal, unlockLeads as unlockInternal } from './homatchLeads';

/* ── unlocked leads → the EXISTING email contact lists ───────────────────── */

export interface SavedList { listId: string; contacts: number; added: number }

export async function saveCuratedToList(leadIds: string[], name?: string): Promise<SavedList> {
  const { data, error } = await supabase.rpc('curated_leads_save_to_list', { p_lead_ids: leadIds, p_name: name ?? null });
  if (error) throw new UnlockError(serverCode(error));
  const r = (data ?? {}) as Record<string, unknown>;
  return { listId: String(r.listId), contacts: Number(r.contacts ?? 0), added: Number(r.added ?? 0) };
}

export async function saveInternalToList(matchIds: string[], name?: string): Promise<SavedList> {
  const { data, error } = await supabase.rpc('internal_leads_save_to_list', { p_match_ids: matchIds, p_name: name ?? null });
  if (error) throw new UnlockError(serverCode(error));
  const r = (data ?? {}) as Record<string, unknown>;
  return { listId: String(r.listId), contacts: Number(r.contacts ?? 0), added: Number(r.added ?? 0) };
}

/** The existing campaign screen, opened on a list (EmailCampaignsPage reads ?new=1&list=). */
export function emailCampaignPath(listId: string, propertyId?: string | null): string {
  const q = new URLSearchParams({ new: '1', list: listId });
  if (propertyId) q.set('property', propertyId);
  return `/outreach/email?${q.toString()}`;
}

/* ── multilingual preparation on the existing lists ──────────────────────── */

export interface ListAudience {
  total: number;
  withEmail: number;
  consented: number;
  /** What outreach-send will actually reach: address, consent, no opt-out / suppression. */
  eligible: number;
  byLanguage: Record<string, { total: number; eligible: number }>;
  bySource: Record<string, number>;
}

export async function getListAudience(listId: string): Promise<ListAudience> {
  const { data, error } = await supabase.rpc('outreach_list_audience', { p_list_id: listId });
  if (error) throw new UnlockError(serverCode(error));
  const r = (data ?? {}) as Partial<ListAudience>;
  return {
    total: Number(r.total ?? 0), withEmail: Number(r.withEmail ?? 0), consented: Number(r.consented ?? 0),
    eligible: Number(r.eligible ?? 0), byLanguage: r.byLanguage ?? {}, bySource: r.bySource ?? {},
  };
}

export interface LanguageList { language: string; listId: string; audience: ListAudience }

/** One list per recipient language; unknown languages go to the fallback the owner chose (or stay "unknown"). */
export async function splitListByLanguage(listId: string, fallbackLanguage: string | null): Promise<LanguageList[]> {
  const { data, error } = await supabase.rpc('outreach_list_split_by_language', { p_list_id: listId, p_fallback_language: fallbackLanguage });
  if (error) throw new UnlockError(serverCode(error));
  return ((data ?? []) as LanguageList[]).map((x) => ({ language: String(x.language), listId: String(x.listId), audience: x.audience }));
}
