/*
 * FIND PROPERTY — PAID SOCIAL OFFER CAMPAIGN: what to run, and what counts.
 *
 * The free search covers HOMATCH and the portals. The paid campaign looks where
 * people POST offers themselves — Facebook groups and pages, Instagram,
 * Telegram channels, VK — through memo23 Actors (owner scope 2026-10-16), for
 * one buyer's or tenant's confirmed search.
 *
 * Pure decisions only (no I/O):
 *   planOfferJobs   which Actor runs, in what order, so the ESTIMATED provider
 *                   spend never exceeds the campaign's 63% provider budget
 *   qualifyOffer    whether a post is an OFFER of the right kind in the right
 *                   place — a request ("looking for a flat") is never an offer
 */
import { classifyDirection } from '../signals/direction.ts';
import { extractCommunityListing, type CommunityListing } from '../discovery/community-listing.ts';
import { comparePlaces } from '../normalize/place.ts';

export const OFFER_CAMPAIGN_VERSION = 'fp-offers-1';

export type OfferNetwork = 'FACEBOOK' | 'INSTAGRAM' | 'TELEGRAM' | 'VK';
export const OFFER_NETWORKS: readonly OfferNetwork[] = ['FACEBOOK', 'INSTAGRAM', 'TELEGRAM', 'VK'];

/** Stage → registry actor key (the same keys Find Buyers uses; one registry, one switch). */
export const OFFER_STAGE_ACTOR = {
  FB_POST_SEARCH: 'FB_POST_SEARCH',
  FB_GROUP_POSTS: 'FB_GROUP_POSTS',
  FB_PAGE_POSTS: 'FB_PAGE_POSTS',
  IG_PROFILE_POSTS: 'IG_PROFILE_POSTS',
  TELEGRAM_CHANNEL: 'TELEGRAM_CHANNEL',
  VK_WALL: 'VK_POSTS_COMMENTS',
} as const;
export type OfferStage = keyof typeof OFFER_STAGE_ACTOR;

export const OFFER_STAGE_NETWORK: Readonly<Record<OfferStage, OfferNetwork>> = {
  FB_POST_SEARCH: 'FACEBOOK', FB_GROUP_POSTS: 'FACEBOOK', FB_PAGE_POSTS: 'FACEBOOK',
  IG_PROFILE_POSTS: 'INSTAGRAM', TELEGRAM_CHANNEL: 'TELEGRAM', VK_WALL: 'VK',
};

export interface OfferActor {
  actorKey: string;
  ready: boolean;
  startFeeMicros: number;
  pricePer1kMicros: number;
  probeSize: number;
}

export interface KnownOfferSource {
  id: string;
  network: OfferNetwork;
  /** FACEBOOK_GROUP / FACEBOOK_PAGE / TELEGRAM_GROUP / INSTAGRAM_PROFILE / VK_COMMUNITY */
  kind: string;
  url: string;
  city: string | null;
  /** Higher first. */
  priority: number;
}

export interface OfferSearch {
  transaction: 'SALE' | 'RENT';
  propertyType: string | null;
  city: string;
  districts: string[];
  languages: string[];
}

export interface PlannedOfferJob {
  stage: OfferStage;
  actorKey: string;
  network: OfferNetwork;
  query: string | null;
  /** The search language (keyword search); null for a known community (any language). */
  language?: string | null;
  targetUrl: string | null;
  sourceId: string | null;
  size: number;
  estimateMicros: number;
  priority: number;
}

export interface OfferPlan {
  version: string;
  jobs: PlannedOfferJob[];
  estimatedMicros: number;
  providerBudgetMicros: number;
  /** Networks the customer asked for that nothing can search right now, and why. */
  unavailable: Array<{ network: OfferNetwork; reason: 'NO_READY_ACTOR' | 'NO_KNOWN_SOURCE' }>;
  /** Jobs that would have run with more budget (said out loud, never silently dropped). */
  skippedForBudget: number;
}

const SEARCH_WORDS: Record<string, Record<'SALE' | 'RENT', string>> = {
  ka: { SALE: 'იყიდება ბინა', RENT: 'ქირავდება ბინა' },
  ru: { SALE: 'продается квартира', RENT: 'сдается квартира' },
  en: { SALE: 'apartment for sale', RENT: 'apartment for rent' },
};

export const estimateMicros = (a: Pick<OfferActor, 'startFeeMicros' | 'pricePer1kMicros'>, size: number) =>
  Math.ceil(Math.max(0, a.startFeeMicros) + (Math.max(0, size) * Math.max(0, a.pricePer1kMicros)) / 1000);

const stageForSource = (s: KnownOfferSource): OfferStage | null => {
  if (s.network === 'FACEBOOK') return /page/i.test(s.kind) ? 'FB_PAGE_POSTS' : 'FB_GROUP_POSTS';
  if (s.network === 'INSTAGRAM') return 'IG_PROFILE_POSTS';
  if (s.network === 'TELEGRAM') return 'TELEGRAM_CHANNEL';
  if (s.network === 'VK') return 'VK_WALL';
  return null;
};

/**
 * The plan. Sources in the searched city first (then city-unknown ones), by
 * priority; keyword search where its Actor is ready; then everything that fits
 * the provider budget by ESTIMATE. The reservation RPC enforces the same budget
 * against real spend, so the estimate can only make the plan smaller, never the
 * spend larger.
 */
export function planOfferJobs(input: {
  search: OfferSearch;
  networks: readonly OfferNetwork[];
  actors: Readonly<Record<string, OfferActor | undefined>>;
  sources: readonly KnownOfferSource[];
  providerBudgetMicros: number;
  /** Items per known source run (bounded by each actor's probe size when smaller is not set). */
  sizePerSource?: number;
  maxJobs?: number;
}): OfferPlan {
  const wanted = new Set(input.networks.filter((n) => OFFER_NETWORKS.includes(n)));
  const candidates: PlannedOfferJob[] = [];
  const unavailable: OfferPlan['unavailable'] = [];
  const ready = (stage: OfferStage) => {
    const a = input.actors[OFFER_STAGE_ACTOR[stage]];
    return a && a.ready ? a : null;
  };

  /* Keyword search over public Facebook posts, per language. */
  const fbSearch = wanted.has('FACEBOOK') ? ready('FB_POST_SEARCH') : null;
  if (fbSearch) {
    const place = [input.search.districts[0], input.search.city].filter(Boolean).join(' ');
    for (const lang of input.search.languages.filter((l) => SEARCH_WORDS[l])) {
      const size = Math.max(1, fbSearch.probeSize);
      candidates.push({
        stage: 'FB_POST_SEARCH', actorKey: fbSearch.actorKey, network: 'FACEBOOK', sourceId: null, targetUrl: null,
        query: `${SEARCH_WORDS[lang][input.search.transaction]} ${place}`.trim(), language: lang, size,
        estimateMicros: estimateMicros(fbSearch, size), priority: 100 - candidates.length,
      });
    }
  }

  const inCity = (s: KnownOfferSource) => !s.city || comparePlaces(s.city, input.search.city) !== 'CONFLICT';
  const sources = [...input.sources]
    .filter((s) => wanted.has(s.network) && /^https:\/\//.test(s.url) && inCity(s))
    .sort((a, b) => Number(Boolean(b.city)) - Number(Boolean(a.city)) || b.priority - a.priority || a.id.localeCompare(b.id));
  for (const s of sources) {
    const stage = stageForSource(s);
    const actor = stage ? ready(stage) : null;
    if (!stage || !actor) continue;
    const size = Math.max(1, Math.min(input.sizePerSource ?? actor.probeSize, actor.probeSize * 3));
    candidates.push({
      stage, actorKey: actor.actorKey, network: s.network, sourceId: s.id, targetUrl: s.url, query: null, size,
      estimateMicros: estimateMicros(actor, size), priority: s.priority,
    });
  }

  for (const n of wanted) {
    if (candidates.some((c) => c.network === n)) continue;
    const anyActor = (Object.keys(OFFER_STAGE_ACTOR) as OfferStage[])
      .some((st) => OFFER_STAGE_NETWORK[st] === n && ready(st));
    unavailable.push({ network: n, reason: anyActor ? 'NO_KNOWN_SOURCE' : 'NO_READY_ACTOR' });
  }

  /* Fit to the budget: round-robin across networks so one network cannot take it all. */
  const byNetwork = new Map<OfferNetwork, PlannedOfferJob[]>();
  for (const c of candidates) byNetwork.set(c.network, [...(byNetwork.get(c.network) ?? []), c]);
  const order: PlannedOfferJob[] = [];
  for (let i = 0; order.length < candidates.length; i++) {
    for (const list of byNetwork.values()) if (list[i]) order.push(list[i]);
  }
  const jobs: PlannedOfferJob[] = [];
  let spent = 0;
  let skipped = 0;
  const maxJobs = Math.max(1, input.maxJobs ?? 60);
  for (const job of order) {
    if (jobs.length < maxJobs && spent + job.estimateMicros <= input.providerBudgetMicros) {
      jobs.push(job); spent += job.estimateMicros;
    } else skipped += 1;
  }
  return { version: OFFER_CAMPAIGN_VERSION, jobs, estimatedMicros: spent, providerBudgetMicros: input.providerBudgetMicros, unavailable, skippedForBudget: skipped };
}

export type OfferVerdict =
  | { offer: true; listing: CommunityListing }
  | { offer: false; reason: 'NOT_AN_OFFER' | 'WRONG_TRANSACTION' | 'WRONG_CITY' | 'NOT_A_LISTING' | 'TOO_OLD' };

/**
 * A post is kept only when it OFFERS a property of the searched transaction in
 * the searched city (an unknown city is kept: comparePlaces decides later).
 */
export function qualifyOffer(text: string, search: Pick<OfferSearch, 'transaction' | 'city'>, opts: {
  sourceCity?: string | null; publishedAt?: string | null; now?: number; maxAgeDays?: number;
} = {}): OfferVerdict {
  const maxAge = opts.maxAgeDays ?? (search.transaction === 'RENT' ? 45 : 120);
  if (opts.publishedAt) {
    const age = ((opts.now ?? Date.now()) - Date.parse(opts.publishedAt)) / 86_400_000;
    if (Number.isFinite(age) && age > maxAge) return { offer: false, reason: 'TOO_OLD' };
  }
  const direction = classifyDirection(text);
  if (direction.direction === 'DEMAND') return { offer: false, reason: 'NOT_AN_OFFER' };
  const listing = extractCommunityListing(text, { sourceCity: opts.sourceCity ?? null });
  if (!listing) return { offer: false, reason: direction.direction === 'SUPPLY' ? 'NOT_A_LISTING' : 'NOT_AN_OFFER' };
  if (listing.transaction !== search.transaction) return { offer: false, reason: 'WRONG_TRANSACTION' };
  if (listing.city && comparePlaces(listing.city, search.city) === 'CONFLICT') return { offer: false, reason: 'WRONG_CITY' };
  return { offer: true, listing };
}
