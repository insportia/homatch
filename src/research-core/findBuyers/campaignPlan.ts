// The first tranche of a campaign's social jobs: every relevant source family
// and language gets one small probe, and known sources from the registry are
// used before paying to rediscover them.

import { SEARCH_LANGUAGES, type SearchLanguage } from './languages.ts';
import type { PropertyDna } from './propertyDna.ts';
import { queriesFor, type QueryPlan } from './queryPlanner.ts';
import { STAGE_ACTOR, type Stage } from './actorInputs.ts';
import { armPriority } from './allocator.ts';
import { planPaidTelegram, type TelegramPreference } from './telegramPreference.ts';
import type { Depth } from './buyerStrategy.ts';
import { classifyDemand } from './demandClassifier.ts';
import { actorYieldPrior, type ActorRecord } from './executionBudget.ts';

export interface KnownSource {
  id: string;
  platform: 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'VK' | 'TELEGRAM' | 'LINKEDIN' | 'X' | 'THREADS' | 'YOUTUBE';
  url: string;
  /** source_registry.source_type: FACEBOOK_GROUP vs a public Page (SOCIAL_PROFILE), etc. */
  sourceType?: string | null;
  languages: string[];
  city: string | null;
  /** qualified leads per provider dollar seen historically (null = no history). */
  historicalYield: number | null;
  lastCheckedAt: string | null;
  lastSuccessfulAt?: string | null;
}

export interface PlannedSocialJob {
  stage: Stage;
  actorKey: string;
  language: SearchLanguage | 'multi';
  query: string | null;
  targetUrl: string | null;
  sourceId: string | null;
  size: number;
  arm: string;
  priority: number;
  reason: string;
  /** Several communities read in ONE run (batching.ts); targetUrl is then the first of them. */
  batch?: Array<{ targetUrl: string; sourceId: string | null; arm: string; size: number }>;
  /** Several search phrases sent in ONE run (FB_KEYWORD_SEARCH); query is then the first of them. */
  queries?: string[];
}

export const DEFAULT_KEYWORD_BATCH_SIZE = 6;
export const MAX_KEYWORD_BATCH_SIZE = 10;
const SEEK_VERB: Readonly<Record<string, Record<'SALE' | 'RENT', string>>> = {
  ka: { SALE: 'ვყიდულობ', RENT: 'ვქირაობ' },
  ru: { SALE: 'куплю', RENT: 'сниму' },
  en: { SALE: 'looking to buy', RENT: 'looking to rent' },
};
/** Phrases per language: Georgian first and deepest, then Russian/English, then ar/he/tr. */
const KEYWORDS_PER_LANGUAGE: Readonly<Record<string, number>> = { ka: 3, ru: 3, en: 3, ar: 2, he: 2, tr: 2 };

/**
 * The campaign's own demand phrases (queryPlanner: transaction, property type, rooms,
 * district and city in each language's own spelling), kept only where the phrase itself
 * reads as a person SEEKING this transaction — never a listing-shaped phrase that would
 * buy sellers' posts ("Krtsanisi satılık 2+1 daire"). Unique per language, no near-copies.
 */
export function keywordSearchPhrases(plan: QueryPlan, transaction: 'SALE' | 'RENT', languages: readonly string[]): Array<{ language: SearchLanguage; query: string }> {
  const seeker = transaction === 'RENT' ? 'RENT_SEEKER' : 'BUY_SEEKER';
  const out: Array<{ language: SearchLanguage; query: string }> = [];
  for (const lang of languages as SearchLanguage[]) {
    const seen = new Set<string>();
    const picked: string[] = [];
    const seeks = (text: string) => {
      const r = classifyDemand(text);
      return r.role === seeker || (r.role === 'UNCLEAR' && r.evidence.includes('first_person_seeking'));
    };
    const add = (text: string) => {
      const key = text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
      if (!key || seen.has(key) || !seeks(text)) return;
      seen.add(key);
      picked.push(text);
    };
    const demand = queriesFor(plan, 'demand', lang).map((q) => q.query);
    for (const q of demand) add(q);
    /* The planner's district/rooms phrase ("3-ოთახიანი ბინა კრწანისის", "2 bedroom apartment
       Krtsanisi") reads as a listing; with the language's first-person verb in front it is a
       person asking for exactly this home — the district and room precision the city-level
       phrases lack. Only where the result still reads as seeking (and never "investment"). */
    const verb = SEEK_VERB[lang]?.[transaction];
    /* Never a second verb in front of one ("looking to buy need house"). */
    const hasVerb = /^(need|want|looking|searching|ищу|хочу|нужн|куплю|сниму|ვეძებ|მჭირდება|მინდა|ვყიდულობ|ვიყიდი|ვქირაობ|ვიქირავებ)/iu;
    if (verb) for (const q of demand) if (!seeks(q) && !hasVerb.test(q.trim()) && !/invest|инвест|ინვესტ/i.test(q)) add(`${verb} ${q}`);
    for (const query of picked.slice(0, KEYWORDS_PER_LANGUAGE[lang] ?? 2)) out.push({ language: lang, query });
  }
  return out;
}

export interface PlanInputs {
  dna: PropertyDna;
  plan: QueryPlan;
  knownSources: KnownSource[];
  /** actorKey → probe size, for enabled actors only. */
  enabledActors: Record<string, { probeSize: number; priority: number }>;
  nativeTelegramActive: boolean;
  /** PAID_FIRST: the memo23 Telegram Actor reads known channels first (owner setting). */
  telegramPreference?: TelegramPreference;
  /**
   * The languages the owner CHOSE at launch (explicit mode). Every paid search
   * outside them is dropped, so the whole budget goes to these audiences.
   * Absent or empty: all six search languages.
   */
  targetLanguages?: readonly string[] | null;
  /** What the campaign budget unlocks (buyerStrategy.depthFor). */
  depth?: Depth | null;
  /** Each Actor's real record across past campaigns (finished paid runs, qualified leads, spend). */
  actorHistory?: Record<string, ActorRecord>;
  /** Search phrases per FB_KEYWORD_SEARCH run (admin_settings find_buyers_fb_keyword_search.batchSize). */
  keywordBatchSize?: number;
  now?: number;
}

const MAX_KNOWN_PER_FAMILY = 6;
/**
 * Georgian-speaking locals are the primary market (2026-10-12): the first paid
 * VILLION search read ~770 posts of which only ~120 were Georgian, because known
 * groups were ranked by past yield (expat English/Russian groups) and Georgian group
 * discovery was skipped once any three Georgian groups were known. Georgian now gets
 * reserved known-group slots and always runs its own group discovery.
 */
export const PRIMARY_LANGUAGE: SearchLanguage = 'ka';
const PRIMARY_KNOWN_SLOTS = 3;
const PRIMARY_DISCOVERY_QUERIES = 2;
/** Listing-post search: the languages Georgian listings are actually advertised in. */
export const LISTING_SEARCH_LANGUAGES: readonly SearchLanguage[] = ['ka', 'ru', 'en'];

/** Languages where a network is a realistic demand channel for Georgia. */
export const NETWORK_LANGUAGES: Readonly<Record<string, readonly SearchLanguage[]>> = {
  FACEBOOK: SEARCH_LANGUAGES,
  TIKTOK: SEARCH_LANGUAGES,
  LINKEDIN: ['en', 'ru', 'tr'],
  VK: ['ru'],
  /* Relocation / expat demand is written in English and Russian on Reddit,
     English on Quora; Bluesky carries EN/RU/TR. */
  REDDIT: ['en', 'ru'],
  QUORA: ['en'],
  BLUESKY: ['en', 'ru', 'tr'],
};

/** Which slice of the rotating discovery queries this campaign uses: changes every hour. */
export function discoveryTurn(now: number): number {
  return Math.floor(now / 3_600_000);
}

/** The list started at position `turn` (mod length), wrapping around. */
export function rotate<T>(list: readonly T[], turn: number): T[] {
  if (!list.length) return [];
  const k = ((turn % list.length) + list.length) % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
}

/** TikTok demand search (see initialSocialJobs). Off: no buyer or tenant was ever found there. */
export const TIKTOK_DEMAND_SEARCH = false;

export function initialSocialJobs(input: PlanInputs): PlannedSocialJob[] {
  const { dna, plan, knownSources, enabledActors } = input;
  const now = input.now ?? Date.now();
  const jobs: PlannedSocialJob[] = [];
  const has = (stage: Stage) => Boolean(enabledActors[STAGE_ACTOR[stage]]);
  const probe = (stage: Stage) => enabledActors[STAGE_ACTOR[stage]]?.probeSize ?? 20;
  const base = (stage: Stage) => enabledActors[STAGE_ACTOR[stage]]?.priority ?? 50;
  const cityMatch = (s: KnownSource) => !dna.city || !s.city || s.city.toLowerCase() === dna.city.toLowerCase();
  /* A Facebook GROUP and a Facebook PAGE are different sources read by different
     Actors: a Page URL must never reach the group reader, nor a group the Page reader. */
  const kindOk = (s: KnownSource, kind: 'GROUP' | 'PAGE' | null) =>
    kind === null || (kind === 'PAGE' ? s.sourceType === 'SOCIAL_PROFILE' : s.sourceType !== 'SOCIAL_PROFILE');
  const known = (platform: KnownSource['platform'], kind: 'GROUP' | 'PAGE' | null = null) => {
    const ranked = knownSources
      .filter((s) => s.platform === platform && cityMatch(s) && kindOk(s, kind))
      .sort((a, b) => (b.historicalYield ?? 0) - (a.historicalYield ?? 0));
    /* Georgian groups first (up to PRIMARY_KNOWN_SLOTS), then the best of the rest. */
    const primary = ranked.filter((s) => s.languages.includes(PRIMARY_LANGUAGE)).slice(0, PRIMARY_KNOWN_SLOTS);
    const rest = ranked.filter((s) => !primary.includes(s));
    return [...primary, ...rest].slice(0, MAX_KNOWN_PER_FAMILY);
  };

  const pushKnown = (stage: Stage, platform: KnownSource['platform'], query: string | null = null, limit = MAX_KNOWN_PER_FAMILY, kind: 'GROUP' | 'PAGE' | null = null) => {
    if (!has(stage)) return;
    for (const s of known(platform, kind).slice(0, limit)) {
      jobs.push({
        stage, actorKey: STAGE_ACTOR[stage], language: (s.languages[0] as SearchLanguage) ?? 'multi', query,
        targetUrl: s.url, sourceId: s.id, size: probe(stage), arm: `${stage}:${s.id}`,
        priority: armPriority(null, s.historicalYield, base(stage) + 5), reason: 'known_source_reuse',
      });
    }
  };

  /* FACEBOOK: known groups first, then group discovery in EVERY language with a query
     that rotates per campaign (owner, 2026-10-18: "find new groups on every campaign, in
     all six languages"). Campaigns a53b3b5a and d0af0a47 searched the same two Georgian
     queries and got the same groups back; a covered language used to be skipped. */
  pushKnown('FB_GROUP_POSTS', 'FACEBOOK', null, MAX_KNOWN_PER_FAMILY, 'GROUP');
  if (has('FB_GROUP_SEARCH')) {
    const turn = discoveryTurn(now);
    for (const lang of NETWORK_LANGUAGES.FACEBOOK) {
      const primary = lang === PRIMARY_LANGUAGE;
      for (const [i, q] of rotate(queriesFor(plan, 'community', lang), turn).slice(0, primary ? PRIMARY_DISCOVERY_QUERIES : 1).entries()) {
        jobs.push({
          stage: 'FB_GROUP_SEARCH', actorKey: STAGE_ACTOR.FB_GROUP_SEARCH, language: lang, query: q.query, targetUrl: null,
          sourceId: null, size: probe('FB_GROUP_SEARCH'), arm: i === 0 ? `FB_GROUP_SEARCH:${lang}` : `FB_GROUP_SEARCH:${lang}:${i}`,
          priority: armPriority(null, null, base('FB_GROUP_SEARCH') + (primary ? 5 : 0)), reason: 'source_discovery',
        });
      }
    }
  }

  /* FACEBOOK beyond groups: public listing posts by keyword (agency, developer and
     competitor Pages, individual listings). Their comments are where buyers ask
     about a comparable flat. Georgian first (two phrasings), then RU/EN. Pages
     that published a comparable listing before are read again directly. */
  if (has('FB_POST_SEARCH')) {
    for (const lang of LISTING_SEARCH_LANGUAGES) {
      const primary = lang === PRIMARY_LANGUAGE;
      for (const [i, q] of queriesFor(plan, 'listing', lang).slice(0, primary ? 2 : 1).entries()) {
        jobs.push({
          stage: 'FB_POST_SEARCH', actorKey: STAGE_ACTOR.FB_POST_SEARCH, language: lang, query: q.query, targetUrl: null,
          sourceId: null, size: probe('FB_POST_SEARCH'), arm: i === 0 ? `FB_POST_SEARCH:${lang}` : `FB_POST_SEARCH:${lang}:${i}`,
          priority: armPriority(null, null, base('FB_POST_SEARCH') + (primary ? 5 : 0)), reason: 'comparable_listing_search',
        });
      }
    }
    /* Buyers' own public posts by purchase phrase ("ვყიდულობ ბინას", "куплю квартиру"), in every
       Facebook language: group feeds are mostly brokers' listings (8f6b8544: 200 posts, no
       buyer), a buyer who writes publicly is found directly (owner, 2026-10-18). */
    for (const lang of NETWORK_LANGUAGES.FACEBOOK) {
      const q = queriesFor(plan, 'demand', lang)[0];
      if (q) jobs.push({
        stage: 'FB_POST_SEARCH', actorKey: STAGE_ACTOR.FB_POST_SEARCH, language: lang, query: q.query, targetUrl: null,
        sourceId: null, size: probe('FB_POST_SEARCH'), arm: `FB_POST_SEARCH:demand:${lang}`,
        priority: armPriority(null, null, base('FB_POST_SEARCH') + (lang === PRIMARY_LANGUAGE ? 6 : 1)), reason: 'demand_search',
      });
    }
  }
  /* Buyers and tenants by keyword across public Facebook posts, every Facebook language,
     several phrases per run (the Actor's keyword list; batch size is an admin setting).
     Complements the group readers: a person posting outside any group HOMATCH knows. */
  if (has('FB_KEYWORD_SEARCH')) {
    const langs = NETWORK_LANGUAGES.FACEBOOK.filter((l) => !input.targetLanguages?.length || input.targetLanguages.includes(l));
    const phrases = keywordSearchPhrases(plan, dna.transaction, langs);
    const size = Math.max(1, Math.min(MAX_KEYWORD_BATCH_SIZE, Math.round(Number(input.keywordBatchSize) || DEFAULT_KEYWORD_BATCH_SIZE)));
    for (let i = 0; i < phrases.length; i += size) {
      const chunk = phrases.slice(i, i + size);
      const one = new Set(chunk.map((c) => c.language)).size === 1;
      jobs.push({
        stage: 'FB_KEYWORD_SEARCH', actorKey: STAGE_ACTOR.FB_KEYWORD_SEARCH, language: one ? chunk[0].language : 'multi',
        query: chunk[0].query, queries: chunk.map((c) => c.query), targetUrl: null, sourceId: null,
        size: probe('FB_KEYWORD_SEARCH'), arm: `FB_KEYWORD_SEARCH:${i / size}`,
        priority: armPriority(null, null, base('FB_KEYWORD_SEARCH') + (chunk[0].language === PRIMARY_LANGUAGE ? 6 : 2)), reason: 'demand_keyword_search',
      });
    }
  }
  /* Competitor advertising: the same listing phrases searched in the Meta Ad Library.
     One ad search per listing language; a comparable ad queues its Page's feed. */
  if (has('FB_AD_LIBRARY')) {
    for (const lang of LISTING_SEARCH_LANGUAGES) {
      const q = queriesFor(plan, 'listing', lang)[0];
      if (q) jobs.push({
        stage: 'FB_AD_LIBRARY', actorKey: STAGE_ACTOR.FB_AD_LIBRARY, language: lang, query: q.query, targetUrl: null,
        sourceId: null, size: probe('FB_AD_LIBRARY'), arm: `FB_AD_LIBRARY:${lang}`,
        priority: armPriority(null, null, base('FB_AD_LIBRARY') + (lang === PRIMARY_LANGUAGE ? 5 : 0)), reason: 'competitor_ads',
      });
    }
  }
  pushKnown('FB_PAGE_POSTS', 'FACEBOOK', null, 3, 'PAGE');

  /* TIKTOK: not planned for demand search (owner, 2026-10-18). Across every campaign of
     October 2026 it returned agencies' listing videos and no qualified person, at the
     lowest spend of any source; the budget goes to Facebook, Instagram and Telegram. The
     block stays behind TIKTOK_DEMAND_SEARCH so it can be re-enabled deliberately. */
  if (TIKTOK_DEMAND_SEARCH && has('TIKTOK_SEARCH')) {
    for (const lang of NETWORK_LANGUAGES.TIKTOK) {
      const q = queriesFor(plan, 'demand', lang)[0];
      if (q) jobs.push({
        stage: 'TIKTOK_SEARCH', actorKey: STAGE_ACTOR.TIKTOK_SEARCH, language: lang, query: q.query, targetUrl: null,
        sourceId: null, size: probe('TIKTOK_SEARCH'), arm: `TIKTOK_SEARCH:${lang}`,
        priority: armPriority(null, null, base('TIKTOK_SEARCH')), reason: 'demand_search',
      });
    }
    for (const lang of ['ka', 'ru', 'en'] as SearchLanguage[]) {
      const h = queriesFor(plan, 'hashtag', lang)[0];
      if (h) jobs.push({
        stage: 'TIKTOK_SEARCH', actorKey: STAGE_ACTOR.TIKTOK_SEARCH, language: lang, query: h.query, targetUrl: null,
        sourceId: null, size: probe('TIKTOK_SEARCH'), arm: `TIKTOK_HASHTAG:${lang}`,
        priority: armPriority(null, null, base('TIKTOK_SEARCH') - 5), reason: 'hashtag_cluster',
      });
    }
  }

  /* LINKEDIN: relocation / housing posts; groups only where none are known. */
  if (has('LINKEDIN_POSTS')) {
    for (const lang of NETWORK_LANGUAGES.LINKEDIN) {
      const q = queriesFor(plan, 'demand', lang).find((x) => x.family === 'RELOCATING' || x.family === 'INVESTMENT')
        ?? queriesFor(plan, 'demand', lang)[0];
      if (q) jobs.push({
        stage: 'LINKEDIN_POSTS', actorKey: STAGE_ACTOR.LINKEDIN_POSTS, language: lang, query: q.query, targetUrl: null,
        sourceId: null, size: probe('LINKEDIN_POSTS'), arm: `LINKEDIN_POSTS:${lang}`,
        priority: armPriority(null, null, base('LINKEDIN_POSTS')), reason: 'demand_search',
      });
    }
  }
  if (has('LINKEDIN_GROUPS') && known('LINKEDIN').length === 0) {
    const q = queriesFor(plan, 'community', 'en')[0];
    if (q) jobs.push({
      stage: 'LINKEDIN_GROUPS', actorKey: STAGE_ACTOR.LINKEDIN_GROUPS, language: 'en', query: q.query, targetUrl: null,
      sourceId: null, size: probe('LINKEDIN_GROUPS'), arm: 'LINKEDIN_GROUPS:en',
      priority: armPriority(null, null, base('LINKEDIN_GROUPS') - 10), reason: 'source_discovery',
    });
  }

  /* REDDIT / QUORA / BLUESKY: keyword search, one probe per realistic language.
     Reddit and Quora favour relocation / investment phrasings. */
  const searchProbe = (stage: Stage, network: keyof typeof NETWORK_LANGUAGES, prefer: string[]) => {
    if (!has(stage)) return;
    for (const lang of NETWORK_LANGUAGES[network]) {
      const demand = queriesFor(plan, 'demand', lang);
      const q = demand.find((x) => prefer.includes(x.family)) ?? demand[0];
      if (q) jobs.push({
        stage, actorKey: STAGE_ACTOR[stage], language: lang, query: q.query, targetUrl: null,
        sourceId: null, size: probe(stage), arm: `${stage}:${lang}`,
        priority: armPriority(null, null, base(stage)), reason: 'demand_search',
      });
    }
  };
  searchProbe('REDDIT_SEARCH', 'REDDIT', ['RELOCATING', 'LOOKING_FOR', 'WANT_BUY', 'WANT_RENT']);
  searchProbe('QUORA_SEARCH', 'QUORA', ['INVESTMENT', 'RELOCATING', 'WANT_BUY', 'WANT_RENT']);
  searchProbe('BLUESKY_SEARCH', 'BLUESKY', ['WANT_BUY', 'WANT_RENT', 'LOOKING_FOR']);

  /* VK / INSTAGRAM / X / THREADS / YOUTUBE: sources the registry already knows
     (memo23 has no discovery Actor for them). */
  pushKnown('X_PROFILE', 'X', null, 3);
  pushKnown('THREADS_PROFILE', 'THREADS', null, 3);
  pushKnown('YOUTUBE_COMMENTS', 'YOUTUBE', null, 3);
  const vkKeyword = queriesFor(plan, 'demand', 'ru')[0]?.query ?? null;
  pushKnown('VK_WALL', 'VK', vkKeyword, 4);
  pushKnown('IG_PROFILE_POSTS', 'INSTAGRAM', null, 3);

  /* TELEGRAM via memo23 only when native Telegram is not collecting. */
  /* TELEGRAM via memo23: first choice when the owner prefers paid Telegram
     (reads up to MAX_KNOWN_PER_FAMILY known channels); otherwise only when
     native Telegram is not collecting. Never without a channel seed. */
  const paidTelegramFirst = (input.telegramPreference ?? 'NATIVE_FIRST') === 'PAID_FIRST';
  if (planPaidTelegram(input.telegramPreference ?? 'NATIVE_FIRST', input.nativeTelegramActive)) {
    pushKnown('TELEGRAM_CHANNEL', 'TELEGRAM', null, paidTelegramFirst ? MAX_KNOWN_PER_FAMILY : 3);
  }

  return applyYieldPrior(applyDepth(restrictToLanguages(jobs, input.targetLanguages, knownSources), input.depth ?? null, input.actorHistory ?? {}), input.actorHistory ?? {});
}

/**
 * Most promising, most cost-effective first: a probe of an Actor that has produced qualified
 * people per dollar (actorYieldPrior, measured) runs ahead of equal-priority probes. Source
 * discovery is not reranked — its value is the communities later reads feed on, which the
 * reading Actor's own yield already carries.
 */
export function applyYieldPrior(jobs: PlannedSocialJob[], history: Record<string, ActorRecord>): PlannedSocialJob[] {
  for (const j of jobs) {
    if (j.reason === 'source_discovery') continue;
    const bonus = actorYieldPrior(history[j.actorKey]);
    if (bonus > 0) j.priority = Math.min(99, j.priority + bonus);
  }
  return jobs;
}

/** Searches that do not depend on a known source: their reach is what the budget buys. */
const INDEPENDENT_SEARCH = new Set<Stage>(['TIKTOK_SEARCH', 'LINKEDIN_POSTS', 'REDDIT_SEARCH', 'QUORA_SEARCH', 'BLUESKY_SEARCH']);
const STAGE_PLATFORM: Partial<Record<Stage, string>> = { TIKTOK_SEARCH: 'TIKTOK', LINKEDIN_POSTS: 'LINKEDIN', REDDIT_SEARCH: 'REDDIT', QUORA_SEARCH: 'QUORA', BLUESKY_SEARCH: 'BLUESKY' };
/** Finished paid runs after which an Actor that never qualified anyone gets only one exploratory probe. */
export const UNPRODUCTIVE_AFTER_RUNS = 8;

/**
 * Budget-aware depth and real performance. Discovery (group/community
 * search) and known sources are never cut here; independent keyword searches
 * are limited to the platforms and languages the budget tier unlocks, and an
 * Actor with a proven zero yield keeps one exploratory probe at low priority.
 */
export function applyDepth(jobs: PlannedSocialJob[], depth: Depth | null, history: Record<string, ActorRecord>): PlannedSocialJob[] {
  let out = jobs;
  if (depth) {
    out = out.filter((j) => {
      if (!INDEPENDENT_SEARCH.has(j.stage)) return true;
      if (!depth.platforms.includes(STAGE_PLATFORM[j.stage] ?? '')) return false;
      if (j.arm.startsWith('TIKTOK_HASHTAG') && depth.tier !== 'BROAD') return false;
      return j.language === 'multi' || depth.languages.includes(j.language as SearchLanguage);
    });
  }
  const kept = new Map<string, number>();
  return out.filter((j) => {
    const h = history[j.actorKey];
    if (!h || h.bookedRuns < UNPRODUCTIVE_AFTER_RUNS || h.qualified > 0 || !INDEPENDENT_SEARCH.has(j.stage)) return true;
    const n = kept.get(j.actorKey) ?? 0;
    kept.set(j.actorKey, n + 1);
    if (n >= 1) return false;
    j.priority = Math.max(1, j.priority - 20);
    j.reason = 'exploration_low_yield';
    return true;
  });
}

/**
 * Keep only the jobs that serve the owner's chosen languages. A search job is
 * in a language; a known source qualifies when ANY of its languages is chosen
 * (or it has none recorded — it is not excluded on a guess).
 */
export function restrictToLanguages(jobs: PlannedSocialJob[], target: readonly string[] | null | undefined, knownSources: readonly KnownSource[] = []): PlannedSocialJob[] {
  const want = new Set((target ?? []).map((l) => String(l).toLowerCase()));
  if (!want.size) return jobs;
  const byId = new Map(knownSources.map((s) => [s.id, s]));
  return jobs.filter((j) => {
    if (j.sourceId && byId.has(j.sourceId)) {
      const langs = byId.get(j.sourceId)!.languages;
      return !langs.length || langs.some((l) => want.has(String(l).toLowerCase()));
    }
    return j.language === 'multi' || want.has(String(j.language).toLowerCase());
  });
}
