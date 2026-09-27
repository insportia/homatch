// WHAT SOMEBODY CURRENTLY WANTS, OUT OF EVERYTHING THEY HAVE EVER SAID.
//
// `intent_signals` is EVIDENCE. Every row is a thing that was said, at a time, on a
// surface, and it stays said forever — a signal is never edited to keep it current and
// never deleted to make it wrong. That is what makes provenance possible.
//
// It is also why the matcher must not read it.
//
// Handed the raw table, the matcher would see a customer's Monday budget and their
// Thursday budget as two live requirements and satisfy neither; it would see a flat
// rejected in March still matching in June; it would see "I'd prefer Vake" from one
// message and "only Saburtalo" from another and treat both as rules. Contradictions do
// not resolve themselves by accumulating.
//
// So this is the layer in between: evidence in, one current state out.
//
// THE FOUR RULES IT EXISTS TO ENFORCE
//
//   A LATER STATEMENT REFINES AN EARLIER ONE, PER DIMENSION. "I could go to 180" changes
//   the budget and says nothing about the city, the bedrooms or the transaction — so it
//   must not rebuild the requirement from one sentence and lose the rest. Rebuilding is
//   the bug that looks like a feature until somebody's district quietly disappears.
//
//   A PROPERTY IS NOT A SEARCH. "I'm not interested in this one any more" ends one
//   relationship. A customer who says it about a flat in Vake has not stopped wanting to
//   buy, and a resolver that let a PROPERTY-scoped rejection touch the general demand
//   would cancel their search on their behalf.
//
//   TWO DEMANDS ARE TWO DEMANDS. Somebody buying a flat and renting an office has two
//   requirements, not one impossible one. They are kept apart by what they transact in,
//   because that is the thing that genuinely cannot be merged.
//
//   A COMPLAINT MOVES NOTHING ON ITS OWN. An objection is recorded against its dimension
//   and does not create interest, end interest, or change a constraint. "It's expensive"
//   is a fact about how somebody feels about a price, and the price is still the price.

import type { Firmness, IntentDimension } from './interpret.ts';

/** One row of evidence, in the shape the table stores it. */
export interface SignalRow {
  id: string;
  actorUserId: string;
  side: 'DEMAND' | 'SUPPLY' | 'PROPERTY_INTEREST';
  act: 'REQUIREMENT' | 'INTEREST' | 'REJECTION' | 'OBJECTION' | 'INQUIRY' | 'TRANSACTION_INTENT';
  dimension: IntentDimension | null;
  polarity: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  attribution: 'SELF' | 'THIRD_PARTY' | 'QUOTED' | 'UNKNOWN';
  scope: 'PROPERTY' | 'SEARCH' | 'GENERAL';
  explicit: boolean;
  confidence: number;
  sourceAt: string;
  propertyId: string | null;
  intentProfileId: string | null;
  constraints: Record<string, unknown>;
  strength: Record<string, Firmness>;
  supersededBy?: string | null;
  withdrawnAt?: string | null;
}

/** One current requirement, ready for the matcher. */
export interface EffectiveDemand {
  /** What separates this requirement from the person's other ones. */
  key: string;
  actorUserId: string;
  side: 'DEMAND' | 'SUPPLY';
  /** Named when the requirement belongs to a persisted search. */
  intentProfileId: string | null;
  constraints: Record<string, unknown>;
  strength: Record<string, Firmness>;
  /** The lowest confidence of any signal that still contributes to this state. */
  confidence: number;
  /** When the most recent contributing statement was made. */
  lastStatedAt: string;
  /** Every signal that contributed, newest first. Provenance, not payload. */
  evidence: string[];
}

/** How somebody currently stands towards one specific property. */
export interface EffectivePropertyInterest {
  actorUserId: string;
  propertyId: string;
  /** INTERESTED until they say otherwise; REJECTED once they do. */
  state: 'INTERESTED' | 'REJECTED' | 'ENQUIRED';
  /** Dimensions they complained about. Recorded, and not a rejection. */
  objections: IntentDimension[];
  lastStatedAt: string;
  evidence: string[];
}

export interface EffectiveIntent {
  demands: EffectiveDemand[];
  properties: EffectivePropertyInterest[];
}

/**
 * Whether a row still counts.
 *
 * Withdrawn covers the source message being edited or deleted: the evidence stays, the
 * effect stops. Superseded covers the ordinary case of somebody changing their mind.
 *
 * Attribution is the hard gate. A third-party or quoted sentence is real intelligence and
 * is never this person's requirement — "my brother is looking" must not become their
 * search, in this layer or any other.
 */
function contributes(signal: SignalRow): boolean {
  if (signal.withdrawnAt) return false;
  if (signal.supersededBy) return false;
  return signal.attribution === 'SELF';
}

/** Oldest first, so later statements land on top of earlier ones. */
function byTime(a: SignalRow, b: SignalRow): number {
  return Date.parse(a.sourceAt) - Date.parse(b.sourceAt);
}

/**
 * WHAT SEPARATES ONE REQUIREMENT FROM ANOTHER.
 *
 * A persisted search is its own requirement and says so — that is what the id is for.
 * Otherwise it is the transaction: buying and renting are two different things to want,
 * and merging them produces a requirement that nothing can satisfy, because no property
 * is both for sale and to let to the same person at once.
 *
 * Deliberately NOT the city or the property type. Somebody who says "Vake" on Monday and
 * "Saburtalo or Vake" on Thursday has refined one requirement, not started a second, and
 * keying on location would leave them with two half-requirements and no way to see why.
 */
function demandKey(signal: SignalRow): string {
  /*
   * THE ACTOR IS PART OF THE KEY, and leaving them out was a real defect this module
   * shipped with for about ten minutes. Callers will usually pass one person's signals,
   * which is exactly why the omission would have survived: it is invisible until
   * somebody resolves a batch, and then two customers who both want to buy become one
   * requirement holding whichever city was written last.
   */
  if (signal.intentProfileId) return `search:${signal.intentProfileId}`;
  const transaction = String(signal.constraints.transactionType ?? '').toUpperCase();
  return `${signal.actorUserId}:${signal.side}:${transaction || 'UNSPECIFIED'}`;
}

/**
 * Resolve evidence into current state.
 *
 * Pure, total, and order-independent in its input: the rows may arrive in any order and
 * the result is the same, because everything that depends on sequence is decided by
 * `sourceAt` rather than by position.
 */
export function resolveEffectiveIntent(signals: readonly SignalRow[]): EffectiveIntent {
  const live = signals.filter(contributes).slice().sort(byTime);

  /* ── requirements ────────────────────────────────────────────────────── */
  const demands = new Map<string, EffectiveDemand>();

  for (const signal of live) {
    if (signal.side !== 'DEMAND' && signal.side !== 'SUPPLY') continue;
    /*
     * ONLY A STATEMENT OF WANTS BUILDS A REQUIREMENT. A question is engagement and a
     * complaint is feedback; neither says what somebody is looking for, and letting
     * either through would create a search out of a sentence that named no requirements.
     */
    if (signal.act !== 'REQUIREMENT' && signal.act !== 'TRANSACTION_INTENT') continue;
    /* A PROPERTY-scoped statement is about that property. It refines no search. */
    if (signal.scope === 'PROPERTY') continue;

    const key = demandKey(signal);
    const current = demands.get(key);

    if (!current) {
      demands.set(key, {
        key,
        actorUserId: signal.actorUserId,
        side: signal.side,
        intentProfileId: signal.intentProfileId,
        constraints: { ...signal.constraints },
        strength: { ...signal.strength },
        confidence: signal.confidence,
        lastStatedAt: signal.sourceAt,
        evidence: [signal.id],
      });
      continue;
    }

    /*
     * PER DIMENSION, AND ONLY THE ONES THIS STATEMENT NAMED.
     *
     * "I could go to 180" carries a budget and nothing else. Spreading the whole new
     * object over the old one would blank the city, the bedrooms and the transaction —
     * which is the failure that looks like the customer changing their mind about
     * everything because they mentioned one number.
     */
    for (const [dimension, value] of Object.entries(signal.constraints)) {
      if (value === null || value === undefined) continue;
      current.constraints[dimension] = value;
    }
    for (const [dimension, firmness] of Object.entries(signal.strength)) {
      current.strength[dimension] = firmness;
    }
    /* The state is only as certain as the least certain thing still holding it up. */
    current.confidence = Math.min(current.confidence, signal.confidence);
    current.lastStatedAt = signal.sourceAt;
    current.intentProfileId = current.intentProfileId ?? signal.intentProfileId;
    current.evidence.unshift(signal.id);
  }

  /* ── one property at a time ──────────────────────────────────────────── */
  const properties = new Map<string, EffectivePropertyInterest>();

  for (const signal of live) {
    if (!signal.propertyId) continue;
    if (signal.act === 'REQUIREMENT') continue;

    const key = `${signal.actorUserId}:${signal.propertyId}`;
    const current = properties.get(key) ?? {
      actorUserId: signal.actorUserId,
      propertyId: signal.propertyId,
      state: 'ENQUIRED' as const,
      objections: [] as IntentDimension[],
      lastStatedAt: signal.sourceAt,
      evidence: [] as string[],
    };

    switch (signal.act) {
      case 'INTEREST':
      case 'TRANSACTION_INTENT':
        current.state = 'INTERESTED';
        break;
      case 'REJECTION':
        current.state = 'REJECTED';
        break;
      case 'OBJECTION':
        /*
         * RECORDED, AND IT MOVES NOTHING. This is the correction the whole vocabulary
         * exists for: somebody calling a flat expensive has neither withdrawn nor
         * expressed interest. The complaint is worth knowing and worth nothing as
         * evidence either way.
         */
        if (signal.dimension && !current.objections.includes(signal.dimension)) {
          current.objections.push(signal.dimension);
        }
        break;
      case 'INQUIRY':
        /* Asking is engagement. It does not upgrade to interest and does not undo a
           rejection somebody already made. */
        if (current.state !== 'INTERESTED' && current.state !== 'REJECTED') {
          current.state = 'ENQUIRED';
        }
        break;
      default:
        break;
    }

    current.lastStatedAt = signal.sourceAt;
    current.evidence.unshift(signal.id);
    properties.set(key, current);
  }

  return {
    demands: [...demands.values()],
    properties: [...properties.values()],
  };
}
