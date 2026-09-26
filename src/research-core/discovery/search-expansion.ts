// SEARCHING DEEPER WITHOUT BUYING THE SAME THING TWICE.
//
// A campaign's first sweep reads the sources the customer's entitlement allows
// and records what it therefore did not touch — that is `discovery_headroom` on
// matching_jobs, and until now nothing read it. A customer could not find out
// that more was available without paying for another whole search.
//
// This module is the arithmetic behind offering them the rest. It decides three
// things and nothing else:
//
//   eligibility  is there genuinely more to read, and is this campaign in a
//                state where reading it makes sense?
//   exclusion    which sources has this campaign already paid to read?
//   identity     is this expansion the same one the customer already authorised?
//
// WHY EXCLUSION IS A LIST OF IDS AND NOT AN ARITHMETIC ON TIERS
//
// The tempting version was "the first run covered up to tier N, so the expansion
// covers N+1 upwards". It is wrong in both directions. A source can be skipped
// for reasons that have nothing to do with the tier — it was DEGRADED that
// morning, its circuit breaker was open, its adapter returned UNSUPPORTED for
// that city — and it would then never be reached by any expansion, because the
// arithmetic believes its whole tier is done. And a source can be inside the
// original ceiling and still be re-read by a tier rule that does not know it was
// already read, which is the customer paying twice.
//
// So the expansion excludes exactly the sources that were actually read, by id.
// The record of what was read is the authority; the tier is a budget, not a
// receipt.
//
// WHAT THIS IS NOT
//
// It is not a second billing path. The incremental amount is authorised through
// the same PAYG reservation every search uses, and this module produces the
// NUMBER of sources involved, never a price: prices come from the price book,
// which has effective dates, and a second opinion about cost here would disagree
// with it inside a month.
//
// It is not an upsell. Nothing here knows about plans, and nothing here can
// decide that a deeper search requires a subscription. A PAYG customer who
// authorises credits gets the depth they paid for — see search-budget.ts, where
// PAYG makes the plan's tier a floor rather than a wall.

/**
 * What the previous sweep recorded about its own reach.
 *
 * This is `matching_jobs.discovery_headroom`, already written in the customer's
 * vocabulary: no tier numbers, no adapter ids, no supplier names, no costs.
 */
export interface DiscoveryHeadroom {
  searchDepth: string | null;
  sourcesSearched: number;
  sourcesAvailableDeeper: number;
  resultCeiling: number | null;
  moreAvailable: boolean;
}

export type ExpansionRefusal =
  /** The previous run never recorded its reach, so nothing is known. */
  | 'NO_HEADROOM_RECORDED'
  /** Everything available was already read. */
  | 'NOTHING_DEEPER'
  /** The campaign is not in a state where a further sweep makes sense. */
  | 'CAMPAIGN_NOT_READY'
  /** This exact expansion has already been authorised. */
  | 'ALREADY_EXPANDED';

export interface ExpansionPlan {
  eligible: boolean;
  refusal?: ExpansionRefusal;
  /**
   * Adapter ids this expansion must NOT read, because the campaign already
   * paid to read them. Sorted, so the identity key below is stable.
   */
  excludeSourceIds: string[];
  /** How many more sources the previous sweep said exist. A count, never a list. */
  additionalSourcesAvailable: number;
  /**
   * Stable identity for this expansion. Two clicks on the same button produce
   * the same key, and the reservation behind it is therefore claimed once.
   */
  idempotencyKey: string;
  /** Plain English, for the operator log rather than the customer screen. */
  rationale: string;
}

/** Campaign states in which reading more sources is a coherent request. */
const EXPANDABLE_STATES = new Set(['ACTIVE', 'COMPLETED', 'PARTIAL']);

/**
 * Job states after which the first sweep's record can be trusted.
 *
 * A RUNNING job has not finished deciding what it read, and expanding from it
 * would exclude a list that is still growing — which is the customer paying for
 * a source the first sweep was about to read anyway.
 */
const SETTLED_JOB_STATES = new Set(['COMPLETED', 'COMPLETED_WITH_ERRORS', 'PARTIAL', 'FAILED']);

export interface PlanExpansionInput {
  campaignId: string;
  /** The job whose reach is being extended. */
  previousJobId: string;
  previousJobStatus: string;
  campaignStatus: string;
  headroom: DiscoveryHeadroom | null;
  /**
   * Every adapter id this campaign has already read, across all its sweeps.
   * Not just the last one: a campaign expanded twice must not re-read what the
   * first expansion covered.
   */
  sourcesAlreadyRead: readonly string[];
  /** Expansions already authorised for this campaign, by idempotency key. */
  priorExpansionKeys?: readonly string[];
}

export function planExpansion(input: PlanExpansionInput): ExpansionPlan {
  const excludeSourceIds = [...new Set(
    input.sourcesAlreadyRead.map((id) => id.trim()).filter((id) => id.length > 0),
  )].sort();

  const idempotencyKey = expansionIdempotencyKey(
    input.campaignId, input.previousJobId, excludeSourceIds,
  );

  const refuse = (refusal: ExpansionRefusal, rationale: string): ExpansionPlan => ({
    eligible: false, refusal, excludeSourceIds,
    additionalSourcesAvailable: Math.max(0, Number(input.headroom?.sourcesAvailableDeeper ?? 0)),
    idempotencyKey, rationale,
  });

  if (!SETTLED_JOB_STATES.has(input.previousJobStatus)) {
    return refuse('CAMPAIGN_NOT_READY',
      `the previous search is ${input.previousJobStatus}: what it read is still changing, and `
      + 'excluding a list that is still growing would charge for a source it was about to read');
  }

  if (!EXPANDABLE_STATES.has(input.campaignStatus)) {
    return refuse('CAMPAIGN_NOT_READY',
      `the campaign is ${input.campaignStatus}, which is not a state a further sweep belongs in`);
  }

  /*
   * NO HEADROOM IS NOT "NOTHING DEEPER".
   *
   * A sweep that never wrote its reach — it failed early, or it ran before the
   * column existed — has told us nothing. Reporting that as "you have seen
   * everything" would be inventing a fact, and it is the difference between a
   * quiet button and a wrong one.
   */
  if (!input.headroom) {
    return refuse('NO_HEADROOM_RECORDED',
      'the previous search recorded no reach, so whether more sources exist is unknown. Offering '
      + 'nothing is right here; claiming the search was complete would not be');
  }

  const deeper = Math.max(0, Number(input.headroom.sourcesAvailableDeeper ?? 0));
  if (deeper === 0 || input.headroom.moreAvailable !== true) {
    return refuse('NOTHING_DEEPER',
      `the previous search reached ${input.headroom.sourcesSearched} source(s) and recorded none `
      + 'left unread. There is nothing to sell');
  }

  if ((input.priorExpansionKeys ?? []).includes(idempotencyKey)) {
    return refuse('ALREADY_EXPANDED',
      'this exact expansion is already authorised; the same click must not reserve twice');
  }

  return {
    eligible: true,
    excludeSourceIds,
    additionalSourcesAvailable: deeper,
    idempotencyKey,
    rationale:
      `${deeper} source(s) were left unread by a sweep that reached `
      + `${input.headroom.sourcesSearched}. The expansion excludes the `
      + `${excludeSourceIds.length} source(s) this campaign has already paid to read, so it buys `
      + 'only work that has not been done',
  };
}

/**
 * The identity of an expansion.
 *
 * Deliberately built from the campaign, the job being extended and the EXACT set
 * of sources being excluded. A second click changes none of those, so it claims
 * the same reservation. A genuinely different expansion — after a first one has
 * read three more sources — changes the exclusion set and is therefore a
 * different purchase, which is correct: it is different work.
 *
 * No timestamp, no random component. Either of those would make every click a
 * new purchase, which is the bug this exists to prevent.
 */
export function expansionIdempotencyKey(
  campaignId: string,
  previousJobId: string,
  excludeSourceIds: readonly string[],
): string {
  const sources = [...excludeSourceIds].sort().join(',');
  return `expand:${campaignId}:${previousJobId}:${fingerprint(sources)}`;
}

/**
 * A short, stable fingerprint.
 *
 * FNV-1a, because the key has to be identical in a Deno Edge Function, in the
 * browser and in the Node test runner, and `node:crypto` exists in exactly one
 * of those. This is an identity, never a security boundary: a collision would
 * make two different expansions share a reservation, which the server's own
 * reservation row would then reject as already claimed — the safe direction.
 */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/* ────────────────────────────────────────────────────────────────────────
 * What the customer is told
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The counts a customer-facing panel may render, and nothing else.
 *
 * This function exists so the screen cannot accidentally reach past it. It
 * returns numbers and a boolean; it returns no tier, no adapter id, no supplier
 * name, no cost and no plan code, because there is nowhere in its return type to
 * put one. The wording itself lives in the i18n table, where it can be
 * translated and reviewed.
 */
export interface CustomerFacingHeadroom {
  searched: number;
  deeperAvailable: number;
  /** Should the offer be shown at all? */
  offerExpansion: boolean;
}

export function customerFacingHeadroom(
  headroom: DiscoveryHeadroom | null,
): CustomerFacingHeadroom {
  if (!headroom) return { searched: 0, deeperAvailable: 0, offerExpansion: false };

  const searched = Math.max(0, Math.trunc(Number(headroom.sourcesSearched) || 0));
  const deeperAvailable = Math.max(0, Math.trunc(Number(headroom.sourcesAvailableDeeper) || 0));

  return {
    searched,
    deeperAvailable,
    offerExpansion: headroom.moreAvailable === true && deeperAvailable > 0 && searched > 0,
  };
}

/**
 * Narrow a source list to the ones an expansion should actually read.
 *
 * The server applies this AFTER its entitlement gate, never instead of it: an
 * expansion widens what a customer paid for, and it must not be able to reach a
 * source the gate refused for a reason of its own.
 */
export function withoutAlreadyRead<T extends { id: string }>(
  sources: readonly T[],
  excludeSourceIds: readonly string[],
): { fresh: T[]; skipped: Array<{ id: string; reason: string; detail: string }> } {
  const exclude = new Set(excludeSourceIds.map((id) => id.trim()).filter(Boolean));
  const fresh: T[] = [];
  const skipped: Array<{ id: string; reason: string; detail: string }> = [];

  for (const source of sources) {
    if (exclude.has(source.id)) {
      skipped.push({
        id: source.id,
        reason: 'ALREADY_READ',
        detail: 'this campaign has already paid to read this source; an expansion buys new work only',
      });
      continue;
    }
    fresh.push(source);
  }

  return { fresh, skipped };
}
