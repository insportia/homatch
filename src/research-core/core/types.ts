// HOMATCH RESEARCH CORE — the shared vocabulary.
//
// WHAT THIS FILE IS, AND WHAT IT DELIBERATELY IS NOT
//
// It is the vocabulary the research infrastructure speaks internally: how work
// is classified, what an observation is, how far from the subject it was
// observed, and on what basis a number was quoted.
//
// It is NOT an evidence model. Homatch already has one — EvidenceItem in
// official-worker/src/evidence/EvidenceTypes.ts, with SourceClass,
// VerificationState and contradiction refs, plus the Provenance/Tier pair in
// src/verify/intelligence/evidencePackage.ts. Those are what the customer
// report is built from and they stay authoritative. A second evidence model
// would mean two answers to "what do we know", one of which nothing reads.
//
// So the type below is called `Observation`, not Evidence, and it is a
// TRANSPORT shape: what one fetch of one source produced, carried far enough
// to be deduped, scored and counted, and then handed to bridge/evidence.ts
// which turns it into a real EvidenceItem. Nothing outside this directory
// should ever see an Observation.

/* ────────────────────────────────────────────────────────────────────────
 * WORK CLASSES
 *
 * The user must not feel the queue. A person waiting on a screen and a
 * backfill crawling a portal are both "research", and scheduling them
 * fairly means starving the person, because the backfill always has more
 * work queued. So the class is part of the request, not a guess made later.
 * ──────────────────────────────────────────────────────────────────────── */

export type WorkClass =
  /** Somebody is watching a spinner and paid for this. */
  | 'INTERACTIVE_HIGH'
  /** Somebody is watching, on the included allowance. */
  | 'INTERACTIVE_NORMAL'
  /** Nobody is waiting: refresh, backfill, scheduled re-check. */
  | 'BACKGROUND'
  /** Opportunistic extra depth. First to be dropped under load. */
  | 'ENRICHMENT';

export const WORK_CLASSES: readonly WorkClass[] = [
  'INTERACTIVE_HIGH',
  'INTERACTIVE_NORMAL',
  'BACKGROUND',
  'ENRICHMENT',
];

export const INTERACTIVE_CLASSES: readonly WorkClass[] = [
  'INTERACTIVE_HIGH',
  'INTERACTIVE_NORMAL',
];

export function isInteractive(workClass: WorkClass): boolean {
  return INTERACTIVE_CLASSES.includes(workClass);
}

/**
 * Map Homatch's billing priority onto a work class.
 *
 * `ExecutionGrant.priorityLevel` already exists and nothing consumes it. This
 * is the consumer. An included-allowance run is still interactive — the
 * customer is still watching — it simply yields to a paid one under pressure.
 */
export function workClassForGrant(input: {
  funding: 'INCLUDED' | 'PAYG' | 'UNAVAILABLE';
  interactive: boolean;
}): WorkClass {
  if (!input.interactive) return 'BACKGROUND';
  return input.funding === 'PAYG' ? 'INTERACTIVE_HIGH' : 'INTERACTIVE_NORMAL';
}

/* ────────────────────────────────────────────────────────────────────────
 * EVIDENCE LEVEL — how far from the subject an observation was made
 *
 * A price seen on the exact unit and a district median are both "evidence
 * about the price", and collapsing them is how a report ends up asserting a
 * number nobody ever quoted for that flat. The level travels with every
 * observation and is never inferred downstream.
 * ──────────────────────────────────────────────────────────────────────── */

export type EvidenceLevel =
  | 'SAME_PROPERTY'
  | 'SAME_BUILDING'
  | 'SAME_PROJECT'
  | 'MICRO_LOCATION'
  | 'DISTRICT'
  | 'COMPARABLE_SEGMENT'
  | 'BROADER_MARKET';

export const EVIDENCE_LEVELS: readonly EvidenceLevel[] = [
  'SAME_PROPERTY',
  'SAME_BUILDING',
  'SAME_PROJECT',
  'MICRO_LOCATION',
  'DISTRICT',
  'COMPARABLE_SEGMENT',
  'BROADER_MARKET',
];

/** Lower is closer to the subject. Used for ordering, never for merging. */
export function evidenceLevelDistance(level: EvidenceLevel): number {
  return EVIDENCE_LEVELS.indexOf(level);
}

/**
 * True when `observed` may stand in for a question asked at `asked`.
 *
 * Deliberately one-directional: a same-building observation answers a
 * district-level question, but a district median NEVER answers a question
 * about one flat. The existing comparable tiers in research-agent
 * (SAME_PROJECT / MICRO_LOCATION / PEER_PROJECT) express the same idea for
 * the Verify report; this is the general form.
 */
export function levelSatisfies(observed: EvidenceLevel, asked: EvidenceLevel): boolean {
  return evidenceLevelDistance(observed) <= evidenceLevelDistance(asked);
}

/* ────────────────────────────────────────────────────────────────────────
 * PRICE BASIS — what a number actually is
 *
 * Asking rent is not achieved rent. A developer's price list is not a
 * transaction. Treating them as interchangeable is the single easiest way to
 * produce an investment yield that is confidently wrong, so the basis is a
 * required field on every money value this core carries, and UNKNOWN is a
 * legal answer that downstream arithmetic must handle rather than a hole to
 * be filled in with the most convenient assumption.
 * ──────────────────────────────────────────────────────────────────────── */

export type PriceBasis =
  /** A listed sale price. What somebody is asking, not what was paid. */
  | 'ASKING_SALE_PRICE'
  /** A recorded/confirmed sale. What was actually paid. */
  | 'TRANSACTION_PRICE'
  /** A developer's own primary-market price or price list. */
  | 'DEVELOPER_PRICE'
  /** A listed rent. What somebody is asking. */
  | 'ASKING_RENT'
  /** A rent actually being paid under a known agreement. */
  | 'ACHIEVED_RENT'
  /** The source did not say, and we will not decide for it. */
  | 'UNKNOWN';

export const PRICE_BASES: readonly PriceBasis[] = [
  'ASKING_SALE_PRICE',
  'TRANSACTION_PRICE',
  'DEVELOPER_PRICE',
  'ASKING_RENT',
  'ACHIEVED_RENT',
  'UNKNOWN',
];

/** Sale-side and rent-side bases answer different questions entirely. */
export function priceBasisSide(basis: PriceBasis): 'SALE' | 'RENT' | 'UNKNOWN' {
  switch (basis) {
    case 'ASKING_SALE_PRICE':
    case 'TRANSACTION_PRICE':
    case 'DEVELOPER_PRICE':
      return 'SALE';
    case 'ASKING_RENT':
    case 'ACHIEVED_RENT':
      return 'RENT';
    case 'UNKNOWN':
      return 'UNKNOWN';
  }
}

/**
 * Whether two money values may be pooled into one statistic.
 *
 * Identical bases only. There is no conversion factor here and there never
 * will be one: "asking prices run about 8% above achieved" is a market
 * assumption, not a fact about a property, and a core that applies it
 * silently has converted an observation into a guess. If a caller wants that
 * adjustment it must make it itself, visibly, above this layer.
 */
export function basesArePoolable(a: PriceBasis, b: PriceBasis): boolean {
  return a === b && a !== 'UNKNOWN';
}

export interface Money {
  amount: number;
  currency: string;
  /** Required. There is no constructor for a price without one. */
  basis: PriceBasis;
}

/* ────────────────────────────────────────────────────────────────────────
 * SOURCES
 * ──────────────────────────────────────────────────────────────────────── */

export type SourceKind =
  | 'OFFICIAL_REGISTRY'
  | 'OFFICIAL_DOCUMENT'
  | 'DEVELOPER_SITE'
  | 'PROPERTY_PORTAL'
  | 'MEDIA'
  | 'FORUM'
  | 'SOCIAL'
  | 'SEARCH_PROVIDER'
  | 'OTHER';

/**
 * Who ultimately publishes a source.
 *
 * Five portals republishing one developer's feed are five observations and
 * ONE independent source. The family is what makes that countable, and it is
 * configured per source rather than guessed from the hostname, because
 * syndication is a commercial relationship and not something a URL reveals.
 */
export interface SourceIdentity {
  /** Stable key for the source itself, e.g. `portal:myhome.ge`. */
  sourceKey: string;
  /** Publisher group. Sources sharing a family are not independent. */
  sourceFamily: string;
  kind: SourceKind;
}

/* ────────────────────────────────────────────────────────────────────────
 * OBSERVATIONS
 * ──────────────────────────────────────────────────────────────────────── */

/** Where a normalized field came from. Structured data outranks scraped text. */
export type FieldOrigin = 'JSON_LD' | 'MICRODATA' | 'OPEN_GRAPH' | 'API' | 'TEXT' | 'URL';

export const ORIGIN_QUALITY: Record<FieldOrigin, number> = {
  API: 1.0,
  JSON_LD: 0.95,
  MICRODATA: 0.8,
  OPEN_GRAPH: 0.6,
  URL: 0.4,
  TEXT: 0.35,
};

/**
 * One fetch of one source, normalized.
 *
 * INTERNAL TRANSPORT ONLY. `bridge/evidence.ts` converts this into a real
 * EvidenceItem; nothing outside src/research-core may import it. It carries
 * no customer-facing prose, no score the customer sees and no price.
 */
export interface Observation {
  id: string;

  /** The URL as asked for, as fetched, and as identity. All three differ. */
  requestedUrl: string;
  fetchUrl: string;
  canonicalIdentityUrl: string;

  source: SourceIdentity;

  /** How close to the subject this was observed. Never inferred later. */
  evidenceLevel: EvidenceLevel;

  /** When the SOURCE says it was true — not when we read it. */
  observedAt: string | null;
  /** When we read it. Always set. */
  retrievedAt: string;

  /** Hash of the meaningful content, for exact-duplicate detection. */
  contentHash: string;
  /** Near-duplicate fingerprint. Advisory; contentHash is the proof. */
  nearDuplicateFingerprint: string | null;

  /** The source's own id for this record, where it has one. */
  structuredSourceId: string | null;

  /** Parsed payload. Shape depends on the profile that asked for it. */
  payload: Record<string, unknown>;

  /** Per-field provenance, so a JSON-LD price outranks a regex hit. */
  fieldOrigins: Record<string, FieldOrigin>;

  /** Short excerpt supporting the payload. Never the whole page. */
  supportingText: string | null;
}

/* ────────────────────────────────────────────────────────────────────────
 * PROVIDER USAGE
 *
 * Measured consumption, never money. bridge/cost.ts converts this into the
 * shapes cogs.ts and billing.ts already understand; the core has no rates and
 * makes no pricing decision.
 * ──────────────────────────────────────────────────────────────────────── */

export interface ProviderUsage {
  provider: string;
  providerOperation: string | null;
  /** HTTP requests issued, including ones that cost nothing. */
  networkRequests: number;
  /** The subset the provider actually bills for. */
  billableRequests: number;
  /** Provider-defined billing units, where they are not requests. */
  providerUnits: number;
  /** Requests served from cache, which is the number reuse work must move. */
  cacheHits: number;
  /** Requests that another in-flight request was already making. */
  coalescedRequests: number;
  durationMs: number;
}

export function emptyUsage(provider: string, operation: string | null = null): ProviderUsage {
  return {
    provider,
    providerOperation: operation,
    networkRequests: 0,
    billableRequests: 0,
    providerUnits: 0,
    cacheHits: 0,
    coalescedRequests: 0,
    durationMs: 0,
  };
}

export function mergeUsage(a: ProviderUsage, b: ProviderUsage): ProviderUsage {
  return {
    provider: a.provider,
    providerOperation: a.providerOperation ?? b.providerOperation,
    networkRequests: a.networkRequests + b.networkRequests,
    billableRequests: a.billableRequests + b.billableRequests,
    providerUnits: a.providerUnits + b.providerUnits,
    cacheHits: a.cacheHits + b.cacheHits,
    coalescedRequests: a.coalescedRequests + b.coalescedRequests,
    durationMs: a.durationMs + b.durationMs,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * VISIBILITY
 *
 * A cached result reached under one customer's credentials must never be
 * served to another. The scope is part of every cache and coalescing key,
 * which is why it lives in the vocabulary rather than in the cache module.
 * ──────────────────────────────────────────────────────────────────────── */

export type VisibilityScope = 'PUBLIC_GLOBAL' | 'TENANT_PRIVATE' | 'USER_PRIVATE';

export interface RequestContext {
  visibilityScope: VisibilityScope;
  tenantId?: string | null;
  userId?: string | null;
}

export const DEFAULT_REQUEST_CONTEXT: RequestContext = { visibilityScope: 'PUBLIC_GLOBAL' };

/* ────────────────────────────────────────────────────────────────────────
 * RESEARCH STATUS
 * ──────────────────────────────────────────────────────────────────────── */

export type ResearchStatus =
  | 'COMPLETE'
  /** The deadline arrived first. Real evidence, knowingly incomplete. */
  | 'PARTIAL'
  /** Ran correctly and found nothing trustworthy. Not a failure. */
  | 'NO_EVIDENCE'
  | 'FAILED'
  | 'CANCELLED';
