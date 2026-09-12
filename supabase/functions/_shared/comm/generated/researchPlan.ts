// GENERATED FILE — DO NOT EDIT.
//
// Copied from src/lib/comm/researchPlan.ts by scripts/sync-comm-domain.mjs so that the
// server enforces exactly what the browser previews. Edit the source file and
// re-run `node scripts/sync-comm-domain.mjs`; scripts/check-comm-sync.mjs
// fails the build if these drift.

// HOMATCH — the ResearchPlan contract.
//
// §60: "The LLM must not arbitrarily generate Python and execute arbitrary
// production code. Instead it generates a structured, validated ResearchPlan."
//
// That sentence is a security boundary, not a style preference. A model that
// emits code to be executed is a remote code execution primitive wearing a
// research hat, and the input to that model is attacker-influenced — a
// developer name, a project title, a page Homatch fetched. So the model's
// output is DATA, validated against this schema, and the only thing that ever
// runs is Homatch's own allowlisted workers.
//
// WHAT THE MODEL IS ALLOWED TO ASK FOR
//
// It may say what it wants to know, in what languages, from which KINDS of
// source, within what time range, up to what budget. It may not name a URL to
// fetch, supply a header, choose a credential, or request a capability outside
// the allowlist. Anything it asks for that is not recognised is dropped, and
// the drop is recorded rather than silently ignored — a plan quietly losing
// half its queries is how a research job returns thin evidence for no visible
// reason.
//
// §63 is equally load-bearing: this does not replace research_jobs,
// research_cache, research_providers or source_registry. It is the contract
// that sits in front of them.

export const RESEARCH_ENTITY_TYPES = [
  'developer', 'project', 'company', 'person', 'property', 'agency', 'market',
] as const;
export type ResearchEntityType = (typeof RESEARCH_ENTITY_TYPES)[number];

/**
 * Source KINDS, not source URLs. A plan asks for "public registries"; the
 * source_registry decides which registry that is and whether Homatch is
 * allowed to read it today.
 */
export const RESEARCH_SOURCE_KINDS = [
  'WEB_SEARCH', 'NEWS', 'PUBLIC_REGISTRY', 'PROPERTY_PORTAL', 'COMPANY_WEBSITE',
  'SOCIAL_PUBLIC', 'MAPS', 'COURT_RECORDS', 'HOMATCH_INTERNAL',
] as const;
export type ResearchSourceKind = (typeof RESEARCH_SOURCE_KINDS)[number];

export const RESEARCH_TIME_RANGES = ['1y', '2y', '5y', '10y', 'all'] as const;
export type ResearchTimeRange = (typeof RESEARCH_TIME_RANGES)[number];

export interface ResearchQuery {
  /** The search string. Length-capped; control characters stripped. */
  q: string;
  language: string;
  /** Which kinds of source this query is meant for. */
  kinds: ResearchSourceKind[];
  /** Higher runs first when the budget will not cover everything. */
  priority: number;
}

export interface ResearchPlan {
  entityType: ResearchEntityType;
  entityName: string;
  projectName: string | null;
  location: string | null;
  questions: string[];
  queries: ResearchQuery[];
  sourceKinds: ResearchSourceKind[];
  languages: string[];
  countries: string[];
  timeRange: ResearchTimeRange;
  maxResults: number;
}

export interface ValidationIssue {
  path: string;
  code: 'MISSING' | 'TYPE' | 'NOT_ALLOWED' | 'TOO_LONG' | 'TOO_MANY' | 'EMPTY' | 'OUT_OF_RANGE';
  detail: string;
}

export interface ValidationResult {
  ok: boolean;
  plan: ResearchPlan | null;
  issues: ValidationIssue[];
  /** Things that were silently possible to fix, recorded rather than hidden. */
  repairs: string[];
}

const LIMITS = {
  entityName: 200,
  question: 300,
  questions: 12,
  query: 240,
  queries: 40,
  maxResultsCeiling: 500,
  languages: 8,
  countries: 12,
};

/** ISO-639-1. Anything else is dropped rather than passed to a search API. */
const LANGUAGE_RE = /^[a-z]{2}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

/**
 * Strip what must never reach a search provider or a log.
 *
 * Control characters, because they corrupt logs and can smuggle terminal
 * escapes. Newlines, because a query is one line and a multi-line "query" is
 * an attempt to inject a second instruction somewhere downstream.
 */
function sanitiseText(raw: unknown, max: number): string {
  return String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Validate and NORMALISE an untrusted plan.
 *
 * Returns a plan only when it is safe to execute. The distinction between an
 * issue and a repair matters: a missing entityName is an issue and the plan is
 * refused; an unrecognised source kind is a repair, because dropping it still
 * leaves a runnable plan and refusing the whole job over one bad enum value
 * would make research brittle for no safety gain.
 */
export function validateResearchPlan(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const repairs: string[] = [];

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, plan: null, issues: [{ path: '', code: 'TYPE', detail: 'plan must be an object' }], repairs };
  }
  const raw = input as Record<string, unknown>;

  const entityType = String(raw.entity_type ?? raw.entityType ?? '');
  if (!RESEARCH_ENTITY_TYPES.includes(entityType as ResearchEntityType)) {
    issues.push({ path: 'entityType', code: 'NOT_ALLOWED', detail: `"${entityType}" is not a known entity type` });
  }

  const entityName = sanitiseText(raw.entity_name ?? raw.entityName, LIMITS.entityName);
  if (!entityName) issues.push({ path: 'entityName', code: 'MISSING', detail: 'an entity name is required' });

  const questionsIn = Array.isArray(raw.questions) ? raw.questions : [];
  const questions = questionsIn
    .map((q) => sanitiseText(q, LIMITS.question))
    .filter(Boolean)
    .slice(0, LIMITS.questions);
  if (questionsIn.length > LIMITS.questions) {
    repairs.push(`kept the first ${LIMITS.questions} of ${questionsIn.length} questions`);
  }
  if (!questions.length) issues.push({ path: 'questions', code: 'EMPTY', detail: 'a plan with no questions has nothing to research' });

  // ── Source kinds ─────────────────────────────────────────────────────────
  const kindsIn = toArray(raw.source_kinds ?? raw.sourceKinds ?? raw.sources);
  const sourceKinds: ResearchSourceKind[] = [];
  for (const k of kindsIn) {
    const up = String(k).toUpperCase().replace(/[\s-]/g, '_');
    if (RESEARCH_SOURCE_KINDS.includes(up as ResearchSourceKind)) {
      if (!sourceKinds.includes(up as ResearchSourceKind)) sourceKinds.push(up as ResearchSourceKind);
    } else {
      // THE important repair. A model asking for "LINKEDIN_SCRAPE" or
      // "INSTAGRAM_PRIVATE" is asking for something §62 forbids, and the
      // answer is to drop it and say so, not to attempt it.
      repairs.push(`dropped unsupported source kind "${String(k).slice(0, 40)}"`);
    }
  }
  if (!sourceKinds.length) {
    sourceKinds.push('WEB_SEARCH');
    repairs.push('no usable source kind was requested; defaulted to WEB_SEARCH');
  }

  // ── Languages and countries ──────────────────────────────────────────────
  // Validated whole, never sliced. Truncating to two characters first turns
  // any word into a "valid" code — "klingon" becomes "kl" — and the plan then
  // asks a search API for results in a language nobody requested.
  const languages = toArray(raw.languages)
    .map((l) => String(l).trim().toLowerCase())
    .filter((l) => LANGUAGE_RE.test(l))
    .filter((l, i, a) => a.indexOf(l) === i)
    .slice(0, LIMITS.languages);
  if (!languages.length) {
    languages.push('ka', 'en');
    repairs.push('no valid language was requested; defaulted to ka and en');
  }

  const countries = toArray(raw.countries)
    .map((c) => String(c).trim().toUpperCase())
    .filter((c) => COUNTRY_RE.test(c))
    .filter((c, i, a) => a.indexOf(c) === i)
    .slice(0, LIMITS.countries);

  // ── Queries ──────────────────────────────────────────────────────────────
  const queriesIn = toArray(raw.queries);
  const queries: ResearchQuery[] = [];
  for (const item of queriesIn.slice(0, LIMITS.queries)) {
    const obj = typeof item === 'string' ? { q: item } : (item as Record<string, unknown>);
    if (!obj || typeof obj !== 'object') continue;
    const q = sanitiseText(obj.q ?? obj.query ?? obj.text, LIMITS.query);
    if (!q) continue;

    // A query carrying a URL is a fetch instruction in disguise. §62: API
    // first, permitted public retrieval second, and never a URL the model
    // chose. The text is kept as a search term with the scheme removed.
    let cleaned = q;
    if (/https?:\/\//i.test(q)) {
      cleaned = q.replace(/https?:\/\/\S+/gi, (m) => m.replace(/^https?:\/\//i, '')).trim();
      repairs.push('removed a URL from a query; plans request searches, not fetches');
    }
    if (!cleaned) continue;

    const kinds = toArray(obj.kinds)
      .map((k) => String(k).toUpperCase().replace(/[\s-]/g, '_'))
      .filter((k): k is ResearchSourceKind => RESEARCH_SOURCE_KINDS.includes(k as ResearchSourceKind));

    queries.push({
      q: cleaned,
      language: LANGUAGE_RE.test(String(obj.language ?? '')) ? String(obj.language) : languages[0],
      kinds: kinds.length ? kinds : sourceKinds,
      priority: clampInt(obj.priority, 0, 100, 50),
    });
  }
  if (queriesIn.length > LIMITS.queries) {
    repairs.push(`kept the first ${LIMITS.queries} of ${queriesIn.length} queries`);
  }
  if (!queries.length) issues.push({ path: 'queries', code: 'EMPTY', detail: 'no executable query survived validation' });

  // ── Budget ───────────────────────────────────────────────────────────────
  const maxResults = clampInt(raw.max_results ?? raw.maxResults, 1, LIMITS.maxResultsCeiling, 100);
  if (Number(raw.max_results ?? raw.maxResults ?? 0) > LIMITS.maxResultsCeiling) {
    repairs.push(`capped max_results at ${LIMITS.maxResultsCeiling}`);
  }

  const timeRangeRaw = String(raw.time_range ?? raw.timeRange ?? '5y');
  const timeRange = (RESEARCH_TIME_RANGES as readonly string[]).includes(timeRangeRaw)
    ? (timeRangeRaw as ResearchTimeRange)
    : '5y';
  if (timeRange !== timeRangeRaw) repairs.push(`unrecognised time range "${timeRangeRaw.slice(0, 20)}"; used 5y`);

  if (issues.length) return { ok: false, plan: null, issues, repairs };

  return {
    ok: true,
    issues,
    repairs,
    plan: {
      entityType: entityType as ResearchEntityType,
      entityName,
      projectName: sanitiseText(raw.project_name ?? raw.projectName, LIMITS.entityName) || null,
      location: sanitiseText(raw.location, LIMITS.entityName) || null,
      questions,
      queries: queries.sort((a, b) => b.priority - a.priority),
      sourceKinds,
      languages,
      countries,
      timeRange,
      maxResults,
    },
  };
}

function toArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined || v === '') return [];
  return [v];
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

// ── The cascade, and honest accounting of what it saved ─────────────────────

export interface CascadeCounters {
  totalRecords: number;
  droppedByRule: number;
  droppedByNormalisation: number;
  droppedByDedupe: number;
  scoredDeterministically: number;
  sentToLlm: number;
  cacheHits: number;
}

export interface CascadeReport extends CascadeCounters {
  /** Records that never reached a model. */
  resolvedWithoutAi: number;
  /** Share of the input that never reached a model, 0-1. */
  withoutAiRate: number;
}

/**
 * §64 asks for these numbers and then says: "Do not fabricate savings
 * numbers."
 *
 * So this reports only what was counted. There is deliberately no "AI cost
 * avoided" figure here — computing one requires assuming what the model WOULD
 * have charged for records it never saw, and that assumption is exactly the
 * fabrication the section forbids. What is true and useful is how many records
 * were resolved without a model, and that is what is returned.
 */
export function cascadeReport(c: CascadeCounters): CascadeReport {
  const total = Math.max(0, c.totalRecords);
  const resolvedWithoutAi = Math.max(
    0,
    c.droppedByRule + c.droppedByNormalisation + c.droppedByDedupe + c.scoredDeterministically + c.cacheHits,
  );
  return {
    ...c,
    resolvedWithoutAi,
    withoutAiRate: total > 0 ? Math.min(1, resolvedWithoutAi / total) : 0,
  };
}

// ── Evidence ────────────────────────────────────────────────────────────────

export interface Evidence {
  entity: string;
  claim: string;
  sourceUrl: string;
  sourcePlatform: string;
  sourceKind: ResearchSourceKind;
  publishedAt: string | null;
  fetchedAt: string;
  excerpt: string;
  /** How much the SOURCE is worth, 0-1. */
  sourceConfidence: number;
  /** How sure we are this source is about THIS entity, 0-1. */
  entityMatchConfidence: number;
  language: string;
  contentHash?: string;
}

export interface ClaimGroup {
  claim: string;
  supporting: Evidence[];
  contradicting: Evidence[];
  /** True when sources disagree. §65: show the conflict, do not resolve it silently. */
  conflicted: boolean;
  /** Highest combined confidence among supporting evidence. */
  strength: number;
}

/**
 * Group evidence into claims and surface disagreement.
 *
 * §65 is explicit that conflicting sources must be SHOWN as conflicts and that
 * reconciliation must not be hallucinated. So this never picks a winner. It
 * reports that two sources disagree and how strong each side is, and a human
 * or a clearly-labelled synthesis step decides what to do about it.
 */
export function groupEvidence(
  evidence: Evidence[],
  isContradiction: (a: Evidence, b: Evidence) => boolean,
): ClaimGroup[] {
  const byClaim = new Map<string, Evidence[]>();
  for (const e of evidence) {
    const key = e.claim.trim().toLowerCase();
    if (!key) continue;
    byClaim.set(key, [...(byClaim.get(key) ?? []), e]);
  }

  const groups: ClaimGroup[] = [];
  for (const [, items] of byClaim) {
    const sorted = [...items].sort(
      (a, b) => b.sourceConfidence * b.entityMatchConfidence - a.sourceConfidence * a.entityMatchConfidence,
    );
    const anchor = sorted[0];
    const supporting = sorted.filter((e) => e === anchor || !isContradiction(anchor, e));
    const contradicting = sorted.filter((e) => e !== anchor && isContradiction(anchor, e));
    groups.push({
      claim: anchor.claim,
      supporting,
      contradicting,
      conflicted: contradicting.length > 0,
      strength: anchor.sourceConfidence * anchor.entityMatchConfidence,
    });
  }
  return groups.sort((a, b) => b.strength - a.strength);
}

/**
 * The gate on a synthesised statement (§65): a claim may only be made if
 * evidence supports it. Returns the claims a synthesis is permitted to assert,
 * and those it must present as disputed or omit.
 */
export function assertableClaims(groups: ClaimGroup[], minStrength = 0.5): {
  assertable: ClaimGroup[];
  disputed: ClaimGroup[];
  tooWeak: ClaimGroup[];
} {
  return {
    assertable: groups.filter((g) => !g.conflicted && g.strength >= minStrength),
    disputed: groups.filter((g) => g.conflicted),
    tooWeak: groups.filter((g) => !g.conflicted && g.strength < minStrength),
  };
}
