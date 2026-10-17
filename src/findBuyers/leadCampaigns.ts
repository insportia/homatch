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

/* ── Find Buyers recovery (owner, 2026-10-17): the campaign list is the property's SEARCHES ──
 *
 * The list used to be derived from current lead rows only, so a newer search with zero (new)
 * leads was invisible and an older one was labelled "Latest search". It is now built from the
 * searches themselves (find_buyers_campaigns ⨝ matching_jobs, owner RLS), newest first, with
 * each search's own lead counts merged in — a search with zero leads stays listed with zero.
 * Lead-only jobs (a database without the campaigns read) are still listed, dated by their
 * earliest lead. Rejected readings are never counted.
 */

export type CampaignRunState = 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';

export interface CampaignSummary extends LeadCampaign {
  /** When the search was created (the campaign row; else the job; else its first lead). */
  createdAt: string;
  completedAt: string | null;
  state: CampaignRunState;
  /** People first discovered by this search (seen_before = false). */
  newPeople: number;
  /** People HOMATCH already knew from an earlier search, found again (seen_before = true). */
  foundAgain: number;
  /** STRONG + POTENTIAL. */
  qualified: number;
}

export interface CampaignRow { matching_job_id: string; created_at?: string | null; finalized_at?: string | null; stop_reason?: string | null }
export interface JobRow { id: string; status?: string | null; created_at?: string | null; started_at?: string | null; completed_at?: string | null; updated_at?: string | null }
export interface LeadSummaryRow {
  id?: string | null;
  matching_job_id: string | null;
  match_category: string | null;
  created_at: string;
  seen_before?: boolean | null;
  person_id?: string | null;
  author_profile_url?: string | null;
}
/** The live search (find_buyers_campaign_status), which outranks a stale stored status. */
export interface LiveCampaign { jobId: string; state: string; createdAt?: string | null; startedAt?: string | null; completedAt?: string | null }

const RUNNING_JOB = new Set(['queued', 'analysing_property', 'generating_queries', 'searching_sources', 'collecting_results', 'normalizing', 'deduplicating', 'classifying', 'ranking', 'running']);
const COMPLETED_JOB = new Set(['completed', 'partially_completed', 'budget_reached']);

/** matching_jobs.status → the customer's state word. */
export function jobRunState(status: string | null | undefined, finalized = false): CampaignRunState {
  const s = String(status ?? '').toLowerCase();
  if (RUNNING_JOB.has(s)) return 'RUNNING';
  if (s === 'paused') return 'PAUSED';
  if (COMPLETED_JOB.has(s)) return 'COMPLETED';
  if (s === 'failed') return 'FAILED';
  if (s === 'cancelled') return 'CANCELLED';
  return finalized ? 'COMPLETED' : 'UNKNOWN';
}

/** find_buyers_campaign_status lifecycle state → the same words. */
export function lifecycleRunState(state: string | null | undefined): CampaignRunState {
  switch (state) {
    case 'PREPARING': case 'QUEUED': case 'SEARCHING': case 'PARTIAL_RESULTS': case 'PAUSING': return 'RUNNING';
    case 'PAUSED': return 'PAUSED';
    case 'COMPLETED_WITH_RESULTS': case 'COMPLETED_NO_RESULTS': case 'DEGRADED_COMPLETED': return 'COMPLETED';
    case 'FAILED': case 'UNAVAILABLE': return 'FAILED';
    case 'CANCELLED': return 'CANCELLED';
    default: return 'UNKNOWN';
  }
}

export const isLiveRunState = (s: CampaignRunState): boolean => s === 'RUNNING' || s === 'PAUSED';
/** A lifecycle state that will not change again: the moment to re-read results. */
export const isTerminalLifecycle = (state: string | null | undefined): boolean => {
  const s = lifecycleRunState(state);
  return s === 'COMPLETED' || s === 'FAILED' || s === 'CANCELLED';
};

/** One person, however many searches found them: person id, else profile URL, else the lead itself. */
export function personKey(r: Pick<LeadSummaryRow, 'id' | 'person_id' | 'author_profile_url'>): string {
  if (r.person_id) return `p:${r.person_id}`;
  if (r.author_profile_url) return `u:${String(r.author_profile_url).trim().toLowerCase().replace(/\/+$/, '')}`;
  return `l:${r.id ?? ''}`;
}

const empty = (jobId: string, createdAt: string): CampaignSummary => ({
  jobId, firstAt: createdAt, createdAt, completedAt: null, state: 'UNKNOWN',
  total: 0, strong: 0, potential: 0, weak: 0, uncategorised: 0, newPeople: 0, foundAgain: 0, qualified: 0,
});

export function buildCampaignList(input: {
  campaigns?: CampaignRow[] | null;
  jobs?: JobRow[] | null;
  leads?: LeadSummaryRow[] | null;
  live?: LiveCampaign | null;
}): CampaignSummary[] {
  const jobs = new Map((input.jobs ?? []).filter((j) => j && j.id).map((j) => [j.id, j]));
  const byJob = new Map<string, CampaignSummary>();
  for (const c of input.campaigns ?? []) {
    if (!c?.matching_job_id || byJob.has(c.matching_job_id)) continue;
    const job = jobs.get(c.matching_job_id);
    const at = c.created_at ?? job?.created_at ?? new Date(0).toISOString();
    const s = empty(c.matching_job_id, at);
    s.state = jobRunState(job?.status, Boolean(c.finalized_at));
    s.completedAt = job?.completed_at ?? c.finalized_at ?? null;
    byJob.set(c.matching_job_id, s);
  }
  /* Per search, each person once; rejected readings never counted. */
  const seen = new Map<string, Set<string>>();
  const leadDated = new Set<string>();
  for (const r of input.leads ?? []) {
    if (!r?.matching_job_id || r.match_category === 'REJECTED') continue;
    let s = byJob.get(r.matching_job_id);
    if (!s) {
      const job = jobs.get(r.matching_job_id);
      s = empty(r.matching_job_id, r.created_at);
      s.state = jobRunState(job?.status);
      s.completedAt = job?.completed_at ?? null;
      leadDated.add(s.jobId);
      byJob.set(r.matching_job_id, s);
    }
    if (leadDated.has(s.jobId) && r.created_at < s.createdAt) { s.createdAt = r.created_at; s.firstAt = r.created_at; }
    const people = seen.get(s.jobId) ?? new Set<string>();
    seen.set(s.jobId, people);
    const key = personKey(r);
    if (people.has(key)) continue;
    people.add(key);
    s.total += 1;
    if (r.seen_before) s.foundAgain += 1; else s.newPeople += 1;
    if (r.match_category === 'STRONG') s.strong += 1;
    else if (r.match_category === 'POTENTIAL') s.potential += 1;
    else if (r.match_category === 'WEAK') s.weak += 1;
    else s.uncategorised += 1;
  }
  const live = input.live;
  if (live?.jobId) {
    const at = live.createdAt ?? live.startedAt ?? new Date(0).toISOString();
    const state = lifecycleRunState(live.state);
    /* A running search is listed before its first row exists; a finished status only
       corrects a stored search — it never invents one (e.g. an attempt that could not start). */
    const known = byJob.get(live.jobId);
    if (known || isLiveRunState(state)) {
      const s = known ?? empty(live.jobId, at);
      if (state !== 'UNKNOWN') s.state = state;
      if (live.completedAt) s.completedAt = live.completedAt;
      byJob.set(live.jobId, s);
    }
  }
  const out = [...byJob.values()].map((s) => ({ ...s, qualified: s.strong + s.potential }));
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.jobId < b.jobId ? -1 : 1));
}

/** The search the dashboard summarises: the newest finished one, else the newest of all. */
export function featuredCampaign(list: CampaignSummary[] | null): CampaignSummary | null {
  if (!list || list.length === 0) return null;
  return list.find((c) => !isLiveRunState(c.state)) ?? list[0];
}

/** Every search together, each person counted once (a person found again is not a second person). */
export function uniquePeople(leads: LeadSummaryRow[] | null): { total: number; qualified: number } {
  const all = new Set<string>();
  const qualified = new Set<string>();
  for (const r of leads ?? []) {
    if (!r || r.match_category === 'REJECTED') continue;
    const k = personKey(r);
    all.add(k);
    if (r.match_category === 'STRONG' || r.match_category === 'POTENTIAL') qualified.add(k);
  }
  return { total: all.size, qualified: qualified.size };
}

/* ── Clear old results (find_buyers_clear_results_preview / find_buyers_clear_results) ── */
/** legacyUnlockedKept: legacy matches the owner already paid to open (status UNLOCKED) — never cleared. */
export interface ClearPreview { leads: number; legacyMatches: number; legacyUnlockedKept: number; activeCampaign: boolean }
export interface ClearOutcome { leadsCleared: number; legacyMatchesCleared: number; clearedAt: string | null }
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : 0);

export function parseClearPreview(data: unknown): ClearPreview | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  return { leads: count(d.leads), legacyMatches: count(d.legacyMatches), legacyUnlockedKept: count(d.legacyUnlockedKept), activeCampaign: d.activeCampaign === true };
}

export function parseClearOutcome(data: unknown): ClearOutcome | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  return { leadsCleared: count(d.leadsCleared), legacyMatchesCleared: count(d.legacyMatchesCleared), clearedAt: typeof d.clearedAt === 'string' ? d.clearedAt : null };
}
