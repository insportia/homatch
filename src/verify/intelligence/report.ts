// HOMATCH — the Buyer Intelligence Report: parsing, grounding, fallback.
//
// The model writes the prose. This module decides whether the prose is
// allowed to reach a customer.
//
// The grounding contract is deliberately narrower than "did it cite
// something": a citation must resolve to evidence that actually exists in the
// package it was given. A model that cites `e99` when the package stops at
// `e40` has invented a source.
//
// WHAT CHANGED IN THIS VERSION
// ----------------------------
// The `unconfirmed` field is GONE. It was the structural cause of the report
// reading like an audit: give a model a field named after a deficit and it
// will fill it, prominently, every time. Incomplete checks now travel to the
// model as `turnTheseIntoAdvice` and come back as buyerActions — the same
// information, pointed forwards. The validator enforces the swap: if checks
// were incomplete and the model produced no actions at all, the output is
// rejected, because silently dropping them would read as "everything checks
// out".
//
// buyerActions also gained a `title`, because a list rendered as "1 2 3" is
// not a recommendation a person can scan.

import type { EvidencePackage, EvidenceItem } from './evidencePackage.ts';
import { SECTION_KEYS } from './prompt.ts';
import type { SectionKey } from './prompt.ts';

export type OverallLabel = 'POSITIVE' | 'MOSTLY_POSITIVE' | 'MIXED' | 'NEEDS_ATTENTION';

export interface ReportSection {
  key: SectionKey;
  title: string;
  body: string;
  cites: string[];
}

export interface AttentionPoint {
  point: string;
  why: string;
  cites: string[];
}

export interface BuyerAction {
  title: string;
  action: string;
  why: string;
  cites: string[];
}

export interface BuyerIntelligenceReport {
  overallView: { label: OverallLabel; statement: string };
  executiveSummary: string;
  sections: ReportSection[];
  attentionPoints: AttentionPoint[];
  buyerActions: BuyerAction[];
  finalView: string;
  contractUpload: { recommend: boolean; text: string };
  mode: 'MODEL' | 'DETERMINISTIC';
  rejectedBecause: string[];
  evidenceUsed: EvidenceItem[];
}

const LABELS: OverallLabel[] = ['POSITIVE', 'MOSTLY_POSITIVE', 'MIXED', 'NEEDS_ATTENTION'];

const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asCites = (v: unknown): string[] =>
  asArray(v).filter((x): x is string => typeof x === 'string');

/* ------------------------------------------------------------------ *
 * Parsing                                                             *
 * ------------------------------------------------------------------ */

export function parseReport(raw: string | null | undefined): Partial<BuyerIntelligenceReport> | null {
  if (!raw || typeof raw !== 'string') return null;
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;

  const ov = (p.overallView ?? {}) as Record<string, unknown>;
  const label = asString(ov.label).toUpperCase() as OverallLabel;

  const sections: ReportSection[] = [];
  for (const s of asArray(p.sections)) {
    const sec = (s ?? {}) as Record<string, unknown>;
    const key = asString(sec.key).toUpperCase() as SectionKey;
    const body = asString(sec.body);
    if (!SECTION_KEYS.includes(key) || !body) continue;
    sections.push({ key, title: asString(sec.title) || key, body, cites: asCites(sec.cites) });
  }

  const attentionPoints: AttentionPoint[] = asArray(p.attentionPoints)
    .map((a) => (a ?? {}) as Record<string, unknown>)
    .filter((a) => asString(a.point))
    .map((a) => ({ point: asString(a.point), why: asString(a.why), cites: asCites(a.cites) }));

  const buyerActions: BuyerAction[] = asArray(p.buyerActions)
    .map((a) => (a ?? {}) as Record<string, unknown>)
    .filter((a) => asString(a.action))
    .map((a) => ({
      title: asString(a.title),
      action: asString(a.action),
      why: asString(a.why),
      cites: asCites(a.cites),
    }));

  const cu = (p.contractUpload ?? {}) as Record<string, unknown>;

  return {
    overallView: {
      label: LABELS.includes(label) ? label : 'MIXED',
      statement: asString(ov.statement),
    },
    executiveSummary: asString(p.executiveSummary),
    sections,
    attentionPoints,
    buyerActions,
    finalView: asString(p.finalView),
    contractUpload: { recommend: cu.recommend !== false, text: asString(cu.text) },
  };
}

/* ------------------------------------------------------------------ *
 * The grounding gate                                                  *
 * ------------------------------------------------------------------ */

export function validateReport(
  pkg: EvidencePackage,
  candidate: Partial<BuyerIntelligenceReport> | null
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!candidate) return { ok: false, problems: ['model output was not parseable JSON'] };

  const known = new Set(pkg.items.map((i) => i.id));
  const checkCites = (cites: string[], where: string): void => {
    for (const c of cites) {
      if (!known.has(c)) problems.push(`ungrounded citation ${c} in ${where}`);
    }
  };

  if (!asString(candidate.executiveSummary)) problems.push('no executive summary');
  if (!candidate.sections?.length) problems.push('no sections');

  for (const s of candidate.sections ?? []) {
    checkCites(s.cites, `section ${s.key}`);
    // A section of property prose that cites nothing is exactly the failure
    // mode this gate exists for: fluent, specific, and unsupported.
    if (!s.cites.length && s.body.length > 240) {
      problems.push(`section ${s.key} makes substantial claims with no citation`);
    }
  }
  for (const a of candidate.attentionPoints ?? []) checkCites(a.cites, 'attentionPoints');
  for (const a of candidate.buyerActions ?? []) checkCites(a.cites, 'buyerActions');

  // Incomplete checks must resurface as advice. Dropping them silently would
  // read to a buyer as "we checked everything and it was fine".
  if (pkg.unavailable.length && !(candidate.buyerActions ?? []).length) {
    problems.push('checks were incomplete but the report offered no next steps');
  }

  // A numbered list with no labels is what this replaced.
  for (const a of candidate.buyerActions ?? []) {
    if (!a.title) problems.push('a buyer action has no title');
  }

  return { ok: problems.length === 0, problems };
}

/* ------------------------------------------------------------------ *
 * The deterministic fallback                                          *
 * ------------------------------------------------------------------ */

const SECTION_FOR: Partial<Record<EvidenceItem['category'], SectionKey>> = {
  PROPERTY: 'WHAT_WE_FOUND',
  OWNERSHIP: 'LEGAL',
  ENCUMBRANCE: 'LEGAL',
  LEGAL_CHECK: 'LEGAL',
  DOCUMENT: 'LEGAL',
  PROJECT: 'PROJECT',
  DEVELOPER: 'PROJECT',
  FINANCING: 'PROJECT',
  MARKET: 'MARKET',
  MEDIA: 'PROJECT',
  SOCIAL: 'PROJECT',
};

const TITLES: Record<SectionKey, string> = {
  OVERVIEW: 'მოკლედ',
  WHAT_WE_FOUND: 'რა ვნახეთ',
  MARKET: 'ფასი და ბაზარი',
  LOCATION: 'მდებარეობა',
  PROJECT: 'პროექტი და დეველოპერი',
  PEOPLE: 'დაკავშირებული პირები',
  LEGAL: 'სამართლებრივი სურათი',
};

/**
 * Builds a report with no model at all.
 *
 * Every sentence here is an evidence claim verbatim, so it passes the gate by
 * construction. Incomplete checks still become forward-looking actions rather
 * than a deficit list, so even the fallback keeps the product's voice.
 */
export function deterministicReport(pkg: EvidencePackage): BuyerIntelligenceReport {
  const sections: ReportSection[] = [];
  for (const key of ['WHAT_WE_FOUND', 'LEGAL', 'PROJECT', 'MARKET'] as SectionKey[]) {
    const mine = pkg.items.filter((i) => SECTION_FOR[i.category] === key);
    if (!mine.length) continue;
    sections.push({
      key,
      title: TITLES[key],
      body: mine.map((i) => i.claim).join(' '),
      cites: mine.map((i) => i.id),
    });
  }

  return {
    overallView: {
      label: 'MIXED',
      statement: 'ქვემოთ თავმოყრილია ის, რაც ამ ქონებაზე მოვიძიეთ.',
    },
    executiveSummary: sections.length
      ? 'ქვემოთ მოცემულია ამ ქონებაზე მოძიებული ინფორმაცია წყაროების მიხედვით.'
      : 'ამ ქონებაზე საკმარისი ინფორმაცია ვერ მოვიძიეთ.',
    sections,
    attentionPoints: [],
    buyerActions: pkg.unavailable.map((u) => ({
      title: u.label.slice(0, 40),
      action: `ყიდვამდე ღირს ${u.label}-ის აქტუალური სტატუსის გადამოწმება.`,
      why: '',
      cites: [],
    })),
    finalView: '',
    contractUpload: { recommend: true, text: '' },
    mode: 'DETERMINISTIC',
    rejectedBecause: [],
    evidenceUsed: pkg.items,
  };
}

/* ------------------------------------------------------------------ *
 * The gate                                                            *
 * ------------------------------------------------------------------ */

export function finalizeReport(
  pkg: EvidencePackage,
  raw: string | null | undefined
): BuyerIntelligenceReport {
  const parsed = parseReport(raw);
  const check = validateReport(pkg, parsed);

  if (!check.ok || !parsed) {
    return { ...deterministicReport(pkg), rejectedBecause: check.problems };
  }

  const cited = new Set([
    ...(parsed.sections ?? []).flatMap((s) => s.cites),
    ...(parsed.attentionPoints ?? []).flatMap((a) => a.cites),
    ...(parsed.buyerActions ?? []).flatMap((a) => a.cites),
  ]);

  return {
    overallView: parsed.overallView ?? { label: 'MIXED', statement: '' },
    executiveSummary: parsed.executiveSummary ?? '',
    sections: parsed.sections ?? [],
    attentionPoints: parsed.attentionPoints ?? [],
    buyerActions: parsed.buyerActions ?? [],
    finalView: parsed.finalView ?? '',
    contractUpload: parsed.contractUpload ?? { recommend: true, text: '' },
    mode: 'MODEL',
    rejectedBecause: [],
    evidenceUsed: pkg.items.filter((i) => cited.has(i.id)),
  };
}
