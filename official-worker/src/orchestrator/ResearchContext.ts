// ResearchContext.ts — pure job/step bookkeeping, ported unchanged in
// behavior from the pre-refactor lib/steps.js (already correct, already
// unit-tested — 5 tests). A job's `steps` array starts as the fixed
// per-mode primary-source list and can grow at runtime: once every primary
// step has produced a result, the orchestrator mines the shared EntityQueue
// for confirmed (name+idCode) companies and appends {type:'entity_enreg'}
// steps onto the SAME array — this is mandate Section 16's "Entity Queue"
// integration ("do not interrupt current document traversal ... finish
// current document, then orchestrator processes entity queue").
export type StepDescriptor = { type: 'source'; key: 'tas' | 'msmap' | 'mygov' | 'enreg' | 'napr' } | { type: 'entity_enreg'; idCode: string; name: string };

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
  if (step.type === 'entity_enreg') return r.source === 'enreg' && r.forEntity?.idCode === step.idCode;
  return r.source === step.key && !r.forEntity;
}

/** True once every primary ('source'-type) step at or after `fromIndex` has
 * already produced a result — safe to mine the entity queue and enqueue
 * follow-up steps. */
export function primaryStepsRemain(steps: StepDescriptor[], fromIndex: number): boolean {
  return steps.slice(fromIndex).some((s) => s.type === 'source');
}

export function buildEntitySteps(confirmedEntities: { identificationCode: string | null; name: string }[], maxEntities: number): StepDescriptor[] {
  return confirmedEntities
    .filter((e) => e.identificationCode)
    .slice(0, maxEntities)
    .map((e) => ({ type: 'entity_enreg', idCode: e.identificationCode as string, name: e.name }));
}
