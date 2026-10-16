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

/**
 * What a history card adds to the saved row, best effort and bounded to one page:
 * strong matches by the customer's definition (every requested fact confirmed — older
 * rows stored a looser count), and whether a paid social campaign ran for the search.
 * Counts only; no property payload is read.
 */
export async function historyExtras(db: any, userId: string, ids: string[]) {
  const out: Record<string, { strongMatches: number | null; deepSearch: boolean }> = {};
  if (!ids.length) return out;
  await Promise.all(ids.map(async (id) => {
    const { count: strong, error } = await db.from('discovery_marketplace_properties').select('search_id', { count: 'exact', head: true })
      .eq('search_id', id).eq('view->intelligence->>strong', 'true');
    out[id] = { strongMatches: error ? null : count(strong), deepSearch: false };
  }));
  const { data: subs } = await db.from('active_search_subscriptions').select('id,search_criteria')
    .eq('user_id', userId).in('search_criteria->>marketplaceSearchId', ids);
  const bySub = new Map<string, string>((subs ?? []).map((s: any) => [String(s.id), String(s.search_criteria?.marketplaceSearchId ?? '')]));
  if (bySub.size) {
    const { data: runs } = await db.from('discovery_runs').select('subscription_id').in('subscription_id', [...bySub.keys()])
      .not('pricing_policy', 'is', null);
    for (const r of runs ?? []) { const id = bySub.get(String(r.subscription_id)); if (id && out[id]) out[id].deepSearch = true; }
  }
  return out;
}
