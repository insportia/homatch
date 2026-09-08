// ResearchContext.ts — pure job/step bookkeeping, ported unchanged in
// behavior from the pre-refactor lib/steps.js (already correct, already
// unit-tested — 5 tests). A job's `steps` array starts as the fixed
// per-mode primary-source list and can grow at runtime: once every primary
// step has produced a result, the orchestrator mines the shared EntityQueue
// for confirmed (name+idCode) companies and appends {type:'entity_enreg'}
// steps onto the SAME array — this is mandate Section 16's "Entity Queue"
// integration ("do not interrupt current document traversal ... finish
// current document, then orchestrator processes entity queue").
// StepDescriptor's entity variant (2026-09-06, "ADAPTIVE RESEARCH ENGINE /
// FINANCIAL SOURCE EXPANSION" mandate): generalized from the original
// enreg-only `entity_enreg` shape to `{type:'entity', source, ...}` so the
// SAME startEntity()/runStep()/resume()/skip() machinery serves the two new
// financial sources (RS Taxpayers Registry / MyGov Debtor Registry) without
// a parallel copy of this bookkeeping per source. Safe to rename internally
// — the WIRE contract research-agent depends on (`result.source === 'enreg'`
// + `result.forEntity`) is unaffected, since it was already computed from
// `key`/`forEntity` at the point a result crosses into job.results, never
// from this type's own tag.
export type StepDescriptor = { type: 'source'; key: 'tas' | 'TAS_MAP' | 'mygov' | 'enreg' | 'napr' } | { type: 'entity'; source: 'enreg' | 'rstax' | 'debtor'; idCode: string | null; name: string };

export interface ResearchJob {
  id: string;
  query: string;
  mode: 'cadastral' | 'property';
  status: string;
  stage: string;
  sourceIndex: number;
  results: any[];
  createdAt: string;
  updatedAt: string;
  steps?: StepDescriptor[];
  humanVerification?: any;
  completedAt?: string;
  officialEvidenceCount?: number;
  discoveredEntities?: any[];
  historicalComparison?: any;
  error?: string;
  _entityStepsAppended?: boolean;
  /** Set by the stalled-job watchdog. Once true, run() must stop touching
   * this job: its Chromium has already been torn down underneath it, so any
   * in-flight Playwright call is about to reject and must not be allowed to
   * overwrite the finalized state. */
  _abandoned?: boolean;
  /** True when the watchdog, not the pipeline, finalized this job. Surfaced
   * so a stall is visible in the job document instead of looking like a
   * normal completion. */
  watchdogFinalized?: boolean;
}

/**
 * decideStalledJob() — the stalled-job watchdog's decision, as a pure
 * function so it can be tested directly (ResearchOrchestrator itself cannot
 * be imported by the test build: it pulls in every Playwright workflow).
 *
 * Rules, in the mandate's terms:
 *   - Only a RUNNING job can stall. WAITING_HUMAN is bounded by the session
 *     TTL instead, and a human who has not answered yet is not a hang.
 *   - `updatedAt` advances after every completed step, so this measures time
 *     since the last real PROGRESS, never total job duration — a long but
 *     healthy job is never killed.
 *   - A stall is a TECHNICAL condition. Evidence already gathered is kept and
 *     the job COMPLETEs so the customer still gets a report; only a job with
 *     no result at all is FAILED, and that failure carries no property
 *     meaning ("NO EVIDENCE = NO FACT" — never negative evidence).
 */
export function decideStalledJob(
  job: Pick<ResearchJob, 'status' | 'updatedAt' | 'results' | '_abandoned'>,
  nowMs: number,
  stallMs: number
): { finalize: false; reason: string } | { finalize: true; status: 'COMPLETE' | 'FAILED'; stalledForMs: number } {
  if (job._abandoned) return { finalize: false, reason: 'already_abandoned' };
  if (job.status !== 'RUNNING') return { finalize: false, reason: 'not_running' };
  const last = Date.parse(job.updatedAt);
  if (Number.isNaN(last)) return { finalize: false, reason: 'unparsable_timestamp' };
  const stalledForMs = nowMs - last;
  if (stalledForMs <= stallMs) return { finalize: false, reason: 'still_progressing' };
  return { finalize: true, status: job.results.length ? 'COMPLETE' : 'FAILED', stalledForMs };
}

// Cadastral-mode order (2026-09-06, "Fix Homatch Verify by implementing
// this exact pipeline in code" mandate): TAS Map -> TAS Document -> NAPR
// Property, matching the mandate's stated TasMapWorker -> TasDocumentWorker
// -> NaprPropertyWorker sequence. Each primary step is independent of the
// others' result data (see ResearchOrchestrator.runStep()'s dispatch — every
// key is called with the same job `query`, never a previous step's output),
// and the shared EntityQueue is only mined for follow-up steps once ALL
// primary steps have reported (primaryStepsRemain, below) — so reordering
// this array changes only presentation/traversal order, not correctness.
// Property-mode order is left unchanged (the mandate's worker list does not
// give an unambiguous property-mode sequence, and enreg/TAS_MAP/napr already
// matches its own established behavior).
// 'msmap' is retired here (2026-09-06 "final alignment pass" mandate) —
// 'TAS_MAP' is the one real source (the map popup opened FROM tas.ge), not a
// second source kept alongside it.
export function buildInitialSteps(job: Pick<ResearchJob, 'mode'>): StepDescriptor[] {
  const keys: StepDescriptor['type'] extends never ? never : Array<'tas' | 'TAS_MAP' | 'mygov' | 'enreg' | 'napr'> = job.mode === 'cadastral' ? ['TAS_MAP', 'tas', 'mygov'] : ['enreg', 'TAS_MAP', 'napr'];
  return keys.map((key) => ({ type: 'source', key }) as StepDescriptor);
}

/** Replacement for a too-coarse `result.source === key` filter: a primary
 * 'enreg' step (property mode) and an entity-triggered 'enreg' step share
 * the same `source` field on their result, so matching by source key alone
 * would let one silently overwrite the other. Matching requires the entity
 * identity (idCode) to line up too for entity steps, and requires the
 * ABSENCE of forEntity for a primary-source step. */
export function stepMatchesResult(step: StepDescriptor | undefined, r: { source: string; forEntity?: { idCode: string | null } | null }): boolean {
  if (!step) return false;
  if (step.type === 'entity') return r.source === step.source && r.forEntity?.idCode === step.idCode;
  return r.source === step.key && !r.forEntity;
}

/** True once every primary ('source'-type) step at or after `fromIndex` has
 * already produced a result — safe to mine the entity queue and enqueue
 * follow-up steps. */
export function primaryStepsRemain(steps: StepDescriptor[], fromIndex: number): boolean {
  return steps.slice(fromIndex).some((s) => s.type === 'source');
}

// 2026-09-06, "Fix Homatch Verify by implementing this exact pipeline in
// code" mandate: the fixed cadastral-mode production execution path is
// TasMapWorker -> TasDocumentWorker -> NaprPropertyWorker -> EnregWorker ->
// RsTaxpayerWorker -> DebtorWorker -> PublicResearchWorker ->
// MarketResearchWorker -> Synthesis, with "official evidence MUST finish
// first." The in-job EntityQueue auto-trigger (fired once every PRIMARY
// browser step has reported — see ResearchOrchestrator.run()) now queues
// the full EnregWorker -> RsTaxpayerWorker -> DebtorWorker triple, in that
// order, for each bounded entity — not enreg alone as before this mandate.
// Still bounded by maxEntities (a document mentioning many unrelated
// companies must never turn one Verify into dozens of ENREG/RS/Debtor
// jobs); in the common case (one developer/owner company confirmed) this
// produces exactly the mandate's Enreg->Rstax->Debtor sub-sequence. The
// SEPARATE closed-loop /research/enreg-entity, /research/rstax-entity,
// /research/debtor-entity endpoints (ResearchOrchestrator.startEntity())
// remain for the mandate's second, independent trigger: research-agent's
// own PUBLIC_RESEARCH stage discovering ONE new strongly-supported company
// ID that never appeared in any browser-retrieved text this worker scanned
// (so EntityQueue.scanText() could never have seen it) — research-agent
// calls all three endpoints in sequence for that one entity, once, before
// continuing to MARKET.
/* ------------------------------------------------------------------ *
 * EXECUTION IDENTITY + TERMINAL DEDUPLICATION                         *
 *                                                                     *
 * Root cause, from real production job                                *
 * 3aa36828-471a-4cd0-8a46-4e3f2b4c4c92 (2026-09-08). Its ten browser  *
 * executions were:                                                    *
 *                                                                     *
 *   1 TAS_MAP SEARCH_CONFIRMED                                        *
 *   2 tas     SEARCH_CONFIRMED                                        *
 *   3 mygov   SEARCH_CONTROL_NOT_FOUND                                *
 *   4 enreg   SEARCH_CONFIRMED            404670272 "შპს მილენიო გრუპი"*
 *   5 rstax   SKIPPED_HUMAN_VERIFICATION  404670272 "შპს მილენიო გრუპი"*
 *   6 debtor  NO_RESULT_CONFIRMED         404670272 "შპს მილენიო გრუპი"*
 *   7 enreg   SEARCH_CONFIRMED            405068386 "შპს მილენიო გრუპი"*
 *   8 rstax   SKIPPED_HUMAN_VERIFICATION  405068386 "შპს მილენიო გრუპი"*
 *   9 debtor  NO_RESULT_CONFIRMED         405068386 "შპს მილენიო გრუპი"*
 *  10 enreg   START                       (no idCode) "Millennio Group"*
 *                                                                     *
 * Two distinct defects, not one:                                      *
 *                                                                     *
 *  (a) Row 10. research-agent's own guard (alreadyHasResultFor) can    *
 *      only match a candidate name against a recorded execution's name *
 *      with a loose STRING compare. The candidate was the Latin        *
 *      "Millennio Group"; every recorded execution carried the         *
 *      Georgian "შპს მილენიო გრუპი". No match -> it started a THIRD    *
 *      enreg execution for a company enreg had already resolved twice. *
 *      It never finished: it is still status START.                    *
 *                                                                     *
 *  (b) The worker itself had NO dedupe of its own. It trusted the      *
 *      caller's guard entirely, so the moment that guard failed the    *
 *      worker happily re-ran the work — and, because rows 5 and 8 both  *
 *      reached a CAPTCHA, the customer was asked to solve and Skip the  *
 *      SAME rs.ge challenge twice in one Verify.                       *
 *                                                                     *
 * The mandate's remedy is a deterministic execution identity plus      *
 * defense in depth, so the worker refuses duplicate work even when a   *
 * caller asks for it. That is what the helpers below provide.          *
 * ------------------------------------------------------------------ */

/**
 * Every status that ENDS an execution for its identity in this job.
 *
 * SKIPPED_HUMAN_VERIFICATION is deliberately here: the mandate states it is
 * TERMINAL for that source/entity identity. A customer who skipped a CAPTCHA
 * must never be shown the same CAPTCHA again inside the same Verify — which
 * is exactly what rows 5 and 8 did to them.
 *
 * The non-success entries are terminal too: a source that was unavailable,
 * blocked, or whose control could not be found has been TRIED. Retrying it
 * inside the same job produces the same outcome and costs the customer time.
 * None of these carries any property meaning (NO EVIDENCE = NO FACT).
 */
export const TERMINAL_EXECUTION_STATUSES: readonly string[] = [
  'SEARCH_CONFIRMED',
  'NO_RESULT_CONFIRMED',
  'SOURCE_EXHAUSTED',
  'SKIPPED_HUMAN_VERIFICATION',
  'SOURCE_UNAVAILABLE',
  'SOURCE_TECHNICAL_FAILURE',
  'BLOCKED',
  'AUTH_REQUIRED',
  'SEARCH_CONTROL_NOT_FOUND',
  'SUBMIT_FAILED',
  'WRONG_SEARCH_CONTEXT',
  'SUBMITTED_UNCONFIRMED',
  'SUBMITTED_UNPARSED',
  'FAILED',
];

/** WAITING_HUMAN is explicitly NOT terminal — that execution is paused and
 * will be resumed or skipped on the same page. 'START' is not terminal
 * either: row 10 above shows an execution that never finished. */
export function isTerminalExecutionStatus(status: unknown): boolean {
  return typeof status === 'string' && TERMINAL_EXECUTION_STATUSES.includes(status);
}

/** Georgian legal-form markers and their Latin equivalents. Stripped before
 * comparing company names so "შპს მილენიო გრუპი" and "მილენიო გრუპი" are one
 * identity — the form is not part of who the company is. */
const LEGAL_FORM_RE = /(^|\s)(შპს|სს|ააიპ|ინდივიდუალურ\S*\s+მეწარმე|ltd\.?|llc|jsc|inc\.?|co\.?)(\s|$)/gi;

/**
 * Normalizes a company/person name for identity comparison. Deliberately
 * conservative and deterministic — casing, punctuation, quotes, whitespace
 * and legal form only. It does NOT transliterate: merging two scripts by
 * guesswork could collapse two genuinely different companies into one, which
 * is a worse failure than one redundant lookup. The transliteration case
 * (row 10) is handled by the stronger structural rule in
 * `shouldSkipDuplicateExecution` instead.
 */
export function normalizeEntityName(name: unknown): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[«»""''„"]/g, ' ')
    .replace(LEGAL_FORM_RE, ' ')
    .replace(/[.,;:()\-_/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The deterministic identity of one execution: job + source + research
 * target. Two steps with the same identity are the same work.
 *
 * An entity execution is identified by its idCode when it has one (the
 * registry's own authoritative key), and by its normalized name otherwise.
 */
export function executionIdentity(step: StepDescriptor): string {
  if (step.type === 'source') return `source:${step.key}`;
  const target = step.idCode ? `id:${step.idCode}` : `name:${normalizeEntityName(step.name)}`;
  return `entity:${step.source}:${target}`;
}

/** The same identity, computed from a RESULT rather than a step, so an
 * execution recorded by any path (this job's own loop, a resume, a skip, or
 * a caller's closed-loop entity endpoint) is recognized. */
export function resultExecutionIdentity(r: {
  source?: string;
  forEntity?: { idCode?: string | null; name?: string | null } | null;
}): string {
  const source = String(r?.source ?? '');
  if (!r?.forEntity) return `source:${source}`;
  const target = r.forEntity.idCode
    ? `id:${r.forEntity.idCode}`
    : `name:${normalizeEntityName(r.forEntity.name)}`;
  return `entity:${source}:${target}`;
}

/**
 * Decides whether a step must be skipped because equivalent work already
 * reached a terminal state in this job. Pure, so it is directly testable.
 *
 * Two independent rules:
 *
 *  1. EXACT IDENTITY. The same source + entity identity already finished.
 *     This is what makes SKIPPED_HUMAN_VERIFICATION genuinely terminal.
 *
 *  2. NAME-ONLY SUBSUMPTION. A name-only entity execution (idCode === null)
 *     is redundant once ANY execution of that same source already finished
 *     for an identified (idCode-bearing) entity in this job. A name search
 *     can never be more authoritative than the registry id the job already
 *     resolved, so repeating it only risks another CAPTCHA for no new
 *     evidence. This is the rule that deterministically kills row 10 without
 *     needing to guess that "Millennio Group" and "შპს მილენიო გრუპი" are
 *     the same string — and it holds for any script or spelling variant.
 */
export function shouldSkipDuplicateExecution(
  step: StepDescriptor,
  results: Array<{ source?: string; status?: string; forEntity?: { idCode?: string | null; name?: string | null } | null }>
): { skip: boolean; reason: string } {
  const terminal = (results || []).filter((r) => isTerminalExecutionStatus(r?.status));

  const identity = executionIdentity(step);
  if (terminal.some((r) => resultExecutionIdentity(r) === identity)) {
    return { skip: true, reason: 'already_terminal_for_this_identity' };
  }

  if (step.type === 'entity' && !step.idCode) {
    const identifiedSameSource = terminal.some((r) => r?.source === step.source && !!r?.forEntity?.idCode);
    if (identifiedSameSource) {
      return { skip: true, reason: 'subsumed_by_identified_entity_execution' };
    }
  }

  return { skip: false, reason: 'not_a_duplicate' };
}

/** Filters proposed steps against what this job already executed AND against
 * each other, so a single append can never enqueue the same identity twice.
 * Used when the entity queue is mined for follow-up work. */
export function dedupeProposedSteps(
  proposed: StepDescriptor[],
  results: Array<{ source?: string; status?: string; forEntity?: { idCode?: string | null; name?: string | null } | null }>,
  alreadyPlanned: StepDescriptor[] = []
): StepDescriptor[] {
  const seen = new Set<string>([...alreadyPlanned.map(executionIdentity)]);
  const out: StepDescriptor[] = [];
  for (const step of proposed) {
    const identity = executionIdentity(step);
    if (seen.has(identity)) continue;
    if (shouldSkipDuplicateExecution(step, results).skip) continue;
    seen.add(identity);
    out.push(step);
  }
  return out;
}

export function buildEntitySteps(confirmedEntities: { identificationCode: string | null; name: string }[], maxEntities: number): StepDescriptor[] {
  const steps: StepDescriptor[] = [];
  for (const e of confirmedEntities.filter((x) => x.identificationCode).slice(0, maxEntities)) {
    for (const source of ['enreg', 'rstax', 'debtor'] as const) {
      steps.push({ type: 'entity', source, idCode: e.identificationCode as string, name: e.name });
    }
  }
  return steps;
}
