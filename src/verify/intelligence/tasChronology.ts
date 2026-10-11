/*
 * TAS CASES IN THE ORDER THEY WERE FILED, AND WHAT EACH ONE DID.
 *
 * A case's position in the story is its FILING (registration) date, never its
 * document id, its list position or the date of a decision cited inside a
 * later case. Each case is placed in exactly one procedural stage:
 *
 *   SUBMITTED                 filed; no official response published yet
 *   UNDER_REVIEW              only deficiency notices / intermediate steps so far
 *   RESPONSE_UNREAD           a response was published but its outcome could not be read
 *   DECIDED                   a decision with legal effect was read (see `effect`)
 *
 * and a decided case's EFFECT is one of: PROJECT_APPROVED (conditions/project
 * agreed), PERMIT (construction permit issued), PERMIT_FOR_CORRECTED_PROJECT
 * (an amended permit: a corrected project approved and the permit re-issued),
 * DEADLINE_EXTENDED, COMMISSIONED (ONLY an operative act — see legalStatus.ts),
 * REFUSED, SUSPENDED, CANCELLED. A permit is never construction completion and
 * never commissioning.
 *
 * Every case here concerns the PARENT PARCEL the TAS search was run for —
 * municipal construction cases are filed per land parcel, not per apartment.
 *
 * Dates: a decision's date is the date printed on the act itself ("გაცემის
 * თარიღი") when the retained text carries it and it is consistent (on or
 * before the response's publication, within 120 days); otherwise the response's
 * publication date, labelled as such. A date is never taken from another case's
 * reference to the decision.
 *
 * Job 8ba97da9 (parcel 01.18.06.019.055): decision 7839183 in AR11101896
 * (filed 2025-07-29, "change of an agreed project") was published 2026-03-11
 * and reads "corrected architectural project … issue the construction permit …
 * construction term from 11 March 2026 to 11 March 2028" — an amended permit,
 * not commissioning. AR11148112 (2026-06-17) has a response (7971330) whose
 * outcome is unread; AR11161121 (2026-09-17) has no response yet.
 */

import { COMMISSIONING_OPERATIVE, revalidateDecision } from './legalStatus.ts';

export type CaseStage = 'SUBMITTED' | 'UNDER_REVIEW' | 'RESPONSE_UNREAD' | 'DECIDED';
export type CaseEffect =
  | 'PROJECT_APPROVED'
  | 'PERMIT'
  | 'PERMIT_FOR_CORRECTED_PROJECT'
  | 'DEADLINE_EXTENDED'
  | 'COMMISSIONED'
  | 'REFUSED'
  | 'SUSPENDED'
  | 'CANCELLED';

export interface PermitTerm {
  from: string | null;
  until: string | null;
}

export interface ChronologyDecision {
  number: string | null;
  /** The act's date (see dateBasis). */
  date: string | null;
  dateBasis: 'ACT_ISSUE_DATE' | 'RESPONSE_PUBLISHED';
  /** When the response carrying it was published on TAS. */
  publishedOn: string | null;
  outcome: string;
  effect: CaseEffect | null;
  /** Construction term the act sets, when its operative text states one. */
  term: PermitTerm | null;
  /** The act approves a corrected (amended) project. */
  correctedProject: boolean;
}

export interface ChronologyCase {
  caseRef: string | null;
  /** Filing / registration date — the ordering key. */
  filedOn: string | null;
  scope: 'PARENT_PARCEL';
  parcelCodes: string[];
  stage: CaseStage;
  /** The legal effect of the case's controlling decision, when DECIDED. */
  effect: CaseEffect | null;
  lastActivityOn: string | null;
  decisions: ChronologyDecision[];
  /** Responses published whose outcome could not be read. */
  unreadResponses: Array<{ number: string | null; publishedOn: string | null }>;
  deficiencyNotices: number;
  /** An earlier permit this case's permit replaces (same parcel). */
  supersedesPermit: { caseRef: string | null; decisionNumber: string | null; date: string | null } | null;
  attachments: { total: number; read: number; scanOnly: number; unsupported: number };
  /** Values the case's form states (metric label → value), as filed. */
  metrics: Array<{ label: string; value: string }>;
  /** A response deadline the record states — never invented. */
  deadline: string | null;
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const s = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v == null ? '' : String(v).trim());
const day = (v: unknown): string | null => {
  const t = s(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const MONTHS: Array<[RegExp, string]> = [
  [/^იანვ/, '01'], [/^თებერვ/, '02'], [/^მარტ/, '03'], [/^აპრილ/, '04'], [/^მაის/, '05'], [/^ივნის/, '06'],
  [/^ივლის/, '07'], [/^აგვისტ/, '08'], [/^სექტემბ/, '09'], [/^ოქტომბ/, '10'], [/^ნოემბ/, '11'], [/^დეკემბ/, '12'],
];
const monthOf = (word: string): string | null => MONTHS.find(([re]) => re.test(word))?.[1] ?? null;
const GEO_DATE = /(\d{4})\s+წლის\s+(\d{1,2})\s+([ა-ჰ]+)/gu;

/**
 * The construction term an act sets: "მშენებლობის ვადა განისაზღვროს 2026 წლის
 * 11 მარტიდან 2028 წლის 11 მარტის…". Both ends must be complete dates; a
 * truncated end yields `until: null` rather than a guess.
 */
export function permitTerm(evidence: unknown): PermitTerm | null {
  const text = s(evidence);
  const at = text.search(/(?:მშენებლობის\s+)?ვადა\s+განისაზღვროს/u);
  if (at < 0) return null;
  const window = text.slice(at, at + 160);
  const dates: string[] = [];
  for (const m of window.matchAll(GEO_DATE)) {
    const mm = monthOf(m[3]);
    if (!mm) continue;
    const dd = m[2].padStart(2, '0');
    if (Number(dd) < 1 || Number(dd) > 31) continue;
    dates.push(`${m[1]}-${mm}-${dd}`);
  }
  if (!dates.length) return null;
  const from = dates[0];
  const until = dates[1] && dates[1] > from ? dates[1] : null;
  return { from, until };
}

/**
 * A building block / liter label ("ც", "A", "2", "N3") — never an address.
 * The applicant's own home address ("კორპუსი 2, ბინა 34") was being read as
 * the project's block and published in the legal basis (job 8ba97da9).
 */
export function plausibleBlock(value: unknown): string | null {
  const v = s(value).replace(/^["„“'«»]+|["„“'«»]+$/g, '');
  if (!v || v.length > 6) return null;
  if (/ბინა|სართ|ქუჩ|მისამართ|კორპუს|ოთახ|apartment|flat|street|floor|,/iu.test(v)) return null;
  return /^(?:N\s*)?[\p{L}\d]{1,3}(?:[-–][\p{L}\d]{1,3})?$/u.test(v) ? v : null;
}

/** Decision number → the act's own printed issue date, from retained response text. */
export function actIssueDates(report: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of arr<any>(obj(obj(report).browserOfficial).results)) {
    if (s(r?.source).toLowerCase() !== 'tas') continue;
    for (const d of arr<any>(r?.documents)) {
      const text = typeof d?.rawText === 'string' ? d.rawText : '';
      // "DECISION <KIND> N 7585702 … გაცემის თარიღი: 08/08/2025" — the header of each response block.
      for (const m of text.matchAll(/DECISION\s+\w+\s+N\s*(\d{5,9})[\s\S]{0,80}?გაცემის\s+თარიღი\s*:\s*(\d{2}\/\d{2}\/\d{4})/gu)) {
        const iso = day(m[2]);
        if (iso && !out.has(m[1])) out.set(m[1], iso);
      }
    }
  }
  return out;
}

const CORRECTED = /კორექტირებულ|შეთანხმებული\s+პროექტის\s+ცვლილებ|ცვლილებ(?:ის|ები)\s+შეთანხმ/u;

function effectOf(outcome: string, evidence: string, correctedProject: boolean): CaseEffect | null {
  switch (outcome) {
    case 'PERMIT_ISSUED': return correctedProject ? 'PERMIT_FOR_CORRECTED_PROJECT' : 'PERMIT';
    case 'AMENDMENT_APPROVED': return 'PERMIT_FOR_CORRECTED_PROJECT';
    case 'APPROVED': return 'PROJECT_APPROVED';
    case 'DEADLINE_EXTENDED': return 'DEADLINE_EXTENDED';
    // Only an operative act is commissioning; anything else is not.
    case 'COMMISSIONED': return COMMISSIONING_OPERATIVE.test(evidence) ? 'COMMISSIONED' : null;
    case 'REFUSED': return 'REFUSED';
    case 'SUSPENDED': return 'SUSPENDED';
    case 'CANCELLED': return 'CANCELLED';
    default: return null;
  }
}

const CONSISTENT_WINDOW_DAYS = 120;

/** All TAS cases for the parcel, in filing order, each with its stage and legal effect. */
export function buildCaseChronology(report: unknown, nowIso: string = new Date().toISOString()): ChronologyCase[] {
  const results = arr<any>(obj(obj(report).browserOfficial).results).filter((r) => s(r?.source).toLowerCase() === 'tas');
  const api = results.find((r) => r?.tasApi)?.tasApi ?? null;
  if (!api) return [];
  const nowDay = String(nowIso).slice(0, 10);
  const issued = actIssueDates(report);
  const out: ChronologyCase[] = [];

  for (const c of arr<any>(api.cases)) {
    const filedOn = day(c?.date);
    const decisions: ChronologyDecision[] = [];
    const unreadResponses: ChronologyCase['unreadResponses'] = [];
    let deficiencyNotices = 0;
    let lastActivityOn: string | null = filedOn;
    for (const m of arr<any>(c?.motions)) {
      const publishedOn = day(m?.date);
      if (publishedOn && publishedOn <= nowDay && (!lastActivityOn || publishedOn > lastActivityOn)) lastActivityOn = publishedOn;
      const response = s(m?.response);
      const d = m?.decision && typeof m.decision === 'object' ? revalidateDecision(m.decision) : null;
      const outcome = s(d?.outcome);
      if (!d || !outcome || outcome === 'UNDETERMINED' || outcome === 'INFORMATIONAL') {
        if (response && response !== 'EMPTY') unreadResponses.push({ number: s(d?.number ?? m?.decisionNumber) || null, publishedOn });
        continue;
      }
      if (outcome === 'DEFICIENCY' || outcome === 'INTERMEDIATE') {
        deficiencyNotices++;
        continue;
      }
      const evidence = s(d.evidence);
      const number = s(d.number ?? m?.decisionNumber) || null;
      // The act's own date when retained and consistent; otherwise the publication date, labelled.
      const own = day(d.issueDate) ?? (number ? issued.get(number) ?? null : null);
      const ownOk = !!own && !!publishedOn && own <= publishedOn && (Date.parse(publishedOn) - Date.parse(own)) / 864e5 <= CONSISTENT_WINDOW_DAYS;
      const correctedProject = CORRECTED.test(evidence);
      const term = permitTerm(evidence);
      decisions.push({
        number,
        date: ownOk ? own : publishedOn,
        dateBasis: ownOk ? 'ACT_ISSUE_DATE' : 'RESPONSE_PUBLISHED',
        publishedOn,
        outcome,
        effect: effectOf(outcome, evidence, correctedProject),
        term: term && (day(d.validUntil) ? { from: term.from, until: day(d.validUntil) } : term),
        correctedProject,
      });
    }
    decisions.sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));
    const controlling = [...decisions].reverse().find((d) => d.effect) ?? null;
    const latestUnread = unreadResponses.map((u) => u.publishedOn ?? '').sort().pop() ?? '';
    const stage: CaseStage = controlling && (!latestUnread || latestUnread <= String(controlling.publishedOn ?? controlling.date ?? ''))
      ? 'DECIDED'
      : unreadResponses.length
        ? 'RESPONSE_UNREAD'
        : deficiencyNotices
          ? 'UNDER_REVIEW'
          : 'SUBMITTED';
    const atts = arr<any>(c?.attachments);
    out.push({
      caseRef: s(c?.registrationNumber) || null,
      filedOn,
      scope: 'PARENT_PARCEL',
      parcelCodes: arr<string>(c?.cadastralCodes).map(String),
      stage,
      effect: stage === 'DECIDED' ? controlling?.effect ?? null : null,
      lastActivityOn,
      decisions,
      unreadResponses,
      deficiencyNotices,
      supersedesPermit: null,
      attachments: {
        total: atts.length,
        read: atts.filter((a) => a?.outcome === 'READ_TEXT' || a?.outcome === 'LOW_TEXT').length,
        scanOnly: atts.filter((a) => a?.outcome === 'SCAN_OR_IMAGE_ONLY').length,
        unsupported: atts.filter((a) => a?.outcome === 'UNSUPPORTED_FORMAT').length,
      },
      metrics: arr<any>(c?.values)
        .filter((v) => s(v?.label) && s(v?.value) && s(v.value).length <= 40)
        .slice(0, 12)
        .map((v) => ({ label: s(v.label), value: s(v.value) })),
      deadline: day(c?.deadline),
    });
  }

  // Filing order; a case without a filing date goes last, never by its id.
  out.sort((a, b) => (a.filedOn ? 0 : 1) - (b.filedOn ? 0 : 1) || String(a.filedOn ?? '').localeCompare(String(b.filedOn ?? '')));

  // Each later permit supersedes the latest earlier one on the same parcel.
  let prior: { caseRef: string | null; decisionNumber: string | null; date: string | null } | null = null;
  for (const c of out)
    for (const d of c.decisions) {
      if (d.effect !== 'PERMIT' && d.effect !== 'PERMIT_FOR_CORRECTED_PROJECT') continue;
      if (prior && !c.supersedesPermit) c.supersedesPermit = prior;
      prior = { caseRef: c.caseRef, decisionNumber: d.number, date: d.date };
    }
  return out;
}

/** The newest `n` cases by FILING date, newest first. */
export function latestCasesByFiling(chronology: ChronologyCase[], n = 2): ChronologyCase[] {
  return [...chronology].filter((c) => c.filedOn).sort((a, b) => String(b.filedOn).localeCompare(String(a.filedOn))).slice(0, n);
}
