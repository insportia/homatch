/*
 * TECHNICAL SPECIFICATIONS, WITH THEIR LEGAL STANDING.
 *
 * A number on a TAS form is only as strong as the case it sits in. The same
 * land area or K2 can be:
 *   APPROVED   — stated in a case whose own decision approved it (permit,
 *                approval, amendment);
 *   PROPOSED   — stated in an application still without a decision (e.g. the
 *                September 2026 amendment AR11161121, "განხილვის პროცესში");
 *   UNKNOWN    — stated in a case whose outcome was not read.
 * When both exist the latest approved value is shown WITH the proposed change,
 * never the proposal instead of it. Developer marketing is not read here at
 * all: it is a different kind of claim and stays in its own section.
 *
 * Sources: the case form (label/value pairs) first, then "label: value" lines
 * of case/attachment text. Deterministic and pure.
 */

import { readCaseSources, caseDecisionState, caseIsClosed, type CaseSource } from './tasCaseSources.ts';

export type SpecStatus = 'APPROVED' | 'PROPOSED' | 'UNKNOWN';

export interface TechnicalSpec {
  key: string;
  /** Georgian label. */
  label: string;
  value: string;
  numeric: number | null;
  unit: string | null;
  status: SpecStatus;
  caseRef: string | null;
  date: string | null;
  /** TAS public URL of the case (or the attachment the value was read from). */
  source: string | null;
  sourceKind: 'FORM' | 'TEXT';
}

type Kind = 'AREA' | 'VOLUME' | 'LENGTH' | 'COEFF' | 'COUNT' | 'TEXT' | 'CLASS';
interface SpecRule { key: string; label: string; kind: Kind; re: RegExp }

/** Order matters: the first matching rule wins. */
const RULES: SpecRule[] = [
  /*
   * The city form states each coefficient's AREA on a label that runs over
   * two lines (".კ1 განაშენიანების კოეფიციენტის საანგარიშო ფართობი (კვ.მ და
   * ასახული კოეფიციენტში). : 1170.8 კ1=0.5"); joinWrappedLabels() rejoins it,
   * and the windows below are wide enough for the full label.
   */
  { key: 'k2CalculationArea', label: 'კ-2 კოეფიციენტის გაანგარიშების ფართობი', kind: 'AREA', re: /(?:კ|k)\s*-?\s*2[^\n]{0,70}(?:ფართ|area|გაანგარიშ)|(?:ფართ|area)[^\n]{0,30}(?:კ|k)\s*-?\s*2\b/iu },
  { key: 'k1Area', label: 'კ-1 კოეფიციენტის ფართობი (განაშენიანება)', kind: 'AREA', re: /(?:კ|k)\s*-?\s*1[^\n]{0,70}(?:ფართ|area)|footprint/iu },
  { key: 'landscapingArea', label: 'კ-3 კოეფიციენტის ფართობი (გამწვანება)', kind: 'AREA', re: /(?:კ|k)\s*-?\s*3[^\n]{0,70}(?:ფართ|area)|(?:გამწვანებ|ლანდშაფტ)[^\n]{0,60}ფართ|landscap\w*\s+area/iu },
  /*
   * "განაშენიანების ფართობი" ALONE is the form's own built-up figure, not the
   * K-1 footprint (.601: 7 793.7 m² on a 2 145 m² plot whose K-1 area is
   * 1 170.8 m²). It is kept under its own key so nothing computes K-1 from it.
   */
  { key: 'builtUpArea', label: 'განაშენიანების ფართობი (ფორმის მიხედვით)', kind: 'AREA', re: /^\.?\s*განაშენიანების\s+ფართ/iu },
  { key: 'landArea', label: 'მიწის ნაკვეთის ფართობი', kind: 'AREA', re: /(?:მიწის\s+)?ნაკვეთის\s+ფართ|land\s+(?:plot\s+)?area|площадь\s+участка/iu },
  { key: 'residentialArea', label: 'საცხოვრებელი ფართობი', kind: 'AREA', re: /საცხოვრებელი\s+(?:ფართ|ფუნქციის\s+ფართ)|residential\s+area/iu },
  { key: 'officeArea', label: 'საოფისე ფართობი', kind: 'AREA', re: /საოფისე\s+ფართ|ოფისის\s+ფართ|office\s+area/iu },
  { key: 'commercialArea', label: 'კომერციული ფართობი', kind: 'AREA', re: /(?:კომერციული|სავაჭრო)\s+ფართ|commercial\s+area/iu },
  { key: 'summerArea', label: 'საზაფხულო ფართობი (აივნები, ტერასები)', kind: 'AREA', re: /საზაფხულო\s+ფართ|summer\s+area/iu },
  { key: 'stairArea', label: 'კიბის უჯრედებისა და სადარბაზოების ფართობი', kind: 'AREA', re: /კიბის\s+უჯრედ[^\n]{0,40}ფართ|სადარბაზოს\s+ფართ|stair\w*\s+(?:and\s+lobby\s+)?area/iu },
  { key: 'auxiliaryArea', label: 'დამხმარე ფართობი', kind: 'AREA', re: /დამხმარე\s+ფართ|auxiliary\s+area/iu },
  { key: 'parkingArea', label: 'ავტოსადგომის ფართობი', kind: 'AREA', re: /(?:ავტოსადგომ|პარკინგ)[^\n]{0,20}ფართ|parking\s+area/iu },
  { key: 'totalArea', label: 'საერთო ფართობი', kind: 'AREA', re: /საერთო\s+ფართ|სამშენებლო\s+ფართ|total\s+(?:floor\s+)?area/iu },
  { key: 'buildingVolume', label: 'სამშენებლო მოცულობა', kind: 'VOLUME', re: /სამშენებლო\s+მოცულობ|building\s+volume/iu },
  { key: 'structuralHeight', label: 'კონსტრუქციული სიმაღლე', kind: 'LENGTH', re: /კონსტრუქციული\s+სიმაღლ|structural\s+height/iu },
  { key: 'undergroundDepth', label: 'მიწისქვეშა ნაწილის სიღრმე', kind: 'LENGTH', re: /მიწისქვეშა[^\n]{0,30}სიღრმ|ჩაღრმავებ|underground\s+depth/iu },
  { key: 'heightAboveGround', label: 'მიწისზედა სიმაღლე', kind: 'LENGTH', re: /მიწისზედა[^\n]{0,30}სიმაღლ|შენობის\s+სიმაღლ|^სიმაღლე$|height\s+above\s+ground|building\s+height/iu },
  { key: 'parkingSpaces', label: 'ავტოსადგომების რაოდენობა', kind: 'COUNT', re: /(?:ავტოსადგომ|პარკინგ)[^\n]{0,20}(?:რაოდენობ|ადგილ)|parking\s+(?:spaces|places)/iu },
  { key: 'undergroundFloors', label: 'მიწისქვეშა სართულები', kind: 'COUNT', re: /მიწისქვეშა\s+სართულ|underground\s+floors?/iu },
  { key: 'floors', label: 'სართულიანობა', kind: 'COUNT', re: /მიწისზედა\s+სართულ|სართულ(?:ების|ის)?\s+რაოდენობ|სართულიანობ|number\s+of\s+floors|^floors?$/iu },
  { key: 'units', label: 'ბინების რაოდენობა', kind: 'COUNT', re: /ბინ(?:ებ)?ის\s+რაოდენობ|საცხოვრებელი\s+ერთეულ|number\s+of\s+(?:apartments|units)/iu },
  { key: 'K1', label: 'კ-1 კოეფიციენტი', kind: 'COEFF', re: /^(?:კ|k)\s*-?\s*1(?:\s*კოეფიციენტი)?$|(?:კ|k)\s*-?\s*1\s+კოეფიციენტ/iu },
  { key: 'K2', label: 'კ-2 კოეფიციენტი', kind: 'COEFF', re: /^(?:კ|k)\s*-?\s*2(?:\s*კოეფიციენტი)?$|(?:კ|k)\s*-?\s*2\s+კოეფიციენტ/iu },
  { key: 'K3', label: 'კ-3 კოეფიციენტი', kind: 'COEFF', re: /^(?:კ|k)\s*-?\s*3(?:\s*კოეფიციენტი)?$|(?:კ|k)\s*-?\s*3\s+კოეფიციენტ/iu },
  { key: 'buildingClass', label: 'შენობის კლასი', kind: 'CLASS', re: /შენობის\s+კლას|კლასი|building\s+class/iu },
  { key: 'foundationType', label: 'საძირკვლის ტიპი', kind: 'TEXT', re: /საძირკვლის\s+(?:ტიპ|სახე)|foundation\s+type/iu },
  { key: 'structuralSystem', label: 'კონსტრუქციული სისტემა', kind: 'TEXT', re: /კონსტრუქციული\s+(?:სქემა|სისტემა)|structural\s+system/iu },
  { key: 'elevator', label: 'ლიფტი', kind: 'TEXT', re: /ლიფტ|elevator|лифт/iu },
  { key: 'facadeMaterials', label: 'ფასადის მასალები', kind: 'TEXT', re: /ფასად[^\n]{0,30}(?:მოპირკეთ|მასალ|დამუშავ)|facade\s+(?:materials?|cladding)/iu },
  { key: 'buildingFunction', label: 'შენობის ფუნქცია', kind: 'TEXT', re: /შენობის\s+(?:ფუნქცი|დანიშნულებ)|ფუნქციური\s+დანიშნულებ|building\s+use/iu },
];

const UNIT: Record<Kind, string | null> = { AREA: 'მ²', VOLUME: 'მ³', LENGTH: 'მ', COEFF: null, COUNT: null, TEXT: null, CLASS: null };

/** "2,145 მ²" → 2145; "5 242,3" → 5242.3; "0,5" → 0.5; "22.75 მ" → 22.75. */
export function parseNumber(raw: string): number | null {
  const m = /(\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)*)/.exec(raw);
  if (!m) return null;
  let t = m[1].replace(/[  ]/g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/,/g, '');
  else if (/^\d{1,3}(?:,\d{3})+$/.test(t)) t = t.replace(/,/g, '');
  else t = t.replace(',', '.');
  if ((t.match(/\./g) ?? []).length > 1) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function plausible(kind: Kind, n: number | null, value: string): boolean {
  switch (kind) {
    case 'AREA': return n !== null && n > 0 && n < 1_000_000;
    case 'VOLUME': return n !== null && n > 0 && n < 10_000_000;
    case 'LENGTH': return n !== null && n > 0 && n < 500;
    case 'COEFF': return n !== null && n >= 0 && n < 20;
    case 'COUNT': return n !== null && Number.isInteger(n) && n >= 0 && n < 5000;
    case 'CLASS': return /(?:^|[\s(])(?:I{1,3}|IV|V)(?:$|[\s).,])|კლასი/u.test(value) && value.length <= 40;
    case 'TEXT': return /\p{L}{3,}/u.test(value) && value.length <= 200 && !/\b(?:უნდა|იქნას|შეიძლება)\b/u.test(value);
  }
}

export function ruleForLabel(label: string): SpecRule | null {
  const t = label.replace(/\s+/g, ' ').trim();
  if (!t || t.length > 120) return null;
  return RULES.find((r) => r.re.test(t)) ?? null;
}

interface Occ { rule: SpecRule; value: string; numeric: number | null; caseRef: string | null; date: string | null; source: string | null; sourceKind: 'FORM' | 'TEXT'; status: SpecStatus }

function normValue(rule: SpecRule, raw: string): { value: string; numeric: number | null } | null {
  const v = raw.replace(/\s+/g, ' ').replace(/^[\s:;,.–—-]+|[\s;,]+$/g, '').trim();
  if (!v) return null;
  const numeric = rule.kind === 'TEXT' || rule.kind === 'CLASS' ? null : parseNumber(v);
  if (!plausible(rule.kind, numeric, v)) return null;
  if (rule.kind === 'TEXT' || rule.kind === 'CLASS') return { value: v.length > 160 ? `${v.slice(0, 157)}…` : v, numeric: null };
  const unit = UNIT[rule.kind];
  return { value: unit ? `${numeric!.toLocaleString('en-US', { maximumFractionDigits: 2 }).replace(/,/g, ' ')} ${unit}` : String(numeric), numeric };
}

const LINE = /^(.{2,120}?)\s*(?:[:：=\t|]|\s[–—-]\s)\s*(.{1,200})$/u;

/**
 * The city form wraps long labels: ".კ2 … საანგარიშო ფართობი (კვ.მ და" /
 * "ასახული კოეფიციენტში). : 5242.3 კ2=2.4", or puts the value alone on the
 * next line (": 797.9 კ3=0.4"). A dotted form label without its value is
 * joined with up to two following lines until it has one. Whitespace is
 * normalised on the way.
 */
export function joinWrappedLabels(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let cur = lines[i].replace(/\s+/g, ' ').trim();
    let joined = 0;
    while (/^\.\S/u.test(cur) && !LINE.test(cur) && joined < 2 && i + 1 < lines.length) {
      const next = lines[i + 1].replace(/\s+/g, ' ').trim();
      if (!next || /^\.\S/u.test(next)) break;
      cur = `${cur} ${next}`;
      i++;
      joined++;
    }
    out.push(cur);
  }
  return out;
}

function statusOf(c: CaseSource, nowDay: string | null, latestApproval: string): SpecStatus {
  const s = caseDecisionState(c, nowDay);
  if (s === 'APPROVED') return 'APPROVED';
  if (s === 'UNDER_REVIEW') return 'PROPOSED';
  // An open application newer than every approval is a proposal too.
  if (s === 'UNDECIDED' && !caseIsClosed(c) && (c.date ?? '') > latestApproval) return 'PROPOSED';
  return 'UNKNOWN';
}

/**
 * Every documented specification, one row per matter and standing: the
 * latest APPROVED value, and a PROPOSED value when a later undecided
 * application states a different one. `nowIso` is the job's completion time.
 */
export function extractTechnicalSpecs(reportOrCases: unknown, nowIso: string | null = null): TechnicalSpec[] {
  const cases: CaseSource[] = Array.isArray(reportOrCases) ? (reportOrCases as CaseSource[]) : readCaseSources(reportOrCases);
  const nowDay = nowIso ? nowIso.slice(0, 10) : null;
  const occ: Occ[] = [];
  const latestApproval = cases.filter((c) => caseDecisionState(c, nowDay) === 'APPROVED').map((c) => c.date ?? '').sort().pop() ?? '';
  for (const c of cases) {
    const status = statusOf(c, nowDay, latestApproval);
    const seen = new Set<string>();
    const add = (label: string, value: string, kind: 'FORM' | 'TEXT', source: string | null) => {
      const rule = ruleForLabel(label);
      if (!rule) return;
      const v = normValue(rule, value);
      if (!v || seen.has(rule.key)) return;
      seen.add(rule.key);
      occ.push({ rule, ...v, caseRef: c.caseRef, date: c.date, source, sourceKind: kind, status });
      // "1170.8 კ1=0.5": the coefficient itself rides on its area's line.
      const coeff = /(?:კ|k)\s*-?\s*([123])\s*=\s*(\d+(?:[.,]\d+)?)/iu.exec(value);
      if (coeff && rule.kind === 'AREA') add(`კ-${coeff[1]} კოეფიციენტი`, coeff[2], kind, source);
    };
    for (const f of c.fields) add(f.label, f.value, 'FORM', c.publicUrl);
    for (const t of c.texts)
      for (const line of joinWrappedLabels(t.text.split(/\n/).slice(0, 6000))) {
        const m = LINE.exec(line);
        if (m) add(m[1], m[2], 'TEXT', t.sourceUrl ?? c.publicUrl);
      }
  }
  const out: TechnicalSpec[] = [];
  const byKey = new Map<string, Occ[]>();
  for (const o of occ) byKey.set(o.rule.key, [...(byKey.get(o.rule.key) ?? []), o]);
  const newest = (list: Occ[]) => [...list].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0];
  const row = (o: Occ): TechnicalSpec => ({
    key: o.rule.key, label: o.rule.label, value: o.value, numeric: o.numeric, unit: UNIT[o.rule.kind], status: o.status,
    caseRef: o.caseRef, date: o.date, source: o.source, sourceKind: o.sourceKind,
  });
  const same = (a: Occ, b: Occ) => (a.numeric !== null && b.numeric !== null ? Math.abs(a.numeric - b.numeric) < 1e-9 : a.value.toLowerCase() === b.value.toLowerCase());
  for (const rule of RULES) {
    const list = byKey.get(rule.key);
    if (!list?.length) continue;
    const approved = newest(list.filter((o) => o.status === 'APPROVED'));
    const proposed = newest(list.filter((o) => o.status === 'PROPOSED' && (!approved || (o.date ?? '') >= (approved.date ?? ''))));
    if (approved) out.push(row(approved));
    if (proposed && (!approved || !same(proposed, approved))) out.push(row(proposed));
    if (!approved && !proposed) out.push(row(newest(list)));
  }
  return out;
}
