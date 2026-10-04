// ONE ACTIVE SEARCH PER PROPERTY — the claim match-campaign takes BEFORE it
// reserves any credits.
//
// The database holds the invariant (uidx_matching_jobs_one_active_per_property,
// migration 20261017090000): at most one lifecycle-active matching job per
// property. The job row is inserted first; a second start for the same
// property (double click, second tab, client retry with a new request id) or a
// replay of the same request id hits a unique violation and resolves to the
// search that won, without reserving, charging or queueing anything.

/** Lifecycle-active job statuses: everything that is not finished. */
export const ACTIVE_SEARCH_STATUSES = [
  'queued', 'analysing_property', 'generating_queries', 'searching_sources',
  'collecting_results', 'normalizing', 'deduplicating', 'classifying', 'ranking', 'paused',
] as const;

export type SearchClaim =
  | { ok: true; jobId: string }
  | { ok: false; existing: { id: string; status: string } | null };

// deno-lint-ignore no-explicit-any
type Db = any;

export async function claimSearch(db: Db, row: Record<string, unknown>, propertyId: string, idempotencyKey: string): Promise<SearchClaim> {
  const { data, error } = await db.from('matching_jobs').insert(row).select('id').single();
  if (!error && data) return { ok: true, jobId: String(data.id) };
  if (String(error?.code ?? '') !== '23505') throw error ?? new Error('Could not create matching job');
  /* Lost the race, or a replay: the search that holds the claim. */
  const byKey = await db.from('matching_jobs').select('id,status').eq('idempotency_key', idempotencyKey).maybeSingle();
  if (byKey?.data) return { ok: false, existing: { id: String(byKey.data.id), status: String(byKey.data.status) } };
  const active = await db.from('matching_jobs').select('id,status').eq('property_id', propertyId)
    .in('status', [...ACTIVE_SEARCH_STATUSES]).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return { ok: false, existing: active?.data ? { id: String(active.data.id), status: String(active.data.status) } : null };
}

/** Billing refused the search: drop the claim this request just took (it never started). */
export async function abandonClaim(db: Db, jobId: string): Promise<void> {
  await db.from('matching_jobs').delete().eq('id', jobId).eq('status', 'queued').is('billing_grant', null);
}
