// Per-search (campaign) view of a property's external leads, and the dashboard's
// numbers. Pure: no imports, so tests/matrix can load it directly.

/** One external search (campaign) of a property, as its owner's current leads describe it. */
export interface LeadCampaign {
  jobId: string;
  /** When its first current lead was stored. */
  firstAt: string;
  total: number;
  strong: number;
  potential: number;
  weak: number;
  /** Leads stored before qualification existed: never counted as strong. */
  uncategorised: number;
}

export function indexLeadCampaigns(rows: Array<{ matching_job_id: string; match_category: string | null; created_at: string }>): LeadCampaign[] {
  const byJob = new Map<string, LeadCampaign>();
  for (const r of rows) {
    if (!r.matching_job_id) continue;
    const c = byJob.get(r.matching_job_id) ?? { jobId: r.matching_job_id, firstAt: r.created_at, total: 0, strong: 0, potential: 0, weak: 0, uncategorised: 0 };
    c.total += 1;
    if (r.created_at < c.firstAt) c.firstAt = r.created_at;
    if (r.match_category === 'STRONG') c.strong += 1;
    else if (r.match_category === 'POTENTIAL') c.potential += 1;
    else if (r.match_category === 'WEAK') c.weak += 1;
    else c.uncategorised += 1;
    byJob.set(r.matching_job_id, c);
  }
  return [...byJob.values()].sort((a, b) => (a.firstAt < b.firstAt ? 1 : a.firstAt > b.firstAt ? -1 : 0));
}

/** The latest search's numbers for the External Discovery card. */
export function externalSummary(campaigns: LeadCampaign[] | null) {
  const latest = campaigns?.[0] ?? null;
  return {
    searches: campaigns?.length ?? 0,
    total: latest?.total ?? 0,
    qualified: latest?.strong ?? 0,
    potential: latest?.potential ?? 0,
    weak: (latest?.weak ?? 0) + (latest?.uncategorised ?? 0),
    latestAt: latest?.firstAt ?? null,
  };
}

/** Offer the paid expansion only when free matching has been read and found nobody. */
export function showExpandOffer(internalCount: number | null, externalRunning: boolean): boolean {
  return internalCount === 0 && !externalRunning;
}
