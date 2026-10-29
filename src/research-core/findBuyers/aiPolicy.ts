// FIND BUYERS / SIGNAL CLASSIFICATION — when a language model may be asked at all.
//
// Owner, 2026-10-29: Find Buyers/Tenants and internal matching are code first. Rules
// (demandClassifier.ts, intent/constraints.ts, places.ts, queryPlanner.ts …) decide
// everything they can; a model is consulted only for the remainder the rules mark
// EXPLICITLY ambiguous, only when an admin switch says so, and never for more than a
// fixed number of items per run.
//
// Every switch here defaults OFF. Only a stored `true` turns one on: a missing row, an
// unreadable value, a typo, `"yes"`, `1` or `{}` all mean OFF. A model call that nobody
// switched on is a cost nobody approved.
//
// Pure: no I/O, no model, no clock. The edge code reads admin_settings and asks these.

/** admin_settings keys of the model switches (all default OFF). */
export const AI_SWITCHES = {
  /** Find Buyers: the model may classify candidates the rules mark ambiguous. */
  FIND_BUYERS_AMBIGUOUS: 'find_buyers_ai_ambiguous',
  /** Find Buyers: the model may ADD search phrasings (QUERY_PLAN) and propose adaptive-round actions. */
  FIND_BUYERS_PLANNING: 'find_buyers_ai_planning',
  /** classify-signals-v2: the model may classify signals the rules mark ambiguous. */
  SIGNALS_AMBIGUOUS: 'classify_signals_ai_ambiguous',
} as const;

/**
 * Retired: `find_buyers_ai_first` sent EVERY candidate to the model unless a row said false.
 * It is no longer read; listed so nobody re-adds it believing it is live.
 */
export const RETIRED_AI_SWITCHES = ['find_buyers_ai_first'] as const;

/** Hard cap: distinct ambiguous texts one Find Buyers provider run may send to the model. */
export const FIND_BUYERS_AI_MAX_ITEMS_PER_RUN = 20;
/** Hard cap: ambiguous signals one classify-signals-v2 tick may send to the model. */
export const SIGNALS_AI_MAX_ITEMS_PER_TICK = 40;

/** A switch's stored value → on/off. Only boolean true (or the JSON string "true") is ON. */
export function aiSwitchOn(raw: unknown): boolean {
  if (raw === true) return true;
  if (typeof raw === 'string') return raw.trim().replace(/^"|"$/g, '').toLowerCase() === 'true';
  return false;
}

/** The fields of a rule reading this policy looks at (demandClassifier.DemandReading). */
export interface RuleAmbiguity {
  needsModel: boolean;
  realEstate: boolean;
}

/**
 * Explicitly ambiguous: the rules themselves said they could not decide (needsModel), the text
 * is about real estate, and there is something to read. Everything else is decided by code.
 */
export function explicitlyAmbiguous(reading: RuleAmbiguity | null | undefined, text: string | null | undefined): boolean {
  return reading?.needsModel === true && reading.realEstate === true && String(text ?? '').trim().length >= 3;
}

/**
 * The items a model may see in one run: none unless the switch is on; then only ambiguous ones,
 * one per key (the same words are never paid for twice), at most `cap` (never above `maxCap`).
 */
export function selectForModel<T>(items: readonly T[], opts: {
  enabled: boolean;
  ambiguous: (item: T) => boolean;
  key?: (item: T) => string;
  cap: number;
  maxCap: number;
}): T[] {
  if (opts.enabled !== true) return [];
  const cap = Math.max(0, Math.min(opts.maxCap, Math.floor(Number.isFinite(opts.cap) ? opts.cap : 0)));
  if (cap === 0) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (!opts.ambiguous(item)) continue;
    const k = opts.key ? opts.key(item) : null;
    if (k != null) {
      if (seen.has(k)) continue;
      seen.add(k);
    }
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}
