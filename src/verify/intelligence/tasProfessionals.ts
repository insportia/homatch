/*
 * THE PROJECT TEAM, AS THE MUNICIPAL CASE FILES NAME IT.
 *
 * The first team reader took whatever sat in a name cell, and job 220ed087
 * showed the result: a CV line ('"იმკ-91" მშენებელ-ინჟინერი. 2018 წლიდან …')
 * as the CONTRACTOR, a notarial clause fragment ("ს - დავით ხ… სანოტარო
 * წესით") as CO_ARCHITECT, and a bank advertising mortgages as a team member.
 * Meanwhile the newest case (AR11161121) names the chief architect, two
 * co-authors and five specialists with their exact assignments — none of
 * which reached the report.
 *
 * This reader recovers named professionals from the case form (label/value
 * pairs, with their section path), from case/attachment/motion text, and from
 * the case parties, with the role wording the document itself uses.
 *
 * Rules (owner, 2026-10-10):
 *   - a person is 2–4 name words, Georgian or Latin, nominative; never a
 *     fragment carrying notarial/legal wording, CV prose, an address or a
 *     number;
 *   - identity = the full normalised name. Two first names are two people
 *     (გოგა რეხვიაშვილი ≠ გიორგი რეხვიაშვილი);
 *   - `roleText` is the document's own wording; `group` is a normalisation
 *     for layout only. A specialist who assessed one thing (the adjacent
 *     building, the foundation) is that assessment's specialist — never
 *     promoted to "the project's structural designer";
 *   - a bank is never a team member;
 *   - personal ID numbers, phones and e-mails never leave (tasCaseSources).
 */

import { cleanParticipantName } from './tasIntelligence.ts';
import { readCaseSources, textSections, georgianLine, tasAttachmentUrl, type CaseSource } from './tasCaseSources.ts';

export type TeamGroup = 'DEVELOPER' | 'ARCHITECTURE' | 'STRUCTURAL' | 'GEOTECHNICAL' | 'LANDSCAPE' | 'CONSTRUCTION_ORG' | 'SAFETY' | 'OTHER';

export interface TeamRoleV2 {
  code: string;
  roleText: string;
  scope: string | null;
  caseRef: string | null;
  date: string | null;
  documentTitle: string | null;
  sourceUrl: string | null;
}

export interface TeamMemberV2 {
  name: string;
  kind: 'PERSON' | 'ORGANIZATION';
  group: TeamGroup;
  organization: string | null;
  roles: TeamRoleV2[];
  firstSeen: string | null;
  lastSeen: string | null;
  official: boolean;
}

/* ───────────────────────── names ───────────────────────── */

const ORG_FORM = /(?:^|[\s„"«(])(შპს|სს|ი\/მ|ააიპ|სსიპ|ა\(ა\)იპ|კს|სპს|llc|ltd|jsc|inc|gmbh|ооо|ао)(?=$|[\s„"«.,)])/iu;
export const BANK = /ბანკ|\bbank\b|банк/iu;

/** Vocabulary that is never part of a person's name. */
const NOT_A_NAME = /არქიტექტ|თანაავტორ|ავტორ|სპეციალისტ|შეფასებ|ექსპერტ|ინჟინერ|პროექტ|შენობ|ნაგებობ|კონსტრუქ|საძირკვ|ორგანიზ|გრაფიკ|უსაფრთხო|რეგულირ|სანოტარო|წესით|ნოტარ|მინდობილ|წარმომადგ|ქალაქ|ქუჩ|გამზირ|ნომერ|^ბინა$|სართულ|თბილის|საქართველ|მუნიციპალ|სამსახურ|დადგენილ|ბრძანებ|გადაწყვეტ|განცხადებ|ტელეფ|ფოსტ|მისამართ|დარგში|წლიდან|სერტიფიკ|ატესტ|ლიცენზ|კვ\.?მ|ფართ|ნაკვეთ|მიწის|დეველოპ|დამკვეთ|განმცხადებ|მესაკუთრ|ხელმოწერ|თარიღ|შპს|ბანკ|გეოლოგ|ლანდშაფტ|გამწვანებ|მშენებ|დოკუმენტ|ნახაზ|გეგმ|ფასად|ჭრილ|დანართ|რეესტრ|ლიფტ|სპეციალობ|კვალიფიკ|მენეჯერ|დირექტორ|ხელმძღვანელ|წევრ|თანამშრომ|ინსპექტ|ზედამხედველ|ექსპლუატაც|ნებართვ|შეთანხმებ|ცვლილებ|კორექტირ|რედაქცი|მოთხოვნ|ფორმა|ფორმის|სახელი|გვარი|ფიზიკური|იურიდიული|პირ$|architect|engineer|specialist|expert|project|building|street|notary|assessment|developer|bank|ltd|llc/iu;

/** Whole words that are never a name word (rules, building types, form words). */
const NOT_A_NAME_WORD = /^(?:წეს\S*|გამოყენებ\S*|მრავალბინ\S*|საცხოვრებ\S*|სახლი?|ობიექტ\S*|რეგლამენტ\S*|სტანდარტ\S*|კანონ\S*|სივრცე|კომპლექსი|ბლოკი|სართული|ნიშნული|მასშტაბი|სქემა|გეგმა|ჭრილი|ფასადი|შინაარსი|ბარათი|დასკვნა|ანგარიში|ხარისხი|დოქტორი|პროფესორი|აკადემიკოსი|კორესპონდენტი)$/u;
/** The reviewing authority (the city's architecture service) is never a team member. */
export const AUTHORITY = /მუნიციპალიტეტ|მერია|მერიის|სამსახურ|სამინისტრო|საკრებულო|სააგენტო|(?:^|\s)სსიპ(?:\s|$)|ministry|municipal|city\s+hall/iu;

function squash(s: string): string {
  return s.replace(/[ \s]+/g, ' ').trim();
}

/** A person's name as written, or null. */
export function asPersonName(raw: string): string | null {
  let v = squash(String(raw ?? '').replace(/[„“"«»()[\]]/g, ' '))
    .replace(/^(?:ბ-ნ|ბ-ნი|ქ-ნ|ქ-ნი|მr\.?|mrs?\.?|ms\.?|dr\.?)\s+/iu, '')
    .replace(/^[\s\-–—:;,.·•]+|[\s\-–—:;,.·•]+$/g, '');
  if (!v || /\d/.test(v)) return null;
  const cleaned = cleanParticipantName(v);
  if (!cleaned || ORG_FORM.test(cleaned)) return null;
  v = cleaned;
  const words = v.split(' ');
  if (words.length < 2 || words.length > 4) return null;
  const georgian = words.every((w) => /^[ა-ჿ][ა-ჿ-]*$/u.test(w));
  const latin = words.every((w) => /^[A-Z][a-zA-Z'’-]+$/.test(w));
  if (!georgian && !latin) return null;
  if (words.some((w) => w.length < 2 || NOT_A_NAME.test(w) || NOT_A_NAME_WORD.test(w))) return null;
  if (georgian) {
    // Nominative Georgian surnames end in a vowel (შათაშვილი, სორდია, ლეჟავა, მშვიდობაძე);
    // "ხაბულიანის" (genitive) is a clause fragment, not a name.
    // A given name may end in a consonant (დავით, ვასილ, დარეჯან); every later word must not.
    if (words.slice(1).some((w) => !/[აეიოუ]$/u.test(w))) return null;
    if (/(?:ის|სთვის|ში)$/u.test(words[0]) && words[0].length > 4) return null;
  }
  return v;
}

/** An organisation in a legal form, or null. */
export function asOrganizationName(raw: string): string | null {
  let v = squash(String(raw ?? '')
    .replace(/შ\.\s?პ\.\s?ს\.?/gu, 'შპს')
    .replace(/\(?\s*(?:ს\/კ|ს\/ნ|ს\.კ\.?|საიდ(?:\.|ენტიფიკაციო)?\s*კოდი|id)\s*:?\s*\d{9}\s*\)?/giu, ' ')
    .replace(/\(\s*\d{9}\s*\)/g, ' ')
    .replace(/[„“"«»”`]/g, '"'))
    .replace(/^[\s\-–—:;,.]+|[\s\-–—:;,.]+$/g, '');
  // A clause around the name ("… ნაცვლად - შპს „ქეი-ელ-გრუპი“-ის") is not
  // part of it: start at the legal form; a quoted name ends at its quote.
  const form = ORG_FORM.exec(v);
  if (form && form.index > 0) {
    const before = v.slice(0, form.index).trim();
    if (before && !/^"?[^\s"]{2,30}"?$/u.test(before)) v = v.slice(form.index).replace(/^[\s„"«(]+/u, '');
  }
  const quoted = /^((?:შპს|სს|ი\/მ|ააიპ|სსიპ|კს|სპს|llc|ltd|jsc|ооо|ао)\s*"[^"]{2,60}")/iu.exec(v);
  if (quoted) v = quoted[1];
  v = v.replace(/^[\s\-–—:;,.]+|[\s\-–—:;,.]+$/g, '');
  if (!ORG_FORM.test(v) || v.length > 80 || /\d{5,}/.test(v) || /[•]/.test(v) || AUTHORITY.test(v)) return null;
  const words = v.replace(/"/g, ' ').trim().split(/\s+/);
  if (words.length < 2 || words.length > 7) return null;
  if (/წლიდან|დარგში|წესით|სანოტარო|მისამართ|ქუჩ/iu.test(v)) return null;
  return v.replace(/"([^"]+)"/g, '„$1“').replace(/"/g, '').replace(/\s+/g, ' ').trim();
}

/** Identity key: kind + full normalised name. Never a surname alone. */
export function teamKey(kind: 'PERSON' | 'ORGANIZATION', name: string): string {
  const n = name
    .toLowerCase()
    .replace(/[„“"«»'`]/g, '')
    .replace(/(^|\s)(შპს|სს|ი\/მ|llc|jsc|ltd|ооо)(?=\s|$)/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${kind === 'ORGANIZATION' ? 'org' : 'person'}:${n}`;
}

/* ───────────────────────── roles ───────────────────────── */

const ROLE_WORD = /არქიტექტ|თანაავტორ|ავტორ|სპეციალისტ|ექსპერტ|შეფასებ|კონსტრუქტ|კონსტრუქციულ|ინჟინერ|გეოლოგ|გეოტექ|ლანდშაფტ|გამწვანებ|გრაფიკ|ორგანიზებ|უსაფრთხოებ|ხანძრ|დეველოპ|დამკვეთ|განმცხადებ|მშენებელ|კონტრაქტორ|ზედამხედველ|დიზაინ|საპროექტო|architect|engineer|specialist|expert|designer|developer|contractor|co-?author/iu;
/** A label that names a function but not its subject ("სპეციალისტი"). */
const GENERIC_ROLE = /^(?:სპეციალისტ(?:ი|ები)?|შემსრულებელ(?:ი|ები)?|ავტორ(?:ი|ები)?|ექსპერტ(?:ი|ები)?|specialist|expert|author)$/iu;
const SCOPE_WORD = /შეფასებ|ექსპერტიზ|საექსპერტო|გრაფიკ|პროექტ|კვლევ|გაანგარიშ|ნაწილ|რეგულირ|assessment|survey|schedule|design/iu;

export function roleCode(roleText: string, scope: string | null = null): { code: string; group: TeamGroup } {
  const t = `${roleText} ${scope ?? ''}`.toLowerCase();
  const assessment = /შეფასებ|ექსპერტ|ექსპერტიზ|assessment|expert/iu.test(t);
  // Named in a drawing's title block with no role printed beside the name:
  // recorded as exactly that, never promoted to a discipline.
  if (/ძირითად\s+წარწერ|title\s+block/iu.test(t)) return { code: 'DRAWING_TITLE_BLOCK', group: 'OTHER' };
  if (/მთავარი\s+არქიტექტ|chief\s+architect|lead\s+architect/iu.test(t)) return { code: 'CHIEF_ARCHITECT', group: 'ARCHITECTURE' };
  if (/თანაავტორ|co-?author/iu.test(t)) return { code: 'CO_AUTHOR', group: 'ARCHITECTURE' };
  if (/ლანდშაფტ|გამწვანებ|landscap/iu.test(t)) return { code: 'LANDSCAPE_SPECIALIST', group: 'LANDSCAPE' };
  if (/გეოლოგ|გეოტექ|geolog|geotech/iu.test(t)) return { code: assessment ? 'GEOTECHNICAL_EXPERT_ASSESSMENT' : 'GEOTECHNICAL_SURVEY', group: 'GEOTECHNICAL' };
  if (/მიმდებარე[^.]{0,40}(?:კონსტრუქც|მდგომარეობ)|adjacent\s+building/iu.test(t)) return { code: 'ADJACENT_BUILDING_STRUCTURAL_ASSESSMENT', group: 'STRUCTURAL' };
  if (/მშენებლობის\s+ორგანიზ|ორგანიზების\s+გრაფიკ|კალენდარულ|construction\s+(?:organi[sz]ation|schedule)/iu.test(t)) return { code: 'CONSTRUCTION_ORGANIZATION_SCHEDULE', group: 'CONSTRUCTION_ORG' };
  if (/კონსტრუქც|კონსტრუქტ|საძირკვ|structural|foundation/iu.test(t)) return { code: assessment ? 'STRUCTURAL_EXPERT_ASSESSMENT' : 'STRUCTURAL_DESIGNER', group: 'STRUCTURAL' };
  if (/უსაფრთხოებ|ხანძრ|safety|fire/iu.test(t)) return { code: 'SAFETY_ASSESSMENT', group: 'SAFETY' };
  if (/დეველოპ|developer|დამკვეთ|client|заказчик/iu.test(t)) return { code: 'DEVELOPER', group: 'DEVELOPER' };
  if (/განმცხადებ|applicant|заявител/iu.test(t)) return { code: 'APPLICANT', group: 'OTHER' };
  if (/მესაკუთრ|owner/iu.test(t)) return { code: 'LANDOWNER', group: 'OTHER' };
  if (/(?:არქიტექტურულ|საპროექტო)\S*\s+(?:ორგანიზ|კომპან|ბიურო|სტუდი)|architectural\s+(?:firm|organi[sz]ation|studio|bureau)/iu.test(t)) return { code: 'ARCHITECTURAL_ORGANIZATION', group: 'ARCHITECTURE' };
  if (/არქიტექტ|architect/iu.test(t)) return { code: 'ARCHITECT', group: 'ARCHITECTURE' };
  if (/ზედამხედველ|supervis/iu.test(t)) return { code: 'TECHNICAL_SUPERVISION', group: 'CONSTRUCTION_ORG' };
  if (/მშენებელ|კონტრაქტორ|contractor|builder/iu.test(t)) return { code: 'CONTRACTOR', group: 'CONSTRUCTION_ORG' };
  if (/ვენტილ|გათბობ|ელექტრ|წყალმომარაგ|კანალიზ|hvac|mep|electric|plumb/iu.test(t)) return { code: 'MEP_ENGINEER', group: 'OTHER' };
  if (/ინტერიერ|interior/iu.test(t)) return { code: 'INTERIOR_DESIGNER', group: 'OTHER' };
  if (assessment) return { code: 'EXPERT_ASSESSMENT', group: 'OTHER' };
  return { code: 'OTHER', group: 'OTHER' };
}

/** Georgian wording for a role a source gave only as a code. */
const ROLE_TEXT_KA: Record<string, string> = {
  APPLICANT: 'განმცხადებელი', CO_APPLICANT: 'თანაგანმცხადებელი', CLIENT: 'დამკვეთი', DEVELOPER: 'დეველოპერი', PARCEL_OWNER: 'მიწის ნაკვეთის მესაკუთრე',
  ARCHITECT: 'არქიტექტორი', CO_ARCHITECT: 'თანაავტორი', STRUCTURAL_ENGINEER: 'კონსტრუქტორი', GEOTECHNICAL_SPECIALIST: 'გეოლოგი',
  EXPERT_REVIEW: 'ექსპერტი', TECHNICAL_SUPERVISOR: 'ტექნიკური ზედამხედველი', CONTRACTOR: 'მშენებელი', MEP_ENGINEER: 'საინჟინრო სისტემების სპეციალისტი',
  LANDSCAPE_ARCHITECT: 'ლანდშაფტის არქიტექტორი', FIRE_SAFETY: 'ხანძარსაწინააღმდეგო უსაფრთხოების სპეციალისტი', SURVEYOR: 'ამზომველი',
  INTERIOR_DESIGNER: 'ინტერიერის დიზაინერი', OTHER: 'მონაწილე',
  DRAWING_TITLE_BLOCK: 'დასახელებულია ნახაზების ძირითად წარწერაში (როლი მითითებული არ არის)',
};
export function roleTextKa(code: string): string {
  return ROLE_TEXT_KA[code] ?? code;
}

/* ───────────────────────── extraction ───────────────────────── */

interface RawHit {
  name: string;
  kind: 'PERSON' | 'ORGANIZATION';
  roleText: string;
  scope: string | null;
  caseRef: string | null;
  date: string | null;
  documentTitle: string | null;
  sourceUrl: string | null;
  /** The firm the document names for this person (".ორგანიზაცია: შპს …" under them). */
  organization?: string | null;
}

/** Names in a value cell: "ა ბ, გ დ და ე ზ" → three candidates. */
function namesIn(value: string): Array<{ name: string; kind: 'PERSON' | 'ORGANIZATION' }> {
  const out: Array<{ name: string; kind: 'PERSON' | 'ORGANIZATION' }> = [];
  const org = asOrganizationName(value);
  if (org) return [{ name: org, kind: 'ORGANIZATION' }];
  for (const part of value.split(/[,;\n]|\s+და\s+|\s+and\s+/u)) {
    const p = part.replace(/\s*[–—-]\s.*$/u, '').trim();
    const o = asOrganizationName(p);
    if (o) { out.push({ name: o, kind: 'ORGANIZATION' }); continue; }
    const n = asPersonName(p);
    if (n) out.push({ name: n, kind: 'PERSON' });
  }
  return out;
}

const cleanRole = (s: string) => squash(s).replace(/^[\s\-–—:;,.·•\d)]+|[\s\-–—:;,.·•]+$/g, '');

/** The subject of a generic role, from the form path or the preceding heading. */
function scopeFrom(candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    if (!c) continue;
    const segs = c.split(/\s*(?:>|\/|›|»|\|)\s*/).map(cleanRole).filter(Boolean).reverse();
    for (const s of segs) if (SCOPE_WORD.test(s) && !GENERIC_ROLE.test(s) && s.length <= 160 && !/:/.test(s)) return s;
  }
  return null;
}

function hitsFromField(c: CaseSource, label: string, value: string, path: string | null): RawHit[] {
  const pathSegs = (path ?? '').split(/\s*(?:>|\/|›|»|\|)\s*/).map(cleanRole).filter(Boolean);
  let roleLabel = tidyRoleLabel(label);
  if (!ROLE_WORD.test(roleLabel)) {
    // "სახელი, გვარი" under a role heading: the role is the nearest role-ish path segment.
    const r = [...pathSegs].reverse().find((s) => ROLE_WORD.test(s));
    if (!r) return [];
    roleLabel = r;
  }
  const scope = GENERIC_ROLE.test(roleLabel) || /სპეციალისტ|ექსპერტ/iu.test(roleLabel) ? scopeFrom([path]) : null;
  const roleText = GENERIC_ROLE.test(roleLabel) && scope ? `${roleLabel}: ${scope}` : roleLabel;
  return namesIn(value).map((n) => ({
    ...n, roleText, scope: scope ?? (SCOPE_WORD.test(roleLabel) && !/^(?:მთავარი\s+)?არქიტექტორ/iu.test(roleLabel) ? roleLabel : null),
    caseRef: c.caseRef, date: c.date, documentTitle: c.title ?? c.docType, sourceUrl: c.publicUrl,
  }));
}

/** "ბ. გოგოლაური" — an initial and a surname, as a signature prints it; or a full name. */
export function asSignatureName(raw: string): string | null {
  const full = asPersonName(raw);
  if (full) return full;
  const m = /^\s*([ა-ჰ])\.\s*([ა-ჰ][ა-ჰ-]{2,})\s*$/u.exec(squash(String(raw ?? '')));
  if (!m || !/[აეიოუ]$/u.test(m[2]) || NOT_A_NAME.test(m[2]) || NOT_A_NAME_WORD.test(m[2])) return null;
  return `${m[1]}. ${m[2]}`;
}

/**
 * A form label as role wording: "მთავარი არქიტექტორის/სპეციალისტი სახელი და
 * გვარი" → "მთავარი არქიტექტორი/სპეციალისტი"; "დამკვეთ(ებ)ის სახელი და გვარი"
 * → "დამკვეთი". The field's name-and-surname suffix is not a role.
 */
export function tidyRoleLabel(s: string): string {
  return cleanRole(s)
    .replace(/\s*(?:სახელი\s*(?:,|და)?\s*გვარი|გვარი\s*(?:,|და)?\s*სახელი)\s*$/u, '')
    .replace(/\(ებ\)ის(?=$|[\s/,])/gu, 'ი')
    .replace(/არქიტექტორის(?=$|[\s/,])/gu, 'არქიტექტორი')
    .replace(/\s+/g, ' ')
    .replace(/[\s\-–—:;,.]+$/u, '')
    .trim();
}

/**
 * What a whole attachment is about, from its opening lines — the subject of a
 * signature or of a bare "ექსპერტი:" inside it. Fixed wording per kind so the
 * same document type always reads the same.
 */
const SECTION_SUBJECTS: Array<{ test: (t: string) => boolean; subject: string }> = [
  { test: (t) => /საინჟინრო[\s-]*გეოლოგიურ/u.test(t) && /საექსპერტო|ექსპერტიზ/u.test(t), subject: 'საინჟინრო-გეოლოგიური კვლევის საექსპერტო შეფასება' },
  { test: (t) => /უსაფრთხოების\s+წესებ/u.test(t) && /საექსპერტო|ექსპერტიზ|ექსპერტი/u.test(t), subject: 'შენობა-ნაგებობის უსაფრთხოების წესებთან შესაბამისობის საექსპერტო დასკვნა' },
  { test: (t) => /მშენებლობის\s+ორგანიზ/u.test(t), subject: 'მშენებლობის ორგანიზაციის პროექტი' },
  { test: (t) => /(?:მიმდებარე|მომიჯნავე)\s+შენობ/u.test(t) && /კონსტრუქც/u.test(t), subject: 'მიმდებარე შენობის კონსტრუქციული მდგომარეობის შეფასება' },
  { test: (t) => /საინჟინრო[\s-]*გეოლოგიურ/u.test(t), subject: 'საინჟინრო-გეოლოგიური კვლევა' },
];
function sectionSubject(opening: string): string | null {
  return SECTION_SUBJECTS.find((s) => s.test(opening))?.subject ?? null;
}

/** A CV starts: nothing after it is a project role (qualifications are not roles). */
const CV_START = /^(?:CV\b|C\.V\.|curriculum|ავტობიოგრაფ|რეზიუმე)|^დაბადების(?:\s+თარიღი)?\s*:?$|^განათლება\s*:?$/iu;
/** Signature verbs: "დაამუშავა: / ბ. გოგოლაური /". */
const SIGN_VERB = /^(?:დაამუშავა|შეასრულა|შეადგინა|მოამზადა|შეამოწმა)$/u;
/** A decision's clause naming a new client: "დამკვეთად X-ის ნაცვლად - შპს „Y“". */
const CLIENT_SUBSTITUTION = /დამკვეთად\s+[^.;:]{0,120}?\s+ნაცვლად\s*[-–—]?\s*(?:დაფიქსირდეს\s+)?((?:შპს|სს|ი\/მ)\s*[„"«][^“"»”„]{2,60}[“"»”])/gu;
/** A text holds at most this many lines for reading (the newest case runs ~30k). */
const MAX_TEXT_LINES = 120000;

/** A bare role label line in a title block ("პროექტის ავტორი", "არქიტექტორი"). */
function isRoleLabelLine(line: string): boolean {
  if (line.length > 40 || /\d|:/.test(line) || !ROLE_WORD.test(line)) return false;
  const words = line.split(' ');
  return words.length <= 4 && words.every((w) => w.length <= 14);
}

export interface TitleBlockCandidate {
  name: string;
  caseRef: string | null;
  meta: Omit<RawHit, 'name' | 'kind' | 'roleText' | 'scope'>;
}

/**
 * Free text, attachment by attachment: "role: Name", "Name — role",
 * "heading\nსპეციალისტი: Name", a title block's "label\nName", a signature
 * "verb: / Name /", and a decision's "client X → შპს „Y“" clause. Unlabelled
 * names that recur in a title block are collected for the second pass.
 */
function hitsFromText(c: CaseSource, t: CaseSource['texts'][number], titleBlock: TitleBlockCandidate[]): RawHit[] {
  const out: RawHit[] = [];
  let budget = MAX_TEXT_LINES;
  for (const sec of textSections(t.text)) {
    if (budget <= 0) break;
    const att = sec.fileName ? c.attachments.find((a) => a.fileName === sec.fileName) : undefined;
    const meta = {
      caseRef: c.caseRef,
      date: sec.date ?? t.date ?? c.date,
      documentTitle: sec.fileName ?? t.documentTitle ?? t.fileName ?? c.title,
      sourceUrl: (att?.attachedFileId ? tasAttachmentUrl(att.attachedFileId) : null) ?? t.sourceUrl ?? c.publicUrl,
    };
    const lines = sec.lines.slice(0, budget).flatMap((raw) => georgianLine(raw).replace(/\r/g, '').split(/(?<=[.;])\s+(?=[ა-ჿ]{3,}[^:\n]{0,80}:)/u)).map(squash).filter(Boolean);
    budget -= sec.lines.length;
    const subject = sec.fileName || t.fileName ? sectionSubject(lines.slice(0, 80).join(' ')) : null;

    // The new-client clause can wrap lines: read it on the joined text.
    const joined = lines.join(' ');
    for (const m of joined.matchAll(CLIENT_SUBSTITUTION)) {
      const org = asOrganizationName(m[1]);
      if (org) out.push({ name: org, kind: 'ORGANIZATION', roleText: 'დამკვეთი', scope: null, ...meta });
    }

    let heading: string | null = null;
    let headingAt = -99;
    let pending: string[] = [];
    let lastPeople: RawHit[] = [];
    let lastPeopleAt = -99;
    let labelledTitleBlock = false;
    const standalone: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (CV_START.test(line)) break;
      if (line.length > 400) { heading = null; pending = []; continue; }

      const sig = /^(.*?)[\s:]*\/\s*([^/]{3,40}?)\s*\/\s*$/u.exec(line);
      if (sig) {
        const name = asSignatureName(sig[2]);
        if (name) {
          const label = tidyRoleLabel(sig[1]);
          let roleText: string | null = null;
          if (SIGN_VERB.test(label)) roleText = subject ? `${label}: ${subject}` : null;
          else if (label && label.length <= 80 && ROLE_WORD.test(label)) roleText = GENERIC_ROLE.test(label) && subject ? `${label}: ${subject}` : label;
          else if (subject) roleText = `ხელმომწერი: ${subject}`;
          if (roleText) {
            out.push({ name, kind: 'PERSON', roleText, scope: subject, ...meta });
            pending = [];
            continue;
          }
        }
      }

      const colon = /^(.{2,160}?)\s*[:：]\s*(.{3,200})$/u.exec(line);
      if (colon && ROLE_WORD.test(colon[1]) && colon[1].split(/\s+/).length <= 8 && !/ნაცვლად|შეტანა|დაფიქსირ/u.test(colon[1])) {
        let roleLabel = tidyRoleLabel(colon[1]);
        let scope: string | null = null;
        // "მიმდებარე შენობის … შეფასება – სპეციალისტი: Name" on one line.
        const inline = /^(.*\S)\s*[–—-]\s*((?:სპეციალისტ|ექსპერტ|შემსრულებელ|ავტორ)\S*)$/u.exec(roleLabel);
        if (inline && SCOPE_WORD.test(inline[1])) { scope = cleanRole(inline[1]); roleLabel = inline[2]; }
        // A heading right above the line scopes it; otherwise the attachment's own subject does.
        if (!scope && GENERIC_ROLE.test(roleLabel)) scope = (i - headingAt <= 3 ? scopeFrom([heading]) : null) ?? subject ?? scopeFrom([heading]);
        const roleText = GENERIC_ROLE.test(roleLabel) && scope ? `${roleLabel}: ${scope}` : roleLabel;
        if (!scope && SCOPE_WORD.test(roleLabel) && !/არქიტექტორ|თანაავტორ/iu.test(roleLabel)) scope = roleLabel;
        const people: RawHit[] = [];
        for (const n of namesIn(colon[2])) {
          const h: RawHit = { ...n, roleText, scope, ...meta };
          out.push(h);
          if (n.kind === 'PERSON') people.push(h);
        }
        if (people.length && roleCode(roleText, scope).group === 'ARCHITECTURE') { lastPeople = people; lastPeopleAt = i; }
        heading = null;
        pending = [];
        continue;
      }
      // ".ორგანიზაცია (არსებობის შემთხვევაში).: შ.პ.ს. "…"" right under the architect.
      if (colon && /^ორგანიზაცია/u.test(cleanRole(colon[1])) && lastPeople.length && i - lastPeopleAt <= 3) {
        const org = asOrganizationName(colon[2]);
        if (org) {
          out.push({ name: org, kind: 'ORGANIZATION', roleText: 'საპროექტო ორგანიზაცია', scope: null, ...meta });
          for (const p of lastPeople) p.organization = org;
        }
        lastPeople = [];
        continue;
      }

      const dash = /^(.{4,70}?)\s+[–—-]\s+(.{3,180})$/u.exec(line);
      if (dash && ROLE_WORD.test(dash[2])) {
        const n = asOrganizationName(dash[1]) ? { name: asOrganizationName(dash[1])!, kind: 'ORGANIZATION' as const } : asPersonName(dash[1]) ? { name: asPersonName(dash[1])!, kind: 'PERSON' as const } : null;
        if (n) {
          const roleText = cleanRole(dash[2]);
          const generic = /^(?:სპეციალისტ\S*|ექსპერტ\S*)\s*:\s*(.+)$/u.exec(roleText);
          out.push({ ...n, roleText, scope: generic ? cleanRole(generic[1]) : SCOPE_WORD.test(roleText) && !/არქიტექტორ|თანაავტორ/iu.test(roleText) ? roleText : null, ...meta });
          pending = [];
          continue;
        }
      }

      // A title block: "პროექტის ავტორი" / "არქიტექტორი" / "დარეჯან შათაშვილი".
      const person = !colon ? asPersonName(line) : null;
      if (person) {
        if (pending.length) {
          const roleText = pending.join(', ');
          out.push({ name: person, kind: 'PERSON', roleText, scope: null, ...meta });
          if (roleCode(roleText).group === 'ARCHITECTURE') labelledTitleBlock = true;
        } else standalone.push(person);
        pending = [];
        continue;
      }
      if (!colon && isRoleLabelLine(line)) { pending = [...pending, tidyRoleLabel(line)].slice(-2); continue; }
      pending = [];
      // A heading line that may scope the next "სპეციალისტი: …".
      // A list item ("კ) …შეფასებას;") is not a heading.
      if (!colon && SCOPE_WORD.test(line) && line.length <= 160 && !/^[ა-ჰa-z]\)\s*/u.test(line)) { heading = line; headingAt = i; }
      else if (colon) heading = null;
    }
    if (labelledTitleBlock) for (const name of standalone) titleBlock.push({ name, caseRef: c.caseRef, meta });
  }
  return out;
}

function hitsFromParties(c: CaseSource): RawHit[] {
  const out: RawHit[] = [];
  for (const p of c.parties) {
    const kindOrg = p.kind === 'ORGANIZATION' || !!p.organizationId || ORG_FORM.test(p.name);
    const name = kindOrg ? asOrganizationName(p.name) ?? (cleanParticipantName(p.name) && ORG_FORM.test(p.name) ? cleanParticipantName(p.name) : null) : asPersonName(p.name);
    if (!name) continue;
    const roleText = /^[A-Z_]+$/.test(p.role) ? roleTextKa(p.role) : cleanRole(p.role) || 'მონაწილე';
    out.push({ name, kind: kindOrg ? 'ORGANIZATION' : 'PERSON', roleText, scope: null, caseRef: c.caseRef, date: c.date, documentTitle: c.title ?? c.docType, sourceUrl: c.publicUrl });
  }
  return out;
}

const GROUP_ORDER: TeamGroup[] = ['DEVELOPER', 'ARCHITECTURE', 'STRUCTURAL', 'GEOTECHNICAL', 'LANDSCAPE', 'CONSTRUCTION_ORG', 'SAFETY', 'OTHER'];
const CODE_ORDER = ['DEVELOPER', 'CHIEF_ARCHITECT', 'ARCHITECTURAL_ORGANIZATION', 'ARCHITECT', 'CO_AUTHOR'];

/** A member's group: its most specific documented role (OTHER only when nothing else). */
function groupOf(roles: Array<{ code: string; roleText: string; scope: string | null }>): TeamGroup {
  const groups = roles.map((r) => roleCode(r.roleText, r.scope).group);
  return GROUP_ORDER.find((g) => g !== 'OTHER' && groups.includes(g)) ?? 'OTHER';
}

/**
 * Merge raw hits into members: one per full name, every role kept with its
 * provenance; the same role from the same case once.
 */
export function mergeHits(hits: RawHit[]): TeamMemberV2[] {
  const byKey = new Map<string, TeamMemberV2>();
  for (const h of hits) {
    if (BANK.test(h.name) || (h.kind === 'ORGANIZATION' && AUTHORITY.test(h.name))) continue;
    const key = teamKey(h.kind, h.name);
    let m = byKey.get(key);
    if (!m) {
      m = { name: h.name, kind: h.kind, group: 'OTHER', organization: null, roles: [], firstSeen: null, lastSeen: null, official: true };
      byKey.set(key, m);
    }
    if (h.organization && h.kind === 'PERSON') m.organization = h.organization;
    const { code } = roleCode(h.roleText, h.scope);
    const dup = m.roles.find((r) => r.code === code && r.caseRef === h.caseRef && (r.scope ?? '') === (h.scope ?? ''));
    if (dup) {
      // Prefer the more specific wording, and a dated source.
      if (h.roleText.length > dup.roleText.length && !/^[A-Z_]+$/.test(h.roleText)) dup.roleText = h.roleText;
      continue;
    }
    if (m.roles.length < 12) m.roles.push({ code, roleText: h.roleText, scope: h.scope, caseRef: h.caseRef, date: h.date, documentTitle: h.documentTitle, sourceUrl: h.sourceUrl });
    if (h.date && (!m.firstSeen || h.date < m.firstSeen)) m.firstSeen = h.date;
    if (h.date && (!m.lastSeen || h.date > m.lastSeen)) m.lastSeen = h.date;
  }
  const out = [...byKey.values()];
  for (const m of out) {
    // A role without a subject is dropped when the same group is documented precisely.
    m.roles = m.roles.filter((r) => r.code !== 'OTHER' || m.roles.length === 1);
    m.roles.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    m.group = groupOf(m.roles);
  }
  return sortTeam(out);
}

export function sortTeam(list: TeamMemberV2[]): TeamMemberV2[] {
  const codeRank = (m: TeamMemberV2) => Math.min(...m.roles.map((r) => { const i = CODE_ORDER.indexOf(r.code); return i < 0 ? 99 : i; }), 99);
  return list.sort((a, b) =>
    GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
    || codeRank(a) - codeRank(b)
    || (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '')
    || a.name.localeCompare(b.name));
}

/** Every professional the TAS case files name, with documented roles and provenance. */
export function extractTasProfessionals(reportOrCases: unknown): TeamMemberV2[] {
  const cases: CaseSource[] = Array.isArray(reportOrCases) ? (reportOrCases as CaseSource[]) : readCaseSources(reportOrCases);
  const hits: RawHit[] = [];
  const titleBlock: TitleBlockCandidate[] = [];
  for (const c of cases) {
    hits.push(...hitsFromParties(c));
    for (const f of c.fields) hits.push(...hitsFromField(c, f.label, f.value, f.path));
    for (const t of c.texts) hits.push(...hitsFromText(c, t, titleBlock));
  }
  hits.push(...titleBlockHits(titleBlock, hits));
  return mergeHits(hits);
}

/**
 * A name printed in a drawing's title block with no role beside it (the
 * extracted text keeps the label for the author only). It is recorded — as
 * "named in the title block, role not stated" — only when it recurs in the
 * case's title blocks AND the same full name is documented elsewhere in the
 * case files; someone already documented in an architectural role in that
 * case gets nothing extra. A recurring label like "სატუმბი სივრცე" never
 * qualifies: it is documented nowhere else.
 */
function titleBlockHits(candidates: TitleBlockCandidate[], hits: RawHit[]): RawHit[] {
  const counts = new Map<string, { c: TitleBlockCandidate; n: number }>();
  for (const c of candidates) {
    const k = `${c.caseRef ?? ''}|${teamKey('PERSON', c.name)}`;
    const e = counts.get(k);
    if (e) e.n += 1;
    else counts.set(k, { c, n: 1 });
  }
  const known = new Set(hits.map((h) => teamKey(h.kind, h.name)));
  const out: RawHit[] = [];
  for (const { c, n } of counts.values()) {
    const key = teamKey('PERSON', c.name);
    if (n < 2 || !known.has(key)) continue;
    const architectHere = hits.some((h) => h.caseRef === c.caseRef && teamKey(h.kind, h.name) === key && roleCode(h.roleText, h.scope).group === 'ARCHITECTURE');
    if (architectHere) continue;
    out.push({ name: c.name, kind: 'PERSON', roleText: ROLE_TEXT_KA.DRAWING_TITLE_BLOCK, scope: null, ...c.meta });
  }
  return out;
}

/* ───────────────────────── the merged team ───────────────────────── */

const LEGACY_ROLE_CODE: Record<string, string> = {
  ARCHITECT: 'ARCHITECT', CO_ARCHITECT: 'CO_AUTHOR', STRUCTURAL_ENGINEER: 'STRUCTURAL_DESIGNER', GEOTECHNICAL_SPECIALIST: 'GEOTECHNICAL_SURVEY',
  EXPERT_REVIEW: 'EXPERT_ASSESSMENT', TECHNICAL_SUPERVISOR: 'TECHNICAL_SUPERVISION', CONTRACTOR: 'CONTRACTOR', MEP_ENGINEER: 'MEP_ENGINEER',
  LANDSCAPE_ARCHITECT: 'LANDSCAPE_SPECIALIST', FIRE_SAFETY: 'SAFETY_ASSESSMENT', SURVEYOR: 'OTHER', INTERIOR_DESIGNER: 'INTERIOR_DESIGNER',
  DEVELOPER: 'DEVELOPER', CLIENT: 'DEVELOPER', APPLICANT: 'APPLICANT', CO_APPLICANT: 'APPLICANT', PARCEL_OWNER: 'LANDOWNER', OTHER: 'OTHER',
};

/**
 * projectTeamV2: the TAS extraction first, then the consolidated official
 * participants (officialHistory.team) for people the extraction did not
 * recover, then what public research credits (official: false). One entry
 * per full name; a bank never appears; a coarse legacy role is not added to
 * someone the case files already describe precisely.
 */
export function buildProjectTeamV2(
  extracted: TeamMemberV2[],
  officialTeam: Array<{ name: string; kind?: string; roles: string[]; firstSeen?: string | null; lastSeen?: string | null }> | null | undefined,
  publicTeam: Array<{ name: string; roles: string[]; basis?: string; roleText?: string | null }> | null | undefined,
  max = 60,
): TeamMemberV2[] {
  const out = new Map<string, TeamMemberV2>();
  const find = (name: string): TeamMemberV2 | undefined => out.get(teamKey('PERSON', name)) ?? out.get(teamKey('ORGANIZATION', name));
  for (const m of extracted) if (!BANK.test(m.name) && !(m.kind === 'ORGANIZATION' && AUTHORITY.test(m.name))) out.set(teamKey(m.kind, m.name), { ...m, roles: [...m.roles] });

  for (const p of officialTeam ?? []) {
    const raw = String(p?.name ?? '');
    if (!raw || BANK.test(raw) || AUTHORITY.test(raw)) continue;
    const org = asOrganizationName(raw);
    const person = org ? null : asPersonName(raw);
    const name = org ?? person;
    if (!name) continue;
    const existing = find(name);
    if (existing) continue; // the case files already state this person's roles precisely
    const roles = (Array.isArray(p.roles) ? p.roles : []).map((r) => String(r)).filter((r) => r !== 'OTHER' || (p.roles ?? []).length === 1);
    const member: TeamMemberV2 = {
      name, kind: org ? 'ORGANIZATION' : 'PERSON', group: 'OTHER', organization: null,
      roles: roles.map((r) => ({ code: LEGACY_ROLE_CODE[r] ?? 'OTHER', roleText: roleTextKa(r), scope: null, caseRef: null, date: p.lastSeen ?? null, documentTitle: null, sourceUrl: null })),
      firstSeen: p.firstSeen ?? null, lastSeen: p.lastSeen ?? null, official: true,
    };
    if (!member.roles.length) continue;
    member.group = groupOf(member.roles);
    out.set(teamKey(member.kind, name), member);
  }

  for (const p of publicTeam ?? []) {
    const raw = String(p?.name ?? '').trim();
    if (!raw || BANK.test(raw) || AUTHORITY.test(raw) || BANK.test(String(p?.roleText ?? ''))) continue;
    if (p.basis === 'OFFICIAL') continue; // already covered by the official sources above
    const existing = find(raw);
    if (existing) continue;
    const isOrg = ORG_FORM.test(raw) || !asPersonName(raw);
    if (raw.length < 2 || raw.length > 80) continue;
    const roles = (Array.isArray(p.roles) ? p.roles : ['OTHER']).map((r) => ({
      code: LEGACY_ROLE_CODE[r] ?? 'OTHER', roleText: r === 'OTHER' && p.roleText ? String(p.roleText) : roleTextKa(r), scope: null, caseRef: null, date: null, documentTitle: null, sourceUrl: null,
    }));
    const member: TeamMemberV2 = { name: raw, kind: isOrg ? 'ORGANIZATION' : 'PERSON', group: 'OTHER', organization: null, roles, firstSeen: null, lastSeen: null, official: false };
    member.group = groupOf(member.roles);
    out.set(teamKey(member.kind, raw), member);
  }
  const list = sortTeam([...out.values()]);
  // Official members first within the bound; public credits fill what is left.
  return [...list.filter((m) => m.official), ...list.filter((m) => !m.official)].slice(0, max);
}
