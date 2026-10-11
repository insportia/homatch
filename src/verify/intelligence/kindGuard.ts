/*
 * ONE APPROACH FOR EVERY KIND OF PROPERTY (owner, 2026-10-11, v7).
 *
 * "The same approach must work identically for ABSOLUTELY ALL Verify
 * reports, using our varied logic, differing by whether the property is a
 * parking space, a land parcel or an apartment."
 *
 * Production job dbf04e48 is a 12 m² parking space ("ავტოსადგომი N17",
 * level 1) in the Digomi building of jobs eeefada9. Its report spoke of
 * "თქვენი ბინა", compared it with five-room flats and told the buyer
 * "ბინის სამართლებრივი მდგომარეობა". The registry already said what it was
 * (propertyKind.ts); this module makes every deterministic layer use that:
 *
 *   subjectNoun          the Georgian noun for the subject, by grammatical
 *                        case: ბინა / ავტოსადგომი / მიწის ნაკვეთი / … An
 *                        apartment keeps the owner-approved wording byte for
 *                        byte.
 *   kindPromptBlock      the registry-verified kind, area and unit row, and
 *                        the writing rules for that kind, for the model.
 *   guardKindText /      after the model: a sentence that describes a
 *   guardReportForKind   non-apartment subject as an apartment (or gives a
 *                        parking space bedrooms, rooms, living comfort) is
 *                        removed. Sentences about the building's OTHER flats
 *                        ("თეთრი კარკასის ბინები", "მრავალბინიანი") stay.
 *                        Runs at build time and on every read
 *                        (registerEnrichment.withPropertyRegister), so a
 *                        stored report is read the same way. Idempotent.
 *   storyFitsKind        whether a stored story may be kept on rebuild.
 *   marketPlanForKind    a market chapter for the subject's own kind when
 *                        the stored market holds comparables of that kind;
 *                        otherwise one honest sentence, never a silent gap
 *                        and never an apartment market.
 *
 * Kinds that keep every apartment wording and are never guarded: APARTMENT,
 * and the unsettled ones (OTHER, AMBIGUOUS, UNKNOWN): the guard never acts
 * on a guess. Pure and deterministic; imported by the edge function and the
 * browser.
 */

import type { PropertyKind } from './propertyKind.ts';
import { sentences } from './propertyRegister.ts';

/* ───────────────────────── the noun ───────────────────────── */

export type NounGroup = 'APARTMENT' | 'PARKING' | 'LAND' | 'HOUSE' | 'COMMERCIAL' | 'OFFICE' | 'STORAGE' | 'PROPERTY';

/**
 * Grammatical forms of the subject noun (Georgian):
 *   nom    ბინა            gen   ბინის          dat   ბინას
 *   on     ბინაზე          in    ბინაში         plDat ბინებს
 *   label  the word printed before a registry number ("ბინა N4").
 */
export type NounCase = 'nom' | 'gen' | 'dat' | 'on' | 'in' | 'plDat' | 'label';

const FORMS: Record<NounGroup, Record<NounCase, string>> = {
  APARTMENT: { nom: 'ბინა', gen: 'ბინის', dat: 'ბინას', on: 'ბინაზე', in: 'ბინაში', plDat: 'ბინებს', label: 'ბინა' },
  PARKING: { nom: 'ავტოსადგომი', gen: 'ავტოსადგომის', dat: 'ავტოსადგომს', on: 'ავტოსადგომზე', in: 'ავტოსადგომში', plDat: 'ავტოსადგომებს', label: 'ავტოსადგომი' },
  LAND: { nom: 'მიწის ნაკვეთი', gen: 'მიწის ნაკვეთის', dat: 'მიწის ნაკვეთს', on: 'მიწის ნაკვეთზე', in: 'მიწის ნაკვეთში', plDat: 'მიწის ნაკვეთებს', label: 'ნაკვეთი' },
  HOUSE: { nom: 'სახლი', gen: 'სახლის', dat: 'სახლს', on: 'სახლზე', in: 'სახლში', plDat: 'სახლებს', label: 'სახლი' },
  COMMERCIAL: { nom: 'კომერციული ფართი', gen: 'კომერციული ფართის', dat: 'კომერციულ ფართს', on: 'კომერციულ ფართზე', in: 'კომერციულ ფართში', plDat: 'კომერციულ ფართებს', label: 'ფართი' },
  OFFICE: { nom: 'ოფისი', gen: 'ოფისის', dat: 'ოფისს', on: 'ოფისზე', in: 'ოფისში', plDat: 'ოფისებს', label: 'ოფისი' },
  STORAGE: { nom: 'სათავსო', gen: 'სათავსოს', dat: 'სათავსოს', on: 'სათავსოზე', in: 'სათავსოში', plDat: 'სათავსოებს', label: 'სათავსო' },
  PROPERTY: { nom: 'ქონება', gen: 'ქონების', dat: 'ქონებას', on: 'ქონებაზე', in: 'ქონებაში', plDat: 'მსგავს ობიექტებს', label: 'ერთეული' },
};

export function nounGroup(kind: unknown): NounGroup {
  switch (kind) {
    case 'APARTMENT': return 'APARTMENT';
    case 'PARKING': return 'PARKING';
    case 'LAND': return 'LAND';
    case 'PRIVATE_HOUSE': return 'HOUSE';
    case 'COMMERCIAL': return 'COMMERCIAL';
    case 'OFFICE': return 'OFFICE';
    case 'STORAGE': return 'STORAGE';
    default: return 'PROPERTY';
  }
}

/** The Georgian noun for the subject of the report, in the given case. */
export function subjectNoun(kind: PropertyKind | string | null | undefined | unknown, c: NounCase = 'nom'): string {
  return FORMS[nounGroup(kind)][c];
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});

/**
 * The kind the deterministic COPY is written for, from a synthesis payload.
 * A report with no registry kind (no extract, no registered address read)
 * keeps the approved apartment wording exactly as before: nothing is changed
 * on a guess. Otherwise the registry's kind (OTHER/AMBIGUOUS → ქონება).
 */
export function copyKindOf(synthesis: unknown): PropertyKind {
  const k = obj(obj(synthesis).propertyKind).kind;
  return typeof k === 'string' && k && k !== 'UNKNOWN' ? (k as PropertyKind) : 'APARTMENT';
}

/** True for a kind whose report must never describe the subject as an apartment. */
export function isGuardedKind(kind: unknown): boolean {
  return kind === 'PARKING' || kind === 'LAND' || kind === 'PRIVATE_HOUSE' || kind === 'COMMERCIAL' || kind === 'OFFICE' || kind === 'STORAGE';
}

/* ───────────────────────── i18n ───────────────────────── */

/** Noun slots in the bundle: verify_v7_noun_<group>_<slot> (scripts/verify-v7-kind-i18n-data.mjs). */
export type NounSlot = 'scope' | 'gen' | 'on';

/** True when the apartment copy (the original, owner-approved keys) applies unchanged. */
export function apartmentCopy(kind: unknown): boolean {
  return nounGroup(kind) === 'APARTMENT';
}

/** The bundle key of the subject noun for a slot, e.g. verify_v7_noun_parking_on. */
export function nounKey(kind: unknown, slot: NounSlot): string {
  return `verify_v7_noun_${nounGroup(kind).toLowerCase()}_${slot}`;
}

/**
 * Which bundle key to render and with which noun slot: the original key for
 * an apartment (byte-identical), its "_kind" variant with {{noun}} otherwise.
 */
const KIND_VARIANTS: Record<string, NounSlot | null> = {
  verify_v6s_legal_body: 'gen',
  verify_v6s_intro_body: 'gen',
  verify_v6s_materials_body: 'gen',
  verify_v3_reg_unit_mortgage: 'on',
  verify_v3_reg_parcel_security_note: 'on',
  verify_co_company_scope_note: 'on',
  vrx_identity_title: null,
  verify_v6s_pending_body: null,
};

export function kindCopyKey(baseKey: string, kind: unknown): { key: string; nounKey: string | null } {
  if (apartmentCopy(kind) || !(baseKey in KIND_VARIANTS)) return { key: baseKey, nounKey: null };
  const slot = KIND_VARIANTS[baseKey];
  return { key: `${baseKey}_kind`, nounKey: slot ? nounKey(kind, slot) : null };
}

/** t() through the kind: `kt(t, 'verify_v6s_legal_body', kind)`. */
export function kindT(t: (key: string, vars?: Record<string, string>) => string, baseKey: string, kind: unknown, vars: Record<string, string> = {}): string {
  const { key, nounKey: nk } = kindCopyKey(baseKey, kind);
  if (nk) return t(key, { ...vars, noun: t(nk) });
  // The apartment path calls t() exactly as before.
  return Object.keys(vars).length ? t(key, vars) : t(key);
}

/* ───────────────────────── for the model ───────────────────────── */

export interface KindUnitFacts {
  unitAreaSqm?: number | null;
  unitDescription?: string | null;
  unitItemText?: string | null;
  unitFloor?: string | null;
  unitNumber?: string | null;
  unitBlock?: string | null;
  landAreaSqm?: number | null;
  landFunction?: string | null;
}

interface KindLike {
  kind?: unknown;
  explanation?: unknown;
  basis?: Array<{ source?: unknown; text?: unknown }>;
}

const RULES: Record<string, string> = {
  APARTMENT: 'The subject is an APARTMENT. Write about the apartment as usual.',
  PARKING: [
    'The subject is a PARKING SPACE (ავტოსადგომი), not an apartment. Call it "ავტოსადგომი" everywhere.',
    'Never write ბინა/ბინის/ბინაზე/ბინაში about it, never mention bedrooms, rooms, living comfort, an apartment floor, a view or a layout.',
    'Write about the parking space itself: its registered number and level, its area, access (entry, ramp, lift, covered or open, as documented),',
    'ownership, mortgages and restrictions on it, and the building/project it belongs to. Sentences about the building\'s flats are about the building, never about this space.',
    'MARKET: an apartment\'s price per m² says nothing about a parking space. Use only parking comparables when marketIntelligence has them; otherwise say plainly that a comparable sample for parking spaces was not available.',
  ].join(' '),
  LAND: [
    'The subject is a LAND PLOT (მიწის ნაკვეთი). There is no unit and no building quality to describe.',
    'Never write ბინა/ბინის about it and never describe rooms, floors, finishes or living comfort.',
    'Write about the land area, its registered function/category, permitted use and development parameters when documented (K1/K2, height, zone), access, and the register.',
  ].join(' '),
  PRIVATE_HOUSE: [
    'The subject is a PRIVATE HOUSE (სახლი) with its land. Describe the house and the land separately (house area vs parcel area).',
    'Never call it ბინა (an apartment), never use the multi-apartment building template (block, floor N of a residential complex, neighbours\' flats).',
  ].join(' '),
  COMMERCIAL: [
    'The subject is a COMMERCIAL SPACE (კომერციული ფართი). Describe commercial use: frontage, access, permitted use, the building it sits in.',
    'Never call it ბინა, never use the residential template (bedrooms, rooms, living comfort, family life, schools as a selling point).',
  ].join(' '),
  OFFICE: [
    'The subject is an OFFICE (ოფისი). Describe office use: area, floor, access, the building and its services.',
    'Never call it ბინა, never use the residential template (bedrooms, rooms, living comfort, family life).',
  ].join(' '),
  STORAGE: [
    'The subject is a STORAGE ROOM (სათავსო). Describe it as storage: area, level, access, ownership and restrictions.',
    'Never call it ბინა, never mention bedrooms, rooms, living comfort or an apartment floor.',
  ].join(' '),
  OTHER: 'The register describes the subject without naming its kind (see unitDescription). Use the registry\'s own words; do not call it an apartment unless the registry does.',
  AMBIGUOUS: 'The registry\'s own wording points at different kinds (see propertyKind.explanation). Say so plainly in the snapshot: name both registry descriptions and that the kind should be confirmed in the contract. Never pick one silently and never call it an apartment as fact.',
};

/**
 * The system-prompt block for the subject's kind: the registry-verified kind,
 * its area and unit description, and the type-specific writing rules. Empty
 * when no registry evidence was read (UNKNOWN): nothing is asserted on a guess.
 */
export function kindPromptBlock(kind: KindLike | null | undefined, unit: KindUnitFacts | null | undefined = null): string {
  const k = typeof kind?.kind === 'string' ? kind.kind : '';
  if (!k || k === 'UNKNOWN' || !RULES[k]) return '';
  const u = unit ?? {};
  const facts = [
    `kind=${k}`,
    typeof u.unitAreaSqm === 'number' ? `unitAreaSqm=${u.unitAreaSqm}` : null,
    u.unitItemText ? `unitRow="${u.unitItemText}"` : u.unitDescription ? `unitDescription="${u.unitDescription}"` : null,
    u.unitNumber ? `number=${u.unitNumber}` : null,
    u.unitFloor ? `${k === 'PARKING' || k === 'STORAGE' ? 'level' : 'floor'}=${u.unitFloor}` : null,
    u.unitBlock ? `block=${u.unitBlock}` : null,
    k === 'LAND' || k === 'PRIVATE_HOUSE' ? (typeof u.landAreaSqm === 'number' ? `landAreaSqm=${u.landAreaSqm}` : null) : null,
    k === 'LAND' && u.landFunction ? `landFunction="${u.landFunction}"` : null,
  ].filter(Boolean).join(', ');
  const why = typeof kind?.explanation === 'string' && kind.explanation ? ` ${kind.explanation}` : '';
  return [
    `PROPERTY KIND — REGISTRY-VERIFIED (from the NAPR unit row and registered address, never from the cadastral code): ${facts}.${why}`,
    RULES[k],
    k === 'APARTMENT' ? '' : 'This overrides any section template: a section that only makes sense for an apartment is omitted.',
  ].filter(Boolean).join('\n');
}

/* ───────────────────────── after the model ───────────────────────── */

/** The subject named as an apartment: a singular form of ბინა as a whole word. */
const APT_SINGULAR = /(?<!\p{L})ბინ(?:ა|ის|ას|აზე|აში|ით|ად|ისთვის|იდან|ისა|ასა|ისას)(?!\p{L})/u;
/** A singular ბინა that is clearly another flat of the building, not the subject. */
const OTHER_FLAT = /(?:სხვა|მეზობ\p{L}*|ყველა|თითოეულ\p{L}*|დანარჩენ\p{L}*|(?:თეთრი|შავი|მწვანე)\s+კარკასის|ნიმუშ\p{L}*)\s+ბინ/u;
/** Any apartment word, plural included (market prose about apartment listings). */
const APT_ANY = /(?<!\p{L})ბინ(?:ა|ებ|ის|ას|აზე|აში|ით|ად)\p{L}*/u;
/** Rooms and bedrooms. */
const ROOMS = /(საძინებ|ოთახ|bedroom|\b\d+\s*-?\s*room\b)/iu;
/** Residential comfort as a quality of the subject. */
const COMFORT = /(საცხოვრებ\p{L}*\s+კომფორტ|ცხოვრებ\p{L}*\s+კომფორტ|საცხოვრებლად\s+(?:კომფორტ|მოსახერხ)|residential\s+comfort|living\s+comfort)/iu;
/** English apartment wording about the subject. */
const EN_APT = /\b(?:this|your|the)\s+(?:apartment|flat)\b/i;

function sentenceFitsKind(s: string, kind: string, section?: string): boolean {
  if (EN_APT.test(s)) return false;
  if (APT_SINGULAR.test(s) && !OTHER_FLAT.test(s)) return false;
  // The market section of a non-apartment subject: apartment listings are the wrong market.
  if (section === 'MARKET' && APT_ANY.test(s) && kind !== 'PRIVATE_HOUSE') return false;
  if (kind !== 'PRIVATE_HOUSE') {
    if (ROOMS.test(s)) return false;
    if (COMFORT.test(s)) return false;
  }
  return true;
}

/**
 * The text with every sentence that describes the subject as an apartment
 * removed (paragraphs kept). Unchanged for an apartment and for an unsettled
 * kind. `section` is the report section key the text belongs to.
 */
export function guardKindText(text: unknown, kind: unknown, section?: string): string {
  const t = typeof text === 'string' ? text : '';
  if (!t || !isGuardedKind(kind)) return t;
  const k = String(kind);
  return t
    .split(/\n{2,}/)
    .map((p) => {
      const parts = sentences(p);
      const kept = parts.filter((s) => sentenceFitsKind(s, k, section));
      return kept.length === parts.length ? p : kept.join(' ');
    })
    .filter((p) => p.trim())
    .join('\n\n');
}

/** True when the text says nothing that the kind forbids (nothing would be removed). */
export function textFitsKind(text: unknown, kind: unknown, section?: string): boolean {
  const t = typeof text === 'string' ? text : '';
  return guardKindText(t, kind, section) === t;
}

/** Whether stored story chapters can be kept for this kind (storyGuard.keepStoryOnRebuild). */
export function storyFitsKind(chapters: Array<{ body?: unknown; title?: unknown }> | null | undefined, kind: unknown): boolean {
  if (!isGuardedKind(kind)) return true;
  return (Array.isArray(chapters) ? chapters : []).every((c) => textFitsKind(c?.body, kind) && textFitsKind(c?.title, kind));
}

const guardList = (v: unknown, kind: unknown): unknown =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? guardKindText(x, kind) : x)).filter((x) => typeof x !== 'string' || x.trim()) : v;

/**
 * The report (synthesis.report) with the kind guard applied to every prose
 * field a customer reads. An item whose main text is entirely removed is
 * dropped; an apartment / unsettled kind returns the same object.
 */
export function guardReportForKind<T extends Record<string, any>>(report: T | null | undefined, kind: unknown): T | null | undefined {
  if (!report || typeof report !== 'object' || !isGuardedKind(kind)) return report;
  const g = (v: unknown, section?: string) => (typeof v === 'string' ? guardKindText(v, kind, section) : v);
  const out: Record<string, any> = { ...report };

  if (out.summary && typeof out.summary === 'object') {
    const s = { ...out.summary };
    if (typeof s.statement === 'string') s.statement = g(s.statement);
    if (Array.isArray(s.highlights)) {
      s.highlights = s.highlights
        .map((h: any) => (h && typeof h === 'object' ? { ...h, headline: g(h.headline), detail: g(h.detail) } : h))
        .filter((h: any) => !h || typeof h !== 'object' || (String(h.headline ?? '').trim() || String(h.detail ?? '').trim()));
    }
    out.summary = s;
  }
  if (Array.isArray(out.keyFindings)) {
    out.keyFindings = out.keyFindings
      .map((f: any) => (f && typeof f === 'object' ? { ...f, finding: g(f.finding), whyItMatters: g(f.whyItMatters) } : f))
      .filter((f: any) => !f || typeof f !== 'object' || String(f.finding ?? '').trim());
  }
  if (Array.isArray(out.sections)) {
    out.sections = out.sections
      .map((sec: any) => (sec && typeof sec === 'object' ? { ...sec, body: g(sec.body, String(sec.key ?? '').toUpperCase()) } : sec))
      .filter((sec: any) => !sec || typeof sec !== 'object' || String(sec.body ?? '').trim() || (Array.isArray(sec.metrics) && sec.metrics.length));
  }
  if (Array.isArray(out.attentionPoints)) {
    out.attentionPoints = out.attentionPoints
      .map((a: any) => (a && typeof a === 'object' ? { ...a, point: g(a.point), why: g(a.why) } : a))
      .filter((a: any) => !a || typeof a !== 'object' || String(a.point ?? '').trim());
  }
  if (Array.isArray(out.nextSteps)) {
    out.nextSteps = out.nextSteps
      .map((a: any) => (a && typeof a === 'object' ? { ...a, step: g(a.step), why: g(a.why) } : a))
      .filter((a: any) => !a || typeof a !== 'object' || String(a.step ?? '').trim());
  }
  if (typeof out.finalView === 'string') out.finalView = g(out.finalView);
  if (out.currentStatus && typeof out.currentStatus === 'object' && typeof out.currentStatus.statement === 'string') {
    out.currentStatus = { ...out.currentStatus, statement: g(out.currentStatus.statement) };
  }
  if (out.propertyStory && typeof out.propertyStory === 'object' && Array.isArray(out.propertyStory.chapters)) {
    out.propertyStory = {
      ...out.propertyStory,
      chapters: out.propertyStory.chapters
        .map((c: any) => (c && typeof c === 'object' ? { ...c, body: g(c.body) } : c))
        .filter((c: any) => !c || typeof c !== 'object' || String(c.body ?? '').trim()),
    };
  }
  if (Array.isArray(out.visualExplanations)) {
    out.visualExplanations = out.visualExplanations.map((v: any) => (v && typeof v === 'object'
      ? { ...v, what: g(v.what), interesting: g(v.interesting), buyerMeaning: g(v.buyerMeaning), uncertain: g(v.uncertain) }
      : v));
  }
  if (out.buyerAssessment && typeof out.buyerAssessment === 'object') out.buyerAssessment = guardAssessmentForKind(out.buyerAssessment, kind);
  return out as T;
}

/** The buyer assessment with the kind guard applied (narrative, lists, per-area lines). */
export function guardAssessmentForKind<T extends Record<string, any>>(a: T, kind: unknown): T {
  if (!a || typeof a !== 'object' || !isGuardedKind(kind)) return a;
  return {
    ...a,
    ...(typeof a.narrative === 'string' ? { narrative: guardKindText(a.narrative, kind) } : {}),
    ...(Array.isArray(a.strengths) ? { strengths: guardList(a.strengths, kind) } : {}),
    ...(Array.isArray(a.concerns) ? { concerns: guardList(a.concerns, kind) } : {}),
    ...(Array.isArray(a.checks) ? { checks: guardList(a.checks, kind) } : {}),
    ...(Array.isArray(a.synthesis)
      ? { synthesis: a.synthesis.map((x: any) => (x && typeof x === 'object' ? { ...x, text: guardKindText(x.text, kind) } : x)).filter((x: any) => !x || typeof x !== 'object' || String(x.text ?? '').trim()) }
      : {}),
  };
}

/* ───────────────────────── market ───────────────────────── */

/** The market-gate kind (marketHierarchy.PropertyKind) a registry kind is compared within, or null. */
export function marketKindFor(kind: unknown): 'APARTMENT' | 'PARKING' | 'COMMERCIAL' | 'HOUSE' | 'LAND' | null {
  switch (kind) {
    case 'APARTMENT': return 'APARTMENT';
    case 'PARKING': return 'PARKING';
    case 'PRIVATE_HOUSE': return 'HOUSE';
    case 'LAND': return 'LAND';
    case 'COMMERCIAL':
    case 'OFFICE': return 'COMMERCIAL';
    default: return null;
  }
}

export type KindMarketPlan =
  /** The market chapter exactly as for an apartment (apartment, or kind not settled). */
  | { mode: 'DEFAULT' }
  /** A market chapter built from comparables of the subject's own kind. */
  | { mode: 'MARKET'; marketKind: string; comparables: number }
  /** One honest sentence: no comparable sample of this kind (verify_v7_market_kind_none). */
  | { mode: 'NOTE'; noteKey: 'verify_v7_market_kind_none' };

/**
 * What the market chapter shows for this kind. A non-apartment subject gets a
 * market only when the stored market was gated to its own kind
 * (valuation.subjectKind) AND kept comparables of that kind; otherwise the
 * one honest sentence. Never an apartment market, never a fabricated value.
 */
export function marketPlanForKind(kind: unknown, market: unknown): KindMarketPlan {
  if (!isGuardedKind(kind)) return { mode: 'DEFAULT' };
  const m = obj(market);
  const mk = marketKindFor(kind);
  const gatedTo = obj(m.valuation).subjectKind ?? obj(obj(m.hierarchy).valuation).subjectKind ?? null;
  const comps = Array.isArray(obj(m.hierarchy).comparables) ? obj(m.hierarchy).comparables.length : 0;
  if (mk && gatedTo === mk && comps > 0) return { mode: 'MARKET', marketKind: mk, comparables: comps };
  return { mode: 'NOTE', noteKey: 'verify_v7_market_kind_none' };
}
