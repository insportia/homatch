// HOMATCH — one fact, one home.
//
// WHAT THE REPORT ACTUALLY DID
//
// Measured across one real production report (job 81356bea), counting whole
// occurrences in the synthesis payload:
//
//   developer      35
//   parking        14
//   commissioning   9
//   floors          6
//   unit count      5
//
// Concentrated in the model-written narrative, where the same fact was
// explained in the summary, again in key findings, again in the project
// section, again as an attention point and again in the final view. The
// result reads like five pipeline stages were concatenated, because that is
// very nearly what happened.
//
// THE RULE
//
// Every fact has one natural section that OWNS it. Elsewhere it may be
// referenced only if the reference carries something new — a number, a date,
// a figure the owner did not state. A sentence that merely restates the
// owner's point is removed.
//
// This is deterministic and runs after generation, because prompt wording
// alone has not held: the instruction to avoid repetition already exists and
// the report above is what came back anyway.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It does not rewrite sentences, merge them, or summarise. It removes whole
// sentences that add nothing, and leaves everything else exactly as written.
// Dropping a sentence can only ever remove a repeat; it cannot invent a claim.

export type TopicKey = 'PARKING' | 'COMMISSIONING' | 'BUILDING_SPEC' | 'DEVELOPER' | 'AMENITIES';

/** Where each fact belongs. A mention outside its owner must earn its place. */
export const TOPIC_OWNER: Record<TopicKey, string> = {
  PARKING: 'PROJECT',
  COMMISSIONING: 'PROJECT',
  BUILDING_SPEC: 'PROJECT',
  AMENITIES: 'PROJECT',
  DEVELOPER: 'PEOPLE',
};

/*
 * Georgian first, because that is what the reports are written in. Each
 * pattern is deliberately narrow: a topic is only recognised by the words a
 * writer would actually use for it, so an unrelated sentence is never
 * silently deleted.
 */
const TOPIC_PATTERNS: Record<TopicKey, RegExp> = {
  PARKING: /პარკინგ|ავტოსადგომ|\bparking\b/i,
  COMMISSIONING: /ექსპლუატაცია|ექსპლუატაციაში|\bcommissioning\b|\boccupancy permit\b/i,
  BUILDING_SPEC: /სართულიან|სართული|ბინების რაოდენობ|კორპუს|\bfloors?\b|\bstoreys?\b|\bunits?\b/i,
  AMENITIES: /ეზო|გამწვანებ|ლობი|საბავშვო|\bcourtyard\b|\blobby\b|\bamenit/i,
  DEVELOPER: /დეველოპერ|სამშენებლო კომპანი|\bdeveloper\b/i,
};

/** The order a reader meets the report, which is also the order of priority
 *  when deciding which mention of a fact is the one that stays. */
export type BlockId = 'summary' | 'keyFindings' | 'section' | 'attentionPoints' | 'finalView';

/**
 * Sentences, split on terminators that survive Georgian text.
 *
 * Georgian uses the Latin full stop, so the usual rules apply; the lookbehind
 * is avoided for runtime portability.
 */
export function sentences(text: string): string[] {
  if (typeof text !== 'string' || !text.trim()) return [];
  const out: string[] = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (ch === '.' || ch === '!' || ch === '?' || ch === '\n') {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Every number a sentence states, normalised so "1,899" and "1899" match. */
export function numbersIn(text: string): string[] {
  return (String(text ?? '').match(/\d[\d.,]*/g) ?? [])
    .map((n) => n.replace(/[.,](?=\d{3}\b)/g, '').replace(/[.,]$/, ''))
    .filter(Boolean);
}

export function topicsIn(text: string): TopicKey[] {
  const s = String(text ?? '');
  return (Object.keys(TOPIC_PATTERNS) as TopicKey[]).filter((k) => TOPIC_PATTERNS[k].test(s));
}

/**
 * Does this sentence add anything the topic's owner did not already say?
 *
 * A sentence earns its place by carrying a number the owner did not state.
 * Everything else about the same topic is a restatement, however differently
 * it is phrased — and a reader does not care that it is phrased differently.
 */
export function addsSomethingNew(sentence: string, alreadySaid: string): boolean {
  const known = new Set(numbersIn(alreadySaid));
  return numbersIn(sentence).some((n) => !known.has(n));
}

/*
 * PARKING IS NOT A RISK.
 *
 * Parking became a recurring warning: the same "confirm whether parking is
 * included" instruction in the project section, in the attention points and
 * again in the final view. None of it was evidence of a problem — it was the
 * absence of a transaction-level fact being repeated as though it were one.
 *
 * A project's parking is an amenity and is stated once. Whether a parking
 * space is part of THIS purchase is a contract question, and it is only worth
 * raising when something actually raises it.
 */
const PARKING_CONFIRMATION =
  /(პარკინგ|ავტოსადგომ|parking)[\s\S]{0,80}?(გადაამოწმ|დააზუსტ|უნდა შემოწმდეს|confirm|check|verify|clarify)|(გადაამოწმ|დააზუსტ|confirm|check|verify|clarify)[\s\S]{0,80}?(პარკინგ|ავტოსადგომ|parking)/i;

export function isParkingConfirmationPrompt(text: string): boolean {
  return PARKING_CONFIRMATION.test(String(text ?? ''));
}

export interface DedupeInput {
  /** The block this text belongs to, in reading order. */
  block: BlockId;
  /** For a section, its key — so PROJECT can own what PROJECT owns. */
  sectionKey?: string;
  text: string;
}

export interface DedupeDecision {
  keep: string;
  removed: string[];
}

/**
 * Remove sentences that restate a fact already stated in its owning section.
 *
 * `seen` is carried across calls by the caller, so the owner is whichever
 * block legitimately said it first — the section that owns the topic when it
 * is present, and otherwise simply the first block to mention it.
 */
export function dedupeBlock(input: DedupeInput, seen: Map<TopicKey, string>): DedupeDecision {
  const removed: string[] = [];
  const kept: string[] = [];

  for (const sentence of sentences(input.text)) {
    const topics = topicsIn(sentence);
    if (!topics.length) {
      kept.push(sentence);
      continue;
    }

    // A parking confirmation outside the project section is the repeated
    // warning this exists to stop.
    if (
      topics.includes('PARKING') &&
      input.sectionKey !== 'PROJECT' &&
      isParkingConfirmationPrompt(sentence)
    ) {
      removed.push(sentence);
      continue;
    }

    const restatesEverything = topics.every((t) => {
      const owner = TOPIC_OWNER[t];
      const isOwner = input.block === 'section' && input.sectionKey === owner;
      const already = seen.get(t);
      if (isOwner || already === undefined) return false;
      return !addsSomethingNew(sentence, already);
    });

    if (restatesEverything) {
      removed.push(sentence);
      continue;
    }

    for (const t of topics) {
      seen.set(t, `${seen.get(t) ?? ''} ${sentence}`.trim());
    }
    kept.push(sentence);
  }

  return { keep: kept.join(' ').replace(/\s+/g, ' ').trim(), removed };
}
