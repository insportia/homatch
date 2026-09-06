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
export function buildEntitySteps(confirmedEntities: { identificationCode: string | null; name: string }[], maxEntities: number): StepDescriptor[] {
  const steps: StepDescriptor[] = [];
  for (const e of confirmedEntities.filter((x) => x.identificationCode).slice(0, maxEntities)) {
    for (const source of ['enreg', 'rstax', 'debtor'] as const) {
      steps.push({ type: 'entity', source, idCode: e.identificationCode as string, name: e.name });
    }
  }
  return steps;
}
