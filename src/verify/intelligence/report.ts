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
// WHAT CHANGED IN V3
// ------------------
//
// 1. `buyerActions` IS GONE, and with it the "რას გავაკეთებდი ყიდვამდე"
//    section. Not renamed — removed. It had become a bin: every incomplete
//    check turned into a generic instruction, and a reader got a checklist of
//    six near-identical "confirm this before signing" lines with no idea which
//    one mattered. Advice now lives in the section it belongs to — signing
//    authority with the people, negotiation with the market, contract review
//    beside the contract CTA — where it carries the context that makes it
//    actionable.
//
// 2. A SUMMARY the customer can read in fifteen seconds: one overall view and
//    three to six scannable highlights, each tied to a dimension and a
//    sentiment, each cited. It replaces a wall of prose at the top.
//
// 3. KEY FINDINGS, capped. Four to seven things that actually bear on the
//    decision, each carrying WHY it matters — not everything the research
//    happened to collect.
//
// 4. NOT FOUND IS NOT ABSENT. The previous report wrote sentences like
//    "ლანდშაფტის არქიტექტორის სახელი არ სახელდება" — turning "our research
//    did not find this" into "this does not exist". That is a claim about the
//    world made from a fact about our pipeline, and it is now refused.
//
// 5. PROVENANCE IS NOT A PREFIX. "საჯაროდ გამოქვეყნებულ პროექტის მასალებში"
//    appeared at the head of paragraph after paragraph. Provenance belongs in
//    Evidence & Sources; a capped number of in-prose attributions survive for
//    the places where the source genuinely changes the meaning.
//
// The safety property is unchanged: a model may cite only evidence that
// exists, substantial claims must carry a citation, and output that fails is
// DISCARDED for a deterministic report built from the same evidence.

import type { EvidencePackage, EvidenceItem } from './evidencePackage.ts';
import { SECTION_KEYS } from './prompt.ts';
import type { SectionKey } from './prompt.ts';

/** Restrained, and deliberately three. "Attention" is not "bad". */
export type OverallLabel = 'POSITIVE' | 'BALANCED' | 'NEEDS_ATTENTION';
export type Sentiment = 'POSITIVE' | 'BALANCED' | 'ATTENTION';

/** The dimensions a summary highlight may speak to. Only evidenced ones appear. */
export const DIMENSIONS = [
  'PROJECT_QUALITY',
  'MARKET_POSITION',
  'LEGAL_CONTEXT',
  'LOCATION',
  'DEVELOPER',
  'TRANSACTION_READINESS',
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface SummaryHighlight {
  dimension: Dimension;
  sentiment: Sentiment;
  /** A few words. This is the part a scanning reader actually reads. */
  headline: string;
  /** One sentence of substance behind it. */
  detail: string;
  cites: string[];
}

export interface BuyerSummary {
  label: OverallLabel;
  statement: string;
  highlights: SummaryHighlight[];
}

export interface KeyFinding {
  finding: string;
  whyItMatters: string;
  sentiment: Sentiment;
  cites: string[];
}

/**
 * A decision-relevant number the renderer may lift out of the prose as a chip.
 *
 * Structured rather than discovered: highlighting arbitrary model prose with
 * regexes is brittle and emphasises the wrong half of a sentence. If a metric
 * deserves emphasis, the model names it here.
 */
export interface SectionMetric {
  label: string;
  value: string;
}

export interface ReportSection {
  key: SectionKey;
  title: string;
  body: string;
  metrics: SectionMetric[];
  cites: string[];
}

export interface AttentionPoint {
  point: string;
  why: string;
  cites: string[];
}

export interface BuyerIntelligenceReport {
  summary: BuyerSummary;
  keyFindings: KeyFinding[];
  sections: ReportSection[];
  attentionPoints: AttentionPoint[];
  finalView: string;
  contractUpload: { recommend: boolean; text: string };
  mode: 'MODEL' | 'DETERMINISTIC';
  rejectedBecause: string[];
  evidenceUsed: EvidenceItem[];
}

const LABELS: OverallLabel[] = ['POSITIVE', 'BALANCED', 'NEEDS_ATTENTION'];
const SENTIMENTS: Sentiment[] = ['POSITIVE', 'BALANCED', 'ATTENTION'];

/** Older vocabularies, so a model that reaches for them is understood. */
const LABEL_ALIASES: Record<string, OverallLabel> = {
  MOSTLY_POSITIVE: 'POSITIVE',
  MIXED: 'BALANCED',
  NEUTRAL: 'BALANCED',
  NEGATIVE: 'NEEDS_ATTENTION',
};

/** §41: findings are a shortlist. More than this and it is a data dump again. */
export const MAX_KEY_FINDINGS = 7;
export const MAX_HIGHLIGHTS = 6;

/*
 * Sentences that convert "we did not find it" into "it does not exist".
 *
 * Kept narrow on purpose. A registry statement of genuine absence — no
 * encumbrance recorded, no seizure registered — is a real finding and must
 * stay sayable. What is refused is an assertion about INFORMATION itself:
 * that a name is not named anywhere, that information does not exist. Those
 * are only ever claims about the limits of a search.
 */
const ABSENCE_AS_FACT: string[] = [
  'არ სახელდება',
  'ინფორმაცია არ არსებობს',
  'არ არსებობს ინფორმაცია',
  'არსად არ არის მითითებული',
  'არ მოიპოვება ინფორმაცია',
  'არ არის ცნობილი',
];

/*
 * Attributions that were being pasted onto the front of every paragraph.
 * A couple of uses is legitimate — sometimes the source IS the point. Ten is
 * a tic, and it was the single most-complained-about texture in the report.
 */
const OVERUSED_PROVENANCE: string[] = [
  'საჯაროდ გამოქვეყნებულ',
  'დეველოპერის მიერ გამოქვეყნებულ',
  'პროექტის მასალებში',
  'საჯარო მასალებში',
];
export const PROVENANCE_MENTION_LIMIT = 2;

const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asCites = (v: unknown): string[] =>
  asArray(v).filter((x): x is string => typeof x === 'string');

const asSentiment = (v: unknown): Sentiment => {
  const s = asString(v).toUpperCase();
  return SENTIMENTS.includes(s as Sentiment) ? (s as Sentiment) : 'BALANCED';
};

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

  const sm = (p.summary ?? {}) as Record<string, unknown>;
  const rawLabel = asString(sm.label).toUpperCase();
  const label = LABELS.includes(rawLabel as OverallLabel)
    ? (rawLabel as OverallLabel)
    : LABEL_ALIASES[rawLabel] ?? 'BALANCED';

  const highlights: SummaryHighlight[] = asArray(sm.highlights)
    .map((h) => (h ?? {}) as Record<string, unknown>)
    .filter((h) => asString(h.headline))
    .map((h) => ({
      dimension: (DIMENSIONS.includes(asString(h.dimension).toUpperCase() as Dimension)
        ? asString(h.dimension).toUpperCase()
        : 'PROJECT_QUALITY') as Dimension,
      sentiment: asSentiment(h.sentiment),
      headline: asString(h.headline),
      detail: asString(h.detail),
      cites: asCites(h.cites),
    }))
    .slice(0, MAX_HIGHLIGHTS);

  const keyFindings: KeyFinding[] = asArray(p.keyFindings)
    .map((f) => (f ?? {}) as Record<string, unknown>)
    .filter((f) => asString(f.finding))
    .map((f) => ({
      finding: asString(f.finding),
      whyItMatters: asString(f.whyItMatters),
      sentiment: asSentiment(f.sentiment),
      cites: asCites(f.cites),
    }))
    .slice(0, MAX_KEY_FINDINGS);

  const sections: ReportSection[] = [];
  for (const s of asArray(p.sections)) {
    const sec = (s ?? {}) as Record<string, unknown>;
    const key = asString(sec.key).toUpperCase() as SectionKey;
    const body = asString(sec.body);
    if (!SECTION_KEYS.includes(key) || !body) continue;
    sections.push({
      key,
      title: asString(sec.title) || key,
      body,
      metrics: asArray(sec.metrics)
        .map((m) => (m ?? {}) as Record<string, unknown>)
        .filter((m) => asString(m.label) && asString(m.value))
        .map((m) => ({ label: asString(m.label), value: asString(m.value) })),
      cites: asCites(sec.cites),
    });
  }

  const attentionPoints: AttentionPoint[] = asArray(p.attentionPoints)
    .map((a) => (a ?? {}) as Record<string, unknown>)
    .filter((a) => asString(a.point))
    .map((a) => ({ point: asString(a.point), why: asString(a.why), cites: asCites(a.cites) }));

  const cu = (p.contractUpload ?? {}) as Record<string, unknown>;

  return {
    summary: { label, statement: asString(sm.statement), highlights },
    keyFindings,
    sections,
    attentionPoints,
    finalView: asString(p.finalView),
    contractUpload: { recommend: cu.recommend !== false, text: asString(cu.text) },
  };
}

/* ------------------------------------------------------------------ *
 * The grounding gate                                                  *
 * ------------------------------------------------------------------ */

function packageItems(pkg: unknown): EvidenceItem[] {
  const items = (pkg as EvidencePackage | undefined)?.items;
  return Array.isArray(items) ? items : [];
}
/** Every string a customer will actually read. */
function customerProse(c: Partial<BuyerIntelligenceReport>): string {
  return [
    c.summary?.statement ?? '',
    ...(c.summary?.highlights ?? []).flatMap((h) => [h.headline, h.detail]),
    ...(c.keyFindings ?? []).flatMap((f) => [f.finding, f.whyItMatters]),
    ...(c.sections ?? []).flatMap((s) => [s.title, s.body]),
    ...(c.attentionPoints ?? []).flatMap((a) => [a.point, a.why]),
    c.finalView ?? '',
    c.contractUpload?.text ?? '',
  ].join('\n');
}

export function validateReport(
  pkg: EvidencePackage,
  candidate: Partial<BuyerIntelligenceReport> | null
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!candidate) return { ok: false, problems: ['model output was not parseable JSON'] };

  const known = new Set(packageItems(pkg).map((i) => i.id));
  const checkCites = (cites: string[], where: string): void => {
    for (const c of cites) {
      if (!known.has(c)) problems.push(`ungrounded citation ${c} in ${where}`);
    }
  };

  if (!candidate.summary?.statement) problems.push('no summary statement');
  if (!candidate.summary?.highlights?.length) problems.push('summary has no highlights');
  if (!candidate.sections?.length) problems.push('no sections');

  for (const h of candidate.summary?.highlights ?? []) checkCites(h.cites, 'summary highlight');
  for (const f of candidate.keyFindings ?? []) {
    checkCites(f.cites, 'key finding');
    // A finding with no consequence is a fact, and facts belong in sections.
    if (!f.whyItMatters) problems.push('a key finding does not say why it matters');
  }
  for (const s of candidate.sections ?? []) {
    checkCites(s.cites, `section ${s.key}`);
    // A section of property prose that cites nothing is exactly the failure
    // mode this gate exists for: fluent, specific, and unsupported.
    if (!s.cites.length && s.body.length > 240) {
      problems.push(`section ${s.key} makes substantial claims with no citation`);
    }
  }
  for (const a of candidate.attentionPoints ?? []) checkCites(a.cites, 'attentionPoints');

  const prose = customerProse(candidate);

  // NOT FOUND != DOES NOT EXIST.
  for (const phrase of ABSENCE_AS_FACT) {
    if (prose.includes(phrase)) {
      problems.push(`states absence as fact ("${phrase}") where only the search came up empty`);
    }
  }

  // Provenance as a verbal tic.
  for (const phrase of OVERUSED_PROVENANCE) {
    const uses = prose.split(phrase).length - 1;
    if (uses > PROVENANCE_MENTION_LIMIT) {
      problems.push(`provenance phrase "${phrase}" repeated ${uses} times`);
    }
  }

  return { ok: problems.length === 0, problems };
}

/* ------------------------------------------------------------------ *
 * The deterministic fallback                                          *
 * ------------------------------------------------------------------ */

const SECTION_FOR: Partial<Record<EvidenceItem['category'], SectionKey>> = {
  PROPERTY: 'PROJECT',
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
  MARKET: 'ფასი და ბაზარი',
  PROJECT: 'პროექტი და დეველოპერი',
  LOCATION: 'მდებარეობა',
  PEOPLE: 'კომპანია და დაკავშირებული პირები',
  LEGAL: 'სამართლებრივი და ფინანსური კონტექსტი',
};

/**
 * Builds a report with no model at all.
 *
 * Every sentence here is an evidence claim verbatim, so it passes the gate by
 * construction — including the absence rule, because it never characterises
 * what was not found.
 */
/*
 * A REPORT BUILDER MUST NOT BE THE THING THAT CRASHES.
 *
 * deterministicReport() and finalizeReport() are the LAST line of defence:
 * they exist so a customer gets something truthful when the model fails.
 * Both reached straight into pkg.items, so handed a package without one they
 * threw the exact error reported from production:
 *
 *   TypeError: Cannot read properties of undefined (reading 'filter')
 *
 * Reproduced directly against these two functions — deterministicReport({})
 * and finalizeReport({}, parsed) each throw it verbatim.
 *
 * buildEvidencePackage() always returns an items array, so the only live
 * caller is safe today. That is exactly why this is worth fixing rather than
 * arguing about: the fallback path has no business depending on a caller
 * getting the shape right, and a deterministic report built from no evidence
 * is a correct, honest answer — an empty one.
 */


export function deterministicReport(pkg: EvidencePackage): BuyerIntelligenceReport {
  const sections: ReportSection[] = [];
  const allItems = packageItems(pkg);
  for (const key of ['LEGAL', 'PROJECT', 'MARKET'] as SectionKey[]) {
    const mine = allItems.filter((i) => SECTION_FOR[i.category] === key);
    if (!mine.length) continue;
    sections.push({
      key,
      title: TITLES[key],
      body: mine.map((i) => i.claim).join(' '),
      metrics: [],
      cites: mine.map((i) => i.id),
    });
  }

  // The strongest few claims, stated as themselves. No interpretation is
  // offered because none can be justified without a model.
  const keyFindings: KeyFinding[] = packageItems(pkg)
    .filter((i) => i.tier <= 2)
    .slice(0, MAX_KEY_FINDINGS)
    .map((i) => ({
      finding: i.claim,
      whyItMatters: 'ეს ჩანაწერი პირდაპირ ამ ქონებას ეხება.',
      sentiment: 'BALANCED' as Sentiment,
      cites: [i.id],
    }));

  return {
    summary: {
      label: 'BALANCED',
      statement: sections.length
        ? 'ქვემოთ თავმოყრილია ის, რაც ამ ქონებაზე მოვიძიეთ, წყაროების მიხედვით.'
        : 'ამ ქონებაზე საკმარისი ინფორმაცია ვერ მოვიძიეთ.',
      highlights: sections.map((s) => ({
        dimension: (s.key === 'MARKET'
          ? 'MARKET_POSITION'
          : s.key === 'LEGAL'
            ? 'LEGAL_CONTEXT'
            : 'PROJECT_QUALITY') as Dimension,
        sentiment: 'BALANCED' as Sentiment,
        headline: s.title,
        detail: '',
        cites: s.cites.slice(0, 3),
      })),
    },
    keyFindings,
    sections,
    attentionPoints: [],
    finalView: '',
    contractUpload: { recommend: true, text: '' },
    mode: 'DETERMINISTIC',
    rejectedBecause: [],
    evidenceUsed: packageItems(pkg),
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
    ...(parsed.summary?.highlights ?? []).flatMap((h) => h.cites),
    ...(parsed.keyFindings ?? []).flatMap((f) => f.cites),
    ...(parsed.sections ?? []).flatMap((s) => s.cites),
    ...(parsed.attentionPoints ?? []).flatMap((a) => a.cites),
  ]);

  return {
    summary: parsed.summary ?? { label: 'BALANCED', statement: '', highlights: [] },
    keyFindings: parsed.keyFindings ?? [],
    sections: parsed.sections ?? [],
    attentionPoints: parsed.attentionPoints ?? [],
    finalView: parsed.finalView ?? '',
    contractUpload: parsed.contractUpload ?? { recommend: true, text: '' },
    mode: 'MODEL',
    rejectedBecause: [],
    evidenceUsed: packageItems(pkg).filter((i) => cited.has(i.id)),
  };
}
