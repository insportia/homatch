// HistoricalComparison.ts — restores a pre-refactor feature the DEPLOYED
// research-agent Supabase function (v17, confirmed live via
// mcp__Supabase__get_edge_function) still depends on verbatim:
//
//   const hist = p.browserOfficial?.historicalComparison;
//   hist?.available ? `... (${hist.documentsConsidered} dated documents
//   compared). ... state ONLY what its comparisons[].addedInNewer/
//   removedFromOlder arrays literally show, citing the olderDocument/
//   newerDocument URLs ...` : ''
//   ...
//   historicalComparison: prior.browserOfficial?.historicalComparison || null
//
// — i.e. the worker's `job.historicalComparison` is passed through
// UNCHANGED into the final customer-facing report (research-agent does not
// reshape it), and the frontend (VerifyPage.tsx) renders it against this
// EXACT type:
//   HistoricalDoc = {url; date?; title?}
//   HistoricalComparisonEntry = {olderDocument; newerDocument; changed;
//     addedInNewer?; removedFromOlder?; proof}
//   HistoricalComparison = {available; reason?; documentsConsidered?;
//     chronology?; comparisons?}
// So THIS EXACT SHAPE — not a source-keyed map — is the real contract. The
// pre-refactor implementation itself was deleted along with the rest of
// lib/ before this file was reconstructed (this sandbox has no git history
// to recover it from); this is a fresh, contract-verified implementation,
// not a byte-for-byte port.
//
// Pure decision logic (no Playwright/HTTP) — fully unit-testable, unlike
// the *Page.ts/*Workflow.ts files that produce the ResearchDocuments this
// consumes.
//
// Evidence discipline (mandate: "NO EVIDENCE = NO FACT"): only COMPLETE
// documents (markComplete() already true — the whole document was actually
// read, never a partial one per the 14-page rule) with a real extracted
// documentDate are eligible. Fewer than two such documents across every
// source's results means there is nothing to compare — `available` is
// false and `comparisons` is omitted, never a fabricated diff.
import type { ResearchDocument } from './DocumentTypes.js';

export interface HistoricalDocRef {
  url: string;
  date?: string | null;
  title?: string | null;
}

export interface HistoricalComparisonEntry {
  olderDocument: HistoricalDocRef;
  newerDocument: HistoricalDocRef;
  changed: boolean;
  addedInNewer: string[];
  removedFromOlder: string[];
  proof: string;
}

export interface HistoricalComparison {
  available: boolean;
  reason?: string;
  documentsConsidered?: number;
  chronology?: HistoricalDocRef[];
  comparisons?: HistoricalComparisonEntry[];
}

/** Parses the exact two formats extractDateFromText() (DocumentReader.ts)
 * can produce — DD.MM.YYYY / DD/MM/YYYY, or YYYY-MM-DD / YYYY.MM.DD — into a
 * sortable UTC timestamp. Never guesses a format; unparseable input is null
 * so it is simply excluded rather than mis-sorted. */
function parseExtractedDate(raw: string): number | null {
  let m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(raw);
  if (m) {
    const [, d, mo, y] = m;
    return Date.UTC(Number(y), Number(mo) - 1, Number(d));
  }
  m = /^(\d{4})[-.](\d{1,2})[-.](\d{1,2})$/.exec(raw);
  if (m) {
    const [, y, mo, d] = m;
    return Date.UTC(Number(y), Number(mo) - 1, Number(d));
  }
  return null;
}

/** Normalizes a document's raw text into a deduplicated set of comparable
 * lines: collapsed whitespace, trimmed, and short noise lines (page numbers,
 * stray punctuation) dropped. */
function normalizedLines(text: string): string[] {
  return Array.from(
    new Set(
      String(text || '')
        .split(/\r?\n/)
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter((l) => l.length > 3)
    )
  );
}

function toDocRef(d: ResearchDocument): HistoricalDocRef {
  return { url: d.url, date: d.documentDate, title: d.title };
}

/**
 * Builds one comparison entry between two documents: a line-level (not
 * sequence/LCS) diff — lines present verbatim in one snapshot but not the
 * other. This is deliberately the simplest honest signal a deterministic
 * reader can produce; it is surfaced to the AI synthesis step only as
 * "restate these lines verbatim, citing the two document URLs," never as an
 * inferred narrative of what changed — the AI reasons over this evidence,
 * it does not invent the diff itself.
 */
function diffEntry(older: ResearchDocument, newer: ResearchDocument): HistoricalComparisonEntry {
  const olderLines = new Set(normalizedLines(older.rawText));
  const newerLines = new Set(normalizedLines(newer.rawText));
  const addedInNewer = [...newerLines].filter((l) => !olderLines.has(l));
  const removedFromOlder = [...olderLines].filter((l) => !newerLines.has(l));
  return {
    olderDocument: toDocRef(older),
    newerDocument: toDocRef(newer),
    changed: addedInNewer.length > 0 || removedFromOlder.length > 0,
    addedInNewer,
    removedFromOlder,
    proof: `Deterministic line-level text diff (not an AI inference) between two fully-read documents: ${older.source} document dated ${older.documentDate} vs ${newer.source} document dated ${newer.documentDate}.`,
  };
}

/**
 * Builds job.historicalComparison in the exact shape the deployed
 * research-agent and frontend expect (see file header). Considers every
 * COMPLETE, dated document across every source's results together as one
 * chronology, then produces one comparison entry per consecutive pair in
 * that chronology — so a job with documents from more than one official
 * source (e.g. an older TAS extract and a newer ENREG extract) is still
 * comparable, and a job with 3+ dated documents from a single source
 * surfaces every consecutive change, not just the oldest-vs-newest span.
 */
export function buildHistoricalComparison(allDocuments: ResearchDocument[]): HistoricalComparison {
  const dated = allDocuments
    .filter((d) => d && d.complete && d.documentDate && d.rawText && d.rawText.trim().length > 20)
    .map((d) => ({ doc: d, ts: parseExtractedDate(d.documentDate as string) }))
    .filter((x): x is { doc: ResearchDocument; ts: number } => x.ts !== null)
    .sort((a, b) => a.ts - b.ts)
    .map((x) => x.doc);

  if (dated.length < 2) {
    return { available: false, reason: 'Fewer than two dated, fully-read documents were retrieved across all sources — not enough evidence for a historical comparison.' };
  }

  const comparisons: HistoricalComparisonEntry[] = [];
  for (let i = 0; i < dated.length - 1; i++) {
    const older = dated[i];
    const newer = dated[i + 1];
    if (older.documentDate === newer.documentDate) continue; // no real chronological span between these two
    comparisons.push(diffEntry(older, newer));
  }

  if (!comparisons.length) {
    return { available: false, reason: 'Every retrieved dated document shares the same extracted date — no chronological span to compare.' };
  }

  return {
    available: true,
    documentsConsidered: dated.length,
    chronology: dated.map(toDocRef),
    comparisons,
  };
}
