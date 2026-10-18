// QUEUES AND STUCK WORK — what System health checks about the work behind the product.
//
// The live check answers "can the database, storage and the API be reached" and
// admin_system_facts answers "when did jobs last finish or fail". Neither answered
// the questions an incident starts with (campaign 8f6b8544, 2026-10-18: a finish
// killed by the CPU limit sat in 'ranking' for 12 minutes and nobody could see it):
// how much work is waiting and for how long, what is stuck mid-finish, which
// credit holds outlived their expiry, which provider runs were never booked.
//
// Read-only, service role, small indexed reads. Every check reports a count, the
// age of its oldest item and a level. Levels are monitoring thresholds only: they
// change no queue, price or limit.

export type OpsLevel = 'ok' | 'warn' | 'alert';

export interface OpsCheck {
  key: string;
  /** Items matching the check; null when the check itself could not run. */
  count: number | null;
  /** Seconds since the oldest matching item's reference time. */
  oldestAgeSec: number | null;
  level: OpsLevel;
}

export interface OpsRule {
  warnIfAny?: boolean;
  alertIfAny?: boolean;
  warnAgeSec?: number;
  alertAgeSec?: number;
}

const MIN = 60;

/** The level of one check from its count and oldest age. A check that could not run is a warning. */
export function levelFor(count: number | null, oldestAgeSec: number | null, rule: OpsRule): OpsLevel {
  if (count == null) return 'warn';
  if (count === 0) return 'ok';
  const age = oldestAgeSec ?? 0;
  if (rule.alertIfAny || (rule.alertAgeSec != null && age >= rule.alertAgeSec)) return 'alert';
  if (rule.warnIfAny || (rule.warnAgeSec != null && age >= rule.warnAgeSec)) return 'warn';
  return 'ok';
}

/** The page's overall level: the worst of its checks. */
export function worstLevel(checks: OpsCheck[]): OpsLevel {
  return checks.some((c) => c.level === 'alert') ? 'alert' : checks.some((c) => c.level === 'warn') ? 'warn' : 'ok';
}

interface Probe {
  key: string;
  table: string;
  /** The column whose oldest value is the age reference. */
  ageCol: string;
  filter: (q: any, nowIso: string) => any;
  rule: OpsRule;
}

const ago = (now: number, sec: number) => new Date(now - sec * 1000).toISOString();

/** The checks, in display order. */
export function opsProbes(now: number): Probe[] {
  return [
    { key: 'discovery_queue_open', table: 'discovery_query_queue', ageCol: 'created_at',
      filter: (q) => q.in('status', ['PENDING', 'RETRY_WAIT', 'PROCESSING']),
      rule: { warnAgeSec: 20 * MIN, alertAgeSec: 60 * MIN } },
    /* A claim recovers a lapsed lease; one that stays lapsed means nothing is claiming. */
    { key: 'discovery_queue_lease_lapsed', table: 'discovery_query_queue', ageCol: 'lease_expires_at',
      filter: (q, nowIso) => q.eq('status', 'PROCESSING').lt('lease_expires_at', nowIso),
      rule: { warnIfAny: true, alertAgeSec: 10 * MIN } },
    { key: 'verify_tasks_open', table: 'verify_tasks', ageCol: 'created_at',
      filter: (q) => q.in('state', ['QUEUED', 'RUNNING', 'WAITING_SHARED']),
      rule: { warnAgeSec: 30 * MIN, alertAgeSec: 90 * MIN } },
    { key: 'verify_tasks_dead_24h', table: 'verify_tasks', ageCol: 'updated_at',
      filter: (q) => q.eq('state', 'DEAD').gte('updated_at', ago(now, 24 * 60 * MIN)),
      rule: { warnIfAny: true } },
    /* Measured p95 of the slowest portal (SS.ge) is about 15 minutes. */
    { key: 'marketplace_runs_open', table: 'discovery_marketplace_worker_runs', ageCol: 'created_at',
      filter: (q) => q.in('status', ['QUEUED', 'SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING']),
      rule: { warnAgeSec: 20 * MIN, alertAgeSec: 60 * MIN } },
    { key: 'native_match_queue', table: 'native_match_property_queue', ageCol: 'enqueued_at',
      filter: (q) => q,
      rule: { warnAgeSec: 30 * MIN, alertAgeSec: 120 * MIN } },
    /* A finish heartbeats before every step; five quiet minutes means it died (rescueStuck retries once). */
    { key: 'campaigns_stuck_finishing', table: 'matching_jobs', ageCol: 'updated_at',
      filter: (q) => q.in('status', ['classifying', 'ranking']).lt('updated_at', ago(now, 5 * MIN)),
      rule: { warnIfAny: true, alertAgeSec: 10 * MIN } },
    { key: 'campaigns_past_deadline', table: 'matching_jobs', ageCol: 'discovery_deadline_at',
      filter: (q) => q.eq('status', 'searching_sources').lt('discovery_deadline_at', ago(now, 10 * MIN)),
      rule: { warnIfAny: true, alertAgeSec: 30 * MIN } },
    /* Verify p95 is about 23 minutes; PAUSED and WAITING_HUMAN are legitimate waits and are not counted. */
    { key: 'verify_jobs_long_running', table: 'research_jobs', ageCol: 'created_at',
      filter: (q) => q.in('status', ['CREATED', 'RUNNING']).lt('created_at', ago(now, 60 * MIN)),
      rule: { warnIfAny: true } },
    /* A hold past its expiry was neither settled nor released: a settlement discrepancy. */
    { key: 'reservations_overdue', table: 'usage_reservations', ageCol: 'expires_at',
      filter: (q, nowIso) => q.eq('status', 'RESERVED').lt('expires_at', nowIso),
      rule: { alertIfAny: true } },
    /* A provider run whose cost was never booked is spend the campaign does not know about. */
    { key: 'find_buyers_runs_unbooked', table: 'find_buyers_actor_runs', ageCol: 'created_at',
      filter: (q) => q.is('cost_booked_at', null).lt('created_at', ago(now, 120 * MIN)),
      rule: { alertIfAny: true } },
    { key: 'find_property_runs_unbooked', table: 'find_property_actor_runs', ageCol: 'created_at',
      filter: (q) => q.is('cost_booked_at', null).lt('created_at', ago(now, 120 * MIN)),
      rule: { alertIfAny: true } },
  ];
}

/** Run every check. One check that fails to read is reported as such; the others still run. */
export async function opsChecks(db: any, now = Date.now()): Promise<OpsCheck[]> {
  const nowIso = new Date(now).toISOString();
  return Promise.all(opsProbes(now).map(async (p): Promise<OpsCheck> => {
    try {
      const [counted, oldest] = await Promise.all([
        p.filter(db.from(p.table).select(p.ageCol, { count: 'exact', head: true }), nowIso),
        p.filter(db.from(p.table).select(p.ageCol), nowIso).order(p.ageCol, { ascending: true }).limit(1),
      ]);
      if (counted.error || oldest.error) throw counted.error ?? oldest.error;
      const count = Number(counted.count ?? 0);
      const first = (oldest.data ?? [])[0]?.[p.ageCol] ?? null;
      const oldestAgeSec = count > 0 && first ? Math.max(0, Math.round((now - Date.parse(first)) / 1000)) : null;
      return { key: p.key, count, oldestAgeSec, level: levelFor(count, oldestAgeSec, p.rule) };
    } catch {
      return { key: p.key, count: null, oldestAgeSec: null, level: 'warn' };
    }
  }));
}
