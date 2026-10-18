/*
 * FIND PROPERTY — PAID SOCIAL OFFER CAMPAIGN: what to run, and what counts.
 *
 * The free search covers HOMATCH and the portals. The paid campaign looks where
 * people POST offers themselves — Facebook groups, Instagram, Telegram
 * channels, TikTok — through memo23 Actors (owner scope 2026-10-16), for
 * one buyer's or tenant's confirmed search.
 *
 * Pure decisions only (no I/O):
 *   planOfferJobs   which Actor runs, in what order, so the ESTIMATED provider
 *                   spend never exceeds the campaign's 63% provider budget.
 *                   Runs are BATCHED (owner, 2026-10-18): every Facebook group
 *                   of the city goes into one memo23 group run per keyword, the
 *                   Telegram channels into a few large runs, Instagram reads the
 *                   known Instagram profiles in a run, TikTok searches the keywords — a few
 *                   full runs instead of dozens of one-community probes that each
 *                   paid a start fee and queued for one of four global slots.
 *   qualifyOffer    whether a post is an OFFER of the right kind in the right
 *                   place — a request ("looking for a flat") is never an offer
 */
import { classifyDirection } from '../signals/direction.ts';
import { extractCommunityListing, type CommunityListing } from '../discovery/community-listing.ts';
import { comparePlaces } from '../normalize/place.ts';

export const OFFER_CAMPAIGN_VERSION = 'fp-offers-2';

export type OfferNetwork = 'FACEBOOK' | 'INSTAGRAM' | 'TELEGRAM' | 'TIKTOK' | 'VK';
export const OFFER_NETWORKS: readonly OfferNetwork[] = ['FACEBOOK', 'INSTAGRAM', 'TELEGRAM', 'TIKTOK', 'VK'];

/** Stage → registry actor key (the same keys Find Buyers uses; one registry, one switch). */
export const OFFER_STAGE_ACTOR = {
  FB_POST_SEARCH: 'FB_POST_SEARCH',
  FB_GROUP_POSTS: 'FB_GROUP_POSTS',
  FB_PAGE_POSTS: 'FB_PAGE_POSTS',
  IG_PROFILE_POSTS: 'IG_PROFILE_POSTS',
  TELEGRAM_CHANNEL: 'TELEGRAM_CHANNEL',
  TIKTOK_SEARCH: 'TIKTOK',
  VK_WALL: 'VK_POSTS_COMMENTS',
} as const;
export type OfferStage = keyof typeof OFFER_STAGE_ACTOR;

export const OFFER_STAGE_NETWORK: Readonly<Record<OfferStage, OfferNetwork>> = {
  FB_POST_SEARCH: 'FACEBOOK', FB_GROUP_POSTS: 'FACEBOOK', FB_PAGE_POSTS: 'FACEBOOK',
  IG_PROFILE_POSTS: 'INSTAGRAM', TELEGRAM_CHANNEL: 'TELEGRAM', TIKTOK_SEARCH: 'TIKTOK', VK_WALL: 'VK',
};

export interface OfferActor {
  actorKey: string;
  ready: boolean;
  startFeeMicros: number;
  pricePer1kMicros: number;
  probeSize: number;
  /** The registry's per-run result cap (the reservation never asks for more). */
  maxResults?: number;
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

/** One community a batched run reads, with what HOMATCH knows about it. */
export interface OfferTarget { url: string; sourceId: string | null; city: string | null }

export interface PlannedOfferJob {
  stage: OfferStage;
  actorKey: string;
  network: OfferNetwork;
  /** The run's first keyword (shown in Admin); every keyword is in `queries`. */
  query: string | null;
  /** Keywords the run searches (Facebook in-group search, TikTok search). */
  queries: string[];
  /** The search language of the keywords; null for a community read (any language). */
  language?: string | null;
  /** Legacy single target (pre-batching rows); batched runs use `targets`. */
  targetUrl: string | null;
  /** Every community this run reads (batched Facebook groups, Telegram channels, Instagram pages). */
  targets: OfferTarget[];
  /** Communities or keywords the run covers: the reservation allows max_results for each (≤ 25, ≤ 1000 items). */
  targetCount: number;
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

/*
 * Keyword search words: what a person who OFFERS this kind of property writes, per
 * language, per transaction. Georgian, Russian and English cover most Georgian
 * posts; Turkish, Arabic and Hebrew posts are common in Batumi and Tbilisi groups
 * for foreign buyers, so the customer's own language is searched too.
 */
export const OFFER_LANGUAGES = ['ka', 'ru', 'en', 'tr', 'ar', 'he'] as const;
type PropertyKind = 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL';
export const SEARCH_WORDS: Record<string, Record<PropertyKind, Record<'SALE' | 'RENT', string>>> = {
  ka: { APARTMENT: { SALE: 'იყიდება ბინა', RENT: 'ქირავდება ბინა' }, HOUSE: { SALE: 'იყიდება სახლი', RENT: 'ქირავდება სახლი' },
        LAND: { SALE: 'იყიდება მიწის ნაკვეთი', RENT: 'ქირავდება მიწის ნაკვეთი' }, COMMERCIAL: { SALE: 'იყიდება კომერციული ფართი', RENT: 'ქირავდება კომერციული ფართი' } },
  ru: { APARTMENT: { SALE: 'продается квартира', RENT: 'сдается квартира' }, HOUSE: { SALE: 'продается дом', RENT: 'сдается дом' },
        LAND: { SALE: 'продается участок', RENT: 'сдается участок' }, COMMERCIAL: { SALE: 'продается коммерческое помещение', RENT: 'сдается коммерческое помещение' } },
  en: { APARTMENT: { SALE: 'apartment for sale', RENT: 'apartment for rent' }, HOUSE: { SALE: 'house for sale', RENT: 'house for rent' },
        LAND: { SALE: 'land for sale', RENT: 'land for rent' }, COMMERCIAL: { SALE: 'commercial space for sale', RENT: 'commercial space for rent' } },
  tr: { APARTMENT: { SALE: 'satılık daire', RENT: 'kiralık daire' }, HOUSE: { SALE: 'satılık ev', RENT: 'kiralık ev' },
        LAND: { SALE: 'satılık arsa', RENT: 'kiralık arsa' }, COMMERCIAL: { SALE: 'satılık işyeri', RENT: 'kiralık işyeri' } },
  ar: { APARTMENT: { SALE: 'شقة للبيع', RENT: 'شقة للإيجار' }, HOUSE: { SALE: 'منزل للبيع', RENT: 'منزل للإيجار' },
        LAND: { SALE: 'أرض للبيع', RENT: 'أرض للإيجار' }, COMMERCIAL: { SALE: 'محل تجاري للبيع', RENT: 'محل تجاري للإيجار' } },
  he: { APARTMENT: { SALE: 'דירה למכירה', RENT: 'דירה להשכרה' }, HOUSE: { SALE: 'בית למכירה', RENT: 'בית להשכרה' },
        LAND: { SALE: 'מגרש למכירה', RENT: 'מגרש להשכרה' }, COMMERCIAL: { SALE: 'נכס מסחרי למכירה', RENT: 'נכס מסחרי להשכרה' } },
};

/** The search words' property kind for a marketplace property type (an apartment when unknown). */
export function offerPropertyKind(type: string | null | undefined): PropertyKind {
  switch (String(type ?? '').toUpperCase()) {
    case 'HOUSE': case 'VILLA': case 'TOWNHOUSE': case 'COTTAGE': return 'HOUSE';
    case 'LAND': return 'LAND';
    case 'COMMERCIAL': case 'OFFICE': return 'COMMERCIAL';
    default: return 'APARTMENT';
  }
}

/** Languages searched: Georgian, Russian and English always, plus the customer's own. */
export function offerSearchLanguages(customerLanguage?: string | null): string[] {
  const base = ['ka', 'ru', 'en'];
  const own = String(customerLanguage ?? '').toLowerCase();
  return (OFFER_LANGUAGES as readonly string[]).includes(own) && !base.includes(own) ? [...base, own] : base;
}

export const estimateMicros = (a: Pick<OfferActor, 'startFeeMicros' | 'pricePer1kMicros'>, size: number) =>
  Math.ceil(Math.max(0, a.startFeeMicros) + (Math.max(0, size) * Math.max(0, a.pricePer1kMicros)) / 1000);

/** Facebook groups per run: one memo23 group run reads them all for one keyword. */
export const FB_GROUPS_PER_RUN = 25;
/** Telegram channels (and Instagram profiles) per run. */
export const TG_CHANNELS_PER_RUN = 25;
/** The reservation's ceiling for one batched run (find_property_reserve_actor_run). */
export const MAX_ITEMS_PER_RUN = 1000;
export const MAX_TARGETS_PER_RUN = 25;

const CITY_HINTS: Array<[RegExp, string]> = [
  [/batum|батум|ბათუმ/i, 'Batumi'], [/tbilis|tbs|tiflis|тбилис|თბილის/i, 'Tbilisi'],
  [/kutais|кутаис|ქუთაის/i, 'Kutaisi'], [/rustav|рустав|რუსთავ/i, 'Rustavi'],
];
/** The city a community's own URL names, when it names one. */
export function cityHint(url: string): string | null {
  for (const [re, city] of CITY_HINTS) if (re.test(decodeURIComponent(url))) return city;
  return null;
}

/** The keywords a person OFFERING this kind of property writes, per language (district variants first when given). */
export function offerKeywords(search: Pick<OfferSearch, 'transaction' | 'propertyType' | 'districts' | 'languages'>): Array<{ language: string; query: string }> {
  const kind = offerPropertyKind(search.propertyType);
  const out: Array<{ language: string; query: string }> = [];
  for (const lang of search.languages.filter((l) => SEARCH_WORDS[l])) {
    out.push({ language: lang, query: SEARCH_WORDS[lang][kind][search.transaction] });
  }
  return out;
}

const chunk = <T,>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/**
 * The plan: a few FULL runs per network (each at the Actor's per-run maximum),
 * in-city communities first, fitted to the provider budget by ESTIMATE in a
 * round-robin across networks. The reservation RPC enforces the same budget
 * against real spend, so the estimate can only make the plan smaller.
 */
export function planOfferJobs(input: {
  search: OfferSearch;
  networks: readonly OfferNetwork[];
  actors: Readonly<Record<string, OfferActor | undefined>>;
  sources: readonly KnownOfferSource[];
  providerBudgetMicros: number;
  maxJobs?: number;
}): OfferPlan {
  const wanted = new Set(input.networks.filter((n) => OFFER_NETWORKS.includes(n)));
  const unavailable: OfferPlan['unavailable'] = [];
  const ready = (stage: OfferStage) => {
    const a = input.actors[OFFER_STAGE_ACTOR[stage]];
    return a && a.ready ? a : null;
  };
  /* A full run: the Actor's per-run maximum for each community or keyword, within the reservation's ceiling. */
  const actorOf = new Map<PlannedOfferJob, OfferActor>();
  const job = (stage: OfferStage, a: OfferActor, extra: Partial<PlannedOfferJob>): PlannedOfferJob => {
    const targetCount = Math.max(1, Math.min(MAX_TARGETS_PER_RUN, extra.targetCount ?? extra.targets?.length ?? 1));
    const size = Math.max(1, Math.min(MAX_ITEMS_PER_RUN, (a.maxResults ?? a.probeSize * 3) * targetCount));
    const j: PlannedOfferJob = {
      stage, actorKey: a.actorKey, network: OFFER_STAGE_NETWORK[stage], query: null, queries: [], language: null,
      targetUrl: null, targets: [], sourceId: null, priority: 50, ...extra, targetCount, size, estimateMicros: estimateMicros(a, size),
    };
    actorOf.set(j, a);
    return j;
  };
  const inCity = (s: KnownOfferSource) => {
    const named = s.city ?? cityHint(s.url);
    return !named || comparePlaces(named, input.search.city) !== 'CONFLICT';
  };
  const usable = [...input.sources]
    .filter((s) => /^https:\/\//.test(s.url) && inCity(s))
    .sort((a, b) => Number(Boolean(b.city)) - Number(Boolean(a.city)) || b.priority - a.priority || a.id.localeCompare(b.id));
  const target = (s: KnownOfferSource): OfferTarget => ({ url: s.url, sourceId: s.id, city: s.city ?? cityHint(s.url) });
  const keywords = offerKeywords(input.search);
  const byNetwork = new Map<OfferNetwork, PlannedOfferJob[]>();
  const add = (j: PlannedOfferJob) => byNetwork.set(j.network, [...(byNetwork.get(j.network) ?? []), j]);
  const missing = (n: OfferNetwork, actorReady: boolean) => unavailable.push({ network: n, reason: actorReady ? 'NO_KNOWN_SOURCE' : 'NO_READY_ACTOR' });

  /* Facebook: every in-city group in one memo23 group run per keyword (groups chunked only past
     FB_GROUPS_PER_RUN); public post search per language and agency Pages once their Actors are ready. */
  if (wanted.has('FACEBOOK')) {
    const groupsActor = ready('FB_GROUP_POSTS');
    const searchActor = ready('FB_POST_SEARCH');
    const pagesActor = ready('FB_PAGE_POSTS');
    const groups = usable.filter((s) => s.network === 'FACEBOOK' && !/page/i.test(s.kind)).map(target);
    const pages = usable.filter((s) => s.network === 'FACEBOOK' && /page/i.test(s.kind));
    let planned = 0;
    if (groupsActor && groups.length && keywords.length) {
      const chunks = chunk(groups, FB_GROUPS_PER_RUN);
      /* Keyword-major: the first keyword reads every group before a second keyword is added. */
      for (const kw of keywords) for (const c of chunks) {
        add(job('FB_GROUP_POSTS', groupsActor, { query: kw.query, queries: [kw.query], language: kw.language, targets: c, priority: 100 })); planned += 1;
      }
    }
    if (searchActor) {
      const place = [input.search.districts[0], input.search.city].filter(Boolean).join(' ');
      for (const kw of keywords) {
        const q = `${kw.query} ${place}`.trim();
        add(job('FB_POST_SEARCH', searchActor, { query: q, queries: [q], language: kw.language, priority: 95 })); planned += 1;
      }
    }
    /* The Page Actor reads one Page per run (its verified input takes one start URL). */
    if (pagesActor) for (const pg of pages) {
      add(job('FB_PAGE_POSTS', pagesActor, { targetUrl: pg.url, sourceId: pg.id, targets: [target(pg)], priority: 80 })); planned += 1;
    }
    if (!planned) missing('FACEBOOK', Boolean(groupsActor || searchActor || pagesActor));
  }
  /* Telegram: the city's channels (and channels naming no other city) in a few large runs; any language. */
  if (wanted.has('TELEGRAM')) {
    const a = ready('TELEGRAM_CHANNEL');
    const channels = usable.filter((s) => s.network === 'TELEGRAM').map(target);
    if (!a || !channels.length) missing('TELEGRAM', Boolean(a));
    else for (const c of chunk(channels, TG_CHANNELS_PER_RUN)) add(job('TELEGRAM_CHANNEL', a, { targets: c, priority: 90 }));
  }
  /* Instagram: the known in-city profiles, in large runs (the profile Actor reads profile pages only). */
  if (wanted.has('INSTAGRAM')) {
    const a = ready('IG_PROFILE_POSTS');
    const profiles = usable.filter((s) => s.network === 'INSTAGRAM').map(target);
    if (!a || !profiles.length) missing('INSTAGRAM', Boolean(a));
    else for (const c of chunk(profiles, TG_CHANNELS_PER_RUN)) add(job('IG_PROFILE_POSTS', a, { targets: c, priority: 70 }));
  }
  /* TikTok: the keywords with the city, in one search run. */
  if (wanted.has('TIKTOK')) {
    const a = ready('TIKTOK_SEARCH');
    if (!a || !keywords.length) missing('TIKTOK', Boolean(a));
    else {
      const queries = keywords.map((k) => `${k.query} ${input.search.city}`.trim());
      add(job('TIKTOK_SEARCH', a, { query: queries[0], queries, targetCount: queries.length, priority: 60 }));
    }
  }
  if (wanted.has('VK')) missing('VK', Boolean(ready('VK_WALL')));

  /* Fit to the budget: round-robin across networks so one network cannot take it all. */
  const order: PlannedOfferJob[] = [];
  const lists = [...byNetwork.values()];
  for (let i = 0; lists.some((l) => l[i]); i++) for (const l of lists) if (l[i]) order.push(l[i]);
  const jobs: PlannedOfferJob[] = [];
  let spent = 0;
  let skipped = 0;
  const maxJobs = Math.max(1, input.maxJobs ?? 30);
  for (const j of order) {
    const left = input.providerBudgetMicros - spent;
    if (jobs.length < maxJobs && j.estimateMicros <= left) { jobs.push(j); spent += j.estimateMicros; continue; }
    /* The run that no longer fits whole runs smaller, when the rest of the budget still buys a useful read. */
    const a = actorOf.get(j)!;
    const fits = a.pricePer1kMicros > 0 ? Math.floor(((left - a.startFeeMicros) * 1000) / a.pricePer1kMicros) : 0;
    if (jobs.length < maxJobs && fits >= Math.max(1, a.probeSize)) {
      const size = Math.min(j.size, fits);
      const smaller = { ...j, size, estimateMicros: estimateMicros(a, size) };
      jobs.push(smaller); spent += smaller.estimateMicros;
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
