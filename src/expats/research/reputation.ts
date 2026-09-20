// HOMATCH FOR EXPATS — what public evidence actually supports about a provider.
//
// A foreigner looking for a lawyer in a country whose language they do not
// read cannot check anything themselves. Whatever this product says about a
// provider will be believed. That is the whole reason this file is written
// the way it is.
//
// WHAT IS NOT HERE
//
// There is no score. No 8.4/10, no five stars, no "HOMATCH rating". Section
// 32 is explicit that reputation is not "4.9 stars = excellent", and once a
// single number exists every surface will show it and nothing will show the
// evidence. What comes out instead is a STRUCTURE: how much evidence there
// is, how independent it is, how old, what it consistently says, and where
// it disagrees with itself. A reader can act on that; they cannot act on 8.4.
//
// WHAT COUNTING IS DELEGATED RATHER THAN REDONE
//
// "Three portals republishing one directory" is the same problem Verify has
// with syndicated listings, and research-core already solves it properly in
// `computeIndependence`. This file calls it. A second implementation here
// would be a second answer, and the two would disagree within a month.
//
// THE RULE THAT MATTERS MOST
//
// Not finding evidence about a provider is a fact about our crawler. It is
// never rendered as a fact about the provider. `assess()` cannot return a
// negative conclusion from an empty evidence set — the type makes it
// impossible, because with no evidence the only reachable availability is
// COVERAGE_GAP or UNKNOWN, and neither is a world claim.

import { computeIndependence, type SupportCount } from '../../research-core/score/independence.ts';
import { dedupeObservations } from '../../research-core/score/document-dedupe.ts';
import type { Observation } from '../../research-core/core/types.ts';
import type { Availability, Freshness, ObservedMoney, SourceRef } from '../types.ts';
import { judgeFreshness } from '../types.ts';

/* ── What we may have found about a provider ──────────────────────────── */

/**
 * One thing a public source said about a provider.
 *
 * `observation` is the research-core value that carries the source family,
 * the document identity and the retrieval time; everything the independence
 * maths needs is already in it, which is why this type does not restate any
 * of it.
 */
export interface ProviderEvidence {
  observation: Observation;
  kind: ProviderEvidenceKind;
  source: SourceRef;
  /**
   * The rating this source published, on ITS OWN scale, with that scale
   * stated. Normalising to a common 0–5 in the database loses the fact
   * that one platform's 4.2 and another's 4.2 are different measurements.
   */
  rating: { value: number; outOf: number; reviewCount: number } | null;
  /** A price the provider published. Never inferred. */
  price: ObservedMoney | null;
  /** Language codes the provider states it works in. */
  languages: string[] | null;
  /** Free text, in its ORIGINAL language, kept for the evidence drawer. */
  excerpt: string | null;
}

export const PROVIDER_EVIDENCE_KINDS = [
  'OFFICIAL_REGISTRATION',
  'OWN_WEBSITE',
  'BUSINESS_PROFILE',
  'REVIEW_PLATFORM',
  'DIRECTORY',
  'MEDIA_MENTION',
  'PUBLIC_DISCUSSION',
] as const;
export type ProviderEvidenceKind = (typeof PROVIDER_EVIDENCE_KINDS)[number];

/**
 * How much a kind of evidence is worth as CONFIRMATION OF EXISTENCE AND
 * IDENTITY — not as a recommendation.
 *
 * A company-registry entry proves a business exists and who runs it, and
 * says nothing about whether they are any good. A forum thread is the
 * reverse. Both matter and they answer different questions, so the weight
 * here is used only for the identity confidence and never for reputation.
 */
const IDENTITY_WEIGHT: Record<ProviderEvidenceKind, number> = {
  OFFICIAL_REGISTRATION: 1,
  OWN_WEBSITE: 0.7,
  BUSINESS_PROFILE: 0.6,
  DIRECTORY: 0.3,
  REVIEW_PLATFORM: 0.3,
  MEDIA_MENTION: 0.3,
  PUBLIC_DISCUSSION: 0.1,
};

/* ── The assessment ───────────────────────────────────────────────────── */

export interface RatingPicture {
  /**
   * Per-platform, never merged. Averaging a 4.8 from 6 reviews with a 3.9
   * from 400 produces 4.35, which describes neither platform and is the
   * number a reader would remember.
   */
  perPlatform: {
    publisher: string;
    value: number;
    outOf: number;
    reviewCount: number;
    observedAt: string;
    freshness: Freshness;
  }[];
  totalReviews: number;
  /** True when platforms disagree by more than a fifth of their scale. */
  platformsDisagree: boolean;
}

export interface ProviderAssessment {
  providerId: string;
  /** Can we say this business exists and is who it says it is? */
  identity: {
    availability: Availability;
    /** 0..1. Confidence in IDENTITY, not in quality. */
    confidence: number;
    officiallyRegistered: boolean;
  };
  /** How much independent evidence there is, from research-core. */
  support: SupportCount;
  /** Null when no platform published one. Never zero, never a default. */
  ratings: RatingPicture | null;
  /** Null when no source published a price. UNKNOWN is not free. */
  price: ObservedMoney | null;
  languages: string[] | null;
  /** The freshest and the oldest evidence, so age is visible. */
  newestObservedAt: string | null;
  oldestObservedAt: string | null;
  freshness: Freshness;
  /** Why this provider may not be fully described. */
  limitations: AssessmentLimitation[];
}

export const ASSESSMENT_LIMITATIONS = [
  'NO_INDEPENDENT_SOURCES',
  'SINGLE_SOURCE_FAMILY',
  'NO_RATINGS_PUBLISHED',
  'NO_PRICE_PUBLISHED',
  'EVIDENCE_AGEING',
  'EVIDENCE_STALE',
  'PLATFORMS_DISAGREE',
  'LOW_REVIEW_VOLUME',
] as const;
export type AssessmentLimitation = (typeof ASSESSMENT_LIMITATIONS)[number];

/** Below this, a star rating is one person's opinion wearing a number. */
const MEANINGFUL_REVIEW_COUNT = 10;

/**
 * Assess one provider from whatever was found.
 *
 * With an empty evidence array this returns a COVERAGE_GAP identity, zero
 * support, null ratings and null price. It does not and cannot return
 * anything a reader could mistake for "this provider is bad" — that is the
 * §36 property, and `reputation.test.mjs` asserts it directly.
 */
export function assess(
  providerId: string,
  evidence: readonly ProviderEvidence[],
  now: number = Date.now(),
): ProviderAssessment {
  if (evidence.length === 0) {
    return {
      providerId,
      identity: { availability: 'COVERAGE_GAP', confidence: 0, officiallyRegistered: false },
      support: {
        observationCount: 0,
        independentSourceCount: 0,
        effectiveSourceCount: 0,
        familyCounts: {},
      },
      ratings: null,
      price: null,
      languages: null,
      newestObservedAt: null,
      oldestObservedAt: null,
      freshness: 'UNKNOWN',
      limitations: ['NO_INDEPENDENT_SOURCES', 'NO_RATINGS_PUBLISHED', 'NO_PRICE_PUBLISHED'],
    };
  }

  /* Two passes, in this order, and both are load-bearing.
   *
   * dedupeObservations first, because the same page fetched twice — or
   * republished verbatim under another URL — is ONE observation, and
   * counting it twice would inflate confidence by restating a single
   * document. It collapses on content hash, so it catches syndication that
   * shares no domain.
   *
   * computeIndependence second, over what survives, because five DIFFERENT
   * pages on one directory are five real documents and still one voice.
   * The default shared-subject behaviour is the correct one here: every
   * piece of evidence is about the same provider, so entries from one
   * publisher family are redundant by construction and get discounted.
   *
   * Running only the second would let one page counted twice look like
   * corroboration; running only the first would let a directory's five
   * distinct pages look like five publishers. §87 asks for both. */
  const deduped = dedupeObservations(evidence.map((e) => e.observation));
  const support = computeIndependence(deduped.observations);

  const observedAts = evidence.map((e) => e.source.observedAt).sort();
  const oldest = observedAts[0] ?? null;
  const newest = observedAts[observedAts.length - 1] ?? null;
  const freshness = judgeFreshness(newest, 'GENERAL', now);

  const officiallyRegistered = evidence.some((e) => e.kind === 'OFFICIAL_REGISTRATION');

  /* Identity confidence: the best single piece of evidence, lifted a
     little by genuinely independent corroboration. Capped below 1 unless
     an official registration is present, because nothing short of a
     registry entry establishes that a company is what it claims. */
  const bestWeight = Math.max(...evidence.map((e) => IDENTITY_WEIGHT[e.kind]));
  const corroboration = Math.min(0.25, Math.max(0, support.effectiveSourceCount - 1) * 0.1);
  const confidence = officiallyRegistered
    ? Math.min(1, bestWeight + corroboration)
    : Math.min(0.85, bestWeight + corroboration);

  const ratings = ratingPicture(evidence, now);
  const price = publishedPrice(evidence);
  const languages = statedLanguages(evidence);

  const limitations: AssessmentLimitation[] = [];
  if (support.independentSourceCount <= 1) limitations.push('SINGLE_SOURCE_FAMILY');
  if (support.effectiveSourceCount < 1.5) limitations.push('NO_INDEPENDENT_SOURCES');
  if (!ratings) limitations.push('NO_RATINGS_PUBLISHED');
  else {
    if (ratings.totalReviews < MEANINGFUL_REVIEW_COUNT) limitations.push('LOW_REVIEW_VOLUME');
    if (ratings.platformsDisagree) limitations.push('PLATFORMS_DISAGREE');
  }
  if (!price) limitations.push('NO_PRICE_PUBLISHED');
  if (freshness === 'AGEING') limitations.push('EVIDENCE_AGEING');
  if (freshness === 'STALE') limitations.push('EVIDENCE_STALE');

  return {
    providerId,
    identity: {
      availability: 'ESTABLISHED',
      confidence,
      officiallyRegistered,
    },
    support,
    ratings,
    price,
    languages,
    newestObservedAt: newest,
    oldestObservedAt: oldest,
    freshness,
    limitations: [...new Set(limitations)],
  };
}

/**
 * Ratings, kept apart by platform.
 *
 * Two entries from the same publisher keep only the most recently observed:
 * a platform's rating today supersedes the same platform's rating last
 * month, and counting both would let one source vote twice.
 */
function ratingPicture(
  evidence: readonly ProviderEvidence[],
  now: number,
): RatingPicture | null {
  const withRating = evidence.filter((e) => e.rating !== null && e.rating.reviewCount >= 0);
  if (withRating.length === 0) return null;

  const latestPerPublisher = new Map<string, ProviderEvidence>();
  for (const e of withRating) {
    const existing = latestPerPublisher.get(e.source.publisher);
    if (!existing || e.source.observedAt > existing.source.observedAt) {
      latestPerPublisher.set(e.source.publisher, e);
    }
  }

  const perPlatform = [...latestPerPublisher.values()]
    .map((e) => {
      const r = e.rating as NonNullable<ProviderEvidence['rating']>;
      return {
        publisher: e.source.publisher,
        value: r.value,
        outOf: r.outOf,
        reviewCount: r.reviewCount,
        observedAt: e.source.observedAt,
        freshness: judgeFreshness(e.source.observedAt, 'GENERAL', now),
      };
    })
    .sort((a, b) => b.reviewCount - a.reviewCount);

  const normalised = perPlatform.map((p) => (p.outOf > 0 ? p.value / p.outOf : 0));
  const platformsDisagree =
    normalised.length > 1 && Math.max(...normalised) - Math.min(...normalised) > 0.2;

  return {
    perPlatform,
    totalReviews: perPlatform.reduce((n, p) => n + p.reviewCount, 0),
    platformsDisagree,
  };
}

/**
 * A price, only if somebody published one.
 *
 * When several sources published different prices the range is WIDENED to
 * cover them all rather than averaged. Two firms' published fees that
 * disagree are a real spread the reader should see, and a mean would hide
 * exactly the information that matters when choosing.
 */
function publishedPrice(evidence: readonly ProviderEvidence[]): ObservedMoney | null {
  const prices = evidence.map((e) => e.price).filter((p): p is ObservedMoney => p !== null);
  if (prices.length === 0) return null;
  const currency = prices[0].currency;
  const sameCurrency = prices.filter((p) => p.currency === currency);
  // Mixed currencies without a rate are not comparable, and inventing one
  // here would be a conversion nobody could audit.
  if (sameCurrency.length !== prices.length) return sameCurrency[0] ?? null;

  const unit = sameCurrency[0].unit;
  const sameUnit = sameCurrency.filter((p) => p.unit === unit);
  return {
    low: Math.min(...sameUnit.map((p) => p.low)),
    high: Math.max(...sameUnit.map((p) => p.high)),
    currency,
    unit,
    sampleSize: sameUnit.reduce((n, p) => n + p.sampleSize, 0),
    sourceCount: new Set(sameUnit.map((p) => p.locality ?? '')).size || sameUnit.length,
    observedAt: sameUnit.map((p) => p.observedAt).sort().slice(-1)[0],
    locality: sameUnit[0].locality,
  };
}

function statedLanguages(evidence: readonly ProviderEvidence[]): string[] | null {
  const all = evidence.flatMap((e) => e.languages ?? []);
  if (all.length === 0) return null;
  return [...new Set(all.map((l) => l.toLowerCase()))].sort();
}

/* ── Ordering a shortlist ─────────────────────────────────────────────── */

/**
 * The inputs an ordering is allowed to use.
 *
 * Exported as data rather than buried in a comparator so the test in §87
 * can assert what the ordering may see. `sponsored` is deliberately absent
 * from this type: an ordering function that cannot receive the flag cannot
 * be influenced by it, which is a stronger guarantee than a promise not to
 * look.
 */
export interface RankingInputs {
  providerId: string;
  effectiveSourceCount: number;
  identityConfidence: number;
  officiallyRegistered: boolean;
  totalReviews: number;
  freshness: Freshness;
  /** How well the provider matches what was asked for. 0..1, from the query. */
  relevance: number;
}

export function rankingInputsFrom(
  assessment: ProviderAssessment,
  relevance: number,
): RankingInputs {
  return {
    providerId: assessment.providerId,
    effectiveSourceCount: assessment.support.effectiveSourceCount,
    identityConfidence: assessment.identity.confidence,
    officiallyRegistered: assessment.identity.officiallyRegistered,
    totalReviews: assessment.ratings?.totalReviews ?? 0,
    freshness: assessment.freshness,
    relevance,
  };
}

const FRESHNESS_FACTOR: Record<Freshness, number> = {
  FRESH: 1,
  AGEING: 0.85,
  STALE: 0.6,
  UNKNOWN: 0.6,
};

/**
 * Order a shortlist.
 *
 * This is an EVIDENCE ordering, not a quality ordering, and the difference
 * is worth stating because it is what the product may honestly claim. A
 * provider sorts higher here because more independent public sources
 * describe it, more recently, and it matches the request better. It does
 * not sort higher because it is better, and no copy anywhere is allowed to
 * say it does (§31).
 *
 * Review COUNT contributes, logarithmically and with a small ceiling.
 * Review SCORE does not contribute at all: a 5.0 from four reviews and a
 * 4.1 from six hundred cannot be ordered against each other without
 * inventing a model of review reliability we have no evidence for.
 */
export function rankProviders(inputs: readonly RankingInputs[]): RankingInputs[] {
  const score = (r: RankingInputs): number =>
    (Math.min(r.effectiveSourceCount, 4) * 0.3 +
      r.identityConfidence * 0.25 +
      (r.officiallyRegistered ? 0.15 : 0) +
      Math.min(Math.log10(1 + r.totalReviews) / 2, 0.5) * 0.1 +
      r.relevance * 0.2) *
    FRESHNESS_FACTOR[r.freshness];

  return [...inputs].sort((a, b) => {
    const d = score(b) - score(a);
    // Ties break on the id so the order is stable across runs rather than
    // depending on whatever order the crawler happened to finish in.
    return d !== 0 ? d : a.providerId.localeCompare(b.providerId);
  });
}

/**
 * Providers with enough evidence behind them to show as researched results.
 *
 * Everything else is not "rejected" and must never be presented as such —
 * it is a provider we could not learn enough about. The caller reports the
 * count of both, which is what turns "5 shortlisted" into an honest number
 * rather than an implied verdict on the other seven.
 */
export function shortlist(
  assessments: readonly ProviderAssessment[],
): { shortlisted: ProviderAssessment[]; insufficientEvidence: ProviderAssessment[] } {
  const shortlisted: ProviderAssessment[] = [];
  const insufficientEvidence: ProviderAssessment[] = [];
  for (const a of assessments) {
    const enough =
      a.identity.availability === 'ESTABLISHED' &&
      a.support.effectiveSourceCount >= 1 &&
      a.identity.confidence >= 0.5;
    (enough ? shortlisted : insufficientEvidence).push(a);
  }
  return { shortlisted, insufficientEvidence };
}
