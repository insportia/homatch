import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * SENDING AN EMAIL CAMPAIGN, AND THE TWO WAYS IT USED TO LIE.
 *
 * THE FIRST: A SIMULATION RECORDED AS A DELIVERY
 *
 * With outreach_email_sending_enabled false, getEmailAdapter returns the mock
 * adapter and the send loop wrote outreach_sends rows with status SENT and a
 * mock_email_... id, then incremented sent_count. The campaign card renders
 * that count. So the product asserted deliveries that had not happened, to
 * the person deciding whether outreach works — and nothing on the screen,
 * in the row, or in the counters distinguished it from the real thing.
 *
 * THE SECOND: A REHEARSAL THAT COULD BE FLUSHED LATER
 *
 * Those rows sat in a campaign that stayed launchable. On the day somebody
 * enabled the provider, pressing send again would have delivered a rehearsal
 * to real recipients who were never chosen for a real campaign.
 *
 * Both are closed, in two independent places, and this file holds them there.
 * A screen cannot be the enforcement: enforcement that lives in a screen is
 * enforcement the next screen forgets.
 */

const SEND = readFileSync('supabase/functions/outreach-send/index.ts', 'utf8');
const WORKER = readFileSync('supabase/functions/jobs-worker/index.ts', 'utf8');
const MIGRATION = readFileSync(
  'supabase/migrations/20260914234500_email_scheduling_and_mock_quarantine.sql', 'utf8');

test('email is refused rather than simulated', () => {
  assert.match(SEND, /EMAIL_SENDING_NOT_ENABLED/,
    'there is no refusal, so the mock adapter still writes SENT rows');
  assert.match(SEND, /channel === 'EMAIL' && !emailEnabled/);
});

test('the refusal happens before any contact is claimed', () => {
  /* Order is the whole point. Refusing after the loop would leave QUEUED
     rows against contacts that were never written to and can never be
     retried, because the claim index treats them as already handled. */
  const refusal = SEND.indexOf('EMAIL_SENDING_NOT_ENABLED');
  const claim = SEND.indexOf("from('outreach_sends').insert");
  assert.ok(refusal > 0 && claim > refusal,
    'contacts are claimed before the campaign is refused');
});

test('a campaign that was ever simulated can never be dispatched', () => {
  assert.match(SEND, /CAMPAIGN_IS_LEGACY_MOCK/);
  assert.match(SEND, /campaign\.send_eligibility === 'LEGACY_MOCK'/);
});

test('the simulated mark is set by the database, not by the sender', () => {
  /* outreach-send is no longer the only thing that can write a MOCK send —
     SMS and voice keep their mock path — so the mark cannot depend on that
     function having been the one that wrote the row. */
  assert.match(MIGRATION, /create trigger outreach_sends_mark_simulated/);
  assert.match(MIGRATION, /new\.provider = 'MOCK'/);
  assert.match(MIGRATION, /send_eligibility = 'LEGACY_MOCK'/);
});

test('a due campaign is claimed by a row lock, not by a flag this code reads', () => {
  /* The worker ticks every thirty seconds and a dispatch takes longer than
     that, so two ticks overlap as a matter of course. Reading a status and
     then acting on it a moment later is exactly the race that sends one
     campaign twice. */
  assert.match(MIGRATION, /for update skip locked/);
  assert.match(MIGRATION, /status = 'SCHEDULED'/);
  assert.match(MIGRATION, /scheduled_at <= now\(\)/);
  // A campaign that may never be sent must not even be claimable.
  assert.match(MIGRATION, /send_eligibility = 'PRODUCTION'/);
});

test('the worker dispatches through the claim and nothing else', () => {
  assert.match(WORKER, /outreach_claim_due_campaigns/);
  const dispatch = WORKER.slice(WORKER.indexOf('async function dispatchDueCampaigns'));
  // It must not go looking for SCHEDULED rows itself: a second way to find
  // due work is a second way to find the same work twice.
  assert.equal(/\.eq\('status', 'SCHEDULED'\)/.test(dispatch), false,
    'the worker selects scheduled campaigns directly, bypassing the claim');
});

test('a refused scheduled campaign does not silently re-arm', () => {
  const dispatch = WORKER.slice(WORKER.indexOf('async function dispatchDueCampaigns'));
  /* Putting it back to SCHEDULED would send it at whatever unrelated later
     moment the block happened to lift — which is not a time anybody chose. */
  assert.equal(/status: 'SCHEDULED'/.test(dispatch), false,
    'a blocked campaign is re-armed and will fire at an unchosen time');
  assert.match(dispatch, /status: 'FAILED'/);
  assert.match(dispatch, /last_send_error/);
});

test('the scheduler proves itself with a secret the browser never holds', () => {
  assert.match(SEND, /x-cron-token/);
  assert.match(SEND, /jobs_worker_token/);
  // Worker mode must not be able to name an owner: it adopts the one already
  // on the row it was handed, or it is a way to send somebody else's mail.
  assert.match(SEND, /if \(workerMode\) ownerId = campaign\.owner_id/);
  assert.equal(/owner_id:\s*body\.owner_id/.test(SEND), false,
    'the caller can choose whose campaign to send');
});

test('a bad cron token is refused rather than falling back to a session', () => {
  const guard = SEND.slice(SEND.indexOf('const cronToken'), SEND.indexOf('let ownerId'));
  assert.match(guard, /cronToken !== expectedStr/);
  assert.match(guard, /status: 401/);
});
