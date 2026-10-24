// CONTRACT INTELLIGENCE — from proposed changes to a revised contract.
//
// The analysis proposes; the signer decides. This module turns the
// decisions into a revised text and says exactly what it did:
//
//   · a change is applied only where the original wording is found in the
//     stored contract text, and only the first match is replaced;
//   · a change whose wording cannot be found is reported as UNPLACED and the
//     text is left as it was. Nothing is ever changed silently or guessed;
//   · an accepted new clause (for a missing protection) is added at the end,
//     under its own heading, never woven into existing wording.
//
// Pure: no React, no network. The page and the exports call it.

export type DecisionStatus = 'ACCEPTED' | 'EDITED' | 'REJECTED';
export interface Decision { key: string; status: DecisionStatus; text?: string }

export interface ReviewLike { risk: string; why: string; favours: string; suggestion: string; tradeoffs: string | null }
export interface AnalysisLike {
  clauses: { label: string; plain: string; quote: string; page: number | null; attention: string; review?: ReviewLike }[];
  missingProtections: { label: string; plain: string; review?: ReviewLike }[];
}

export interface ReviewItem {
  key: string;
  kind: 'CLAUSE' | 'MISSING';
  label: string;
  plain: string;
  /** Verbatim wording from the contract; null for a protection that is absent. */
  original: string | null;
  page: number | null;
  attention: string | null;
  review: ReviewLike;
}

/** Every flagged clause and missing protection that came with a usable proposal. */
export function reviewItems(analysis: AnalysisLike | null): ReviewItem[] {
  if (!analysis) return [];
  const out: ReviewItem[] = [];
  analysis.clauses.forEach((c, i) => {
    if (c.review && c.attention !== 'NORMAL') {
      out.push({ key: `c:${i}`, kind: 'CLAUSE', label: c.label, plain: c.plain, original: c.quote, page: c.page, attention: c.attention, review: c.review });
    }
  });
  (analysis.missingProtections ?? []).forEach((m, i) => {
    if (m.review) out.push({ key: `m:${i}`, kind: 'MISSING', label: m.label, plain: m.plain, original: null, page: null, attention: null, review: m.review });
  });
  return out;
}

/** The wording a decision puts into the contract, or null when it changes nothing. */
export function replacementFor(item: ReviewItem, decision: Decision | undefined): string | null {
  if (!decision || decision.status === 'REJECTED') return null;
  const text = decision.status === 'EDITED' ? (decision.text ?? '').trim() : item.review.suggestion.trim();
  return text ? text : null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where the quoted wording sits in the text: exact first, then the same words with any spacing. */
export function locate(text: string, quote: string): { start: number; end: number } | null {
  const exact = text.indexOf(quote);
  if (exact >= 0) return { start: exact, end: exact + quote.length };
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const m = new RegExp(words.map(escapeRe).join('\\s+'), 'i').exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

export interface Change { key: string; label: string; before: string | null; after: string }
export interface RevisionResult {
  text: string;
  changes: Change[];
  /** Accepted changes whose original wording could not be found: shown, never applied. */
  unplaced: string[];
}

export function applyDecisions(original: string, items: ReviewItem[], decisions: Decision[], addedHeading: string): RevisionResult {
  const byKey = new Map(decisions.map((d) => [d.key, d]));
  type Edit = { start: number; end: number; after: string; item: ReviewItem };
  const edits: Edit[] = [];
  const unplaced: string[] = [];
  const added: Change[] = [];

  for (const item of items) {
    const after = replacementFor(item, byKey.get(item.key));
    if (after === null) continue;
    if (item.kind === 'MISSING' || item.original === null) {
      added.push({ key: item.key, label: item.label, before: null, after });
      continue;
    }
    const at = locate(original, item.original);
    // Two proposals touching the same words would make the result depend on order: the second is unplaced.
    if (!at || edits.some((e) => at.start < e.end && e.start < at.end)) { unplaced.push(item.key); continue; }
    edits.push({ ...at, after, item });
  }

  edits.sort((a, b) => a.start - b.start);
  let text = '';
  let cursor = 0;
  const changes: Change[] = [];
  for (const e of edits) {
    text += original.slice(cursor, e.start) + e.after;
    changes.push({ key: e.item.key, label: e.item.label, before: original.slice(e.start, e.end), after: e.after });
    cursor = e.end;
  }
  text += original.slice(cursor);
  if (added.length) {
    text += `\n\n${addedHeading}\n` + added.map((a, i) => `${i + 1}. ${a.after}`).join('\n');
    changes.push(...added);
  }
  return { text, changes, unplaced };
}
