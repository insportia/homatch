// HOMATCH Verify — open a finished report without waiting twice.
//
// Opening a report from History used to be strictly sequential: research-agent
// `status` (~0.6–1.0 s, it returns the research itself), THEN verify-synthesis
// (~0.5 s warm, 1.2–1.7 s cold). The report itself never depended on the
// first call. prefetchVerifyReport() starts, at the moment a job is opened:
//
//   1. a narrow RLS read of the row (status, synthesis_state, synthesis_at);
//   2. if the research is COMPLETE and the report READY: the per-tab cache
//      (src/verify/reportCache.ts) — a hit renders at once, a stale hit renders
//      at once and refreshes in the background — otherwise verify-synthesis,
//      in PARALLEL with the status call instead of after it.
//
// It never starts research, never forces a rebuild, and asks verify-synthesis
// only for a READY report (a running job is left entirely to the page's
// existing flow). Anything unexpected resolves to null and the page falls
// back to exactly what it did before.

import { supabase } from '@/db/supabase';
import { readCachedReport, writeCachedReport, sessionStore } from '@/verify/reportCache';

export interface PrefetchedReport {
  payload: Record<string, unknown>;
  source: 'cache' | 'stale-cache' | 'network';
  /** For a stale cache hit: the fresh copy, when it arrives. */
  refresh?: Promise<Record<string, unknown> | null>;
}

const SYNTHESIS_TIMEOUT_MS = 45_000;
const inflight = new Map<string, { at: number; p: Promise<PrefetchedReport | null> }>();

async function readyFacts(jobId: string): Promise<{ synthesisAt: string } | null> {
  const { data, error } = await supabase
    .from('research_jobs')
    .select('id,status,synthesis_state,synthesis_at')
    .eq('id', jobId)
    .maybeSingle();
  if (error || !data) return null;
  if (String(data.status).toUpperCase() !== 'COMPLETE' || data.synthesis_state !== 'READY' || !data.synthesis_at) return null;
  return { synthesisAt: String(data.synthesis_at) };
}

async function fetchReport(jobId: string, synthesisAt: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await Promise.race([
      supabase.functions.invoke('verify-synthesis', { body: { jobId } }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('synthesis timed out')), SYNTHESIS_TIMEOUT_MS)),
    ]);
    const { data, error } = res as { data: unknown; error: unknown };
    const d = data as Record<string, unknown> | null;
    if (error || !d || d.error || d.pending) return null;
    writeCachedReport(sessionStore(), { jobId, synthesisAt }, d);
    return d;
  } catch {
    return null;
  }
}

async function load(jobId: string): Promise<PrefetchedReport | null> {
  try {
    const facts = await readyFacts(jobId);
    if (!facts) return null;
    const hit = readCachedReport(sessionStore(), { jobId, synthesisAt: facts.synthesisAt });
    if (hit && !hit.stale) return { payload: hit.payload, source: 'cache' };
    if (hit) return { payload: hit.payload, source: 'stale-cache', refresh: fetchReport(jobId, facts.synthesisAt) };
    const fresh = await fetchReport(jobId, facts.synthesisAt);
    return fresh ? { payload: fresh, source: 'network' } : null;
  } catch {
    return null;
  }
}

/** Start reading a finished report the moment its job is opened. Idempotent per job for a minute. */
export function prefetchVerifyReport(jobId: string): void {
  if (!jobId) return;
  const now = Date.now();
  for (const [k, v] of inflight) if (now - v.at > 60_000) inflight.delete(k);
  if (inflight.has(jobId)) return;
  inflight.set(jobId, { at: now, p: load(jobId) });
}

/** The prefetched report, if one was started for this job (consumed once). */
export function takeVerifyReport(jobId: string): Promise<PrefetchedReport | null> | null {
  const e = inflight.get(jobId);
  if (!e) return null;
  inflight.delete(jobId);
  return e.p;
}

/** Keep a report the page fetched itself, for the next open in this tab. Background, best effort. */
export function rememberVerifyReport(jobId: string, payload: unknown): void {
  if (!jobId || !payload) return;
  void readyFacts(jobId).then((f) => {
    if (f) writeCachedReport(sessionStore(), { jobId, synthesisAt: f.synthesisAt }, payload);
  }).catch(() => undefined);
}
