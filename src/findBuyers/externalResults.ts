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
}

export interface ResultLead {
  id: string;
  matching_job_id: string;
  source: string;
  overall_score: number;
  created_at: string;
  signal_at: string | null;
  author_name: string | null;
  evidence: EvidenceItem[];
  match_category?: string | null;
  qualification?: { resultType?: ResultType; intent?: string; signals?: string[] } | null;
}

export interface ClassifiedLead extends ResultLead {
  resultType: ResultType;
  intent: string;
  signals: CommentSignal[];
}

/** The lead's type: the stored gate result, or the same gate run on its own evidence. */
export function classifyLead(lead: ResultLead): ClassifiedLead {
  const q = lead.qualification;
  if (q?.resultType) {
    return { ...lead, resultType: q.resultType, intent: q.intent ?? 'UNKNOWN', signals: (q.signals ?? []) as CommentSignal[] };
  }
  const ev = lead.evidence[0];
  const kind = ev?.kind ?? 'POST';
  const parentRole = ev?.parentExcerpt ? classifyDemand(ev.parentExcerpt).role : null;
  const r = classifyBuyerIntent({ text: ev?.text ?? '', kind, parent: kind === 'COMMENT' ? { role: parentRole, similarity: ev?.similarity ?? 0 } : null });
  return { ...lead, resultType: r.resultType, intent: r.intent, signals: r.signals };
}

export interface ResultCounts { direct: number; interest: number; opportunities: number; excluded: number }

export interface OwnerFacts { price: number | null; currency: string | null; areaSqm: number | null; bedrooms: number | null; district: string | null }

type FactsRow = { total_price?: number | string | null; currency?: string | null; area?: number | string | null; bedrooms?: number | string | null; district?: string | null };

/** The owner's listing facts (property_facts, embedded as an object or a one-row array). */
export function ownerFactsOf(facts: FactsRow | FactsRow[] | null | undefined): OwnerFacts | null {
  const f = Array.isArray(facts) ? facts[0] : facts;
  if (!f) return null;
  const num = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  return { price: num(f.total_price), currency: f.currency ?? null, areaSqm: num(f.area), bedrooms: num(f.bedrooms), district: f.district ?? null };
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
        key, jobId: lead.matching_job_id, url: ev.parentUrl, platform: ev.source ?? lead.source, excerpt: ev.parentExcerpt ?? null,
        totalComments: null, analyzedComments: null, interestedPeople: 0, signalTotal: 0, breakdown: {},
        latestCommentAt: null, postPublishedAt: null, similarity: 0, facts: null, comparison: null, opportunityScore: 0, intentScore: 0, leads: [],
      };
      if (!op.leads.includes(lead)) { op.leads.push(lead); op.interestedPeople += 1; }
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
