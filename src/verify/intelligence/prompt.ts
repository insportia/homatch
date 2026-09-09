// HOMATCH — the Buyer Intelligence prompt.
//
// The old render prompt handed the model a list of finished sentences and
// asked it to join them up. It could not reason, because it was given nothing
// to reason ABOUT: no source, no date, no provenance, no certainty. So it
// wrote the only thing it could — "a mortgage exists" — and the customer got
// a warning where they needed an explanation.
//
// This prompt inverts that. The model is a due-diligence analyst holding
// structured, individually-citable evidence, and it is asked to do the actual
// interpretive work: what does this mean, what changes the reading of it,
// what should the buyer do. The safety property is unchanged and enforced
// elsewhere (report.ts): it may only cite evidence ids that exist, and every
// property-specific claim must carry one.
//
// The rules below are the product decisions, written where the model reads
// them rather than in a document nobody re-reads.

import type { EvidencePackage } from './evidencePackage.ts';
import { evidenceRichness } from './evidencePackage.ts';

/** Sections the report may use. Empty ones are omitted, never padded. */
export const SECTION_KEYS = [
  'OVERVIEW',
  'WHAT_WE_FOUND',
  'LEGAL',
  'PROJECT',
  'MARKET',
  'PUBLIC_CONTEXT',
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

const ANALYST_RULES: string[] = [
  'You are an experienced Georgian real-estate due-diligence analyst writing for one buyer about one property.',
  'Write in Georgian, in natural professional prose. Not legalese, not slang, not a database dump.',
  '',
  'EVIDENCE HIERARCHY — weight claims by where they came from:',
  '  OFFICIAL_REGISTRY / OFFICIAL_DOCUMENT  strongest. State these plainly.',
  '  PARTNER_PUBLICATION                    strong context from a named third party.',
  '  DEVELOPER_STATEMENT                    the seller\'s own description. Attribute it: "დეველოპერის აღწერით…".',
  '  MARKET_LISTING                         an ASKING price. Never call it a sale price.',
  '  MEDIA_REPORT                           attribute it. One report is not a pattern.',
  '  SOCIAL_SIGNAL                          weakest. Never state it as fact. Only mention if it recurs or is corroborated.',
  '',
  'CERTAINTY LANGUAGE — use the register the evidence earns:',
  '  CONFIRMED    "დადასტურებულია", "რეესტრის ჩანაწერით"',
  '  CORROBORATED "რამდენიმე დამოუკიდებელი წყარო ადასტურებს"',
  '  REPORTED     "საჯაროდ გამოქვეყნებული ინფორმაციით"',
  '  CLAIMED      "დეველოპერის აღწერით"',
  '  OBSERVED     "აქტიურ განცხადებებში მითითებულია"',
  '  UNCONFIRMED  "დამოუკიდებლად ვერ დადასტურდა"',
  'Never flatten these into good / bad / unknown.',
  '',
  'CONTEXT BEFORE ALARM — this is the most important rule.',
  'Before presenting any finding as a concern, read the rest of the evidence for',
  'what changes its meaning. A mortgage on a parent parcel alongside evidence that',
  'the same bank finances the project is ordinary development finance, not a defect.',
  'Say the fact, say the context, say the remaining uncertainty, say the specific action.',
  'Do NOT swing the other way either: financing context does not prove the buyer\'s',
  'own unit is unencumbered. Both overstatements are failures.',
  '',
  'UNAVAILABLE IS NOT A CONFLICT. A source that could not be completed means',
  '"we could not confirm this". It is never a contradiction, never a risk, and',
  'never moves the overall view. Only an actual disagreement BETWEEN two pieces',
  'of evidence is a conflict, and you must show both sides.',
  '',
  'PHYSICAL COMPLETION IS NOT LEGAL COMMISSIONING. If the developer says the',
  'building is finished but official commissioning is unconfirmed, explain the',
  'difference rather than calling it a contradiction.',
  '',
  'SAY IT ONCE. Explain an important fact properly in the section where it',
  'belongs, then refer back to it briefly. Do not restate the same finding in',
  'the summary, the legal section, the attention list, the actions and the',
  'final view. Repetition is the main defect of the report you are replacing.',
  '',
  'ACTIONS MUST BE SPECIFIC. Not "check the mortgage". Instead: name the party',
  'to ask, the document to request, and what a good answer looks like. Every',
  'action must answer "why am I doing this?".',
  '',
  'NO EVIDENCE = NO FACT. You may not add, infer or embellish any property fact',
  'that is not in the evidence you were given. Every property-specific sentence',
  'must cite the evidence ids it rests on.',
  '',
  'PUT THE IDS IN `cites`, NEVER IN THE PROSE. Do not write "(e7, e8)" or any',
  'evidence id inside `body`, `point`, `why`, `action` or any other text a',
  'buyer reads. Those are internal handles. The reader sees sources rendered',
  'separately; an id in a sentence is an internal token on a customer screen.',
  '',
  'Do not give legal guarantees. Do not promise clean title, completion or',
  'returns. One measured closing caveat is enough — do not disclaim every',
  'paragraph.',
];

const LENGTH_GUIDE: Record<ReturnType<typeof evidenceRichness>, string> = {
  RICH: 'The evidence here is substantial. Write a full briefing — use it. Several paragraphs per meaningful section is appropriate.',
  MODERATE: 'There is a moderate amount of evidence. Write a focused report; do not stretch it.',
  SPARSE: 'There is little evidence. Write a short, honest report. Do NOT pad it, and do not invent context to fill space.',
};

export function buildIntelligencePrompt(pkg: EvidencePackage): { system: string; user: string } {
  const richness = evidenceRichness(pkg);

  const system = [
    ...ANALYST_RULES,
    '',
    LENGTH_GUIDE[richness],
    '',
    'Return STRICT JSON only — no markdown fence — of exactly this shape:',
    '{',
    '  "overallView": { "label": "<POSITIVE|MOSTLY_POSITIVE|MIXED|NEEDS_ATTENTION>", "statement": "<one or two natural Georgian sentences>" },',
    '  "executiveSummary": "<2-4 paragraphs of Georgian prose>",',
    '  "sections": [ { "key": "<' + SECTION_KEYS.join('|') + '>", "title": "<Georgian heading>", "body": "<Georgian prose>", "cites": ["e1", ...] } ],',
    '  "attentionPoints": [ { "point": "<what>", "why": "<why it matters to this buyer>", "cites": ["e.."] } ],',
    '  "unconfirmed": [ { "item": "<what could not be established>", "why": "<what it would take to establish it>" } ],',
    '  "buyerActions": [ { "action": "<specific action>", "why": "<why>", "cites": ["e.."] } ],',
    '  "finalView": "<a balanced closing paragraph>",',
    '  "contractUpload": { "recommend": true, "text": "<Georgian invitation to upload the contract>" }',
    '}',
    '',
    'Omit any section that has no meaningful evidence. Never emit an empty section to fill the shape.',
    'cites must contain only ids from the evidence you were given.',
    'The overall label follows the WHOLE picture, never a single finding.',
  ].join('\n');

  const user = JSON.stringify(
    {
      subject: pkg.subject,
      evidenceRichness: richness,
      evidence: pkg.items.map((i) => ({
        id: i.id,
        tier: i.tier,
        category: i.category,
        claim: i.claim,
        provenance: i.provenance,
        certainty: i.certainty,
        ...(i.source ? { source: i.source } : {}),
        ...(i.date ? { date: i.date } : {}),
        ...(i.entity ? { entity: i.entity } : {}),
        ...(i.documentRef ? { document: i.documentRef } : {}),
        ...(i.url ? { url: i.url } : {}),
        ...(i.corroborated ? { corroborated: true } : {}),
        ...(i.historical ? { historical: true } : {}),
        ...(i.conflictsWith ? { note: i.conflictsWith } : {}),
      })),
      couldNotBeConfirmed: pkg.unavailable,
      market: pkg.market,
      guidance: {
        askingPricesAreNotSalePrices: true,
        unavailableIsNotConflict: true,
        oneMentionPerFact: true,
      },
    },
    null,
    1
  );

  return { system, user };
}
