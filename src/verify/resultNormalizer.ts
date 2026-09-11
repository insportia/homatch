// HOMATCH — one boundary where a Verify result becomes safe to render.
//
// THE BUG THIS EXISTS TO END
//
// Opening a finished verification from the Verification Centre crashed the
// app with `Cannot read properties of undefined (reading 'filter')`. The
// cause was not a missing guard; it was two renderers disagreeing about what
// a report IS.
//
// verify-synthesis has emitted three different payload shapes over its life:
//
//   v1  { verdict, verdictReasons, sections:[{sectionKey,text}],
//         incompleteSources }
//   v2  { report: { overallView, executiveSummary, sections, attentionPoints,
//         buyerActions, finalView, contractUpload }, ... }
//   v3  { report: { summary, keyFindings, sections, attentionPoints,
//         finalView, contractUpload }, evidence, snapshot, market, location,
//         people, selfChecks, ... }        <- what it sends today
//
// VerifyReport was migrated to v3. SynthesisSummary — the renderer the case
// page used — was left on v1, where `sections` is a TOP-LEVEL array. Handed a
// v3 payload it read `view.sections`, got `undefined`, and called `.filter`
// on it. The page had already said "generating your summary", so the customer
// watched a loading state turn into an error boundary.
//
// Scattering `?.` through the components would have hidden that. It would not
// have made the report appear, because the data was never missing — it was
// one level down under a different name. A v1 renderer handed a v3 payload
// renders NOTHING correctly; the only real fix is to agree on a shape.
//
// SO: EXACTLY ONE PLACE KNOWS ABOUT VERSIONS
//
// Everything that reads a Verify result goes through normalizeVerifyResult().
// It accepts any of the three shapes — plus null, plus an error envelope,
// plus a half-written payload from a job that is still running — and always
// returns the same canonical v3-shaped object with every array present.
//
// Components below this line may index and map freely. That is the point: a
// renderer that has to defend itself is a renderer nobody can read.
//
// WHAT IT REFUSES TO DO
//
// It never invents a conclusion. A v1 report that carried a verdict and three
// reasons becomes a v3 report carrying that verdict and those three reasons —
// not a summary statement written here, and not an upgrade to a richer shape
// by filling the new fields with plausible text. Where v3 has a field v1
// never had, it stays empty and the renderer omits the block.

import type { JobState } from '@/jobs/jobState';

/* ------------------------------------------------------------------ *
 * Primitives                                                          *
 * ------------------------------------------------------------------ */

export const asArray = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const asBool = (v: unknown): boolean => v === true;

/** Strings only, blanks dropped — `cites` and `highlights` are both prone to
 *  arriving with a stray null from a model that skipped an element. */
const asStrings = (v: unknown): string[] => asArray(v).map(asString).filter(Boolean);

/* ------------------------------------------------------------------ *
 * The canonical shape                                                 *
 * ------------------------------------------------------------------ */

export type OverallLabel = 'POSITIVE' | 'BALANCED' | 'NEEDS_ATTENTION';
export type Sentiment = 'POSITIVE' | 'BALANCED' | 'ATTENTION';

export interface NormalSummaryHighlight {
  dimension: string;
  sentiment: Sentiment;
  headline: string;
  detail: string;
  cites: string[];
}

export interface NormalKeyFinding {
  finding: string;
  whyItMatters: string;
  sentiment: Sentiment;
  cites: string[];
}

export interface NormalSection {
  key: string;
  title: string;
  body: string;
  metrics: { label: string; value: string }[];
  cites: string[];
}

/**
 * Where the opening sentence came from.
 *
 * 'MODEL' is the summary the pipeline wrote for that purpose. The other two
 * are BORROWED from elsewhere in the same report because no summary was
 * produced — see ensureSummaryStatement() for why that is allowed and what it
 * is not allowed to do.
 */
export type SummarySource = 'MODEL' | 'FINAL_VIEW' | 'SECTION' | 'NONE';

export interface NormalReport {
  summary: {
    label: OverallLabel;
    statement: string;
    highlights: NormalSummaryHighlight[];
    /** Never rendered as text. Lets a caller say "in summary" only when it is. */
    statementSource: SummarySource;
  };
  keyFindings: NormalKeyFinding[];
  sections: NormalSection[];
  attentionPoints: { point: string; why: string; cites: string[] }[];
  nextSteps: { step: string; why: string; cites: string[] }[];
  finalView: string;
  contractUpload: { recommend: boolean; text: string };
}

/**
 * The whole result, canonicalised.
 *
 * Every array is present. Every optional object is either a complete value or
 * null — never a half-populated one, because a block that renders three of
 * its eight fields reads as missing data rather than as absent data.
 */
export interface NormalVerifyResult {
  report: NormalReport | null;
  evidence: {
    id: string; claim: string; provenance: string; certainty: string;
    source?: string; url?: string; date?: string;
  }[];
  snapshot: Record<string, unknown> | null;
  market: Record<string, unknown> | null;
  location: Record<string, unknown> | null;
  people: { people: Record<string, unknown>[]; representationNote?: string } | null;
  selfChecks: Record<string, unknown>[];
  participants: Record<string, unknown>[];
  /** v1 only. Sources the pipeline could not reach — coverage, never a defect. */
  incompleteSources: string[];
  mode: 'MODEL' | 'DETERMINISTIC';
  propertyType: string;
  empty: boolean;
}

export type PayloadVersion = 'V1' | 'V2' | 'V3' | 'NONE' | 'ERROR';

export interface NormalizedVerifyResult {
  /** Where the underlying work is. Decides which screen the customer sees. */
  state: JobState;
  /** Which historical contract the payload arrived in. Logged, never shown. */
  payloadVersion: PayloadVersion;
  result: NormalVerifyResult;
  /**
   * A translation KEY, never prose, and never a JavaScript message. The one
   * thing a customer must never read is the name of the property we failed to
   * dereference (PART E §54).
   */
  errorKey: string | null;
  /** Admin/debug only. Carries the raw provider or runtime reason. */
  technicalDetail: string | null;
}

/* ------------------------------------------------------------------ *
 * Field-level normalisers                                             *
 * ------------------------------------------------------------------ */

const LABELS: OverallLabel[] = ['POSITIVE', 'BALANCED', 'NEEDS_ATTENTION'];

/**
 * v1 and v2 each had their own label vocabulary, and both collapse onto v3's
 * three states. The two dropped middles ("mostly positive", "mixed", and v1's
 * "moderately positive") all become BALANCED, which is what v3 decided they
 * always meant: most properties are ordinary, and giving that its own colour
 * made ordinary read as a problem.
 */
const LABEL_ALIASES: Record<string, OverallLabel> = {
  POSITIVE: 'POSITIVE',
  MOSTLY_POSITIVE: 'BALANCED',
  MODERATELY_POSITIVE: 'BALANCED',
  MIXED: 'BALANCED',
  BALANCED: 'BALANCED',
  NEEDS_ATTENTION: 'NEEDS_ATTENTION',
  NEGATIVE: 'NEEDS_ATTENTION',
};

export const normalizeLabel = (v: unknown): OverallLabel => {
  const raw = asString(v).toUpperCase();
  if (LABELS.includes(raw as OverallLabel)) return raw as OverallLabel;
  return LABEL_ALIASES[raw] ?? 'BALANCED';
};

export const normalizeSentiment = (v: unknown): Sentiment => {
  const raw = asString(v).toUpperCase();
  return raw === 'POSITIVE' || raw === 'ATTENTION' ? raw : 'BALANCED';
};

const normalizeHighlight = (v: unknown): NormalSummaryHighlight => {
  const o = asObject(v);
  return {
    dimension: asString(o.dimension),
    sentiment: normalizeSentiment(o.sentiment),
    headline: asString(o.headline),
    detail: asString(o.detail),
    cites: asStrings(o.cites),
  };
};

const normalizeKeyFinding = (v: unknown): NormalKeyFinding => {
  const o = asObject(v);
  return {
    finding: asString(o.finding),
    whyItMatters: asString(o.whyItMatters),
    sentiment: normalizeSentiment(o.sentiment),
    cites: asStrings(o.cites),
  };
};

const normalizeMetric = (v: unknown): { label: string; value: string } => {
  const o = asObject(v);
  return { label: asString(o.label), value: asString(o.value) };
};

/**
 * A section, from either of the two shapes it has had.
 *
 * v1 called the key `sectionKey` and the prose `text` and carried no title at
 * all — the renderer looked the heading up from the key. v2 and v3 both carry
 * `key`/`title`/`body`. Accepting both here is what lets a report written in
 * August still open today.
 */
const normalizeSection = (v: unknown): NormalSection => {
  const o = asObject(v);
  return {
    key: asString(o.key) || asString(o.sectionKey),
    title: asString(o.title),
    body: asString(o.body) || asString(o.text),
    metrics: asArray(o.metrics).map(normalizeMetric).filter((m) => m.label || m.value),
    cites: asStrings(o.cites),
  };
};

const normalizeAttentionPoint = (v: unknown): { point: string; why: string; cites: string[] } => {
  const o = asObject(v);
  return { point: asString(o.point), why: asString(o.why), cites: asStrings(o.cites) };
};

const normalizeNextStep = (v: unknown): { step: string; why: string; cites: string[] } => {
  const o = asObject(v);
  // v2 called these `buyerActions` and named the field `action`.
  return {
    step: asString(o.step) || asString(o.action),
    why: asString(o.why),
    cites: asStrings(o.cites),
  };
};

const normalizeEvidenceItem = (v: unknown) => {
  const o = asObject(v);
  const item: NormalVerifyResult['evidence'][number] = {
    id: asString(o.id),
    claim: asString(o.claim),
    provenance: asString(o.provenance),
    certainty: asString(o.certainty),
  };
  const source = asString(o.source);
  const url = asString(o.url);
  const date = asString(o.date);
  if (source) item.source = source;
  if (url) item.url = url;
  if (date) item.date = date;
  return item;
};

/* ------------------------------------------------------------------ *
 * Version detection and per-version mapping                           *
 * ------------------------------------------------------------------ */

/**
 * Which contract is this?
 *
 * Keyed on structure rather than on a version number, because none of the
 * three payloads ever carried one. `report` present at all means v2 or v3;
 * `summary` inside it is what v3 added. A top-level `sections` array with no
 * `report` is v1 and nothing else ever looked like that.
 */
export function detectPayloadVersion(raw: unknown): PayloadVersion {
  const o = asObject(raw);
  if (!Object.keys(o).length) return 'NONE';
  if (asString(o.error)) return 'ERROR';
  if ('report' in o) {
    const r = asObject(o.report);
    // `report: null` is v3's honest "no evidence at all" answer, and it
    // arrives alongside v3's own sibling fields.
    if (o.report === null) return 'V3';
    return 'summary' in r || 'keyFindings' in r ? 'V3' : 'V2';
  }
  if (Array.isArray(o.sections) || 'verdict' in o || 'verdictReasons' in o) return 'V1';
  return 'NONE';
}

/**
 * THE FIRST THING A BUYER READS MUST SAY SOMETHING (PART A §4).
 *
 * 24 of the 58 reports persisted in production are structurally current and
 * carry no summary.statement at all — 8 written in DETERMINISTIC mode, where
 * the model's prose was rejected by the grounding gate, and 16 in MODEL mode
 * that simply did not populate it. Every one of them has sections. Opening
 * their report on a verdict word and then jumping straight into PROJECT is
 * not a summary, and it is what those customers see today.
 *
 * So the opening sentence is BORROWED when it is missing, in this order:
 *
 *   finalView   the pipeline's own closing judgement on this property. A
 *               real, grounded sentence — 16 of the 24 have one.
 *   section     the opening of the first section that has prose. The
 *               remaining 8.
 *
 * WHAT THIS IS NOT ALLOWED TO DO: compose a sentence. Nothing here writes
 * prose, joins facts, or derives a conclusion — it relocates a sentence the
 * pipeline already produced and grounded for this exact property. A summary
 * assembled here would be an unvalidated claim wearing the report's
 * authority, which is the one thing the whole synthesis design exists to
 * prevent.
 *
 * statementSource records which happened, so a renderer can label a borrowed
 * opening honestly rather than presenting it as a written summary.
 */
const SENTENCE_END = /(?<=[.!?。])\s+/;
const PARAGRAPH_BREAK = /\n{2,}/;

export function ensureSummaryStatement(report: NormalReport): NormalReport {
  if (report.summary.statement) {
    return { ...report, summary: { ...report.summary, statementSource: 'MODEL' } };
  }

  const finalView = report.finalView.trim();
  if (finalView) {
    return { ...report, summary: { ...report.summary, statement: finalView, statementSource: 'FINAL_VIEW' } };
  }

  const firstProse = report.sections.find((s) => s.body.trim())?.body.trim() ?? '';
  if (firstProse) {
    // The opening sentence, or the opening paragraph when it is one
    // unbroken sentence. Never truncated mid-word into an ellipsis.
    const opening = firstProse.split(SENTENCE_END)[0]?.trim() ?? '';
    const statement =
      opening && opening.length <= 400 ? opening : firstProse.split(PARAGRAPH_BREAK)[0].trim();
    if (statement) {
      return { ...report, summary: { ...report.summary, statement, statementSource: 'SECTION' } };
    }
  }

  return { ...report, summary: { ...report.summary, statementSource: 'NONE' } };
}

const EMPTY_REPORT_FIELDS = {
  keyFindings: [] as NormalKeyFinding[],
  attentionPoints: [] as NormalReport['attentionPoints'],
  nextSteps: [] as NormalReport['nextSteps'],
  finalView: '',
  contractUpload: { recommend: false, text: '' },
};

/**
 * v1 -> canonical.
 *
 * The interesting decision is `verdictReasons`. v1 showed them as a bulleted
 * "why" under the verdict; v3's nearest equivalent is `summary.highlights`,
 * which wants a dimension and a sentiment per row that v1 never recorded.
 * Guessing either would be inventing analysis, so the reasons become
 * highlights with an empty dimension and the verdict's own sentiment — true
 * to what was written, and the renderer simply omits the dimension label.
 */
function fromV1(o: Record<string, unknown>): NormalVerifyResult {
  const label = normalizeLabel(o.verdict);
  const sections = asArray(o.sections).map(normalizeSection).filter((s) => s.body);
  const reasons = asStrings(o.verdictReasons);
  const sentiment: Sentiment =
    label === 'POSITIVE' ? 'POSITIVE' : label === 'NEEDS_ATTENTION' ? 'ATTENTION' : 'BALANCED';

  const hasContent = sections.length > 0 || reasons.length > 0;

  return {
    report: hasContent
      ? ensureSummaryStatement({
          ...EMPTY_REPORT_FIELDS,
          summary: {
            label,
            statement: '',
            statementSource: 'NONE' as SummarySource,
            highlights: reasons.map((r) => ({
              dimension: '',
              sentiment,
              headline: r,
              detail: '',
              cites: [],
            })),
          },
          sections,
        })
      : null,
    evidence: [],
    snapshot: null,
    market: null,
    location: null,
    people: null,
    selfChecks: [],
    participants: [],
    incompleteSources: asStrings(o.incompleteSources),
    mode: asString(o.mode) === 'MODEL' ? 'MODEL' : 'DETERMINISTIC',
    propertyType: asString(o.propertyType),
    empty: asBool(o.empty) || !hasContent,
  };
}

/** v2 and v3 share every sibling field; only `report` differs. */
function siblingsOf(o: Record<string, unknown>): Omit<NormalVerifyResult, 'report' | 'empty'> {
  const peopleBlock = asObject(o.people);
  const peopleList = asArray<Record<string, unknown>>(peopleBlock.people).map(asObject);
  const representationNote = asString(peopleBlock.representationNote);

  return {
    evidence: asArray(o.evidence).map(normalizeEvidenceItem).filter((e) => e.id || e.claim),
    snapshot: Object.keys(asObject(o.snapshot)).length ? asObject(o.snapshot) : null,
    market: Object.keys(asObject(o.market)).length ? asObject(o.market) : null,
    location: Object.keys(asObject(o.location)).length ? asObject(o.location) : null,
    people: peopleList.length || representationNote
      ? { people: peopleList, ...(representationNote ? { representationNote } : {}) }
      : null,
    selfChecks: asArray(o.selfChecks).map(asObject).filter((c) => Object.keys(c).length),
    participants: asArray(o.participants).map(asObject).filter((p) => Object.keys(p).length),
    incompleteSources: asStrings(o.incompleteSources),
    mode: asString(o.mode) === 'MODEL' ? 'MODEL' : 'DETERMINISTIC',
    propertyType: asString(o.propertyType),
  };
}

function fromV2(o: Record<string, unknown>): NormalVerifyResult {
  const r = asObject(o.report);
  const overall = asObject(r.overallView);
  const sections = asArray(r.sections).map(normalizeSection).filter((s) => s.body);
  const statement = asString(overall.statement);
  const executive = asString(r.executiveSummary);

  const hasContent =
    sections.length > 0 || !!statement || !!executive || asArray(r.attentionPoints).length > 0;

  return {
    ...siblingsOf(o),
    report: hasContent
      ? ensureSummaryStatement({
          summary: {
            label: normalizeLabel(overall.label),
            statementSource: 'NONE' as SummarySource,
            // v2 split the answer in two: a one-line view and a paragraph
            // under it. v3 has one statement, so they are joined rather than
            // one of them being dropped — both were shown to that customer.
            statement: [statement, executive].filter(Boolean).join('\n\n'),
            highlights: [],
          },
          keyFindings: [],
          sections,
          attentionPoints: asArray(r.attentionPoints).map(normalizeAttentionPoint).filter((a) => a.point),
          nextSteps: asArray(r.buyerActions).map(normalizeNextStep).filter((s) => s.step),
          finalView: asString(r.finalView),
          contractUpload: {
            recommend: asBool(asObject(r.contractUpload).recommend),
            text: asString(asObject(r.contractUpload).text),
          },
        })
      : null,
    empty: asBool(o.empty) || !hasContent,
  };
}

function fromV3(o: Record<string, unknown>): NormalVerifyResult {
  // `report: null` is a real, final answer — every source was unavailable —
  // and must stay null rather than becoming an empty report that reads as a
  // clean bill of health.
  if (o.report === null || o.report === undefined) {
    return { ...siblingsOf(o), report: null, empty: true };
  }

  const r = asObject(o.report);
  const summary = asObject(r.summary);
  const sections = asArray(r.sections).map(normalizeSection).filter((s) => s.body);
  const keyFindings = asArray(r.keyFindings).map(normalizeKeyFinding).filter((f) => f.finding);
  const highlights = asArray(summary.highlights).map(normalizeHighlight).filter((h) => h.headline);
  const statement = asString(summary.statement);

  const hasContent =
    sections.length > 0 || keyFindings.length > 0 || highlights.length > 0 || !!statement;

  return {
    ...siblingsOf(o),
    report: hasContent
      ? ensureSummaryStatement({
          summary: {
            label: normalizeLabel(summary.label),
            statement,
            highlights,
            statementSource: 'NONE' as SummarySource,
          },
          keyFindings,
          sections,
          attentionPoints: asArray(r.attentionPoints).map(normalizeAttentionPoint).filter((a) => a.point),
          nextSteps: asArray(r.nextSteps).map(normalizeNextStep).filter((s) => s.step),
          finalView: asString(r.finalView),
          contractUpload: {
            recommend: asBool(asObject(r.contractUpload).recommend),
            text: asString(asObject(r.contractUpload).text),
          },
        })
      : null,
    empty: asBool(o.empty) || !hasContent,
  };
}

export const EMPTY_RESULT: NormalVerifyResult = {
  report: null,
  evidence: [],
  snapshot: null,
  market: null,
  location: null,
  people: null,
  selfChecks: [],
  participants: [],
  incompleteSources: [],
  mode: 'DETERMINISTIC',
  propertyType: '',
  empty: true,
};

/** The payload alone, canonicalised. Exposed for tests and for callers that
 *  already know the job finished. */
export function normalizeVerifyPayload(raw: unknown): {
  result: NormalVerifyResult;
  payloadVersion: PayloadVersion;
} {
  const version = detectPayloadVersion(raw);
  const o = asObject(raw);
  switch (version) {
    case 'V1': return { result: fromV1(o), payloadVersion: 'V1' };
    case 'V2': return { result: fromV2(o), payloadVersion: 'V2' };
    case 'V3': return { result: fromV3(o), payloadVersion: 'V3' };
    default: return { result: { ...EMPTY_RESULT }, payloadVersion: version };
  }
}

/* ------------------------------------------------------------------ *
 * State                                                               *
 * ------------------------------------------------------------------ */

/**
 * research_jobs' own status words, mapped onto the shared vocabulary.
 *
 * WAITING_HUMAN is deliberately PROCESSING rather than a state of its own:
 * from the job centre's point of view the work is live and unfinished, and
 * the CAPTCHA prompt that resolves it is a Verify-specific surface that owns
 * its own presentation.
 */
export function jobStatusToState(status: unknown, cancelledAt?: unknown): JobState {
  if (asString(cancelledAt)) return 'CANCELLED';
  switch (asString(status).toUpperCase()) {
    case 'CREATED': return 'QUEUED';
    case 'RUNNING':
    case 'WAITING_HUMAN': return 'PROCESSING';
    case 'COMPLETE': return 'COMPLETED';
    case 'FAILED': return 'FAILED';
    case 'CANCELLED': return 'CANCELLED';
    default: return 'PROCESSING';
  }
}

/**
 * The whole thing: what the job says, plus what the payload actually contains.
 *
 * The two can disagree, and when they do the payload wins for the purpose of
 * deciding what to SHOW. A job still marked RUNNING whose synthesis already
 * holds four finished sections has something worth reading, and that is
 * PARTIAL — not a spinner (PART A §4: "do not leave a blank loading container
 * when useful information already exists").
 */
export function normalizeVerifyResult(input: {
  raw: unknown;
  jobStatus?: unknown;
  cancelledAt?: unknown;
  /** Set when the fetch itself failed, so it can be told apart from a job
   *  that failed. Both are user-safe; only one is the customer's problem. */
  fetchFailed?: boolean;
  technicalDetail?: string | null;
}): NormalizedVerifyResult {
  const { raw, jobStatus, cancelledAt, fetchFailed } = input;
  const technicalDetail = input.technicalDetail ?? null;

  const { result, payloadVersion } = normalizeVerifyPayload(raw);
  const jobState = jobStatusToState(jobStatus, cancelledAt);
  const hasSomethingToShow = !!result.report;

  if (payloadVersion === 'ERROR' || fetchFailed) {
    // A report we could not fetch is not a failed verification. The job may
    // be perfectly healthy; say so with the section-level message rather
    // than telling the customer their check failed.
    return {
      state: jobState === 'COMPLETED' ? 'FAILED' : jobState,
      payloadVersion,
      result: hasSomethingToShow ? result : { ...EMPTY_RESULT },
      errorKey: 'verify_result_unavailable',
      technicalDetail: technicalDetail ?? (asString(asObject(raw).error) || null),
    };
  }

  if (jobState === 'CANCELLED') {
    return { state: 'CANCELLED', payloadVersion, result, errorKey: null, technicalDetail };
  }

  if (jobState === 'FAILED') {
    // A failed run that still produced readable sections shows them. The
    // customer paid for the work that DID complete.
    return {
      state: 'FAILED',
      payloadVersion,
      result,
      errorKey: 'verify_result_failed',
      technicalDetail,
    };
  }

  if (jobState === 'COMPLETED') {
    return {
      state: 'COMPLETED',
      payloadVersion,
      result,
      // An empty finished report is not an error — every source may have been
      // unreachable, which the renderer states plainly on its own.
      errorKey: null,
      technicalDetail,
    };
  }

  // Still running.
  return {
    state: hasSomethingToShow ? 'PARTIAL' : jobState,
    payloadVersion,
    result,
    errorKey: null,
    technicalDetail,
  };
}
