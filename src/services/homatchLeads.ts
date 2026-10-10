/*
 * HOMATCH LEADS — the internal matching marketplace, from the owner's side.
 *
 * Browsing is free and anonymised: internal_leads_feed returns requirements, the
 * engine's agreement and price, never who the member is. matchId (a supply_matches
 * id) is the only handle the browser holds; every call resolves the member on the
 * server. The one paid action — unlocking — goes through atomic-unlock (service role,
 * idempotent, all-or-nothing); everything after an unlock (contact, conversation)
 * is re-checked against what the member allows on every read.
 */

import { supabase } from '@/db/supabase';

export type LeadFilter = 'ALL' | 'STRONG' | 'POTENTIAL' | 'STANDARD' | 'PREMIUM' | 'FRESH' | 'UNLOCKED' | 'CONTACTED' | 'SAVED';
export type LeadSort = 'BEST' | 'NEWEST' | 'UPDATED' | 'BUDGET_DESC' | 'BUDGET_ASC';
export type LeadSegment = 'STANDARD' | 'PREMIUM';
export type LeadBand = 'STRONG' | 'POTENTIAL' | 'WEAK';

export interface LeadPrices { STANDARD: number; PREMIUM: number; active: boolean }

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
}

export const LEAD_PAGE_SIZE = 24;

export async function getLeadFeed(propertyId: string, filter: LeadFilter, sort: LeadSort, page: number): Promise<LeadFeed> {
  const { data, error } = await supabase.rpc('internal_leads_feed', {
    p_property_id: propertyId, p_filter: filter, p_sort: sort,
    p_limit: LEAD_PAGE_SIZE, p_offset: Math.max(0, page) * LEAD_PAGE_SIZE,
  });
  if (error) throw error;
  const feed = (data ?? {}) as Partial<LeadFeed>;
  return {
    total: Number(feed.total ?? 0),
    counts: { ALL: 0, STRONG: 0, POTENTIAL: 0, STANDARD: 0, PREMIUM: 0, FRESH: 0, UNLOCKED: 0, CONTACTED: 0, SAVED: 0, ...(feed.counts ?? {}) },
    prices: { STANDARD: 2.5, PREMIUM: 6, active: false, ...(feed.prices ?? {}) },
    lastSeenAt: feed.lastSeenAt ?? null,
    items: (feed.items ?? []) as LeadItem[],
  };
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
  await supabase.rpc('internal_leads_request_matching', { p_property_id: propertyId });
}

export interface UnlockQuote {
  requested: number;
  eligible: number;
  alreadyUnlocked: number;
  standardCount: number;
  premiumCount: number;
  standardCredits: number;
  premiumCredits: number;
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
    premiumCount: Number(q.premiumCount ?? 0), standardCredits: Number(q.standardCredits ?? 0),
    premiumCredits: Number(q.premiumCredits ?? 0), totalCredits: Number(q.totalCredits ?? 0),
    balance: q.balance == null ? null : Number(q.balance),
    prices: { STANDARD: 2.5, PREMIUM: 6, active: false, ...(q.prices ?? {}) },
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

export async function unlockLeads(matchIds: string[], idempotencyKey: string): Promise<UnlockResult> {
  const { data, error } = await supabase.functions.invoke('atomic-unlock', {
    body: { kind: 'internal_leads', matchIds, idempotencyKey },
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

export const RESEARCH_PRESETS = [100, 500, 1000, 1500, 2000] as const;
export const RESEARCH_MIN_CREDITS = 100;

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
