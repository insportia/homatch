// EntityValidation.ts — the "a company name must never be copied into
// idCode" invariant (2026-09-06 production-trace mandate, real job
// 08379309-bb2e-4ac6-9d97-727edb3af2b8). Confirmed live: ENREG received
// forEntity: { name: "Millenio Group", idCode: "Millenio Group" } while the
// real companyProfile carried idCode: null. Root cause was
// ResearchOrchestrator.startEntity() falling back to the entity's NAME
// whenever idCode was absent, corrupting the idCode field itself instead of
// leaving it honestly null and letting EnregWorkflow's own ID_CODE/NAME
// method selection (which already existed and was already correct) make
// the real choice.
//
// Pure, dependency-free, and applied at every point a candidate idCode
// enters the system: EntityDeduplicator.merge() (so the EntityQueue itself
// can never store a name-shaped identificationCode — the field
// RsTaxpayerWorker/DebtorWorker treat as a ready-to-use numeric TIN with no
// name fallback of their own), ResearchOrchestrator.startEntity() (the
// confirmed production entry point for the bug), and
// EnregWorkflow.runEnregWorkflow() (the last line of defense right before
// the ID_CODE vs NAME search-method decision is made).
export function looksLikeCompanyId(v: unknown): v is string {
  const s = String(v || '').trim();
  return /^\d{9,11}$/.test(s);
}
