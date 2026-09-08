// synthesis.ts — the ONE final Verify synthesis.
//
// ARCHITECTURE (the same principle as the renovation engine)
// ----------------------------------------------------------
// A language model may choose WORDS. It may never choose FACTS.
//
// So synthesis is split in two:
//
//   1. This module builds a deterministic SynthesisPlan from normalized
//      evidence: which sections exist, which points belong in them, what is
//      confirmed, what conflicts, what is worth confirming, and why each
//      thing matters to a buyer. Same evidence in, same plan out.
//   2. A model renders that plan into friendly Georgian prose, constrained to
//      the points it was given.
//
// This is what makes "NO EVIDENCE = NO FACT" enforceable rather than
// aspirational: a point with no `evidence` cannot be constructed, so there is
// nothing for a model to embellish. It also means the synthesis genuinely
// reasons across the whole evidence set rather than concatenating per-source
// summaries — sections are assembled from facts, not from workers.

import type { CanonicalFact } from './evidence.ts';
import type { PropertyType } from './buyerPlan.ts';

export type SectionKey =
  | 'INTRO'
  | 'PROPERTY'
  | 'OWNERSHIP'
  | 'COMPANY'
  | 'PEOPLE'
  | 'PROFESSIONALS'
  | 'CONSTRUCTION'
  | 'PERMITS'
  | 'LOCATION'
  | 'MARKET'
  | 'PRICE'
  | 'CONFIRM'
  | 'ASSESSMENT'
  | 'MEANING'
  | 'NEXT';

export interface SynthesisPoint {
  /** Stable id so a rendered sentence can be traced back to its evidence. */
  key: string;
  /** The claim, in plain terms, with no engineering vocabulary. */
  statement: string;
  /** Why a buyer should care. Omitted when the fact speaks for itself. */
  matters?: string;
  /** Internal only — never rendered to the customer. */
  evidence: { source: string; documentRef: string | null }[];
  /** Marks a point the customer must be shown as unresolved. */
  conflict?: { alternative: unknown };
  /** True for an explicit negative finding ("nothing registered"). */
  negative?: boolean;
}

export interface SynthesisSection {
  key: SectionKey;
  title: string;
  points: SynthesisPoint[];
}

export interface SynthesisPlan {
  propertyType: PropertyType;
  sections: SynthesisSection[];
  /** Facts that disagree across sources — surfaced prominently, never merged. */
  conflicts: SynthesisPoint[];
  /** Things a buyer should confirm before paying. */
  toConfirm: SynthesisPoint[];
  /** Verdict is computed from PROPERTY RISK only. Technical gaps never move
   * it (a source being unavailable says nothing about the property). */
  verdict: 'POSITIVE' | 'MODERATELY_POSITIVE' | 'NEGATIVE';
  verdictReasons: string[];
  /** The prompt contract handed to the renderer. */
  renderContract: RenderContract;
}

export interface RenderContract {
  language: 'ka';
  /** The model may ONLY use these point keys. */
  allowedPointKeys: string[];
  rules: string[];
}

const SECTION_TITLES: Record<SectionKey, string> = {
  INTRO: 'მოკლედ',
  PROPERTY: 'ქონება',
  OWNERSHIP: 'საკუთრება და სამართლებრივი სურათი',
  COMPANY: 'დეველოპერი / კომპანია',
  PEOPLE: 'მფლობელები და ხელმძღვანელობა',
  PROFESSIONALS: 'პროექტის მონაწილეები',
  CONSTRUCTION: 'მშენებლობა',
  PERMITS: 'ნებართვები და სტატუსი',
  LOCATION: 'მდებარეობა',
  MARKET: 'ბაზრის კონტექსტი',
  PRICE: 'ფასი',
  CONFIRM: 'რისი გადამოწმება ღირს',
  ASSESSMENT: 'საერთო შეფასება',
  MEANING: 'რას ნიშნავს ეს თქვენთვის',
  NEXT: 'შემდეგი ნაბიჯები',
};

/** Which sections a property type can have, IN ORDER. A section with no
 * grounded points is dropped, so structure adapts to evidence rather than
 * forcing every property through the same template. */
const SECTION_ORDER: Record<PropertyType, SectionKey[]> = {
  DEVELOPER_APARTMENT: ['INTRO', 'PROPERTY', 'OWNERSHIP', 'COMPANY', 'PEOPLE', 'PROFESSIONALS', 'CONSTRUCTION', 'PERMITS', 'LOCATION', 'MARKET', 'PRICE', 'CONFIRM', 'ASSESSMENT', 'MEANING', 'NEXT'],
  PRIVATE_APARTMENT: ['INTRO', 'PROPERTY', 'OWNERSHIP', 'CONSTRUCTION', 'LOCATION', 'MARKET', 'PRICE', 'CONFIRM', 'ASSESSMENT', 'MEANING', 'NEXT'],
  PRIVATE_HOUSE: ['INTRO', 'PROPERTY', 'OWNERSHIP', 'CONSTRUCTION', 'PERMITS', 'LOCATION', 'MARKET', 'PRICE', 'CONFIRM', 'ASSESSMENT', 'MEANING', 'NEXT'],
  LAND: ['INTRO', 'PROPERTY', 'OWNERSHIP', 'PERMITS', 'LOCATION', 'MARKET', 'PRICE', 'CONFIRM', 'ASSESSMENT', 'MEANING', 'NEXT'],
  COMMERCIAL: ['INTRO', 'PROPERTY', 'OWNERSHIP', 'COMPANY', 'CONSTRUCTION', 'LOCATION', 'MARKET', 'PRICE', 'CONFIRM', 'ASSESSMENT', 'MEANING', 'NEXT'],
  UNKNOWN: ['INTRO', 'PROPERTY', 'OWNERSHIP', 'CONFIRM', 'ASSESSMENT', 'MEANING', 'NEXT'],
};

/** Fact type -> the section it belongs in. A fact with no mapping is kept in
 * evidence but never rendered, which is the safe direction to fail. */
const FACT_SECTION: Record<string, SectionKey> = {
  'property.kind': 'PROPERTY',
  'property.area': 'PROPERTY',
  'property.unitNumber': 'PROPERTY',
  'property.floor': 'PROPERTY',
  'property.address': 'PROPERTY',
  'ownership.owner': 'OWNERSHIP',
  'ownership.ownerType': 'OWNERSHIP',
  'ownership.coOwnership': 'OWNERSHIP',
  'encumbrance.mortgage': 'OWNERSHIP',
  'encumbrance.seizure': 'OWNERSHIP',
  'encumbrance.taxLien': 'OWNERSHIP',
  'encumbrance.debtorRegistry': 'OWNERSHIP',
  'company.name': 'COMPANY',
  'company.idCode': 'COMPANY',
  'company.registrationDate': 'COMPANY',
  'company.address': 'COMPANY',
  'company.status': 'COMPANY',
  'company.shareholder': 'PEOPLE',
  'company.director': 'PEOPLE',
  'project.architect': 'PROFESSIONALS',
  'project.engineer': 'PROFESSIONALS',
  'project.contractor': 'PROFESSIONALS',
  'project.designer': 'PROFESSIONALS',
  'construction.status': 'CONSTRUCTION',
  'construction.structure': 'CONSTRUCTION',
  'construction.facade': 'CONSTRUCTION',
  'construction.totalArea': 'CONSTRUCTION',
  'construction.floors': 'CONSTRUCTION',
  'permit.reference': 'PERMITS',
  'permit.date': 'PERMITS',
  'land.category': 'PERMITS',
  'land.k1': 'PERMITS',
  'land.k2': 'PERMITS',
  'land.k3': 'PERMITS',
  'location.district': 'LOCATION',
  'location.street': 'LOCATION',
  'market.askingRange': 'MARKET',
  'market.pricePerSqm': 'MARKET',
  'market.position': 'PRICE',
  'price.asking': 'PRICE',
  'price.historical': 'PRICE',
  'fx.context': 'PRICE',
};

/** Why a given kind of fact matters to a buyer. Kept here, deterministic, so
 * the explanation is never improvised. */
const WHY_IT_MATTERS: Record<string, string> = {
  'encumbrance.mortgage': 'ეს გავლენას ახდენს იმაზე, როგორ და როდის დარეგისტრირდება ქონება თქვენს სახელზე.',
  'encumbrance.seizure': 'რეგისტრირებული შეზღუდვა შეიძლება ხელს უშლიდეს გარიგების დასრულებას.',
  'ownership.owner': 'გამყიდველი და რეესტრში დაფიქსირებული მესაკუთრე ერთი და იგივე უნდა იყოს.',
  'ownership.coOwnership': 'თანამესაკუთრეობისას ყველა მესაკუთრის თანხმობაა საჭირო.',
  'company.shareholder': 'ვინ დგას კომპანიის უკან — ეს პროექტის სანდოობის ნაწილია.',
  'company.director': 'ხელმძღვანელობის უფლებამოსილება განსაზღვრავს, ვის შეუძლია ხელშეკრულების ხელმოწერა.',
  'construction.status': 'მშენებლობის ეტაპი პირდაპირ უკავშირდება ჩაბარების ვადას და რისკს.',
  'land.k2': 'კ2 განსაზღვრავს, რამდენი ფართის აშენებაა დაშვებული — ეს ნაკვეთის ღირებულების მთავარი ფაქტორია.',
  'market.position': 'გვიჩვენებს, ეს ფასი ბაზრის რომელ ნაწილშია.',
};

function pointFrom(fact: CanonicalFact, index: number): SynthesisPoint | null {
  if (!fact.evidence.length) return null; // NO EVIDENCE = NO FACT
  const key = `${fact.type}:${index}`;
  const subject = fact.subject ? `${fact.subject}: ` : '';
  const value = fact.negative ? 'არ არის რეგისტრირებული' : String(fact.value ?? '').trim();
  if (!value) return null;

  return {
    key,
    statement: `${subject}${value}`,
    matters: WHY_IT_MATTERS[fact.type],
    evidence: fact.evidence.map((e) => ({ source: e.source, documentRef: e.documentRef })),
    ...(fact.state === 'CONFLICTING' && fact.conflicting?.length
      ? { conflict: { alternative: fact.conflicting[0].value } }
      : {}),
    ...(fact.negative ? { negative: true } : {}),
  };
}

/**
 * Verdict from PROPERTY RISK ONLY.
 *
 * Technical conditions never move it. A blocked CAPTCHA, an unavailable
 * source or a worker failure says nothing about the property, and letting
 * them reduce a verdict would punish the buyer for our infrastructure.
 */
export function computeVerdict(facts: CanonicalFact[]): { verdict: SynthesisPlan['verdict']; reasons: string[] } {
  const reasons: string[] = [];
  let risk = 0;

  const active = (type: string) =>
    facts.find((f) => f.type === type && f.state !== 'UNAVAILABLE' && !f.negative && f.value);

  if (active('encumbrance.seizure')) {
    risk += 3;
    reasons.push('ქონებაზე რეგისტრირებულია ყადაღა/აკრძალვა');
  }
  if (active('encumbrance.taxLien')) {
    risk += 2;
    reasons.push('რეგისტრირებულია საგადასახადო გირავნობა');
  }
  if (active('encumbrance.debtorRegistry')) {
    risk += 2;
    reasons.push('მესაკუთრე ფიქსირდება მოვალეთა რეესტრში');
  }
  if (active('encumbrance.mortgage')) {
    risk += 1;
    reasons.push('ქონებაზე რეგისტრირებულია იპოთეკა');
  }
  if (facts.some((f) => f.state === 'CONFLICTING')) {
    risk += 1;
    reasons.push('ოფიციალურ წყაროებს შორის არის შეუსაბამობა');
  }

  const verdict = risk >= 3 ? 'NEGATIVE' : risk >= 1 ? 'MODERATELY_POSITIVE' : 'POSITIVE';
  if (!reasons.length) reasons.push('მნიშვნელოვანი სამართლებრივი შეზღუდვა არ დაფიქსირებულა');
  return { verdict, reasons };
}

const RENDER_RULES: string[] = [
  'დაწერე მარტივი, ბუნებრივი ქართულით, როგორც გამოცდილი სპეციალისტი უხსნის მყიდველს.',
  'გამოიყენე მხოლოდ მოწოდებული ფაქტები. ახალი ფაქტი არ დაამატო.',
  'არ დაიწყო შეფასებით — ჯერ ბუნებრივი შესავალი.',
  'არ გაიმეორო ერთი და იგივე ფაქტი რამდენჯერმე.',
  'არ ახსენო წყაროების ტექნიკური სახელები, დოკუმენტების იდენტიფიკატორები ან შიდა ტერმინოლოგია.',
  'სადაც ფაქტს აქვს მნიშვნელობა მყიდველისთვის — ახსენი რატომ.',
  'შეუსაბამობა აუცილებლად ახსენე, არ დამალო.',
  'თუ რამე არ დადასტურდა — თქვი მარტივად, დრამატიზაციის გარეშე.',
];

/**
 * Builds the plan. This is the whole synthesis: one pass over ALL normalized
 * evidence, producing one coherent structure — never a concatenation of
 * per-source summaries.
 */
export function buildSynthesisPlan(facts: CanonicalFact[], propertyType: PropertyType): SynthesisPlan {
  const bySection = new Map<SectionKey, SynthesisPoint[]>();
  const conflicts: SynthesisPoint[] = [];
  const toConfirm: SynthesisPoint[] = [];

  facts.forEach((fact, i) => {
    const section = FACT_SECTION[fact.type];
    if (!section) return; // unmapped facts stay internal
    const point = pointFrom(fact, i);
    if (!point) return;

    const list = bySection.get(section) ?? [];
    list.push(point);
    bySection.set(section, list);

    if (fact.state === 'CONFLICTING') conflicts.push(point);
    // An INFERRED fact, or one resting on a single source, is worth
    // confirming before money changes hands.
    if (fact.state === 'INFERRED' || (fact.sourceCount === 1 && WHY_IT_MATTERS[fact.type])) {
      toConfirm.push(point);
    }
  });

  const order = SECTION_ORDER[propertyType] ?? SECTION_ORDER.UNKNOWN;
  const sections: SynthesisSection[] = [];
  for (const key of order) {
    // Narrative sections carry no facts of their own; the renderer writes
    // them FROM the plan, so they are always present.
    const narrative = key === 'INTRO' || key === 'ASSESSMENT' || key === 'MEANING' || key === 'NEXT';
    const points = key === 'CONFIRM' ? toConfirm : bySection.get(key) ?? [];
    if (!narrative && points.length === 0) continue; // drop empty sections
    sections.push({ key, title: SECTION_TITLES[key], points });
  }

  const { verdict, reasons } = computeVerdict(facts);

  return {
    propertyType,
    sections,
    conflicts,
    toConfirm,
    verdict,
    verdictReasons: reasons,
    renderContract: {
      language: 'ka',
      allowedPointKeys: sections.flatMap((s) => s.points.map((p) => p.key)),
      rules: RENDER_RULES,
    },
  };
}

/**
 * Validates a rendered synthesis against its plan BEFORE it reaches a
 * customer. This is the grounding gate: a renderer that invents a fact, cites
 * an unknown point, or leaks internal vocabulary is rejected rather than
 * shown.
 */
export function validateRendering(
  plan: SynthesisPlan,
  rendered: { sectionKey: SectionKey; text: string; usedPointKeys: string[] }[]
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const allowed = new Set(plan.renderContract.allowedPointKeys);
  const planned = new Set(plan.sections.map((s) => s.key));

  for (const r of rendered) {
    if (!planned.has(r.sectionKey)) problems.push(`section not in plan: ${r.sectionKey}`);
    for (const k of r.usedPointKeys) {
      if (!allowed.has(k)) problems.push(`ungrounded point cited: ${k}`);
    }
    // Internal vocabulary must never surface.
    for (const banned of ['FSM', 'worker', 'orchestrator', 'CONFIRMED', 'CORROBORATED', 'json', 'idCode', 'enreg', 'rstax', 'TAS_MAP']) {
      if (r.text.includes(banned)) problems.push(`internal term "${banned}" in ${r.sectionKey}`);
    }
  }
  // Every conflict must actually be surfaced.
  const cited = new Set(rendered.flatMap((r) => r.usedPointKeys));
  for (const c of plan.conflicts) {
    if (!cited.has(c.key)) problems.push(`conflict omitted: ${c.key}`);
  }
  return { ok: problems.length === 0, problems };
}
