// evidence.ts — the canonical evidence layer.
//
// PROBLEM THIS SOLVES
// -------------------
// Five official documents mentioning the same owner used to become five
// customer-facing facts. The report repeated itself, and the repetition made
// weak evidence look like strong evidence purely by appearing more often.
//
// So: every factual claim is canonicalized to (type, subject, value). Claims
// that mean the same thing MERGE into one fact carrying ALL of their
// provenance, and the fact's evidence state is derived from how many
// independent sources agree — not from how many times it was mentioned.
//
// Two rules do the heavy lifting:
//
//   1. Repetition is not corroboration. Three mentions from the SAME source
//      are one source. Corroboration requires independent sources.
//   2. Disagreement is never averaged away. Two different values for the same
//      (type, subject) produce a CONFLICTING fact that keeps both, because
//      silently picking one would hide exactly the thing a buyer needs to know.
//
// NO EVIDENCE = NO FACT: a claim with no provenance is refused outright.

import type { EvidenceState, Finding } from './buyerPlan.ts';

export interface RawClaim {
  type: string;
  subject?: string | null;
  value: unknown;
  source: string;
  documentRef?: string | null;
  effectiveDate?: string | null;
  /** Set when a source states the ABSENCE of something ("not registered").
   * An explicit negative is real evidence, not missing data. */
  negative?: boolean;
}

export interface EvidenceRef {
  source: string;
  documentRef: string | null;
  effectiveDate: string | null;
}

export interface CanonicalFact {
  type: string;
  subject: string | null;
  value: unknown;
  state: EvidenceState;
  /** Every piece of evidence supporting this fact — kept internally, never
   * dumped on the customer. */
  evidence: EvidenceRef[];
  /** Distinct sources, which is what corroboration actually depends on. */
  sourceCount: number;
  /** Populated only for CONFLICTING facts. */
  conflicting?: { value: unknown; evidence: EvidenceRef[] }[];
  negative?: boolean;
}

/** Value normalization for comparison ONLY — the original value is preserved
 * on the fact. Casing, spacing, quotes and Georgian legal forms are not
 * meaningful differences between two statements of the same owner. */
export function canonicalizeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value)
    .toLowerCase()
    .replace(/[«»""''„]/g, ' ')
    .replace(/(^|\s)(შპს|სს|ააიპ|ltd\.?|llc|jsc)(\s|$)/g, ' ')
    .replace(/[.,;:()\-_/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function keyOf(c: { type: string; subject?: string | null }): string {
  return `${c.type}::${canonicalizeValue(c.subject ?? '')}`;
}

/**
 * Derives the evidence state from independent agreement.
 *
 * CONFIRMED     one authoritative source states it directly
 * CORROBORATED  two or more INDEPENDENT sources agree
 * CONFLICTING   sources disagree on the value
 * INFERRED      derived rather than stated
 * UNAVAILABLE   nothing states it
 */
export function deriveState(sourceCount: number, conflicting: boolean, inferred = false): EvidenceState {
  if (conflicting) return 'CONFLICTING';
  if (sourceCount === 0) return 'UNAVAILABLE';
  if (inferred) return 'INFERRED';
  return sourceCount >= 2 ? 'CORROBORATED' : 'CONFIRMED';
}

/**
 * Canonicalizes and merges raw claims into deduplicated facts.
 *
 * The same owner named by five documents becomes ONE fact with five evidence
 * references — which is exactly the mandate's example.
 */
export function normalizeEvidence(claims: RawClaim[]): CanonicalFact[] {
  const groups = new Map<string, RawClaim[]>();
  for (const c of claims) {
    if (!c || !c.type || !c.source) continue; // no provenance, no fact
    const list = groups.get(keyOf(c)) ?? [];
    list.push(c);
    groups.set(keyOf(c), list);
  }

  const facts: CanonicalFact[] = [];
  for (const [, list] of groups) {
    // Sub-group by canonical VALUE: same key, different value = conflict.
    const byValue = new Map<string, RawClaim[]>();
    for (const c of list) {
      const v = canonicalizeValue(c.value);
      const arr = byValue.get(v) ?? [];
      arr.push(c);
      byValue.set(v, arr);
    }

    const variants = [...byValue.entries()].map(([, cs]) => ({
      value: cs[0].value,
      claims: cs,
      sources: new Set(cs.map((c) => c.source)),
      evidence: cs.map((c) => ({
        source: c.source,
        documentRef: c.documentRef ?? null,
        effectiveDate: c.effectiveDate ?? null,
      })),
    }));

    // Strongest = most independent sources, then most evidence.
    variants.sort((a, b) => b.sources.size - a.sources.size || b.evidence.length - a.evidence.length);
    const winner = variants[0];
    const isConflict = variants.length > 1;

    facts.push({
      type: list[0].type,
      subject: list[0].subject ?? null,
      value: winner.value,
      state: deriveState(winner.sources.size, isConflict),
      evidence: winner.evidence,
      sourceCount: winner.sources.size,
      negative: list.some((c) => c.negative) || undefined,
      ...(isConflict
        ? { conflicting: variants.slice(1).map((v) => ({ value: v.value, evidence: v.evidence })) }
        : {}),
    });
  }
  return facts;
}

/** Bridges canonical facts into the shape the buyer-plan generators consume. */
export function toFindings(facts: CanonicalFact[]): Finding[] {
  return facts.map((f) => ({
    type: f.type,
    subject: f.subject,
    value: f.value,
    state: f.state,
    source: f.evidence[0]?.source ?? 'unknown',
    documentRef: f.evidence[0]?.documentRef ?? null,
    effectiveDate: f.evidence[0]?.effectiveDate ?? null,
  }));
}

/** Facts a customer should actually be told about, strongest first. Conflicts
 * surface FIRST: a disagreement between official sources is the single most
 * useful thing a buyer can learn. */
export function presentationOrder(facts: CanonicalFact[]): CanonicalFact[] {
  const rank: Record<EvidenceState, number> = {
    CONFLICTING: 0,
    CORROBORATED: 1,
    CONFIRMED: 2,
    INFERRED: 3,
    UNAVAILABLE: 4,
  };
  return [...facts].sort((a, b) => rank[a.state] - rank[b.state] || b.sourceCount - a.sourceCount);
}
