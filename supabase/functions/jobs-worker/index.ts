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
// FIVE JOBS, ONE TICK
//
//   1. MIRROR   every live background_jobs row onto its subject's real state.
//   2. DRIVE    start document analysis that is queued, and keep it moving.
//                Documents had no durable runner at all, which is why one has
//                been stuck on "Reading document…" since 13:52 on 2026-09-11.
//   3. UNSTICK  documents whose analysis landed but whose state never moved.
//   4. SWEEP    jobs whose worker stopped breathing (§47).
//   5. REFUND   give back the credits a cancellation owes. wallet_release()
//                is service-role only by design, and the customer's own
//                cancel RPC runs as the customer — so the release lands
//                here, within one tick, through the ordinary ledger path.
//   6. DISPATCH  launch outreach campaigns whose scheduled time has come.
//                SCHEDULED has been a value in the status enum since the
//                table was written and nothing ever acted on it, so a
//                scheduled campaign sat at its scheduled time for ever.
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
        .select('id,deal_room_id,analysis_state,analysis_error')
        .eq('id', job.subject_id)
        .maybeSingle();
      if (!doc) continue;
      const d = doc as Record<string, any>;
      nextState = DOC_STATE[d.analysis_state] ?? 'PROCESSING';
      progress = nextState === 'COMPLETED' ? 100 : d.analysis_state === 'RUNNING' ? 60 : 10;
      stage = d.analysis_state ?? null;
      // A refusal for payment is FAILED, but it is not "something went
      // wrong" — it is an action the customer can take. See the billing
      // branch in deal-room-document-analyze.
      errorKey = d.analysis_error === 'BILLING_REQUIRED'
        ? 'doc_error_billing'
        : DOC_ERROR_KEY[d.analysis_state] ?? null;
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
      // Singular `/property/` — see src/services/api.ts. The plural form is
      // not a registered route and navigated the customer to NotFound.
      resultRef = m.property_id ? `/property/${m.property_id}/matches` : job.result_ref;
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

    /*
     * CLAIM IT, AND MEAN IT.
     *
     * This used to call background_job_progress(), which succeeds for ANY
     * non-terminal job — so two ticks that both read the row while it was
     * still QUEUED both "claimed" it and both dispatched. It happened in
     * production on 2026-09-11: one contract read twice, 21 seconds apart,
     * spending the customer's included analysis AND 0.34 Credits on the same
     * file while Homatch paid OpenAI twice.
     *
     * background_job_claim() is a compare-and-swap — it updates only while
     * the row is still QUEUED — so exactly one caller can win however many
     * read it first.
     */
    const claim = await sb.rpc('background_job_claim', { p_job_id: job.id });
    if ((claim.data as Record<string, any>)?.ok !== true) continue;

    /*
     * And a second look at the document itself, because the job row is not
     * the only way to learn that this work is already under way: a run
     * started by the customer's own browser marks the DOCUMENT without ever
     * touching the job. RUNNING means somebody is reading it right now; DONE
     * means the analyser will short-circuit anyway, so there is nothing to
     * dispatch for.
     */
    const { data: docNow } = await sb
      .from('deal_room_documents')
      .select('analysis_state')
      .eq('id', job.subject_id)
      .maybeSingle();
    const st = String((docNow as Record<string, any> | null)?.analysis_state ?? '');
    if (st === 'RUNNING' || st === 'DONE') continue;

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
 * 6. Dispatch due campaigns                                           *
 * ------------------------------------------------------------------ */

/**
 * Launch every campaign whose scheduled time has arrived.
 *
 * WHY THE CLAIM IS IN THE DATABASE
 *
 * This function runs every thirty seconds and a dispatch takes longer than
 * that, so two ticks overlap as a matter of course rather than as an edge
 * case. outreach_claim_due_campaigns() moves a row out of SCHEDULED with
 * FOR UPDATE SKIP LOCKED, so exactly one tick can ever win a given campaign —
 * the guarantee is a row lock, not a flag this function checks and then acts
 * on a moment later.
 *
 * Underneath that, outreach-send claims each CONTACT the same way, against a
 * unique index. So the two ways a scheduled send could double up — two ticks
 * on one campaign, two batches on one contact — are both closed by the
 * database rather than by timing.
 *
 * A campaign is dispatched ONE batch here. outreach-send is built to be
 * called again to continue, and the next tick finds it RUNNING and carries
 * on, which keeps a large audience off this function's wall clock.
 */
async function dispatchDueCampaigns(sb: Sb, url: string, cronToken: string): Promise<{
  claimed: number; dispatched: number; failed: number;
}> {
  const { data: due, error } = await sb.rpc('outreach_claim_due_campaigns', { p_limit: 5 });
  if (error) {
    console.error('[jobs-worker] could not claim due campaigns:', error.message);
    return { claimed: 0, dispatched: 0, failed: 0 };
  }

  const rows = (due ?? []) as { id: string; owner_id: string; campaign_type: string }[];
  let dispatched = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const res = await fetch(`${url}/functions/v1/outreach-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          /* The platform's verify_jwt is satisfied by the service key; the
             x-cron-token is what outreach-send actually trusts, and it is the
             same secret this function was itself authenticated with. */
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''}`,
          'x-cron-token': cronToken,
        },
        body: JSON.stringify({ campaign_id: row.id }),
      });
      const body = await res.json().catch(() => ({})) as { blocked?: boolean; reason?: string };

      if (body?.blocked) {
        /*
         * Refused, for a stated reason — the kill switch, a spend cap, email
         * sending being off. The campaign does not go back to SCHEDULED: its
         * time has passed, and silently re-arming it would send it at some
         * unrelated later moment when the block happened to lift. It is
         * recorded as FAILED with the reason, which is a thing the owner can
         * see and re-schedule deliberately.
         */
        await sb.from('outreach_campaigns').update({
          status: 'FAILED',
          last_send_error: body.reason ?? 'BLOCKED',
          updated_at: new Date().toISOString(),
        }).eq('id', row.id).eq('status', 'RUNNING');
        failed++;
        continue;
      }

      if (!res.ok) {
        await sb.from('outreach_campaigns').update({
          status: 'FAILED',
          last_send_error: `dispatch HTTP ${res.status}`,
          updated_at: new Date().toISOString(),
        }).eq('id', row.id).eq('status', 'RUNNING');
        failed++;
        continue;
      }
      dispatched++;
    } catch (e) {
      /* Left RUNNING on a transport failure, deliberately: outreach-send is
         resumable and the next tick continues it. Marking it FAILED here
         would turn one bad request into a cancelled campaign. */
      console.error('[jobs-worker] dispatch failed for', row.id, e instanceof Error ? e.message : String(e));
      failed++;
    }
  }

  return { claimed: rows.length, dispatched, failed };
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

    const [mirrored, docsStarted, unstuck, swept, refunded, campaigns] = await Promise.all([
      mirror(sb),
      driveDocuments(sb, url, serviceKey),
      unstickDocuments(sb),
      sb.rpc('background_jobs_recover_stuck', { p_stale_minutes: 5, p_limit: 50 })
        .then((r) => r.data)
        .catch(() => null),
      sb.rpc('background_jobs_release_cancelled', { p_limit: 25 })
        .then((r) => r.data)
        .catch(() => null),
      dispatchDueCampaigns(sb, url, expected),
    ]);

    return json({ ok: true, mirrored, docsStarted, unstuck, swept, refunded, campaigns });
  } catch (e) {
    console.error('[jobs-worker] tick failed', e instanceof Error ? e.message : String(e));
    return json({ error: 'internal_error' }, 500);
  }
});
