// HOMATCH — has the source itself changed since we last read it?
//
// The cheapest question there is, and the one worth asking before any paid
// interpretation. If the registry extract carries the same content it did last
// week, then whatever we concluded from it last week is still what it says,
// and re-reading it buys nothing.
//
// THE WHOLE THING TURNS ON WHAT GOES INTO THE HASH.
//
// Every fetch of an official source differs in ways that mean nothing: the
// timestamp we read it, the session id in the final URL, the order the worker
// happened to traverse frames. Hash those and every run reports CHANGED, the
// mechanism silently achieves nothing, and the only evidence is a cost line
// that never falls.
//
// So the hash covers what the source SAID and nothing about how we fetched it.
// Getting that boundary wrong in the other direction is worse — a field that
// genuinely carries the answer, left out of the hash, means a real change goes
// unnoticed and a report states last month's ownership as current. That is why
// the included set is explicit and small rather than "everything except a
// denylist".
//
// research_cache already exists for exactly this and holds zero rows: it was
// designed as a source-record store and never used. This is what fills it.

/** What the worker returns for one official source, as persisted. */
export interface OfficialSourceResult {
  source?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  status?: string | null;
  documents?: unknown;
  resultConfirmed?: boolean | null;
  resultValidated?: boolean | null;
  noResultConfirmed?: boolean | null;
  debtorRecordFound?: boolean | null;
  registryInterpretation?: unknown;
  resultContext?: unknown;
  [k: string]: unknown;
}

/**
 * The key a source record is stored and looked up under.
 *
 * Source plus the thing we asked about: the TAS record for one cadastral code
 * is a different record from the TAS record for another, and both are
 * different from the debtor registry's answer about the same code.
 */
export function sourceFingerprint(source: unknown, query: unknown): string | null {
  const s = String(source ?? '').trim().toLowerCase();
  const q = String(query ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s || !q) return null;
  return `official:${s}:${q}`;
}

/*
 * WHAT THE SOURCE SAID.
 *
 * Explicitly listed, not filtered. A denylist would silently start hashing
 * whatever field the worker adds next, and the first volatile one to appear
 * would turn every comparison into CHANGED without anything failing.
 *
 * `documents` is the substance — the extracts and acts actually retrieved.
 * The confirmation flags are the source's own answer about whether a record
 * exists. registryInterpretation is the deterministic reading of the debtor
 * and taxpayer registries.
 *
 * Deliberately ABSENT: retrievedAt, finalUrl, frameUrls, traversal,
 * submitAction, searchControlUsed, queryEntered, error. Every one of those
 * changes between two identical fetches.
 */
const HASHED_FIELDS = [
  'documents',
  'resultConfirmed',
  'resultValidated',
  'noResultConfirmed',
  'debtorRecordFound',
  'registryInterpretation',
  'resultContext',
] as const;

/**
 * A stable projection of one source result.
 *
 * Keys are sorted at every level so two structurally identical answers hash
 * the same however the worker happened to serialise them — otherwise key
 * order alone would read as a change.
 */
export function sourceContentProjection(result: OfficialSourceResult | null | undefined): unknown {
  if (!result || typeof result !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const f of HASHED_FIELDS) {
    if (result[f] !== undefined && result[f] !== null) out[f] = result[f];
  }
  return sortDeep(out);
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) sorted[k] = sortDeep(o[k]);
    return sorted;
  }
  return v;
}

/**
 * The content hash for one source result, or null when there is nothing to
 * hash.
 *
 * Null is a real answer: a source that failed technically, or returned
 * nothing at all, has no content to compare and must not be recorded as
 * "unchanged" next time. A technical failure is not a property fact and it is
 * not a version either.
 */
export async function sourceContentHash(
  result: OfficialSourceResult | null | undefined,
  digest: (s: string) => Promise<string>
): Promise<string | null> {
  const projection = sourceContentProjection(result);
  if (!projection || typeof projection !== 'object' || !Object.keys(projection).length) return null;
  return digest(JSON.stringify(projection));
}

export type SourceState = 'NEW' | 'UNCHANGED' | 'CHANGED' | 'UNKNOWN';

export interface SourceObservation {
  fingerprint: string;
  source: string;
  sourceUrl: string | null;
  contentHash: string | null;
  state: SourceState;
  /** What we held before, when we held anything. */
  previousHash?: string | null;
}

/**
 * What one freshly-read source tells us about whether anything moved.
 *
 * UNKNOWN when either side has no hash, and UNKNOWN is never read as
 * UNCHANGED: the first source that stops exposing comparable content would
 * otherwise freeze its facts for ever.
 */
export function compareToStored(
  fingerprint: string,
  source: string,
  sourceUrl: string | null,
  freshHash: string | null,
  storedHash: string | null | undefined
): SourceObservation {
  const base = { fingerprint, source, sourceUrl, contentHash: freshHash, previousHash: storedHash ?? null };
  if (!freshHash) return { ...base, state: 'UNKNOWN' };
  if (storedHash == null) return { ...base, state: 'NEW' };
  return { ...base, state: freshHash === storedHash ? 'UNCHANGED' : 'CHANGED' };
}

/** A one-line internal summary of what a run found, for the job record. */
export function summariseSources(observations: readonly SourceObservation[]): string {
  const by = (s: SourceState) => observations.filter((o) => o.state === s).length;
  const parts: string[] = [];
  if (by('NEW')) parts.push(`${by('NEW')} new`);
  if (by('UNCHANGED')) parts.push(`${by('UNCHANGED')} unchanged`);
  if (by('CHANGED')) parts.push(`${by('CHANGED')} changed`);
  if (by('UNKNOWN')) parts.push(`${by('UNKNOWN')} not comparable`);
  return parts.join(', ') || 'no sources read';
}
