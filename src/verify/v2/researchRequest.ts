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

export interface StageTuning {
  model?: (typeof RESEARCH_MODELS)[number];
  reasoningEffort?: (typeof EFFORTS)[number];
  searchContextSize?: (typeof SEARCH_CONTEXT)[number];
  /** Most web searches this stage may make (sent as max_tool_calls). Each costs $0.01 whatever the model. */
  maxSearches?: number;
}
/** The customer report (verify-synthesis): which model writes it for a V2 job. */
export interface ReportTuning {
  model?: (typeof RESEARCH_MODELS)[number];
}
export type ResearchTuning = Partial<Record<ResearchStageKey, StageTuning>> & { report?: ReportTuning };
const MAX_SEARCHES_CAP = 10;

const pick = <T extends readonly string[]>(allowed: T, v: unknown): T[number] | undefined =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T[number]) : undefined;

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
    if (Number.isInteger(n) && n >= 0 && n <= MAX_SEARCHES_CAP) t.maxSearches = n;
    if (Object.keys(t).length) out[k] = t;
  }
  const reportModel = pick(RESEARCH_MODELS, o.report?.model);
  if (reportModel) out.report = { model: reportModel };
  return out;
}

/** The model that writes a job's customer report: the V2 job's stamped choice, else the default. */
export function reportModelFor(resultJson: unknown, fallback: string): string {
  const e = resultJson && typeof resultJson === 'object' ? (resultJson as Record<string, any>)._engine : null;
  if (e?.version !== 'V2') return fallback;
  return parseResearchTuning(e.research).report?.model ?? fallback;
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
export function v2ResearchRequest(stage: string, text: string, base: string, tuning: unknown, defaultModel: string, tools: boolean): ResearchRequest {
  const key = stage.toLowerCase() as ResearchStageKey;
  const t = parseResearchTuning(tuning)[key] ?? {};
  const extra: Record<string, unknown> = { prompt_cache_key: RESEARCH_PROMPT_CACHE_KEY };
  if (t.reasoningEffort) extra.reasoning = { effort: t.reasoningEffort };
  if (tools && t.searchContextSize) extra.tools = [{ type: 'web_search', search_context_size: t.searchContextSize }];
  // 0 searches: the stage reasons over what it was given, with no web tool at all.
  if (tools && t.maxSearches === 0) extra.tools = [];
  else if (tools && t.maxSearches != null) extra.max_tool_calls = t.maxSearches;
  return { model: t.model ?? defaultModel, input: stablePrefixPrompt(text, base), extra };
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
