// HOMATCH — Ask Homatch AI: deterministic context assembly.
//
// WHAT MAKES THIS NOT A CHATBOT
// -----------------------------
// The model never queries anything. It is handed a small, bounded, already-
// selected set of statements drawn from ONE deal room, and it answers using
// only those. Selection happens here, in code, deterministically — the same
// question against the same evidence always assembles the same context, which
// means an answer can be reproduced and audited later.
//
// Three rules are enforced structurally rather than by prompt wording:
//
//   1. NO DATABASE DUMP. Retrieval is scored and capped (MAX_FACTS). A deal
//      room with four hundred facts contributes at most a handful, chosen by
//      relevance, so cost and prompt size stay bounded as the product grows.
//
//   2. NO EVIDENCE = NO FACT. Every selected item carries its grounding ref.
//      An answer with an empty grounding set is a general explanation, and it
//      is labelled as one rather than presented as a fact about this property.
//
//   3. EVIDENCE STRENGTH IS VISIBLE. Each statement is tagged with the
//      customer-facing certainty band, so the model cannot flatten a
//      CONFLICTING fact into a confident assertion.

import type { CanonicalFact } from '../planning/evidence.ts';
import type { DealRoomProjection } from './assemble.ts';

/** The five bands the product promises to distinguish. */
export type Certainty =
  | 'CONFIRMED'
  | 'LIKELY_BUT_UNCONFIRMED'
  | 'CONFLICTING'
  | 'UNAVAILABLE'
  | 'NOT_VERIFIED';

export interface ContextItem {
  /** Stable reference persisted into deal_room_ai_messages.grounded_in. */
  ref: string;
  statement: string;
  certainty: Certainty;
  /** Source keys, for the "where did this come from" affordance. */
  sources: string[];
}

export interface AssembledContext {
  items: ContextItem[];
  /** Sources that could not be completed. Present so the model can say "we
   * could not check X" instead of implying X is clean. */
  incompleteSources: string[];
  /** True when nothing relevant was found. The caller must then answer
   * generally and say so, never invent a property fact. */
  empty: boolean;
  propertyType: string;
  verdict: string;
}

/** Hard ceiling. A bigger number is not a better answer; it is a bigger bill
 * and a more distractible model. */
export const MAX_FACTS = 24;

/* ------------------------------------------------------------------ *
 * Certainty mapping                                                   *
 * ------------------------------------------------------------------ */

/**
 * Maps internal evidence state onto the customer-facing band.
 *
 * INFERRED becomes LIKELY_BUT_UNCONFIRMED rather than CONFIRMED, which is the
 * conservative direction: an inference presented as a confirmation is exactly
 * the failure this product exists to avoid.
 */
export function certaintyOf(f: CanonicalFact): Certainty {
  switch (f.state) {
    case 'CONFLICTING':
      return 'CONFLICTING';
    case 'CORROBORATED':
    case 'CONFIRMED':
      return 'CONFIRMED';
    case 'INFERRED':
      return 'LIKELY_BUT_UNCONFIRMED';
    case 'UNAVAILABLE':
    default:
      return 'UNAVAILABLE';
  }
}

/* ------------------------------------------------------------------ *
 * Retrieval                                                           *
 * ------------------------------------------------------------------ */

// Question vocabulary -> fact-type prefixes. Georgian and English, because
// customers ask in both. This is intentionally a small hand-built map rather
// than an embedding search: it is deterministic, auditable, costs nothing,
// and for a fixed fact vocabulary of ~40 types it is also more accurate.
const TOPIC_HINTS: { re: RegExp; prefixes: string[] }[] = [
  { re: /owner|მესაკუთრ|საკუთრ|whose|ვისი/i, prefixes: ['ownership.', 'company.'] },
  { re: /mortgage|იპოთეკ|pledge|გირავნობ|encumbr|შეზღუდვ|ყადაღ|debt|ვალ/i, prefixes: ['encumbrance.'] },
  { re: /developer|დეველოპერ|company|კომპანი|შპს|director|დირექტორ/i, prefixes: ['company.', 'project.'] },
  { re: /permit|ნებართვ|legal|სამართლებრივ|commission|ექსპლუატაცი/i, prefixes: ['permit.', 'construction.status'] },
  { re: /area|ფართ|m2|კვადრატ|floor|სართულ|size|ზომ/i, prefixes: ['property.', 'construction.totalArea'] },
  { re: /price|ფას|cost|ღირებულებ|market|ბაზ/i, prefixes: ['market.', 'price.'] },
  { re: /construction|მშენებლობ|build|აშენებ|structure|კონსტრუქცი/i, prefixes: ['construction.', 'project.'] },
  { re: /land|მიწ|parcel|ნაკვეთ/i, prefixes: ['land.', 'property.'] },
  { re: /address|მისამართ|location|მდებარეობ|district|უბან/i, prefixes: ['property.address', 'location.'] },
];

/**
 * Scores one fact against one question.
 *
 * Conflicts get a standing bonus: if the customer's question touches a fact
 * that official sources disagree about, that disagreement is the single most
 * useful thing we can tell them, and it must not be crowded out by
 * better-matching but less important facts.
 */
export function scoreFact(f: CanonicalFact, question: string): number {
  let score = 0;
  const q = question.toLowerCase();

  for (const hint of TOPIC_HINTS) {
    if (!hint.re.test(q)) continue;
    if (hint.prefixes.some((p) => f.type.startsWith(p))) score += 10;
  }

  // Literal mention of the value (an owner's name, a company id) is a strong
  // signal that the customer is asking about that specific thing.
  const v = typeof f.value === 'string' ? f.value.toLowerCase() : '';
  if (v.length >= 4 && q.includes(v.slice(0, Math.min(v.length, 24)))) score += 6;

  if (f.state === 'CONFLICTING') score += 5;
  // Corroboration is a tiebreak, not a topic signal.
  score += Math.min(f.sourceCount, 3);

  return score;
}

const refOf = (f: CanonicalFact): string =>
  `${f.type}${f.subject ? `:${f.subject}` : ''}@${f.evidence.map((e) => e.source).join('+') || 'unknown'}`;

/** Renders one fact as a plain statement. Deliberately mechanical — this is
 * evidence, not prose; the model does the writing. */
function statementOf(f: CanonicalFact): string {
  const label = f.subject ? `${f.type} (${f.subject})` : f.type;
  const value = typeof f.value === 'string' ? f.value : JSON.stringify(f.value);
  if (f.state === 'CONFLICTING' && f.conflicting?.length) {
    const others = f.conflicting.map((c) => (typeof c.value === 'string' ? c.value : JSON.stringify(c.value)));
    return `${label}: ${value} — sources disagree; also stated: ${others.join('; ')}`;
  }
  if (f.negative) return `${label}: explicitly none / not registered (${value})`;
  return `${label}: ${value}`;
}

/**
 * Assembles the context for one question against one deal room.
 *
 * `extras` carries evidence that lives outside the Verify projection —
 * contract findings, the renovation scenario, open action items — already
 * reduced to statements with refs by their own owners. They are appended
 * rather than re-derived here, so this function stays free of database access
 * and stays testable.
 */
export function assembleContext(
  projection: DealRoomProjection,
  question: string,
  extras: ContextItem[] = []
): AssembledContext {
  const q = String(question ?? '');

  const scored = projection.facts
    .filter((f) => f.state !== 'UNAVAILABLE')
    .map((f) => ({ f, s: scoreFact(f, q) }))
    // A fact with no topical signal at all is noise for THIS question.
    .filter((x) => x.s > 3)
    .sort((a, b) => b.s - a.s || refOf(a.f).localeCompare(refOf(b.f)));

  const items: ContextItem[] = scored.slice(0, MAX_FACTS).map(({ f }) => ({
    ref: refOf(f),
    statement: statementOf(f),
    certainty: certaintyOf(f),
    sources: [...new Set(f.evidence.map((e) => e.source))],
  }));

  // Extras are trusted to be already relevant and are capped separately so a
  // long contract can never crowd out the registry evidence.
  const merged = [...items, ...extras.slice(0, 12)];

  return {
    items: merged,
    incompleteSources: projection.incomplete.map((o) => o.source),
    empty: merged.length === 0,
    propertyType: projection.propertyType,
    verdict: projection.verdict,
  };
}

/* ------------------------------------------------------------------ *
 * The prompt                                                          *
 * ------------------------------------------------------------------ */

export function buildAskPrompt(ctx: AssembledContext, question: string): { system: string; user: string } {
  const system = [
    'You are Homatch AI, answering a buyer about ONE specific property.',
    '',
    'You may use ONLY the evidence supplied below. You have no other knowledge',
    'about this property. You may not infer facts that are not stated.',
    '',
    'Certainty labels are authoritative and must be respected:',
    '  CONFIRMED               state it plainly.',
    '  LIKELY_BUT_UNCONFIRMED  say it appears so but is not confirmed.',
    '  CONFLICTING             say sources disagree, and give both values.',
    '  UNAVAILABLE             say it could not be established.',
    '',
    'If the evidence does not answer the question, say so plainly and suggest',
    'how the buyer could find out. NEVER convert missing information into a',
    'negative finding about the property: "we could not check X" is not "X is',
    'a problem".',
    '',
    'A source we could not complete says nothing about the property. Do not',
    'let it affect your tone or any assessment.',
    '',
    'Write in the buyer\'s language, simply and calmly. Do not mention source',
    'identifiers, internal names, JSON, or how the research was performed.',
  ].join('\n');

  const user = JSON.stringify(
    {
      question,
      propertyType: ctx.propertyType,
      evidence: ctx.items.map((i) => ({ ref: i.ref, statement: i.statement, certainty: i.certainty })),
      couldNotBeCompleted: ctx.incompleteSources,
      note: ctx.empty
        ? 'NO RELEVANT EVIDENCE. Answer generally, and say clearly that this was not verified for this property.'
        : undefined,
    },
    null,
    1
  );

  return { system, user };
}

/**
 * The grounding refs to persist alongside an answer.
 *
 * An empty array is meaningful and must be stored as such: it is what the UI
 * uses to label a message as a general explanation rather than a property
 * fact.
 */
export function groundingRefs(ctx: AssembledContext): string[] {
  return ctx.items.map((i) => i.ref);
}
