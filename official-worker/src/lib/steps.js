// Research-graph step bookkeeping — pure logic extracted out of run() so it
// can be unit-tested without Playwright/express installed (2026-09-05).
//
// A job's `steps` array starts as the fixed per-mode primary-source list
// (buildInitialSteps) and can grow at runtime: once every primary source
// step has produced a result, run() mines the shared EntityLedger for
// confirmed (name + idCode) companies and pushes {type:'entity_enreg',...}
// steps onto the SAME array (appendEntitySteps) — this is what makes
// "SOURCE 4 (ENREG): triggered by discovered entities" happen without a
// second orchestration pass, and without ever re-running the primary
// sources.
//
// stepMatchesResult is the replacement for the old, too-coarse
// `x.source !== keys[i]` filter: a primary 'enreg' step (property mode)
// and an entity-triggered 'enreg' step share the same `source` field on
// their result, so matching by source key alone would let an
// entity-triggered ENREG result silently overwrite (or be overwritten by)
// the primary ENREG source's own result. Matching requires the entity
// identity (idCode) to line up too for entity steps, and requires the
// ABSENCE of forEntity for a primary-source step.

function buildInitialSteps(job) {
  const keys = job.mode === 'cadastral' ? ['tas', 'msmap', 'mygov'] : ['enreg', 'msmap', 'napr'];
  return keys.map(key => ({ type: 'source', key }));
}

function stepMatchesResult(step, r) {
  if (!step) return false;
  if (step.type === 'entity_enreg') return r.source === 'enreg' && r.forEntity?.idCode === step.idCode;
  return r.source === step.key && !r.forEntity;
}

/** True once every primary ('source'-type) step at or after `fromIndex`
 * has already produced a result — i.e. it is safe to mine the ledger and
 * enqueue entity-triggered follow-up steps. Pure so the "only append
 * once, only after primaries are done" transition can be tested without
 * a real job/ledger. */
function primaryStepsRemain(steps, fromIndex) {
  return steps.slice(fromIndex).some(s => s.type === 'source');
}

/** Builds the entity_enreg step descriptors to append, given a ledger's
 * confirmed() list and a cap — does not mutate `steps` itself so callers
 * can decide how/when to push them (and so this stays trivially testable:
 * same input, same output, no hidden state). */
function buildEntitySteps(confirmedEntities, maxEntities) {
  return confirmedEntities.slice(0, maxEntities).map(e => ({ type: 'entity_enreg', idCode: e.idCode, name: e.name }));
}

export { buildInitialSteps, stepMatchesResult, primaryStepsRemain, buildEntitySteps };
