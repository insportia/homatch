// HOMATCH — the PUBLIC_RESEARCH context boundary.
//
// Shared rather than inlined in the edge function so the budget can be
// proven by a test. Same reason registryOverlay.ts lives here.

/* ============================================================== *
 * WHAT PUBLIC_RESEARCH IS ALLOWED TO SEE OF THE OFFICIAL LANE.
 *
 * Measured regression, Villion 01.18.06.019.055.03.01.601:
 *
 *   job e1b5d95c  official results 0   nearbyPlaces 6   facts 8
 *   job 347f9933  official results 4   nearbyPlaces 0   facts 5
 *
 * The only thing that changed between those two runs is that the official
 * worker started succeeding. PUBLIC_RESEARCH was handed up to twelve thousand
 * characters of raw registry documents, and its single response has to carry
 * roughly forty fields. When that blob arrived the optional fields went
 * first: location intelligence disappeared entirely and the fact list shrank.
 * Repairing the official lane therefore broke the public lane, silently.
 *
 * This stage does not need registry TEXT. It needs enough to know what to
 * search for and to tell two similarly-named projects apart. So it gets a
 * compact, deterministic identity summary and nothing else.
 *
 * The full official evidence is untouched and stays authoritative for every
 * later stage — the evidence package, the bundle and synthesis all read
 * result_json directly. This is a boundary, not a filter: nothing is deleted
 * and nothing is downgraded, and PUBLIC_RESEARCH never becomes authoritative
 * for company or legal facts.
 *
 * OFFICIAL_CONTEXT_BUDGET is enforced by a test so the next growth in
 * official evidence cannot quietly consume this lane again.
 * ============================================================== */

export const OFFICIAL_CONTEXT_BUDGET = 1200;

export function compactOfficialContext(o: any): string {
  const c = o?.companyProfile ?? {};
  const unit = o?.exactUnit ?? o?.identifiedParent ?? {};
  const pairs: [string, unknown][] = [
    ['cadastral', unit.code ?? unit.cadastralCode],
    ['address', unit.address ?? o?.address],
    ['propertyType', unit.propertyType],
    ['area', unit.area ?? unit.areaSqm],
    ['rooms', unit.rooms],
    ['floor', unit.floor],
    ['condition', unit.condition],
    ['developer', c.name],
    ['companyId', c.idCode],
    ['companyAddress', c.registeredAddress ?? c.address],
  ];
  const out: string[] = [];
  for (const [k, v] of pairs) {
    const text = typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
    if (!text) continue;
    const line = `${k}=${text}`;
    // A hard budget, because a summary that grows without limit is the same
    // defect wearing a smaller hat.
    if (out.join('; ').length + line.length > OFFICIAL_CONTEXT_BUDGET) break;
    out.push(line);
  }
  return out.join('; ');
}
