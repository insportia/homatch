// The first tranche of a campaign's social jobs: every relevant source family
// and language gets one small probe, and known sources from the registry are
// used before paying to rediscover them.

import { SEARCH_LANGUAGES, type SearchLanguage } from './languages.ts';
import type { PropertyDna } from './propertyDna.ts';
import { queriesFor, type QueryPlan } from './queryPlanner.ts';
import { STAGE_ACTOR, type Stage } from './actorInputs.ts';
import { armPriority } from './allocator.ts';

export interface KnownSource {
  id: string;
  platform: 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'VK' | 'TELEGRAM' | 'LINKEDIN';
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

  /* VK / INSTAGRAM: walls and profiles the registry already knows. */
  const vkKeyword = queriesFor(plan, 'demand', 'ru')[0]?.query ?? null;
  pushKnown('VK_WALL', 'VK', vkKeyword, 4);
  pushKnown('IG_PROFILE_POSTS', 'INSTAGRAM', null, 3);

  /* TELEGRAM via memo23 only when native Telegram is not collecting. */
  if (!input.nativeTelegramActive) pushKnown('TELEGRAM_CHANNEL', 'TELEGRAM', null, 3);

  return jobs;
}
