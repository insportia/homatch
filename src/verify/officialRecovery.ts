/*
 * OFFICIAL-BROWSER RECOVERY — the pure rules behind research-agent's
 * BROWSER_WAITING stage, kept here so they are tested without Deno.
 *
 * Incident (2026-10-09, job c80f7237…, worker job 975dc617…): the official
 * worker finished at 08:12:41 with every source done, NAPR records opened by
 * two accepted 2Captcha solves. One extracted document text carried a NUL
 * character. Postgres jsonb cannot store U+0000, so research-agent's
 * COMPLETE write failed with "unsupported Unicode escape sequence" — 1,240
 * times in 53 minutes — and the failure was never checked: supabase-js
 * returns { error } instead of throwing. Nothing advanced updated_at, so the
 * driver picked the job again every tick, forever, while the existing
 * browser deadline only covered a worker that had NOT finished.
 *
 * Three rules close that:
 *   1. pgSafe() — text that came from outside (worker results, extracted
 *      documents) is made storable before it is written: NUL removed, lone
 *      UTF-16 surrogates replaced. Nothing else changes.
 *   2. reducedOfficialResults() — if a write still fails, the job moves on
 *      with each source's own status kept and the raw payload dropped, so a
 *      report is still produced and says which sources it could not use.
 *   3. officialStallDecision() — a BROWSER_WAITING job whose row has not
 *      moved past the deadline is recovered to partial completion, whatever
 *      the cause, instead of being claimed forever.
 */

/** Total time the official browser stage may take before the job proceeds without it. */
// 14 minutes: TAS API_FIRST reads every attachment of every case (owner's
// inventory: ~413 files on one project, its own 9-minute budget) while My.gov
// solves a reCAPTCHA per record in parallel; 10 cut a complete read short.
export const OFFICIAL_BROWSER_DEADLINE_MS = 14 * 60 * 1000;
/** A BROWSER_WAITING row that has not been written for this long is stalled, not slow. */
export const OFFICIAL_STALL_MS = 5 * 60 * 1000;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export interface PgSafeStats {
  nul: number;
  surrogates: number;
}

/** One string, storable in Postgres text/jsonb. */
export function pgSafeString(s: string, stats?: PgSafeStats): string {
  let out = s;
  if (out.includes('\u0000')) {
    if (stats) stats.nul += out.split('\u0000').length - 1;
    out = out.replace(/\u0000/g, '');
  }
  LONE_SURROGATE.lastIndex = 0;
  if (LONE_SURROGATE.test(out)) {
    LONE_SURROGATE.lastIndex = 0;
    out = out.replace(LONE_SURROGATE, () => {
      if (stats) stats.surrogates++;
      return '�';
    });
  }
  return out;
}

/**
 * A deep copy whose every string (keys included) is storable. Plain JSON
 * data only — which is all a worker response or a job payload ever is.
 */
export function pgSafe<T>(value: T, stats: PgSafeStats = { nul: 0, surrogates: 0 }): T {
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return pgSafeString(v, stats);
    if (v === null || typeof v !== 'object' || depth > 64) return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[pgSafeString(k, stats)] = walk(x, depth + 1);
    return out;
  };
  return walk(value, 0) as T;
}

/**
 * The fallback when the full official payload cannot be stored: each
 * source's identity and outcome, nothing it extracted. providerOutcomes()
 * reads exactly these fields, so the report still discloses every source
 * and why its detail is missing.
 */
export function reducedOfficialResults(results: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(results)) return [];
  return results.slice(0, 40).map((r) => {
    const o = r && typeof r === 'object' ? (r as Record<string, unknown>) : {};
    const keep: Record<string, unknown> = {};
    for (const k of ['source', 'adapter', 'status', 'error', 'reason', 'startedAt', 'completedAt']) {
      const v = o[k];
      if (typeof v === 'string') keep[k] = pgSafeString(v).slice(0, 300);
    }
    keep.persistedPartially = true;
    return keep;
  });
}

export type StallDecision = 'WAIT' | 'RECOVER';

/**
 * Should the driver stop waiting on this BROWSER_WAITING job?
 * Only when BOTH the stage's total deadline has passed AND the row itself
 * has not been written for OFFICIAL_STALL_MS — a job still making progress
 * is never cut short, and a job the client keeps refreshing is still judged
 * by its own last write.
 */
export function officialStallDecision(args: {
  stage: unknown;
  status: unknown;
  updatedAt: unknown;
  workerStartedAt: unknown;
  createdAt: unknown;
  now?: number;
}): StallDecision {
  if (args.stage !== 'BROWSER_WAITING' || !['RUNNING', 'CREATED'].includes(String(args.status))) return 'WAIT';
  const now = args.now ?? Date.now();
  const t = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : NaN);
  const started = Number.isFinite(t(args.workerStartedAt)) ? t(args.workerStartedAt) : t(args.createdAt);
  const updated = t(args.updatedAt);
  if (!Number.isFinite(started) || !Number.isFinite(updated)) return 'WAIT';
  return now - started > OFFICIAL_BROWSER_DEADLINE_MS && now - updated > OFFICIAL_STALL_MS ? 'RECOVER' : 'WAIT';
}

/** The source the worker is on now, for live progress ("waiting on NAPR"). */
export function currentOfficialSource(w: unknown): string | null {
  const o = w && typeof w === 'object' ? (w as Record<string, unknown>) : {};
  const steps = Array.isArray(o.steps) ? o.steps : [];
  const done = Array.isArray(o.results) ? o.results.length : 0;
  // The worker's own cursor when it reports one; else the next unfinished step.
  const step = steps[typeof o.sourceIndex === 'number' ? o.sourceIndex : done];
  if (typeof step === 'string') return step.slice(0, 40);
  if (step && typeof step === 'object') {
    const s = step as Record<string, unknown>;
    const name = s.key ?? s.source ?? s.name;
    if (typeof name === 'string') return name.slice(0, 40);
  }
  return null;
}

/* ───────────── database steps (supabase-js client injected) ───────────── */

type Db = { from: (table: string) => any };

/**
 * Every transition out of BROWSER_WAITING goes through here.
 *
 * supabase-js returns { error } instead of throwing, and these transitions
 * used to return it unread — job c80f7237's finished result could not be
 * stored, nothing advanced, and the driver reclaimed it every tick. Now the
 * write is checked; if the full payload still cannot be stored the job moves
 * on with each source's outcome kept, its extracted payload dropped and the
 * reason recorded, so the report is produced and discloses the gap.
 */
export async function persistOfficialTransition(sb: Db, j: { id: string; evidence_bundle?: unknown }, patch: Record<string, any>): Promise<any> {
  const safe = pgSafe(patch);
  const first = await sb.from('research_jobs').update(safe).eq('id', j.id);
  if (!first?.error) return first;
  const reason = String(first.error?.message || first.error).slice(0, 200);
  console.error(`research-agent: official result for ${j.id} could not be stored (${reason}); continuing with source outcomes only`);
  const p: Record<string, any> = { ...(safe.result_json || {}) };
  p.browserOfficial = { ...(p.browserOfficial || {}), results: reducedOfficialResults(p.browserOfficial?.results), unavailable: true, persistError: reason };
  delete p.officialVisuals;
  const fallback = await sb
    .from('research_jobs')
    .update(pgSafe({ ...safe, result_json: p, evidence_bundle: Array.isArray(j.evidence_bundle) ? j.evidence_bundle : [] }))
    .eq('id', j.id);
  if (fallback?.error) console.error(`research-agent: fallback official write for ${j.id} also failed`, fallback.error);
  return fallback;
}

/**
 * THE LAST LINE AGAINST AN ENDLESS BROWSER_WAITING (called after a driver step).
 *
 * If the row is still the one that step read (updated_at unchanged), is in
 * BROWSER_WAITING, is past the official stage's total deadline and has been
 * silent for OFFICIAL_STALL_MS, the job proceeds to OFFICIAL_READY with the
 * official results already stored, marked unavailable. The update is
 * conditional on that same updated_at, so a step that did make progress
 * meanwhile always wins. Nothing is re-run or charged; no stored evidence is
 * removed; the report discloses the gap.
 */
export async function recoverStalledOfficial(sb: Db, before: { id: string; updated_at?: unknown }, nowIso: string): Promise<boolean> {
  try {
    const { data: row } = await sb.from('research_jobs').select('id,status,stage,updated_at,created_at,result_json').eq('id', before.id).maybeSingle();
    if (!row || row.updated_at !== before.updated_at) return false;
    const decision = officialStallDecision({
      stage: row.stage,
      status: row.status,
      updatedAt: row.updated_at,
      workerStartedAt: row.result_json?._worker?.startedAt,
      createdAt: row.created_at,
      now: Date.parse(nowIso),
    });
    if (decision !== 'RECOVER') return false;
    const p: Record<string, any> = { ...(row.result_json || {}) };
    p.browserOfficial = { ...(p.browserOfficial || {}), results: p.browserOfficial?.results || [], unavailable: true, recovered: 'STALLED' };
    p._recovery = { reason: 'OFFICIAL_STAGE_STALLED', workerJobId: p._worker?.jobId ?? null, stalledSince: row.updated_at, at: nowIso };
    delete p._worker;
    const { data, error } = await sb
      .from('research_jobs')
      .update(pgSafe({ status: 'CREATED', stage: 'OFFICIAL_READY', result_json: p, captcha: {}, error: null, progress: { phase: 'official_browser_unavailable', percent: 40, retriable: false, recovered: true }, updated_at: nowIso }))
      .eq('id', row.id)
      .eq('stage', 'BROWSER_WAITING')
      .eq('updated_at', row.updated_at)
      .select('id');
    if (error) {
      console.error(`research-agent drive: stalled official stage for ${row.id} could not be recovered`, error);
      return false;
    }
    if (data?.length) console.warn(`research-agent drive: job ${row.id} official stage stalled since ${row.updated_at}; continued without it`);
    return !!data?.length;
  } catch (e) {
    console.error('research-agent drive: stall recovery failed', e);
    return false;
  }
}
