// HOMATCH — the tick that makes background_jobs true.
//
// WHY THE REGISTRY IS DERIVED RATHER THAN WRITTEN BY EACH PIPELINE
//
// background_jobs is an index over work that lives in research_jobs,
// deal_room_documents and matching_jobs. It could have been maintained by
// teaching each of those three pipelines to write to it. That would mean
// three places that can forget, and a registry that silently drifts out of
// agreement with the thing it describes — which is the exact failure this
// whole piece of work exists to end.
//
// So nothing writes the registry except this function, and it writes it by
// READING the subject. A row here cannot claim a verification is running when
// research_jobs says it finished, because the only thing that ever sets it is
// a read of research_jobs.
//
// FOUR JOBS, ONE TICK
//
//   1. MIRROR   every live background_jobs row onto its subject's real state.
//   2. DRIVE    start document analysis that is queued, and keep it moving.
//                Documents had no durable runner at all, which is why one has
//                been stuck on "Reading document…" since 13:52 on 2026-09-11.
//   3. UNSTICK  documents whose analysis landed but whose state never moved.
//   4. SWEEP    jobs whose worker stopped breathing (§47).
//
// Authenticated by a shared secret in admin_settings, exactly as the existing
// verify driver and continuous-matching-worker are. It belongs to no customer,
// so it sits above the user-session check.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
};

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/**
 * A document whose analysis has not been touched for this long is not
 * thinking, it is dead. Generous: a large contract legitimately takes a
 * couple of minutes inside one model call.
 */
const DOC_STALE_MS = 6 * 60 * 1000;
/** How many of each kind one tick will take on. Keeps a tick inside its
 *  wall-clock budget rather than timing out halfway through a batch. */
const BATCH = 10;

type Sb = ReturnType<typeof createClient>;

async function adminSetting(sb: Sb, key: string): Promise<string> {
  const { data } = await sb.from('admin_settings').select('value').eq('key', key).maybeSingle();
  const v = (data as { value?: unknown } | null)?.value;
  if (v == null) return '';
  return typeof v === 'string' ? v : String(v);
}

/* ------------------------------------------------------------------ *
 * 1. Mirror                                                           *
 * ------------------------------------------------------------------ */

/** research_jobs' vocabulary, in the shared one. */
function verifyState(status: string, cancelledAt: string | null): string {
  if (cancelledAt) return 'CANCELLED';
  switch ((status || '').toUpperCase()) {
    case 'CREATED': return 'QUEUED';
    case 'RUNNING':
    case 'WAITING_HUMAN': return 'PROCESSING';
    case 'COMPLETE': return 'COMPLETED';
    case 'FAILED': return 'FAILED';
    case 'CANCELLED': return 'CANCELLED';
    default: return 'PROCESSING';
  }
}

/**
 * Stage-based, from stages the pipeline has actually finished.
 *
 * Deliberately NOT a function of elapsed time. A percentage that moves
 * because the clock moved tells the customer nothing and, worse, teaches them
 * that the number is decorative (§48).
 */
const VERIFY_STAGE_ORDER = [
  'CREATED', 'IDENTITY', 'OFFICIAL_BROWSER', 'OFFICIAL', 'PUBLIC_RESEARCH',
  'MARKET', 'RECONCILE', 'SYNTHESIS', 'COMPLETE',
];
function verifyProgress(stage: string): number {
  const i = VERIFY_STAGE_ORDER.indexOf((stage || '').toUpperCase());
  if (i === -1) return 5;
  return Math.round((i / (VERIFY_STAGE_ORDER.length - 1)) * 100);
}

const DOC_STATE: Record<string, string> = {
  NONE: 'QUEUED',
  QUEUED: 'QUEUED',
  RUNNING: 'PROCESSING',
  DONE: 'COMPLETED',
  FAILED: 'FAILED',
  UNSUPPORTED: 'FAILED',
  REQUIRES_OCR: 'FAILED',
};

/** A translation key, never a provider message (§54). */
const DOC_ERROR_KEY: Record<string, string> = {
  FAILED: 'doc_error_failed',
  UNSUPPORTED: 'doc_error_unsupported',
  REQUIRES_OCR: 'doc_error_requires_ocr',
};

const MATCHING_STATE: Record<string, string> = {
  queued: 'QUEUED',
  running: 'PROCESSING',
  succeeded: 'COMPLETED',
  completed: 'COMPLETED',
  failed: 'FAILED',
  cancelled: 'CANCELLED',
};

async function mirror(sb: Sb): Promise<{ mirrored: number; finished: number }> {
  const { data: live } = await sb
    .from('background_jobs')
    .select('id,product_type,subject_type,subject_id,state,progress,current_stage,result_ref')
    .not('state', 'in', '("COMPLETED","FAILED","CANCELLED")')
    .limit(200);

  let mirrored = 0;
  let finished = 0;

  for (const job of (live ?? []) as Record<string, any>[]) {
    if (!job.subject_id) continue;

    let nextState: string | null = null;
    let progress: number | null = null;
    let stage: string | null = null;
    let errorKey: string | null = null;
    let resultRef: string | null = null;

    if (job.subject_type === 'RESEARCH_JOB') {
      const { data: rj } = await sb
        .from('research_jobs')
        .select('id,status,stage,cancelled_at,synthesis_state')
        .eq('id', job.subject_id)
        .maybeSingle();
      if (!rj) continue;
      const r = rj as Record<string, any>;
      nextState = verifyState(r.status, r.cancelled_at);
      progress = nextState === 'COMPLETED' ? 100 : verifyProgress(r.stage);
      stage = r.stage ?? null;
      if (nextState === 'FAILED') errorKey = 'verify_result_failed';
      resultRef = `/verify?job=${r.id}`;

    } else if (job.subject_type === 'DOCUMENT') {
      const { data: doc } = await sb
        .from('deal_room_documents')
        .select('id,deal_room_id,analysis_state')
        .eq('id', job.subject_id)
        .maybeSingle();
      if (!doc) continue;
      const d = doc as Record<string, any>;
      nextState = DOC_STATE[d.analysis_state] ?? 'PROCESSING';
      progress = nextState === 'COMPLETED' ? 100 : d.analysis_state === 'RUNNING' ? 60 : 10;
      stage = d.analysis_state ?? null;
      errorKey = DOC_ERROR_KEY[d.analysis_state] ?? null;
      resultRef = `/verify/${d.deal_room_id}?tab=documents&doc=${d.id}`;

    } else if (job.subject_type === 'MATCHING_JOB') {
      const { data: mj } = await sb
        .from('matching_jobs')
        .select('id,status,progress,current_step,property_id')
        .eq('id', job.subject_id)
        .maybeSingle();
      if (!mj) continue;
      const m = mj as Record<string, any>;
      nextState = MATCHING_STATE[String(m.status)] ?? 'PROCESSING';
      progress = typeof m.progress === 'number' ? m.progress : null;
      stage = m.current_step ?? null;
      if (nextState === 'FAILED') errorKey = 'job_failed_generic';
      resultRef = m.property_id ? `/properties/${m.property_id}/matches` : job.result_ref;
    }

    if (!nextState) continue;

    if (nextState === 'COMPLETED' || nextState === 'FAILED' || nextState === 'CANCELLED') {
      await sb.rpc('background_job_finish', {
        p_job_id: job.id,
        p_state: nextState,
        p_result_ref: resultRef,
        p_error_code: errorKey ? 'SUBJECT_' + nextState : null,
        p_user_safe_error: errorKey,
        p_last_error: null,
      });
      finished++;
    } else {
      await sb.rpc('background_job_progress', {
        p_job_id: job.id,
        p_state: nextState,
        p_progress: progress,
        p_stage: stage,
        // The stage the subject reports IS the checkpoint. Recording it here
        // is what lets a retry resume rather than re-buy (§39).
        p_checkpoint: stage,
        p_metadata: null,
      });
      mirrored++;
    }
  }

  return { mirrored, finished };
}

/* ------------------------------------------------------------------ *
 * 2. Drive document analysis                                          *
 * ------------------------------------------------------------------ */

/**
 * Documents never had a durable runner.
 *
 * deal-room-document-analyze is a synchronous edge function the browser
 * invoked and waited on. Navigate away mid-run and the request is abandoned
 * with analysis_state left at RUNNING — which is precisely how a production
 * row has been reading "Reading document…" for days while holding a complete
 * nine-clause analysis.
 *
 * Now the browser registers a job and leaves. This drives it, so closing the
 * tab is irrelevant (§40).
 */
async function driveDocuments(sb: Sb, baseUrl: string, serviceKey: string): Promise<number> {
  const { data: queued } = await sb
    .from('background_jobs')
    .select('id,subject_id,cancel_deadline_at,committed_at')
    .eq('product_type', 'DOCUMENT_ANALYSIS')
    .eq('state', 'QUEUED')
    .limit(BATCH);

  let started = 0;

  for (const job of (queued ?? []) as Record<string, any>[]) {
    /*
     * THE WINDOW IS RESPECTED HERE, NOT JUST IN THE UI.
     *
     * A job still inside its cancellation window has not authorised any
     * spend. Starting the model call now would mean a customer who cancels at
     * second nine has already been charged for a document read (§28). So the
     * worker simply leaves it for the next tick.
     */
    if (!job.committed_at && Date.now() < Date.parse(job.cancel_deadline_at)) continue;
    if (!job.subject_id) continue;

    // Claim it first. Two overlapping ticks must not both invoke the
    // analyser for one document and buy the read twice.
    const claim = await sb.rpc('background_job_progress', {
      p_job_id: job.id,
      p_state: 'PROCESSING',
      p_progress: 10,
      p_stage: 'EXTRACTING',
      p_checkpoint: null,
      p_metadata: null,
    });
    if ((claim.data as Record<string, any>)?.ok !== true) continue;

    try {
      // Fire and forget: the analyser writes its own result to the document
      // row, and the mirror above will notice. Waiting for it here would put
      // this tick's wall clock at the mercy of a model call.
      void fetch(`${baseUrl}/functions/v1/deal-room-document-analyze`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: job.subject_id, workerJobId: job.id }),
      }).catch((e) => console.error('[jobs-worker] analyse dispatch failed', String(e)));
      started++;
    } catch (e) {
      console.error('[jobs-worker] analyse dispatch threw', String(e));
    }
  }

  return started;
}

/* ------------------------------------------------------------------ *
 * 3. Unstick                                                          *
 * ------------------------------------------------------------------ */

/**
 * "Reading document…" forever.
 *
 * deal-room-document-analyze marks a document RUNNING before it starts and
 * only moves it at the end. Any abandonment in between — a navigation, a
 * refresh, an edge-function timeout — leaves that marker permanently set, and
 * nothing in the product has ever cleared it.
 *
 * Two outcomes, and the distinction matters:
 *
 *   The analysis IS THERE. The work finished and only the flag was lost, so
 *   the honest repair is DONE. Deleting a real analysis to re-buy it would
 *   charge the customer for something they already have. (This is the case of
 *   the production row: nine clauses, written at 13:24:46, behind a RUNNING
 *   flag set by a re-analysis at 13:52 that never returned.)
 *
 *   The analysis is NOT there. Nothing usable was produced, so it becomes
 *   FAILED with a retry offered — never left mid-sentence.
 */
async function unstickDocuments(sb: Sb): Promise<{ recovered: number; failed: number }> {
  const cutoff = new Date(Date.now() - DOC_STALE_MS).toISOString();
  const { data: stuck } = await sb
    .from('deal_room_documents')
    .select('id,analysis,analysis_state,analyzed_at,updated_at')
    .eq('analysis_state', 'RUNNING')
    .lt('updated_at', cutoff)
    .limit(BATCH);

  let recovered = 0;
  let failed = 0;

  for (const row of (stuck ?? []) as Record<string, any>[]) {
    const analysis = row.analysis as Record<string, unknown> | null;
    // "Usable" means the analyser actually wrote a result, not that the
    // column is non-null: a partial write with no clauses is not an analysis.
    const usable = !!analysis && Array.isArray((analysis as { clauses?: unknown }).clauses);

    if (usable) {
      await sb.from('deal_room_documents')
        .update({ analysis_state: 'DONE', analysis_error: null })
        .eq('id', row.id)
        .eq('analysis_state', 'RUNNING');
      recovered++;
    } else {
      await sb.from('deal_room_documents')
        .update({
          analysis_state: 'FAILED',
          // Internal, and read by an admin. The customer is shown a key.
          analysis_error: 'analysis stopped before it finished',
          analyzed_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('analysis_state', 'RUNNING');
      failed++;
    }
  }

  return { recovered, failed };
}

/* ------------------------------------------------------------------ *
 * Entry                                                               *
 * ------------------------------------------------------------------ */

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS });

  const url = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const sb = createClient(url, serviceKey);

  try {
    const expected = await adminSetting(sb, 'jobs_worker_token');
    if (!expected || req.headers.get('x-cron-token') !== expected) {
      return json({ error: 'Forbidden' }, 403);
    }

    const [mirrored, docsStarted, unstuck, swept] = await Promise.all([
      mirror(sb),
      driveDocuments(sb, url, serviceKey),
      unstickDocuments(sb),
      sb.rpc('background_jobs_recover_stuck', { p_stale_minutes: 5, p_limit: 50 })
        .then((r) => r.data)
        .catch(() => null),
    ]);

    return json({ ok: true, mirrored, docsStarted, unstuck, swept });
  } catch (e) {
    console.error('[jobs-worker] tick failed', e instanceof Error ? e.message : String(e));
    return json({ error: 'internal_error' }, 500);
  }
});
