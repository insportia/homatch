// HOMATCH Communications — turning a conversation into structured facts, and
// deciding which facts win.
//
// §42 states the rule this file exists to enforce: "Never overwrite
// high-confidence user-confirmed structured data with a lower-confidence AI
// guess without proper reconciliation." That is easy to agree with and easy to
// violate, because the natural implementation of "update the contact from the
// call" is an UPDATE that clobbers everything.
//
// So extraction is two steps, not one:
//
//   extractDeterministic()  what code can read for certain, free
//   mergeExtraction()       what may be promoted onto the contact, and what
//                           must be left alone
//
// §138 governs when the expensive step runs at all: a NO_ANSWER has no
// conversation in it, and paying an LLM to summarise silence is pure waste.

import { extractPlaces, parseMoney, parseBedrooms } from './entities.ts';

export type ExtractionMethod = 'DETERMINISTIC' | 'LLM' | 'HUMAN';

export interface Extraction {
  transactionType?: 'BUY' | 'SELL' | 'RENT' | 'INVEST' | 'UNKNOWN' | null;
  propertyType?: string | null;
  locations?: string[] | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  currency?: string | null;
  bedrooms?: number | null;
  timeline?: string | null;
  interestLevel?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | null;
  objection?: string | null;
  callbackRequested?: boolean | null;
  callbackAt?: string | null;
  viewingInterest?: boolean | null;
  language?: string | null;
  summary?: string | null;
  nextAction?: string | null;
}

export interface ExtractionRecord extends Extraction {
  method: ExtractionMethod;
  /** 0-1. HUMAN is always 1; deterministic parses are high; an LLM says its own. */
  confidence: number;
  at: string;
}

/**
 * What code can read without asking a model anything.
 *
 * This runs on every transcript, always, because it is free. Where it and the
 * LLM disagree on a NUMBER, this wins: a regex that found "180 ათასამდე" is
 * more reliable about the digits than a model paraphrasing the same sentence.
 */
export function extractDeterministic(text: string): ExtractionRecord {
  const places = extractPlaces(text);
  const money = parseMoney(text);
  const bedrooms = parseBedrooms(text);

  const maxima = money.filter((m) => m.isMaximum).map((m) => m.value);
  const plain = money.filter((m) => !m.isMaximum).map((m) => m.value);

  let budgetMin: number | null = null;
  let budgetMax: number | null = null;
  if (maxima.length) {
    budgetMax = Math.max(...maxima);
  }
  if (plain.length >= 2) {
    // Two bare figures in one sentence is a range far more often than it is
    // two unrelated prices.
    budgetMin = Math.min(...plain);
    budgetMax = Math.max(budgetMax ?? 0, Math.max(...plain)) || null;
  } else if (plain.length === 1 && budgetMax == null) {
    budgetMax = plain[0];
  }

  const currency = money.find((m) => m.currency)?.currency ?? null;

  const lower = String(text ?? '').toLowerCase();
  /*
   * BUY IS THE HARDEST OF THE THREE, IN GEORGIAN.
   *
   * The pattern used to require the literal adjacent words "მინდა ბინა", and
   * almost nobody says it that way: "კრწანისში მინდა ორ საძინებლიანი ბინა"
   * puts a district and two adjectives between the verb and the noun. So the
   * single most common opening sentence in the whole product came back with
   * no intent at all, and the assistant asked whether they wanted to buy or
   * rent immediately after being told.
   *
   * The gap is bounded and stops at sentence punctuation, so "ბინა მაქვს.
   * მინდა ვნახო რამე" does not read as wanting to buy one.
   */
  const transactionType =
    /\b(rent|rental|lease)\b|ქირავდება|ვქირაობ|ქირაობ|ქირით|გასაქირავებ|аренд|снять|kiralık/u.test(lower) ? 'RENT'
    : /\b(sell|selling)\b|ვყიდი\b|გასაყიდ|იყიდება|продать|продаю|satılık/u.test(lower) ? 'SELL'
    : /\b(buy|buying|purchase)\b|ვყიდულობ|ვიყიდ|ყიდვა|შეძენ|შესაძენ|шеиძინ|купить|куплю|покупк|satın/u.test(lower)
      || /მინდა[^.?!]{0,40}?(ბინა|ბინის|სახლ|ფართ|ნაკვეთ)/u.test(lower)
      || /ვეძებ[^.?!]{0,40}?(ბინა|ბინის|სახლ|ფართ)/u.test(lower) ? 'BUY'
    : null;

  // Confidence reflects how much was actually found, not a flat constant: an
  // extraction that resolved a district and a budget is worth more than one
  // that found nothing.
  const found = [places.length > 0, budgetMax != null, bedrooms != null, transactionType != null]
    .filter(Boolean).length;

  return {
    method: 'DETERMINISTIC',
    confidence: found === 0 ? 0 : Math.min(0.95, 0.6 + found * 0.09),
    at: new Date().toISOString(),
    transactionType,
    locations: places.length ? places.map((p) => p.id) : null,
    budgetMin,
    budgetMax,
    currency,
    bedrooms,
  };
}

/** Fields whose value is a measured number rather than a judgement. */
const NUMERIC_FIELDS: Array<keyof Extraction> = ['budgetMin', 'budgetMax', 'bedrooms'];

/** Fields only a model or a human can produce; code never competes for these. */
const SEMANTIC_FIELDS: Array<keyof Extraction> = [
  'summary', 'objection', 'nextAction', 'interestLevel', 'timeline', 'propertyType',
];

export interface MergeDecision {
  field: keyof Extraction;
  action: 'KEPT' | 'REPLACED' | 'FILLED';
  /** Why, so a contact's history can explain where each value came from. */
  because: string;
}

export interface MergeResult {
  merged: Extraction;
  decisions: MergeDecision[];
}

/**
 * Decide what a new extraction is allowed to change about what is already known.
 *
 * The three rules, in order:
 *
 *   1. An empty slot is filled by anything. Nothing is lost.
 *   2. A human-confirmed value is never overwritten by a machine, at any
 *      confidence. This is the §42 rule stated literally.
 *   3. Otherwise the more confident record wins, with one deliberate
 *      exception: on numeric fields a deterministic parse beats an LLM even
 *      when the LLM claims to be more confident, because a model's stated
 *      confidence about a figure it paraphrased is not evidence about the
 *      figure.
 */
export function mergeExtraction(
  existing: ExtractionRecord | null,
  incoming: ExtractionRecord,
): MergeResult {
  const decisions: MergeDecision[] = [];
  if (!existing) {
    return { merged: stripMeta(incoming), decisions: [{ field: 'summary', action: 'FILLED', because: 'first extraction for this contact' }] };
  }

  const merged: Extraction = stripMeta(existing);
  const fields = new Set<keyof Extraction>([
    ...(Object.keys(stripMeta(existing)) as Array<keyof Extraction>),
    ...(Object.keys(stripMeta(incoming)) as Array<keyof Extraction>),
  ]);

  for (const field of fields) {
    const oldValue = (existing as Extraction)[field];
    const newValue = (incoming as Extraction)[field];

    if (newValue === null || newValue === undefined || newValue === '') continue;

    if (oldValue === null || oldValue === undefined || oldValue === '') {
      (merged as Record<string, unknown>)[field] = newValue;
      decisions.push({ field, action: 'FILLED', because: 'no value was known' });
      continue;
    }

    if (existing.method === 'HUMAN' && incoming.method !== 'HUMAN') {
      decisions.push({ field, action: 'KEPT', because: 'the existing value was confirmed by a person' });
      continue;
    }

    if (NUMERIC_FIELDS.includes(field)
      && existing.method === 'DETERMINISTIC' && incoming.method === 'LLM') {
      decisions.push({ field, action: 'KEPT', because: 'a measured value outranks a model paraphrase on a number' });
      continue;
    }

    if (SEMANTIC_FIELDS.includes(field) && incoming.method === 'DETERMINISTIC') {
      decisions.push({ field, action: 'KEPT', because: 'this field is not something code can judge' });
      continue;
    }

    if (incoming.confidence > existing.confidence) {
      (merged as Record<string, unknown>)[field] = newValue;
      decisions.push({
        field, action: 'REPLACED',
        because: `newer extraction is more confident (${incoming.confidence.toFixed(2)} vs ${existing.confidence.toFixed(2)})`,
      });
    } else {
      decisions.push({ field, action: 'KEPT', because: 'the existing value is at least as confident' });
    }
  }

  return { merged, decisions };
}

function stripMeta(r: ExtractionRecord | Extraction): Extraction {
  const { ...rest } = r as ExtractionRecord;
  delete (rest as Partial<ExtractionRecord>).method;
  delete (rest as Partial<ExtractionRecord>).confidence;
  delete (rest as Partial<ExtractionRecord>).at;
  return rest as Extraction;
}

// ── When to spend money on extraction ───────────────────────────────────────

export interface ExtractionBudgetInput {
  status: string;
  durationSec: number;
  transcriptChars: number;
  turns: number;
}

export type ExtractionPlan = 'SKIP' | 'DETERMINISTIC_ONLY' | 'FULL';

/**
 * §138. Do not summarise every provider event with a large model.
 *
 * A call nobody answered has no content. A four-second connect has no content
 * either. A one-turn exchange is cheap enough to parse with code and not worth
 * a model. Everything above that is a real conversation and earns the spend.
 */
export function planExtraction(input: ExtractionBudgetInput): ExtractionPlan {
  const dead = ['NO_ANSWER', 'BUSY', 'FAILED', 'CANCELLED', 'SUPPRESSED', 'OPTED_OUT'];
  if (dead.includes(input.status)) return 'SKIP';
  if (input.transcriptChars < 20) return 'SKIP';
  if (input.durationSec < 8) return 'SKIP';
  if (input.turns <= 1 || input.transcriptChars < 160) return 'DETERMINISTIC_ONLY';
  return 'FULL';
}

/**
 * A lead score that can be explained, which is the only kind worth storing.
 * Weighted evidence, capped at 100, with the contributing reasons returned
 * alongside so the CRM can show why a contact is a 74.
 */
export function scoreLead(e: Extraction): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const add = (n: number, why: string) => { score += n; reasons.push(why); };

  if (e.transactionType && e.transactionType !== 'UNKNOWN') add(12, `stated intent: ${e.transactionType}`);
  if (e.budgetMax) add(20, 'gave a budget');
  if (e.locations?.length) add(15, `named ${e.locations.length} location(s)`);
  if (e.bedrooms != null) add(8, 'specified size');
  if (e.propertyType) add(6, 'specified property type');
  if (e.viewingInterest) add(22, 'asked about a viewing');
  if (e.callbackRequested) add(12, 'asked to be called back');
  if (e.interestLevel === 'HIGH') add(18, 'high stated interest');
  else if (e.interestLevel === 'MEDIUM') add(8, 'moderate interest');
  else if (e.interestLevel === 'NONE') add(-30, 'said they are not interested');
  if (e.timeline && /week|month|soon|ASAP|კვირ|თვე|недел|месяц/i.test(e.timeline)) add(10, 'near-term timeline');

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}
