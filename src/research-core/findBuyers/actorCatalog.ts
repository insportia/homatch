// FIND BUYERS / FIND TENANTS — what each memo23 Actor is FOR, how far it has
// been proven, and what a proof run may cost. Pure: no I/O, used by the admin
// center and by the next-test planner.
//
// CLASS (grounded in campaignPlan.ts + actorInputs.ts, not in store marketing):
//   PRIMARY_DISCOVERY — reaches people who are not yet known to HOMATCH, by
//                       keyword or by the public groups a keyword finds.
//   ENRICHMENT        — reads more from a source or post HOMATCH already has
//                       (comments of a qualifying post, a known profile).
//   UNSUITABLE        — duplicates a free native path or cannot reach
//                       Georgian demand without a login.
// LIFECYCLE (derived from registry facts, never stored by hand):
//   REGISTERED → VERIFIED (pricing + input contract read from Apify, free)
//   → PROVEN (a real run returned real items: output contract verified)
//   → ACTIVE (proven and enabled). DISABLED / BLOCKED override.
// Metadata never proves an Actor works; only a real run does.

export type ActorClass = 'PRIMARY_DISCOVERY' | 'ENRICHMENT' | 'UNSUITABLE';
export type ActorProduces = 'DEMAND_POSTS' | 'SOURCES' | 'COMMENTS' | 'PROFILE_POSTS' | 'CHANNEL_MESSAGES';
export type ActorLifecycle = 'REGISTERED' | 'VERIFIED' | 'PROVEN' | 'ACTIVE' | 'DISABLED' | 'BLOCKED';

export interface ActorProfile {
  cls: ActorClass;
  produces: ActorProduces;
  /** Needs a seed (a group, profile, channel or post URL) before it can run. */
  needsSeed: boolean;
  /** Actor whose output seeds this one inside the same campaign plan. */
  seededBy: string | null;
  why: string;
}

export const ACTOR_PROFILES: Readonly<Record<string, ActorProfile>> = {
  FB_GROUP_SEARCH: { cls: 'PRIMARY_DISCOVERY', produces: 'SOURCES', needsSeed: false, seededBy: null,
    why: 'Finds the public Facebook groups where Georgian property demand is posted; feeds FB_GROUP_POSTS.' },
  FB_GROUP_POSTS: { cls: 'PRIMARY_DISCOVERY', produces: 'DEMAND_POSTS', needsSeed: true, seededBy: 'FB_GROUP_SEARCH',
    why: 'Recent posts of public groups: the main channel where people write "looking to buy/rent".' },
  TIKTOK: { cls: 'PRIMARY_DISCOVERY', produces: 'DEMAND_POSTS', needsSeed: false, seededBy: null,
    why: 'Keyword and hashtag search; posts and their comments.' },
  LINKEDIN_POSTS: { cls: 'PRIMARY_DISCOVERY', produces: 'DEMAND_POSTS', needsSeed: false, seededBy: null,
    why: 'Public posts by keyword (relocation, corporate housing).' },
  REDDIT: { cls: 'PRIMARY_DISCOVERY', produces: 'DEMAND_POSTS', needsSeed: false, seededBy: null,
    why: 'Site-wide keyword search; low Georgian volume, expat demand only.' },
  QUORA: { cls: 'PRIMARY_DISCOVERY', produces: 'DEMAND_POSTS', needsSeed: false, seededBy: null,
    why: 'Questions by keyword; low Georgian volume.' },
  BLUESKY: { cls: 'PRIMARY_DISCOVERY', produces: 'DEMAND_POSTS', needsSeed: false, seededBy: null,
    why: 'Keyword search filtered by date; very low Georgian volume.' },
  LINKEDIN_GROUPS: { cls: 'UNSUITABLE', produces: 'SOURCES', needsSeed: false, seededBy: null,
    why: 'Quarantined: the Actor requires a logged-in LinkedIn session (input.cookies), which HOMATCH does not hold (production run refused, HTTP 400).' },
  FB_COMMENTS: { cls: 'ENRICHMENT', produces: 'COMMENTS', needsSeed: true, seededBy: 'FB_GROUP_POSTS',
    why: 'Comments of qualifying posts already found.' },
  IG_COMMENTS: { cls: 'ENRICHMENT', produces: 'COMMENTS', needsSeed: true, seededBy: 'IG_PROFILE_POSTS',
    why: 'Comments of qualifying Instagram posts already found.' },
  YOUTUBE_COMMENTS: { cls: 'ENRICHMENT', produces: 'COMMENTS', needsSeed: true, seededBy: null,
    why: 'Comments of known property videos from the source registry.' },
  IG_PROFILE_POSTS: { cls: 'ENRICHMENT', produces: 'PROFILE_POSTS', needsSeed: true, seededBy: null,
    why: 'Known public profiles; mostly agent promotion, demand appears in comments.' },
  X_PROFILE: { cls: 'ENRICHMENT', produces: 'PROFILE_POSTS', needsSeed: true, seededBy: null,
    why: 'Known public profiles only (no search).' },
  THREADS_PROFILE: { cls: 'ENRICHMENT', produces: 'PROFILE_POSTS', needsSeed: true, seededBy: null,
    why: 'Known public profiles only (no search).' },
  VK_POSTS_COMMENTS: { cls: 'ENRICHMENT', produces: 'DEMAND_POSTS', needsSeed: true, seededBy: null,
    why: 'Walls of known VK communities (Russian-speaking demand), filtered by keyword and date.' },
  TELEGRAM_CHANNEL: { cls: 'UNSUITABLE', produces: 'CHANNEL_MESSAGES', needsSeed: true, seededBy: null,
    why: 'Not planned by the generic planner: queued only for Telegram channels the free native reader does not cover (COMBINED, after Phase 1), never on a channel the free reader reads.' },
};

export function classifyActor(actorKey: string): ActorProfile {
  return ACTOR_PROFILES[actorKey]
    ?? { cls: 'UNSUITABLE', produces: 'DEMAND_POSTS', needsSeed: true, seededBy: null, why: 'Not in the catalog; never planned.' };
}

export interface ActorFacts {
  enabled: boolean;
  emergency_disabled?: boolean | null;
  health?: string | null;
  pricing_model?: string | null;
  price_per_1k_micros?: number | null;
  pricing_verified_at?: string | null;
  input_contract_verified_at?: string | null;
  output_contract_verified_at?: string | null;
}

export function actorLifecycle(a: ActorFacts): ActorLifecycle {
  if (a.emergency_disabled || a.health === 'DISABLED') return 'DISABLED';
  if (a.health === 'FAILED') return 'BLOCKED';
  const verified = Boolean(a.pricing_verified_at && a.input_contract_verified_at
    && a.pricing_model && a.pricing_model !== 'UNKNOWN' && a.price_per_1k_micros != null);
  const proven = verified && Boolean(a.output_contract_verified_at);
  if (proven && a.enabled) return 'ACTIVE';
  if (proven) return 'PROVEN';
  if (verified) return 'VERIFIED';
  return 'REGISTERED';
}

/** Same formula as find_buyers_reserve_actor_run: start fee + limit × price/1k. */
export function runEstimateMicros(a: { start_fee_micros?: number | null; price_per_1k_micros?: number | null }, limit: number): number | null {
  if (a.price_per_1k_micros == null) return null;
  return Number(a.start_fee_micros ?? 0) + Math.ceil(limit * Number(a.price_per_1k_micros) / 1000);
}

export interface ProofActor extends ActorFacts {
  actor_key: string;
  start_fee_micros?: number | null;
  probe_size: number;
  max_results: number;
  campaign_spend_cap_micros: number;
}

export interface ProofLine {
  actorKey: string;
  probeMicros: number | null;
  maxMicros: number | null;
  capMicros: number;
  priced: boolean;
}

export interface ProofPlan {
  lines: ProofLine[];
  estimatedProviderMicros: number | null;
  maxProviderMicros: number;
  customerReservationCredits: number;
  maxCustomerChargeCredits: number;
  unpriced: string[];
}

/**
 * The bound of one user-triggered proof search over the chosen Actors. The
 * maximum provider exposure is min(sum of per-Actor campaign caps, provider
 * budget); the customer is never charged more than the reservation.
 */
export function proofPlan(actors: ProofActor[], opts: { credits: number; creditsPerUsd: number; providerShareBps: number }): ProofPlan {
  const lines = actors.map((a) => {
    const probe = runEstimateMicros(a, a.probe_size);
    const max = runEstimateMicros(a, a.max_results);
    return { actorKey: a.actor_key, probeMicros: probe, maxMicros: max == null ? null : Math.min(max, a.campaign_spend_cap_micros),
      capMicros: a.campaign_spend_cap_micros, priced: probe != null };
  });
  const budget = Math.floor(opts.credits / opts.creditsPerUsd * 1e6 * opts.providerShareBps / 10000);
  const unpriced = lines.filter((l) => !l.priced).map((l) => l.actorKey);
  const estimated = unpriced.length ? null : lines.reduce((s, l) => s + (l.probeMicros ?? 0), 0);
  const maxProvider = Math.min(budget, lines.reduce((s, l) => s + l.capMicros, 0));
  return { lines, estimatedProviderMicros: estimated, maxProviderMicros: maxProvider,
    customerReservationCredits: opts.credits, maxCustomerChargeCredits: opts.credits, unpriced };
}

/** A real run proves its output contract only with real text at a real public URL. */
export function provesOutputContract(items: ReadonlyArray<{ text?: string | null; url?: string | null }>): boolean {
  return items.some((i) => typeof i.text === 'string' && i.text.trim().length >= 3
    && typeof i.url === 'string' && /^https:\/\/[^\s/]+\.[^\s/]+\//.test(i.url));
}
