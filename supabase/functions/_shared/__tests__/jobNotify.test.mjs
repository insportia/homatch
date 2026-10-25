import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * FINISHED JOBS → ONE NOTIFICATION EACH, ON EVERY CHANNEL.
 *
 * The dispatcher runs against a fake client that records what it was asked to
 * do: the notify_emit RPC (the in-app row), the push-send invoke, and the
 * transactional email's delivery claim.
 */

globalThis.Deno = { env: { get: () => undefined } };
const { dispatchJobNotifications } = await import('../jobNotify.ts');

function fakeClient({ rows, users = { 'auth-1': 'acct-1' }, existingDocNotice = false }) {
  const calls = { emitted: [], pushed: 0, done: [], deliveries: [] };
  const notifRows = new Map();
  const from = (name) => {
    const q = {
      filters: {},
      select() { return q; },
      eq(k, v) { q.filters[k] = v; return q; },
      gte() { return q; },
      async limit() {
        if (name === 'notifications') return { data: existingDocNotice ? [{ id: 'old' }] : [] };
        return { data: [] };
      },
      async maybeSingle() {
        if (name === 'users' && q.filters.auth_id) return { data: users[q.filters.auth_id] ? { id: users[q.filters.auth_id] } : null };
        if (name === 'users') return { data: { preferred_language: 'ka', email: 'owner@example.com' } };
        if (name === 'notifications') return { data: notifRows.get(q.filters.id) ?? null };
        if (name === 'notification_preferences') return { data: null };
        if (name === 'notification_deliveries') return { data: calls.deliveries.find((d) => d.notification_id === q.filters.notification_id) ?? null };
        return { data: null };
      },
      async insert(row) {
        if (name === 'notification_deliveries') {
          if (calls.deliveries.some((d) => d.notification_id === row.notification_id && d.channel === row.channel)) return { error: { message: 'duplicate key' } };
          calls.deliveries.push(row);
        }
        return { error: null };
      },
    };
    return q;
  };
  const byKey = new Map();
  return {
    calls,
    from,
    async rpc(fn, args) {
      if (fn === 'job_notification_claim') return { data: rows, error: null };
      if (fn === 'job_notification_done') { calls.done.push(args); return { data: null, error: null }; }
      if (fn === 'notify_emit') {
        /* notify_emit's own dedupe: the same key returns the same row. */
        const id = byKey.get(args.p_dedupe_key) ?? `n${byKey.size + 1}`;
        byKey.set(args.p_dedupe_key, id);
        notifRows.set(id, { user_id: 'acct-1' });
        calls.emitted.push(args);
        return { data: id, error: null };
      }
      return { data: null, error: null };
    },
    functions: { invoke: async () => { calls.pushed += 1; return { data: null, error: null }; } },
  };
}

const row = (over = {}) => ({
  id: 'o1', job_id: 'b1', terminal_state: 'COMPLETED', user_auth_id: 'auth-1', product_type: 'VERIFY',
  subject_type: 'RESEARCH_JOB', subject_id: 'r1', subject_label: 'Tbilisi, Vake 12', result_ref: '/verify?job=r1',
  user_safe_error: null, job_created_at: '2026-10-25T10:00:00Z', ...over,
});

test('a finished verification: one in-app row, a push decision, an email, on the RESOLVED account', async () => {
  const sb = fakeClient({ rows: [row()] });
  const r = await dispatchJobNotifications(sb);
  assert.deepEqual(r, { claimed: 1, notified: 1, skipped: 0, failed: 0 });
  const [e] = sb.calls.emitted;
  assert.equal(e.p_type, 'VERIFY_COMPLETE');
  assert.equal(e.p_user_id, 'acct-1', 'the account, not the auth id background_jobs holds');
  /* The same key verify-synthesis uses: the two producers are ONE notification. */
  assert.equal(e.p_dedupe_key, 'verify-complete:r1');
  assert.equal(e.p_deep_link, '/verify?job=r1');
  assert.equal(sb.calls.pushed, 1);
  assert.equal(sb.calls.deliveries.length, 1, 'the email leg ran (SKIPPED here: no provider key)');
  assert.equal(sb.calls.deliveries[0].user_id, 'acct-1');
  assert.equal(sb.calls.done[0].p_outcome, 'NOTIFIED:VERIFY_DONE');
});

test('a finished Find Buyers search finally tells its owner, and earns an email', async () => {
  const sb = fakeClient({ rows: [row({ product_type: 'FIND_CLIENTS', subject_type: 'MATCHING_JOB', subject_id: 'm1', result_ref: '/property/p1/buyers/external?job=m1' })] });
  await dispatchJobNotifications(sb);
  const [e] = sb.calls.emitted;
  assert.equal(e.p_type, 'SEARCH_COMPLETE');
  assert.equal(e.p_metadata.kind, 'FIND_CLIENTS_DONE');
  assert.equal(e.p_entity_type, 'matching_jobs');
  assert.equal(e.p_deep_link, '/property/p1/buyers/external?job=m1');
  assert.equal(sb.calls.deliveries[0].event_key, 'SEARCH_DONE');
});

test('dispatching the same job twice is still one notification and one email', async () => {
  const sb = fakeClient({ rows: [row(), row({ id: 'o2' })] });
  await dispatchJobNotifications(sb);
  assert.equal(new Set(sb.calls.emitted.map((e) => e.p_dedupe_key)).size, 1);
  assert.equal(sb.calls.deliveries.length, 1);
});

test('a document the analysis worker already announced is not announced again', async () => {
  const sb = fakeClient({ rows: [row({ product_type: 'DOCUMENT_ANALYSIS', subject_type: 'DOCUMENT', subject_id: 'd1', result_ref: '/contracts/d1' })], existingDocNotice: true });
  const r = await dispatchJobNotifications(sb);
  assert.equal(sb.calls.emitted.length, 0);
  assert.equal(r.skipped, 1);
  assert.equal(sb.calls.done[0].p_outcome, 'ALREADY_TOLD');
});

test('an unreadable document is shown in-app and never emailed as a failure', async () => {
  const sb = fakeClient({ rows: [row({ terminal_state: 'FAILED', product_type: 'DOCUMENT_ANALYSIS', subject_type: 'DOCUMENT', subject_id: 'd1', user_safe_error: 'doc_error_requires_ocr' })] });
  await dispatchJobNotifications(sb);
  assert.equal(sb.calls.emitted[0].p_metadata.kind, 'DOCUMENT_UNREADABLE');
  assert.equal(sb.calls.emitted[0].p_dedupe_key, 'job-failed:b1');
  assert.equal(sb.calls.deliveries.length, 0);
});

test('nobody to tell, or nothing to tell, is recorded rather than retried for ever', async () => {
  const sb = fakeClient({ rows: [row({ user_auth_id: 'ghost' }), row({ id: 'o3', job_id: 'b3', product_type: 'EMAIL_CAMPAIGN' })] });
  const r = await dispatchJobNotifications(sb);
  assert.deepEqual(sb.calls.done.map((d) => d.p_outcome), ['NO_RECIPIENT', 'SKIP:PRODUCER_OWNS_COMPLETION']);
  assert.equal(r.skipped, 2);
  assert.equal(sb.calls.emitted.length, 0);
});

test('the outbox is filled by trigger on the terminal transition, once, and never fails the job', () => {
  const sql = readFileSync('supabase/migrations/20261204103000_job_completion_notifications.sql', 'utf8');
  assert.match(sql, /unique \(job_id, terminal_state\)/);
  assert.match(sql, /after insert or update of state on public\.background_jobs/);
  assert.match(sql, /if tg_op = 'UPDATE' and old\.state = new\.state then/);
  assert.match(sql, /on conflict \(job_id, terminal_state\) do nothing/);
  assert.match(sql, /exception when others then[\s\S]{0,300}raise warning/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /revoke all on public\.job_notification_outbox from public, anon, authenticated/);
  /* jobs-worker drains it after the mirror, every tick. */
  const worker = readFileSync('supabase/functions/jobs-worker/index.ts', 'utf8');
  assert.match(worker, /const jobNotices = await dispatchJobNotifications\(sb, 25\);/);
  assert.ok(!/title: 'There was a problem completing your task'/.test(worker), 'jobs-worker announces failures itself again, beside the dispatcher');
});
