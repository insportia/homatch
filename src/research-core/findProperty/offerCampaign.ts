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
import { comparePlaces, placeNamesOf, resolvePlace } from '../normalize/place.ts';

export const OFFER_CAMPAIGN_VERSION = 'fp-offers-3';

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
  /** Optional input fields whose behaviour was VERIFIED against a real run (registry
   *  input_contract.verifiedFields). A field listed in the schema but not here is never relied on. */
  verifiedFields?: readonly string[];
  /** The Actor's OUTPUT shape was verified (registry output_contract_verified_at). Telegram's was
   *  not (2026-10-18: 1000 paid posts, 0 offers) — it stays out of offer campaigns until it is. */
  outputVerified?: boolean;
}

/*
 * Telegram posts from the channel Actor carry the message id and the channel, not a post link
 * (production evidence, 2026-10-18: 258 stored posts, all with parent https://t.me/<channel>
 * and external id post:<n>, none with a post URL) — so every one failed the https-link rule.
 * Telegram's own public link for a channel post is https://t.me/<channel>/<message id>.
 */
export function telegramPostUrl(parentUrl: string | null | undefined, externalId: string | null | undefined): string | null {
  const ch = /^https:\/\/t\.me\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,63})\/?$/.exec(String(parentUrl ?? ''));
  const id = /^(?:post:)?(\d{1,12})$/.exec(String(externalId ?? ''));
  return ch && id ? `https://t.me/${ch[1]}/${id[1]}` : null;
}

/** Actors whose posts are only used for offers once their output contract is verified. */
export const OUTPUT_VERIFICATION_REQUIRED: ReadonlySet<string> = new Set(['TELEGRAM_CHANNEL']);

/*
 * Adaptive allocation (owner, 2026-10-18): the FIRST run of each network is a probe; the
 * network's later runs wait for it and are cancelled before they reserve anything when the
 * probe returned at least this many posts and NONE of them could fit the request. A run
 * already started is never aborted (its posts are paid for); nothing unstarted costs money.
 */
export const LOW_YIELD_MIN_BILLED = 100;
export function followUpDecision(probe: { billed: number; useful: number } | null): 'CONTINUE' | 'STOP_LOW_YIELD' | 'WAIT' {
  if (!probe) return 'WAIT';
  return probe.billed >= LOW_YIELD_MIN_BILLED && probe.useful === 0 ? 'STOP_LOW_YIELD' : 'CONTINUE';
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
  /** The community's own name, when the registry has one (read for relevance). */
  name?: string | null;
  /** Property offers HOMATCH has already stored from this community (supply_observations): real evidence. */
  offerEvidence?: number;
  /** Of those, offers of the searched transaction in one of the searched districts (the strongest signal). */
  districtEvidence?: number;
}

export interface OfferSearch {
  transaction: 'SALE' | 'RENT';
  propertyType: string | null;
  city: string;
  districts: string[];
  languages: string[];
  /** Rooms of the request, when stated (shapes the keyword phrases only; strict checks run later). */
  rooms?: number | null;
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
  /** Not the first run of its network: it waits for that run and is cancelled when it was useless. */
  followUp?: boolean;
}

export interface OfferPlan {
  version: string;
  jobs: PlannedOfferJob[];
  estimatedMicros: number;
  providerBudgetMicros: number;
  /** Networks the customer asked for that nothing can search right now, and why. */
  unavailable: Array<{ network: OfferNetwork; reason: 'NO_READY_ACTOR' | 'NO_KNOWN_SOURCE' | 'OUTPUT_UNVERIFIED' }>;
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
  [/batum|батум|ბათუმ|بات[و]?م/i, 'Batumi'], [/tbilis|tbs|tiflis|тбилис|თბილის/i, 'Tbilisi'],
  [/kutais|кутаис|ქუთაის/i, 'Kutaisi'], [/rustav|рустав|რუსთავ/i, 'Rustavi'],
];
/** Every city a text names (a community's name and URL). */
export function citiesNamed(text: string): string[] {
  let t = text;
  try { t = decodeURIComponent(text); } catch { /* keep the raw text */ }
  return CITY_HINTS.filter(([re]) => re.test(t)).map(([, city]) => city);
}
/** The city a community's own URL names, when it names one. */
export function cityHint(url: string): string | null {
  for (const [re, city] of CITY_HINTS) if (re.test(decodeURIComponent(url))) return city;
  return null;
}

/*
 * COMMUNITY RELEVANCE (owner, 2026-10-18): budget goes only to communities that can carry
 * property offers.
 *   PROVEN     it has already produced stored property offers (supply_observations);
 *   LIKELY     its handle or name says real estate, in a language people post in;
 *   UNRELATED  its handle or name says something else (casino, crypto, jobs, food…);
 *   NEUTRAL    nothing either way (e.g. a numeric Facebook group id).
 * Telegram channels are read only when PROVEN or LIKELY: the registry holds many general
 * city chats. Facebook groups were registered as real-estate communities and are kept
 * unless UNRELATED. PROVEN communities are read first.
 */
const PROPERTY_TERMS = /(nedvi[zj]|недвиж|arend|аренд|\brent|rent_|_rent|rental|real.?estate|realt|estate|propert|kvartir|квартир|komnat|комнат|apartment|flat|\bbina|bina_|binebi|udzravi|qoneba|ბინ|უძრავ|ქირავ|იყიდ|\bm2|m2sale|for.?sale|_sale|sale_|prodazh|продаж|kupit|купит|domik|домик|\bhouse|gayrimenkul|emlak|kiral|satilik|residential|agenc|agancy|flip)/i;
const UNRELATED_TERMS = /(casino|crypto|bitcoin|\brates|anime|restaurant|pasha|food|\bpsy|psych|books|cleanup|journal|mapping|raving|\bcave|\btrip|\bjob|jobs|vacanc|dating|\bbot$|music|football|sport)/i;
export type CommunityRelevance = 'PROVEN' | 'LIKELY' | 'NEUTRAL' | 'UNRELATED';
export function communityRelevance(s: Pick<KnownOfferSource, 'url' | 'name' | 'offerEvidence'>): CommunityRelevance {
  if ((s.offerEvidence ?? 0) > 0) return 'PROVEN';
  let handle = s.url;
  try { handle = decodeURIComponent(new URL(s.url).pathname); } catch { /* keep the raw url */ }
  const text = `${handle} ${s.name ?? ''}`;
  if (UNRELATED_TERMS.test(text)) return 'UNRELATED';
  return PROPERTY_TERMS.test(text) ? 'LIKELY' : 'NEUTRAL';
}

/** An Instagram PROFILE page (the only kind the profile Actor reads): not a hashtag, post, reel or story page. */
export function isInstagramProfileUrl(url: string): boolean {
  const m = /^https:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:\?.*)?$/.exec(url);
  return Boolean(m) && !['explore', 'p', 'reel', 'reels', 'stories', 'tv', 'accounts', 'direct'].includes(m![1].toLowerCase());
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

/* The request's own words, for Actors that search by keyword (TikTok search; Facebook
   in-group search once verified): what the person OFFERING exactly this property writes —
   transaction, rooms, type and the wanted district, in each language. Requirements that
   posts rarely state (bedrooms, budget, area) are checked strictly after the fetch. */
const ROOMS_KA = (n: number) => `${n} ოთახიანი`;
const ROOMS_RU = (n: number) => `${n}-комнатная`;
const ROOMS_EN = (n: number) => `${n} room`;
/** Georgian locative ("in Vake" = ვაკეში, "in Tbilisi" = თბილისში). */
export function kaLocative(name: string): string {
  const n = name.trim();
  return /ი$/u.test(n) ? `${n.slice(0, -1)}ში` : `${n}ში`;
}
const title = (s: string) => s.replace(/(^|[\s-])(\p{L})/gu, (_m, a: string, c: string) => a + c.toUpperCase());
function placeIn(lang: string, name: string): string {
  const names = placeNamesOf(name);
  if (lang === 'ka') return kaLocative(names?.[1] ?? name);
  if (lang === 'ru') return names?.[2] ? title(names[2]) : name;
  return names ? title(names[0]) : name;
}
export function requestQueries(search: Pick<OfferSearch, 'transaction' | 'propertyType' | 'districts' | 'languages' | 'city' | 'rooms'>): Array<{ language: string; query: string }> {
  const kind = offerPropertyKind(search.propertyType);
  const rooms = kind === 'APARTMENT' && search.rooms && search.rooms > 0 && search.rooms < 10 ? search.rooms : null;
  const where = search.districts[0] ?? search.city;
  const out: Array<{ language: string; query: string }> = [];
  for (const lang of search.languages.filter((l) => SEARCH_WORDS[l])) {
    const base = SEARCH_WORDS[lang][kind][search.transaction];
    const q = lang === 'ka' ? `${rooms ? base.replace(' ', ` ${ROOMS_KA(rooms)} `) : base} ${placeIn('ka', where)}`
      : lang === 'ru' ? `${base.replace('квартира', rooms ? `${ROOMS_RU(rooms)} квартира` : 'квартира')} ${placeIn('ru', where)}`
        : lang === 'en' ? `${rooms ? `${ROOMS_EN(rooms)} ` : ''}${base} ${placeIn('en', where)}${search.districts.length ? ` ${placeIn('en', search.city)}` : ''}`
          : `${base} ${placeIn(lang, where)}`;
    out.push({ language: lang, query: q.replace(/\s+/g, ' ').trim() });
  }
  return out;
}

/** 2 = the community's name/handle names a wanted district, 1 = names no district, 0 = names only other districts. */
export function districtFocus(s: Pick<KnownOfferSource, 'url' | 'name'>, districts: readonly string[]): 0 | 1 | 2 {
  if (!districts.length) return 1;
  let handle = s.url;
  try { handle = decodeURIComponent(new URL(s.url).pathname); } catch { /* raw */ }
  const words = `${handle} ${s.name ?? ''}`.split(/[^\p{L}]+/u).filter((w) => w.length >= 3);
  const named = new Set<string>();
  for (const w of words) {
    for (const t of [w, w.replace(/(ში|ის|ზე)$/u, ''), `${w.replace(/(ში|ის|ზე)$/u, '')}ი`]) {
      const p = resolvePlace(t);
      if (p?.kind === 'DISTRICT') { named.add(p.key); break; }
    }
  }
  if (!named.size) return 1;
  const wanted = new Set(districts.map((d) => resolvePlace(d)?.key ?? d.toLowerCase()));
  return [...named].some((k) => wanted.has(k)) ? 2 : 0;
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
    if (named && comparePlaces(named, input.search.city) === 'CONFLICT') return false;
    /* A name that mentions only other cities (a "Batumi" group filed under Tbilisi) is not read. */
    const cities = citiesNamed(`${s.name ?? ''} ${s.url}`);
    return !cities.length || cities.some((c) => comparePlaces(c, input.search.city) !== 'CONFLICT');
  };
  const relevance = new Map(input.sources.map((s) => [s.id, communityRelevance(s)]));
  const relevant = (s: KnownOfferSource) => {
    const r = relevance.get(s.id);
    if (r === 'UNRELATED') return false;
    return s.network === 'TELEGRAM' ? r === 'PROVEN' || r === 'LIKELY' : true;
  };
  /* The most relevant communities FIRST, so a small budget reads the best ones: those with
     stored offers of this transaction in the wanted district, then those whose name is the
     wanted district (a community named after another district last), then proven, then named
     for real estate, then in-city, then registry priority. */
  const focus = new Map(input.sources.map((s) => [s.id, districtFocus(s, input.search.districts)]));
  const usable = [...input.sources]
    .filter((s) => /^https:\/\//.test(s.url) && inCity(s) && relevant(s))
    .sort((a, b) => (b.districtEvidence ?? 0) - (a.districtEvidence ?? 0) || (focus.get(b.id)! - focus.get(a.id)!)
      || (b.offerEvidence ?? 0) - (a.offerEvidence ?? 0) || Number(relevance.get(b.id) === 'LIKELY') - Number(relevance.get(a.id) === 'LIKELY')
      || Number(Boolean(b.city)) - Number(Boolean(a.city)) || b.priority - a.priority || a.id.localeCompare(b.id));
  const target = (s: KnownOfferSource): OfferTarget => ({ url: s.url, sourceId: s.id, city: s.city ?? cityHint(s.url) });
  const keywords = offerKeywords(input.search);
  const byNetwork = new Map<OfferNetwork, PlannedOfferJob[]>();
  const add = (j: PlannedOfferJob) => byNetwork.set(j.network, [...(byNetwork.get(j.network) ?? []), j]);
  const missing = (n: OfferNetwork, actorReady: boolean) => unavailable.push({ network: n, reason: actorReady ? 'NO_KNOWN_SOURCE' : 'NO_READY_ACTOR' });

  /* Facebook: every relevant in-city group's RECENT POSTS, read whole — no keyword is sent unless
     the group Actor's `search` field is VERIFIED (registry input_contract.verifiedFields): it has
     never been exercised in production (owner, 2026-10-18: never assume it filters). One read per
     group covers every language at once; qualifyOffer keeps only real offers of the searched kind.
     The Actor returns posts newest-first, back to onlyPostsNewerThan (verified: 0 of 1664 posts
     older than the floor), until the run's total maxItems — so DEPTH per group is posts per group.
     A budget that can afford it reads FEWER groups per run (each up to the Actor's per-group
     maximum) instead of leaving money unused; otherwise FB_GROUPS_PER_RUN a run, for breadth.
     Public post search per language and agency Pages once their Actors are verified and enabled. */
  let fbGroupJobs: (() => PlannedOfferJob[]) | null = null;
  if (wanted.has('FACEBOOK')) {
    byNetwork.set('FACEBOOK', []); // Facebook keeps its turn first; its group runs are sized last
    const groupsActor = ready('FB_GROUP_POSTS');
    const searchActor = ready('FB_POST_SEARCH');
    const pagesActor = ready('FB_PAGE_POSTS');
    const groups = usable.filter((s) => s.network === 'FACEBOOK' && !/page/i.test(s.kind)).map(target);
    const pages = usable.filter((s) => s.network === 'FACEBOOK' && /page/i.test(s.kind));
    let planned = 0;
    if (groupsActor && groups.length) {
      const verifiedSearch = (groupsActor.verifiedFields ?? []).includes('search') && keywords.length > 0;
      const groupRuns = (perRun: number) => (verifiedSearch
        /* Verified in-group keyword search: keyword-major, every group before a second keyword. */
        ? keywords.flatMap((kw) => chunk(groups, perRun).map((c) => job('FB_GROUP_POSTS', groupsActor, { query: kw.query, queries: [kw.query], language: kw.language, targets: c, priority: 100 })))
        : chunk(groups, perRun).map((c) => job('FB_GROUP_POSTS', groupsActor, { targets: c, priority: 100 })));
      fbGroupJobs = () => {
        const perGroup = Math.max(1, groupsActor.maxResults ?? groupsActor.probeSize * 3);
        const deepPerRun = Math.max(1, Math.min(FB_GROUPS_PER_RUN, Math.floor(MAX_ITEMS_PER_RUN / perGroup)));
        const others = [...byNetwork.values()].flat().filter((j) => j.stage !== 'FB_GROUP_POSTS');
        const cost = (js: PlannedOfferJob[]) => js.reduce((n, j) => n + j.estimateMicros, 0);
        /* The deepest reading the budget affords for EVERY group (fewest groups a run); else breadth. */
        for (let perRun = deepPerRun; perRun < FB_GROUPS_PER_RUN; perRun += 1) {
          const runs = groupRuns(perRun);
          if (cost(runs) + cost(others) <= input.providerBudgetMicros) return runs;
        }
        return groupRuns(FB_GROUPS_PER_RUN);
      };
      planned += 1;
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
  /* Telegram: the city's RELEVANT channels (proven or named for real estate; never another city's)
     in a few large runs; any language. */
  if (wanted.has('TELEGRAM')) {
    const a = ready('TELEGRAM_CHANNEL');
    const channels = usable.filter((s) => s.network === 'TELEGRAM').map(target);
    if (a && OUTPUT_VERIFICATION_REQUIRED.has(a.actorKey) && a.outputVerified !== true) unavailable.push({ network: 'TELEGRAM', reason: 'OUTPUT_UNVERIFIED' });
    else if (!a || !channels.length) missing('TELEGRAM', Boolean(a));
    else for (const c of chunk(channels, TG_CHANNELS_PER_RUN)) add(job('TELEGRAM_CHANNEL', a, { targets: c, priority: 90 }));
  }
  /* Instagram: the known in-city profiles, in large runs (the profile Actor reads profile pages only). */
  if (wanted.has('INSTAGRAM')) {
    const a = ready('IG_PROFILE_POSTS');
    /* Profile pages only: a hashtag page given to the profile Actor bills its start fee and one
       item and returns nothing (seven production runs, 2026-10-09..18). */
    const profiles = usable.filter((s) => s.network === 'INSTAGRAM' && isInstagramProfileUrl(s.url)).map(target);
    if (!a || !profiles.length) missing('INSTAGRAM', Boolean(a));
    else for (const c of chunk(profiles, TG_CHANNELS_PER_RUN)) add(job('IG_PROFILE_POSTS', a, { targets: c, priority: 70 }));
  }
  /* TikTok: the keywords with the city, in one search run. */
  if (wanted.has('TIKTOK')) {
    const a = ready('TIKTOK_SEARCH');
    if (!a || !keywords.length) missing('TIKTOK', Boolean(a));
    else {
      /* The request's own phrases (district, rooms) — TikTok search is server-side and verified. */
      const queries = requestQueries(input.search).map((k) => k.query);
      add(job('TIKTOK_SEARCH', a, { query: queries[0], queries, targetCount: queries.length, priority: 60 }));
    }
  }
  if (wanted.has('VK')) missing('VK', Boolean(ready('VK_WALL')));
  /* Facebook group runs, sized now that every other network's runs are known (first in its list). */
  if (fbGroupJobs) byNetwork.set('FACEBOOK', [...fbGroupJobs(), ...(byNetwork.get('FACEBOOK') ?? [])]);

  /* Fit to the budget: round-robin across networks so one network cannot take it all. */
  const order: PlannedOfferJob[] = [];
  const lists = [...byNetwork.values()];
  for (let i = 0; lists.some((l) => l[i]); i++) for (const l of lists) if (l[i]) order.push(l[i]);
  const jobs: PlannedOfferJob[] = [];
  let spent = 0;
  let skipped = 0;
  const maxJobs = Math.max(1, input.maxJobs ?? 30);
  /* A network's first run, kept for it while an earlier network's run is shrunk to fit: a small
     budget still covers every network once (the keyword search included) before any goes deeper. */
  const firstOf = new Map<OfferNetwork, PlannedOfferJob>();
  for (const j of order) if (!firstOf.has(j.network)) firstOf.set(j.network, j);
  const planned = new Set<OfferNetwork>();
  for (const j of order) {
    const others = [...firstOf.values()].filter((f) => f !== j && !planned.has(f.network)).reduce((n, f) => n + f.estimateMicros, 0);
    const left = input.providerBudgetMicros - spent;
    if (jobs.length < maxJobs && j.estimateMicros <= left - others) { jobs.push(j); spent += j.estimateMicros; planned.add(j.network); continue; }
    /* The run that no longer fits whole runs smaller, when the rest of the budget (less the other
       networks' first runs, when they still fit) still buys a useful read. */
    const a = actorOf.get(j)!;
    const room = others > 0 && others < left ? left - others : left;
    const fits = a.pricePer1kMicros > 0 ? Math.floor(((room - a.startFeeMicros) * 1000) / a.pricePer1kMicros) : 0;
    if (jobs.length < maxJobs && fits >= Math.max(1, a.probeSize)) {
      const size = Math.min(j.size, fits);
      const smaller = { ...j, size, estimateMicros: estimateMicros(a, size) };
      jobs.push(smaller); spent += smaller.estimateMicros; planned.add(j.network);
    } else skipped += 1;
  }
  /* Probe-first: every run after a network's first waits for it (see followUpDecision). */
  const seen = new Set<OfferNetwork>();
  for (const j of jobs) { if (seen.has(j.network)) j.followUp = true; else seen.add(j.network); }
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
