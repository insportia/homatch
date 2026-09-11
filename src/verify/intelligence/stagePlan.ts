// HOMATCH — which research stages this verification actually has to run.
//
// A stage should be able to say why it is running. Today every verification
// runs all five regardless of what Homatch already knows, which is correct
// while it knows nothing and wasteful the moment it does.
//
// THIS RUNS IN SHADOW FIRST, AND THE ORDER MATTERS.
//
// The plan is computed, recorded against the job, and ACTED ON BY NOTHING.
// Every stage still runs exactly as it did. That is deliberate: §17 of the
// mandate says not to ship cheaper routing until a benchmark shows quality is
// materially equivalent, and you cannot benchmark a decision you have not
// measured. Recording the decision against real verifications is how the
// saving stops being a guess — and if the shadow plan turns out to propose
// skipping something a report needed, that shows up in a log rather than in
// somebody's due diligence.
//
// QUALITY WINS OVER THE COST TARGET, always. A stage whose facts are
// transaction-critical is never skipped on freshness alone: see
// ALWAYS_VERIFY below.

import { planRefresh, type FreshnessPolicy, type KnownFact, type RefreshPlan } from './freshness.ts';

/** The stages a verification runs, in order. */
export const STAGES = [
  'identity',
  'official_collection',
  'public_research',
  'market',
  'synthesis',
] as const;

export type StageName = (typeof STAGES)[number];

/**
 * What each stage is responsible for establishing.
 *
 * Keys are prefixes, matching the freshness policy's own convention, so a
 * stage covers a family of facts without listing every one.
 */
export const STAGE_FACTS: Record<StageName, string[]> = {
  // Which property this actually is, and what it belongs to.
  identity: ['parcel.code', 'address.full', 'project.identity'],
  // The registry: ownership, encumbrances, rights, the current record.
  official_collection: ['ownership.', 'encumbrance.', 'rights.', 'registry.', 'company.'],
  // The building, the developer, the reputation, the location.
  public_research: ['project.', 'building.', 'amenities.', 'construction.', 'commissioning.', 'permit.', 'location.'],
  // Comparables and asking prices.
  market: ['listing.', 'market.'],
  // The report itself, written from everything above.
  synthesis: [],
};

/*
 * STAGES THAT RUN WHATEVER WE ALREADY KNOW.
 *
 * official_collection establishes ownership, mortgages, seizures and
 * restrictions — the facts a buyer is exposed to between agreeing a price and
 * signing, and the ones a wrong answer actually harms somebody over. Their
 * freshness policy is six hours precisely because they can change that fast,
 * so in practice they will almost always be stale anyway; this makes it a
 * rule rather than an accident of configuration.
 *
 * synthesis writes the report. There is no version of a Verify that does not
 * produce one.
 */
export const ALWAYS_VERIFY: StageName[] = ['official_collection', 'synthesis'];

export interface StageDecision {
  stage: StageName;
  /** What the plan says. In shadow mode nothing acts on it. */
  wouldRun: boolean;
  reason: string;
  missing: string[];
  stale: string[];
  conflicting: string[];
  reused: string[];
}

export interface VerificationPlan {
  decisions: StageDecision[];
  /** Stages the plan would skip. Empty until the graph knows something. */
  wouldSkip: StageName[];
  /** How many of the facts needed were already known and fresh. */
  reusableFacts: number;
  requiredFacts: number;
  /** A one-line internal summary, recorded against the job. */
  summary: string;
}

/**
 * Expands a stage's prefixes against the facts we actually hold.
 *
 * A prefix with no matching known fact still yields one required key — the
 * prefix itself — so a stage that has never run counts as MISSING rather than
 * silently having nothing to do.
 */
function requiredKeysFor(stage: StageName, held: readonly KnownFact[]): string[] {
  const prefixes = STAGE_FACTS[stage];
  const keys = new Set<string>();
  for (const p of prefixes) {
    if (!p.endsWith('.')) { keys.add(p); continue; }
    const matching = held.filter((f) => f.fact_key?.startsWith(p));
    if (matching.length) for (const f of matching) keys.add(f.fact_key);
    else keys.add(p);
  }
  return [...keys];
}

/**
 * What this verification would have to research, given what we already know.
 *
 * `held` is every CURRENT fact about this property AND about the things it
 * belongs to — its parcel, its project, the company that built it — because
 * that is where reuse actually pays. A second flat in the same building needs
 * none of the project research the first one paid for.
 */
export function planVerification(
  held: readonly KnownFact[] | null | undefined,
  policies: readonly FreshnessPolicy[] | null | undefined,
  now: Date | number = Date.now()
): VerificationPlan {
  const facts = (held ?? []).filter((f) => f && f.fact_key);
  const decisions: StageDecision[] = [];
  let reusableFacts = 0;
  let requiredFacts = 0;

  for (const stage of STAGES) {
    const required = requiredKeysFor(stage, facts);
    requiredFacts += required.length;

    const plan: RefreshPlan = planRefresh(required, facts, policies, now);
    reusableFacts += plan.reuse.length;

    const missing = plan.refresh.filter((a) => a.state === 'MISSING').map((a) => a.factKey);
    const stale = plan.refresh.filter((a) => a.state === 'STALE').map((a) => a.factKey);
    const conflicting = plan.refresh.filter((a) => a.state === 'CONFLICTING').map((a) => a.factKey);

    const mustRun = ALWAYS_VERIFY.includes(stage);
    const wouldRun = mustRun || plan.needsResearch;

    decisions.push({
      stage,
      wouldRun,
      reason: mustRun
        ? 'always verified: transaction-critical or produces the report'
        : plan.needsResearch
          ? plan.reason
          : `everything needed is known and fresh (${plan.reuse.length})`,
      missing,
      stale,
      conflicting,
      reused: plan.reuse.map((a) => a.factKey),
    });
  }

  const wouldSkip = decisions.filter((d) => !d.wouldRun).map((d) => d.stage);

  return {
    decisions,
    wouldSkip,
    reusableFacts,
    requiredFacts,
    summary: wouldSkip.length
      ? `${reusableFacts}/${requiredFacts} facts reusable; would skip ${wouldSkip.join(', ')}`
      : `${reusableFacts}/${requiredFacts} facts reusable; every stage has work to do`,
  };
}
