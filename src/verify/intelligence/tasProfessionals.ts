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
import { readCaseSources, type CaseSource } from './tasCaseSources.ts';

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
  if (words.some((w) => w.length < 2 || NOT_A_NAME.test(w))) return null;
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
  const v = squash(String(raw ?? '')
    .replace(/\(?\s*(?:ს\/კ|ს\.კ\.?|საიდ(?:\.|ენტიფიკაციო)?\s*კოდი|id)\s*:?\s*\d{9}\s*\)?/giu, ' ')
    .replace(/\(\s*\d{9}\s*\)/g, ' ')
    .replace(/[„“"«»]/g, '"'))
    .replace(/^[\s\-–—:;,.]+|[\s\-–—:;,.]+$/g, '');
  if (!ORG_FORM.test(v) || v.length > 80 || /\d{5,}/.test(v)) return null;
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
  let roleLabel = cleanRole(label);
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

/** "role: Name", "Name — role", "heading\nსპეციალისტი: Name" in free text. */
function hitsFromText(c: CaseSource, t: CaseSource['texts'][number]): RawHit[] {
  const out: RawHit[] = [];
  const lines = t.text.replace(/\r/g, '').split(/\n|(?<=[.;])\s+(?=[ა-ჿ]{3,}[^:\n]{0,80}:)/u).map(squash).filter(Boolean);
  const meta = { caseRef: c.caseRef, date: t.date ?? c.date, documentTitle: t.documentTitle ?? t.fileName ?? c.title, sourceUrl: t.sourceUrl ?? c.publicUrl };
  let heading: string | null = null;
  for (const line of lines.slice(0, 4000)) {
    if (line.length > 400) { heading = null; continue; }
    const colon = /^(.{2,160}?)\s*[:：]\s*(.{3,200})$/u.exec(line);
    if (colon && ROLE_WORD.test(colon[1])) {
      let roleLabel = cleanRole(colon[1]);
      let scope: string | null = null;
      // "მიმდებარე შენობის … შეფასება – სპეციალისტი: Name" on one line.
      const inline = /^(.*\S)\s*[–—-]\s*((?:სპეციალისტ|ექსპერტ|შემსრულებელ|ავტორ)\S*)$/u.exec(roleLabel);
      if (inline && SCOPE_WORD.test(inline[1])) { scope = cleanRole(inline[1]); roleLabel = inline[2]; }
      if (!scope && GENERIC_ROLE.test(roleLabel)) scope = scopeFrom([heading]);
      const roleText = GENERIC_ROLE.test(roleLabel) && scope ? `${roleLabel}: ${scope}` : roleLabel;
      if (!scope && SCOPE_WORD.test(roleLabel) && !/არქიტექტორ|თანაავტორ/iu.test(roleLabel)) scope = roleLabel;
      for (const n of namesIn(colon[2])) out.push({ ...n, roleText, scope, ...meta });
      continue;
    }
    const dash = /^(.{4,70}?)\s+[–—-]\s+(.{3,180})$/u.exec(line);
    if (dash && ROLE_WORD.test(dash[2])) {
      const n = asOrganizationName(dash[1]) ? { name: asOrganizationName(dash[1])!, kind: 'ORGANIZATION' as const } : asPersonName(dash[1]) ? { name: asPersonName(dash[1])!, kind: 'PERSON' as const } : null;
      if (n) {
        const roleText = cleanRole(dash[2]);
        const generic = /^(?:სპეციალისტ\S*|ექსპერტ\S*)\s*:\s*(.+)$/u.exec(roleText);
        out.push({ ...n, roleText, scope: generic ? cleanRole(generic[1]) : SCOPE_WORD.test(roleText) && !/არქიტექტორ|თანაავტორ/iu.test(roleText) ? roleText : null, ...meta });
        continue;
      }
    }
    // A heading line that may scope the next "სპეციალისტი: …".
    heading = !colon && SCOPE_WORD.test(line) && line.length <= 160 ? line : colon ? null : heading;
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
    if (BANK.test(h.name)) continue;
    const key = teamKey(h.kind, h.name);
    let m = byKey.get(key);
    if (!m) {
      m = { name: h.name, kind: h.kind, group: 'OTHER', organization: null, roles: [], firstSeen: null, lastSeen: null, official: true };
      byKey.set(key, m);
    }
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
  for (const c of cases) {
    hits.push(...hitsFromParties(c));
    for (const f of c.fields) hits.push(...hitsFromField(c, f.label, f.value, f.path));
    for (const t of c.texts) hits.push(...hitsFromText(c, t));
  }
  return mergeHits(hits);
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
  for (const m of extracted) if (!BANK.test(m.name)) out.set(teamKey(m.kind, m.name), { ...m, roles: [...m.roles] });

  for (const p of officialTeam ?? []) {
    const raw = String(p?.name ?? '');
    if (!raw || BANK.test(raw)) continue;
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
    if (!raw || BANK.test(raw) || BANK.test(String(p?.roleText ?? ''))) continue;
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
