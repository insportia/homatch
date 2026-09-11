// HOMATCH — remembering what each official source said, and when.
//
// research_cache was built for exactly this and held zero rows. Its columns —
// fingerprint, content_hash, freshness_status, acquired_at, last_verified_at,
// source_platform, source_reference — are a source-record store that somebody
// designed properly and nothing ever used. This fills it rather than adding a
// table beside it.
//
// One row per (source, subject): the TAS record for one cadastral code. Each
// verification updates the row it already has rather than inserting another,
// so the table stays one row per thing we watch rather than one per run.
//
// WHAT THIS IS NOT. It is not a cache of answers. Nothing reads a stored
// result_json back and serves it as research. It records what the source
// LOOKED LIKE, so the next verification can ask whether re-reading it would
// tell us anything new — and that question is answered before any paid
// interpretation, not instead of one.

import {
  compareToStored,
  sourceContentHash,
  sourceFingerprint,
  type OfficialSourceResult,
  type SourceObservation,
} from './sourceVersion.ts';

/** The narrow slice of a Supabase client this module needs. */
export interface SourceClient {
  from(table: string): any;
}

export interface SourceVersionOutcome {
  observations: SourceObservation[];
  errors: string[];
}

/**
 * Records what every official source said on this run, and reports which of
 * them had actually changed.
 *
 * Never throws. A verification the customer paid for must not be lost because
 * a bookkeeping row failed to write, and knowing nothing about a source's
 * version simply means the next run re-reads it — which is what it does today
 * anyway.
 */
export async function recordSourceVersions(
  db: SourceClient,
  query: string,
  results: readonly OfficialSourceResult[] | null | undefined,
  digest: (s: string) => Promise<string>,
  jobUserId?: string | null
): Promise<SourceVersionOutcome> {
  const out: SourceVersionOutcome = { observations: [], errors: [] };
  if (!Array.isArray(results) || !results.length) return out;

  for (const result of results) {
    try {
      const source = String(result?.source ?? '').trim();
      const fingerprint = sourceFingerprint(source, query);
      if (!fingerprint) continue;

      const hash = await sourceContentHash(result, digest);
      const now = new Date().toISOString();

      const { data: stored } = await db
        .from('research_cache')
        .select('id, content_hash, hit_count')
        .eq('fingerprint', fingerprint)
        .maybeSingle();

      const observation = compareToStored(
        fingerprint,
        source,
        String(result?.sourceUrl ?? '') || null,
        hash,
        stored?.content_hash ?? null
      );
      out.observations.push(observation);

      if (stored?.id) {
        /*
         * last_verified_at always moves: we did look. acquired_at only moves
         * when the content actually changed, so it answers "how old is what
         * we are holding" rather than "when did we last check", and those are
         * different questions — the first decides whether a fact is stale,
         * the second only says somebody looked.
         */
        await db
          .from('research_cache')
          .update({
            last_verified_at: now,
            hit_count: Number(stored.hit_count ?? 0) + 1,
            freshness_status: observation.state === 'CHANGED' ? 'CHANGED' : 'VERIFIED',
            ...(observation.state === 'CHANGED' && hash
              ? { content_hash: hash, acquired_at: now }
              : {}),
          })
          .eq('id', stored.id);
      } else {
        const { error } = await db.from('research_cache').insert({
          fingerprint,
          provider: 'official-worker',
          source_platform: source,
          source_reference: String(result?.sourceUrl ?? '') || null,
          query_json: { query, source },
          content_hash: hash,
          freshness_status: hash ? 'FRESH' : 'UNKNOWN',
          acquired_at: now,
          last_verified_at: now,
          hit_count: 1,
          created_by_user_id: jobUserId ?? null,
        });
        if (error) out.errors.push(`${fingerprint}: ${error.message ?? error}`);
      }
    } catch (e) {
      out.errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return out;
}
