// HOMATCH VERIFY — what is ready, what is still coming, and how we know.
//
// THE PROBLEM WITH THE OLD SIGNAL
//
// progress.ts produces an honest ESTIMATE from elapsed time and the pipeline's
// stage. It is a good number and it stays. But it is a number about the RUN,
// and a customer waiting eleven minutes is not asking how far along the run
// is. They are asking what Homatch has found out so far.
//
// This module answers that second question, and it answers it from EVIDENCE
// rather than from the clock. A section is ready when the facts that make it
// up exist, not when enough minutes have passed, and every maturity below is
// derived from counting things in result_json.
//
// WHY THE SERVER OWNS IT
//
// Two tabs, a phone and a reopened case must agree. Deriving maturity in the
// client would give four answers from four render times; deriving it once,
// server-side, from the persisted result means the state IS the evidence.
//
// WHY THERE ARE NO SENTENCES HERE
//
// The output is counts and states. "8 normalized, 5 likely unique, 3 excluded
// as duplicates" is information architecture; the words around it belong to
// i18n and the UI. A backend that emits English prose cannot be translated and
// cannot be re-designed without a deploy.

export type SectionId =
  | 'PROPERTY'
  | 'LOCATION'
  | 'MARKET'
  | 'OFFICIAL'
  | 'DEVELOPER'
  | 'PARTICIPANTS'
  | 'PUBLIC_CONTEXT'
  | 'RISKS'
  | 'SYNTHESIS';

export const SECTION_IDS: readonly SectionId[] = [
  'PROPERTY',
  'LOCATION',
  'MARKET',
  'OFFICIAL',
  'DEVELOPER',
  'PARTICIPANTS',
  'PUBLIC_CONTEXT',
  'RISKS',
  'SYNTHESIS',
];

/**
 * How complete a section is.
 *
 *   PENDING      nothing yet; research has not reached it
 *   PRELIMINARY  usable now, and explicitly not final
 *   ENRICHING    usable, and actively being strengthened
 *   VERIFIED     everything this section was going to get, it got
 *   PARTIAL      finished, but a source it wanted could not be read
 *   UNAVAILABLE  nothing could be established, and that is the finding
 *
 * PRELIMINARY must never be presented as VERIFIED. That is the whole contract
 * of showing a section early: the reader is told what they are looking at.
 */
export type SectionMaturity =
  | 'PENDING'
  | 'PRELIMINARY'
  | 'ENRICHING'
  | 'VERIFIED'
  | 'PARTIAL'
  | 'UNAVAILABLE';

export interface SectionState {
  id: SectionId;
  maturity: SectionMaturity;
  /**
   * Counted evidence. Keys are stable; the UI chooses which to show and how
   * to word them. A null value means "not applicable", never zero.
   */
  metrics: Record<string, number | null>;
  /**
   * Machine-readable reasons a section is PARTIAL or UNAVAILABLE, e.g.
   * 'OFFICIAL_SOURCE_BLOCKED'. Rendered through i18n, never shown raw.
   */
  notes: string[];
  /** ISO time this section last changed. Lets the UI avoid needless redraws. */
  updatedAt: string;
}

export interface SectionsSnapshot {
  sections: SectionState[];
  /** True once at least one section is usable. Drives "you can start reading". */
  anyUsable: boolean;
  updatedAt: string;
}

const USABLE: readonly SectionMaturity[] = ['PRELIMINARY', 'ENRICHING', 'VERIFIED', 'PARTIAL'];

export function isUsable(maturity: SectionMaturity): boolean {
  return USABLE.includes(maturity);
}

const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

const has = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
};

/** Terminal stages: after these, nothing more is coming for any section. */
const TERMINAL_STAGES = new Set(['COMPLETE', 'FAILED', 'CANCELLED']);

export interface SectionInput {
  result: Record<string, any> | null | undefined;
  /** research_jobs.stage. */
  stage?: string | null;
  /** research_jobs.status. */
  status?: string | null;
  now?: () => number;
}

/**
 * Derive every section's state from the evidence actually present.
 *
 * Deliberately pure and deliberately boring: it counts. Anything clever here
 * would be a second opinion about what the research found, and there is only
 * supposed to be one.
 */
export function computeSections(input: SectionInput): SectionsSnapshot {
  const r = input.result ?? {};
  const now = input.now ?? (() => Date.now());
  const updatedAt = new Date(now()).toISOString();
  const finished = TERMINAL_STAGES.has(String(input.status ?? '').toUpperCase());

  const sections: SectionState[] = [];
  const push = (
    id: SectionId,
    maturity: SectionMaturity,
    metrics: Record<string, number | null>,
    notes: string[] = [],
  ) => {
    sections.push({ id, maturity, metrics, notes, updatedAt });
  };

  // ── PROPERTY ────────────────────────────────────────────────────────────
  const identified = has(r.exactUnit?.code) || has(r.identifiedParent?.code) || has(r.identity?.entity?.name);
  const unitVerified = r.exactUnit?.verified === true;
  /*
   * A FINISHED RUN NEVER LEAVES A SECTION PENDING.
   *
   * Caught on the first production run: a free-text property query that never
   * resolved to a cadastral unit left PROPERTY at PENDING after the job
   * completed. PENDING renders as "not started", so a finished verification
   * showed a section that looked like it was still loading and always would
   * be. "We could not identify the exact unit" is a finding and has its own
   * state.
   */
  push(
    'PROPERTY',
    !identified
      ? finished
        ? 'UNAVAILABLE'
        : 'PENDING'
      : unitVerified
        ? 'VERIFIED'
        : finished
          ? 'PARTIAL'
          : 'ENRICHING',
    {
      identifiers: (has(r.exactUnit?.code) ? 1 : 0) + (has(r.identifiedParent?.code) ? 1 : 0),
      independentSources: numberOrNull(r.reconciledIdentity?.independentSourceCount),
    },
    unitVerified ? [] : identified ? ['UNIT_NOT_INDEPENDENTLY_CONFIRMED'] : [],
  );

  // ── LOCATION ────────────────────────────────────────────────────────────
  const places = count(r.publicResearch?.nearbyPlaces);
  const address = has(r.reconciledIdentity?.address) || has(r.projectProfile?.address) || has(r.identifiedParent?.address);
  push(
    'LOCATION',
    !address && places === 0
      ? finished
        ? 'UNAVAILABLE'
        : 'PENDING'
      : places > 0
        ? finished
          ? 'VERIFIED'
          : 'ENRICHING'
        : 'PRELIMINARY',
    { nearbyPlaces: places, addressKnown: address ? 1 : 0 },
  );

  // ── MARKET ──────────────────────────────────────────────────────────────
  // The deterministic lane writes _marketLane; the AI market stage writes
  // market.comparables. Either can make this section usable, and the counters
  // below are what the UI shows instead of a spinner.
  const lane = r._marketLane ?? null;
  const aiComparables = count(r.market?.comparables);
  const laneAdverts = numberOrNull(lane?.advertisements);
  const laneUnique = numberOrNull(lane?.uniqueProperties);
  const marketMetrics: Record<string, number | null> = {
    advertisements: laneAdverts,
    uniqueProperties: laneUnique,
    crossPosted: numberOrNull(lane?.crossPosted),
    uncertainDuplicates: numberOrNull(lane?.uncertainDuplicates),
    independentSources: numberOrNull(lane?.independentSourceCount),
    comparablesInReport: aiComparables || null,
    priceConflicts: numberOrNull(lane?.priceConflicts),
  };
  const marketNotes: string[] = [];
  if (lane?.widened === true) marketNotes.push('MARKET_ENVELOPE_WIDENED');
  if (lane?.truncatedByDeadline === true) marketNotes.push('MARKET_TIME_BUDGET_REACHED');
  for (const blocked of asStringArray(lane?.blockedSources)) {
    marketNotes.push(`MARKET_SOURCE_${blocked}`);
  }
  const marketHasEvidence = (laneUnique ?? 0) > 0 || aiComparables > 0;
  push(
    'MARKET',
    !marketHasEvidence
      ? finished
        ? 'UNAVAILABLE'
        : 'PENDING'
      : aiComparables > 0
        ? finished
          ? 'VERIFIED'
          : 'ENRICHING'
        : finished
          ? 'PARTIAL'
          : 'PRELIMINARY',
    marketMetrics,
    marketNotes,
  );

  // ── OFFICIAL ────────────────────────────────────────────────────────────
  const coverage = Array.isArray(r.officialSourceCoverage) ? r.officialSourceCoverage : [];
  const succeeded = coverage.filter((c: any) => c?.customerStatus === 'SUCCESS').length;
  const blocked = coverage.filter((c: any) =>
    ['BLOCKED', 'CAPTCHA_REQUIRED', 'TECHNICAL_FAILED'].includes(String(c?.customerStatus)),
  ).length;
  const documents = count(r.officialDocumentsRetrieved);
  const officialDone = r.browserOfficial?.unavailable === true || coverage.length > 0;
  push(
    'OFFICIAL',
    !officialDone
      ? finished
        ? 'UNAVAILABLE'
        : 'PENDING'
      : succeeded === 0
        ? 'UNAVAILABLE'
        : blocked > 0
          ? 'PARTIAL'
          : finished
            ? 'VERIFIED'
            : 'ENRICHING',
    {
      sourcesChecked: coverage.length || null,
      sourcesConfirmed: coverage.length ? succeeded : null,
      sourcesBlocked: coverage.length ? blocked : null,
      documentsRetrieved: documents || null,
    },
    blocked > 0 ? ['OFFICIAL_SOURCE_NOT_READABLE'] : [],
  );

  // ── DEVELOPER / COMPANY ─────────────────────────────────────────────────
  const companyKnown = has(r.companyProfile?.name) || has(r.companyProfile?.idCode);
  const registryConfirmed = r.companyProfile?.sourceBasis === 'REGISTRY_CONFIRMED';
  push(
    'DEVELOPER',
    !companyKnown
      ? finished
        ? 'UNAVAILABLE'
        : 'PENDING'
      : registryConfirmed
        ? finished
          ? 'VERIFIED'
          : 'ENRICHING'
        : 'PRELIMINARY',
    {
      directors: count(r.companyProfile?.directors) || null,
      relatedProjects: count(r.companyProfile?.relatedProjects) || null,
    },
    companyKnown && !registryConfirmed ? ['COMPANY_FROM_WEB_RESEARCH_ONLY'] : [],
  );

  // ── PARTICIPANTS ────────────────────────────────────────────────────────
  const participants =
    count(r.publicResearch?.foundersOwnersParticipants) +
    count(r.publicResearch?.directorsRepresentatives) +
    count(r.publicResearch?.contractors) +
    count(r.publicResearch?.engineers);
  push(
    'PARTICIPANTS',
    participants === 0 ? (finished ? 'UNAVAILABLE' : 'PENDING') : finished ? 'VERIFIED' : 'ENRICHING',
    { participants: participants || null },
  );

  // ── PUBLIC CONTEXT ──────────────────────────────────────────────────────
  const publicSignals =
    count(r.publicResearch?.mediaCoverage) +
    count(r.publicResearch?.socialPublicFootprint) +
    count(r.publicResearch?.qualitySignals) +
    count(r.publicResearch?.complaints);
  push(
    'PUBLIC_CONTEXT',
    publicSignals === 0 ? (finished ? 'UNAVAILABLE' : 'PENDING') : finished ? 'VERIFIED' : 'ENRICHING',
    {
      signals: publicSignals || null,
      complaints: count(r.publicResearch?.complaints) || null,
    },
  );

  // ── RISKS / CONFLICTS ───────────────────────────────────────────────────
  const conflicts = count(r.conflicts);
  const adverse = count(r.materialAdverseFindings);
  const risks = count(r.materialRisks?.riskFlags);
  const anyRiskEvidence = conflicts + adverse + risks > 0;
  push(
    'RISKS',
    !finished && !anyRiskEvidence ? 'PENDING' : anyRiskEvidence ? (finished ? 'VERIFIED' : 'ENRICHING') : 'VERIFIED',
    {
      conflicts: conflicts || null,
      materialFindings: adverse || null,
      riskFlags: risks || null,
    },
  );

  // ── SYNTHESIS ───────────────────────────────────────────────────────────
  // Only ever VERIFIED when a report actually exists. Research finishing is
  // not the report being ready, and this must never say otherwise.
  const summary = has(r.summary);
  push('SYNTHESIS', summary ? 'VERIFIED' : finished ? 'PARTIAL' : 'PENDING', {});

  return {
    sections,
    anyUsable: sections.some((s) => isUsable(s.maturity)),
    updatedAt,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
