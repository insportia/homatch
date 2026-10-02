// PHASE 2 — THE DISCOVERY PLAN: what a campaign will search, in which order,
// within which limits, before anything is queued.
//
// Two directions, never one search with two labels:
//
//   DEMAND  "find buyers / tenants" — the subject is a property the customer
//           owns; the engine looks for people asking for something like it.
//   SUPPLY  "find property"         — the subject is a confirmed SearchPlan
//           (search-plan.ts); the engine looks for listings that fit it.
//
// A plan is pure data compiled deterministically from what the customer
// confirmed plus the operator's switches. The model reads sentences upstream
// (find-property-plan); nothing here calls a model, and nothing here executes.
// Queue rows are DERIVED from the plan by plannedSourceJobs() and nowhere
// else, so what an operator inspects in the stored plan is what ran.
//
// TRANCHES. Discovery is staged so cheap, high-value work runs first and the
// campaign stops as soon as it has enough:
//
//   0  HOMATCH_INTELLIGENCE  internal matching over what is already stored
//   1  native sources        Telegram communities, forums, P0 portals
//   2  source discovery      finding new communities in the plan's languages
//
// Higher tranches (search engines, browser/provider escalation) are not
// declared: the providers that would serve them are RETIRED, and a plan that
// listed them would be a plan that cannot run.
//
// EXECUTABLE PROVIDERS are a closed set. DATAFORSEO and APIFY are retired
// (CLAUDE.md) and cannot be named by a plan; the claim function refuses them a
// second time, and tests/matrix/phase2Discovery.test.mjs asserts both.

import type { PlanDraft, SearchPlan } from './search-plan.ts';
import { sourceQueriesFor } from './telegram-sources.ts';

export type DiscoveryDirection = 'SUPPLY' | 'DEMAND';

export type SourceClass =
  | 'HOMATCH_INTELLIGENCE'
  | 'COMMUNITY'
  | 'FORUM'
  | 'PORTAL'
  | 'SOURCE_DISCOVERY';

/** The only providers a plan may queue. Retired providers are not members. */
export type ExecutableProvider = 'TELEGRAM' | 'TELEGRAM_SOURCES' | 'FORUM' | 'PORTAL';

export const EXECUTABLE_PROVIDERS: readonly ExecutableProvider[] = [
  'TELEGRAM', 'TELEGRAM_SOURCES', 'FORUM', 'PORTAL',
];

/** Where a job runs. WORKER jobs are leased by the official Railway worker. */
export type Executor = 'EDGE' | 'WORKER';

export interface PlanSubject {
  transaction: 'SALE' | 'RENT' | null;
  propertyTypes: string[];
  countryCode: string;
  city: string | null;
  districts: string[];
  price: { min: number | null; max: number | null; currency: string | null } | null;
  bedrooms: { min: number | null; max: number | null } | null;
  areaSqm: { min: number | null; max: number | null } | null;
}

export interface PlannedTranche {
  tranche: 0 | 1 | 2;
  label: string;
  sourceClasses: SourceClass[];
  providers: ExecutableProvider[];
}

export interface DiscoveryPlan {
  version: 1;
  direction: DiscoveryDirection;
  market: string;
  languages: string[];
  subject: PlanSubject;
  /** Dimensions that disqualify on conflict. Everything else only ranks. */
  hardConstraints: string[];
  softPreferences: string[];
  freshness: {
    /** DEMAND: how old a request may be and still count as current. */
    activeDemandMaxDays: number;
    /** SUPPLY: a listing not seen for longer is revalidated before delivery. */
    revalidateAfterDays: number;
  };
  tranches: PlannedTranche[];
  /** Portal adapters to read (SUPPLY), in priority order. */
  portalAdapters: string[];
  /** Telegram community searches, language-tagged (tranche 2). */
  queryVariants: Array<{ language: string; query: string }>;
  budget: { maxCredits: number | null };
  stopping: { targetResults: number; deadlineMinutes: number; minScore: number };
}

export interface CompileSwitches {
  telegram: boolean;
  forum: boolean;
  portals: boolean;
  /** Portal adapters that are LIVE_TESTED/PRODUCTIVE and active for the market. */
  livePortalAdapters: readonly string[];
}

export interface CompileLimits {
  maxCredits: number | null;
  deadlineMinutes: number;
  targetResults: number;
  activeDemandMaxDays: number;
}

const MIN_SCORE = 20;
const REVALIDATE_AFTER_DAYS = 7;

const uniq = (values: readonly string[]) => [...new Set(values.filter(Boolean))];
const upper = (value: string | null | undefined) => (value ? String(value).trim().toUpperCase() : '');

function trancheList(direction: DiscoveryDirection, switches: CompileSwitches, hasPortals: boolean): PlannedTranche[] {
  const tranches: PlannedTranche[] = [
    { tranche: 0, label: 'HOMATCH intelligence', sourceClasses: ['HOMATCH_INTELLIGENCE'], providers: [] },
  ];
  const native: ExecutableProvider[] = [];
  const classes: SourceClass[] = [];
  if (switches.telegram) { native.push('TELEGRAM'); classes.push('COMMUNITY'); }
  /* Forums carry requests, not listings: they serve the DEMAND direction. */
  if (switches.forum && direction === 'DEMAND') { native.push('FORUM'); classes.push('FORUM'); }
  if (switches.portals && direction === 'SUPPLY' && hasPortals) { native.push('PORTAL'); classes.push('PORTAL'); }
  if (native.length) tranches.push({ tranche: 1, label: 'Native sources', sourceClasses: classes, providers: native });
  if (switches.telegram) {
    tranches.push({ tranche: 2, label: 'Finding new communities', sourceClasses: ['SOURCE_DISCOVERY'], providers: ['TELEGRAM_SOURCES'] });
  }
  return tranches;
}

/** DEMAND — from a property the customer owns. */
export function compileDemandPlan(input: {
  market: string;
  languages: readonly string[];
  property: {
    transactionType: string | null;
    propertyType: string | null;
    city: string | null;
    district: string | null;
    price: number | null;
    currency: string | null;
    bedrooms: number | null;
    areaSqm: number | null;
  };
  switches: CompileSwitches;
  limits: CompileLimits;
}): DiscoveryPlan {
  const market = upper(input.market) || 'GE';
  const tx = String(input.property.transactionType || '').toLowerCase();
  const transaction = tx.includes('rent') ? 'RENT' : tx ? 'SALE' : null;
  const languages = uniq(input.languages.map((l) => String(l).toLowerCase()));
  const subject: PlanSubject = {
    transaction,
    propertyTypes: input.property.propertyType ? [upper(input.property.propertyType)] : [],
    countryCode: market,
    city: input.property.city || null,
    districts: input.property.district ? [input.property.district] : [],
    price: input.property.price != null
      ? { min: null, max: input.property.price, currency: input.property.currency || null }
      : null,
    bedrooms: input.property.bedrooms != null ? { min: input.property.bedrooms, max: input.property.bedrooms } : null,
    areaSqm: input.property.areaSqm != null ? { min: input.property.areaSqm, max: input.property.areaSqm } : null,
  };
  /* The same hard gates run-matching-v2 applies (structured-gates.ts):
     transaction, type, city, district, budget and bedroom CONFLICTS. */
  const hard = ['transaction', 'propertyType', 'city', 'budget', 'bedrooms', 'freshness'];
  const soft = ['district', 'area', 'language', 'recency'];
  return {
    version: 1,
    direction: 'DEMAND',
    market,
    languages,
    subject,
    hardConstraints: hard,
    softPreferences: soft,
    freshness: { activeDemandMaxDays: input.limits.activeDemandMaxDays, revalidateAfterDays: REVALIDATE_AFTER_DAYS },
    tranches: trancheList('DEMAND', input.switches, false),
    portalAdapters: [],
    queryVariants: input.switches.telegram ? sourceQueriesFor(market, languages) : [],
    budget: { maxCredits: input.limits.maxCredits },
    stopping: {
      targetResults: Math.max(1, input.limits.targetResults),
      deadlineMinutes: Math.max(1, input.limits.deadlineMinutes),
      minScore: MIN_SCORE,
    },
  };
}

/** SUPPLY — from the SearchPlan the customer confirmed. */
export function compileSupplyPlan(input: {
  plan: SearchPlan;
  switches: CompileSwitches;
  limits: CompileLimits;
}): DiscoveryPlan {
  const p = input.plan;
  const market = upper(p.countryCode) || 'GE';
  const transaction = p.deal === 'RENT' || p.deal === 'SHORT_STAY' ? 'RENT' : 'SALE';
  const required = (c: { strength: string } | null) => !!c && c.strength === 'REQUIRED';
  const hard = ['transaction'];
  const soft: string[] = [];
  const dims: Array<[string, { strength: string } | null]> = [
    ['city', p.city], ['districts', p.districts], ['propertyTypes', p.propertyTypes],
    ['budget', p.budget], ['bedrooms', p.bedrooms], ['areaSqm', p.areaSqm],
  ];
  for (const [name, c] of dims) {
    if (!c) continue;
    (required(c) ? hard : soft).push(name);
  }
  const portalAdapters = input.switches.portals ? uniq([...input.switches.livePortalAdapters]) : [];
  const languages = uniq(p.languages.map((l) => String(l).toLowerCase()));
  return {
    version: 1,
    direction: 'SUPPLY',
    market,
    languages,
    subject: {
      transaction,
      propertyTypes: p.propertyTypes ? [...p.propertyTypes.value] : [],
      countryCode: market,
      city: p.city?.value ?? null,
      districts: p.districts ? [...p.districts.value] : [],
      price: p.budget ? { min: p.budget.value.min, max: p.budget.value.max, currency: p.budget.value.currency } : null,
      bedrooms: p.bedrooms ? { ...p.bedrooms.value } : null,
      areaSqm: p.areaSqm ? { ...p.areaSqm.value } : null,
    },
    hardConstraints: hard,
    softPreferences: soft,
    freshness: { activeDemandMaxDays: input.limits.activeDemandMaxDays, revalidateAfterDays: REVALIDATE_AFTER_DAYS },
    tranches: trancheList('SUPPLY', input.switches, portalAdapters.length > 0),
    portalAdapters,
    queryVariants: input.switches.telegram ? sourceQueriesFor(market, languages) : [],
    budget: { maxCredits: input.limits.maxCredits },
    stopping: {
      targetResults: Math.max(1, input.limits.targetResults),
      deadlineMinutes: Math.max(1, input.limits.deadlineMinutes),
      minScore: MIN_SCORE,
    },
  };
}

export interface PlannedSourceJob {
  provider: ExecutableProvider;
  tranche: 1 | 2;
  executor: Executor;
  platform: string;
  language: string;
  queryKind: string;
  priority: number;
  /** Stable per (run, provider, scope): retries and replays cannot duplicate it. */
  dedupeKey: string;
  metadata: Record<string, unknown>;
}

/**
 * The queue rows a plan implies. The ONLY place a source job's shape is
 * decided. Tranche 0 is internal matching and queues nothing.
 */
export function plannedSourceJobs(plan: DiscoveryPlan, runKey: string): PlannedSourceJob[] {
  const jobs: PlannedSourceJob[] = [];
  const has = (provider: ExecutableProvider) => plan.tranches.some((t) => t.providers.includes(provider));
  const base = { market: plan.market, direction: plan.direction };
  if (has('TELEGRAM')) {
    jobs.push({
      provider: 'TELEGRAM', tranche: 1, executor: 'EDGE', platform: 'TELEGRAM', language: 'multi',
      queryKind: 'CAMPAIGN_SYNC', priority: 70, dedupeKey: `${runKey}:TELEGRAM`,
      metadata: { ...base },
    });
  }
  if (has('FORUM')) {
    jobs.push({
      provider: 'FORUM', tranche: 1, executor: 'EDGE', platform: 'FORUM', language: 'multi',
      queryKind: 'CAMPAIGN_FORUM', priority: 65, dedupeKey: `${runKey}:FORUM`,
      metadata: { ...base },
    });
  }
  if (has('PORTAL')) {
    plan.portalAdapters.forEach((adapterId, index) => {
      jobs.push({
        provider: 'PORTAL', tranche: 1, executor: 'EDGE', platform: 'WEBSITE', language: 'multi',
        queryKind: 'PORTAL_COLLECT', priority: 68 - Math.min(index, 8), dedupeKey: `${runKey}:PORTAL:${adapterId}`,
        metadata: { ...base, adapterId, subject: plan.subject },
      });
    });
  }
  if (has('TELEGRAM_SOURCES') && plan.queryVariants.length) {
    jobs.push({
      provider: 'TELEGRAM_SOURCES', tranche: 2, executor: 'EDGE', platform: 'TELEGRAM',
      language: plan.languages.join(',') || 'multi', queryKind: 'SOURCE_DISCOVERY', priority: 60,
      dedupeKey: `${runKey}:TELEGRAM_SOURCES`,
      metadata: { ...base, languages: plan.languages, queries: plan.queryVariants.map((q) => q.query) },
    });
  }
  return jobs;
}

/** Customer-safe progress stages, each backed by a real state. */
export type DiscoveryStage =
  | 'UNDERSTANDING' | 'CHECKING_HOMATCH' | 'SEARCHING_SOURCES' | 'VALIDATING' | 'MATCHING' | 'READY' | 'PAUSED' | 'STOPPED';

/** Customer-safe source group for a provider (no provider names leak). */
export function sourceGroupOf(provider: string): 'COMMUNITIES' | 'FORUMS' | 'PROPERTY_PORTALS' | 'HOMATCH' {
  switch (String(provider).toUpperCase()) {
    case 'TELEGRAM': case 'TELEGRAM_SOURCES': return 'COMMUNITIES';
    case 'FORUM': return 'FORUMS';
    case 'PORTAL': return 'PROPERTY_PORTALS';
    default: return 'HOMATCH';
  }
}

/**
 * A stored SearchPlan (active_search_subscriptions.search_criteria) back into
 * the flat draft normalisePlan() reads, so a plan read from the database is
 * re-validated through the same closed vocabularies instead of being trusted.
 */
export function draftFromStoredPlan(stored: unknown): PlanDraft {
  const p = (stored && typeof stored === 'object' ? stored : {}) as Record<string, any>;
  const c = (key: string) => (p[key] && typeof p[key] === 'object' ? p[key] : null);
  const city = c('city'); const districts = c('districts'); const types = c('propertyTypes');
  const budget = c('budget'); const bedrooms = c('bedrooms'); const area = c('areaSqm');
  return {
    goal: p.goal,
    countryCode: p.countryCode,
    city: city?.value, cityStrength: city?.strength,
    districts: districts?.value, districtsStrength: districts?.strength,
    propertyTypes: types?.value, propertyTypesStrength: types?.strength,
    budgetMin: budget?.value?.min, budgetMax: budget?.value?.max, currency: budget?.value?.currency,
    budgetStrength: budget?.strength,
    bedroomsMin: bedrooms?.value?.min, bedroomsMax: bedrooms?.value?.max, bedroomsStrength: bedrooms?.strength,
    areaMin: area?.value?.min, areaMax: area?.value?.max, areaStrength: area?.strength,
    languages: p.languages,
    originalText: p.originalText,
    originalLanguage: p.originalLanguage,
  };
}
