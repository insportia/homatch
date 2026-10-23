// Email Marketing billing glue (core.ts) against a scripted RPC fake: overage is charged only
// through the one atomic RPC, a failed charge releases the reservation and falls back to the
// included part, a stale or refused key never sends, and a refused plan activation gives the
// wallet hold back. Broadcast merge fields map to Resend's contact syntax.
import test from 'node:test';
import assert from 'node:assert/strict';
import { purchasePlan, reserveQuota } from '../emailMarketing/core.ts';
import { toBroadcastMergeFields } from '../emailMarketing/broadcast.ts';
import { senderAuthentication } from '../resend/client.ts';

const settings = { creditsPerUsd: 10 };
const owner = { userId: 'u-1', authId: 'a-1' };

/** A Supabase client whose rpc() answers from a script, recording every call. */
function fakeSb(script) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      const step = script[name];
      const answer = typeof step === 'function' ? step(args, calls) : step;
      return answer ?? { data: null, error: null };
    },
  };
}

test('overage blocks are charged through email_quota_bill_overage at $2.20 per block', async () => {
  const sb = fakeSb({
    email_quota_reserve: { data: { reservationId: 'r1', granted: 1500, included: 0, overage: 1500, blocksToBill: 2, status: 'RESERVED' }, error: null },
    email_quota_bill_overage: { data: { billed: true }, error: null },
  });
  const g = await reserveQuota(sb, settings, owner, 1500, 'key-1', 'TEST');
  assert.deepEqual([g.reservationId, g.granted, g.status], ['r1', 1500, 'RESERVED']);
  const bill = sb.calls.find((c) => c.name === 'email_quota_bill_overage');
  assert.deepEqual(bill.args, { p_reservation: 'r1', p_credits_per_block: 22, p_gross_usd_per_block: 2.2 });
  assert.ok(!sb.calls.some((c) => c.name === 'wallet_reserve' || c.name === 'wallet_settle'), 'no separate wallet calls');
});

test('a failed overage charge releases the reservation and re-offers only the included part', async () => {
  let reserves = 0;
  const sb = fakeSb({
    email_quota_reserve: (args) => {
      reserves++;
      return reserves === 1
        ? { data: { reservationId: 'r1', granted: 1200, included: 200, overage: 1000, blocksToBill: 1, status: 'RESERVED' }, error: null }
        : { data: { reservationId: 'r2', granted: args.p_count, included: args.p_count, overage: 0, blocksToBill: 0, status: 'RESERVED' }, error: null };
    },
    email_quota_bill_overage: { data: null, error: { message: 'INSUFFICIENT_CREDITS' } },
  });
  const g = await reserveQuota(sb, settings, owner, 1200, 'key-2', 'TEST');
  assert.deepEqual([g.reservationId, g.granted, g.overage], ['r2', 200, 0]);
  assert.ok(sb.calls.some((c) => c.name === 'email_quota_release' && c.args.p_reservation === 'r1'));
  assert.equal(sb.calls.filter((c) => c.name === 'email_quota_reserve')[1].args.p_key, 'key-2:included');
});

test('a failed charge with nothing included is refused with the wallet reason', async () => {
  const sb = fakeSb({
    email_quota_reserve: { data: { reservationId: 'r1', granted: 10, included: 0, overage: 10, blocksToBill: 1, status: 'RESERVED' }, error: null },
    email_quota_bill_overage: { data: null, error: { message: 'INSUFFICIENT_CREDITS' } },
  });
  const g = await reserveQuota(sb, settings, owner, 10, 'key-3', 'TEST');
  assert.deepEqual([g.reservationId, g.granted, g.reason], [null, 0, 'INSUFFICIENT_CREDITS']);
});

test('a stale key or a refusal never grants anything', async () => {
  for (const answer of [
    { reservationId: null, granted: 0, status: 'REFUSED', reason: 'STALE_KEY' },
    { reservationId: null, granted: 0, status: 'REFUSED', reason: 'TENANT_DAILY_CAP' },
  ]) {
    const sb = fakeSb({ email_quota_reserve: { data: answer, error: null } });
    const g = await reserveQuota(sb, settings, owner, 5, 'key-4', 'TEST');
    assert.deepEqual([g.reservationId, g.granted, g.reason], [null, 0, answer.reason]);
  }
});

test('plan purchase: activation settles inside the RPC; a refusal releases the wallet hold', async () => {
  const ok = fakeSb({
    wallet_reserve: { data: [{ reservation_id: 'w1', was_duplicate: false }], error: null },
    email_plan_activate: { data: { periodId: 'p1', duplicate: false }, error: null },
  });
  const r = await purchasePlan(ok, settings, owner, 'PRO', 'PLAN_PURCHASE', 'email-plan:u-1:req');
  assert.deepEqual([r.ok, r.periodId], [true, 'p1']);
  const act = ok.calls.find((c) => c.name === 'email_plan_activate').args;
  assert.deepEqual([act.p_credits, act.p_gross_usd, act.p_wallet_reservation, act.p_renews_period], [500, 50, 'w1', null]);
  assert.ok(!ok.calls.some((c) => c.name === 'wallet_settle'), 'settlement is not a second, separate call');

  const refused = fakeSb({
    wallet_reserve: { data: [{ reservation_id: 'w2', was_duplicate: false }], error: null },
    email_plan_activate: { data: null, error: { message: 'ALREADY_ACTIVE' } },
  });
  const r2 = await purchasePlan(refused, settings, owner, 'SCALE', 'PLAN_PURCHASE', 'email-plan:u-1:req2');
  assert.deepEqual([r2.ok, r2.reason], [false, 'ALREADY_ACTIVE']);
  assert.ok(refused.calls.some((c) => c.name === 'wallet_release' && c.args.p_reservation_id === 'w2'));

  const renew = fakeSb({
    wallet_reserve: { data: [{ reservation_id: 'w3' }], error: null },
    email_plan_activate: { data: null, error: { message: 'RENEWAL_SUPERSEDED' } },
  });
  const r3 = await purchasePlan(renew, settings, owner, 'PRO', 'PLAN_RENEWAL', 'email-renew:u-1:p0', 'p0');
  assert.equal(r3.reason, 'RENEWAL_SUPERSEDED');
  assert.equal(renew.calls.find((c) => c.name === 'email_plan_activate').args.p_renews_period, 'p0');
});

test('broadcast merge fields use Resend contact properties with a safe fallback', () => {
  assert.equal(toBroadcastMergeFields('Hi {{first_name|there}},'), 'Hi {{{contact.first_name|there}}},');
  assert.equal(toBroadcastMergeFields('Hi {{ name }}'), 'Hi {{{contact.first_name|}}}');
  assert.equal(toBroadcastMergeFields('{{first_name|a}b|c}}'), '{{first_name|a}b|c}}', 'a malformed field is left alone');
  assert.equal(toBroadcastMergeFields('{{email}}'), '{{email}}', 'only name fields are mapped');
});

test('sender authentication: only a DMARC pass is PASS; explicit failures are FAIL', () => {
  assert.equal(senderAuthentication({ dmarc: 'pass', spf: 'fail', dkim: 'fail' }), 'PASS');
  assert.equal(senderAuthentication({ dmarc: { result: 'PASS' } }), 'PASS');
  assert.equal(senderAuthentication({ dmarc: 'fail', spf: 'pass', dkim: 'pass' }), 'FAIL');
  assert.equal(senderAuthentication({ dmarc: 'none', spf: 'fail', dkim: 'fail' }), 'FAIL');
  assert.equal(senderAuthentication({ dmarc: 'none', spf: 'pass', dkim: 'none' }), 'UNKNOWN', 'no DMARC: not proven, not refuted');
  assert.equal(senderAuthentication(null), 'UNKNOWN');
  assert.equal(senderAuthentication('pass'), 'UNKNOWN');
});

test('only an Email Studio reply whose sender did not FAIL authentication reaches the Leads CRM', async () => {
  const { readFileSync } = await import('node:fs');
  const fn = readFileSync('supabase/functions/email-webhook/index.ts', 'utf8');
  const at = fn.indexOf("sb.rpc('email_studio_reply_to_crm'");
  assert.ok(at > 0, 'the reply is never connected to the CRM');
  const guard = fn.slice(fn.lastIndexOf('if (', at), at);
  assert.match(guard, /route\?\.kind === 'STUDIO'/);
  assert.match(guard, /senderCheck !== 'FAIL'/);
  assert.ok(fn.indexOf("sb.rpc('comm_record_inbound'") < at, 'the message is recorded before the CRM moves');
});

test('controlled test mode: off unless enabled, owned, unexpired; only simulator or listed addresses', async () => {
  const { parseTestMode, testModeAllows } = await import('../emailMarketing/core.ts');
  const now = Date.parse('2026-10-23T12:00:00Z');
  const owner = '5157044e-9158-437a-86a2-e34d5ada82f7';
  const ok = { enabled: true, owner_user_ids: [owner], recipients: ['Admin@Example.test'], expires_at: '2026-10-24T12:00:00Z' };
  assert.equal(parseTestMode(null, now), null);
  assert.equal(parseTestMode({ ...ok, enabled: false }, now), null);
  assert.equal(parseTestMode({ ...ok, expires_at: '2026-10-23T11:00:00Z' }, now), null, 'expired');
  assert.equal(parseTestMode({ ...ok, expires_at: '2026-11-30T00:00:00Z' }, now), null, 'longer than 7 days is refused');
  assert.equal(parseTestMode({ ...ok, owner_user_ids: [] }, now), null);
  const t = parseTestMode(ok, now);
  assert.ok(testModeAllows(t, owner, ['delivered@resend.dev', 'bounced+a1@resend.dev', 'complained@resend.dev', 'admin@example.test']));
  assert.equal(testModeAllows(t, owner, ['delivered@resend.dev', 'someone@gmail.com']), false, 'one real address blocks the whole send');
  assert.equal(testModeAllows(t, owner, ['anything@resend.dev']), false, 'only the simulator mailboxes');
  assert.equal(testModeAllows(t, owner, ['delivered@resend.dev.evil.com']), false);
  assert.equal(testModeAllows(t, '00000000-0000-0000-0000-000000000000', ['delivered@resend.dev']), false, 'another owner');
  assert.equal(testModeAllows(t, owner, []), false, 'nothing to send is not a test');
  assert.equal(testModeAllows(null, owner, ['delivered@resend.dev']), false);
});

test('usage snapshots are taken by age, not by the clock minute (jobs-worker skips ticks)', async () => {
  const { usageSnapshotDue } = await import('../emailMarketing/core.ts');
  const now = new Date('2026-10-23T12:10:00Z');
  assert.equal(usageSnapshotDue(null, now), true, 'never taken: due');
  assert.equal(usageSnapshotDue('garbage', now), true);
  assert.equal(usageSnapshotDue('2026-10-23T11:15:00Z', now), true, '55 minutes old: due');
  assert.equal(usageSnapshotDue('2026-10-23T11:30:00Z', now), false, '40 minutes old: not yet');
});

test('jobs-worker asks for renewals every tick and gates the usage poll on snapshot age', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('supabase/functions/jobs-worker/index.ts', 'utf8');
  const fn = src.slice(src.indexOf('export async function emailMarketingMaintenance'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.ok(!/getUTCMinutes|getUTCSeconds/.test(body), 'no clock-minute window');
  assert.match(body, /await call\('plan_renew_due'\);/);
  assert.match(body, /if \(usage\) await call\('usage_refresh_cron'\)/);
  assert.match(body, /usageSnapshotDue\(/);
});
