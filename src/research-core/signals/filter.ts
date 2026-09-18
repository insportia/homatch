// HOMATCH RESEARCH CORE — does this signal count for THIS job?
//
// The whole point of one engine with many jobs is that the shared half stays
// shared and this half does not. Fetching, caching, coalescing, dedupe,
// provenance and evidence are identical for a buyer search and a property
// search. What counts as a result is not, and never can be.
//
// Everything below is arithmetic over values the classifier already produced.
// There is no model in this path and no place to put one. That is deliberate:
// the single most damaging bug available here is a buyer comment appearing in
// a property result set, and a filter that is right most of the time is a
// filter that produces that bug regularly, differently on each run, with
// nothing to diff.
//
// EVERY REJECTION IS RECORDED WITH ITS REASON. A source that is producing
// nothing should be visibly producing nothing, in the admin area, with the
// reason — not quietly returning an empty list.

import { directionSatisfies } from '../core/types.ts';
import { judgeFreshness, type FreshnessSpec } from '../discovery/freshness.ts';
import type { PropertyTerm } from '../discovery/lexicon.ts';
import type { JobContract } from '../profiles/types.ts';
import type { PublicSignal, ScoredSignal } from './types.ts';

export type RejectionReason =
  | 'WRONG_DIRECTION'
  | 'DIRECTION_UNKNOWN'
  | 'WEAK_INTENT'
  | 'AGENCY_VOICE'
  | 'WRONG_PROPERTY_TYPE'
  | 'OUTSIDE_FRESHNESS_WINDOW'
  | 'UNDATED_AND_WINDOW_IS_NARROW'
  | 'COMMENTS_NOT_WANTED'
  | 'OUTSIDE_LOCATION'
  | 'OUTSIDE_BUDGET'
  | 'NO_TEXT';

export interface Rejection {
  signalId: string;
  reason: RejectionReason;
  detail?: string;
}

export interface FilterOutcome {
  accepted: ScoredSignal[];
  rejected: Rejection[];
}

export interface FilterInput {
  job: JobContract;
  /** Overrides the profile's default window when a caller narrowed it. */
  freshness?: FreshnessSpec;
  /**
   * Property terms the classifier found in the text. Supplied per signal
   * because the classifier already computed it and recomputing would mean
   * two implementations of the same question.
   */
  propertyTermsOf: (signal: PublicSignal) => PropertyTerm[];
  /** True when the author reads as an agency rather than a principal. */
  agencyVoiceOf: (signal: PublicSignal) => boolean;
  /** 0..1 from the source registry's track record. Defaults to neutral. */
  sourceProductivityOf?: (signal: PublicSignal) => number;
  /** What the job was looking for, for location and budget matching. */
  target?: {
    countryCode?: string | null;
    city?: string | null;
    district?: string | null;
    budgetMin?: number | null;
    budgetMax?: number | null;
    currency?: string | null;
  };
  now?: number;
}

export function filterSignals(
  signals: readonly PublicSignal[],
  input: FilterInput,
): FilterOutcome {
  const accepted: ScoredSignal[] = [];
  const rejected: Rejection[] = [];
  const now = input.now ?? Date.now();
  const freshness = input.freshness ?? input.job.defaultFreshness;
  const productivityOf = input.sourceProductivityOf ?? (() => 0.5);

  for (const signal of signals) {
    const reject = (reason: RejectionReason, detail?: string) => {
      rejected.push({ signalId: signal.id, reason, ...(detail ? { detail } : {}) });
    };

    if (!signal.originalText.trim()) {
      reject('NO_TEXT');
      continue;
    }

    // ── 1. Direction. The one that inverts a result set if it is wrong. ──
    if (signal.direction === 'UNKNOWN') {
      reject('DIRECTION_UNKNOWN');
      continue;
    }
    if (!directionSatisfies(signal.direction, input.job.direction)) {
      reject('WRONG_DIRECTION', `${signal.direction} offered to a ${input.job.direction} job`);
      continue;
    }

    // ── 2. How firmly did they commit? ──
    if (signal.directionConfidence < input.job.minDirectionConfidence) {
      reject('WEAK_INTENT', `confidence ${signal.directionConfidence}`);
      continue;
    }

    // ── 3. Agency voice, where the job wants a principal. ──
    if (input.job.rejectAgencyVoice && input.agencyVoiceOf(signal)) {
      reject('AGENCY_VOICE');
      continue;
    }

    // ── 4. Comments, where the job does not want them. ──
    if (!input.job.includeComments && (signal.contentType === 'COMMENT' || signal.contentType === 'REPLY')) {
      reject('COMMENTS_NOT_WANTED');
      continue;
    }

    // ── 5. Property type. A land job must not accept a flat. ──
    const terms = input.propertyTermsOf(signal);
    if (!matchesPropertyTerms(terms, input.job.propertyTerms)) {
      reject('WRONG_PROPERTY_TYPE', terms.join(',') || 'none found');
      continue;
    }

    // ── 6. Freshness. ──
    const fresh = judgeFreshness(signal.publishedAt, freshness, now);
    if (!fresh.inWindow) {
      reject(
        fresh.undated ? 'UNDATED_AND_WINDOW_IS_NARROW' : 'OUTSIDE_FRESHNESS_WINDOW',
        fresh.ageMs === null ? 'no readable date' : `${Math.round(fresh.ageMs / 86_400_000)}d old`,
      );
      continue;
    }

    // ── 7. Location, where the signal named one and it is the wrong one. ──
    const locationVerdict = locationScore(signal, input.target);
    if (locationVerdict.contradicts) {
      reject('OUTSIDE_LOCATION', locationVerdict.detail);
      continue;
    }

    // ── 8. Budget, same rule: only a stated, contradicting figure rejects. ──
    const budgetVerdict = budgetScore(signal, input.target);
    if (budgetVerdict.contradicts) {
      reject('OUTSIDE_BUDGET', budgetVerdict.detail);
      continue;
    }

    const components = {
      relevance: round2((locationVerdict.score + budgetVerdict.score + termScore(terms, input.job.propertyTerms)) / 3),
      intentStrength: signal.directionConfidence,
      freshness: fresh.score,
      sourceProductivity: clamp01(productivityOf(signal)),
      contextCompleteness: contextScore(signal),
    };

    accepted.push({
      signal,
      score: blend(components),
      components,
      reasons: buildReasons(signal, components, terms),
    });
  }

  // Deterministic: score, then id. Never insertion order.
  accepted.sort((a, b) => b.score - a.score || a.signal.id.localeCompare(b.signal.id));
  return { accepted, rejected };
}

/**
 * The weights.
 *
 * Relevance and intent dominate because a fresh irrelevant post is still
 * irrelevant. Source productivity is the smallest weight on purpose: it is a
 * prior, and a prior that outweighs the evidence in front of it turns a
 * ranking into a self-fulfilling one, where a source that once did well keeps
 * winning because it once did well.
 */
const WEIGHTS = {
  relevance: 0.3,
  intentStrength: 0.3,
  freshness: 0.22,
  sourceProductivity: 0.08,
  contextCompleteness: 0.1,
};

function blend(components: ScoredSignal['components']): number {
  const total =
    components.relevance * WEIGHTS.relevance +
    components.intentStrength * WEIGHTS.intentStrength +
    components.freshness * WEIGHTS.freshness +
    components.sourceProductivity * WEIGHTS.sourceProductivity +
    components.contextCompleteness * WEIGHTS.contextCompleteness;
  return round2(total);
}

function matchesPropertyTerms(found: readonly PropertyTerm[], wanted: readonly PropertyTerm[]): boolean {
  // Nothing found is not a rejection. Plenty of real demand posts say "looking
  // for something in Vake up to $150k" and name no noun at all; requiring one
  // would throw away some of the best leads. A CONTRADICTING noun is the
  // rejection — see below.
  if (found.length === 0) return true;
  if (wanted.includes('property')) {
    // The generic job accepts any specific type.
    return true;
  }
  return found.some((term) => wanted.includes(term) || term === 'property');
}

function termScore(found: readonly PropertyTerm[], wanted: readonly PropertyTerm[]): number {
  if (found.length === 0) return 0.5;
  const hit = found.some((term) => wanted.includes(term));
  return hit ? 1 : 0.6;
}

function locationScore(
  signal: PublicSignal,
  target: FilterInput['target'],
): { score: number; contradicts: boolean; detail?: string } {
  if (!target) return { score: 0.5, contradicts: false };
  const hints = signal.locationHints;

  // A signal that named no place is not evidence of the wrong place. It scores
  // lower and is kept: a comment in a Tbilisi housing group rarely repeats the
  // city name, and rejecting it for that would empty the result set.
  if (!hints.city && !hints.district && !hints.countryCode) {
    return { score: 0.4, contradicts: false };
  }

  if (target.countryCode && hints.countryCode && !eq(hints.countryCode, target.countryCode)) {
    return { score: 0, contradicts: true, detail: `${hints.countryCode} vs ${target.countryCode}` };
  }
  if (target.city && hints.city && !eq(hints.city, target.city)) {
    return { score: 0, contradicts: true, detail: `${hints.city} vs ${target.city}` };
  }
  if (target.district && hints.district && eq(hints.district, target.district)) {
    return { score: 1, contradicts: false };
  }
  return { score: 0.75, contradicts: false };
}

function budgetScore(
  signal: PublicSignal,
  target: FilterInput['target'],
): { score: number; contradicts: boolean; detail?: string } {
  const amount = signal.requirementHints.budgetAmount;
  if (!target || amount === null) return { score: 0.5, contradicts: false };

  // Currencies are not converted here. There is no FX rate in this core, and
  // applying one silently would turn a filter into a currency bet.
  const currency = signal.requirementHints.budgetCurrency;
  if (target.currency && currency && !eq(currency, target.currency)) {
    return { score: 0.5, contradicts: false, detail: 'different currency, not compared' };
  }

  const min = target.budgetMin ?? null;
  const max = target.budgetMax ?? null;
  // A 25% tolerance either side: somebody saying "up to $150k" will look at
  // $160k, and a filter that does not know that discards real buyers.
  if (max !== null && amount > max * 1.25) {
    return { score: 0, contradicts: true, detail: `${amount} above ${max}` };
  }
  if (min !== null && amount < min * 0.75) {
    return { score: 0, contradicts: true, detail: `${amount} below ${min}` };
  }
  return { score: 1, contradicts: false };
}

/**
 * A comment without its parent is a fragment.
 *
 * "Is this still available?" is a strong buyer signal under a listing and
 * noise on its own, so the missing context lowers the score rather than being
 * ignored.
 */
function contextScore(signal: PublicSignal): number {
  if (signal.contentType !== 'COMMENT' && signal.contentType !== 'REPLY') {
    return signal.contentUrl ? 1 : 0.8;
  }
  if (signal.parentUrl && signal.parentExcerpt) return 1;
  if (signal.parentUrl) return 0.7;
  return 0.35;
}

function buildReasons(
  signal: PublicSignal,
  components: ScoredSignal['components'],
  terms: readonly PropertyTerm[],
): string[] {
  const reasons: string[] = [
    `direction=${signal.direction} confidence=${signal.directionConfidence}`,
    `freshness=${components.freshness}`,
  ];
  if (terms.length) reasons.push(`property_terms=${terms.join(',')}`);
  if (signal.language) reasons.push(`language=${signal.language}`);
  if (signal.contentType === 'COMMENT' || signal.contentType === 'REPLY') {
    reasons.push(signal.parentUrl ? 'comment_with_parent' : 'comment_without_parent');
  }
  reasons.push(`access=${signal.accessClass}`);
  return reasons;
}

function eq(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
