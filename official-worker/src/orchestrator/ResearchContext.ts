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
export type StepDescriptor = { type: 'source'; key: 'tas' | 'msmap' | 'mygov' | 'enreg' | 'napr' } | { type: 'entity'; source: 'enreg' | 'rstax' | 'debtor'; idCode: string | null; name: string };

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

export function buildInitialSteps(job: Pick<ResearchJob, 'mode'>): StepDescriptor[] {
  const keys: StepDescriptor['type'] extends never ? never : Array<'tas' | 'msmap' | 'mygov' | 'enreg' | 'napr'> = job.mode === 'cadastral' ? ['tas', 'msmap', 'mygov'] : ['enreg', 'msmap', 'napr'];
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

// Unchanged in effect from before this generalization: the in-job
// EntityQueue auto-trigger (fired once every PRIMARY step has reported —
// see ResearchOrchestrator.run()) still only ever queues 'enreg' lookups.
// RS Taxpayers / MyGov Debtor are deliberately NOT auto-fired here for
// every text-scanned entity (that would be 2 extra real browser sessions
// per candidate, most of them irrelevant) — they are instead triggered
// only for the SAME single primary developer/company entity research-agent
// already decided was worth an ENREG lookup, via the closed-loop
// /research/rstax-entity and /research/debtor-entity endpoints (mirroring
// /research/enreg-entity — see index.ts and ResearchOrchestrator.startEntity()).
export function buildEntitySteps(confirmedEntities: { identificationCode: string | null; name: string }[], maxEntities: number): StepDescriptor[] {
  return confirmedEntities
    .filter((e) => e.identificationCode)
    .slice(0, maxEntities)
    .map((e) => ({ type: 'entity', source: 'enreg', idCode: e.identificationCode as string, name: e.name }));
}
