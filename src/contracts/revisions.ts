// CONTRACT INTELLIGENCE — from proposed changes to a revised contract.
//
// The analysis proposes; the signer decides. This module turns the
// decisions into a revised text and says exactly what it did:
//
//   · a change is applied only where the original wording is found in the
//     stored contract text, and only the first match is replaced. "Found"
//     means the same characters in the same case; only the whitespace between
//     words may differ (PDF extraction wraps lines where the model does not);
//   · a change whose wording cannot be found, or whose quote was cut at the
//     analyser's 600 character cap (so it is only the start of the clause), is
//     reported as UNPLACED and the text is left as it was. It is still shown
//     to the signer; it is never inserted into an export by guesswork;
//   · an accepted new clause (for a missing protection) is added at the end,
//     under its own heading, never woven into existing wording.
//
// Decisions are keyed by a hash of the clause's own quote, not by its place in
// the analysis array, so a re-run that reorders clauses cannot move a decision
// onto a different clause. A saved revision also records which analysis it was
// made against (analysisIdentity); a revision from another analysis is stale.
//
// Pure: no React, no network. The page and the exports call it.

/** The edge function caps every quote at this many characters (documentExtract.ts MAX_QUOTE). */
export const QUOTE_CAP = 600;

export type DecisionStatus = 'ACCEPTED' | 'EDITED' | 'REJECTED';
export interface Decision { key: string; status: DecisionStatus; text?: string }

export interface ReviewLike { risk: string; why: string; favours: string; suggestion: string; tradeoffs: string | null; benefit?: string }
export interface AnalysisLike {
  clauses: { label: string; plain: string; quote: string; page: number | null; attention: string; review?: ReviewLike; quoteTruncated?: boolean }[];
  missingProtections: { label: string; plain: string; review?: ReviewLike }[];
  /** Hash of the stored analysis, written by the edge function (absent on older analyses). */
  analysisSha?: string;
  analysedAt?: string;
  /** The document text sent to the model was cut at MAX_DOCUMENT_CHARS. */
  textTruncated?: boolean;
}

export interface ReviewItem {
  key: string;
  kind: 'CLAUSE' | 'MISSING';
  label: string;
  plain: string;
  /** Verbatim wording from the contract; null for a protection that is absent. */
  original: string | null;
  /** The quote was cut at QUOTE_CAP, so it is only the start of the wording: never auto-placed. */
  quoteTruncated: boolean;
  page: number | null;
  attention: string | null;
  review: ReviewLike;
}

/**
 * cyrb53: a small, fast, well-distributed 53-bit string hash. Synchronous so
 * it can run in render; a collision only costs an extra suffix (reviewItems).
 */
export function hash53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Whitespace-insensitive form of a quote, so a re-extraction that wraps lines differently keeps the key. */
const keyForm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A decision key from the clause's own wording: `c:<hash>`; a missing protection: `m:<hash of its label>`. */
export function quoteKey(kind: 'CLAUSE' | 'MISSING', basis: string): string {
  return `${kind === 'CLAUSE' ? 'c' : 'm'}:${hash53(keyForm(basis))}`;
}

/** Identity of the analysis a set of decisions belongs to. */
export function analysisIdentity(analysis: AnalysisLike | null | undefined): string {
  if (!analysis) return 'none';
  if (analysis.analysisSha) return analysis.analysisSha;
  // Older analyses carry no hash: the time they were written identifies them, the content backs it up.
  return `legacy:${analysis.analysedAt ?? ''}:${hash53(analysis.clauses.map((c) => keyForm(c.quote)).join('\u0001'))}`;
}

/** A saved revision made against another analysis must not be applied onto this one. */
export function isStaleRevision(revisionAnalysisSha: string | null | undefined, analysis: AnalysisLike | null | undefined): boolean {
  return !revisionAnalysisSha || revisionAnalysisSha !== analysisIdentity(analysis);
}

/** sessionStorage key for the unsaved draft of decisions on one document's one analysis. */
export function draftStorageKey(documentId: string, analysisId: string): string {
  return `hm.contract.draft.${documentId}.${analysisId}`;
}

/** Was this quote cut at the cap? Explicit flag first; an older analysis at the cap is treated as cut. */
export function isQuoteTruncated(clause: { quote: string; quoteTruncated?: boolean }): boolean {
  return clause.quoteTruncated === true || clause.quote.trim().length >= QUOTE_CAP;
}

/** Every flagged clause and missing protection that came with a usable proposal. */
export function reviewItems(analysis: AnalysisLike | null): ReviewItem[] {
  if (!analysis) return [];
  const out: ReviewItem[] = [];
  const seen = new Map<string, number>();
  // The same wording flagged twice gets a stable ordinal suffix rather than sharing one decision.
  const unique = (key: string) => {
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? key : `${key}~${n}`;
  };
  analysis.clauses.forEach((c) => {
    if (c.review && c.attention !== 'NORMAL') {
      out.push({
        key: unique(quoteKey('CLAUSE', c.quote)), kind: 'CLAUSE', label: c.label, plain: c.plain, original: c.quote,
        quoteTruncated: isQuoteTruncated(c), page: c.page, attention: c.attention, review: c.review,
      });
    }
  });
  (analysis.missingProtections ?? []).forEach((m) => {
    if (m.review) {
      out.push({
        key: unique(quoteKey('MISSING', m.label)), kind: 'MISSING', label: m.label, plain: m.plain, original: null,
        quoteTruncated: false, page: null, attention: null, review: m.review,
      });
    }
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

/**
 * Where the quoted wording sits in the text: exact first, then the same
 * characters in the same case with any whitespace between words. Nothing
 * looser: a quote that differs in wording or case is not "found".
 */
export function locate(text: string, quote: string): { start: number; end: number } | null {
  const exact = text.indexOf(quote);
  if (exact >= 0) return { start: exact, end: exact + quote.length };
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const m = new RegExp(words.map(escapeRe).join('\\s+')).exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

export type UnplacedReason = 'TRUNCATED' | 'NOT_FOUND' | 'OVERLAP';

export interface Change { key: string; label: string; before: string | null; after: string }
export interface RevisionResult {
  text: string;
  changes: Change[];
  /** Accepted changes that could not be placed: shown to the signer, never applied. */
  unplaced: string[];
  unplacedReasons: Record<string, UnplacedReason>;
}

export function applyDecisions(original: string, items: ReviewItem[], decisions: Decision[], addedHeading: string): RevisionResult {
  const byKey = new Map(decisions.map((d) => [d.key, d]));
  type Edit = { start: number; end: number; after: string; item: ReviewItem };
  const edits: Edit[] = [];
  const unplaced: string[] = [];
  const unplacedReasons: Record<string, UnplacedReason> = {};
  const added: Change[] = [];
  const skip = (key: string, why: UnplacedReason) => { unplaced.push(key); unplacedReasons[key] = why; };

  for (const item of items) {
    const after = replacementFor(item, byKey.get(item.key));
    if (after === null) continue;
    if (item.kind === 'MISSING' || item.original === null) {
      added.push({ key: item.key, label: item.label, before: null, after });
      continue;
    }
    // A cut quote is only the start of the clause: replacing it would leave the clause's tail behind.
    if (item.quoteTruncated) { skip(item.key, 'TRUNCATED'); continue; }
    const at = locate(original, item.original);
    if (!at) { skip(item.key, 'NOT_FOUND'); continue; }
    // Two proposals touching the same words would make the result depend on order: the second is unplaced.
    if (edits.some((e) => at.start < e.end && e.start < at.end)) { skip(item.key, 'OVERLAP'); continue; }
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
  return { text, changes, unplaced, unplacedReasons };
}
