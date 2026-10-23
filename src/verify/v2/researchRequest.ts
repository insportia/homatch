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
};
const MAX_SEARCHES_CAP = 10;

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
  if (policy || reportModel) out.report = { ...(policy ? { policy } : {}), ...(reportModel ? { model: reportModel } : {}) };
  const preferredUsd = usd(o.budget?.preferredUsd);
  const ceilingUsd = usd(o.budget?.ceilingUsd);
  if (preferredUsd || ceilingUsd) out.budget = { ...(preferredUsd ? { preferredUsd } : {}), ...(ceilingUsd ? { ceilingUsd } : {}) };
  if (o.escalation?.enabled === true) out.escalation = { enabled: true };
  return out;
}

const tuningOf = (resultJson: unknown): ResearchTuning | null => {
  const e = resultJson && typeof resultJson === 'object' ? (resultJson as Record<string, any>)._engine : null;
  return e?.version === 'V2' ? parseResearchTuning(e.research) : null;
};

/*
 * WHEN THE REPORT NEEDS THE STRONG MODEL.
 *
 * Explicit, evidence-based triggers read from the finished research — never
 * a model's own judgement of itself. Any one is enough. A plain report (clean
 * registry, no conflicts) is written by the cheap model; the deterministic
 * parts of the report (tables, figures, statuses) are code either way.
 */
export function reportEscalationReasons(resultJson: unknown): string[] {
  const r = resultJson && typeof resultJson === 'object' ? (resultJson as Record<string, any>) : {};
  const reasons: string[] = [];
  if (Array.isArray(r.materialAdverseFindings) && r.materialAdverseFindings.length) reasons.push('MATERIAL_ADVERSE_FINDING');
  if ((Array.isArray(r.conflicts) ? r.conflicts : []).some((c: any) => String(c?.severity ?? '').toUpperCase() === 'MATERIAL')) reasons.push('MATERIAL_CONFLICT');
  if (String(r.rightsAndRestrictions?.status ?? '') === 'RESTRICTION_IDENTIFIED') reasons.push('RESTRICTION_IDENTIFIED');
  const ls = r.legalStatus && typeof r.legalStatus === 'object' ? Object.values(r.legalStatus as Record<string, any>) : [];
  if (ls.some((e: any) => e?.status === 'CONFIRMED_ATTENTION')) reasons.push('LEGAL_ATTENTION');
  if ((Array.isArray(r.materialRisks?.riskFlags) ? r.materialRisks.riskFlags : []).some((f: any) => f?.severity === 'HIGH')) reasons.push('HIGH_RISK_FLAG');
  return reasons;
}

/** Which model writes a job's customer report, and why. V1 and an unset V2 keep the default. */
export function reportRoutingFor(resultJson: unknown, fallback: string): { model: string; policy: string; reasons: string[] } {
  const t = tuningOf(resultJson);
  if (!t?.report) return { model: fallback, policy: 'DEFAULT', reasons: [] };
  if (t.report.policy === 'LUNA') return { model: CHEAP_MODEL, policy: 'LUNA', reasons: [] };
  if (t.report.policy === 'TERRA') return { model: STRONG_MODEL, policy: 'TERRA', reasons: [] };
  if (t.report.policy === 'AUTO') {
    const reasons = reportEscalationReasons(resultJson);
    return { model: reasons.length ? STRONG_MODEL : CHEAP_MODEL, policy: 'AUTO', reasons };
  }
  return { model: t.report.model ?? fallback, policy: 'FIXED_MODEL', reasons: [] };
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
