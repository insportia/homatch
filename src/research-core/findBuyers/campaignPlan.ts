// The first tranche of a campaign's social jobs: every relevant source family
// and language gets one small probe, and known sources from the registry are
// used before paying to rediscover them.

import { SEARCH_LANGUAGES, type SearchLanguage } from './languages.ts';
import type { PropertyDna } from './propertyDna.ts';
import { queriesFor, type QueryPlan } from './queryPlanner.ts';
import { STAGE_ACTOR, type Stage } from './actorInputs.ts';
import { armPriority } from './allocator.ts';
import { planPaidTelegram, type TelegramPreference } from './telegramPreference.ts';

export interface KnownSource {
  id: string;
  platform: 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'VK' | 'TELEGRAM' | 'LINKEDIN' | 'X' | 'THREADS' | 'YOUTUBE';
  url: string;
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
  now?: number;
}

const DAY = 86_400_000;
/** Known groups/communities checked this recently cover a language's discovery. */
const DISCOVERY_REUSE_DAYS = 14;
const MAX_KNOWN_PER_FAMILY = 6;

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

export function initialSocialJobs(input: PlanInputs): PlannedSocialJob[] {
  const { dna, plan, knownSources, enabledActors } = input;
  const now = input.now ?? Date.now();
  const jobs: PlannedSocialJob[] = [];
  const has = (stage: Stage) => Boolean(enabledActors[STAGE_ACTOR[stage]]);
  const probe = (stage: Stage) => enabledActors[STAGE_ACTOR[stage]]?.probeSize ?? 20;
  const base = (stage: Stage) => enabledActors[STAGE_ACTOR[stage]]?.priority ?? 50;
  const cityMatch = (s: KnownSource) => !dna.city || !s.city || s.city.toLowerCase() === dna.city.toLowerCase();
  const fresh = (s: KnownSource) => s.lastCheckedAt != null && now - Date.parse(s.lastCheckedAt) < DISCOVERY_REUSE_DAYS * DAY;
  const known = (platform: KnownSource['platform']) => knownSources
    .filter((s) => s.platform === platform && cityMatch(s))
    .sort((a, b) => (b.historicalYield ?? 0) - (a.historicalYield ?? 0))
    .slice(0, MAX_KNOWN_PER_FAMILY);

  const pushKnown = (stage: Stage, platform: KnownSource['platform'], query: string | null = null, limit = MAX_KNOWN_PER_FAMILY) => {
    if (!has(stage)) return;
    for (const s of known(platform).slice(0, limit)) {
      jobs.push({
        stage, actorKey: STAGE_ACTOR[stage], language: (s.languages[0] as SearchLanguage) ?? 'multi', query,
        targetUrl: s.url, sourceId: s.id, size: probe(stage), arm: `${stage}:${s.id}`,
        priority: armPriority(null, s.historicalYield, base(stage) + 5), reason: 'known_source_reuse',
      });
    }
  };

  /* FACEBOOK: known groups first; group search only where the registry does
     not already cover the language. */
  pushKnown('FB_GROUP_POSTS', 'FACEBOOK');
  if (has('FB_GROUP_SEARCH')) {
    for (const lang of NETWORK_LANGUAGES.FACEBOOK) {
      const covered = known('FACEBOOK').filter((s) => s.languages.includes(lang) && fresh(s)).length >= 3;
      if (covered) continue;
      const q = queriesFor(plan, 'community', lang)[0];
      if (!q) continue;
      jobs.push({
        stage: 'FB_GROUP_SEARCH', actorKey: STAGE_ACTOR.FB_GROUP_SEARCH, language: lang, query: q.query, targetUrl: null,
        sourceId: null, size: probe('FB_GROUP_SEARCH'), arm: `FB_GROUP_SEARCH:${lang}`,
        priority: armPriority(null, null, base('FB_GROUP_SEARCH')), reason: 'source_discovery',
      });
    }
  }

  /* TIKTOK: search per language; hashtags where they are used. */
  if (has('TIKTOK_SEARCH')) {
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

  return restrictToLanguages(jobs, input.targetLanguages, knownSources);
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
