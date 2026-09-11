// HOMATCH — reading and writing market snapshots.
//
// The only module that touches market_snapshots, for the same reason
// graphStore is the only one that touches the intelligence tables: the
// invariants live in one place or they live nowhere.
//
// Two invariants matter here.
//
//   ONE CURRENT SNAPSHOT PER SEGMENT. A refresh supersedes the old row rather
//   than overwriting it, so "what did we think this market was last week, and
//   why did it change" stays answerable. A partial unique index enforces it,
//   and this code cooperates with the index rather than trusting itself.
//
//   NARROWEST USABLE ANSWER WINS. A project-level snapshot beats a district
//   one, which beats a city one. The lookup walks the hierarchy in order and
//   stops at the first row it finds — there is no merging of scopes, because
//   averaging a project median with a city median produces a number that
//   describes nothing.
//
// Nothing here decides whether to refresh. That is planMarket() in
// marketSnapshot.ts, which is pure and therefore testable without a database.

import {
  segmentKeyOf,
  type SegmentKey,
  type SnapshotDraft,
  type StoredSnapshot,
} from './marketSnapshot.ts';

/** The narrow slice of a Supabase client this module needs. */
export interface SnapshotClient {
  from(table: string): any;
}

/**
 * The best snapshot available for a property.
 *
 * `segments` arrives narrowest-first from segmentsFor(). The first hit wins,
 * so a property inside a known project never falls back to a city median it
 * would be poorly described by.
 *
 * Returns null on any failure. Knowing no market is always safe: the
 * verification researches it, exactly as it did before this existed.
 */
export async function findSnapshot(
  db: SnapshotClient,
  segments: readonly SegmentKey[]
): Promise<StoredSnapshot | null> {
  try {
    for (const segment of segments) {
      const key = segmentKeyOf(segment);
      if (!key) continue;

      const { data } = await db
        .from('market_snapshots')
        .select(
          'scope_type, scope_key, property_type, room_band, currency, median_price_per_sqm, ' +
            'lower_price_per_sqm, upper_price_per_sqm, sample_count, usable_comparable_count, ' +
            'source_count, confidence, basis_tier, last_refreshed_at'
        )
        .eq('segment_key', key)
        .eq('status', 'CURRENT')
        .maybeSingle();

      if (data) return data as StoredSnapshot;
    }
    return null;
  } catch {
    return null;
  }
}

export interface SnapshotWriteResult {
  written: boolean;
  superseded: boolean;
  segmentKey: string | null;
  reason?: string;
}

/**
 * Records what this verification learned about a market.
 *
 * Supersede-then-insert rather than upsert, in that order, because the partial
 * unique index allows exactly one CURRENT row per segment: marking the old one
 * SUPERSEDED first means the index is never momentarily violated, and a
 * failure between the two steps leaves a segment with no current snapshot,
 * which the next run simply rebuilds. The opposite order would leave two.
 *
 * Never throws. A verification the customer paid for must not fail because a
 * bookkeeping row did not write.
 */
export async function writeSnapshot(
  db: SnapshotClient,
  draft: SnapshotDraft | null | undefined,
  context: {
    jobId?: string | null;
    city?: string | null;
    district?: string | null;
    microLocation?: string | null;
    projectEntityId?: string | null;
  } = {}
): Promise<SnapshotWriteResult> {
  if (!draft) return { written: false, superseded: false, segmentKey: null, reason: 'nothing worth storing' };

  const segmentKey = segmentKeyOf(draft.segment);
  if (!segmentKey) return { written: false, superseded: false, segmentKey: null, reason: 'no segment key' };

  try {
    const now = new Date().toISOString();

    const { data: existing } = await db
      .from('market_snapshots')
      .select('id, built_by_job_id')
      .eq('segment_key', segmentKey)
      .eq('status', 'CURRENT')
      .maybeSingle();

    /*
     * THIS JOB HAS ALREADY SAID WHAT IT LEARNED.
     *
     * A verification can finish twice — two drivers completing the same job at
     * once, which is why cost_events needed a unique index. Without this guard
     * the second finish superseded a snapshot with an identical copy of
     * itself, which is exactly what production did on the first run: two rows,
     * six seconds apart, same median, same job, one of them immediately dead.
     *
     * The invariant survived, because supersede-then-insert is ordered
     * correctly. The history did not: a segment looked like it had been
     * re-researched when nothing had changed, which is precisely the signal
     * market_refresh_roi exists to make trustworthy.
     */
    if (existing?.built_by_job_id && context.jobId && existing.built_by_job_id === context.jobId) {
      return { written: false, superseded: false, segmentKey, reason: 'already recorded by this job' };
    }

    let superseded = false;
    if (existing?.id) {
      const { error } = await db
        .from('market_snapshots')
        .update({ status: 'SUPERSEDED', updated_at: now })
        .eq('id', existing.id);
      if (error) {
        return { written: false, superseded: false, segmentKey, reason: String(error.message ?? error) };
      }
      superseded = true;
    }

    const { error } = await db.from('market_snapshots').insert({
      scope_type: draft.segment.scopeType,
      scope_key: draft.segment.scopeKey,
      property_type: draft.segment.propertyType,
      room_band: draft.segment.roomBand,
      segment_key: segmentKey,
      city: context.city ?? null,
      district: context.district ?? null,
      micro_location: context.microLocation ?? null,
      project_entity_id: context.projectEntityId ?? null,
      currency: draft.currency,
      median_price_per_sqm: draft.medianPricePerSqm,
      lower_price_per_sqm: draft.lowerPricePerSqm,
      upper_price_per_sqm: draft.upperPricePerSqm,
      sample_count: draft.sampleCount,
      usable_comparable_count: draft.usableComparableCount,
      source_count: draft.sourceCount,
      basis_tier: draft.basisTier,
      confidence: draft.confidence,
      built_by_job_id: context.jobId ?? null,
      refresh_reason: draft.refreshReason,
      built_at: now,
      last_refreshed_at: now,
      status: 'CURRENT',
    });

    if (error) {
      return { written: false, superseded, segmentKey, reason: String(error.message ?? error) };
    }
    return { written: true, superseded, segmentKey };
  } catch (e) {
    return {
      written: false,
      superseded: false,
      segmentKey,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
