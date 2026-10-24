/*
 * HOMATCH LEADS — the internal matching marketplace, from the owner's side.
 *
 * Browsing is free and anonymised: internal_leads_feed returns requirements, the
 * engine's agreement and price, never who the member is. matchId (an
 * internal_match_candidates id) is the only handle the browser holds; every call resolves the member on the
 * server. The one paid action — unlocking — goes through atomic-unlock (service role,
 * idempotent, all-or-nothing); everything after an unlock (contact, conversation)
 * is re-checked against what the member allows on every read.
 */

import { supabase } from '@/db/supabase';

export type LeadFilter = 'ALL' | 'STRONG' | 'POTENTIAL' | 'STANDARD' | 'PREMIUM' | 'MORTGAGE' | 'FRESH' | 'UNLOCKED' | 'CONTACTED' | 'SAVED'
  | 'LOCKED' | 'DIRECT' | 'BROKER' | 'STALE' | 'ACTIVE'
  /* Smart match expansion: the display categories and the high-confidence cut. */
  | 'EXACT' | 'NEARBY' | 'VIP' | 'HIGH_CONFIDENCE';
export type LeadSort = 'BEST' | 'CATEGORY' | 'NEWEST' | 'ACTIVE' | 'UPDATED' | 'BUDGET_DESC' | 'BUDGET_ASC';
/** Who is searching, as the member declared it on their search (never "verified"). */
export type LeadSearcher = 'DIRECT' | 'BROKER_FOR_CLIENT' | 'PROFESSIONAL';
/** MORTGAGE: mortgage interest only (3 credits). MORTGAGE_MATCH: mortgage interest and the person's own
 *  property search also matching this listing (5 credits). */
export type LeadSegment = 'STANDARD' | 'PREMIUM' | 'MORTGAGE' | 'MORTGAGE_MATCH';
export type LeadBand = 'STRONG' | 'POTENTIAL' | 'WEAK';
/** The category the owner sees: VIP (documented high budget) overrides EXACT / NEARBY_SIMILAR. */
export type LeadCategory = 'EXACT' | 'NEARBY_SIMILAR' | 'VIP';
export type LeadKind = 'EXACT_LOCATION' | 'SAME_AREA_BUDGET_FLEX' | 'NEARBY_AREA' | 'CITY_WIDE' | 'SIMILAR_PROPERTY';
export type LeadConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
/** The one price that applies to a person (never stacked). */
export type LeadPriceKey = 'STANDARD' | 'EXACT' | 'PREMIUM' | 'MORTGAGE' | 'MORTGAGE_MATCH';
/** The evidence behind a price, as the server states it. */
export type LeadPriceReason = 'MORTGAGE_INTEREST' | 'SEARCH_MATCH' | 'EXACT_SEARCH_MATCH' | 'HIGH_BUDGET';

export interface LeadPrices {
  STANDARD: number; EXACT: number; PREMIUM: number; MORTGAGE: number; MORTGAGE_MATCH: number;
  active: boolean; mortgageActive?: boolean; mortgageMatchActive?: boolean;
}

/** What a Home Financing opt-in lets Matching say about the member (never the calculation itself). */
export interface MortgageSignals {
  calculatorUse: 'ONCE' | 'REPEATED';
  /** YYYY-MM of the latest calculator use. */
  lastUseMonth: string | null;
  /** They calculated a mortgage for this very listing. */
  thisListing: boolean;
}

/** Why HOMATCH matched this person with the listing — measured and stated evidence only. */
export interface LeadExplanation {
  geo?: {
    level?: 'EXACT_AREA' | 'NEARBY_AREA' | 'CITY_WIDE' | 'OTHER_AREA';
    demandPlace?: string | null; supplyPlace?: string | null; km?: number | null;
    samples?: [number, number] | null; priceLevelRatio?: number | null; streetMentioned?: boolean;
  };
  budget?: {
    verdict?: 'WITHIN' | 'BELOW_MIN_TOLERANCE' | 'ABOVE_MAX_TOLERANCE' | 'UNKNOWN';
    outsideBy?: number | null; tolerance?: number | null; currency?: string | null; flexible?: boolean;
  };
  similarity?: {
    agreed?: string[]; preferenceMisses?: string[]; unknown?: string[];
    renovation?: 'AGREE' | 'CONFLICT' | 'UNKNOWN'; buildingStatus?: 'AGREE' | 'CONFLICT' | 'UNKNOWN';
    amenities?: { agreed?: string[]; conflicted?: string[]; unknown?: string[] };
  };
  uncertainty?: string[];
}

/** The owner's controls for one listing (free, instant; applied on the server). */
export interface MatchPreferences {
  nearbyEnabled: boolean;
  nearbyKm: number;
  maxNearbyKm: number;
  budgetTolerance: boolean;
  similarEnabled: boolean;
  similarAvailable: boolean;
  cityWideEnabled: boolean;
  saleBands: { upTo: number | null; tolerance: number }[];
  bandsCurrency: string;
  rentTolerancePct: number;
}

export interface LeadItem {
  matchId: string;
  score: number;
  band: LeadBand;
  segment: LeadSegment;
  priceCredits: number;
  unlocked: boolean;
  contacted: boolean;
  crmStatus: string | null;
  crmEntryId: string | null;
  saved: boolean;
  fresh: boolean;
  transaction: 'SALE' | 'RENT';
  intentType: string | null;
  propertyTypes: string[];
  locations: { city: string | null; district: string | null; neighborhoods: string[] };
  budget: { min: number | null; max: number | null; currency: string | null } | null;
  requirements: { bedroomsMin?: number; bedroomsMax?: number; roomsMin?: number; roomsMax?: number; areaMin?: number; areaMax?: number };
  agreed: string[];
  conflicted: string[];
  unknown: string[];
  demandAt: string | null;
  matchedAt: string | null;
  updatedAt: string | null;
  contactOptions: { message: boolean; phone: boolean; email: boolean };
  /** Find Buyers 2.0 (feed v2); absent from the v1 feed. */
  searcher?: LeadSearcher | null;
  /** No search activity for 45 days. */
  stale?: boolean;
  /** The member's last search activity for this demand. */
  activeAt?: string | null;
  /** Stated features (structured keys only, never free text). */
  features?: Record<string, unknown>;
  /** Smart match expansion (feed v2 after the expansion migration). */
  category?: LeadCategory;
  kind?: LeadKind;
  confidence?: LeadConfidence;
  explanation?: LeadExplanation;
  priceKey?: LeadPriceKey;
  /** Where the evidence for this person came from. */
  origin?: 'MORTGAGE' | 'SEARCH' | 'MORTGAGE_AND_SEARCH';
  /** Why this price: the signals the server counted. */
  priceReasons?: LeadPriceReason[];
  mortgage?: MortgageSignals | null;
  /** Only once unlocked. */
  displayName: string | null;
  language: string | null;
}

export type LeadCounts = Record<LeadFilter, number>;

export interface LeadFeed {
  total: number;
  counts: LeadCounts;
  prices: LeadPrices;
  lastSeenAt: string | null;
  items: LeadItem[];
  /** Values present in this property's matches, for the location / type filters. */
  facets: { districts: string[]; propertyTypes: string[] };
  /** The owner's expansion controls for this listing; null before the expansion migration. */
  preferences: MatchPreferences | null;
}

/** Find Buyers 2.0: several filters at once, plus location and property type (all server-side). */
export interface LeadQuery {
  filters: LeadFilter[];
  sort: LeadSort;
  district?: string | null;
  propertyType?: string | null;
  page: number;
}

export const LEAD_PAGE_SIZE = 24;

const EMPTY_COUNTS: LeadCounts = {
  ALL: 0, STRONG: 0, POTENTIAL: 0, STANDARD: 0, PREMIUM: 0, MORTGAGE: 0, FRESH: 0, UNLOCKED: 0, CONTACTED: 0, SAVED: 0,
  LOCKED: 0, DIRECT: 0, BROKER: 0, STALE: 0, ACTIVE: 0, EXACT: 0, NEARBY: 0, VIP: 0, HIGH_CONFIDENCE: 0,
};

/** Defaults shown until the server answers: the owner's prices (2026-10-18). */
export const DEFAULT_LEAD_PRICES: LeadPrices = { STANDARD: 3, EXACT: 5, PREMIUM: 10, MORTGAGE: 3, MORTGAGE_MATCH: 5, active: false };

function normalizePreferences(raw: unknown): MatchPreferences | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    nearbyEnabled: r.nearbyEnabled !== false,
    nearbyKm: n(r.nearbyKm, 2.5),
    maxNearbyKm: n(r.maxNearbyKm, 2.5),
    budgetTolerance: r.budgetTolerance !== false,
    similarEnabled: r.similarEnabled !== false,
    similarAvailable: r.similarAvailable !== false,
    cityWideEnabled: r.cityWideEnabled !== false,
    saleBands: Array.isArray(r.saleBands) ? (r.saleBands as Array<Record<string, unknown>>).map((b) => ({
      upTo: b.upTo == null ? null : Number(b.upTo), tolerance: Number(b.tolerance ?? 0),
    })) : [],
    bandsCurrency: typeof r.bandsCurrency === 'string' ? r.bandsCurrency : 'USD',
    rentTolerancePct: n(r.rentTolerancePct, 0),
  };
}


function normalizeFeed(data: unknown): LeadFeed {
  const feed = (data ?? {}) as Partial<LeadFeed> & { facets?: Partial<LeadFeed['facets']> };
  return {
    total: Number(feed.total ?? 0),
    counts: { ...EMPTY_COUNTS, ...(feed.counts ?? {}) },
    prices: { ...DEFAULT_LEAD_PRICES, ...(feed.prices ?? {}) },
    lastSeenAt: feed.lastSeenAt ?? null,
    items: (feed.items ?? []) as LeadItem[],
    facets: {
      districts: Array.isArray(feed.facets?.districts) ? feed.facets!.districts!.map(String) : [],
      propertyTypes: Array.isArray(feed.facets?.propertyTypes) ? feed.facets!.propertyTypes!.map(String) : [],
    },
    preferences: normalizePreferences((feed as { preferences?: unknown }).preferences),
  };
}

/** Change the owner's expansion controls for a listing; returns what the server stored. */
export async function setMatchPreferences(propertyId: string, patch: Partial<Pick<MatchPreferences,
  'nearbyEnabled' | 'nearbyKm' | 'budgetTolerance' | 'similarEnabled' | 'cityWideEnabled'>>): Promise<MatchPreferences | null> {
  const { data, error } = await supabase.rpc('internal_match_preferences_set', { p_property_id: propertyId, p: patch });
  if (missingFunction(error)) return null;
  if (error) throw error;
  return normalizePreferences(data);
}

/** A function this deployment's database does not have yet (migration pending). */
const missingFunction = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message ?? ''));

/**
 * The free, anonymised feed with server-side filters (internal_leads_feed_v2). Falls back to
 * the v1 feed (one filter) while the v2 function is not deployed.
 */
export async function getLeadFeedV2(propertyId: string, q: LeadQuery): Promise<LeadFeed> {
  const filters = q.filters.filter((f) => f !== 'ALL');
  const { data, error } = await supabase.rpc('internal_leads_feed_v2', {
    p_property_id: propertyId,
    p: {
      filters, sort: q.sort, district: q.district ?? null, propertyType: q.propertyType ?? null,
      limit: LEAD_PAGE_SIZE, offset: Math.max(0, q.page) * LEAD_PAGE_SIZE,
    },
  });
  if (missingFunction(error)) return getLeadFeed(propertyId, filters[0] ?? 'ALL', q.sort === 'ACTIVE' ? 'UPDATED' : q.sort === 'CATEGORY' ? 'BEST' : q.sort, q.page);
  if (error) throw error;
  return normalizeFeed(data);
}

export interface MatchStatus {
  /** The listing is waiting for, or inside, a matcher run. */
  queued: boolean;
  scanning: boolean;
  retrying: boolean;
  /** Active HOMATCH member searches it is compared with (a count, never who). */
  activeSearches: number;
  /** Eligible matches right now. */
  matches: number;
  checkedAt: string;
}

/** The real matcher's state for this listing (free; owner only). Null when not deployed yet. */
export async function getMatchStatus(propertyId: string): Promise<MatchStatus | null> {
  const { data, error } = await supabase.rpc('internal_leads_match_status', { p_property_id: propertyId });
  if (missingFunction(error)) return null;
  if (error) throw error;
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    queued: d.queued === true, scanning: d.scanning === true, retrying: d.retrying === true,
    activeSearches: Number(d.activeSearches ?? 0), matches: Number(d.matches ?? 0), checkedAt: String(d.checkedAt ?? new Date().toISOString()),
  };
}

export async function getLeadFeed(propertyId: string, filter: LeadFilter, sort: LeadSort, page: number): Promise<LeadFeed> {
  const { data, error } = await supabase.rpc('internal_leads_feed', {
    p_property_id: propertyId, p_filter: filter, p_sort: sort,
    p_limit: LEAD_PAGE_SIZE, p_offset: Math.max(0, page) * LEAD_PAGE_SIZE,
  });
  if (error) throw error;
  return normalizeFeed(data);
}

export async function toggleLeadSaved(matchId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('internal_lead_toggle_saved', { p_match_id: matchId });
  if (error) throw error;
  return Boolean(data);
}

export async function markLeadsSeen(propertyId: string): Promise<void> {
  await supabase.rpc('internal_leads_mark_seen', { p_property_id: propertyId });
}

/** Ask the matcher to evaluate this listing against every active HOMATCH search now. */
export async function requestLeadMatching(propertyId: string): Promise<void> {
  const { error } = await supabase.rpc('internal_leads_request_matching', { p_property_id: propertyId });
  if (error) throw new Error(error.message);
}

export interface UnlockQuote {
  requested: number;
  eligible: number;
  alreadyUnlocked: number;
  standardCount: number;
  exactCount: number;
  premiumCount: number;
  mortgageCount: number;
  mortgageMatchCount: number;
  standardCredits: number;
  exactCredits: number;
  premiumCredits: number;
  mortgageCredits: number;
  mortgageMatchCredits: number;
  totalCredits: number;
  balance: number | null;
  prices: LeadPrices;
}

export async function quoteUnlock(matchIds: string[]): Promise<UnlockQuote> {
  const { data, error } = await supabase.rpc('internal_leads_unlock_quote', { p_match_ids: matchIds });
  if (error) throw error;
  const q = (data ?? {}) as Partial<UnlockQuote>;
  return {
    requested: Number(q.requested ?? matchIds.length), eligible: Number(q.eligible ?? 0),
    alreadyUnlocked: Number(q.alreadyUnlocked ?? 0), standardCount: Number(q.standardCount ?? 0),
    exactCount: Number(q.exactCount ?? 0), exactCredits: Number(q.exactCredits ?? 0),
    premiumCount: Number(q.premiumCount ?? 0), standardCredits: Number(q.standardCredits ?? 0),
    premiumCredits: Number(q.premiumCredits ?? 0), totalCredits: Number(q.totalCredits ?? 0),
    mortgageCount: Number(q.mortgageCount ?? 0), mortgageCredits: Number(q.mortgageCredits ?? 0),
    mortgageMatchCount: Number(q.mortgageMatchCount ?? 0), mortgageMatchCredits: Number(q.mortgageMatchCredits ?? 0),
    balance: q.balance == null ? null : Number(q.balance),
    prices: { ...DEFAULT_LEAD_PRICES, ...(q.prices ?? {}) },
  };
}

export interface UnlockResult {
  unlocked: string[];
  alreadyUnlocked: string[];
  skipped: string[];
  chargedCredits: number;
  balanceAfter: number | null;
  duplicate: boolean;
}

export class UnlockError extends Error {
  constructor(public code: string) { super(code); }
}

/** A fresh key per confirmed click; the same key is reused if that click is retried. */
export function newUnlockKey(): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `ilu:${rnd}`;
}

/** expectedCredits: the total the customer saw in the quote; the server refuses anything higher (PRICE_CHANGED). */
export async function unlockLeads(matchIds: string[], idempotencyKey: string, expectedCredits?: number): Promise<UnlockResult> {
  const { data, error } = await supabase.functions.invoke('atomic-unlock', {
    body: { kind: 'internal_leads', matchIds, idempotencyKey, ...(expectedCredits === undefined ? {} : { expectedCredits }) },
  });
  if (error) {
    let code = 'INTERNAL';
    try {
      const body = await (error as { context?: Response }).context?.json?.();
      if (body && typeof body.error === 'string') code = body.error;
    } catch { /* keep INTERNAL */ }
    throw new UnlockError(code);
  }
  const r = (data ?? {}) as Partial<UnlockResult>;
  return {
    unlocked: (r.unlocked ?? []) as string[], alreadyUnlocked: (r.alreadyUnlocked ?? []) as string[],
    skipped: (r.skipped ?? []) as string[], chargedCredits: Number(r.chargedCredits ?? 0),
    balanceAfter: r.balanceAfter == null ? null : Number(r.balanceAfter), duplicate: Boolean(r.duplicate),
  };
}

export interface LeadContact {
  restricted: boolean;
  reason?: 'BLOCKED' | 'NOT_ACCEPTING_OFFERS' | 'UNAVAILABLE';
  displayName?: string | null;
  language?: string | null;
  canMessage?: boolean;
  phone?: string | null;
  email?: string | null;
  marketingEmail?: boolean;
}

/** The phone the member allows the owner to see today, or null (restricted / not shared). */
export function permittedPhone(contact: LeadContact | null): string | null {
  return contact && !contact.restricted ? contact.phone ?? null : null;
}

export async function getLeadContact(matchId: string): Promise<LeadContact> {
  const { data, error } = await supabase.rpc('internal_lead_contact', { p_match_id: matchId });
  if (error) throw error;
  return (data ?? { restricted: true }) as LeadContact;
}

export async function openLeadConversation(matchId: string): Promise<string> {
  const { data, error } = await supabase.rpc('internal_lead_open_conversation', { p_match_id: matchId });
  if (error) {
    if (String(error.message ?? '').includes('RATE_LIMITED')) throw new UnlockError('RATE_LIMITED');
    throw error;
  }
  return String(data);
}

/* ── Research budget (external research; credits, never dollars) ─────────── */

/** A paid research campaign starts at exactly 50 credits = $5 (owner, 2026-10-19; paidDiscoveryPolicy). */
export const RESEARCH_PRESETS = [50, 100, 500, 1000, 1500, 2000] as const;
export const RESEARCH_MIN_CREDITS = 50;

export interface ResearchBudget {
  jobId: string;
  totalCredits: number;
  finished: boolean;
  presets: number[];
  maxCredits: number;
  balance: number | null;
  extensions: Array<{ additionalCredits: number; totalAfterCredits: number; status: string; settledCredits: number | null; createdAt: string }>;
}

export async function getResearchBudget(jobId: string): Promise<ResearchBudget> {
  const { data, error } = await supabase.rpc('find_buyers_research_budget', { p_job_id: jobId });
  if (error) throw error;
  const b = (data ?? {}) as Partial<ResearchBudget>;
  return {
    jobId, totalCredits: Number(b.totalCredits ?? 0), finished: Boolean(b.finished),
    presets: Array.isArray(b.presets) ? b.presets.map(Number) : [...RESEARCH_PRESETS],
    maxCredits: Number(b.maxCredits ?? 100000), balance: b.balance == null ? null : Number(b.balance),
    extensions: (b.extensions ?? []) as ResearchBudget['extensions'],
  };
}

export async function extendResearchBudget(propertyId: string, jobId: string, totalCredits: number, idempotencyKey: string) {
  const { data, error } = await supabase.functions.invoke('match-campaign', {
    body: { propertyId, jobId, action: 'extend_budget', totalCredits, idempotencyKey },
  });
  if (error) {
    let code = 'REFUSED';
    try {
      const body = await (error as { context?: Response }).context?.json?.();
      if (body && typeof body.reasonCode === 'string') code = body.reasonCode;
    } catch { /* keep REFUSED */ }
    throw new UnlockError(code);
  }
  return data as { totalCredits: number; additionalCredits: number; duplicate: boolean };
}
