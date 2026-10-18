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
export type ActorProduces = 'DEMAND_POSTS' | 'LISTING_POSTS' | 'SOURCES' | 'COMMENTS' | 'PROFILE_POSTS' | 'CHANNEL_MESSAGES';
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
    why: 'Comments of qualifying posts already found (group, Page or searched posts).' },
  FB_POST_SEARCH: { cls: 'PRIMARY_DISCOVERY', produces: 'LISTING_POSTS', needsSeed: false, seededBy: null,
    why: 'Public Facebook posts by listing keyword — agency, developer and competitor Pages and individual listings — whose comments are where buyers ask; logged out, so no engagement counts.' },
  FB_KEYWORD_SEARCH: { cls: 'PRIMARY_DISCOVERY', produces: 'DEMAND_POSTS', needsSeed: false, seededBy: null,
    why: 'Public Facebook posts found by buyer/tenant phrases in six languages (tropical_thunderstuck~facebook-post-search): people asking for a home, beyond the groups HOMATCH knows.' },
  FB_PAGE_POSTS: { cls: 'ENRICHMENT', produces: 'LISTING_POSTS', needsSeed: true, seededBy: 'FB_POST_SEARCH',
    why: 'Recent posts of a public Page that published a comparable listing, with their visible comments attached (public Pages only, no login).' },
  FB_AD_LIBRARY: { cls: 'PRIMARY_DISCOVERY', produces: 'LISTING_POSTS', needsSeed: false, seededBy: null,
    why: 'Active property ads in the Meta Ad Library (competitor developments, agencies). An ad is never a buyer and the Library has no comments; a comparable ad leads to its Page, whose feed is read with comments attached.' },
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
  /** NULL = no per-Actor cap (2026-10-12): the campaign provider budget is the only bound. */
  campaign_spend_cap_micros: number | null;
}

export interface ProofLine {
  actorKey: string;
  probeMicros: number | null;
  maxMicros: number | null;
  capMicros: number | null;
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
 * maximum provider exposure is the provider budget (or less, when every chosen
 * Actor still carries a per-Actor cap); the customer is never charged more
 * than the reservation.
 */
export function proofPlan(actors: ProofActor[], opts: { credits: number; creditsPerUsd: number; providerShareBps: number }): ProofPlan {
  const lines = actors.map((a) => {
    const probe = runEstimateMicros(a, a.probe_size);
    const max = runEstimateMicros(a, a.max_results);
    return { actorKey: a.actor_key, probeMicros: probe, maxMicros: max == null ? null : a.campaign_spend_cap_micros == null ? max : Math.min(max, a.campaign_spend_cap_micros),
      capMicros: a.campaign_spend_cap_micros ?? null, priced: probe != null };
  });
  const budget = Math.floor(opts.credits / opts.creditsPerUsd * 1e6 * opts.providerShareBps / 10000);
  const unpriced = lines.filter((l) => !l.priced).map((l) => l.actorKey);
  const estimated = unpriced.length ? null : lines.reduce((s, l) => s + (l.probeMicros ?? 0), 0);
  const capped = lines.every((l) => l.capMicros != null);
  const maxProvider = capped ? Math.min(budget, lines.reduce((s, l) => s + (l.capMicros ?? 0), 0)) : budget;
  return { lines, estimatedProviderMicros: estimated, maxProviderMicros: maxProvider,
    customerReservationCredits: opts.credits, maxCustomerChargeCredits: opts.credits, unpriced };
}

/** A real run proves its output contract only with real text at a real public URL. */
export function provesOutputContract(items: ReadonlyArray<{ text?: string | null; url?: string | null }>): boolean {
  return items.some((i) => typeof i.text === 'string' && i.text.trim().length >= 3
    && typeof i.url === 'string' && /^https:\/\/[^\s/]+\.[^\s/]+\//.test(i.url));
}

/**
 * Actors HOMATCH knows how to use but registers only when an admin verifies
 * them (Admin → Find Buyers → Actors → Register & verify): the row is written
 * DISABLED, its price and input schema are then read from Apify, and an
 * operator enables it separately. Nothing here runs or spends.
 */
export interface RegistrySeed {
  actor_key: string; actor_id: string; source: 'FACEBOOK'; purpose: 'SEARCH' | 'POSTS_AND_COMMENTS';
  role: 'PRIMARY'; priority: number; probe_size: number; max_results: number; timeout_seconds: number; concurrency: number; notes: string;
}
export const REGISTRY_SEEDS: Readonly<Record<string, RegistrySeed>> = {
  FB_POST_SEARCH: {
    actor_key: 'FB_POST_SEARCH', actor_id: 'memo23~facebook-search-scraper', source: 'FACEBOOK', purpose: 'SEARCH',
    role: 'PRIMARY', priority: 55, probe_size: 15, max_results: 60, timeout_seconds: 300, concurrency: 2,
    notes: 'Public posts by listing keyword (Pages, agencies, developers, individual listings); no engagement counts when logged out',
  },
  /* The one non-memo23 Actor (owner, 2026-10-18), allowed by name in memo23Client. Registered
     disabled and unpriced; Admin → Verify reads its real price and input schema from Apify. */
  FB_KEYWORD_SEARCH: {
    actor_key: 'FB_KEYWORD_SEARCH', actor_id: 'tropical_thunderstuck~facebook-post-search', source: 'FACEBOOK', purpose: 'SEARCH',
    role: 'PRIMARY', priority: 58, probe_size: 30, max_results: 100, timeout_seconds: 300, concurrency: 2,
    notes: 'Public Facebook posts by buyer/tenant keyword, several phrases per run (keyword batch size and search window: admin_settings find_buyers_fb_keyword_search)',
  },
  FB_PAGE_POSTS: {
    actor_key: 'FB_PAGE_POSTS', actor_id: 'memo23~facebook-page-posts-scraper', source: 'FACEBOOK', purpose: 'POSTS_AND_COMMENTS',
    role: 'PRIMARY', priority: 50, probe_size: 10, max_results: 40, timeout_seconds: 300, concurrency: 2,
    notes: 'Feeds of public Pages that published a comparable listing, comments attached (includeComments); public Pages only',
  },
  FB_AD_LIBRARY: {
    actor_key: 'FB_AD_LIBRARY', actor_id: 'memo23~facebook-ads-library-scraper-ppe', source: 'FACEBOOK', purpose: 'SEARCH',
    role: 'PRIMARY', priority: 52, probe_size: 20, max_results: 50, timeout_seconds: 240, concurrency: 1,
    notes: 'Competitor property ads by listing phrase and country (Meta Ad Library); no comments — comparable ads queue their Page feed',
  },
};
