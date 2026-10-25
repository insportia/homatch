/*
 * THE DISPATCHER FOR FINISHED BACKGROUND JOBS.
 *
 * background_jobs reaching COMPLETED or FAILED writes one outbox row
 * (trigger, 20261204103000_job_completion_notifications.sql). jobs-worker
 * calls this on every tick: claim, decide (src/jobs/jobNotice.ts, pure and
 * tested), and hand the notice to notify(), which is the one door to the
 * in-app row, the push and the transactional email.
 *
 * Every notify() below is written out in full on purpose: the static gate in
 * src/services/__tests__/notificationProducts.test.mjs reads the literals
 * (type, priority, recipient, dedupe key) and a shared spread would hide them.
 *
 * NEVER TWICE
 *
 * verify-synthesis already announces a report the moment it is saved, with
 * dedupe key `verify-complete:<research job>`; this uses the same key, so
 * notify_emit returns that row instead of a second one, and push-send and the
 * email leg each refuse a notification they already handled. A document the
 * analysis worker already announced is detected and skipped. Failures keep
 * the key jobs-worker has always used (`job-failed:<job>`).
 */

import { notify } from './notify.ts';
import { jobNoticeFor } from '../../../src/jobs/jobNotice.ts';

// deno-lint-ignore no-explicit-any
type Sb = any;

interface OutboxRow {
  id: string;
  job_id: string;
  terminal_state: string;
  user_auth_id: string;
  product_type: string;
  subject_type: string | null;
  subject_id: string | null;
  subject_label: string | null;
  result_ref: string | null;
  user_safe_error: string | null;
  job_created_at: string | null;
}

async function done(sb: Sb, id: string, outcome: string, notificationId: string | null = null, error: string | null = null) {
  await sb.rpc('job_notification_done', {
    p_id: id, p_outcome: outcome, p_notification_id: notificationId, p_error: error,
  });
}

/** Has the analysis worker already told this person about this document, for this run? */
async function documentAlreadyAnnounced(sb: Sb, row: OutboxRow): Promise<boolean> {
  if (!row.subject_id) return false;
  let q = sb.from('notifications').select('id').eq('type', 'DOCUMENT_ANALYZED').eq('entity_id', row.subject_id);
  if (row.job_created_at) q = q.gte('created_at', row.job_created_at);
  const { data } = await q.limit(1);
  return Array.isArray(data) && data.length > 0;
}

/** One outbox row → at most one notification. Returns the outcome recorded. */
export async function dispatchOne(sb: Sb, row: OutboxRow): Promise<string> {
  const notice = jobNoticeFor({
    jobId: row.job_id,
    productType: row.product_type,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    state: row.terminal_state,
    resultRef: row.result_ref,
    userSafeError: row.user_safe_error,
  });
  if (notice.kind === 'SKIP') {
    await done(sb, row.id, `SKIP:${notice.reason ?? 'UNKNOWN'}`);
    return `SKIP:${notice.reason ?? 'UNKNOWN'}`;
  }

  /* background_jobs keys the AUTH id; notifications want the account. notify_emit
     would resolve it too, but the email leg and the outbox record want it here. */
  const { data: owner } = await sb.from('users').select('id').eq('auth_id', row.user_auth_id).maybeSingle();
  const userId: string | undefined = owner?.id;
  if (!userId) {
    await done(sb, row.id, 'NO_RECIPIENT');
    return 'NO_RECIPIENT';
  }

  const deepLink = notice.deepLink ?? '/activity';
  const subjectId = row.subject_id ?? row.job_id;
  const label = row.subject_label ?? null;
  let id: string | null = null;

  switch (notice.kind) {
    case 'VERIFY_DONE':
      id = await notify(sb, {
        userId,
        type: 'VERIFY_COMPLETE',
        title: 'Your verification is ready',
        body: 'The report has finished and is ready to read.',
        priority: 'HIGH',
        deepLink,
        entityType: 'research_job',
        entityId: subjectId,
        /* The key verify-synthesis uses, so the two producers are one notification. */
        dedupeKey: `verify-complete:${subjectId}`,
        metadata: { kind: 'VERIFY_COMPLETE', job_id: subjectId, background_job_id: row.job_id, subject_label: label },
      });
      break;

    case 'DOCUMENT_DONE':
      if (await documentAlreadyAnnounced(sb, row)) {
        await done(sb, row.id, 'ALREADY_TOLD');
        return 'ALREADY_TOLD';
      }
      id = await notify(sb, {
        userId,
        type: 'DOCUMENT_ANALYZED',
        title: 'Your document has been analysed',
        body: 'The analysis is ready to read.',
        priority: 'HIGH',
        deepLink,
        entityType: 'deal_room_document',
        entityId: subjectId,
        dedupeKey: `document-analyzed:${subjectId}:job:${row.job_id}`,
        metadata: { kind: 'DOCUMENT_ANALYZED', document_id: subjectId, background_job_id: row.job_id, subject_label: label },
      });
      break;

    case 'SEARCH_DONE':
      id = await notify(sb, {
        userId,
        type: 'SEARCH_COMPLETE',
        title: 'Your search for interested people has finished',
        body: 'The results are ready to review.',
        priority: 'HIGH',
        deepLink,
        /* matching_jobs: the in-app link builder recognises it (feed.ts findBuyersSearchLink). */
        entityType: 'matching_jobs',
        entityId: subjectId,
        dedupeKey: `find-clients-done:${row.job_id}`,
        metadata: { kind: 'FIND_CLIENTS_DONE', matching_job_id: subjectId, background_job_id: row.job_id, subject_label: label },
      });
      break;

    case 'DOCUMENT_UNREADABLE':
      id = await notify(sb, {
        userId,
        type: 'SERVICE_FAILED',
        title: 'We could not read this document',
        body: row.user_safe_error === 'doc_error_requires_ocr'
          ? 'This document is a scan with no text layer. A version exported as text would work.'
          : 'We can read PDF and Word (.docx) documents. This one is a different format.',
        priority: 'NORMAL',
        deepLink,
        entityType: 'background_job',
        entityId: row.job_id,
        dedupeKey: `job-failed:${row.job_id}`,
        email: false,
        metadata: { kind: 'DOCUMENT_UNREADABLE', reason: row.user_safe_error, product_type: row.product_type, subject_type: row.subject_type, background_job_id: row.job_id },
      });
      break;

    case 'FAILED':
      id = await notify(sb, {
        userId,
        type: 'SERVICE_FAILED',
        title: 'There was a problem completing your task',
        body: null,
        priority: 'HIGH',
        deepLink,
        entityType: 'background_job',
        entityId: row.job_id,
        dedupeKey: `job-failed:${row.job_id}`,
        metadata: { kind: 'SERVICE_FAILED', product_type: row.product_type, subject_type: row.subject_type, background_job_id: row.job_id, subject_label: label },
      });
      break;
  }

  if (!id) {
    /* notify() swallows its own failure; leave the row for the next tick. */
    await done(sb, row.id, `RETRY:${notice.kind}`, null, 'notify returned no id');
    return `RETRY:${notice.kind}`;
  }
  await done(sb, row.id, `NOTIFIED:${notice.kind}`, id);
  return `NOTIFIED:${notice.kind}`;
}

/** Drain up to `limit` finished jobs. Never throws: a tick must carry on. */
export async function dispatchJobNotifications(sb: Sb, limit = 20): Promise<{ claimed: number; notified: number; skipped: number; failed: number }> {
  const out = { claimed: 0, notified: 0, skipped: 0, failed: 0 };
  try {
    const { data, error } = await sb.rpc('job_notification_claim', { p_limit: limit });
    if (error) { console.error('[job-notify] claim failed', error.message ?? error); return out; }
    const rows = (Array.isArray(data) ? data : []) as OutboxRow[];
    out.claimed = rows.length;
    for (const row of rows) {
      try {
        const outcome = await dispatchOne(sb, row);
        if (outcome.startsWith('NOTIFIED')) out.notified++;
        else if (outcome.startsWith('RETRY')) out.failed++;
        else out.skipped++;
      } catch (e) {
        out.failed++;
        const msg = e instanceof Error ? e.message : String(e);
        await done(sb, row.id, 'ERROR', null, msg).catch(() => undefined);
      }
    }
  } catch (e) {
    console.error('[job-notify] tick failed', e instanceof Error ? e.message : String(e));
  }
  return out;
}
