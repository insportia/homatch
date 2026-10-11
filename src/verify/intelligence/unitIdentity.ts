/*
 * THE EXACT UNIT, ITS PARCEL, ITS BUILDING, ITS PROJECT — KEPT APART.
 *
 * Job 8ba97da9 (01.18.06.019.055.03.01.601): the NAPR extract HOMATCH itself
 * read names apartment N601, Krtsanisi St 6, block „ც“, floor 6, 94.10 m², its
 * owner and the extract date — and the report still said the exact unit was
 * "not independently verified", and treated the unit's own rights as if they
 * might be the parcel's. The flag came from the research model's identity
 * answer (exactUnit.verified), written before the registry was read and never
 * revisited.
 *
 * Here the identity is decided from official records only:
 *   - EXACT UNIT verified when the Service 176 register returned this exact
 *     cadastral code with a parsed extract (NAPR_EXTRACT), or an identity-bound
 *     Service 176 record for it (NAPR_RECORD). Verified evidence is never
 *     downgraded: a `verified: true` already present stays true.
 *   - PARENT PARCEL is the code's first five groups; land area and function
 *     are the parcel's, never the apartment's.
 *   - BUILDING is the code's building group plus the block label the
 *     registered address states.
 *   - PROJECT / DEVELOPER are research identity (marketing / public sources),
 *     labelled as such — never registry facts.
 *   - OWNERSHIP: the current owner as of the extract date, and every earlier
 *     owner an extract named, each with its own date.
 * Every field carries its scope, source and date.
 */

import { buildPropertyRegister, type PropertyRegister, type RegisterOwner } from './propertyRegister.ts';
import { parseCadastral } from './propertyIdentity.ts';

export type UnitVerificationBasis = 'NAPR_EXTRACT' | 'NAPR_RECORD' | 'PRIOR_VERIFIED';

export interface UnitVerification {
  verified: boolean;
  basis: UnitVerificationBasis | null;
  /** The official document's own date (extract preparation), when known. */
  evidenceDate: string | null;
}

export interface UnitIdentityModel {
  exactUnit: {
    code: string;
    scope: 'EXACT_UNIT';
    verified: boolean;
    basis: UnitVerificationBasis | null;
    registeredAddress: string | null;
    block: string | null;
    floor: string | null;
    apartment: string | null;
    areaSqm: number | null;
    underConstruction: boolean | null;
    /** Date of the official evidence (extract preparation). */
    evidenceDate: string | null;
    /** When HOMATCH observed the registry (search run). */
    observedAt: string | null;
  };
  parentParcel: { code: string; scope: 'PARENT_PARCEL'; landAreaSqm: number | null; landFunction: string | null; source: 'NAPR_EXTRACT' | 'CADASTRAL_CODE' } | null;
  building: { groupCode: string | null; block: string | null; scope: 'BUILDING'; source: 'CADASTRAL_CODE' | 'NAPR_EXTRACT' };
  project: { name: string | null; developer: string | null; address: string | null; source: 'RESEARCH_IDENTITY' } | null;
  ownership: {
    current: { owners: RegisterOwner[]; registeredOn: string | null; basis: string | null; asOf: string | null; source: 'NAPR_EXTRACT' } | null;
    history: Array<{ owners: RegisterOwner[]; registeredOn: string | null; basis: string | null; seenInExtractOf: string | null; source: 'NAPR_EXTRACT' }>;
  };
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : null);
const norm = (c: unknown) => String(c ?? '').trim();

function registerOf(report: unknown): PropertyRegister | null {
  try {
    return buildPropertyRegister(obj(report).browserOfficial);
  } catch {
    return null;
  }
}

/** The exact unit's code: the job's literal query wins, then exactUnit.code. */
function unitCodeOf(report: unknown, query?: string | null): string | null {
  const q = parseCadastral(query ?? null);
  if (q?.unit) return q.code;
  const u = parseCadastral(obj(obj(report).exactUnit).code ?? null);
  return u?.code ?? null;
}

/**
 * Whether an OFFICIAL record verifies the exact unit. Never downgrades: an
 * exactUnit already marked verified stays verified.
 */
export function unitVerification(report: unknown, query?: string | null, reg?: PropertyRegister | null): UnitVerification {
  const r = obj(report);
  const code = unitCodeOf(report, query);
  const prior = obj(r.exactUnit).verified === true;
  if (!code) return { verified: prior, basis: prior ? 'PRIOR_VERIFIED' : null, evidenceDate: null };
  const register = reg === undefined ? registerOf(report) : reg;
  if (register?.latest && norm(register.cadastralCode) === code) {
    return { verified: true, basis: 'NAPR_EXTRACT', evidenceDate: register.latest.issuedAt };
  }
  // Identity-bound Service 176 facts (service176Evidence.ts validates record ↔ document ↔ code).
  const facts = Array.isArray(r.service176Evidence) ? r.service176Evidence : [];
  const record = facts.some((f: any) => f?.field === 'CADCODE' && norm(f?.value) === code && (f?.provenance == null || norm(f.provenance.cadastralCode ?? code) === code));
  if (record) return { verified: true, basis: 'NAPR_RECORD', evidenceDate: null };
  return { verified: prior, basis: prior ? 'PRIOR_VERIFIED' : null, evidenceDate: null };
}

/** exactUnit with `verified` corrected from official records (never downgraded). */
export function effectiveExactUnit(report: unknown, query?: string | null, reg?: PropertyRegister | null): Record<string, any> | null {
  const r = obj(report);
  const eu = r.exactUnit && typeof r.exactUnit === 'object' ? (r.exactUnit as Record<string, any>) : null;
  if (!eu) return eu;
  const v = unitVerification(report, query, reg);
  if (!v.verified || eu.verified === true) return eu;
  return { ...eu, verified: true, verifiedBy: v.basis, ...(v.evidenceDate ? { evidenceDate: v.evidenceDate } : {}) };
}

const ADDRESS_FIELD = (r: Record<string, any>, code: string): string | null => {
  const facts = Array.isArray(r.service176Evidence) ? r.service176Evidence : [];
  const f = facts.find((x: any) => x?.field === 'ADDRESS' && (x?.provenance == null || norm(x.provenance.cadastralCode ?? code) === code));
  return str(f?.value);
};

/** Block / floor / apartment as the registered address prints them. */
export function addressParts(address: string | null): { block: string | null; floor: string | null; apartment: string | null } {
  const a = String(address ?? '');
  const block = a.match(/['"„“]\s*([\p{L}\d]{1,3})\s*['"“”]\s*ბლოკი/u)?.[1] ?? a.match(/ბლოკი\s*['"„“]?\s*([\p{L}\d]{1,3})/u)?.[1] ?? null;
  const floor = a.match(/სართული\s*(\d{1,3})/u)?.[1] ?? null;
  const apartment = a.match(/ბინა\s*(?:N|№|ნომერი)?\s*(\d{1,5})/u)?.[1] ?? null;
  return { block, floor, apartment };
}

export function buildUnitIdentity(report: unknown, query?: string | null): UnitIdentityModel | null {
  const r = obj(report);
  const code = unitCodeOf(report, query);
  if (!code) return null;
  const parts = parseCadastral(code)!;
  const reg = registerOf(report);
  const v = unitVerification(report, query, reg);
  const latest = reg?.latest && norm(reg.cadastralCode) === code ? reg.latest : null;
  const address = ADDRESS_FIELD(r, code);
  const ap = addressParts(address);
  const ri = obj(r.reconciledIdentity);
  const pp = obj(r.projectProfile);
  const projectName = str(pp.name) ?? str(ri.project);
  const developer = str(pp.developer) ?? str(ri.developer);
  const projectAddress = str(pp.address) ?? str(ri.address);
  const basisText = (b: unknown) => (b === 'PURCHASE' ? 'PURCHASE' : b === 'OTHER' ? 'OTHER' : null);

  return {
    exactUnit: {
      code,
      scope: 'EXACT_UNIT',
      verified: v.verified,
      basis: v.basis,
      registeredAddress: address,
      block: ap.block,
      floor: ap.floor,
      apartment: ap.apartment ?? parts.unit?.replace(/^0+/, '') ?? null,
      areaSqm: latest?.unitAreaSqm ?? null,
      underConstruction: latest ? latest.unitUnderConstruction : null,
      evidenceDate: latest?.issuedAt ?? v.evidenceDate,
      observedAt: reg?.observedAt ?? null,
    },
    parentParcel: parts.building
      ? { code: parts.parcel, scope: 'PARENT_PARCEL', landAreaSqm: latest?.landAreaSqm ?? null, landFunction: latest?.landFunction ?? null, source: latest ? 'NAPR_EXTRACT' : 'CADASTRAL_CODE' }
      : null,
    building: { groupCode: parts.building, block: ap.block, scope: 'BUILDING', source: ap.block ? 'NAPR_EXTRACT' : 'CADASTRAL_CODE' },
    project: projectName || developer || projectAddress ? { name: projectName, developer, address: projectAddress, source: 'RESEARCH_IDENTITY' } : null,
    ownership: {
      current: latest && latest.owners.length
        ? { owners: latest.owners, registeredOn: latest.ownershipRegisteredOn, basis: basisText(latest.ownershipBasis), asOf: latest.issuedAt, source: 'NAPR_EXTRACT' }
        : null,
      history: (reg?.history ?? [])
        .filter((h) => h.owners.length)
        .filter((h, i, all) => all.findIndex((x) => x.ownershipRegisteredOn === h.ownershipRegisteredOn && JSON.stringify(x.owners) === JSON.stringify(h.owners)) === i)
        .map((h) => ({ owners: h.owners, registeredOn: h.ownershipRegisteredOn, basis: basisText(h.ownershipBasis), seenInExtractOf: h.issuedAt, source: 'NAPR_EXTRACT' as const })),
    },
  };
}

/* ───────────────────────── the research report, corrected on read ───────────────────────── */

/*
 * "NO RESTRICTION IN THE CURRENT EVIDENCE (<job time>)" WAS NOT CURRENT.
 *
 * research-agent dated the rights statement with the moment the job finished
 * (8ba97da9: "2026-10-11T07:07:56Z") while the only document behind it is the
 * NAPR extract prepared on 2026-08-24. A register statement is as of its
 * extract — never as of when HOMATCH happened to look. The unit-scoped,
 * extract-dated sentence replaces the generic one, in the report's language.
 */
const RR_GENERIC: Record<string, RegExp> = {
  ka: /^მოძიებულ მიმდინარე მტკიცებულებაში \(.+\) არსებითი რეგისტრირებული შეზღუდვა არ გამოვლენილა\.$/u,
  en: /^No material registered restriction was identified in the current evidence retrieved at .+\.$/u,
  ru: /^В текущих полученных на .+ доказательствах существенных зарегистрированных ограничений не выявлено\.$/u,
  tr: /^.+ tarihinde alınan güncel kanıtlarda önemli bir kayıtlı kısıtlama tespit edilmedi\.$/u,
  ar: /^لم يتم تحديد أي قيد مسجل جوهري في الأدلة الحالية التي تم الحصول عليها في .+\.$/u,
  he: /^לא זוהתה הגבלה רשומה מהותית בראיות הנוכחיות שהתקבלו בתאריך .+\.$/u,
};

/** The report language from its own sentence's script (the statement is written in the job language). */
function scriptLanguage(text: string): string {
  if (/[\u10A0-\u10FF]/u.test(text)) return 'ka';
  if (/[\u0400-\u04FF]/u.test(text)) return 'ru';
  if (/[\u0600-\u06FF]/u.test(text)) return 'ar';
  if (/[\u0590-\u05FF]/u.test(text)) return 'he';
  if (/[ğışçöüİĞŞÇÖÜ]/u.test(text)) return 'tr';
  return 'en';
}

export const RR_EXTRACT_DATED: Record<string, (code: string, date: string) => string> = {
  en: (code, date) => `The public registry extract for cadastral unit ${code}, prepared on ${date}, lists no registered mortgage, tax lien, seizure/prohibition or debtor-registry entry. This is the position as of the extract date — request a fresh extract on the signing day.`,
  ka: (code, date) => `საკადასტრო ერთეულის ${code} საჯარო რეესტრის ამონაწერში (მომზადებულია ${date}) იპოთეკა, საგადასახადო გირავნობა, ყადაღა/აკრძალვა და მოვალეთა რეესტრის ჩანაწერი რეგისტრირებული არ არის. ეს ამონაწერის თარიღის მდგომარეობაა — ხელმოწერის დღეს ახალი ამონაწერი მოითხოვეთ.`,
  ru: (code, date) => `В выписке из публичного реестра по кадастровому объекту ${code}, подготовленной ${date}, не зарегистрированы ипотека, налоговый залог, арест/запрет и запись в реестре должников. Это положение на дату выписки — в день подписания запросите новую выписку.`,
  tr: (code, date) => `${code} kadastro birimi için ${date} tarihinde hazırlanan tapu sicili özetinde kayıtlı ipotek, vergi rehni, haciz/yasak veya borçlular sicili kaydı yok. Bu, özet tarihindeki durumdur — imza günü yeni bir özet isteyin.`,
  ar: (code, date) => `لا يتضمن مستخرج السجل العام للوحدة العقارية ${code}، المُعدّ بتاريخ ${date}، أي رهن عقاري أو رهن ضريبي أو حجز/منع أو قيد في سجل المدينين. هذا هو الوضع في تاريخ المستخرج — اطلبوا مستخرجًا جديدًا يوم التوقيع.`,
  he: (code, date) => `נסח הרישום הציבורי ליחידה הקדסטרית ${code}, שהוכן בתאריך ${date}, אינו כולל משכנתה, שעבוד מס, עיקול/איסור או רישום במרשם החייבים. זהו המצב נכון לתאריך הנסח — בקשו נסח עדכני ביום החתימה.`,
};

/**
 * The research report's identity and rights fields, corrected from the
 * official register: exactUnit.verified (never downgraded) and the rights
 * statement dated by its extract and scoped to the exact unit. Returns only
 * the fields it changes; an empty object when nothing applies.
 */
export function officialUnitOverlay(resultJson: unknown, query?: string | null): Record<string, any> {
  const r = obj(resultJson);
  const out: Record<string, any> = {};
  const reg = registerOf(resultJson);
  const eu = effectiveExactUnit(resultJson, query, reg);
  if (eu && eu !== r.exactUnit) out.exactUnit = eu;

  const code = unitCodeOf(resultJson, query);
  const latest = reg?.latest && code && norm(reg.cadastralCode) === code ? reg.latest : null;
  const rr = obj(r.rightsAndRestrictions);
  if (latest?.issuedAt && Object.keys(rr).length) {
    const date = latest.issuedAt.slice(0, 10);
    const scoped = { ...rr, asOf: latest.issuedAt, observedAt: rr.observedAt ?? rr.asOf ?? null, scope: { level: 'EXACT_UNIT', cadastralCode: code }, basis: 'REGISTRY_EXTRACT' };
    const clear = !reg!.currentMortgages.length && latest.taxLien === 'NONE' && latest.seizure === 'NONE' && latest.debtorRegistry === 'NONE';
    if (rr.status === 'NONE_FOUND_IN_CHECKED_SOURCE' && !clear) {
      // The extract lists a mortgage or a restriction: "none found" contradicts it.
      out.rightsAndRestrictions = { ...scoped, status: 'RESTRICTION_IDENTIFIED', statement: '' };
    } else if (rr.status === 'NONE_FOUND_IN_CHECKED_SOURCE' || (rr.status === 'NOT_CONFIRMED' && clear)) {
      const lang = Object.keys(RR_GENERIC).find((l) => RR_GENERIC[l].test(String(rr.statement ?? '').trim())) ?? scriptLanguage(String(rr.statement ?? ''));
      out.rightsAndRestrictions = { ...scoped, status: clear ? 'NONE_FOUND_IN_CHECKED_SOURCE' : rr.status, statement: (RR_EXTRACT_DATED[lang] ?? RR_EXTRACT_DATED.en)(code!, date) };
    } else {
      out.rightsAndRestrictions = scoped;
    }
  }
  return out;
}
