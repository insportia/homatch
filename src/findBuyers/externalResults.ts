// External Discovery results, as the owner reads them (Find Buyers 3.0, 2026-10-15).
//
// Three result types, never mixed in one count:
//   DIRECT       a person who stated their own purchase / rental intent;
//   INTEREST     a person who asked a meaningful question about a comparable listing;
//   OPPORTUNITY  a comparable post whose audience shows interest — post-level, built
//                from its INTEREST signals. One post is ONE opportunity, however many
//                comments it has; nothing is extrapolated from the comments not read.
//
// Leads stored before the intent gate carry no `qualification.resultType`: they are
// classified on read with the same pure gate (buyerIntent.ts), from their own evidence.
// Pure: no imports from the app, so tests/matrix can load it directly.

import { classifyBuyerIntent, type CommentSignal, type ResultType } from '../research-core/findBuyers/buyerIntent.ts';
import { classifyDemand } from '../research-core/findBuyers/demandClassifier.ts';

export interface EvidenceItem {
  signalId?: string;
  kind?: 'POST' | 'COMMENT' | 'MESSAGE';
  source?: string;
  similarity?: number;
  text?: string;
  url?: string | null;
  parentUrl?: string | null;
  parentExcerpt?: string | null;
  publishedAt?: string | null;
  language?: string | null;
  parentCommentCount?: number | null;
  parentAnalyzed?: number | null;
  parentPublishedAt?: string | null;
  parentFacts?: { price: number | null; currency: string | null; areaSqm: number | null; bedrooms: number | null; district: string | null } | null;
  intent?: string | null;
  signals?: string[];
  /** Facebook: found in a GROUP, on a public PAGE, or by a keyword SEARCH of public posts. */
  sourceKind?: 'GROUP' | 'PAGE' | 'SEARCH' | null;
}

/** The label key for where a result was found (null: the network name is enough). */
export function sourceKindKey(kind: string | null | undefined): string | null {
  return kind === 'GROUP' ? 'fbx_source_group' : kind === 'PAGE' ? 'fbx_source_page' : kind === 'SEARCH' ? 'fbx_source_search'
    : kind === 'AD' ? 'fbx_source_ad' : null;
}

export interface ResultLead {
  id: string;
  matching_job_id: string;
  source: string;
  overall_score: number;
  created_at: string;
  signal_at: string | null;
  author_name: string | null;
  author_profile_url?: string | null;
  evidence: EvidenceItem[];
  /** `why.agreed`: the similarity dimensions that agreed with the owner's listing (pipeline). */
  score_components?: { why?: { agreed?: string[] | null } | null } | null;
  match_category?: string | null;
  counterpart?: 'BUYER' | 'TENANT' | null;
  qualification?: { resultType?: ResultType; intent?: string; signals?: string[]; limitations?: string[] | null } | null;
  /** The language the person wrote in (lead level), for the language filter. */
  language?: string | null;
  /** Qualification role (SALE_OFFER, AGENT …) when the database has the column; absent on older reads. */
  role?: string | null;
  transaction?: string | null;
  qualification_version?: number | string | null;
}

export interface ClassifiedLead extends ResultLead {
  resultType: ResultType;
  intent: string;
  signals: CommentSignal[];
}

/**
 * The lead's type: the stored gate result, or the same gate run on its own evidence.
 * `market` is the owner's listing (SALE / RENT): a tenant is never a buyer for a sale,
 * nor a buyer a tenant for a rental — such a reading is EXCLUDED (wrong market).
 */
export function classifyLead(lead: ResultLead, market: 'SALE' | 'RENT' | null = null): ClassifiedLead {
  const out = classifyStored(lead);
  const wrongMarket = out.resultType === 'DIRECT'
    && ((market === 'SALE' && out.intent === 'ACTIVE_TENANT') || (market === 'RENT' && out.intent === 'ACTIVE_BUYER'));
  return wrongMarket ? { ...out, resultType: 'EXCLUDED' } : out;
}

function classifyStored(lead: ResultLead): ClassifiedLead {
  const q = lead.qualification;
  if (q?.resultType) {
    return { ...lead, resultType: q.resultType, intent: q.intent ?? 'UNKNOWN', signals: (q.signals ?? []) as CommentSignal[] };
  }
  const ev = lead.evidence[0];
  const kind = ev?.kind ?? 'POST';
  const parentRole = ev?.parentExcerpt ? classifyDemand(ev.parentExcerpt).role : null;
  const r = classifyBuyerIntent({ text: ev?.text ?? '', kind, parent: kind === 'COMMENT' ? { role: parentRole, similarity: ev?.similarity ?? 0 } : null });
  /* A lead the pipeline already qualified (a category, possibly with the model's help)
     keeps that decision unless the rules find a definite exclusion — the rules alone
     reading "unknown" never overturns it. Never-qualified legacy leads get no such pass. */
  const qualified = ['STRONG', 'POTENTIAL', 'WEAK'].includes(String(lead.match_category ?? ''));
  if (r.resultType === 'EXCLUDED' && r.intent === 'UNKNOWN' && qualified) {
    return { ...lead, resultType: 'DIRECT', intent: lead.counterpart === 'TENANT' ? 'ACTIVE_TENANT' : 'ACTIVE_BUYER', signals: r.signals };
  }
  return { ...lead, resultType: r.resultType, intent: r.intent, signals: r.signals };
}

export interface ResultCounts { direct: number; interest: number; opportunities: number; excluded: number }

export interface OwnerFacts { price: number | null; currency: string | null; areaSqm: number | null; bedrooms: number | null; district: string | null; market?: 'SALE' | 'RENT' | null }

type FactsRow = { total_price?: number | string | null; currency?: string | null; area?: number | string | null; bedrooms?: number | string | null; district?: string | null };

/** The owner's listing facts (property_facts, embedded as an object or a one-row array). */
export function ownerFactsOf(facts: FactsRow | FactsRow[] | null | undefined, transactionType?: string | null): OwnerFacts | null {
  const f = Array.isArray(facts) ? facts[0] : facts;
  const market = /rent|lease/i.test(String(transactionType ?? '')) ? 'RENT' : transactionType ? 'SALE' : null;
  if (!f) return market ? { price: null, currency: null, areaSqm: null, bedrooms: null, district: null, market } : null;
  const num = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  return { price: num(f.total_price), currency: f.currency ?? null, areaSqm: num(f.area), bedrooms: num(f.bedrooms), district: f.district ?? null, market };
}

export interface PriceComparison {
  /** Owner price minus comparable price (same currency only). Negative = owner is cheaper. */
  difference: number;
  currency: string;
  ownerPerSqm: number | null;
  comparablePerSqm: number | null;
}

export interface PostOpportunity {
  key: string;
  jobId: string;
  url: string;
  platform: string;
  /** Where the post was found (GROUP / PAGE / SEARCH); null when not recorded. */
  sourceKind: EvidenceItem['sourceKind'];
  excerpt: string | null;
  /** Total comments the platform reported for the post; null when it did not report one. */
  totalComments: number | null;
  /** Comments of the post that HOMATCH actually read (largest run); null when not recorded. */
  analyzedComments: number | null;
  /** People with an interest signal (one per lead: leads are per person). */
  interestedPeople: number;
  /** Signals across those people's comments: one comment can carry several. */
  signalTotal: number;
  breakdown: Partial<Record<CommentSignal, number>>;
  latestCommentAt: string | null;
  postPublishedAt: string | null;
  similarity: number;
  /** Dimensions the pipeline found in agreement (location, rooms, area, price, propertyType, transaction). */
  agreed: string[];
  facts: EvidenceItem['parentFacts'];
  comparison: PriceComparison | null;
  /** 0–100: similarity and the strength of the interest shown, both visible. */
  opportunityScore: number;
  intentScore: number;
  leads: ClassifiedLead[];
}

const SIGNAL_WEIGHT: Partial<Record<CommentSignal, number>> = {
  VIEWING: 30, NEGOTIATION: 22, FINANCING: 22, EXPLICIT_BUY: 35, EXPLICIT_RENT: 35, AVAILABILITY: 15, PRICE: 12, LOCATION: 10, PARKING_AMENITIES: 10,
};

/** A short, stable key for a post URL (route-safe). */
export function postKey(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i += 1) h = ((h << 5) + h + url.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Placeholder names some platforms return for hidden profiles: never a way to merge people. */
const GENERIC_NAME = /^(facebook user|instagram user|anonymous|unknown|user|deleted account|участник|аноним|მომხმარებელი)$/iu;
const personKey = (l: ResultLead): string | null => {
  if (l.author_profile_url) return `p:${l.author_profile_url.toLowerCase()}`;
  const name = l.author_name?.trim().toLowerCase();
  return name && !GENERIC_NAME.test(name) ? `n:${l.source}:${name}` : null;
};
const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

export function comparePrice(owner: OwnerFacts | null, facts: EvidenceItem['parentFacts']): PriceComparison | null {
  if (!owner?.price || !facts?.price || !owner.currency || !facts.currency) return null;
  if (owner.currency.toUpperCase() !== facts.currency.toUpperCase()) return null;
  return {
    difference: owner.price - facts.price,
    currency: owner.currency.toUpperCase(),
    ownerPerSqm: owner.areaSqm ? Math.round(owner.price / owner.areaSqm) : null,
    comparablePerSqm: facts.areaSqm ? Math.round(facts.price / facts.areaSqm) : null,
  };
}

/** Group INTEREST leads by the post they were found under; strongest opportunity first. */
export function buildOpportunities(leads: ClassifiedLead[], owner: OwnerFacts | null): PostOpportunity[] {
  const byPost = new Map<string, PostOpportunity>();
  for (const lead of leads) {
    if (lead.resultType !== 'INTEREST') continue;
    for (const ev of lead.evidence) {
      if (!ev.parentUrl) continue;
      const key = postKey(ev.parentUrl);
      const op = byPost.get(key) ?? {
        key, jobId: lead.matching_job_id, url: ev.parentUrl, platform: ev.source ?? lead.source, sourceKind: ev.sourceKind ?? null, excerpt: ev.parentExcerpt ?? null,
        totalComments: null, analyzedComments: null, interestedPeople: 0, signalTotal: 0, breakdown: {},
        latestCommentAt: null, postPublishedAt: null, similarity: 0, agreed: [], facts: null, comparison: null, opportunityScore: 0, intentScore: 0, leads: [],
      };
      if (!op.leads.includes(lead)) {
        /* One person, once per post: the same commenter stored twice (profile, else name on that
           platform) is never two people. Without either, the lead is its own person. */
        const who = personKey(lead);
        if (!who || !op.leads.some((l) => personKey(l) === who)) op.interestedPeople += 1;
        op.leads.push(lead);
        for (const d of lead.score_components?.why?.agreed ?? []) if (!op.agreed.includes(d)) op.agreed.push(d);
      }
      const sigs = ((ev.signals?.length ? ev.signals : lead.signals) as CommentSignal[]).filter((s) => s !== 'IRRELEVANT' && s !== 'POSITIVE');
      for (const s of sigs) { op.breakdown[s] = (op.breakdown[s] ?? 0) + 1; op.signalTotal += 1; }
      if (ev.parentCommentCount != null) op.totalComments = Math.max(op.totalComments ?? 0, ev.parentCommentCount);
      if (ev.parentAnalyzed != null) op.analyzedComments = Math.max(op.analyzedComments ?? 0, ev.parentAnalyzed);
      op.latestCommentAt = later(op.latestCommentAt, ev.publishedAt ?? null);
      op.postPublishedAt = op.postPublishedAt ?? ev.parentPublishedAt ?? null;
      op.similarity = Math.max(op.similarity, ev.similarity ?? 0);
      op.facts = op.facts ?? ev.parentFacts ?? null;
      byPost.set(key, op);
    }
  }
  for (const op of byPost.values()) {
    /* Analyzed can never exceed what the platform reported. */
    if (op.totalComments != null && op.analyzedComments != null) op.analyzedComments = Math.min(op.analyzedComments, op.totalComments);
    op.comparison = comparePrice(owner, op.facts);
    const weight = Object.entries(op.breakdown).reduce((n, [s, c]) => n + (SIGNAL_WEIGHT[s as CommentSignal] ?? 0) * (c ?? 0), 0);
    op.intentScore = Math.min(100, weight);
    op.opportunityScore = Math.round(0.5 * Math.min(100, op.similarity) + 0.5 * op.intentScore);
  }
  return [...byPost.values()].sort((a, b) => b.opportunityScore - a.opportunityScore || (b.latestCommentAt ?? '').localeCompare(a.latestCommentAt ?? ''));
}

export function countResults(leads: ClassifiedLead[], opportunities: PostOpportunity[]): ResultCounts {
  return {
    direct: leads.filter((l) => l.resultType === 'DIRECT').length,
    interest: leads.filter((l) => l.resultType === 'INTEREST').length,
    opportunities: opportunities.length,
    excluded: leads.filter((l) => l.resultType === 'EXCLUDED').length,
  };
}

export type FreshnessBucket = 'TODAY' | 'WEEK' | 'MONTH' | 'OLDER' | 'UNKNOWN';

/** How fresh a timestamp is; UNKNOWN when there is none (never assumed fresh). */
export function freshnessOf(iso: string | null | undefined, now = Date.now()): FreshnessBucket {
  if (!iso) return 'UNKNOWN';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'UNKNOWN';
  const days = (now - t) / 86400000;
  return days < 1 ? 'TODAY' : days <= 7 ? 'WEEK' : days <= 30 ? 'MONTH' : 'OLDER';
}

/** Whole days since a timestamp, or null when unknown. */
export function daysAgo(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86400000)) : null;
}

/* ── THE THREE TABS (owner, 2026-10-16) ──────────────────────────────────────
 *   direct         Buyers / Tenants: people who stated their own intent AND whose
 *                  match review placed them STRONG or POTENTIAL;
 *   interest       Interested people: questions under comparable listings, plus
 *                  direct requests the review rated WEAK or has not reviewed yet —
 *                  those carry "needs verification", never a buyer label;
 *   opportunities  Research opportunities: post-level, built separately.
 * Sellers, brokers, developers, services and job posts never appear: the gate
 * EXCLUDES them, match review REJECTS them, and a stored offer role drops them. */
export type ResultTab = 'direct' | 'interest' | 'opportunities';
export interface TabPlacement { tab: 'direct' | 'interest'; needsVerification: boolean }

const OFFER_ROLES = new Set(['SALE_OFFER', 'RENT_OFFER', 'AGENT', 'SERVICE', 'JOB']);

/** Where a lead is listed, or null when it is never listed. */
export function placeLead(l: ClassifiedLead): TabPlacement | null {
  if (l.resultType === 'EXCLUDED') return null;
  if (l.role && OFFER_ROLES.has(String(l.role).toUpperCase())) return null;
  const cat = l.match_category ?? null;
  if (cat === 'REJECTED') return null;
  if (l.resultType === 'DIRECT') {
    return cat === 'STRONG' || cat === 'POTENTIAL' ? { tab: 'direct', needsVerification: false } : { tab: 'interest', needsVerification: true };
  }
  return { tab: 'interest', needsVerification: false };
}

/** Leads that may be listed at all (the opportunities are built only from these). */
export function listableLeads<T extends ClassifiedLead>(leads: T[]): T[] {
  return leads.filter((l) => placeLead(l) !== null);
}

/* ── RESEARCH OPPORTUNITIES ───────────────────────────────────────────────── */

export type CommentsState = 'NOT_INSPECTED' | 'INSPECTED' | 'UNAVAILABLE';

/** One row of find_buyers_research_opportunities(p_job_id). */
export interface ResearchOpportunityRow {
  signal_id: string;
  url: string;
  excerpt: string | null;
  author_name: string | null;
  published_at: string | null;
  language: string | null;
  similarity: number;
  reported_comments: number | null;
  comments_state: CommentsState;
  interested_count: number;
  source: string;
  source_kind: 'GROUP' | 'PAGE' | 'AD' | null;
  competitor: boolean;
}

/** Rows the screen can trust: a web URL and a known comments state; anything else is dropped. */
export function parseResearchRows(data: unknown): ResearchOpportunityRow[] {
  if (!Array.isArray(data)) return [];
  const out: ResearchOpportunityRow[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const url = typeof r.url === 'string' ? r.url.trim() : '';
    if (!/^https?:\/\//i.test(url)) continue;
    const state = ['NOT_INSPECTED', 'INSPECTED', 'UNAVAILABLE'].includes(String(r.comments_state)) ? (r.comments_state as CommentsState) : 'NOT_INSPECTED';
    const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    const kind = ['GROUP', 'PAGE', 'AD'].includes(String(r.source_kind)) ? (r.source_kind as 'GROUP' | 'PAGE' | 'AD') : null;
    out.push({
      signal_id: String(r.signal_id ?? url), url,
      excerpt: typeof r.excerpt === 'string' && r.excerpt.trim() ? r.excerpt : null,
      author_name: typeof r.author_name === 'string' ? r.author_name : null,
      published_at: typeof r.published_at === 'string' ? r.published_at : null,
      language: typeof r.language === 'string' ? r.language : null,
      similarity: Math.max(0, Math.min(100, num(r.similarity) ?? 0)),
      reported_comments: num(r.reported_comments),
      comments_state: state,
      interested_count: Math.max(0, num(r.interested_count) ?? 0),
      source: typeof r.source === 'string' && r.source ? r.source.toUpperCase() : 'WEB',
      source_kind: kind,
      competitor: r.competitor === true,
    });
  }
  return out;
}

/** One card in the Research Opportunities tab. */
export interface OpportunityItem {
  key: string;
  url: string;
  platform: string;
  sourceKind: string | null;
  excerpt: string | null;
  language: string | null;
  /** The freshest date known for it (latest comment, else the post). */
  at: string | null;
  similarity: number;
  commentsState: CommentsState;
  /** People found in the comments — only when the comments were actually analysed. */
  interestedCount: number | null;
  reportedComments: number | null;
  competitor: boolean;
  /** Lead-derived: the HOMATCH opportunity page exists for it. */
  post: PostOpportunity | null;
}

/** The same post, however its URL was written (case of the host, a trailing slash, a fragment). */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host.toLowerCase().replace(/^(www|m|mobile)\./, '')}${path}${u.search}`;
  } catch {
    return url.trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}

/**
 * Lead-derived opportunities (their comments WERE read: the interest came from them) and the
 * research rows, one card per post. A post known both ways keeps its HOMATCH page and gains the
 * research row's competitor flag; the interested count is never taken from an uninspected row.
 */
export function mergeOpportunities(fromLeads: PostOpportunity[], rows: ResearchOpportunityRow[]): OpportunityItem[] {
  const out = new Map<string, OpportunityItem>();
  for (const op of fromLeads) {
    const k = normalizeUrl(op.url);
    if (out.has(k)) continue;
    out.set(k, {
      key: op.key, url: op.url, platform: op.platform, sourceKind: op.sourceKind ?? null, excerpt: op.excerpt,
      language: op.leads[0]?.language ?? op.leads[0]?.evidence[0]?.language ?? null,
      at: op.latestCommentAt ?? op.postPublishedAt, similarity: op.similarity, commentsState: 'INSPECTED',
      interestedCount: op.interestedPeople, reportedComments: op.totalComments, competitor: false, post: op,
    });
  }
  for (const r of rows) {
    const k = normalizeUrl(r.url);
    const known = out.get(k);
    if (known) {
      known.competitor = known.competitor || r.competitor;
      if (known.reportedComments == null) known.reportedComments = r.reported_comments;
      continue;
    }
    out.set(k, {
      key: postKey(r.url), url: r.url, platform: r.source, sourceKind: r.source_kind, excerpt: r.excerpt, language: r.language,
      at: r.published_at, similarity: r.similarity, commentsState: r.comments_state,
      interestedCount: r.comments_state === 'INSPECTED' ? r.interested_count : null,
      reportedComments: r.reported_comments, competitor: r.competitor, post: null,
    });
  }
  return [...out.values()];
}

export interface TabCounts { direct: number; interest: number; opportunities: number }

/** Real counts per tab: exactly the cards each tab lists before filters. */
export function tabCounts(leads: ClassifiedLead[], opportunities: OpportunityItem[]): TabCounts {
  let direct = 0; let interest = 0;
  for (const l of leads) {
    const p = placeLead(l);
    if (p?.tab === 'direct') direct += 1; else if (p?.tab === 'interest') interest += 1;
  }
  return { direct, interest, opportunities: opportunities.length };
}
