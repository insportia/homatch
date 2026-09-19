// HOMATCH — the official registry overlay.
//
// Shared by research-agent (which applies it) and by the tests that prove the
// deterministic chain end to end. See companyIntelligence.ts for the layer
// that reads the result, and official-worker's RegistryExtractParser for the
// parse this consumes.

const normalizeLoose = (s: string | null | undefined): string =>
  String(s || '').toLowerCase().replace(/["'«»„“”]/g, '').replace(/\s+/g, ' ').trim();

/* ============================================================== *
 * THE REGISTRY EXTRACT WINS.
 *
 * Production incident 2026-09-19. Company intelligence was arriving thin or
 * empty — no identification code, no directors, and never a shareholder or
 * an ownership percentage — and what did arrive came from the model's own
 * web research, marked WEB_RESEARCH_ONLY.
 *
 * There were three independent causes, and only fixing all three produces a
 * company profile worth reading:
 *
 *   1. Chromium could not launch in the worker at all (PID exhaustion; see
 *      official-worker/Dockerfile), so no official document was retrieved.
 *   2. official-worker parsed the retrieved extract into text only. The
 *      deterministic RegistryExtractParser — legal name, id code, legal
 *      form, registration date, registered address, directors with their
 *      representation rights, SHAREHOLDERS WITH EXACT PERCENTAGES and
 *      registered encumbrances — was imported by nothing but its own test.
 *   3. Nothing here consumed such a parse even when one existed, and
 *      companyProfile has no shareholders field in the model's schema at
 *      all, so ownership had no way to arrive except as prose.
 *
 * (2) is fixed in EnregWorkflow, which now attaches `registryExtract` to the
 * document. This is (3): those fields OVERWRITE the model's, because an
 * official extract read deterministically outranks anything inferred from
 * prose, always — never the other way around.
 *
 * MATCHING IS DELIBERATELY STRICT. Job 3aa36828 established that 404670272
 * and 405068386 are different companies that the pipeline had been carrying
 * under one name, so an extract is adopted only on an exact identification
 * code, an exact normalized legal name, or when the job retrieved exactly
 * one extract and the profile names no company to contradict it. Several
 * unmatched extracts adopt nothing.
 * ============================================================== */

export function registryExtractFor(companyProfile: any, browserOfficial: any): any | null {
  const extracts: any[] = [];
  for (const r of (browserOfficial?.results || [])) {
    if (r.source !== 'enreg') continue;
    for (const d of (r.documents || [])) {
      const x = d?.registryExtract;
      if (x && (x.idCode || x.legalName)) extracts.push(x);
    }
  }
  if (!extracts.length) return null;

  const wantId = companyProfile?.idCode || null;
  if (wantId) return extracts.find((x) => x.idCode === wantId) || null;

  const wantName = companyProfile?.name || null;
  if (wantName) {
    const byName = extracts.find(
      (x) => normalizeLoose(x.legalName || '') === normalizeLoose(wantName)
    );
    if (byName) return byName;
  }

  // No company claimed yet: one unambiguous extract is the company. Two are
  // a question this function is not entitled to answer.
  if (!wantId && !wantName && extracts.length === 1) return extracts[0];
  return null;
}

/** Overlays the official reading onto whatever the model produced. Returns
 * the profile unchanged when there is no extract to apply. */
export function applyRegistryExtract(companyProfile: any, extract: any): any {
  if (!extract) return companyProfile;
  const base = companyProfile || {
    name: null, idCode: null, legalForm: null, registrationDate: null, status: null,
    directors: [], representatives: [], historicalChanges: [], relatedProjects: [], summary: null,
  };

  // Structured, and WITHOUT the personal identification numbers the extract
  // prints. A director's name and how they bind the company are facts a buyer
  // needs; their personal id is not, and it must not travel into a report.
  const directors = (extract.directors || [])
    .map((d: any) => ({ name: d?.name || null, representation: d?.representation || null }))
    .filter((d: any) => d.name);

  // Shareholders keep their numbers as NUMBERS. A percentage rendered into a
  // sentence here cannot be sorted, summed or checked downstream.
  const shareholders = (extract.shareholders || [])
    .map((s: any) => ({
      name: s?.name || null,
      percentage: typeof s?.percentage === 'number' ? s.percentage : null,
      units: typeof s?.units === 'number' ? s.units : null,
    }))
    .filter((s: any) => s.name);

  // Only encumbrances actually REGISTERED are facts. "Not registered" rows
  // are the extract answering a question, not a finding about this company.
  const encumbrances = (extract.encumbrances || [])
    .filter((e: any) => e?.registered)
    .map((e: any) => ({
      kind: e.kind || null, reference: e.reference || null,
      creditor: e.creditor || null, registeredAt: e.registeredAt || null,
    }));

  const registryFields: string[] = [];
  const take = (field: string, value: any) => {
    if (value === null || value === undefined || value === '' ||
        (Array.isArray(value) && !value.length)) return base[field] ?? (Array.isArray(base[field]) ? [] : null);
    registryFields.push(field);
    return value;
  };

  return {
    ...base,
    name: take('name', extract.legalName),
    idCode: take('idCode', extract.idCode),
    legalForm: take('legalForm', extract.legalForm),
    registrationDate: take('registrationDate', extract.registrationDate),
    registeredAddress: take('registeredAddress', extract.address),
    governanceBody: take('governanceBody', extract.governanceBody),
    directors: take('directors', directors),
    shareholders: take('shareholders', shareholders),
    encumbrances: take('encumbrances', encumbrances),
    // Registered liquidation is a status the registry states outright; its
    // absence is equally an official reading, so the boolean is carried as
    // itself rather than collapsed into a status string.
    liquidationRegistered:
      typeof extract.liquidationRegistered === 'boolean' ? extract.liquidationRegistered : null,
    shareholdingConsistent:
      typeof extract.shareholdingConsistent === 'boolean' ? extract.shareholdingConsistent : null,
    extractNumber: extract.extractNumber || null,
    extractPreparedAt: extract.preparedAt || null,
    /** Exactly which fields the registry supplied, so provenance is auditable
     * downstream instead of being asserted. */
    registryFields,
  };
}
