const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

/** Authenticated internal user id only; this helper never accepts a client id. */
export async function ownedSearchHistory(db: any, userId: string, requestedPage: unknown) {
  const page = typeof requestedPage === 'number' && Number.isInteger(requestedPage)
    ? Math.max(1, Math.min(1000, requestedPage)) : 1;
  const size = 12;
  const { data, error } = await db.from('discovery_marketplace_searches')
    .select('id,status,brief,created_at,completed_at,properties_count,strong_matches,workers_total,workers_terminal,stats')
    .eq('user_id', userId).order('created_at', { ascending: false }).order('id', { ascending: false })
    .range((page - 1) * size, page * size);
  if (error) throw error;
  const rows = data ?? [];
  return { page, hasMore: rows.length > size, items: rows.slice(0, size).map((row: any) => ({
    id: row.id, status: row.status, brief: row.brief, createdAt: row.created_at,
    completedAt: row.completed_at ?? null, uniqueProperties: count(row.properties_count),
    strongMatches: count(row.strong_matches), sourcesTotal: count(row.workers_total),
    sourcesTerminal: count(row.workers_terminal), rawListings: count(row.stats?.validated),
  })) };
}
