// FIND BUYERS / FIND TENANTS — the adaptive search loop.
//
// THE DEFECT THIS CLOSES (2026-10-12). A campaign ran one planned batch, and the
// moment its queue drained it was finalized — even with most of its budget unspent
// and zero qualified leads. A first batch that found nothing ended the search.
//
// NOW, whenever a campaign's queue drains before its deadline:
//
//   evidence  →  next pass on a bounded fallback ladder  →  the model proposes actions
//             →  this file validates every action  →  queue only what passes
//             →  or stop, with an honest reason and the coverage that was searched.
//
// THE LADDER (Pass 1 is the launch plan; each later pass runs at most once):
//   DIRECT    high-confidence direct buyer/tenant intent (the launch plan)
//   SEMANTIC  multilingual and colloquial variants; languages not yet searched
//   FLEXIBLE  controlled flexibility: the budget band ±12%, nearby districts, the city
//   EXPLORE   more communities / groups / other healthy platforms
//   COMMENTS  comments under parent posts that already scored as promising
//
// THE MODEL PROPOSES, THIS CODE DISPOSES. Nothing the model says can launch an Actor
// that is not enabled, verified, healthy and priced; repeat a query already paid for
// (or a near-duplicate); read comments under a post that did not earn it; or spend
// past the campaign's remaining budget. A stop is honoured only when it is not
// premature. Pure: no I/O, so every rule is tested (findBuyersAdaptiveLoop.test.mjs).

import { STAGE_ACTOR, type Stage } from './actorInputs.ts';
import type { PlannedSocialJob } from './campaignPlan.ts';
import { classifyDemand } from './demandClassifier.ts';
import { SEARCH_LANGUAGES, type SearchLanguage } from './languages.ts';
import { NEARBY_DISTRICTS, normKey, placeNamesFor } from './places.ts';
import { FAMILY_NOUN, type PropertyFamily } from './propertyFamily.ts';
import { normalizeQuery } from './queryPlanner.ts';

export const ADAPTIVE_VERSION = 'fb-adaptive-1';
export const LADDER = ['DIRECT', 'SEMANTIC', 'FLEXIBLE', 'EXPLORE', 'COMMENTS'] as const;
export type Pass = typeof LADDER[number];
/** Adaptive rounds after the launch plan. Bounded: the loop always ends. */
export const MAX_ADAPTIVE_ROUNDS = 4;
export const MAX_JOBS_PER_ROUND = 6;
/** Controlled numeric flexibility for the FLEXIBLE pass (±12%). */
export const FLEX = 0.12;
/**
 * Kept free of Actor runs for the campaign's remaining model calls (planning,
 * classification, these rounds): the model is paid from the same provider budget.
 * Not an allocation rule: everything above it is the AI's to allocate.
 */
export const AI_RESERVE_MICROS = 50_000;

/** What a round may commit to Actor runs: the whole remaining budget minus the model reserve. */
export function allocatableMicros(e: Pick<CampaignEvidence, 'budgetMicros' | 'spentMicros'>): number {
  return Math.max(0, remainingMicros(e) - AI_RESERVE_MICROS);
}

export type StopReason =
  | 'BUDGET_EXHAUSTED' | 'MAX_ROUNDS' | 'COVERAGE_COMPLETE' | 'NO_USABLE_ACTOR' | 'MODEL_DIMINISHING_RETURNS' | 'NOTHING_NEW_TO_SEARCH';

/** Stages that take a free-text search phrase. FB_GROUP_SEARCH finds communities, the rest find posts. */
export const QUERY_STAGES: readonly Stage[] = ['FB_GROUP_SEARCH', 'TIKTOK_SEARCH', 'BLUESKY_SEARCH', 'LINKEDIN_POSTS', 'REDDIT_SEARCH', 'QUORA_SEARCH'];
const COMMENT_STAGES: readonly Stage[] = ['FB_COMMENTS', 'IG_COMMENTS'];

export interface ActorGate {
  probeSize: number; priority: number; startFeeMicros: number; pricePer1kMicros: number;
  /** The Actor's registry max_results: the largest run the AI may ask for. */
  maxResults?: number;
}

/** Smallest run the AI may ask for: below this a start fee buys almost nothing. */
export const MIN_ITEMS_PER_RUN = 5;

/**
 * How many items one run fetches. The AI decides (itemsPerRun); deterministic
 * code only keeps it inside what the Actor accepts. No proposal → the probe size.
 */
export function runSize(g: ActorGate, requested: number | null | undefined): number {
  const max = Math.max(g.probeSize, Number(g.maxResults) || g.probeSize);
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return g.probeSize;
  return Math.min(max, Math.max(MIN_ITEMS_PER_RUN, Math.round(n)));
}

export interface ActorEvidence {
  actorKey: string;
  /** This campaign. */
  runs: number; items: number; useful: number; qualified: number; spentMicros: number;
  /** Consecutive most-recent runs with no items / that failed. */
  emptyStreak: number; failedStreak: number;
  /** Every campaign, last 90 days (learning across campaigns). */
  globalRuns: number; globalItems: number; globalQualified: number; globalSpentMicros: number;
}

export interface LanguageEvidence { language: string; queries: number; items: number; qualified: number }

export interface CampaignEvidence {
  transaction: 'SALE' | 'RENT';
  family: PropertyFamily;
  city: string | null;
  district: string | null;
  price: number | null;
  currency: string | null;
  areaSqm: number | null;
  /** Adaptive rounds already run (0 before the first). */
  round: number;
  passesTried: Pass[];
  budgetMicros: number;
  /** Everything committed against the provider budget: Actor runs AND the model's calls. */
  spentMicros: number;
  /** The model-call part of spentMicros (already included there). */
  aiSpentMicros?: number;
  sourcesDiscovered: number;
  postsInspected: number;
  signals: number;
  qualified: number;
  strong: number;
  duplicates: number;
  irrelevant: number;
  /** Qualified leads the previous adaptive round produced (null before the first). */
  lastRoundQualified: number | null;
  actors: ActorEvidence[];
  languages: LanguageEvidence[];
  usedQueries: Array<{ language: string; query: string }>;
  usedTargets: string[];
  /** Parent posts that scored at or above the comment gate and whose comments were not read yet. */
  promisingParents: Array<{ url: string; stage: 'FB_COMMENTS' | 'IG_COMMENTS'; similarity: number }>;
}

/* ── evidence helpers ─────────────────────────────────────────────────── */

export function remainingMicros(e: Pick<CampaignEvidence, 'budgetMicros' | 'spentMicros'>): number {
  return Math.max(0, e.budgetMicros - e.spentMicros);
}

export function runEstimate(g: ActorGate, size = g.probeSize): number {
  return g.startFeeMicros + Math.ceil((size * g.pricePer1kMicros) / 1000);
}

/**
 * An Actor this campaign should not pay for again: two empty or failed runs in a
 * row, high-volume output that is almost never useful, or a long record across
 * campaigns with no qualified lead at all.
 */
export function actorExhausted(a: ActorEvidence | undefined): string | null {
  if (!a) return null;
  if (a.emptyStreak >= 2) return 'REPEATEDLY_EMPTY';
  if (a.failedStreak >= 2) return 'REPEATEDLY_FAILED';
  if (a.items >= 40 && a.useful / a.items < 0.03) return 'IRRELEVANT_OUTPUT';
  if (a.globalRuns >= 8 && a.globalQualified === 0 && a.globalItems >= 100) return 'NO_YIELD_ACROSS_CAMPAIGNS';
  return null;
}

/** Cost per qualified lead (USD) for one Actor, this campaign; null when nothing qualified yet. */
export function costPerQualified(a: ActorEvidence): number | null {
  return a.qualified > 0 ? a.spentMicros / 1e6 / a.qualified : null;
}

export function flexBand(value: number | null, pct = FLEX): { min: number; max: number } | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return { min: Math.round(value * (1 - pct)), max: Math.round(value * (1 + pct)) };
}

/* ── which pass next, or stop ─────────────────────────────────────────── */

export type NextStep = { kind: 'RUN'; pass: Pass } | { kind: 'STOP'; reason: StopReason };

/** The cheapest run any usable query/comment Actor could make. */
function cheapestRun(e: CampaignEvidence, gates: Record<string, ActorGate>): number | null {
  const byKey = new Map(e.actors.map((a) => [a.actorKey, a]));
  let min: number | null = null;
  for (const stage of [...QUERY_STAGES, ...COMMENT_STAGES]) {
    const key = STAGE_ACTOR[stage];
    const g = gates[key];
    if (!g || actorExhausted(byKey.get(key))) continue;
    const c = runEstimate(g);
    min = min == null ? c : Math.min(min, c);
  }
  return min;
}

export function nextStep(e: CampaignEvidence, gates: Record<string, ActorGate>): NextStep {
  if (e.round >= MAX_ADAPTIVE_ROUNDS) return { kind: 'STOP', reason: 'MAX_ROUNDS' };
  const cheapest = cheapestRun(e, gates);
  if (cheapest == null) return { kind: 'STOP', reason: 'NO_USABLE_ACTOR' };
  if (allocatableMicros(e) < cheapest) return { kind: 'STOP', reason: 'BUDGET_EXHAUSTED' };
  const tried = new Set<Pass>(['DIRECT', ...e.passesTried]);
  for (const pass of LADDER) {
    if (tried.has(pass)) continue;
    if (pass === 'COMMENTS' && !e.promisingParents.length) continue;
    if (pass === 'FLEXIBLE' && e.price == null && !e.district) continue;
    return { kind: 'RUN', pass };
  }
  return { kind: 'STOP', reason: 'COVERAGE_COMPLETE' };
}

/* ── the model's proposal: schema ─────────────────────────────────────── */

export const ACTION_TYPES = [
  'REFINE_QUERIES', 'EXPAND_PLACES', 'SWITCH_LANGUAGE', 'EXPLORE_SOURCES', 'INSPECT_COMMENTS',
  'PRIORITIZE_ACTOR', 'STOP_ACTOR', 'STOP_CAMPAIGN',
] as const;
export type ActionType = typeof ACTION_TYPES[number];

export interface ProposedAction {
  type: ActionType;
  stage: string | null;
  actorKey: string | null;
  queries: Array<{ language: string; query: string }>;
  urls: string[];
  /** The AI's run size for every job this action creates; null = the Actor's probe size. */
  itemsPerRun?: number | null;
  rationale: string;
}

/** Strict structured output: the model can only answer in this shape. */
export const ADAPTIVE_ACTION_SCHEMA = {
  name: 'find_buyers_next_actions',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['assessment', 'actions'],
    properties: {
      assessment: { type: 'string', maxLength: 400 },
      actions: {
        type: 'array', maxItems: 8,
        items: {
          type: 'object', additionalProperties: false,
          required: ['type', 'stage', 'actorKey', 'queries', 'urls', 'itemsPerRun', 'rationale'],
          properties: {
            type: { type: 'string', enum: [...ACTION_TYPES] },
            stage: { type: ['string', 'null'], enum: [...QUERY_STAGES, ...COMMENT_STAGES, null] },
            actorKey: { type: ['string', 'null'] },
            queries: {
              type: 'array', maxItems: 8,
              items: {
                type: 'object', additionalProperties: false, required: ['language', 'query'],
                properties: { language: { type: 'string', enum: [...SEARCH_LANGUAGES] }, query: { type: 'string', maxLength: 120 } },
              },
            },
            urls: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 500 } },
            itemsPerRun: { type: ['integer', 'null'] },
            rationale: { type: 'string', maxLength: 240 },
          },
        },
      },
    },
  },
} as const;

export const ADAPTIVE_SYSTEM_PROMPT = [
  'You steer a real-estate demand search (people who want to buy or rent) across public social platforms in Georgia.',
  'You receive measured evidence from the runs so far and the pass to run next. Propose the next best actions.',
  'Pass meanings: SEMANTIC = new natural, colloquial phrasings and languages not yet searched (ka, ru, en, ar, he, tr);',
  'FLEXIBLE = the budget band and nearby districts or the whole city (never claim an exact match);',
  'EXPLORE = new communities/groups to search (FB_GROUP_SEARCH queries are community names, e.g. "Квартиры Тбилиси");',
  'COMMENTS = read comments only under the listed promising parent posts.',
  'Every search phrase must be what a person who WANTS the property writes — never a seller, owner or agent phrase.',
  'Never repeat a used query or a near copy of one. Prefer the Actor and language with the best qualified-per-dollar.',
  'Stop an Actor that keeps returning nothing or irrelevant output. Use STOP_CAMPAIGN only when more searching is unlikely to pay off.',
  'You decide where the money goes: which Actor, which query, and itemsPerRun for each action, from each Actor\'s price, its measured yield',
  'and allocatableUsd (cost of one run = startFeeUsd + itemsPerRun × pricePer1kUsd / 1000). There are no per-Actor caps and no fixed shares:',
  'move money to what produces qualified people per dollar and away from what does not, and decide how much to keep for the passes still ahead.',
  'The campaign budget (your own calls included) is the only limit; anything over allocatableUsd is refused.',
].join(' ');

/* ── validation ───────────────────────────────────────────────────────── */

export interface ValidationContext {
  evidence: CampaignEvidence;
  gates: Record<string, ActorGate>;
  pass: Pass;
}

export interface Validated {
  jobs: PlannedSocialJob[];
  rejected: Array<{ type: string; detail: string; reason: string }>;
  stoppedActors: string[];
  stopCampaign: boolean;
  committedMicros: number;
}

const tokens = (q: string) => new Set(normalizeQuery(q).split(' ').filter((t) => t.length > 1));
function nearDuplicate(a: string, b: string): boolean {
  const x = tokens(a); const y = tokens(b);
  if (!x.size || !y.size) return false;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter) >= 0.75;
}

/** A community search phrase: names real estate or a place; never a job or a service. */
function communityPhraseOk(q: string): boolean {
  const r = classifyDemand(q);
  return !['JOB', 'SERVICE'].includes(r.role) && (r.role !== 'IRRELEVANT' || /tbilis|тбилис|თბილის|batum|батум|ბათუმ|georgia|грузи|საქართველ|kutais|кутаис|ქუთაის/iu.test(q));
}

function demandPhraseOk(q: string, transaction: 'SALE' | 'RENT'): boolean {
  return classifyDemand(q).role === (transaction === 'RENT' ? 'RENT_SEEKER' : 'BUY_SEEKER');
}

/** A premature stop is refused: at least two adaptive passes must have run first, unless the budget is nearly spent. */
export function stopIsPremature(e: CampaignEvidence, gates: Record<string, ActorGate>): boolean {
  const cheapest = cheapestRun(e, gates);
  const nearlySpent = cheapest == null || allocatableMicros(e) < 2 * cheapest;
  return e.passesTried.length < 2 && !nearlySpent;
}

export function validateActions(actions: ProposedAction[], ctx: ValidationContext): Validated {
  const { evidence: e, gates, pass } = ctx;
  const out: Validated = { jobs: [], rejected: [], stoppedActors: [], stopCampaign: false, committedMicros: 0 };
  const byKey = new Map(e.actors.map((a) => [a.actorKey, a]));
  const used = e.usedQueries.map((u) => ({ language: u.language, query: u.query }));
  const usedTargets = new Set(e.usedTargets.map((t) => t.toLowerCase()));
  const promising = new Map(e.promisingParents.map((p) => [p.url.toLowerCase(), p]));
  const allowance = allocatableMicros(e);
  const prioritized = new Set<string>();
  const reject = (a: ProposedAction, detail: string, reason: string) => out.rejected.push({ type: a.type, detail, reason });

  /* Stops first: they constrain everything after them. */
  for (const a of actions) {
    if (a.type === 'STOP_ACTOR' && a.actorKey) out.stoppedActors.push(a.actorKey);
    if (a.type === 'PRIORITIZE_ACTOR' && a.actorKey && gates[a.actorKey]) prioritized.add(a.actorKey);
    if (a.type === 'STOP_CAMPAIGN') {
      if (stopIsPremature(e, gates)) reject(a, 'campaign', 'PREMATURE_STOP');
      else out.stopCampaign = true;
    }
  }
  const usable = (stage: Stage): string | null => {
    const key = STAGE_ACTOR[stage];
    if (!gates[key]) return 'ACTOR_NOT_ALLOWED';
    if (out.stoppedActors.includes(key)) return 'ACTOR_STOPPED';
    const ex = actorExhausted(byKey.get(key));
    return ex;
  };
  const add = (a: ProposedAction, job: PlannedSocialJob) => {
    if (out.jobs.length >= MAX_JOBS_PER_ROUND) { reject(a, job.query ?? job.targetUrl ?? '', 'ROUND_FULL'); return; }
    const cost = runEstimate(gates[job.actorKey], job.size);
    if (out.committedMicros + cost > allowance) { reject(a, job.query ?? job.targetUrl ?? '', 'OVER_BUDGET'); return; }
    out.committedMicros += cost;
    out.jobs.push(job);
  };

  for (const a of actions) {
    if (out.stopCampaign) break;
    if (a.type === 'STOP_ACTOR' || a.type === 'STOP_CAMPAIGN' || a.type === 'PRIORITIZE_ACTOR') continue;

    if (a.type === 'INSPECT_COMMENTS') {
      if (pass !== 'COMMENTS') { reject(a, a.urls.join(' '), 'WRONG_PASS'); continue; }
      for (const url of a.urls.slice(0, 5)) {
        const p = promising.get(String(url).toLowerCase());
        if (!p) { reject(a, url, 'PARENT_NOT_QUALIFIED'); continue; }
        if (usedTargets.has(url.toLowerCase())) { reject(a, url, 'ALREADY_READ'); continue; }
        const why = usable(p.stage);
        if (why) { reject(a, url, why); continue; }
        usedTargets.add(url.toLowerCase());
        const key = STAGE_ACTOR[p.stage];
        add(a, { stage: p.stage, actorKey: key, language: 'multi', query: null, targetUrl: p.url, sourceId: null,
          size: runSize(gates[key], a.itemsPerRun), arm: `adaptive:${pass}`, priority: 80, reason: `adaptive_${pass.toLowerCase()}` });
      }
      continue;
    }

    /* Query actions: REFINE_QUERIES, EXPAND_PLACES, SWITCH_LANGUAGE, EXPLORE_SOURCES. */
    const stage = (a.type === 'EXPLORE_SOURCES' ? 'FB_GROUP_SEARCH' : a.stage) as Stage | null;
    if (!stage || !QUERY_STAGES.includes(stage)) { reject(a, String(a.stage), 'NOT_A_QUERY_STAGE'); continue; }
    const why = usable(stage);
    if (why) { reject(a, stage, why); continue; }
    const key = STAGE_ACTOR[stage];
    for (const q of a.queries) {
      const language = String(q.language ?? '').toLowerCase();
      const query = String(q.query ?? '').replace(/\s+/g, ' ').trim();
      if (!(SEARCH_LANGUAGES as readonly string[]).includes(language)) { reject(a, query, 'LANGUAGE_NOT_SUPPORTED'); continue; }
      if (query.length < 3 || query.length > 120) { reject(a, query, 'LENGTH'); continue; }
      const ok = stage === 'FB_GROUP_SEARCH' ? communityPhraseOk(query) : demandPhraseOk(query, e.transaction);
      if (!ok) { reject(a, query, stage === 'FB_GROUP_SEARCH' ? 'NOT_A_REAL_ESTATE_COMMUNITY' : 'NOT_DEMAND_INTENT'); continue; }
      const norm = normalizeQuery(query);
      const dup = used.find((u) => u.language === language && (normalizeQuery(u.query) === norm || nearDuplicate(u.query, query)));
      if (dup) { reject(a, query, 'REPEATS_A_USED_QUERY'); continue; }
      used.push({ language, query });
      add(a, { stage, actorKey: key, language: language as SearchLanguage, query, targetUrl: null, sourceId: null,
        size: runSize(gates[key], a.itemsPerRun), arm: `adaptive:${pass}`, priority: prioritized.has(key) ? 75 : 60, reason: `adaptive_${pass.toLowerCase()}` });
    }
  }
  /* Best-yielding Actors first within the round. */
  out.jobs.sort((x, y) => y.priority - x.priority);
  return out;
}

/* ── deterministic fallback: a pass still runs when the model is unavailable ─ */

const SEMANTIC: Record<SearchLanguage, { buy: string[]; rent: string[] }> = {
  ka: { buy: ['ვეძებ {noun} შესაძენად {city}', 'მინდა ვიყიდო {noun} {city}'], rent: ['ვეძებ {noun} ქირით {city}', 'მინდა ვიქირაო {noun} {city}'] },
  ru: { buy: ['ищу {noun} для покупки {city}', 'хотим купить {noun} в {city}'], rent: ['ищу {noun} в аренду {city}', 'хотим снять {noun} в {city}'] },
  en: { buy: ['want to buy {noun} in {city}', 'we are looking to buy {noun} {city}'], rent: ['want to rent {noun} in {city}', 'we are looking to rent {noun} {city}'] },
  ar: { buy: ['أريد شراء {noun} في {city}', 'نبحث عن {noun} للشراء في {city}'], rent: ['أريد استئجار {noun} في {city}', 'نبحث عن {noun} للإيجار في {city}'] },
  he: { buy: ['רוצה לקנות {noun} ב{city}', 'מחפשים {noun} לקנייה ב{city}'], rent: ['רוצה לשכור {noun} ב{city}', 'מחפשים {noun} להשכרה ב{city}'] },
  tr: { buy: ['{city} {noun} almak istiyorum', '{city} {noun} satın almak istiyoruz'], rent: ['{city} {noun} kiralamak istiyorum', '{city} {noun} kiralamak istiyoruz'] },
};
const COMMUNITY: Record<SearchLanguage, string[]> = {
  ka: ['უძრავი ქონება {place}', 'ბინები {place}'],
  ru: ['недвижимость {place}', 'квартиры {place}'],
  en: ['{place} real estate', '{place} expats housing'],
  ar: ['عقارات {place}', 'العرب في {place}'],
  he: ['נדל"ן {place}', 'ישראלים ב{place}'],
  tr: ['{place} emlak', '{place} türkler'],
};
const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '').replace(/\s+/g, ' ').trim();

/** The pass's actions without the model: new languages, flexible places, new communities, promising comments. */
export function fallbackActions(e: CampaignEvidence, pass: Pass): ProposedAction[] {
  const actions: ProposedAction[] = [];
  const action = (type: ActionType, stage: string | null, queries: Array<{ language: string; query: string }>, urls: string[] = []): ProposedAction =>
    ({ type, stage, actorKey: null, queries, urls, rationale: `fallback:${pass}` });
  const byLanguage = new Map(e.languages.map((l) => [l.language, l]));
  /* Languages that were never searched, or searched and returned nothing, come first. */
  const order = [...SEARCH_LANGUAGES].sort((a, b) => (byLanguage.get(a)?.items ?? -1) - (byLanguage.get(b)?.items ?? -1));
  const cityFor = (lang: SearchLanguage) => {
    const n = placeNamesFor('city', e.city, lang);
    return n.length ? (lang === 'ka' ? n[n.length - 1] : n[0]) : (e.city ?? '');
  };
  if (pass === 'SEMANTIC') {
    const qs = order.flatMap((lang) => (SEMANTIC[lang][e.transaction === 'RENT' ? 'rent' : 'buy']).map((t) =>
      ({ language: lang, query: fill(t, { noun: FAMILY_NOUN[e.family][lang], city: cityFor(lang) }) })));
    actions.push(action('SWITCH_LANGUAGE', 'FB_GROUP_SEARCH', order.map((lang) => ({ language: lang, query: fill(COMMUNITY[lang][1], { place: cityFor(lang) }) }))));
    actions.push(action('REFINE_QUERIES', 'TIKTOK_SEARCH', qs));
    actions.push(action('REFINE_QUERIES', 'BLUESKY_SEARCH', qs));
  }
  if (pass === 'FLEXIBLE') {
    const district = normKey(e.district);
    const nearby = district ? (NEARBY_DISTRICTS[district] ?? []) : [];
    const places = order.flatMap((lang) => [
      ...nearby.slice(0, 2).map((d) => placeNamesFor('district', d, lang)[0]).filter(Boolean),
      cityFor(lang),
    ].map((place) => ({ language: lang, query: fill(COMMUNITY[lang][0], { place }) })));
    actions.push(action('EXPAND_PLACES', 'FB_GROUP_SEARCH', places));
  }
  if (pass === 'EXPLORE') {
    actions.push(action('EXPLORE_SOURCES', 'FB_GROUP_SEARCH', order.map((lang) => ({ language: lang, query: fill(COMMUNITY[lang][1], { place: cityFor(lang) }) }))));
  }
  if (pass === 'COMMENTS') {
    const top = [...e.promisingParents].sort((a, b) => b.similarity - a.similarity).slice(0, 5);
    if (top.length) actions.push(action('INSPECT_COMMENTS', top[0].stage, [], top.map((p) => p.url)));
  }
  /* Stop what the evidence already condemns. */
  for (const a of e.actors) if (actorExhausted(a)) actions.unshift({ ...action('STOP_ACTOR', null, []), actorKey: a.actorKey });
  return actions;
}

/** The evidence as the model reads it: numbers, never raw posts. */
export function evidenceForModel(e: CampaignEvidence, pass: Pass, gates: Record<string, ActorGate> = {}) {
  return {
    pass, round: e.round + 1, passesTried: e.passesTried,
    property: { transaction: e.transaction, family: e.family, city: e.city, district: e.district,
      budgetBand: flexBand(e.price), areaBand: flexBand(e.areaSqm), currency: e.currency },
    funnel: { sourcesDiscovered: e.sourcesDiscovered, postsInspected: e.postsInspected, signals: e.signals,
      qualified: e.qualified, strong: e.strong, duplicates: e.duplicates, irrelevant: e.irrelevant,
      intentRate: e.postsInspected ? Math.round((100 * e.signals) / e.postsInspected) : null },
    budget: { remainingUsd: remainingMicros(e) / 1e6, spentUsd: e.spentMicros / 1e6,
      modelSpentUsd: (e.aiSpentMicros ?? 0) / 1e6, allocatableUsd: allocatableMicros(e) / 1e6 },
    /* What each allowed Actor costs and accepts, so the model can size runs itself. */
    pricing: Object.entries(gates).map(([actorKey, g]) => ({ actorKey, startFeeUsd: g.startFeeMicros / 1e6,
      pricePer1kUsd: g.pricePer1kMicros / 1e6, defaultItemsPerRun: g.probeSize, maxItemsPerRun: runSize(g, Number.MAX_SAFE_INTEGER) })),
    actors: e.actors.map((a) => ({ actorKey: a.actorKey, runs: a.runs, items: a.items, useful: a.useful, qualified: a.qualified,
      spentUsd: a.spentMicros / 1e6, costPerQualifiedUsd: costPerQualified(a), exhausted: actorExhausted(a),
      allCampaigns: { runs: a.globalRuns, items: a.globalItems, qualified: a.globalQualified } })),
    languages: e.languages,
    usedQueries: e.usedQueries.slice(-60),
    promisingParents: e.promisingParents.slice(0, 5),
  };
}

/** What the owner may see of the adaptive search: how far it went and why it ended. No costs, no queries. */
export interface PublicSearchPasses { rounds: number; passes: Pass[]; stop: StopReason | null }

export function publicSearchPasses(adaptive: unknown): PublicSearchPasses {
  const a = (adaptive && typeof adaptive === 'object' ? adaptive : {}) as { rounds?: unknown; stop?: unknown };
  const rounds = Array.isArray(a.rounds) ? a.rounds as Array<{ pass?: unknown }> : [];
  const passes: Pass[] = ['DIRECT'];
  for (const r of rounds) {
    const p = r?.pass as Pass;
    if ((LADDER as readonly string[]).includes(p) && !passes.includes(p)) passes.push(p);
  }
  const stop = typeof a.stop === 'string' ? a.stop as StopReason : null;
  return { rounds: rounds.filter((r) => r?.pass).length, passes, stop };
}
