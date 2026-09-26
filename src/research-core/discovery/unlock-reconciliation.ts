// A CHARGE WITH NOTHING BEHIND IT: FOUR ANSWERS, NOT ONE.
//
// Four MATCH_UNLOCK rows in the credit ledger had no match_unlocks record and no
// surviving match. They were reported for weeks as "charged without a match",
// and the standing explanation was that re-classification had changed
// intent_profile_id and the matches had been rewritten underneath them.
//
// That explanation was WRONG, and this module exists because "plausible" read
// like "established" for too long.
//
// WHAT ACTUALLY HAPPENED, measured 2026-09-26
//
//   17:44:23  ADMIN_ADJUSTMENT  +10000.00   "Founder testing credits"
//   17:47:31  MATCH_UNLOCK          -0.10   match:8542037b…
//   17:47:54  MATCH_UNLOCK          -0.10   match:e854dd97…
//   17:48:03  MATCH_UNLOCK          -0.10   match:3cee6ca7…
//   17:48:07  MATCH_UNLOCK          -0.10   match:6b3956a1…
//   17:50:43  REFUND                +0.40   "Refund: four invalid supply-side
//                                            matches removed"
//
// Two minutes and thirty-six seconds. The charges were reversed in full, in the
// same sitting, by somebody who wrote down why. The balance chain is unbroken:
// 10000.00 → 9999.60 → 10000.00.
//
// The matches are gone because they were DELETED for being invalid, and
// match_unlocks.match_id is ON DELETE RESTRICT, so the unlock records had to be
// removed first — which is exactly the two-step an operator performs
// deliberately and never the shape of a cascade or a rewrite.
//
// So: nothing to remediate, nobody double-charged, and the ledger was right the
// whole time. The orphan is only visible to somebody who looks at MATCH_UNLOCK
// rows in isolation and does not read the REFUND two rows later.
//
// WHY THIS IS CODE AND NOT A NOTE IN A REPORT
//
// Because the next orphan will look identical to this one for the first ten
// minutes, and the question "is this explained history or is it money somebody
// lost" must have a mechanical answer rather than a remembered one. An orphaned
// charge is EXPLAINED only when a reversal covers it. Absence of a match is not
// evidence of either.
//
// NOTHING HERE MUTATES ANYTHING. It classifies. Remediation is a decision for a
// person holding the evidence, and this module's job is to produce the evidence.

/** The four answers, and there is no fifth that means "probably fine". */
export type UnlockVerdict =
  /** The charge is accounted for: an unlock record survives, or a reversal covers it. */
  | 'EXPLAINED_VALID_HISTORY'
  /** The row points at something that no longer exists, and nothing reversed it. */
  | 'ORPHANED_REFERENCE'
  /** One match was charged for more than once with no reversal between. */
  | 'POSSIBLE_DOUBLE_CHARGE'
  /** Not enough information. Never used to mean "looks all right". */
  | 'UNKNOWN';

export interface LedgerRow {
  id: string;
  userId: string;
  /** Negative for a charge, positive for a credit. */
  amount: number;
  type: string;
  /** `match:<uuid>` for an unlock charge. */
  reference: string | null;
  createdAt: string;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
}

export interface UnlockRecord {
  id: string;
  matchId: string;
  userId: string;
  ledgerEntryId: string | null;
  creditsCharged: number;
}

export interface ReconciliationInput {
  ledger: readonly LedgerRow[];
  unlocks: readonly UnlockRecord[];
  /** Match ids that still exist. Anything else has been deleted. */
  existingMatchIds: readonly string[];
}

export interface UnlockFinding {
  ledgerId: string;
  userId: string;
  matchId: string | null;
  amount: number;
  createdAt: string;
  verdict: UnlockVerdict;
  /** What the customer actually got. Separate from whether the books balance. */
  valueDelivered: boolean;
  /** The reversal that covers this charge, when one does. */
  reversedBy?: { ledgerId: string; amount: number; reference: string | null; createdAt: string };
  /** Plain English. Written for somebody deciding whether to move money. */
  evidence: string;
}

/** Ledger types that can reverse a charge. */
const REVERSAL_TYPES = new Set(['REFUND', 'ADMIN_ADJUSTMENT', 'REVERSAL', 'CHARGEBACK']);

/** Ledger type that charges for revealing a match. */
const UNLOCK_TYPE = 'MATCH_UNLOCK';

/**
 * How long after a charge a credit may still be read as reversing it.
 *
 * Twenty-four hours. A refund issued the same day, naming the thing it reverses,
 * is a reversal; a top-up three weeks later is a top-up, and treating it as a
 * reversal would let any later credit explain away any earlier loss. The real
 * case closed in 2 minutes 36 seconds.
 */
const REVERSAL_WINDOW_MS = 24 * 60 * 60 * 1000;

export function matchIdFromReference(reference: string | null): string | null {
  if (!reference) return null;
  const match = /^match:([0-9a-f-]{36})$/i.exec(reference.trim());
  return match ? (match[1] as string).toLowerCase() : null;
}

/**
 * Reconcile every unlock charge against the records and reversals around it.
 *
 * Deliberately does NOT take "the match is missing" as a problem on its own. A
 * deleted match with a reversal behind it is a tidy piece of history; a deleted
 * match with the money still gone is the thing worth waking somebody for.
 */
export function reconcileUnlockCharges(input: ReconciliationInput): UnlockFinding[] {
  const existing = new Set(input.existingMatchIds.map((id) => id.toLowerCase()));

  const unlocksByLedger = new Map<string, UnlockRecord>();
  const unlocksByMatch = new Map<string, UnlockRecord[]>();
  for (const unlock of input.unlocks) {
    if (unlock.ledgerEntryId) unlocksByLedger.set(unlock.ledgerEntryId, unlock);
    const key = unlock.matchId.toLowerCase();
    const list = unlocksByMatch.get(key) ?? [];
    list.push(unlock);
    unlocksByMatch.set(key, list);
  }

  const charges = input.ledger
    .filter((row) => row.type === UNLOCK_TYPE && row.amount < 0)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const credits = input.ledger
    .filter((row) => REVERSAL_TYPES.has(row.type) && row.amount > 0)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  /*
   * A reversal is consumed once. Four 0.10 charges and one 0.40 refund is a
   * clean reconciliation; four 0.10 charges and one 0.10 refund explains one of
   * them, and the other three are still missing their money. Tracking the
   * remaining balance of each credit is what keeps the second case from reading
   * like the first.
   */
  const creditRemaining = new Map<string, number>(credits.map((row) => [row.id, row.amount]));

  /*
   * PASS ONE: which charges were given back?
   *
   * Chronological, and over EVERY charge rather than only the ones that look
   * broken. A first version checked for a reversal only when a charge had no
   * unlock record, and got "unlock, refund, unlock again" wrong: the refund
   * belonged to the first charge, which looked perfectly healthy and so never
   * claimed it, leaving the second charge to be reported as a double charge. The
   * customer had paid 35 credits once.
   *
   * So reversal matching is its own pass, and what the second pass sees is a
   * charge that either stands or does not.
   */
  const reversalFor = new Map<string, NonNullable<UnlockFinding['reversedBy']>>();
  for (const charge of charges) {
    const reversal = takeReversal(credits, creditRemaining, charge, Math.abs(charge.amount));
    if (reversal) reversalFor.set(charge.id, reversal);
  }

  const findings: UnlockFinding[] = [];
  /** Charges against one match that were NOT given back. More than one is the worry. */
  const standingCharges = new Map<string, number>();

  for (const charge of charges) {
    const matchId = matchIdFromReference(charge.reference);
    const unlock = unlocksByLedger.get(charge.id);
    const matchAlive = matchId !== null && existing.has(matchId);
    const owed = Math.abs(charge.amount);
    const reversal = reversalFor.get(charge.id);

    /* ── The ordinary case: the record is there and so is the match. ── */
    if (unlock && matchAlive) {
      if (reversal) {
        findings.push({
          ledgerId: charge.id, userId: charge.userId, matchId, amount: charge.amount,
          createdAt: charge.createdAt, verdict: 'EXPLAINED_VALID_HISTORY',
          // Charged and given back. The reveal happened, but the customer was
          // not left paying for it, so it is not a sale.
          valueDelivered: false,
          reversedBy: reversal,
          evidence:
            `charged ${owed} against match ${matchId} and reversed by ${reversal.ledgerId} `
            + `(+${reversal.amount}) at ${reversal.createdAt}`
            + (reversal.reference ? ` ("${reversal.reference}")` : '')
            + '. The unlock record stands as the history of what was shown; the money came back.',
        });
        continue;
      }

      const standing = (standingCharges.get(matchId as string) ?? 0) + 1;
      standingCharges.set(matchId as string, standing);

      if (standing > 1) {
        /*
         * The same match paid for twice, with neither payment given back. Only a
         * POSSIBILITY: a genuine re-purchase exists, and the reversal pass above
         * has already excused the case where one of them was refunded. What is
         * left is a customer who appears to have paid twice to see one person.
         */
        findings.push({
          ledgerId: charge.id, userId: charge.userId, matchId, amount: charge.amount,
          createdAt: charge.createdAt, verdict: 'POSSIBLE_DOUBLE_CHARGE', valueDelivered: true,
          evidence:
            `match ${matchId} carries ${standing} charges that were never reversed. The customer `
            + 'may have paid twice to see one person. Needs a human before any money moves: check '
            + 'whether the earlier reveal was actually delivered.',
        });
        continue;
      }

      findings.push({
        ledgerId: charge.id, userId: charge.userId, matchId, amount: charge.amount,
        createdAt: charge.createdAt, verdict: 'EXPLAINED_VALID_HISTORY', valueDelivered: true,
        evidence:
          `unlock ${unlock.id} records ${unlock.creditsCharged} credit(s) against match ${matchId}, `
          + 'which still exists. The charge bought something and the something is still there.',
      });
      continue;
    }

    /* ── The charge has no surviving record, no match, or neither. ── */
    if (reversal) {
      findings.push({
        ledgerId: charge.id, userId: charge.userId, matchId, amount: charge.amount,
        createdAt: charge.createdAt, verdict: 'EXPLAINED_VALID_HISTORY',
        // The reveal did not stand, which is precisely why it was refunded.
        valueDelivered: false,
        reversedBy: reversal,
        evidence:
          `no unlock record and ${matchAlive ? 'a surviving' : 'no surviving'} match, but `
          + `${reversal.ledgerId} credited +${reversal.amount} at ${reversal.createdAt}`
          + (reversal.reference ? ` ("${reversal.reference}")` : '')
          + `, which covers this ${owed}. The charge was taken and given back; the ledger keeps `
          + 'both halves because a ledger is append-only. Nothing is owed.',
      });
      continue;
    }

    if (matchId === null) {
      findings.push({
        ledgerId: charge.id, userId: charge.userId, matchId: null, amount: charge.amount,
        createdAt: charge.createdAt, verdict: 'UNKNOWN', valueDelivered: false,
        evidence:
          `the charge carries no "match:<uuid>" reference (${JSON.stringify(charge.reference)}), so `
          + 'there is nothing to trace it to. Not classified as orphaned: what it bought cannot be '
          + 'established either way from this row.',
      });
      continue;
    }

    findings.push({
      ledgerId: charge.id, userId: charge.userId, matchId, amount: charge.amount,
      createdAt: charge.createdAt, verdict: 'ORPHANED_REFERENCE', valueDelivered: false,
      evidence:
        `charged ${owed} for match ${matchId}, which `
        + (matchAlive ? 'exists but has no unlock record' : 'no longer exists')
        + ', and no credit within 24 hours covers it. The customer paid and there is no record of '
        + 'what they got. This needs evidence in front of a person before any balance changes.',
    });
  }

  return findings;
}

/**
 * Find a credit that can cover this charge, and consume that much of it.
 *
 * Nearest in time first, within the window. Matching the closest credit is what
 * makes "four charges, one 0.40 refund" resolve as four explained rows rather
 * than one explained and three mysteries.
 */
function takeReversal(
  credits: readonly LedgerRow[],
  remaining: Map<string, number>,
  charge: LedgerRow,
  owed: number,
): UnlockFinding['reversedBy'] | null {
  const chargeAt = Date.parse(charge.createdAt);

  const usable = credits
    .filter((credit) => credit.userId === charge.userId)
    .filter((credit) => (remaining.get(credit.id) ?? 0) >= owed - 1e-9)
    .filter((credit) => {
      const creditAt = Date.parse(credit.createdAt);
      // A reversal comes AFTER the thing it reverses.
      return creditAt >= chargeAt && creditAt - chargeAt <= REVERSAL_WINDOW_MS;
    })
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const credit = usable[0];
  if (!credit) return null;

  remaining.set(credit.id, (remaining.get(credit.id) ?? 0) - owed);
  return {
    ledgerId: credit.id,
    amount: credit.amount,
    reference: credit.reference,
    createdAt: credit.createdAt,
  };
}

export interface ReconciliationSummary {
  charges: number;
  byVerdict: Record<UnlockVerdict, number>;
  /** Credits charged with no explanation. The only number that means trouble. */
  unexplainedAmount: number;
  /** Rows a person must look at before any money moves. */
  needsHuman: UnlockFinding[];
}

export function summariseReconciliation(findings: readonly UnlockFinding[]): ReconciliationSummary {
  const byVerdict: Record<UnlockVerdict, number> = {
    EXPLAINED_VALID_HISTORY: 0, ORPHANED_REFERENCE: 0, POSSIBLE_DOUBLE_CHARGE: 0, UNKNOWN: 0,
  };
  let unexplainedAmount = 0;
  const needsHuman: UnlockFinding[] = [];

  for (const finding of findings) {
    byVerdict[finding.verdict] += 1;
    if (finding.verdict === 'ORPHANED_REFERENCE' || finding.verdict === 'POSSIBLE_DOUBLE_CHARGE') {
      unexplainedAmount += Math.abs(finding.amount);
      needsHuman.push(finding);
    }
  }

  return {
    charges: findings.length,
    byVerdict,
    unexplainedAmount: Number(unexplainedAmount.toFixed(4)),
    needsHuman,
  };
}
