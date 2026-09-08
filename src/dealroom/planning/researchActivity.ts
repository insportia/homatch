// researchActivity.ts — truthful research progress.
//
// The old progress bar showed a percentage that was not measuring anything:
// stages wrote 38, 44, 50, 60, 70, 86 as they went by. It moved, so it looked
// informative, but it could not answer "how far along am I?" and it could not
// be wrong in a way anyone would notice.
//
// Replaced by two honest signals:
//
//   1. What is happening RIGHT NOW, in the customer's language.
//   2. What has ACTUALLY completed — milestones derived from real recorded
//      results, never from a stage counter.
//
// A percentage is emitted ONLY when it is genuinely countable (completed
// sources over planned sources) and is explicitly absent otherwise, so the UI
// can show a indeterminate state rather than a comforting lie.

export type ActivityKey =
  | 'PROPERTY_BASICS'
  | 'OWNERSHIP'
  | 'COMPANY'
  | 'PERMITS'
  | 'CONSTRUCTION'
  | 'MARKET'
  | 'SYNTHESIS'
  | 'HUMAN_VERIFICATION';

export interface Activity {
  key: ActivityKey;
  label: string;
  /** True only while this is the work actually in flight. */
  active: boolean;
}

export interface Milestone {
  key: string;
  label: string;
  /** Milestones appear only once the underlying work really finished. */
  completedAt: string;
}

export interface ProgressView {
  /** The single sentence to show. Null when nothing is in flight. */
  current: Activity | null;
  milestones: Milestone[];
  /** Present ONLY when genuinely countable. Null means "show indeterminate". */
  percent: number | null;
  /** Overrides ordinary progress in the UI — a waiting customer must see it. */
  awaitingHuman: boolean;
  /** Safe, already-confirmed findings that can be revealed while work
   * continues. Never anything provisional or interpretive. */
  confirmedSoFar: string[];
}

const ACTIVITY_LABELS: Record<ActivityKey, string> = {
  PROPERTY_BASICS: 'ვამოწმებთ ქონების ძირითად მონაცემებს...',
  OWNERSHIP: 'ვადარებთ საკუთრების ინფორმაციას...',
  COMPANY: 'ვიკვლევთ პროექტსა და კომპანიას...',
  PERMITS: 'ვამოწმებთ ნებართვებს...',
  CONSTRUCTION: 'ვიკვლევთ მშენებლობის დეტალებს...',
  MARKET: 'ვადარებთ ახლომდებარე ბაზრის მონაცემებს...',
  SYNTHESIS: 'ვამზადებთ საბოლოო შეჯამებას...',
  HUMAN_VERIFICATION: 'ველოდებით თქვენს დადასტურებას...',
};

/** Which source key corresponds to which customer-visible activity. */
const SOURCE_ACTIVITY: Record<string, ActivityKey> = {
  TAS_MAP: 'PROPERTY_BASICS',
  tas: 'PROPERTY_BASICS',
  napr: 'OWNERSHIP',
  mygov: 'OWNERSHIP',
  enreg: 'COMPANY',
  rstax: 'COMPANY',
  debtor: 'COMPANY',
};

/** Milestones are derived from RESULTS, so one can never appear for work that
 * did not actually produce anything. */
const MILESTONE_RULES: { key: string; label: string; when: (r: ResultLike[]) => boolean }[] = [
  {
    key: 'property-identified',
    label: 'ქონება იდენტიფიცირებულია',
    when: (rs) => rs.some((r) => (r.source === 'TAS_MAP' || r.source === 'tas') && r.resultConfirmed),
  },
  {
    key: 'ownership-checked',
    label: 'საკუთრების ინფორმაცია შემოწმებულია',
    when: (rs) => rs.some((r) => ['napr', 'mygov', 'tas'].includes(r.source) && (r.resultConfirmed || r.noResultConfirmed)),
  },
  {
    key: 'company-identified',
    label: 'კომპანია იდენტიფიცირებულია',
    when: (rs) => rs.some((r) => r.source === 'enreg' && r.resultConfirmed),
  },
  {
    key: 'market-compared',
    label: 'ბაზრის შედარება დასრულებულია',
    when: (rs) => rs.some((r) => r.source === 'market' && r.resultConfirmed),
  },
];

export interface ResultLike {
  source: string;
  status?: string;
  resultConfirmed?: boolean;
  noResultConfirmed?: boolean;
  retrievedAt?: string;
}

export interface ProgressInput {
  status: string;
  /** Results recorded so far. */
  results: ResultLike[];
  /** Total sources planned for this job, when known. */
  plannedSources?: number | null;
  /** The source currently being worked on, when known. */
  currentSource?: string | null;
  stage?: string | null;
}

/**
 * Builds the progress view.
 *
 * The percentage rule is the important one: it is emitted ONLY as
 * completed/planned sources, and only when `plannedSources` is actually
 * known. Everything else returns null so the UI shows an indeterminate
 * state — an honest "working on it" rather than a fabricated number.
 */
export function buildProgressView(input: ProgressInput): ProgressView {
  const results = input.results ?? [];
  const awaitingHuman = input.status === 'WAITING_HUMAN' || input.status === 'WAITING_HUMAN_LOCAL';

  // ---- current activity --------------------------------------------------
  let current: Activity | null = null;
  if (awaitingHuman) {
    current = { key: 'HUMAN_VERIFICATION', label: ACTIVITY_LABELS.HUMAN_VERIFICATION, active: true };
  } else if (input.status === 'COMPLETE' || input.status === 'FAILED') {
    current = null;
  } else if (input.stage === 'SYNTHESIS' || input.stage === 'SYNTHESIS_READY') {
    current = { key: 'SYNTHESIS', label: ACTIVITY_LABELS.SYNTHESIS, active: true };
  } else if (input.currentSource) {
    const key = SOURCE_ACTIVITY[input.currentSource];
    if (key) current = { key, label: ACTIVITY_LABELS[key], active: true };
  }

  // ---- milestones: derived from real results only ------------------------
  const milestones: Milestone[] = [];
  for (const rule of MILESTONE_RULES) {
    if (!rule.when(results)) continue;
    const at =
      results.find((r) => r.retrievedAt)?.retrievedAt ?? new Date().toISOString();
    milestones.push({ key: rule.key, label: rule.label, completedAt: at });
  }

  // ---- percentage: only when genuinely countable -------------------------
  let percent: number | null = null;
  const planned = input.plannedSources ?? null;
  if (planned && planned > 0) {
    const finished = results.filter((r) => r.resultConfirmed || r.noResultConfirmed || isTerminal(r.status)).length;
    percent = Math.min(100, Math.round((finished / planned) * 100));
  }

  // ---- safe progressive findings -----------------------------------------
  const confirmedSoFar: string[] = [];
  if (results.some((r) => (r.source === 'TAS_MAP' || r.source === 'tas') && r.resultConfirmed)) {
    confirmedSoFar.push('ქონება ოფიციალურ წყაროში მოიძებნა');
  }
  if (results.some((r) => r.source === 'enreg' && r.resultConfirmed)) {
    confirmedSoFar.push('კომპანიის სარეგისტრაციო მონაცემები მოძიებულია');
  }

  return { current, milestones, percent, awaitingHuman, confirmedSoFar };
}

function isTerminal(status?: string): boolean {
  return (
    !!status &&
    [
      'SEARCH_CONFIRMED', 'NO_RESULT_CONFIRMED', 'SOURCE_EXHAUSTED', 'SKIPPED_HUMAN_VERIFICATION',
      'SOURCE_UNAVAILABLE', 'SEARCH_CONTROL_NOT_FOUND', 'BLOCKED', 'FAILED',
    ].includes(status)
  );
}
