// DO WE ALREADY KNOW ENOUGH NOT TO GO OUTSIDE?
//
// The architecture the whole intelligence store exists to serve:
//
//   UNDERSTAND CAMPAIGN
//     → QUERY FRESH EXISTING HOMATCH INTELLIGENCE
//     → MATCH WHAT IS COMPATIBLE
//     → IDENTIFY COVERAGE GAPS
//     → EXTERNAL DISCOVERY ONLY FOR THE GAPS
//     → PERSIST → CLASSIFY → MATCH AGAIN → DELIVER
//
// This module is the fourth line: the decision that stands between a campaign and
// an external fetch. Without it every campaign starts by rescanning, and the
// store's value never compounds — a thousand campaigns in one city means a
// thousand sweeps of the same eight portals for the same listings.
//
// WHAT ALREADY EXISTED, SO THIS IS NOT A SECOND ANSWER
//
// Two things, and this module is built on both rather than beside them.
//
// run-matching-v2 already reads the global demand store: it queries
// intent_profiles by city, merges what it finds with the campaign's own
// candidates, and records origin GLOBAL_DEMAND_STORE at acquisition_cost_usd 0.
// That is existing-intelligence-first for the DEMAND side and it is production
// proven.
//
// judgeDelivery() in ./revalidation.ts already decides whether one piece of
// evidence is fresh enough to put in front of a customer, including the two rules
// that matter: something we could not re-read is not shown as though we had, and
// one sighting inside the window is deliverable but is NOT called verified. This
// module does not re-decide any of that. A second freshness rule here would drift
// from that one within a release, and the drift would be invisible — both would
// look right in isolation while disagreeing about the same row.
//
// What nothing did was decide whether to go outside AT ALL. supply-discovery was
// invoked unconditionally, so a campaign in a city Homatch swept an hour ago swept
// it again. This module answers that question and nothing else: it reads no rows,
// fetches nothing, and returns a decision plus the reason for it.
//
// WHY COVERAGE IS COUNTED IN DELIVERABLE EVIDENCE
//
// "We have 400 observations for Tbilisi" is not coverage. Four hundred
// observations last verified in July are history, and a customer being shown a
// listing that sold in August is worse than a customer being shown nothing.
//
// So an item counts toward coverage exactly when judgeDelivery() says it is
// deliverable as it stands. Anything that needs revalidation before it can be
// shown is NOT coverage: we would have to spend a network call on it anyway, so
// treating it as "already known" would skip the sweep and then deliver nothing.
//
// AND WHY A GAP IS PER DIMENSION
//
// A campaign searching in Georgian and Hebrew whose store holds plenty of
// Georgian and no Hebrew is not covered, and it is not uncovered either. The
// honest answer is one gap, in Hebrew, and the external sweep should be scoped to
// that — which is the difference between a cheap incremental fetch and a full
// rescan that re-buys the Georgian half.

import { comparePlaces } from '../normalize/place.ts';
import {
  judgeDelivery,
  type DeliveryVerdict,
  type EvidenceFreshness,
  type FreshnessPolicy,
} from './revalidation.ts';

export type CoverageDimension = 'MARKET' | 'LANGUAGE';

export interface CoverageGap {
  dimension: CoverageDimension;
  /** The specific value missing: a language code, or the market itself. */
  value: string;
  /** What we hold for it now. Zero is a measurement. */
  have: number;
  /** What the campaign asked for. */
  want: number;
  reason: string;
}

/** One thing the store already holds, as the caller read it. */
export interface HeldEvidence {
  /**
   * City as the SOURCE wrote it, not as the campaign asked.
   *
   * Unnormalised on purpose. supply_observations holds 'Tbilisi', 'tbilisi' and
   * 'თბილისი' for one city -- measured in production, 2026-09-26 -- so the row is
   * passed through as written and comparePlaces() decides whether it is the city
   * the campaign means. A caller that pre-folded these to a single spelling would
   * be building a second place vocabulary.
   */
  city: string | null;
  /** Language of the evidence as OBSERVED, not as the campaign requested. */
  language: string | null;
  /** Source or adapter it came from. Reported, not used as a gate. */
  sourceId: string | null;
  /**
   * When the AUTHOR published it, as the source stated. Null when none was stated.
   *
   * Separate from every timestamp in `freshness`, and the distinction is not
   * academic. MEASURED IN PRODUCTION, 2026-09-26: the first live Telegram sync
   * stored seven posts published in October and November 2022 -- 1,399 to 1,449
   * days old -- and because we had just re-read and confirmed them,
   * judgeDelivery() called all seven FRESH and deliverable.
   *
   * It was right on its own terms: the OBSERVATION was minutes old. But
   * "the post is still on the channel" is not "the flat is still available", and a
   * four-year-old rental counted as coverage would stop a campaign paying to find
   * current listings. Observation freshness and publication age are two different
   * facts and coverage needs both.
   */
  publishedAt?: string | null;
  /**
   * The caller's handle for this row -- an observation id, usually.
   *
   * Carried through untouched so the caller can record WHICH evidence answered a
   * campaign. A skipped sweep still has to write its campaign_supply_references
   * rows, or the campaign silently has no record of the intelligence it reused and
   * the reuse becomes unauditable -- which is worse than the duplicate fetch this
   * gate exists to prevent.
   */
  ref?: string;
  /**
   * The existing freshness record for this row.
   *
   * The full record rather than a summary, because judgeDelivery() needs
   * validationState, lastVerifiedAt, firstSeenAt and failedChecks to reach the
   * verdict, and passing a pre-digested boolean would put the decision back in
   * this file.
   */
  freshness: EvidenceFreshness;
}

export interface CoverageRequest {
  /** Market the campaign is searching. */
  market: string;
  city: string | null;
  /** The campaign's search languages. A ceiling, never widened here. */
  languages: readonly string[];
  /** How much deliverable evidence per language counts as covered. */
  minPerLanguage: number;
  /**
   * The delivery window, passed straight to judgeDelivery().
   *
   * Optional, and when omitted the existing seven-day default applies. This
   * module deliberately holds no window of its own.
   */
  policy?: FreshnessPolicy;
  /**
   * How old the PUBLICATION may be and still count as coverage, in ms.
   *
   * Optional, and omitting it keeps the previous behaviour exactly -- publication
   * age is then not considered at all, which is the right default for a caller
   * that has not thought about it rather than a silent new rule.
   *
   * Supplied by the caller because it is a market judgement and not a constant: a
   * Tbilisi rental posted three months ago is gone, a plot of land advertised two
   * years ago may well still be for sale. A row with no stated publication date is
   * NOT excluded by this -- absence of a date is not evidence of age, and treating
   * it as such would discard most of what some sources publish.
   */
  maxPublishedAgeMs?: number;
  /** Evaluation time, injectable for tests. */
  now?: number;
}

export type CoverageVerdict =
  /** Enough deliverable compatible evidence. No external work is warranted. */
  | 'COVERED'
  /** Some dimensions covered, some not. Scope the sweep to the gaps. */
  | 'PARTIAL'
  /** Nothing usable. A full sweep is warranted. */
  | 'UNCOVERED';

export interface CoverageAssessment {
  verdict: CoverageVerdict;
  /** Deliverable, language-compatible evidence per requested language. */
  deliverableByLanguage: Record<string, number>;
  /**
   * Held evidence that is not deliverable, by the verdict that excluded it.
   *
   * Reported rather than summed into one "stale" number, because the reasons call
   * for different work: NEEDS_REVALIDATION is a re-read we owe, REMOVED is
   * settled, and UNVERIFIABLE is a source refusing us. An operator looking at a
   * skipped or scoped sweep needs to see which.
   */
  excluded: Partial<Record<DeliveryVerdict, number>>;
  /**
   * Deliverable rows that could not be counted, and why.
   *
   * These are the reasons a coverage gate reports a gap while the store visibly
   * holds rows, so they are part of the answer rather than debug output. Each one
   * is a data-quality fact an operator can act on:
   *
   *   wrongCity        comparePlaces() says a different place. Correct exclusion.
   *   unplaceableCity  comparePlaces() returned UNKNOWN -- two scripts and no
   *                    table entry. Fixed by adding one verified name to PLACES,
   *                    not by loosening this gate.
   *   unknownLanguage  the row has no detected_language. 22 of 32 production rows
   *                    were like this on 2026-09-26, so a gate that looked dead
   *                    is usually this and not a bug in the gate.
   */
  uncounted: {
    wrongCity: number;
    unplaceableCity: number;
    unknownLanguage: number;
    /**
     * Deliverable, correctly placed, correctly languaged -- and published too long
     * ago to be worth showing. Counted separately because it is the one exclusion
     * that says something about the SOURCE rather than about our data quality: a
     * channel returning nothing but four-year-old posts is an archive, and an
     * archive is not a lead supply.
     */
    publishedTooLongAgo: number;
  };
  gaps: CoverageGap[];
  /**
   * Languages the external sweep should cover. Empty when COVERED.
   *
   * This is the output that saves money: a sweep scoped to one missing language
   * instead of a rescan that re-buys the languages already held.
   */
  sweepLanguages: string[];
  /**
   * The refs of the rows that counted toward coverage, in input order.
   *
   * Only rows the caller gave a ref for, and only those that were both deliverable
   * and language-compatible: exactly the evidence the verdict rests on.
   */
  countedRefs: string[];
  /** Plain words. Written to the job so a skipped sweep is explainable. */
  rationale: string;
}

/**
 * Decide whether a campaign needs to go outside, and for what.
 *
 * Returns UNCOVERED when it holds nothing deliverable, which is the correct
 * answer for a market Homatch has never swept — the store compounding is the
 * goal, and a cold store must not be reported as coverage.
 */
export function assessCoverage(
  held: readonly HeldEvidence[],
  request: CoverageRequest,
): CoverageAssessment {
  const now = request.now ?? Date.now();
  const languages = [...new Set(request.languages.map((l) => l.toLowerCase()))];
  /*
   * One is the floor, and a non-finite request is treated as one rather than
   * propagated. Math.max(1, NaN) is NaN, and `have < NaN` is false for every
   * count -- so an unguarded NaN produces no gaps at all, reports an empty store
   * as COVERED, and cancels the sweep by arithmetic. Silent, and the customer
   * gets nothing.
   */
  const requested = Math.trunc(request.minPerLanguage);
  const floor = Number.isFinite(requested) ? Math.max(1, requested) : 1;

  const deliverableByLanguage: Record<string, number> = {};
  for (const language of languages) deliverableByLanguage[language] = 0;

  const excluded: Partial<Record<DeliveryVerdict, number>> = {};
  /* Deliverable evidence in a language the campaign did not ask for. Counted
     separately: it is real intelligence and it is not coverage for THIS
     campaign, and conflating the two is how an Arabic campaign gets reported as
     covered by Georgian listings. */
  let deliverableOutsideRequest = 0;
  const countedRefs: string[] = [];
  let wrongCity = 0;
  let unknownCity = 0;
  let unknownLanguage = 0;
  let publishedTooLongAgo = 0;

  for (const item of held) {
    const decision = judgeDelivery(item.freshness, { now, policy: request.policy });
    if (!decision.deliverable) {
      excluded[decision.verdict] = (excluded[decision.verdict] ?? 0) + 1;
      continue;
    }

    /*
     * IS THIS ROW EVEN ABOUT THE CITY THE CAMPAIGN MEANS?
     *
     * Not a string comparison. comparePlaces() is the one place vocabulary in
     * this core, verified in production against four sources and three scripts,
     * and it has three answers rather than two. UNKNOWN is not AGREE: a row we
     * cannot place must not be counted as coverage, because counting it would
     * skip the sweep on the strength of a comparison that was never made.
     */
    if (request.city) {
      const placed = comparePlaces(item.city, request.city);
      if (placed === 'CONFLICT') {
        wrongCity += 1;
        continue;
      }
      if (placed === 'UNKNOWN') {
        unknownCity += 1;
        continue;
      }
    }

    /*
     * IS THE CLAIM STILL WORTH MAKING, not just the observation still warm?
     *
     * judgeDelivery() above answered "did we re-read this recently", and for the
     * seven 2022 Telegram posts measured in production it answered FRESH, because
     * we had. This asks the other question, and only when the caller has said what
     * it considers too old -- an absent ceiling means the caller has not decided and
     * nothing is excluded here.
     *
     * A row with NO stated publication date passes: absence of a date is not
     * evidence of age, and excluding it would discard most of what some sources
     * publish on the strength of a guess.
     */
    if (request.maxPublishedAgeMs !== undefined && item.publishedAt) {
      const published = Date.parse(item.publishedAt);
      if (Number.isFinite(published) && now - published > request.maxPublishedAgeMs) {
        publishedTooLongAgo += 1;
        continue;
      }
    }

    const language = (item.language ?? '').toLowerCase();
    if (!language) {
      /*
       * Real evidence whose language nobody recorded. 22 of 32 supply_observations
       * rows in production are like this, so this is the common case and not an
       * edge one. It is NOT credited to a requested language -- we would be
       * guessing -- and it is reported rather than silently dropped, because a
       * large count here is the reason a coverage gate would appear dead.
       */
      unknownLanguage += 1;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(deliverableByLanguage, language)) {
      deliverableByLanguage[language] += 1;
      if (item.ref) countedRefs.push(item.ref);
    } else {
      deliverableOutsideRequest += 1;
    }
  }

  const gaps: CoverageGap[] = [];
  for (const language of languages) {
    const have = deliverableByLanguage[language] ?? 0;
    if (have < floor) {
      gaps.push({
        dimension: 'LANGUAGE',
        value: language,
        have,
        want: floor,
        reason: have === 0
          ? `nothing deliverable is held in ${language} for this market`
          : `only ${have} deliverable item(s) in ${language}, and ${floor} is the floor`,
      });
    }
  }

  /*
   * A market with no city is a gap of its own. The existing global-demand query
   * uses the CITY as its discriminator, because intent_profiles.country is
   * unnormalised in production — 'Georgia' on some rows and 'GE' on others — so a
   * campaign with no city cannot be answered from the store at all. Reporting
   * that as coverage would skip the sweep on the strength of a query that was
   * never able to run.
   */
  if (!request.city) {
    gaps.push({
      dimension: 'MARKET',
      value: request.market,
      have: 0,
      want: 1,
      reason: 'the campaign names no city, and the store is queried by city because '
        + 'intent_profiles.country is unnormalised in production. Coverage cannot be established '
        + 'without one, so external discovery is warranted rather than assumed unnecessary',
    });
  }

  /*
   * An empty language list is not "every language is satisfied". It is a caller
   * that has not told us what to cover, and answering COVERED would silently
   * cancel the sweep.
   */
  if (languages.length === 0) {
    gaps.push({
      dimension: 'MARKET',
      value: request.market,
      have: 0,
      want: 1,
      reason: 'no search languages were given, so there is no dimension to establish '
        + 'coverage over and the sweep must not be skipped',
    });
  }

  const totalDeliverable = Object.values(deliverableByLanguage).reduce((a, b) => a + b, 0);
  const verdict: CoverageVerdict = gaps.length === 0
    ? 'COVERED'
    : totalDeliverable > 0
      ? 'PARTIAL'
      : 'UNCOVERED';

  const sweepLanguages = gaps
    .filter((gap) => gap.dimension === 'LANGUAGE')
    .map((gap) => gap.value);

  const excludedSummary = describeExcluded(excluded);
  const where = request.city ?? request.market;

  const rationale = verdict === 'COVERED'
    ? `every requested language holds at least ${floor} deliverable item(s) for ${where}; `
      + `no external discovery is warranted.${excludedSummary}`
    : verdict === 'PARTIAL'
      ? `${totalDeliverable} deliverable item(s) are reusable and ${gaps.length} gap(s) remain. `
        + `The sweep is scoped to ${sweepLanguages.join(', ') || 'the missing dimensions'} rather `
        + `than repeating the languages already held.${excludedSummary}`
      : `nothing deliverable is held for ${where} in the requested language(s); a full sweep is `
        + `warranted.${excludedSummary}`;

  return {
    verdict,
    deliverableByLanguage,
    excluded,
    uncounted: {
      wrongCity,
      unplaceableCity: unknownCity,
      unknownLanguage,
      publishedTooLongAgo,
    },
    countedRefs,
    gaps,
    sweepLanguages,
    rationale: [
      rationale,
      deliverableOutsideRequest > 0
        ? `${deliverableOutsideRequest} deliverable item(s) are held in languages this campaign `
          + 'did not request and are not counted as its coverage.'
        : '',
      describeUncounted(wrongCity, unknownCity, unknownLanguage, publishedTooLongAgo),
    ].filter(Boolean).join(' '),
  };
}

/**
 * Why held evidence did not count, in the platform's own words.
 *
 * Never "N stale". A row we owe a re-read and a row whose source deleted it are
 * different situations, and an operator deciding whether a skipped sweep was
 * right needs to see which one they are looking at.
 */
function describeExcluded(excluded: Partial<Record<DeliveryVerdict, number>>): string {
  const parts = (Object.keys(excluded) as DeliveryVerdict[])
    .sort()
    .map((verdict) => `${excluded[verdict]} ${verdict}`);
  return parts.length === 0
    ? ''
    : ` Not counted: ${parts.join(', ')}.`;
}

/**
 * Deliverable rows that were nonetheless not coverage, in plain words.
 *
 * Said out loud because the alternative is an operator seeing "nothing
 * deliverable is held for Tbilisi" next to a table with rows in it, and
 * concluding the gate is broken when the rows simply have no language recorded.
 */
function describeUncounted(
  wrongCity: number,
  unplaceableCity: number,
  unknownLanguage: number,
  publishedTooLongAgo: number,
): string {
  const parts: string[] = [];
  if (wrongCity > 0) parts.push(`${wrongCity} for another city`);
  if (unplaceableCity > 0) {
    parts.push(`${unplaceableCity} whose city could not be compared across scripts`);
  }
  if (unknownLanguage > 0) parts.push(`${unknownLanguage} with no recorded language`);
  if (publishedTooLongAgo > 0) {
    parts.push(`${publishedTooLongAgo} published too long ago to be worth showing`);
  }
  return parts.length === 0
    ? ''
    : `Also held but not counted: ${parts.join(', ')}.`;
}

/**
 * Should the caller invoke external discovery, and scoped how?
 *
 * Separated from the assessment so the decision is one obvious call at the site
 * that spends the money.
 */
export interface SweepDecision {
  sweep: boolean;
  languages: string[];
  reason: string;
}

export function decideSweep(assessment: CoverageAssessment): SweepDecision {
  if (assessment.verdict === 'COVERED') {
    return { sweep: false, languages: [], reason: assessment.rationale };
  }
  return {
    sweep: true,
    /*
     * A PARTIAL campaign sweeps only what is missing. Falling back to
     * "everything" here would re-buy the half already held, which is the exact
     * cost this module exists to avoid.
     *
     * An UNCOVERED campaign's gaps ARE every requested language, so the same
     * expression covers both — and a market-dimension-only gap yields an empty
     * language list with sweep still true, which the caller must read as "sweep,
     * unscoped" rather than "sweep nothing".
     */
    languages: assessment.sweepLanguages,
    reason: assessment.rationale,
  };
}
