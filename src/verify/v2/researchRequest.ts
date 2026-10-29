// V2 research requests: model routing, caching and compact context
// (VERIFY_V2_PLAN.md; the research-cost brief of 2026-10-23).
//
// Everything here applies to jobs stamped V2 only. V1 requests are built
// exactly as before, so switching the engine back is the rollback.
//
// - ROUTING. Each research stage may run on its own model, reasoning effort
//   and web-search context size, read ONCE at job creation from
//   admin_settings.verify_v2_research and stamped on the job
//   (_engine.research), like the engine itself. Nothing set means exactly
//   what V1 sends: the research model, API-default reasoning, default search
//   context. A cheaper setting is only ever switched on after an offline
//   comparison has shown no loss for that stage.
// - CACHING. BASE (the shared rules, ~2.3k tokens) becomes the first thing
//   every stage sends, with the dynamic brief, query and evidence after it,
//   and a fixed prompt_cache_key, so the provider can reuse that prefix
//   across stages and jobs. Same words, different order.
// - COMPACT CONTEXT. Embedded JSON loses keys whose value is empty (null, '',
//   [], {}): lossless. MARKET reads the official stage's price-relevant
//   fields instead of all of it (the documents list repeats officialEvidence
//   and the technical facts).

export type ResearchStageKey = 'identity' | 'official_collection' | 'public_research' | 'market';
export const RESEARCH_STAGE_KEYS: ResearchStageKey[] = ['identity', 'official_collection', 'public_research', 'market'];

export const VERIFY_V2_RESEARCH_SETTING_KEY = 'verify_v2_research';
export const RESEARCH_PROMPT_CACHE_KEY = 'homatch-verify-research';

/** Models research may be routed to: priced in public.price_per_unit_at, so COGS stays exact. */
export const RESEARCH_MODELS = ['gpt-5.6-terra', 'gpt-5.6-luna'] as const;
const EFFORTS = ['minimal', 'low', 'medium', 'high'] as const;
const SEARCH_CONTEXT = ['low', 'medium', 'high'] as const;

const MARKET_MODES = ['AI', 'AUTO', 'CODE'] as const;
const REPORT_POLICIES = ['AUTO', 'LUNA', 'TERRA'] as const;
export const CHEAP_MODEL = 'gpt-5.6-luna';
export const STRONG_MODEL = 'gpt-5.6-terra';

export interface StageTuning {
  model?: (typeof RESEARCH_MODELS)[number];
  reasoningEffort?: (typeof EFFORTS)[number];
  searchContextSize?: (typeof SEARCH_CONTEXT)[number];
  /** Most web searches this stage may make (sent as max_tool_calls). Each costs $0.01 whatever the model. */
  maxSearches?: number;
  /**
   * MARKET only. CODE: comparables, eligibility, range and position are all
   * computed in code and no model is called. AUTO: the same, whenever the
   * gate left at least MIN_ELIGIBLE_FOR_RANGE comparables; otherwise the
   * model is asked (its searches capped as set). AI (or unset): as V1.
   */
  mode?: (typeof MARKET_MODES)[number];
}
/**
 * The customer report (verify-synthesis). AUTO: the cheap model writes it
 * unless the evidence is genuinely hard (reportRoutingFor's triggers), then
 * the strong one. `model` is the older fixed choice, still honoured.
 */
export interface ReportTuning {
  policy?: (typeof REPORT_POLICIES)[number];
  model?: (typeof RESEARCH_MODELS)[number];
  /** Reasoning effort of every report call (unset: REPORT_DEFAULTS.reasoningEffort). */
  reasoningEffort?: (typeof EFFORTS)[number];
  /** Output ceiling per report call, in tokens (unset: REPORT_DEFAULTS.maxOutputTokens). */
  maxOutputTokens?: number;
  /** One cheap repair pass, handed the gate's findings, before any escalation (unset: on). */
  repair?: boolean;
  /**
   * Escalate to the strong model even when the cheap report stands and the
   * gate only REMOVED sentences it disproved (unset: off; only a report the
   * gate rejected outright is escalated).
   */
  escalateOnRemovals?: boolean;
}
/** Hard reuse of public web research across jobs for the same unit/parcel. */
export interface ReuseTuning {
  /** Days a stage's public findings may be reused (0 switches reuse off; unset: REUSE_DEFAULT_DAYS). */
  freshnessDays?: number;
}
/** Research spend for one job: past the ceiling a stage still runs, with no paid searches. */
export interface BudgetTuning {
  preferredUsd?: number;
  ceilingUsd?: number;
}
/** A cheap-model answer that is unusable is retried once on the strong model. */
export interface EscalationTuning {
  enabled?: boolean;
}
export type ResearchTuning = Partial<Record<ResearchStageKey, StageTuning>> & {
  report?: ReportTuning;
  budget?: BudgetTuning;
  escalation?: EscalationTuning;
  reuse?: ReuseTuning;
};
const MAX_SEARCHES_CAP = 10;
/** What a report call sends when nothing is set (owner, 2026-10-29: Luna writes, low effort). */
export const REPORT_DEFAULTS = { reasoningEffort: 'low', maxOutputTokens: 28_000, repair: true } as const;
const MAX_OUTPUT_RANGE = [4_000, 64_000] as const;
export const REUSE_DEFAULT_DAYS = 7;
const REUSE_MAX_DAYS = 30;

const pick = <T extends readonly string[]>(allowed: T, v: unknown): T[number] | undefined =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T[number]) : undefined;
const usd = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 10 ? n : undefined;
};

/** The stored setting, normalised: anything unknown is dropped, so a typo can only ever mean "as V1". */
export function parseResearchTuning(value: unknown): ResearchTuning {
  const o = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
  const out: ResearchTuning = {};
  for (const k of RESEARCH_STAGE_KEYS) {
    const s = o[k];
    if (!s || typeof s !== 'object') continue;
    const t: StageTuning = {};
    const model = pick(RESEARCH_MODELS, s.model);
    const effort = pick(EFFORTS, s.reasoningEffort);
    const size = pick(SEARCH_CONTEXT, s.searchContextSize);
    if (model) t.model = model;
    if (effort) t.reasoningEffort = effort;
    if (size) t.searchContextSize = size;
    const n = Number(s.maxSearches);
    if (s.maxSearches != null && Number.isInteger(n) && n >= 0 && n <= MAX_SEARCHES_CAP) t.maxSearches = n;
    const mode = k === 'market' ? pick(MARKET_MODES, s.mode) : undefined;
    if (mode) t.mode = mode;
    if (Object.keys(t).length) out[k] = t;
  }
  const policy = pick(REPORT_POLICIES, o.report?.policy);
  const reportModel = pick(RESEARCH_MODELS, o.report?.model);
  const reportEffort = pick(EFFORTS, o.report?.reasoningEffort);
  const maxOut = Number(o.report?.maxOutputTokens);
  const report: ReportTuning = {
    ...(policy ? { policy } : {}),
    ...(reportModel ? { model: reportModel } : {}),
    ...(reportEffort ? { reasoningEffort: reportEffort } : {}),
    ...(o.report?.maxOutputTokens != null && Number.isInteger(maxOut) && maxOut >= MAX_OUTPUT_RANGE[0] && maxOut <= MAX_OUTPUT_RANGE[1] ? { maxOutputTokens: maxOut } : {}),
    ...(typeof o.report?.repair === 'boolean' ? { repair: o.report.repair } : {}),
    ...(o.report?.escalateOnRemovals === true ? { escalateOnRemovals: true } : {}),
  };
  if (Object.keys(report).length) out.report = report;
  const days = Number(o.reuse?.freshnessDays);
  if (o.reuse?.freshnessDays != null && Number.isInteger(days) && days >= 0 && days <= REUSE_MAX_DAYS) out.reuse = { freshnessDays: days };
  const preferredUsd = usd(o.budget?.preferredUsd);
  const ceilingUsd = usd(o.budget?.ceilingUsd);
  if (preferredUsd || ceilingUsd) out.budget = { ...(preferredUsd ? { preferredUsd } : {}), ...(ceilingUsd ? { ceilingUsd } : {}) };
  if (o.escalation?.enabled === true) out.escalation = { enabled: true };
  return out;
}

const tuningOf = (resultJson: unknown): ResearchTuning | null => {
  const e = resultJson && typeof resultJson === 'object' ? (resultJson as Record<string, any>)._engine : null;
  // V3 runs the V2 pipeline with its own stamped routing (verify_v3_research).
  return e?.version === 'V2' || e?.version === 'V3' ? parseResearchTuning(e.research) : null;
};
const stampedV3 = (resultJson: unknown): boolean =>
  !!resultJson && typeof resultJson === 'object' && (resultJson as Record<string, any>)._engine?.version === 'V3';

/*
 * THE STRONG MODEL IS A FALLBACK, NOT A TIER (owner, 2026-10-23).
 *
 * AUTO: the cheap model writes every report, complex properties included,
 * from the complete verified evidence package. The strong model is called
 * only when the report's own objective gate (finalizeReport) rejects what
 * the cheap model wrote, never for a complexity label and never for style.
 *
 * V1 and V2 jobs: exactly as before, from the job's stamp only (`live` is
 * ignored). V3 jobs (owner, 2026-10-29): the LIVE verify_v3_research.report
 * (`live`), then the stamp, then AUTO by default; the cheap repair pass runs
 * before any escalation (reportRepairEnabled), and every call is recorded
 * (_reportAttempts). A pinned model (OPENAI_SYNTHESIS_MODEL: `fallback` is
 * not the cheap model) keeps "pinned means no fallback".
 */
export function reportTuningFor(resultJson: unknown, live?: unknown): ReportTuning {
  if (!stampedV3(resultJson)) return tuningOf(resultJson)?.report ?? {};
  const fromLive = live == null ? undefined : parseResearchTuning(live).report;
  return fromLive ?? tuningOf(resultJson)?.report ?? {};
}

export function reportRoutingFor(resultJson: unknown, fallback: string, live?: unknown): { model: string; policy: string; fallbackModel: string | null } {
  const v3 = stampedV3(resultJson);
  const r = reportTuningFor(resultJson, v3 ? live : undefined);
  if (!v3 && !r.policy && !r.model) return { model: fallback, policy: 'DEFAULT', fallbackModel: null };
  if (r.policy === 'LUNA') return { model: CHEAP_MODEL, policy: 'LUNA', fallbackModel: null };
  if (r.policy === 'TERRA') return { model: STRONG_MODEL, policy: 'TERRA', fallbackModel: null };
  if (r.policy === 'AUTO') return { model: CHEAP_MODEL, policy: 'AUTO', fallbackModel: STRONG_MODEL };
  if (!v3 || r.model) return { model: r.model ?? fallback, policy: 'FIXED_MODEL', fallbackModel: null };
  // V3 with nothing set: AUTO on the cheap model. A pinned model stays pinned.
  return fallback === CHEAP_MODEL
    ? { model: CHEAP_MODEL, policy: 'AUTO', fallbackModel: STRONG_MODEL }
    : { model: fallback, policy: 'DEFAULT', fallbackModel: null };
}

/** The report's prompt-cache key: one per study, because the static rules differ per study. */
export function reportPromptCacheKey(study: string | null | undefined): string {
  return `homatch-verify-report:${String(study || 'PROJECT').toLowerCase()}`;
}

/**
 * What every report call adds to the Responses API body: reasoning effort,
 * an output ceiling sized to the schema, and the prompt-cache key that lets
 * the repair and escalation calls (same static prefix, seconds later) read
 * the rules and the evidence from cache.
 */
export function reportRequestExtras(tuning: ReportTuning, study: string | null | undefined): Record<string, unknown> {
  return {
    reasoning: { effort: tuning.reasoningEffort ?? REPORT_DEFAULTS.reasoningEffort },
    max_output_tokens: tuning.maxOutputTokens ?? REPORT_DEFAULTS.maxOutputTokens,
    prompt_cache_key: reportPromptCacheKey(study),
  };
}

/** Whether the cheap repair pass runs before any escalation (default on). */
export function reportRepairEnabled(tuning: ReportTuning): boolean {
  return tuning.repair ?? REPORT_DEFAULTS.repair;
}

/**
 * The failures that justify paying for the strong model, or [] when the
 * cheap report stands. A report the gate rejected outright (mode
 * DETERMINISTIC although the model answered) or one left without a summary
 * is blocking. Sentences the gate REMOVED because the evidence disproved them
 * are already gone from what the customer reads: they are repaired cheaply,
 * and escalate only when the owner switched escalateOnRemovals on.
 */
export function reportBlockingFailures(
  final: { mode?: string; rejectedBecause?: unknown[]; summary?: { statement?: string } | null } | null | undefined,
  hadModelOutput: boolean,
  tuning: ReportTuning = {},
): string[] {
  if (!hadModelOutput || !final) return [];
  const failures = reportQualityFailures(final, hadModelOutput);
  if (tuning.escalateOnRemovals) return failures;
  // Rejected outright: escalate for objective failures only. Style alone never pays for a second model.
  if (final.mode === 'DETERMINISTIC') return failures;
  if (!String(final.summary?.statement ?? '').trim()) return [...failures, 'no summary statement left after the gate'];
  return [];
}

/**
 * What the repair pass is handed: every finding of a report the gate rejected
 * outright (style included: a cheap rewrite is the right answer to it), or
 * the objective findings of a report that stands. [] means no repair.
 */
export function reportRepairFindings(final: { mode?: string; rejectedBecause?: unknown[] } | null | undefined, hadModelOutput: boolean): string[] {
  if (!hadModelOutput || !final) return [];
  if (final.mode === 'DETERMINISTIC') {
    const all = (Array.isArray(final.rejectedBecause) ? final.rejectedBecause : []).map((x) => String(x)).filter(Boolean);
    return all.length ? all : ['the report was rejected by the gate'];
  }
  return reportQualityFailures(final, true);
}

/** Ranks a finalised report: a kept model report beats a rejected one, then fewer gate findings win. Lower is better. */
export function reportScore(final: { mode?: string; rejectedBecause?: unknown[] } | null | undefined, hadModelOutput: boolean): number {
  if (!hadModelOutput || !final) return 10_000;
  return (final.mode === 'MODEL' ? 0 : 1_000) + reportQualityFailures(final, true).length;
}

/**
 * The repair instruction: the gate's own findings, verbatim, and what to do
 * about each kind. Sent after the cheap model's first answer, in the same
 * conversation, so the static rules and the evidence are read from cache.
 */
export function reportRepairPrompt(findings: string[], parseFailed: boolean): string {
  const list = findings.slice(0, 30).map((f) => `- ${f}`).join('\n');
  return [
    `THE QUALITY GATE CHECKED YOUR REPORT AGAINST THE EVIDENCE. ${parseFailed ? 'Your answer could not be read as the required JSON.' : 'It removed or rejected the following:'}`,
    list,
    '',
    'Return the COMPLETE report again as strict JSON of exactly the same shape, corrected:',
    '- cite only evidence ids you were given; every section, key finding, story chapter and next step needs at least one;',
    '- a sentence the gate says contradicts the deterministic valuation or the evidence: rewrite it so it agrees with them, or leave it out;',
    '- never state an absence as a fact where only a search came up empty; no URLs or portal names in prose;',
    '- keep everything not listed above as it was. Add no new facts.',
  ].join('\n');
}

/** One paid report call, as the attempts ledger keeps it (synthesis_json._reportAttempts). */
export interface ReportAttempt {
  /** first | repair | escalation; a rebuild's calls carry build > 1. */
  kind: 'first' | 'repair' | 'escalation' | 'legacy';
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  /** Which build of this report (1 = the first; each rebuild adds one). */
  build: number;
  /** The trigger of that build: research | driver | customer | upgrade. */
  trigger?: string;
  /** Whether this call's report is the one the customer reads. */
  kept?: boolean;
  at: string;
}
const ATTEMPTS_CAP = 40;

/**
 * The ledger before a new build: the stored one, or for a report written
 * before the ledger existed its _usageFirstAttempt and _usage (each priced
 * exactly once, as `legacy`), so the first rebuild never loses history.
 */
export function priorReportAttempts(storedSynthesis: unknown): ReportAttempt[] {
  const s = storedSynthesis && typeof storedSynthesis === 'object' ? (storedSynthesis as Record<string, any>) : {};
  if (Array.isArray(s._reportAttempts)) return (s._reportAttempts as ReportAttempt[]).filter((a) => a && typeof a === 'object').map((a) => ({ ...a, kept: false }));
  const legacy = (u: any): ReportAttempt | null => (u && typeof u === 'object' && (Number(u.inputTokens) || Number(u.outputTokens))
    ? { kind: 'legacy', model: String(u.model || CHEAP_MODEL), inputTokens: Number(u.inputTokens) || 0, cachedTokens: Number(u.cachedTokens) || 0, outputTokens: Number(u.outputTokens) || 0, build: 1, kept: false, at: String(s.synthesizedAt ?? '') }
    : null);
  return [legacy(s._usageFirstAttempt), legacy(s._usage)].filter(Boolean) as ReportAttempt[];
}

/** The next build number for a ledger. */
export function nextReportBuild(prior: ReportAttempt[]): number {
  return prior.reduce((n, a) => Math.max(n, Number(a.build) || 1), 0) + 1;
}

/** The ledger with this build's calls appended, oldest dropped past the cap. */
export function appendReportAttempts(prior: ReportAttempt[], calls: ReportAttempt[]): ReportAttempt[] {
  return [...prior, ...calls].slice(-ATTEMPTS_CAP);
}

/** The cost_events attempt tag of one call (unique per job with VERIFY_REPORT). */
export function reportAttemptTag(a: Pick<ReportAttempt, 'build' | 'kind'>, index: number): string {
  return `b${a.build}:${index + 1}:${a.kind}`;
}

/* Gate findings that are about wording, not facts: never a reason to pay twice. */
const STYLE_ONLY = [/^provenance phrase /i];

/**
 * The objective failures in a finalised report, or [] when it passed.
 * `hadModelOutput` false means the call returned nothing (a transport
 * problem, not a quality one): no escalation for that.
 */
export function reportQualityFailures(final: { mode?: string; rejectedBecause?: unknown[] } | null | undefined, hadModelOutput: boolean): string[] {
  if (!hadModelOutput || !final) return [];
  return (Array.isArray(final.rejectedBecause) ? final.rejectedBecause : [])
    .map((x) => String(x))
    .filter((x) => x && !STYLE_ONLY.some((re) => re.test(x)));
}

/** The model that writes a job's customer report (see reportRoutingFor). */
export function reportModelFor(resultJson: unknown, fallback: string): string {
  return reportRoutingFor(resultJson, fallback).model;
}

/** MARKET for a V2 job: computed entirely in code, or asked of a model. */
export function marketCodeDecision(resultJson: unknown, eligibleComparables: number, minForRange: number): { code: boolean; reason: string } {
  const mode = tuningOf(resultJson)?.market?.mode;
  if (mode === 'CODE') return { code: true, reason: 'MODE_CODE' };
  if (mode === 'AUTO' && eligibleComparables >= minForRange) return { code: true, reason: `ELIGIBLE_COMPARABLES_${eligibleComparables}` };
  return { code: false, reason: mode === 'AUTO' ? `TOO_FEW_COMPARABLES_${eligibleComparables}` : 'MODE_AI' };
}

/* Provider prices (public.price_per_unit_at, 2026-10-23), for the budget
   controller only. The COGS views price from the book; this never bills. */
const PRICE_PER_TOKEN: Record<string, { in: number; cached: number; out: number }> = {
  'gpt-5.6-terra': { in: 2e-6, cached: 2e-7, out: 12e-6 },
  'gpt-5.6-luna': { in: 2e-7, cached: 2e-8, out: 1.2e-6 },
};
const SEARCH_USD = 0.01;

/** Estimated research spend so far on this job, from the usage it recorded (stage, model, searches). */
export function researchSpentUsd(resultJson: unknown): number {
  const r = resultJson && typeof resultJson === 'object' ? (resultJson as Record<string, any>) : {};
  let total = 0;
  for (const [stage, u] of Object.entries((r._cost ?? {}) as Record<string, any>)) {
    if (!u || typeof u !== 'object') continue;
    const p = PRICE_PER_TOKEN[String(r._models?.[stage] ?? '')] ?? PRICE_PER_TOKEN[STRONG_MODEL];
    const cached = Number(u.input_tokens_details?.cached_tokens) || 0;
    const input = Number(u.input_tokens) || 0;
    total += (input - cached) * p.in + cached * p.cached + (Number(u.output_tokens) || 0) * p.out;
    total += (Number(r._searches?.[stage]) || 0) * SEARCH_USD;
  }
  return Math.round(total * 1e6) / 1e6;
}

/** Past the job's research ceiling a stage runs with no paid searches; the reason is recorded. */
export function budgetDecision(resultJson: unknown): { searchesOff: boolean; spentUsd: number; reason: string | null } {
  const ceiling = tuningOf(resultJson)?.budget?.ceilingUsd;
  const spentUsd = researchSpentUsd(resultJson);
  if (ceiling && spentUsd >= ceiling) return { searchesOff: true, spentUsd, reason: `CEILING_${ceiling}_REACHED` };
  return { searchesOff: false, spentUsd, reason: null };
}

/** The queries a Responses API answer actually ran. */
export function searchQueriesOf(response: unknown): string[] {
  const out = Array.isArray((response as any)?.output) ? (response as any).output : [];
  return out
    .filter((o: any) => o?.type === 'web_search_call')
    .map((o: any) => String(o?.action?.query ?? o?.query ?? '').trim())
    .filter(Boolean);
}

/** Appended to a V2 stage: what this run already searched, so it is not bought twice. */
export function searchLogBrief(log: unknown): string {
  const rows = (Array.isArray(log) ? log : []).filter((x: any) => x && typeof x.query === 'string').slice(-24);
  if (!rows.length) return '';
  return `\n\nSEARCHES ALREADY MADE IN THIS VERIFICATION (their results are in the evidence above; do NOT repeat them or near-duplicates — search only for what is still missing and material):\n${rows.map((x: any) => `- [${x.stage}] ${x.query}`).join('\n')}\n`;
}

/**
 * The priced model name for what the provider reports (it may name a dated
 * snapshot, e.g. gpt-5.6-luna-2026-…): verify_stage_cogs normalises terra
 * snapshots only, so a luna snapshot would otherwise price as UNPRICED.
 */
export function canonicalModel(name: unknown): string | null {
  if (typeof name !== 'string' || !name) return null;
  return (RESEARCH_MODELS as readonly string[]).find((m) => name === m || name.startsWith(`${m}-`)) ?? name;
}

/** The fields each research stage must return for its answer to be usable at all. */
const REQUIRED_KEYS: Record<ResearchStageKey, string[]> = {
  identity: ['entity'],
  official_collection: ['officialEvidence', 'documents', 'rightsAndRestrictions', 'companyProfile'],
  public_research: ['facts', 'developerReputation', 'mediaCoverage', 'legalCompany'],
  market: ['market', 'priceDriverEvidence'],
};

/** A parsed stage answer that carries at least one of the stage's own fields. */
export function stageOutputUsable(stage: string, parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const keys = REQUIRED_KEYS[stage.toLowerCase() as ResearchStageKey];
  return !keys || keys.some((k) => k in (parsed as Record<string, unknown>));
}

/** A cheap-model answer that is unusable: retried once on the strong model, when escalation is on. */
export function escalationModelFor(resultJson: unknown, stage: string, ranModel: string, usable: boolean): string | null {
  const t = tuningOf(resultJson);
  if (!t?.escalation?.enabled || usable || canonicalModel(ranModel) === STRONG_MODEL) return null;
  const done = Array.isArray((resultJson as any)?._escalations) ? (resultJson as any)._escalations : [];
  if (done.some((e: any) => e?.stage === stage.toLowerCase())) return null;
  return STRONG_MODEL;
}

/** BASE first, everything that varies after it; unchanged when BASE is not found exactly once. */
export function stablePrefixPrompt(text: string, base: string): string {
  const at = text.indexOf(base);
  if (at <= 0 || text.indexOf(base, at + 1) !== -1) return text;
  // What preceded BASE (the known-facts brief, the market briefs) follows it
  // directly, in the same order relative to everything else.
  const before = text.slice(0, at);
  return base + (before.trim() ? `\n${before}` : '') + text.slice(at + base.length);
}

export interface ResearchRequest {
  model: string;
  input: string;
  /** Merged into the Responses API body. */
  extra: Record<string, unknown>;
}

/** The request a V2 research stage sends. `defaultModel` is what V1 would use. */
export function v2ResearchRequest(
  stage: string, text: string, base: string, tuning: unknown, defaultModel: string, tools: boolean,
  opts: { modelOverride?: string | null; searchesOff?: boolean; searchLog?: unknown } = {},
): ResearchRequest {
  const key = stage.toLowerCase() as ResearchStageKey;
  const t = parseResearchTuning(tuning)[key] ?? {};
  const extra: Record<string, unknown> = { prompt_cache_key: RESEARCH_PROMPT_CACHE_KEY };
  if (t.reasoningEffort) extra.reasoning = { effort: t.reasoningEffort };
  if (tools && t.searchContextSize) extra.tools = [{ type: 'web_search', search_context_size: t.searchContextSize }];
  // 0 searches (setting, or the budget ceiling): the stage reasons over what
  // it was given, with no web tool at all (noTools: createOpenAIResponse drops it).
  if (tools && (opts.searchesOff || t.maxSearches === 0)) {
    delete extra.tools;
    extra.noTools = true;
  } else if (tools && t.maxSearches != null) extra.max_tool_calls = t.maxSearches;
  const input = stablePrefixPrompt(text, base) + (tools && !extra.noTools ? searchLogBrief(opts.searchLog) : '');
  return { model: opts.modelOverride ?? t.model ?? defaultModel, input, extra };
}

const isEmpty = (v: unknown): boolean =>
  v == null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

/** A deep copy without empty values. Lossless: an empty field says nothing the model can use. */
export function withoutEmpty<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => withoutEmpty(v)).filter((v) => !isEmpty(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const c = withoutEmpty(v);
      if (!isEmpty(c)) out[k] = c;
    }
    return out as T;
  }
  return value;
}

/** What MARKET needs of the official stage: land, rights, the company and the confirmed facts. */
export function marketOfficialContext(o: any): Record<string, unknown> {
  const c = o?.companyProfile ?? null;
  return withoutEmpty({
    officialEvidence: o?.officialEvidence,
    landProfile: o?.landProfile,
    rightsAndRestrictions: o?.rightsAndRestrictions,
    company: c ? { name: c.name, idCode: c.idCode, status: c.status } : null,
    technicalFacts: o?.tasTechnicalFacts,
    conflicts: o?.conflicts,
  });
}

/** Days a V3 job may hard-reuse public research (0 = off). V1 and V2 jobs never reuse. */
export function reuseFreshnessDays(resultJson: unknown): number {
  if (!stampedV3(resultJson)) return 0;
  const t = tuningOf(resultJson);
  if (!t) return 0;
  return t.reuse?.freshnessDays ?? REUSE_DEFAULT_DAYS;
}
