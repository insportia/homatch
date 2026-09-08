// HOMATCH — cross-checking an uploaded document against Verify evidence.
//
// This is the part of contract intelligence that carries the value: not
// "here is what your contract says", but "your contract says 94.1 m² and the
// official registry says 88.0 m² — ask about that before you pay."
//
// It is deliberately separated from text extraction. Extraction is plumbing
// (get characters out of a PDF); this is the reasoning, and it is pure,
// deterministic and testable without any document at all.
//
// WHAT IT REFUSES TO DO
// ---------------------
//   * It never states a legal conclusion. A mismatch produces a QUESTION for
//     the buyer to ask, never "this contract is invalid".
//   * It never reports a finding it cannot quote. A claim with no supporting
//     text from the document is dropped, exactly as an unsourced Verify claim
//     is dropped — the same NO EVIDENCE = NO FACT rule, applied to documents.
//   * It never marks a mismatch against evidence Verify could not confirm. If
//     the registry was never reached, the contract cannot "contradict" it;
//     that is UNVERIFIABLE, and the difference matters enormously.

import type { CanonicalFact } from '../planning/evidence.ts';

export type FindingType =
  | 'PARTY' | 'DATE' | 'AMOUNT' | 'OBLIGATION' | 'TERMINATION' | 'PENALTY'
  | 'DELIVERY_DATE' | 'AREA' | 'PAYMENT_SCHEDULE' | 'CLAUSE' | 'MISSING_EXPECTED';

export type VerifyRelation = 'UNRELATED' | 'AGREES' | 'CONTRADICTS' | 'UNVERIFIABLE';
export type Severity = 'INFO' | 'ATTENTION' | 'IMPORTANT';

/** One statement extracted from a document, before cross-checking. */
export interface ExtractedFinding {
  type: FindingType;
  label: string;
  value: string | null;
  /** The text this was read from. Required for anything to be reported. */
  quote: string | null;
  page?: number | null;
}

export interface CheckedFinding extends ExtractedFinding {
  verifyRelation: VerifyRelation;
  verifyFactType: string | null;
  verifyFactValue: string | null;
  severity: Severity;
  /** A question for the buyer, when one is warranted. Never a conclusion. */
  question: string | null;
}

/** Which Verify fact type each document finding should be compared against.
 * A finding with no mapping is simply UNRELATED — reported, not judged. */
const COMPARE_AGAINST: Partial<Record<FindingType, string>> = {
  AREA: 'property.area',
  PARTY: 'ownership.owner',
  AMOUNT: 'price.asking',
  DELIVERY_DATE: 'construction.status',
};

/* ------------------------------------------------------------------ *
 * Value comparison                                                    *
 * ------------------------------------------------------------------ */

/** Pulls the first number out of a string, tolerating both decimal separators
 * and thousands grouping. Georgian documents use both conventions. */
export function numberIn(s: unknown): number | null {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  if (typeof s !== 'string') return null;

  // Whitespace is NOT stripped first: in "1 250 000" the spaces ARE the
  // thousands grouping, and removing them made the leading pattern match only
  // "125". Grouped forms are therefore tried first, on the original text.
  //
  // A separator followed by exactly three digits is grouping; a comma followed
  // by anything else is a decimal comma, which is how Georgian documents write
  // "94,1". That distinction is what keeps 1,250,000 and 94,1 both correct.
  const grouped = s.match(/-?\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?/);
  if (grouped) {
    const n = Number(grouped[0].replace(/[ ,]/g, ''));
    if (Number.isFinite(n)) return n;
  }

  const plain = s.match(/-?\d+(?:[.,]\d+)?/);
  if (!plain) return null;
  const n = Number(plain[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Compares two areas.
 *
 * A tolerance is essential and is NOT a fudge: registries and contracts
 * legitimately round, and 94.1 vs 94.14 is the same flat. What must be caught
 * is a difference a buyer would care about — so the threshold is relative,
 * with an absolute floor so tiny properties are not flagged on rounding.
 */
export const AREA_TOLERANCE_RATIO = 0.01;
export const AREA_TOLERANCE_FLOOR = 0.2;

export function areasDiffer(a: number, b: number): boolean {
  const tolerance = Math.max(AREA_TOLERANCE_FLOOR, Math.abs(b) * AREA_TOLERANCE_RATIO);
  return Math.abs(a - b) > tolerance;
}

/** Loose name comparison: case, spacing, quotes and Georgian legal-form
 * prefixes are not meaningful differences between two spellings of one party. */
export function namesDiffer(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/["'«»„""]/g, '')
      .replace(/\b(შპს|სს|ააიპ| llc|ltd|jsc)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return !(x === y || x.includes(y) || y.includes(x));
}

/* ------------------------------------------------------------------ *
 * The cross-check                                                     *
 * ------------------------------------------------------------------ */

/**
 * Cross-checks extracted findings against normalized Verify evidence.
 *
 * Findings arrive in document order and leave in the same order; ranking for
 * display is the UI's job, and doing it here would hide the document's own
 * structure from anything that wants it.
 */
export function crossCheck(findings: ExtractedFinding[], facts: CanonicalFact[]): CheckedFinding[] {
  const out: CheckedFinding[] = [];

  for (const f of findings) {
    // NO EVIDENCE = NO FACT, applied to documents: an extraction that cannot
    // point at the text it came from is not shown as a contract fact.
    if (!f.quote || !f.quote.trim()) continue;
    if (!f.label || !f.label.trim()) continue;

    const targetType = COMPARE_AGAINST[f.type];
    const fact = targetType ? facts.find((x) => x.type === targetType) : undefined;

    // MISSING_EXPECTED is about the document's own silence, and has nothing to
    // compare against. It is always a question, never a conclusion.
    if (f.type === 'MISSING_EXPECTED') {
      out.push({
        ...f,
        verifyRelation: 'UNRELATED',
        verifyFactType: null,
        verifyFactValue: null,
        severity: 'ATTENTION',
        question: `The document does not appear to cover ${f.label}. Is that deliberate?`,
      });
      continue;
    }

    if (!targetType || !fact) {
      out.push({
        ...f,
        verifyRelation: 'UNRELATED',
        verifyFactType: targetType ?? null,
        verifyFactValue: null,
        severity: 'INFO',
        question: null,
      });
      continue;
    }

    // The registry was never reached, or the sources disagreed with each
    // other. Either way the contract cannot be said to contradict it — saying
    // so would manufacture a conflict out of our own missing coverage.
    if (fact.state === 'UNAVAILABLE' || fact.state === 'CONFLICTING') {
      out.push({
        ...f,
        verifyRelation: 'UNVERIFIABLE',
        verifyFactType: targetType,
        verifyFactValue: asText(fact.value),
        severity: 'INFO',
        question: `We could not independently confirm ${f.label}, so this could not be cross-checked.`,
      });
      continue;
    }

    const verdict = compare(f, fact);
    out.push({
      ...f,
      verifyRelation: verdict.relation,
      verifyFactType: targetType,
      verifyFactValue: asText(fact.value),
      severity: verdict.severity,
      question: verdict.question,
    });
  }

  return out;
}

const asText = (v: unknown): string | null =>
  typeof v === 'string' ? v : v == null ? null : JSON.stringify(v);

function compare(
  f: ExtractedFinding,
  fact: CanonicalFact
): { relation: VerifyRelation; severity: Severity; question: string | null } {
  const factText = asText(fact.value) ?? '';

  if (f.type === 'AREA') {
    const a = numberIn(f.value);
    const b = numberIn(factText);
    if (a === null || b === null) {
      return { relation: 'UNVERIFIABLE', severity: 'INFO', question: null };
    }
    if (areasDiffer(a, b)) {
      return {
        relation: 'CONTRADICTS',
        severity: 'IMPORTANT',
        // A question, not a conclusion. The contract may be right and the
        // registry stale, or the reverse — that is for the buyer to establish.
        question:
          `The document states ${a} m² but the official record states ${b} m². ` +
          `Ask which figure the sale is based on, and why they differ.`,
      };
    }
    return { relation: 'AGREES', severity: 'INFO', question: null };
  }

  if (f.type === 'PARTY') {
    if (!f.value) return { relation: 'UNVERIFIABLE', severity: 'INFO', question: null };
    if (namesDiffer(f.value, factText)) {
      return {
        relation: 'CONTRADICTS',
        severity: 'IMPORTANT',
        question:
          `The document names ${f.value}, but the official record shows ${factText}. ` +
          `Ask on what basis this party is entitled to sell.`,
      };
    }
    return { relation: 'AGREES', severity: 'INFO', question: null };
  }

  if (f.type === 'AMOUNT') {
    const a = numberIn(f.value);
    const b = numberIn(factText);
    if (a === null || b === null) return { relation: 'UNVERIFIABLE', severity: 'INFO', question: null };
    // Price is not a defect and asking prices legitimately move, so a
    // difference is informational rather than a contradiction.
    return {
      relation: a === b ? 'AGREES' : 'UNRELATED',
      severity: 'INFO',
      question: null,
    };
  }

  return { relation: 'UNRELATED', severity: 'INFO', question: null };
}

/** Rows for deal_room_document_findings. Kept here so the shape the database
 * stores is decided next to the logic that produces it. */
export function toFindingRows(
  checked: CheckedFinding[],
  ids: { documentId: string; dealRoomId: string; userId: string }
): Record<string, unknown>[] {
  return checked.map((c) => ({
    document_id: ids.documentId,
    deal_room_id: ids.dealRoomId,
    user_id: ids.userId,
    finding_type: c.type,
    label: c.label,
    value: c.value,
    quote: c.quote,
    page: c.page ?? null,
    verify_relation: c.verifyRelation,
    verify_fact_type: c.verifyFactType,
    verify_fact_value: c.verifyFactValue,
    severity: c.severity,
  }));
}
