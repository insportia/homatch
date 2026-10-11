/*
 * HOW THE PROJECT EVOLVED — reconstructed from the city's own case files.
 *
 * The central story of a Tbilisi project is rarely "permit, then building".
 * Job eeefada9 (Kristian Stiven St 18, parcel 01.72.14.040.030): a permit for
 * an individual house in 2012, a design returned in 2013 because it crossed
 * the regulation line, land-use conditions in 2023, a seven-storey
 * multi-apartment design approved in 2024, a corrected design and permit in
 * 2025, another corrected design with a permit in December 2025, and three
 * orders that corrected the area figures (2025-06, 2026-04, 2026-05). Two of
 * those orders were still listed as "pending" because the worker could not
 * classify their result line ("შედეგი: თანხმობა"): their published text says
 * exactly what they did.
 *
 * TWO LAYERS, BOTH DETERMINISTIC.
 *
 *   extractEvolution(result)   runs in verify-synthesis on the raw research
 *                              result and is persisted inside
 *                              report.projectSignals.evolution: per case, the
 *                              published acts (number, date, result line,
 *                              nomenclature, the act it amends, the area
 *                              figures requested and fixed, the reasons a
 *                              notice gives) and the drawing sets filed (from
 *                              the attachment names: "ფასადები 27,12",
 *                              "ფოტომონტაჟი", "კორექტირება", "ძველი მონტაჟი").
 *   evolutionView(history, evolution, …)
 *                              runs anywhere (UI included) and turns those
 *                              records plus officialHistory.caseChronology
 *                              into steps a buyer can follow: what was
 *                              requested, what the city decided and when, the
 *                              practical change, whether it is final, what it
 *                              means for a buyer and what stays unverified.
 *
 * HARD RULES. An older design is never said to have been built. The current
 * building is never said to be unauthorised. A render or photomontage that
 * looks like the building is never evidence of compliance. A file NAME tells
 * what was filed, never what it shows. Case and decision numbers live in the
 * evidence of each step, never in its sentences. No personal ID numbers,
 * phones or private addresses: every text passes through redactPersonal().
 */

import { readCaseSources, textSections, tasPublicUrl, tasAttachmentUrl, redactPersonal, type CaseSource } from './tasCaseSources.ts';
import { kaOnDay, kaOfDay, yearOf } from './kaDates.ts';

/* ───────────────────────── Raw layer: acts and drawing sets ───────────────────────── */

export type ActResult = 'CONSENT' | 'INTERMEDIATE' | 'REFUSAL';
export type AreaKey = 'residential' | 'summer' | 'auxiliary' | 'total' | 'office' | 'commercial';

export interface AreaChange {
  key: AreaKey;
  /** The figure the act replaced (as the request states it). */
  from: number | null;
  /** The figure the applicant asked for. */
  requested: number | null;
  /** The figure the act fixed (operative part), when it states one. */
  fixed: number | null;
}

export interface CaseActRecord {
  number: string | null;
  /** "გაცემის თარიღი" printed on the act. */
  issuedOn: string | null;
  /** When the response was published on TAS (block header). */
  publishedOn: string | null;
  result: ActResult | null;
  /** The act's own title, e.g. an amendment "of order N … of 30 December 2025". */
  amends: { number: string; date: string | null } | null;
  /** The operative part changes the area figures of an earlier act. */
  areaChanges: AreaChange[];
  /** The city found the figures wrongly summed (a technical error in the approved papers). */
  summationError: boolean;
  /** The operative part approves a corrected (amended) project. */
  correctedProject: boolean;
  /** The operative part issues a construction permit. */
  permitIssued: boolean;
  /** The kind of building the operative part names ("ინდივიდუალური საცხოვრებელი სახლი"). */
  buildingType: string | null;
  /** Fixed-phrase reasons a notice gives (see NOTICE_REASONS). */
  reasons: string[];
  /** Short quotes of what a notice says a correction created ("…კორექტირების შედეგად გაჩენილი კედელი"). */
  correctionQuotes: string[];
  /** Earlier permits whose construction term this act recites. */
  permitTerms: Array<{ decisionNumber: string; until: string }>;
  /** The operative part approves the parcel's building-use conditions (გაპი). */
  conditions: boolean;
}

export type DrawingComponent =
  | 'FACADES' | 'PLANS' | 'SECTIONS' | 'SITE_PLAN' | 'PHOTOMONTAGE' | 'HEIGHT' | 'STRUCTURE' | 'GEOLOGY'
  | 'EXPERTISE' | 'ENGINEERING' | 'SITE_PHOTOS' | 'CONSTRUCTION_ORG' | 'DEMOLITION' | 'INSPECTION' | 'FINE'
  | 'LANDSCAPING' | 'TRANSPORT';

export interface FiledFile { name: string; url: string | null; date: string | null }
export interface FiledComponent {
  component: DrawingComponent;
  /** Revision dates read from the file names, oldest first (ISO). */
  revisions: string[];
  /** "ძველი/ახალი მონტაჟი": the filing contrasts an old and a new appearance. */
  oldAndNew: boolean;
  files: FiledFile[];
}

export interface CaseEvolution {
  caseRef: string | null;
  documentId: string | null;
  filedOn: string | null;
  publicUrl: string | null;
  /** Nomenclature lines of the case form ("შეთანხმებული პროექტის ცვლილება", "მრავალბინიანი საცხოვრებელი სახლი"). */
  nomenclature: string[];
  /** Procedure stages the application covers ("პროექტის შეთანხმება", "მშენებლობის ნებართვა"). */
  stages: string[];
  /** Files are named as corrections ("კორექტირება"). */
  correctionFiles: boolean;
  /** Storeys the file names state ("შვიდ სართულიანი"). */
  storeys: number | null;
  components: FiledComponent[];
  acts: CaseActRecord[];
  /** The area figures the case form states (technical-economic indicators). */
  formAreas: Partial<Record<AreaKey, number>>;
  /** Orders the case form names as the parcel's building-use conditions ("დადგენილი გაპის ბრძანების ნომერი"). */
  conditionsOrders: string[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const num = (v: string | undefined | null): number | null => {
  if (!v) return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const dmyToIso = (v: string | undefined | null): string | null => {
  const m = v ? /(\d{2})\/(\d{2})\/(\d{4})/.exec(v) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const MONTHS = ['იანვ', 'თებერვ', 'მარტ', 'აპრილ', 'მაის', 'ივნის', 'ივლის', 'აგვისტ', 'სექტემბ', 'ოქტომბ', 'ნოემბ', 'დეკემბ'];
const geoDate = (y: string, d: string, month: string): string | null => {
  const i = MONTHS.findIndex((s) => month.startsWith(s));
  if (i < 0 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${String(i + 1).padStart(2, '0')}-${d.padStart(2, '0')}`;
};

const AREA_WORD: Array<[RegExp, AreaKey]> = [
  [/^საცხოვრებ/u, 'residential'], [/^საზაფხულ/u, 'summer'], [/^დამხმარ/u, 'auxiliary'], [/^საერთ/u, 'total'], [/^საოფის/u, 'office'], [/^კომერციულ/u, 'commercial'],
];
const areaKey = (w: string): AreaKey | null => AREA_WORD.find(([re]) => re.test(w))?.[1] ?? null;
const AREA_TERM = '(საცხოვრებელ\\S*|საზაფხულო|დამხმარე|საერთო|საოფისე|კომერციულ\\S*)\\s+ფართ[ა-ჰ]*';

/** Reasons a notice gives, as fixed Georgian phrases (never the notice's raw text). */
export const NOTICE_REASONS: Array<{ id: string; re: RegExp; text: string }> = [
  { id: 'REGULATION_LINE', re: /რეგულირების\s+ხაზის\s+დარღვევით/u, text: 'შენობა განაშენიანების რეგულირების ხაზს სცდებოდა' },
  { id: 'FACADE_PLAN_MISMATCH', re: /ფასად\S*\s+მოვიდეს\s+გეგმ\S*\s+შესაბამისობაში/u, text: 'ფასადი გეგმებს არ შეესაბამებოდა' },
  { id: 'OWNER_CONSENT', re: /შეცვლილი\s+ფართ\S*\s+წილობრივი\s+საკადასტრო\s+კოდ/u, text: 'ქალაქმა მოითხოვა, მითითებულიყო ყველა შეცვლილი ფართი და წარდგენილიყო მათი მესაკუთრეების, მომავალი მესაკუთრეებისა და იპოთეკარების თანხმობა' },
  { id: 'AUTHORITY', re: /არ\s+დგინდება\s+განმცხადებლის\s+უფლებამოსილება/u, text: 'ქალაქმა განმცხადებლის უფლებამოსილების დამადასტურებელი დოკუმენტი მოითხოვა' },
  { id: 'AUDIT_DEVIATION', re: /მშენებლობა\s+(?:ნაწარმოებია|მიმდინარეობს|განხორციელდა)\s+შეთანხმებული\s+პროექტის\s+(?:დარღვევით|გადახვევით)/u, text: 'მერიის შიდა აუდიტის წერილით, მშენებლობა შეთანხმებული პროექტის დარღვევით მიმდინარეობდა' },
  { id: 'FOUNDATION_LEVELS', re: /საძირკვლის\s+ნიშნულები/u, text: 'კონსტრუქციულ პროექტში საძირკვლის ნიშნულები უნდა შესწორებულიყო' },
];

/** One published response block: "[2026-05-21 · motion · response]" … */
export function readActBlock(lines: string[], publishedOn: string | null): CaseActRecord | null {
  const raw = redactPersonal(lines.join('\n'));
  const flat = raw.replace(/\s+/g, ' ');
  const head = /(?:ბრძანება|გადაწყვეტილება)\s+No\s*(\d{5,9})/u.exec(flat) ?? /DECISION\s+\w+\s+N\s*(\d{5,9})/u.exec(flat);
  const resultWord = /შედეგი\s*:\s*([ა-ჰ]+)/u.exec(flat)?.[1] ?? '';
  const result: ActResult | null = /^(?:თანხმობა|დადებითი|დაკმაყოფილ)/u.test(resultWord) ? 'CONSENT'
    : /^შუალედური/u.test(resultWord) ? 'INTERMEDIATE'
      : /^(?:უარ|უარყოფითი)/u.test(resultWord) ? 'REFUSAL' : null;
  if (!head && !result) return null;

  const amend = new RegExp(`(\\d{4})\\s+წლის\\s+(\\d{1,2})\\s+([ა-ჰ]+)\\s+(?:No|№)\\s*(\\d{5,9})\\s+ბრძანებაში\\s+(?:ცვლილების|შევიდეს|შეტანილ)`, 'u').exec(flat);
  const opAt = flat.search(/ვ\s?ბ\s?რ\s?ძ\s?ა\s?ნ\s?ე\s?ბ\s*:/u);
  const operative = opAt >= 0 ? flat.slice(opAt) : '';

  /* Areas: "X ფართობად A კვ.მ-ის ნაცვლად B" (requested) and the operative "X ფართობი: B". */
  const changes = new Map<AreaKey, AreaChange>();
  const reqRe = new RegExp(`${AREA_TERM}\\s+(\\d+(?:[.,]\\d+)?)\\s*კვ\\.?\\s*მ[^\\d]{0,24}?ნაც(?:ვ)?ლად\\s+(?:შეადგენს\\s+)?(\\d+(?:[.,]\\d+)?)`, 'gu');
  const requestPart = opAt >= 0 ? flat.slice(0, opAt) : flat;
  for (const m of requestPart.matchAll(reqRe)) {
    const key = areaKey(m[1]);
    if (!key || changes.has(key)) continue;
    changes.set(key, { key, from: num(m[2]), requested: num(m[3]), fixed: null });
  }
  if (operative && /ცვლილება|ცვლილებ|დაფიქსირდ/u.test(operative.slice(0, 600))) {
    const fixRe = new RegExp(`${AREA_TERM}(?:\\s+დაფიქსირდ\\S*)?\\s*(?::|-|–)?\\s*(?:-\\s*)?(\\d+(?:[.,]\\d+)?)`, 'gu');
    const point1 = operative.split(/\s2\.\s/u)[0];
    for (const m of point1.matchAll(fixRe)) {
      const key = areaKey(m[1]);
      if (!key) continue;
      const prev = changes.get(key) ?? { key, from: null, requested: null, fixed: null };
      if (prev.fixed === null) changes.set(key, { ...prev, fixed: num(m[2]) });
    }
  }

  const reasons = NOTICE_REASONS.filter((r) => r.re.test(flat)).map((r) => r.id);
  const correctionQuotes: string[] = [];
  for (const m of flat.matchAll(/([^.:;•"„“]{0,60})კორექტირების\s+შედეგად\s+([^.;•]{3,90}?)(?=\s+(?:გათვალისწინებულ|წარმოდგენილ|აისახოს|შესწორდეს|მოვიდეს)|[.;•]|$)/gu)) {
    const q = `${m[1].trim()} კორექტირების შედეგად ${m[2].trim()}`.replace(/^[\s,:)(-]+/u, '').replace(/\s+/g, ' ').trim();
    if (q.length > 24 && !correctionQuotes.includes(q)) correctionQuotes.push(q.length > 150 ? `${q.slice(0, 147).trimEnd()}…` : q);
    if (correctionQuotes.length >= 2) break;
  }
  const permitTerms: CaseActRecord['permitTerms'] = [];
  for (const m of flat.matchAll(/No\s*(\d{6,8})\s+ბრძანებით\s+გაიცა\s+მშენებლობის\s+ნებართვა\.?\s*მშენებლობის\s+ვადა\s+განისაზღვრა\s+\d{4}\s+წლის\s+\d{1,2}\s+[ა-ჰ]+\s+(\d{4})\s+წლის\s+(\d{1,2})\s+([ა-ჰ]+)\s+ჩათვლით/gu)) {
    const until = geoDate(m[2], m[3], m[4]);
    if (until) permitTerms.push({ decisionNumber: m[1], until });
  }
  const type = /(ინდივიდუალური\s+საცხოვრებელი\s+სახლ|მრავალბინიანი\s+საცხოვრებელი\s+(?:სახლ|კომპლექს)|საცხოვრებელი\s+კომპლექს)\S*/u.exec(operative || flat);

  return {
    number: head?.[1] ?? null,
    issuedOn: dmyToIso(/გაცემის\s+თარიღი\s*:\s*(\d{2}\/\d{2}\/\d{4})/u.exec(flat)?.[1]),
    publishedOn,
    result,
    amends: amend ? { number: amend[4], date: geoDate(amend[1], amend[2], amend[3]) } : null,
    areaChanges: [...changes.values()],
    summationError: /ფართობების\s+არასწორი\s+დაჯამების/u.test(flat),
    correctedProject: /კორექტირებული\s+(?:არქიტექტურული\s+)?პროექტ/u.test(operative),
    permitIssued: /გაიცეს\s+მშენებლობის\s+ნებართვა/u.test(operative),
    buildingType: type ? type[1].replace(/\s+/g, ' ') : null,
    reasons,
    correctionQuotes,
    permitTerms,
    conditions: /დამტკიცდეს\s+(?:თანდართული\s+)?მიწის\s+ნაკვეთის\s+სამშენებლ|სამშენებლოდ\s+გამოყენების\s+პირობ/u.test(flat),
  };
}

const FORM_AREA: Array<[RegExp, AreaKey]> = [
  [/\.საერთო\s+ფართობი\s*\(კვ\.მ\)\.\s*:\s*(\d+(?:[.,]\d+)?)/u, 'total'],
  [/\.საცხოვრებელი\s+ფართობი\s*\(კვ\.მ\)\.\s*:\s*(\d+(?:[.,]\d+)?)/u, 'residential'],
  [/\.საზაფხულო\s+ფართობი\s*\(კვ\.მ\)\.\s*:\s*(\d+(?:[.,]\d+)?)/u, 'summer'],
  [/\.დამხმარე\s+ფართობი\s*\(კვ\.მ\)\.\s*:\s*(\d+(?:[.,]\d+)?)/u, 'auxiliary'],
];

/** Lines after a label ("ნომენკლატურა :", "სტადიები:") until the next labelled block. */
function listAfter(text: string, label: RegExp, stop: RegExp): string[] {
  const at = text.search(label);
  if (at < 0) return [];
  const out: string[] = [];
  for (const line of text.slice(at).split('\n').slice(1, 9)) {
    const l = line.trim();
    if (!l) continue;
    if (stop.test(l)) break;
    if (l.length > 70 || /\d{3,}/.test(l)) break;
    out.push(l);
  }
  return out;
}

/* ── drawing sets from file names ── */

const COMPONENT_RULES: Array<[DrawingComponent, RegExp]> = [
  // DEMOLITION before PHOTOMONTAGE: "დემონტაჟი" contains "მონტაჟ".
  ['DEMOLITION', /დემონტაჟ|demontaj/iu],
  ['FINE', /ჯარიმ|jarim/iu],
  ['INSPECTION', /ინსპექც|inspeq|inspection/iu],
  ['FACADES', /ფასად|fasad|facade|elevation/iu],
  ['SECTIONS', /ჭრილ|wril|jril|chril|section/iu],
  ['SITE_PLAN', /გენ-?გე[გმ]|გენგემ|gen-?gegm|gengem|masterplan|\bsite\b/iu],
  ['PLANS', /გეგმებ|გემგებ|gegmeb|gemgeb|floor\s*plans?|\bplans\b/iu],
  ['PHOTOMONTAGE', /მონტაჟ|montaj|monraj|montaJ|render|რენდ|xedeb|ხედებ|\bmodel\b|აქსონომ|aqsiom/iu],
  ['HEIGHT', /სიმაღლ|simagl|^\d*\.?\s*H[\s.]/iu],
  ['GEOLOGY', /გეოლ|geolog|გრუნტ|grunt/iu],
  ['STRUCTURE', /კონსტრუქც|konstruq|konstruk/iu],
  ['EXPERTISE', /ექსპერტ|eqspert|eqpert|ekspert|daskvna|დასკვნ/iu],
  ['ENGINEERING', /საინჟინრ|sainjinr|sainJinr|ენერგ|energ|gwp|telasi|თელასი|gazi|გაზ(?:ი|ის)?(?=[\s.,]|$)/iu],
  ['LANDSCAPING', /დენდრ|dendro|გამწვან|taxac|ტაქსაც/iu],
  ['TRANSPORT', /ტრანსპ|transp|satransp|საგზაო/iu],
  ['CONSTRUCTION_ORG', /პოსი|მოპი|\bPOS\b|\bposi\b|\bmopi\b|ეტაპებ|კალენდარ/iu],
  ['SITE_PHOTOS', /ფოტო|foto|photo|surat|სურათ|არსებულ|arsebul|\bPH\b/iu],
];
const DESIGN_FILES: DrawingComponent[] = ['FACADES', 'PLANS', 'SECTIONS', 'SITE_PLAN', 'PHOTOMONTAGE'];
const SKIP_FILE = /მინდობილ|mindobil|ბანერ|baneri|ქვითარ|ამონაწერ|\.(?:pla|rar|zip|jpg|jpeg|png|tif)$/iu;

/** A revision date in a file name: "27,12", "30.04", "2022.10.10", "25,07,2025", "14-04-2025". */
export function fileRevisionDate(name: string, filedOn: string | null, lastActivity: string | null = null): string | null {
  const s = name.replace(/\.[a-z0-9]{2,5}$/i, '');
  const ymd = /(20\d{2})[.,_-](\d{1,2})[.,_-](\d{1,2})/.exec(s);
  if (ymd) {
    const [y, m, d] = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const dm = /(?<![\d])(\d{1,2})[.,-](\d{1,2})(?:[.,-](\d{2,4}))?(?![\d])/.exec(s);
  if (!dm) return null;
  const d = Number(dm[1]);
  const m = Number(dm[2]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = (y: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (dm[3]) {
    const y = Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]);
    return y >= 2000 && y <= 2100 ? iso(y) : null;
  }
  const fy = yearOf(filedOn);
  if (!fy || !filedOn) return null;
  /* No year: the one that fits the case's life. A file uploaded during the
     review is dated between the filing and the last activity; a file reused
     from an earlier application is dated within the year before the filing. */
  const lo = Date.parse(filedOn) - 365 * 864e5;
  const hi = Date.parse(lastActivity && lastActivity > filedOn ? lastActivity : filedOn) + 7 * 864e5;
  const fits = [fy, fy + 1, fy - 1].map(iso).filter((x) => Date.parse(x) >= lo && Date.parse(x) <= hi);
  return fits.find((x) => x >= filedOn) ?? fits.sort().pop() ?? null;
}

const STOREY_WORDS: Record<string, number> = { 'ერთ': 1, 'ორ': 2, 'სამ': 3, 'ოთხ': 4, 'ხუთ': 5, 'ექვს': 6, 'შვიდ': 7, 'რვა': 8, 'ცხრა': 9, 'ათ': 10, 'თერთმეტ': 11, 'თორმეტ': 12 };

export function caseComponents(c: Pick<CaseSource, 'attachments' | 'date'> & { motions?: CaseSource['motions'] }): { components: FiledComponent[]; correctionFiles: boolean; storeys: number | null } {
  const map = new Map<DrawingComponent, FiledComponent>();
  let correctionFiles = false;
  let storeys: number | null = null;
  const lastActivity = (c.motions ?? []).map((m) => m.date ?? '').filter(Boolean).sort().pop() ?? null;
  for (const a of c.attachments) {
    const name = str(a.fileName);
    if (!name) continue;
    if (/კორექტირ|korektir/iu.test(name)) correctionFiles = true;
    const st = /(ერთ|ორ|სამ|ოთხ|ხუთ|ექვს|შვიდ|რვა|ცხრა|ათ|თერთმეტ|თორმეტ)\s*სართულიან/u.exec(name);
    if (st && storeys === null) storeys = STOREY_WORDS[st[1]] ?? null;
    if (SKIP_FILE.test(name) && !/ჯარიმ|jarim/iu.test(name)) continue;
    const rule = COMPONENT_RULES.find(([, re]) => re.test(name));
    if (!rule) continue;
    const comp = rule[0];
    const date = fileRevisionDate(name, c.date, lastActivity);
    const entry = map.get(comp) ?? { component: comp, revisions: [], oldAndNew: false, files: [] };
    if (date && !entry.revisions.includes(date)) entry.revisions.push(date);
    if (comp === 'PHOTOMONTAGE' && /ძველ|zvel|\bold\b/iu.test(name)) entry.oldAndNew = entry.oldAndNew || c.attachments.some((x) => /ახალი\s*მონტაჟ|axali\s*montaj|new\s*montage/iu.test(str(x.fileName)));
    // Files are kept for the drawing set only (the evidence shows them), three per component: the payload stays small.
    if (DESIGN_FILES.includes(comp) && !entry.files.some((f) => f.name === name)) {
      entry.files.push({ name: name.length > 90 ? `${name.slice(0, 87)}…` : name, url: tasAttachmentUrl(a.attachedFileId), date });
    }
    map.set(comp, entry);
  }
  const components = [...map.values()].map((e) => ({
    ...e,
    revisions: e.revisions.sort(),
    files: [...e.files].sort((x, y) => (x.date ?? '').localeCompare(y.date ?? '')).slice(-3),
  }));
  return { components, correctionFiles, storeys };
}

/** Every case's acts and drawing sets, filing order. Runs on the raw research result. */
export function extractEvolution(result: unknown): CaseEvolution[] {
  const out: CaseEvolution[] = [];
  for (const c of readCaseSources(result)) {
    const caseText = c.texts.find((t) => t.kind === 'CASE')?.text ?? '';
    const acts: CaseActRecord[] = [];
    // The case's own words: its header and the published responses, never an attached file's text.
    const own = textSections(caseText).filter((sec) => !sec.fileName);
    for (const sec of own) {
      if (!sec.date) continue;
      const act = readActBlock(sec.lines, sec.date);
      if (act && !acts.some((a) => a.number && a.number === act.number)) acts.push(act);
    }
    const ownText = own.map((sec) => sec.lines.join('\n')).join('\n');
    // Decision evidence windows the worker kept on the motions (older runs carry nothing else).
    for (const m of c.motions) {
      const ev = m.decision?.evidence;
      if (!ev || acts.some((a) => a.number && a.number === m.decision?.number)) continue;
      const act = readActBlock([`ბრძანება No ${m.decision?.number ?? ''}`, ev], m.date);
      if (act) acts.push({ ...act, result: act.result ?? (/^(?:PERMIT_ISSUED|APPROVED|AMENDMENT_APPROVED)$/.test(m.decision?.outcome ?? '') ? 'CONSENT' : /DEFICIENCY|INTERMEDIATE/.test(m.decision?.outcome ?? '') ? 'INTERMEDIATE' : null) });
    }
    const nomenclature = listAfter(ownText, /ნომენკლატურა\s*:/u, /^(?:სტადიები|დამკვეთი|მისამართი)/u);
    const stages = listAfter(ownText, /სტადიები\s*:/u, /^(?:დამკვეთი|მისამართი)/u);
    const formAreas: Partial<Record<AreaKey, number>> = {};
    const flat = ownText.replace(/[ \t]+/g, ' ');
    const conditionsOrders = [...new Set([...flat.matchAll(/დადგენილი\s+გაპის\s+ბრძანების\s+ნომერი\.?\s*:\s*(\d{5,9})/gu)].map((m) => m[1]))];
    for (const [re, key] of FORM_AREA) {
      const v = num(re.exec(flat)?.[1]);
      if (v !== null) formAreas[key] = v;
    }
    const { components, correctionFiles, storeys } = caseComponents(c);
    out.push({
      caseRef: c.caseRef, documentId: c.documentId, filedOn: c.date, publicUrl: c.publicUrl ?? tasPublicUrl(c.documentId),
      nomenclature, stages, correctionFiles, storeys, components, acts, formAreas, conditionsOrders,
    });
  }
  return out.sort((a, b) => (a.filedOn ?? '9999').localeCompare(b.filedOn ?? '9999'));
}

/** The persisted records, read back defensively (UI and synthesis). */
export function readEvolution(v: unknown): CaseEvolution[] {
  if (!Array.isArray(v)) return [];
  const arr = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  const day = (x: unknown): string | null => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : null);
  const n = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  return (v as Array<Record<string, unknown>>).filter((c) => c && typeof c === 'object').map((c) => ({
    caseRef: str(c.caseRef) || null,
    documentId: str(c.documentId) || null,
    filedOn: day(c.filedOn),
    publicUrl: str(c.publicUrl) || null,
    nomenclature: arr<unknown>(c.nomenclature).map(str).filter(Boolean),
    stages: arr<unknown>(c.stages).map(str).filter(Boolean),
    correctionFiles: c.correctionFiles === true,
    storeys: n(c.storeys),
    components: arr<Record<string, unknown>>(c.components).map((k) => ({
      component: str(k?.component) as DrawingComponent,
      revisions: arr<unknown>(k?.revisions).map(day).filter((x): x is string => !!x),
      oldAndNew: k?.oldAndNew === true,
      files: arr<Record<string, unknown>>(k?.files).map((f) => ({ name: str(f?.name), url: str(f?.url) || null, date: day(f?.date) })).filter((f) => f.name),
    })).filter((k) => COMPONENT_RULES.some(([id]) => id === k.component)),
    acts: arr<Record<string, unknown>>(c.acts).map((a) => ({
      number: str(a?.number) || null,
      issuedOn: day(a?.issuedOn),
      publishedOn: day(a?.publishedOn),
      result: (['CONSENT', 'INTERMEDIATE', 'REFUSAL'] as const).find((r) => r === a?.result) ?? null,
      amends: a?.amends && typeof a.amends === 'object' && str((a.amends as Record<string, unknown>).number)
        ? { number: str((a.amends as Record<string, unknown>).number), date: day((a.amends as Record<string, unknown>).date) } : null,
      areaChanges: arr<Record<string, unknown>>(a?.areaChanges).map((x) => ({ key: str(x?.key) as AreaKey, from: n(x?.from), requested: n(x?.requested), fixed: n(x?.fixed) })).filter((x) => AREA_WORD.some(([, k]) => k === x.key)),
      summationError: a?.summationError === true,
      correctedProject: a?.correctedProject === true,
      permitIssued: a?.permitIssued === true,
      buildingType: str(a?.buildingType) || null,
      reasons: arr<unknown>(a?.reasons).map(str).filter((r) => NOTICE_REASONS.some((x) => x.id === r)),
      correctionQuotes: arr<unknown>(a?.correctionQuotes).map(str).filter(Boolean).slice(0, 2),
      permitTerms: arr<Record<string, unknown>>(a?.permitTerms).map((p) => ({ decisionNumber: str(p?.decisionNumber), until: day(p?.until) ?? '' })).filter((p) => p.decisionNumber && p.until),
      conditions: a?.conditions === true,
    })),
    conditionsOrders: arr<unknown>(c.conditionsOrders).map(str).filter((x) => /^\d{5,9}$/.test(x)),
    formAreas: Object.fromEntries(Object.entries(c.formAreas && typeof c.formAreas === 'object' ? (c.formAreas as Record<string, unknown>) : {})
      .filter(([k, x]) => AREA_WORD.some(([, key]) => key === k) && typeof x === 'number')) as Partial<Record<AreaKey, number>>,
  }));
}

/* ───────────────────────── Story layer ───────────────────────── */

export type StepKind = 'EARLY' | 'CONDITIONS' | 'DESIGN_APPROVED' | 'PERMIT' | 'DESIGN_CHANGE' | 'FIGURES_CORRECTED' | 'RETURNED' | 'PENDING';
export type StepStatus = 'APPROVED' | 'PERMIT' | 'CORRECTED' | 'RETURNED' | 'UNDER_REVIEW' | 'RESPONSE_UNREAD' | 'NO_DECISION_READ';

export interface StepEvidence {
  caseRef: string | null;
  url: string | null;
  filedOn: string | null;
  decisions: Array<{ number: string | null; date: string | null }>;
  files: FiledFile[];
}
export interface EvolutionStep {
  id: string;
  kind: StepKind;
  status: StepStatus;
  /** Filing date of the (first) application. */
  date: string | null;
  /** When the city decided, if it did. */
  decidedOn: string | null;
  title: string;
  /** What happened, in a sentence or two. */
  what: string;
  /** What was requested. */
  requested: string | null;
  /** The practical change. */
  changed: string | null;
  /** Whether it is final. */
  final: string;
  /** What it means for a buyer. */
  impact: string | null;
  /** What stays unverified. */
  unverified: string | null;
  /** Drawing sets filed, in words, with revision dates. */
  components: string[];
  evidence: StepEvidence[];
}
export interface StatusLine { key: 'CONSTRUCTION_ACTIVITY' | 'PHYSICAL_COMPLETION' | 'OFFICIAL_APPROVAL' | 'COMMISSIONING'; text: string }
export interface EvolutionView {
  /** Concrete discoveries that replace the general introduction, or null (use the approved copy). */
  discoveries: string | null;
  steps: EvolutionStep[];
  /** The latest approved documentation, and exactly which drawings it lacks on file. */
  latest: { date: string | null; text: string; missing: string | null; evidence: StepEvidence | null } | null;
  /** Applications still without a decision. */
  pending: EvolutionStep[];
  /** Applications the records list as pending whose published act shows a decision. */
  resolved: EvolutionStep[];
}

const COMPONENT_KA: Record<DrawingComponent, string> = {
  FACADES: 'ფასადები', PLANS: 'სართულების გეგმები', SECTIONS: 'ჭრილები', SITE_PLAN: 'გენერალური გეგმა', PHOTOMONTAGE: 'ფოტომონტაჟი',
  HEIGHT: 'სიმაღლის სქემა', STRUCTURE: 'კონსტრუქციული ნაწილი', GEOLOGY: 'გეოლოგიური კვლევა', EXPERTISE: 'საექსპერტო დასკვნები',
  ENGINEERING: 'საინჟინრო სქემები', SITE_PHOTOS: 'ადგილის ფოტოები', CONSTRUCTION_ORG: 'მშენებლობის ორგანიზების პროექტი',
  DEMOLITION: 'დემონტაჟის პროექტი', INSPECTION: 'ინსპექციის დოკუმენტი', FINE: 'ჯარიმის გადახდის ქვითრები', LANDSCAPING: 'გამწვანების პროექტი',
  TRANSPORT: 'სატრანსპორტო სქემა',
};
const DESIGN_SET: DrawingComponent[] = ['FACADES', 'PLANS', 'SECTIONS', 'SITE_PLAN', 'PHOTOMONTAGE'];
const AREA_KA: Record<AreaKey, string> = {
  residential: 'საცხოვრებელი ფართი', summer: 'საზაფხულო ფართი', auxiliary: 'დამხმარე ფართი', total: 'საერთო ფართი', office: 'საოფისე ფართი', commercial: 'კომერციული ფართი',
};

/** "2013 წლის 1 იანვრიდან" / "2014 წლის 1 იანვრამდე". */
export const kaFromDay = (iso: string | null): string | null => kaOfDay(iso)?.replace(/ს$/u, 'დან') ?? null;
export const kaUntilDay = (iso: string | null): string | null => {
  const g = kaOfDay(iso);
  if (!g) return null;
  return /ოს$/u.test(g) ? g.replace(/ს$/u, 'მდე') : g.replace(/ის$/u, 'ამდე');
};

const fmt = (n: number) => {
  const [i, f] = String(Math.round(n * 10) / 10).split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${f ? `.${f}` : ''}`;
};
const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** A component in words with its revision dates: "ფასადები (18.12.2025, 27.12.2025)". */
export function componentPhrase(c: FiledComponent): string {
  const revs = c.revisions.slice(-4);
  const more = c.revisions.length > 4 ? ` და კიდევ ${c.revisions.length - 4}` : '';
  const old = c.component === 'PHOTOMONTAGE' && c.oldAndNew ? ' (ძველი და ახალი ვერსია ერთად)' : '';
  return `${COMPONENT_KA[c.component]}${old}${revs.length ? ` (${revs.map(ddmm).join(', ')}${more})` : ''}`;
}
const listKa = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} და ${xs[xs.length - 1]}`);

interface ChronoDecision { number: string | null; date: string | null; outcome: string; effect: string | null; term: { from: string | null; until: string | null } | null; correctedProject?: boolean }
interface ChronoCase { caseRef: string | null; filedOn: string | null; stage: string; effect: string | null; decisions: ChronoDecision[]; unreadResponses: Array<{ number: string | null; publishedOn: string | null }>; deficiencyNotices: number }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const day = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

function readChrono(history: Record<string, unknown>): ChronoCase[] {
  const raw = Array.isArray(history.caseChronology) ? (history.caseChronology as Array<Record<string, unknown>>) : [];
  return raw.map((c) => ({
    caseRef: str(c?.caseRef) || null,
    filedOn: day(c?.filedOn),
    stage: str(c?.stage).toUpperCase(),
    effect: str(c?.effect) || null,
    decisions: (Array.isArray(c?.decisions) ? (c.decisions as Array<Record<string, unknown>>) : []).map((d) => {
      const t = obj(d?.term);
      return { number: str(d?.number) || null, date: day(d?.date), outcome: str(d?.outcome), effect: str(d?.effect) || null, term: d?.term ? { from: day(t.from), until: day(t.until) } : null, correctedProject: d?.correctedProject === true };
    }),
    unreadResponses: (Array.isArray(c?.unreadResponses) ? (c.unreadResponses as Array<Record<string, unknown>>) : []).map((u) => ({ number: str(u?.number) || null, publishedOn: day(u?.publishedOn) })),
    deficiencyNotices: Number(c?.deficiencyNotices) || 0,
  })).sort((a, b) => (a.filedOn ?? '9999').localeCompare(b.filedOn ?? '9999'));
}

/** The case's decided act, from the chronology or (when the chronology could not read it) its published text. */
function consentActs(ev: CaseEvolution | undefined): CaseActRecord[] {
  return (ev?.acts ?? []).filter((a) => a.result === 'CONSENT');
}

const isPermitDecision = (d: ChronoDecision) => d.outcome === 'PERMIT_ISSUED' || /PERMIT/.test(d.effect ?? '');
const isApprovalDecision = (d: ChronoDecision) => !isPermitDecision(d) && (d.outcome === 'APPROVED' || d.outcome === 'AMENDMENT_APPROVED' || /APPROVED/.test(d.effect ?? ''));
const isAmendedAct = (d: ChronoDecision) => d.outcome === 'ACT_AMENDED' || d.effect === 'ACT_AMENDED';

/** Pending applications the records list, minus those whose published act shows a decision. */
export function openApplications(history: unknown, evolution: unknown): Array<{ caseRef: string | null; date: string | null }> {
  const h = obj(history);
  const evo = readEvolution(evolution);
  const chrono = readChrono(h);
  const list = [
    ...(Array.isArray(h.pendingApplications) ? (h.pendingApplications as unknown[]) : []),
    ...(Array.isArray(obj(h.currentPosition).pending) ? (obj(h.currentPosition).pending as unknown[]) : []),
  ].map(obj);
  const seen = new Set<string>();
  const out: Array<{ caseRef: string | null; date: string | null }> = [];
  for (const p of list) {
    const ref = str(p.caseRef) || null;
    const k = ref ?? `${day(p.date)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (ref && resolvedByAct(ref, chrono, evo)) continue;
    out.push({ caseRef: ref, date: day(p.date) });
  }
  return out;
}

function resolvedByAct(ref: string, chrono: ChronoCase[], evo: CaseEvolution[]): boolean {
  const c = chrono.find((x) => x.caseRef === ref);
  if (c && c.stage === 'DECIDED') return true;
  const e = evo.find((x) => x.caseRef === ref);
  // The latest published act decides it: consent, or a refusal; a request for documents does not.
  const acts = [...(e?.acts ?? [])].sort((a, b) => (a.publishedOn ?? a.issuedOn ?? '').localeCompare(b.publishedOn ?? b.issuedOn ?? ''));
  const last = acts[acts.length - 1];
  return !!last && (last.result === 'CONSENT' || last.result === 'REFUSAL');
}

function areaSentence(changes: AreaChange[], summationError: boolean): string | null {
  const parts = changes
    .filter((c) => c.fixed !== null || c.requested !== null)
    .map((c) => {
      const to = c.fixed ?? c.requested!;
      return c.from !== null && c.from !== to ? `${AREA_KA[c.key]} ${fmt(c.from)} მ²-დან ${fmt(to)} მ²-მდე` : `${AREA_KA[c.key]} ${fmt(to)} მ²`;
    });
  if (!parts.length) return null;
  const differs = changes.filter((c) => c.fixed !== null && c.requested !== null && c.fixed !== c.requested);
  return [
    `დოკუმენტში დაფიქსირდა: ${listKa(parts)}.`,
    differs.length ? `ქალაქმა ${listKa(differs.map((c) => `${AREA_KA[c.key]} ${fmt(c.fixed!)} მ²-ით`))} განსაზღვრა, ნაცვლად მოთხოვნილი ${listKa(differs.map((c) => `${fmt(c.requested!)} მ²`))}-ისა.` : null,
    summationError ? 'ქალაქის თქმით, მიზეზი წინა დოკუმენტებში ფართობების არასწორი დაჯამება იყო.' : null,
  ].filter(Boolean).join(' ');
}

const reasonText = (ids: string[]) => NOTICE_REASONS.filter((r) => ids.includes(r.id)).map((r) => r.text);

export interface EvolutionInput {
  history: unknown;
  evolution: unknown;
  /** The developer's own statement about the works (projectSignals.developerStatus). */
  developerStatus?: { text: string; date: string | null } | null;
}

/**
 * The project's evolution as steps a buyer can follow. Null when neither the
 * chronology nor the persisted case records support one.
 */
export function evolutionView(input: EvolutionInput): EvolutionView | null {
  const h = obj(input.history);
  const chrono = readChrono(h);
  const evo = readEvolution(input.evolution);
  if (!chrono.length && !evo.length) return null;
  const refs = [...new Set([...chrono.map((c) => c.caseRef), ...evo.map((e) => e.caseRef)].filter((r): r is string => !!r))];
  const cases = refs.map((ref) => ({ ref, c: chrono.find((x) => x.caseRef === ref), e: evo.find((x) => x.caseRef === ref) }))
    .map((x) => ({ ...x, filedOn: x.c?.filedOn ?? x.e?.filedOn ?? null }))
    .sort((a, b) => (a.filedOn ?? '9999').localeCompare(b.filedOn ?? '9999'));
  const pendingRefs = new Set(openApplications(h, input.evolution).map((p) => p.caseRef).filter(Boolean) as string[]);
  const listedPending = new Set(
    [...(Array.isArray(h.pendingApplications) ? (h.pendingApplications as unknown[]) : [])].map(obj).map((p) => str(p.caseRef)).filter(Boolean),
  );

  const evidenceOf = (ref: string, c: ChronoCase | undefined, e: CaseEvolution | undefined, files?: FiledFile[]): StepEvidence => ({
    caseRef: ref,
    url: e?.publicUrl ?? null,
    filedOn: c?.filedOn ?? e?.filedOn ?? null,
    decisions: [
      ...(c?.decisions ?? []).map((d) => ({ number: d.number, date: d.date })),
      ...consentActs(e).filter((a) => !(c?.decisions ?? []).some((d) => d.number === a.number)).map((a) => ({ number: a.number, date: a.issuedOn ?? a.publishedOn })),
    ],
    files: (files ?? (e?.components ?? []).filter((k) => DESIGN_SET.includes(k.component)).flatMap((k) => k.files.slice(-2))).slice(0, 8),
  });
  const compsOf = (e: CaseEvolution | undefined, only?: DrawingComponent[]) => (e?.components ?? [])
    .filter((k) => !only || only.includes(k.component))
    .sort((a, b) => Object.keys(COMPONENT_KA).indexOf(a.component) - Object.keys(COMPONENT_KA).indexOf(b.component))
    .map(componentPhrase);

  const steps: EvolutionStep[] = [];
  let hadPermit = false;
  const pending: EvolutionStep[] = [];
  const resolved: EvolutionStep[] = [];
  let quiet: Array<{ ref: string; c?: ChronoCase; e?: CaseEvolution; filedOn: string | null }> = [];
  const flushQuiet = () => {
    if (!quiet.length) return;
    const first = quiet[0], last = quiet[quiet.length - 1];
    const comps = [...new Set(quiet.flatMap((q) => compsOf(q.e, ['FACADES', 'PLANS', 'SECTIONS', 'SITE_PLAN', 'PHOTOMONTAGE', 'SITE_PHOTOS'])))];
    const reasons = [...new Set(quiet.flatMap((q) => (q.e?.acts ?? []).flatMap((a) => reasonText(a.reasons))))];
    // A run with nothing to tell (no files named, no reason given) is not a step of the story.
    if (!comps.length && !reasons.length) {
      quiet = [];
      return;
    }
    const ya = yearOf(first.filedOn), yb = yearOf(last.filedOn);
    const span = ya && yb && ya !== yb ? `${ya}-${yb} წლებში` : ya ? `${ya} წელს` : 'ამ პერიოდში';
    const early = !steps.some((s) => s.kind === 'PERMIT' || s.kind === 'DESIGN_APPROVED');
    steps.push({
      id: `quiet-${first.ref}`,
      kind: reasons.length ? 'RETURNED' : 'EARLY',
      status: reasons.length ? 'RETURNED' : 'NO_DECISION_READ',
      date: first.filedOn,
      decidedOn: null,
      title: early ? 'პირველი ჩანაფიქრი' : reasons.length ? 'დაბრუნებული პროექტი' : quiet.length === 1 ? 'განაცხადი გადაწყვეტილების გარეშე' : 'განაცხადები გადაწყვეტილების გარეშე',
      what: `${span} ნაკვეთზე ${quiet.length === 1 ? 'ერთი განაცხადი' : `${quiet.length} განაცხადი`} შევიდა${comps.length ? `. ${quiet.length === 1 ? 'მას' : 'მათ'} ახლდა: ${listKa(comps)}` : ''}.`,
      requested: null,
      changed: reasons.length ? `ქალაქმა დოკუმენტაცია ხარვეზით დააბრუნა: ${listKa(reasons)}.` : null,
      final: reasons.length ? `${quiet.length === 1 ? 'ამ განაცხადით' : 'ამ განაცხადებით'} პროექტი არ დამტკიცებულა.` : `${quiet.length === 1 ? 'ამ განაცხადზე' : 'ამ განაცხადებზე'} საბოლოო გადაწყვეტილება წაკითხულ ჩანაწერებში არ ჩანს.`,
      impact: early ? 'ეს პროექტის ადრეული ეტაპია. ის აჩვენებს, რა იგეგმებოდა თავიდან, და არა იმას, რა აშენდა.' : null,
      unverified: comps.length ? 'ფაილების სახელები გვეუბნება, რა იყო წარდგენილი. მათი შინაარსი ამ ეტაპზე წაკითხული არ არის.' : null,
      components: comps,
      evidence: quiet.map((q) => evidenceOf(q.ref, q.c, q.e)),
    });
    quiet = [];
  };

  for (const { ref, c, e, filedOn } of cases) {
    const decisions = c?.decisions ?? [];
    const approval = decisions.filter(isApprovalDecision).pop();
    /* An application covering both stages ("პროექტის შეთანხმება" + "მშენებლობის ნებართვა")
       that the city granted issued the permit with the approval (job eeefada9, 7761945). */
    const bothStages = (e?.stages ?? []).some((x) => /მშენებლობის\s+ნებართვა/u.test(x)) && (e?.stages ?? []).some((x) => /პროექტის\s+შეთანხმება/u.test(x));
    const permit = decisions.filter(isPermitDecision).pop() ?? (approval && bothStages ? { ...approval, effect: /შეთანხმებული\s+პროექტის\s+ცვლილება/u.test((e?.nomenclature ?? []).join(' ')) ? 'PERMIT_FOR_CORRECTED_PROJECT' : 'PERMIT' } : undefined);
    const amended = decisions.filter(isAmendedAct).pop();
    const acts = consentActs(e);
    const amendAct = acts.find((a) => a.amends && a.areaChanges.length) ?? acts.find((a) => a.amends) ?? null;
    const decisionAct = (n: string | null | undefined) => (e?.acts ?? []).find((a) => a.number && a.number === n) ?? null;
    const nomen = (e?.nomenclature ?? []).join(' ');
    const changeOfApproved = /შეთანხმებული\s+პროექტის\s+ცვლილება/u.test(nomen) || !!e?.correctionFiles || (permit?.correctedProject ?? false) || /CORRECTED/.test(permit?.effect ?? '');
    const comps = compsOf(e, ['FACADES', 'PLANS', 'SECTIONS', 'SITE_PLAN', 'PHOTOMONTAGE', 'HEIGHT', 'DEMOLITION', 'CONSTRUCTION_ORG', 'SITE_PHOTOS', 'INSPECTION', 'FINE']);
    const reasons = [...new Set((e?.acts ?? []).flatMap((a) => reasonText(a.reasons)))];
    const quotes = [...new Set((e?.acts ?? []).flatMap((a) => a.correctionQuotes))].slice(0, 2);
    const isPending = pendingRefs.has(ref);
    const wasListedPending = listedPending.has(ref);

    /* figures corrected by an amending order (read from the act's own text) */
    if ((amended || amendAct) && amendAct) {
      flushQuiet();
      const when = amendAct.issuedOn ?? amendAct.publishedOn ?? amended?.date ?? null;
      const authority = (e?.acts ?? []).some((a) => a.result === 'INTERMEDIATE' && a.reasons.includes('AUTHORITY'));
      const step: EvolutionStep = {
        id: `figures-${ref}`,
        kind: 'FIGURES_CORRECTED',
        status: 'CORRECTED',
        date: filedOn,
        decidedOn: when,
        title: 'ფართობების მაჩვენებლების შესწორება',
        what: `${kaOnDay(filedOn) ?? ''} შეტანილი განაცხადით მოთხოვნილი იყო ${amendAct.amends?.date ? `${kaOfDay(amendAct.amends.date)} ` : 'ადრე გაცემულ '}ბრძანებაში ტექნიკურ-ეკონომიკური მაჩვენებლების ცვლილება. ${kaOnDay(when) ?? 'მოგვიანებით'} ქალაქმა მოთხოვნა დააკმაყოფილა.`.trim(),
        requested: authority ? 'ქალაქმა ჯერ განმცხადებლის უფლებამოსილების დამადასტურებელი დოკუმენტი მოითხოვა, შემდეგ კი მოთხოვნა არსებითად განიხილა.' : null,
        changed: areaSentence(amendAct.areaChanges, amendAct.summationError),
        final: 'ცვლილება ქალაქის ბრძანებით შევიდა. დანარჩენ ნაწილში წინა ბრძანება უცვლელი რჩება.',
        impact: 'ეს ცვლილება შენობის ფართობების ოფიციალურ მაჩვენებლებს ეხება, არა არქიტექტურულ გადაწყვეტას. ხელშეკრულებაში ბინის ფართი ბოლო შესწორებულ მაჩვენებლებს უნდა ეყრდნობოდეს.',
        unverified: 'ბრძანება შენობის საერთო მაჩვენებლებს ცვლის. რომელ ბინებს ან სართულებს ეხება ცვლილება, ტექსტიდან არ ჩანს.',
        components: [],
        evidence: [evidenceOf(ref, c, e, [])],
      };
      steps.push(step);
      if (wasListedPending) resolved.push(step);
      continue;
    }

    /* a permit (possibly for a corrected project) */
    if (permit) {
      flushQuiet();
      const act = decisionAct(permit.number);
      const type = act?.buildingType ?? null;
      const corrected = (/CORRECTED/.test(permit.effect ?? '') && (changeOfApproved || hadPermit)) || permit.correctedProject || changeOfApproved;
      const until = permit.term?.until ?? null;
      const recited = evo.flatMap((x) => x.acts).flatMap((a) => a.permitTerms).find((t) => t.decisionNumber === permit.number)?.until ?? null;
      const withDesign = !!approval || (e?.stages ?? []).some((s) => /პროექტის\s+შეთანხმება/u.test(s));
      steps.push({
        id: `permit-${ref}`,
        kind: corrected ? 'DESIGN_CHANGE' : 'PERMIT',
        status: 'PERMIT',
        date: filedOn,
        decidedOn: permit.date,
        title: corrected ? (withDesign ? 'შესწორებული პროექტი და ახალი ნებართვა' : 'ნებართვა შესწორებული პროექტისთვის') : (type && /ინდივიდუალური/u.test(type) ? 'პირველი ნებართვა: ინდივიდუალური სახლი' : 'მშენებლობის ნებართვა'),
        what: [
          `${kaOnDay(permit.date) ?? ''} ქალაქმა ${corrected ? (withDesign ? 'შეათანხმა შესწორებული პროექტი და ' : 'შესწორებული პროექტისთვის ') : ''}მშენებლობის ნებართვა გასცა${type ? `, ${type.replace(/სახლ$/u, 'სახლის').replace(/კომპლექს$/u, 'კომპლექსის')} პროექტისთვის` : ''}.`.trim(),
          permit.term?.from && until ? `მშენებლობის ვადა ${kaFromDay(permit.term.from)} ${kaUntilDay(until)} განისაზღვრა.` : null,
          !until && recited ? `მოგვიანებით გამოცემული აქტის თანახმად, ამ ნებართვით მშენებლობის ვადა ${kaUntilDay(recited)} (ჩათვლით) იყო განსაზღვრული.` : null,
        ].filter(Boolean).join(' '),
        requested: comps.length ? `განაცხადს ახლდა: ${listKa(comps)}.` : null,
        changed: [
          corrected ? `ნებართვა ცვლილებებით შესწორებულ პროექტზე გაიცა${hadPermit ? ' და წინა ნებართვას ანაცვლებს' : ''}.` : hadPermit ? 'ახალი ნებართვა წინა ნებართვას ანაცვლებს.' : null,
          ...quotes.map((q) => `ქალაქის შენიშვნაში ნათქვამია: „${q}“.`),
          reasons.length ? `განხილვისას ქალაქმა მიუთითა: ${listKa(reasons)}.` : null,
        ].filter(Boolean).join(' ') || null,
        final: 'ეს ქალაქის საბოლოო გადაწყვეტილებაა. ნებართვა მშენებლობის უფლებას იძლევა, მაგრამ არც დასრულებას ადასტურებს და არც ექსპლუატაციაში მიღებას.',
        impact: corrected ? 'ხელშეკრულებაში სასურველია მითითებული იყოს, პროექტის რომელ ვერსიას ეყრდნობა თქვენი ბინა.' : null,
        unverified: type && /ინდივიდუალური/u.test(type)
          ? 'ჩანაწერებიდან არ ჩანს, აშენდა თუ არა ეს სახლი. ეს ადრეული ნებართვა დღევანდელ პროექტს არ ეხება.'
          : (e?.components ?? []).some((k) => DESIGN_SET.includes(k.component)) ? 'ნახაზების ფაილები ჩამოთვლილია, მაგრამ მათი შინაარსი ამ ანგარიშში წინა ვერსიას არ შედარებია.' : null,
        components: comps,
        evidence: [evidenceOf(ref, c, e)],
      });
      hadPermit = true;
      continue;
    }

    /* a design or conditions approval */
    if (approval) {
      flushQuiet();
      const act = decisionAct(approval.number);
      // The building-use conditions (გაპი): the act says so, or a later case form names this order as them.
      const isConditions = !!act?.conditions || (!!approval.number && evo.some((x) => x.conditionsOrders.includes(approval.number!)));
      const demolitionOnly = !isConditions && (e?.components ?? []).some((k) => k.component === 'DEMOLITION') && !(e?.components ?? []).some((k) => DESIGN_SET.includes(k.component));
      steps.push({
        id: `approval-${ref}`,
        kind: isConditions ? 'CONDITIONS' : changeOfApproved ? 'DESIGN_CHANGE' : 'DESIGN_APPROVED',
        status: 'APPROVED',
        date: filedOn,
        decidedOn: approval.date,
        title: isConditions ? 'ნაკვეთის განაშენიანების პირობები' : demolitionOnly ? 'დემონტაჟის პროექტის შეთანხმება' : changeOfApproved ? 'შეთანხმებული პროექტის ცვლილება' : e?.storeys ? `${e.storeys}-სართულიანი სახლის პროექტი` : 'არქიტექტურული პროექტის შეთანხმება',
        what: isConditions
          ? `${kaOnDay(approval.date) ?? ''} ქალაქმა ნაკვეთის სამშენებლოდ გამოყენების პირობები დაამტკიცა. ეს განსაზღვრავს, რა ზომის შენობის აშენებაა შესაძლებელი.`.trim()
          : `${kaOnDay(approval.date) ?? ''} ქალაქმა ${demolitionOnly ? 'არსებული ნაგებობის დემონტაჟის პროექტი' : changeOfApproved ? 'ადრე შეთანხმებული პროექტის ცვლილება' : 'არქიტექტურული პროექტი'} შეათანხმა${e?.storeys && !changeOfApproved ? `. ფაილების მიხედვით, ეს ${e.storeys}-სართულიანი მრავალბინიანი საცხოვრებელი სახლია` : ''}.`.trim(),
        requested: comps.length ? `განაცხადს ახლდა: ${listKa(comps)}.` : null,
        changed: [
          ...quotes.map((q) => `ქალაქის შენიშვნაში ნათქვამია: „${q}“.`),
          reasons.length ? `განხილვისას ქალაქმა მიუთითა: ${listKa(reasons)}.` : null,
          (e?.components ?? []).some((k) => DESIGN_SET.includes(k.component) && k.revisions.length >= 3) ? 'ნახაზები განხილვის პროცესში რამდენჯერმე შესწორდა, სანამ ქალაქი პროექტს შეათანხმებდა.' : null,
        ].filter(Boolean).join(' ') || null,
        final: isConditions
          ? 'ეს ქალაქის გადაწყვეტილებაა. პირობები პროექტის საფუძველია, თავად კი არც პროექტს ამტკიცებს და არც მშენებლობის უფლებას იძლევა.'
          : 'ეს ქალაქის გადაწყვეტილებაა. შეთანხმებული პროექტი ნებართვის წინაპირობაა, თავად კი მშენებლობის უფლებას არ იძლევა.',
        impact: changeOfApproved ? 'ცვლილება შეიძლება ეხებოდეს გეგმარებას ან ფასადს. ღირს გარკვევა, ეხება თუ არა ის თქვენს ბინას.' : null,
        unverified: !isConditions && (e?.components ?? []).some((k) => DESIGN_SET.includes(k.component)) ? 'რა კონკრეტულად შეიცვალა ნახაზებში, ფაილების სახელებიდან ვერ დგინდება.' : null,
        components: comps,
        evidence: [evidenceOf(ref, c, e)],
      });
      continue;
    }

    /* still on file */
    if (isPending) {
      flushQuiet();
      const unread = c?.unreadResponses?.[c.unreadResponses.length - 1] ?? null;
      const montage = (e?.components ?? []).find((k) => k.component === 'PHOTOMONTAGE' && k.oldAndNew);
      const pcomps = compsOf(e, [...DESIGN_SET, 'HEIGHT']);
      const step: EvolutionStep = {
        id: `pending-${ref}`,
        kind: 'PENDING',
        status: unread ? 'RESPONSE_UNREAD' : 'UNDER_REVIEW',
        date: filedOn,
        decidedOn: null,
        title: 'განხილვაში მყოფი განაცხადი',
        what: `${kaOnDay(filedOn) ?? ''} შეტანილია ${/შეთანხმებული\s+პროექტის\s+ცვლილება/u.test(nomen) ? 'შეთანხმებული პროექტის ცვლილების' : 'ახალი'} განაცხადი.`.trim(),
        requested: pcomps.length
          ? `განაცხადს ახლავს: ${listKa(pcomps)}.${montage ? ' „ძველი“ და „ახალი“ ფოტომონტაჟის ერთად წარდგენა იმაზე მიუთითებს, რომ მოთხოვნა შენობის იერსახეს ეხება.' : ''}`
          : 'განაცხადის საგანი წაკითხულ ჩანაწერებში არ არის მითითებული.',
        changed: null,
        final: unread
          ? `${kaOnDay(unread.publishedOn) ?? 'მოგვიანებით'} ქალაქმა პასუხი გამოაქვეყნა. მისი შინაარსი წაკითხულ ჩანაწერებში არ ჩანს, ამიტომ შედეგი ამ ეტაპზე უცნობია.`
          : 'ქალაქის პასუხი ჯერ არ არის გამოქვეყნებული. სანამ გადაწყვეტილება არ მიიღება, მოქმედებს ბოლო დამტკიცებული პროექტი.',
        impact: 'სანამ გადაწყვეტილება არ მიიღება, ცვლილება მხოლოდ მოთხოვნაა. ჰკითხეთ გამყიდველს, რას ცვლის განაცხადი და ეხება თუ არა ის თქვენს ბინას.',
        unverified: 'რა კონკრეტულად იცვლება, ფაილების სახელებიდან ვერ დგინდება.',
        components: pcomps,
        evidence: [evidenceOf(ref, c, e)],
      };
      pending.push(step);
      continue;
    }

    quiet.push({ ref, c, e, filedOn });
    // A long silent run is broken by the next decided step; keep each run within a year or two.
    if (quiet.length > 1 && (yearOf(filedOn) ?? 0) - (yearOf(quiet[0].filedOn) ?? 0) > 1) {
      const lastOne = quiet.pop()!;
      flushQuiet();
      quiet = [lastOne];
    }
  }
  flushQuiet();

  /* the latest approved documentation */
  const approvedSteps = steps.filter((s) => s.status === 'APPROVED' || s.status === 'PERMIT');
  const latestDesign = [...approvedSteps].reverse().find((s) => s.kind !== 'CONDITIONS') ?? null;
  let latest: EvolutionView['latest'] = null;
  if (latestDesign) {
    const ref = latestDesign.evidence[0]?.caseRef ?? null;
    const e = evo.find((x) => x.caseRef === ref);
    const have = (e?.components ?? []).filter((k) => DESIGN_SET.includes(k.component));
    const missing = DESIGN_SET.filter((k) => !have.some((x) => x.component === k));
    const amendedLater = steps.filter((s) => s.kind === 'FIGURES_CORRECTED' && (s.decidedOn ?? '') > (latestDesign.decidedOn ?? ''));
    latest = {
      date: latestDesign.decidedOn,
      text: [
        `ბოლო დამტკიცებული საპროექტო დოკუმენტაცია ${kaOfDay(latestDesign.decidedOn) ?? 'ბოლო'} გადაწყვეტილებას ეყრდნობა.`,
        have.length ? `ამ განაცხადში შედის: ${listKa(have.map(componentPhrase))}.` : null,
        amendedLater.length ? `შემდეგ ${amendedLater.length === 1 ? 'ერთი ბრძანებით' : `${amendedLater.length} ბრძანებით`} მხოლოდ ფართობების მაჩვენებლები შესწორდა.` : null,
      ].filter(Boolean).join(' '),
      missing: e && e.components.length && missing.length ? `ამ განაცხადის ფაილებში ვერ ვნახეთ: ${listKa(missing.map((m) => COMPONENT_KA[m]))}. ისინი შეიძლება ადრინდელ განაცხადებში იყოს.` : null,
      evidence: latestDesign.evidence[0] ?? null,
    };
  }

  const designChanges = steps.filter((s) => s.kind === 'DESIGN_CHANGE').length;
  const figureFixes = steps.filter((s) => s.kind === 'FIGURES_CORRECTED').length;
  const firstPermit = steps.find((s) => s.status === 'PERMIT');
  const firstDesign = steps.find((s) => s.kind === 'DESIGN_APPROVED');
  const startYear = yearOf(steps[0]?.date ?? null);
  const discoveries = steps.length >= 3 && (designChanges || figureFixes)
    ? [
        startYear ? `ამ ნაკვეთის ოფიციალური ისტორია ${startYear} წლიდან იწყება${firstPermit && /ინდივიდუალური/u.test(firstPermit.title) ? `, როცა აქ ინდივიდუალური საცხოვრებელი სახლის ნებართვა გაიცა` : ''}.` : null,
        firstDesign && yearOf(firstDesign.decidedOn) ? `შენობის არქიტექტურული პროექტი ქალაქმა პირველად ${yearOf(firstDesign.decidedOn)} წელს შეათანხმა.` : null,
        designChanges ? `მას შემდეგ არქიტექტურული პროექტი ${designChanges}-ჯერ შეიცვალა და ყოველი ცვლილება ქალაქმა შეათანხმა.` : null,
        figureFixes ? `ფართობების მაჩვენებლები ცალკე ${figureFixes === 1 ? 'ერთი ბრძანებით' : `${figureFixes} ბრძანებით`} შესწორდა.` : null,
        pending.length ? `${pending.length === 1 ? 'ერთი განაცხადი' : `${pending.length} განაცხადი`} ჯერ გადაწყვეტილების გარეშეა.` : 'განხილვაში მყოფი განაცხადი, რომელსაც გადაწყვეტილება არ ჰქონდეს, ჩანაწერებში აღარ რჩება.',
        'ქვემოთ თითოეულ ეტაპს თანმიმდევრულად აგიხსნით და ვაჩვენებთ, რას ნიშნავს ის ბინის შეძენამდე.',
      ].filter(Boolean).join(' ')
    : null;

  if (!steps.length && !pending.length) return null;
  return { discoveries, steps, latest, pending, resolved };
}

/**
 * The four things a buyer must keep apart: construction activity, physical
 * completion, official approval and commissioning. Each line says what the
 * records establish and nothing more.
 */
export function statusLines(input: {
  audit: { date: string | null } | null;
  photoDates: string[];
  developerStatus: { text: string; date: string | null } | null;
  developerSays: string | null;
  permit: { date: string | null; until: string | null; corrected: boolean } | null;
  latestDesignDate: string | null;
  commissioned: boolean;
  registerUnderConstruction: { asOf: string | null } | null;
}): StatusLine[] {
  const out: StatusLine[] = [];
  const latestPhoto = [...input.photoDates].sort().pop() ?? null;
  out.push({
    key: 'CONSTRUCTION_ACTIVITY',
    text: input.audit
      ? `სამშენებლო სამუშაოები ოფიციალურად დადასტურებულია: მერიის აუდიტის წერილი, რომელიც ${kaOfDay(input.audit.date) ?? 'ამ'} შენიშვნაშია მოხსენიებული, მიმდინარე მშენებლობას აღწერს.`
      : latestPhoto
        ? `${kaOnDay(latestPhoto) ?? ''} ქალაქში წარდგენილ განაცხადს ადგილის ფოტოები ახლავს. ისინი ადგილის იმდროინდელ მდგომარეობას ასახავს და მშენებლობის ეტაპის ოფიციალური შეფასება არ არის.`.trim()
        : 'სამშენებლო სამუშაოების მიმდინარეობის ოფიციალური ჩანაწერი წაკითხულ დოკუმენტებში არ ჩანს. ეს არ ნიშნავს, რომ სამუშაოები არ მიმდინარეობს.',
  });
  out.push({
    key: 'PHYSICAL_COMPLETION',
    text: [
      input.developerSays ? `${input.developerSays} ეს დეველოპერის განცხადებაა და არა ოფიციალური აქტი.` : 'შენობის ფიზიკური დასრულების ოფიციალური ჩანაწერი არ ჩანს.',
      input.registerUnderConstruction ? `საჯარო რეესტრის ${kaOfDay(input.registerUnderConstruction.asOf) ?? ''} ამონაწერში შენობა ჯერ კიდევ მშენებარედაა აღრიცხული, რაც ექსპლუატაციაში მიღებამდე ჩვეულებრივი მდგომარეობაა.`.replace('  ', ' ') : null,
    ].filter(Boolean).join(' '),
  });
  out.push({
    key: 'OFFICIAL_APPROVAL',
    text: input.permit
      ? [
          `ბოლო ნებართვა ${kaOnDay(input.permit.date) ?? ''} გაიცა${input.permit.corrected ? ' შესწორებული პროექტისთვის' : ''}.`.replace('  ', ' '),
          input.permit.until ? `მისი ვადა ${kaOnDay(input.permit.until)} იწურება.` : 'ამ ნებართვის ვადა წაკითხულ ტექსტში არ ჩანს.',
          input.latestDesignDate && input.latestDesignDate !== input.permit.date ? `ბოლო შეთანხმებული პროექტი ${kaOfDay(input.latestDesignDate)} გადაწყვეტილებას ეყრდნობა.` : null,
        ].filter(Boolean).join(' ')
      : 'მოქმედი მშენებლობის ნებართვა წაკითხულ ჩანაწერებში არ ჩანს.',
  });
  out.push({
    key: 'COMMISSIONING',
    text: input.commissioned
      ? 'ქალაქის აქტით შენობა ექსპლუატაციაში მიღებულია.'
      : 'ექსპლუატაციაში მიღების აქტი ჩანაწერებში არ ჩანს. ეს ცალკე ოფიციალური ეტაპია, რომელსაც ვერც ნებართვა, ვერც ფოტოები და ვერც დეველოპერის განცხადება ვერ ჩაანაცვლებს.',
  });
  return out;
}
