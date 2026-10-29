// saas-notify: the reliable transactional notification pipeline.
//   retry/backoff policy, durable retries with ONE idempotency key per delivery, duplicate
//   suppression, provider webhook status mapping and suppression, preference logic,
//   localisation coverage (generated copy == i18n bundle), and that no marketing key or
//   marketing dispatch path can carry a transactional email.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_DELIVERY_ATTEMPTS, RETRY_WINDOW_MS, applyProviderEvent, deliveryBackoffMs, nextDeliveryState,
  providerEventEffect, resendIdempotencyKey, retryDueDeliveries, sendNotificationEmail,
} from '../notifyEmail.ts';
import {
  EMAIL_EVENTS, LANGS, SUBSCRIPTION_PAGE, categoryOfEvent, deepLinkFor, emailDecision, emailEventFor, eventCopy, frameCopy, isEssential, storedCopyFor,
} from '../notificationCopy.ts';
import { NOTIFICATION_COPY } from '../notificationCopy.generated.ts';
import { buildTransactionalEmail, maybeEmailNotification, unsubscribeUrl } from '../transactionalEmail.ts';
import { handleNotificationUnsubscribe } from '../notificationUnsubscribe.ts';
import { signUnsubscribeToken } from '../suppression.ts';

const ROOT = process.cwd();
const noSleep = async () => {};
const NOW = new Date('2026-10-29T10:00:00Z');
const USER = '11111111-1111-4111-8111-111111111111';

function withEnv(env) {
  globalThis.Deno = { env: { get: (k) => env[k] } };
}

/* ── policy ─────────────────────────────────────────────────────────── */

test('backoff grows 1, 5, 25, 125 minutes then caps at 6 h; Retry-After is honoured when longer', () => {
  const min = 60_000;
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => deliveryBackoffMs(n)), [1 * min, 5 * min, 25 * min, 125 * min, 360 * min, 360 * min]);
  assert.equal(deliveryBackoffMs(1, '600'), 10 * min);
  assert.equal(deliveryBackoffMs(3, '30'), 25 * min, 'a shorter Retry-After never shortens the backoff');
  const total = [1, 2, 3, 4, 5].reduce((a, n) => a + deliveryBackoffMs(n), 0);
  assert.ok(total < RETRY_WINDOW_MS, 'every retry happens inside the provider idempotency window');
});

test('after an attempt: SENT stays SENT, a 4xx is FAILED for good, a transient failure retries until the last attempt', () => {
  assert.deepEqual(nextDeliveryState({ outcome: 'SENT', attempts: 1, now: NOW }), { status: 'SENT', next_attempt_at: null, last_error: null });
  const perm = nextDeliveryState({ outcome: 'PERMANENT', attempts: 1, now: NOW, status: 422, error: 'invalid' });
  assert.equal(perm.status, 'FAILED');
  assert.match(perm.last_error, /^PERMANENT HTTP 422/);
  const retry = nextDeliveryState({ outcome: 'RETRY', attempts: 1, now: NOW, createdAt: NOW, status: 503 });
  assert.equal(retry.status, 'RETRYING');
  assert.equal(retry.next_attempt_at, new Date(NOW.getTime() + 60_000).toISOString());
  const last = nextDeliveryState({ outcome: 'RETRY', attempts: MAX_DELIVERY_ATTEMPTS, now: NOW, createdAt: NOW });
  assert.equal(last.status, 'FAILED');
  assert.match(last.last_error, /^MAX_ATTEMPTS/);
  const old = nextDeliveryState({ outcome: 'RETRY', attempts: 2, now: NOW, createdAt: new Date(NOW.getTime() - 22.99 * 3600_000) });
  assert.equal(old.status, 'FAILED', 'no retry would land outside the idempotency window');
  assert.match(old.last_error, /^RETRY_WINDOW_EXPIRED/);
});

/* ── a tiny database: deliveries, users, preferences, and the claim RPC ── */

function fakeDb({ prefs = null, email = 'person@example.com' } = {}) {
  const deliveries = [];
  const preferences = prefs ? [{ user_id: USER, ...prefs }] : [];
  const tables = { notification_deliveries: deliveries, notification_preferences: preferences, users: [{ id: USER, email, preferred_language: 'en' }] };
  const from = (name) => {
    const filters = [];
    let patch = null;
    const hit = () => (tables[name] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
    const q = {
      select() { return q; },
      eq(k, v) { filters.push([k, v]); return q; },
      or() { return q; },
      limit() { return q; },
      async maybeSingle() { return { data: hit()[0] ?? null, error: null }; },
      update(p) { patch = p; return q; },
      then(res, rej) {
        if (patch) for (const r of hit()) Object.assign(r, patch);
        return Promise.resolve({ data: null, error: null }).then(res, rej);
      },
      async insert(row) {
        if (row.notification_id && deliveries.some((d) => d.notification_id === row.notification_id && d.channel === row.channel)) {
          return { error: { message: 'duplicate key value violates unique constraint' } };
        }
        (tables[name] ??= []).push({ status: 'QUEUED', attempts: 0, max_attempts: MAX_DELIVERY_ATTEMPTS, created_at: NOW.toISOString(), ...row });
        return { error: null };
      },
      async upsert(row) {
        const t = (tables[name] ??= []);
        const cur = t.find((r) => r.user_id === row.user_id);
        if (cur) Object.assign(cur, row); else t.push({ ...row });
        return { error: null };
      },
    };
    return q;
  };
  /* The claim RPC, as the migration defines it: due RETRYING, stale QUEUED, attempts + 1. */
  const rpc = async (fn, args) => {
    if (fn !== 'notification_delivery_claim_due') return { data: null, error: null };
    const now = Date.now();
    const due = deliveries.filter((d) => d.channel === 'EMAIL' && d.payload && d.attempts < d.max_attempts
      && ((d.status === 'RETRYING' && Date.parse(d.next_attempt_at) <= now)
        || (d.status === 'QUEUED' && Date.parse(d.last_attempt_at ?? d.created_at) < now - 600_000))).slice(0, args.p_limit);
    for (const d of due) Object.assign(d, { status: 'QUEUED', attempts: d.attempts + 1, last_attempt_at: new Date().toISOString(), next_attempt_at: null });
    return { data: due.map((d) => ({ ...d })), error: null };
  };
  return { from, rpc, deliveries, preferences };
}

function fakeFetch(statuses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const s = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    if (s === 'NETWORK') throw new Error('network down');
    return { ok: s >= 200 && s < 300, status: s, headers: { get: () => null }, json: async () => (s < 300 ? { id: `msg_${calls.length}` } : { message: `status ${s}` }) };
  };
  return { impl, calls };
}

const CONTENT = { subject: 'Subject', html: '<p>x</p>', text: 'x' };

test('a transient failure becomes RETRYING; the sweeper retries it with the SAME idempotency key and records SENT', async () => {
  withEnv({ RESEND_API_KEY: 're_transactional' });
  const db = fakeDb();
  const f = fakeFetch([503, 503, 503, 200]);
  const r = await sendNotificationEmail(db, { userId: USER, notificationId: 'n1', source: 'transactional', content: CONTENT, essential: true }, { fetchImpl: f.impl, sleep: noSleep });
  assert.equal(r.status, 'RETRYING');
  const row = db.deliveries[0];
  assert.equal(row.status, 'RETRYING');
  assert.equal(row.attempts, 1);
  assert.ok(row.payload && row.payload.subject === 'Subject' && !('to' in row.payload), 'the payload is kept, never the address');
  assert.match(row.last_error, /^TRANSIENT HTTP 503/);

  /* Not due yet: nothing is claimed. */
  assert.equal((await retryDueDeliveries(db, { fetchImpl: f.impl, sleep: noSleep })).claimed, 0);
  row.next_attempt_at = new Date(Date.now() - 1000).toISOString();
  const tick = await retryDueDeliveries(db, { fetchImpl: f.impl, sleep: noSleep });
  assert.deepEqual(tick, { claimed: 1, sent: 1, retrying: 0, failed: 0, skipped: 0 });
  assert.equal(row.status, 'SENT');
  assert.equal(row.attempts, 2);
  assert.equal(row.provider_message_id, 'msg_4');
  const keys = new Set(f.calls.map((c) => c.init.headers['Idempotency-Key']));
  assert.deepEqual([...keys], [resendIdempotencyKey(row.id)], 'one delivery, one idempotency key, every call');
  assert.equal(f.calls.at(-1).init.headers.Authorization, 'Bearer re_transactional');
});

test('a sender that died mid-send (stale QUEUED) is reclaimed; a fresh QUEUED row is left alone', async () => {
  withEnv({ RESEND_API_KEY: 're_transactional' });
  const db = fakeDb();
  db.deliveries.push({ id: 'd-fresh', notification_id: 'a', user_id: USER, channel: 'EMAIL', status: 'QUEUED', attempts: 1, max_attempts: 6, payload: { from: 'x', subject: 's', html: 'h', text: 't' }, last_attempt_at: new Date().toISOString(), created_at: new Date().toISOString() });
  db.deliveries.push({ id: 'd-stale', notification_id: 'b', user_id: USER, channel: 'EMAIL', status: 'QUEUED', attempts: 1, max_attempts: 6, payload: { from: 'x', subject: 's', html: 'h', text: 't' }, last_attempt_at: new Date(Date.now() - 3600_000).toISOString(), created_at: new Date(Date.now() - 3600_000).toISOString() });
  const f = fakeFetch([200]);
  const tick = await retryDueDeliveries(db, { fetchImpl: f.impl, sleep: noSleep });
  assert.equal(tick.claimed, 1);
  assert.equal(db.deliveries.find((d) => d.id === 'd-stale').status, 'SENT');
  assert.equal(db.deliveries.find((d) => d.id === 'd-fresh').status, 'QUEUED');
  assert.equal(f.calls[0].init.headers['Idempotency-Key'], resendIdempotencyKey('d-stale'));
});

test('the sweeper makes one provider call per row (its backoff is the retry) and gives up at max attempts', async () => {
  withEnv({ RESEND_API_KEY: 're_transactional' });
  const db = fakeDb();
  db.deliveries.push({ id: 'd1', notification_id: 'c', user_id: USER, channel: 'EMAIL', status: 'RETRYING', attempts: MAX_DELIVERY_ATTEMPTS - 1, max_attempts: MAX_DELIVERY_ATTEMPTS, next_attempt_at: new Date(Date.now() - 1).toISOString(), payload: { from: 'x', subject: 's', html: 'h', text: 't' }, created_at: new Date().toISOString() });
  const f = fakeFetch([500]);
  const tick = await retryDueDeliveries(db, { fetchImpl: f.impl, sleep: noSleep });
  assert.equal(f.calls.length, 1);
  assert.equal(tick.failed, 1);
  assert.equal(db.deliveries[0].status, 'FAILED');
  assert.match(db.deliveries[0].last_error, /^MAX_ATTEMPTS/);
});

test('an optional delivery whose person was suppressed meanwhile is SKIPPED, not re-sent; an essential one still goes', async () => {
  withEnv({ RESEND_API_KEY: 're_transactional' });
  const db = fakeDb({ prefs: { email_enabled: true, email_suppressed_at: NOW.toISOString() } });
  const due = new Date(Date.now() - 1).toISOString();
  const payload = { from: 'x', subject: 's', html: 'h', text: 't' };
  db.deliveries.push({ id: 'opt', notification_id: 'o', user_id: USER, channel: 'EMAIL', status: 'RETRYING', attempts: 1, max_attempts: 6, next_attempt_at: due, payload, essential: false, created_at: new Date().toISOString() });
  db.deliveries.push({ id: 'ess', notification_id: 'e', user_id: USER, channel: 'EMAIL', status: 'RETRYING', attempts: 1, max_attempts: 6, next_attempt_at: due, payload, essential: true, created_at: new Date().toISOString() });
  const f = fakeFetch([200]);
  const tick = await retryDueDeliveries(db, { fetchImpl: f.impl, sleep: noSleep });
  assert.equal(tick.skipped, 1);
  assert.equal(tick.sent, 1);
  assert.equal(db.deliveries.find((d) => d.id === 'opt').status, 'SKIPPED');
  assert.equal(db.deliveries.find((d) => d.id === 'ess').status, 'SENT');
});

test('duplicate events: the same notification is claimed once, so a retried producer sends nothing more', async () => {
  withEnv({ RESEND_API_KEY: 're_transactional' });
  const db = fakeDb();
  const f = fakeFetch([200]);
  const a = await sendNotificationEmail(db, { userId: USER, notificationId: 'dup', content: CONTENT }, { fetchImpl: f.impl, sleep: noSleep });
  const b = await sendNotificationEmail(db, { userId: USER, notificationId: 'dup', content: CONTENT }, { fetchImpl: f.impl, sleep: noSleep });
  assert.equal(a.status, 'SENT');
  assert.deepEqual(b, { status: 'SKIPPED', reason: 'ALREADY_ATTEMPTED' });
  assert.equal(f.calls.length, 1);
  assert.equal(db.deliveries.length, 1);
});

/* ── provider webhook mapping ──────────────────────────────────────── */

test('webhook status mapping only moves forward, and complaints and hard bounces suppress', () => {
  assert.deepEqual(providerEventEffect('SENT', 'email.delivered'), { status: 'DELIVERED', suppress: null });
  assert.deepEqual(providerEventEffect('BOUNCED', 'email.delivered'), { status: null, suppress: null }, 'a late delivered never undoes a bounce');
  assert.deepEqual(providerEventEffect('SENT', 'email.bounced', 'Permanent'), { status: 'BOUNCED', suppress: 'BOUNCED' });
  assert.deepEqual(providerEventEffect('SENT', 'email.bounced', 'Transient'), { status: 'BOUNCED', suppress: null });
  assert.deepEqual(providerEventEffect('DELIVERED', 'email.complained'), { status: 'COMPLAINED', suppress: 'COMPLAINED' });
  assert.deepEqual(providerEventEffect('SENT', 'email.failed'), { status: 'FAILED', suppress: null });
  assert.deepEqual(providerEventEffect('SENT', 'email.suppressed'), { status: 'FAILED', suppress: 'PROVIDER_SUPPRESSED' });
  for (const ev of ['email.sent', 'email.opened', 'email.clicked', 'email.delivery_delayed']) {
    assert.deepEqual(providerEventEffect('SENT', ev), { status: null, suppress: null }, ev);
  }
});

test('a webhook event updates the delivery by provider message id and suppresses optional mail on a complaint', async () => {
  const db = fakeDb();
  db.deliveries.push({ id: 'd', user_id: USER, channel: 'EMAIL', status: 'SENT', provider_message_id: 'em_1' });
  assert.equal(await applyProviderEvent(db, 'em_unknown', 'email.delivered'), false, 'someone else\'s email: the caller carries on');
  assert.equal(await applyProviderEvent(db, 'em_1', 'email.delivered', null, NOW), true);
  assert.equal(db.deliveries[0].status, 'DELIVERED');
  assert.equal(db.deliveries[0].delivered_at, NOW.toISOString());
  await applyProviderEvent(db, 'em_1', 'email.complained', null, NOW);
  assert.equal(db.deliveries[0].status, 'COMPLAINED');
  assert.equal(db.preferences[0].email_suppressed_reason, 'COMPLAINED');
});

/* ── preferences ───────────────────────────────────────────────────── */

test('essential mail is always sent; optional mail honours the switch, its category and a suppression', () => {
  for (const ev of ['PAYMENT_FAILED', 'SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_ENDED', 'SUBSCRIPTION_PAYMENT_DUE']) {
    assert.ok(isEssential(ev), ev);
    assert.equal(categoryOfEvent(ev), null);
    assert.equal(emailDecision(ev, { email_enabled: false, email_suppressed_at: 'x', email_categories: { billing: false } }), 'SEND', ev);
  }
  assert.equal(emailDecision('VERIFY_DONE', null), 'SEND', 'no row means the defaults');
  assert.equal(emailDecision('VERIFY_DONE', { email_enabled: false }), 'OPTED_OUT');
  assert.equal(emailDecision('VERIFY_DONE', { email_suppressed_at: '2026-10-29' }), 'SUPPRESSED');
  assert.equal(emailDecision('VERIFY_DONE', { email_categories: { ai_results: false } }), 'CATEGORY_OFF');
  assert.equal(emailDecision('VERIFY_DONE', { email_categories: { billing: false } }), 'SEND');
  assert.equal(emailDecision('TRIAL_USED', { email_categories: { billing: false } }), 'CATEGORY_OFF');
});

test('the event map: the subscription TYPE names the subscriptions workstream emits, Verify failure, unreadable documents stay in-app', () => {
  for (const t of ['SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_ENDED', 'SUBSCRIPTION_PAYMENT_DUE', 'TRIAL_USED', 'PAYMENT_FAILED']) assert.equal(emailEventFor(t), t);
  assert.equal(emailEventFor('SERVICE_FAILED', null, 'VERIFY'), 'VERIFY_FAILED');
  assert.equal(emailEventFor('SERVICE_FAILED', 'SERVICE_FAILED', 'FIND_CLIENTS'), 'SERVICE_FAILED');
  assert.equal(emailEventFor('SERVICE_FAILED', 'DOCUMENT_UNREADABLE'), null);
  assert.equal(emailEventFor('SEARCH_COMPLETE'), null, 'a saved search noticing a listing is not an async job');
});

test('optional mail carries a signed one-click unsubscribe (body link and List-Unsubscribe headers); essential mail none', async () => {
  withEnv({ RESEND_API_KEY: 're_transactional', SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_URL: 'https://proj.supabase.co' });
  const db = fakeDb();
  const sb = { ...db, functions: { invoke: async () => ({}) } };
  const realFetch = globalThis.fetch;
  const f = fakeFetch([200]);
  globalThis.fetch = f.impl;
  try {
    await maybeEmailNotification(sb, { notificationId: 'v1', userId: USER, type: 'VERIFY_COMPLETE', deepLink: '/verify?job=1' });
    await maybeEmailNotification(sb, { notificationId: 'p1', userId: USER, type: 'PAYMENT_FAILED', deepLink: '/billing' });
  } finally {
    globalThis.fetch = realFetch;
  }
  const [verify, payment] = f.calls.map((c) => c.body);
  const url = await unsubscribeUrl(USER, 'ai_results');
  assert.ok(url.startsWith('https://proj.supabase.co/functions/v1/email-webhook?nu='));
  assert.equal(verify.headers['List-Unsubscribe'], `<${url}>`);
  assert.equal(verify.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(verify.html.includes(url.replace(/&/g, '&amp;')));
  assert.equal(payment.headers, undefined, 'essential mail has no unsubscribe');
  assert.equal(db.deliveries.find((d) => d.notification_id === 'v1').essential, false);
  assert.equal(db.deliveries.find((d) => d.notification_id === 'p1').essential, true);
});

test('the unsubscribe page applies only a correctly signed link, for that account and category', async () => {
  const calls = [];
  const sb = { rpc: async (fn, args) => { calls.push({ fn, args }); return { data: { ok: true, language: 'en' }, error: null }; } };
  const token = await signUnsubscribeToken(`notify-email:${USER}:ai_results`, 'service-key');
  const good = new URL(`https://x/functions/v1/email-webhook?nu=${USER}&c=ai_results&t=${token}`);
  const res = await handleNotificationUnsubscribe(good, sb, 'service-key');
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('Done.'));
  assert.deepEqual(calls, [{ fn: 'notification_email_unsubscribe', args: { p_user_id: USER, p_category: 'ai_results' } }]);
  const otherCategory = new URL(`https://x/functions/v1/email-webhook?nu=${USER}&c=billing&t=${token}`);
  assert.equal((await handleNotificationUnsubscribe(otherCategory, sb, 'service-key')).status, 400);
  const forged = new URL(`https://x/functions/v1/email-webhook?nu=${USER}&c=ai_results&t=${'0'.repeat(64)}`);
  assert.equal((await handleNotificationUnsubscribe(forged, sb, 'service-key')).status, 400);
  assert.equal(calls.length, 1, 'nothing applied for a forged or altered link');
});

/* ── localisation ───────────────────────────────────────────────────── */

test('every event has a subject, body, button and next step in all six languages; ka/ar/he are never English; no dashes', () => {
  for (const ev of EMAIL_EVENTS) {
    const en = eventCopy(ev, 'en');
    for (const lang of LANGS) {
      const c = eventCopy(ev, lang);
      for (const [k, v] of Object.entries(c)) {
        assert.ok(v && v.trim(), `${ev}.${k} ${lang}`);
        assert.ok(!/[–—]/.test(v), `${ev}.${k} ${lang} uses a dash`);
        if (['ka', 'ar', 'he'].includes(lang)) assert.notEqual(v, en[k], `${ev}.${k} ${lang} is English`);
      }
      const f = frameCopy(ev, lang);
      assert.ok(f.footer && f.why && f.whyLabel && f.nextLabel, `${ev} frame ${lang}`);
      const mail = buildTransactionalEmail(ev, lang, '/x');
      assert.equal(mail.html.includes('dir="rtl"'), lang === 'ar' || lang === 'he');
      assert.ok(!/confirmed buyer|შესატყვისი/i.test(mail.text), `${ev} ${lang} terminology`);
    }
  }
  assert.equal(buildTransactionalEmail('SUBSCRIPTION_ACTIVATED', null, '/').subject, 'შენი HOMATCH-ის გეგმა გააქტიურდა', 'Georgian by default');
});

test('the stored notification text follows the recipient language for transactional types only', () => {
  assert.equal(storedCopyFor('VERIFY_COMPLETE', null, null, 'ka').title, 'ქონების შემოწმება დასრულდა');
  assert.equal(storedCopyFor('SUBSCRIPTION_RENEWED', null, null, 'en').title, 'Your HOMATCH plan has renewed');
  assert.equal(storedCopyFor('NEW_MESSAGE', null, null, 'ka'), null);
  assert.equal(storedCopyFor('SERVICE_FAILED', 'DOCUMENT_UNREADABLE', null, 'ka'), null, 'its own specific body is kept');
});

test('the Deno copy table is exactly what the i18n bundle says (regenerate with node scripts/saas-notify-copy.mjs)', async () => {
  const { copySource, COPY_FILE } = await import('../../../../scripts/saas-notify-copy.mjs');
  assert.equal(fs.readFileSync(COPY_FILE, 'utf8'), await copySource());
  assert.deepEqual(Object.keys(NOTIFICATION_COPY), ['ka', 'en', 'ru', 'tr', 'ar', 'he'], 'Georgian first');
});

/* ── no marketing path ──────────────────────────────────────────────── */

test('transactional mail never reads the marketing key and never goes through a marketing dispatcher', () => {
  const dir = path.join(ROOT, 'supabase', 'functions', '_shared');
  for (const f of ['notifyEmail.ts', 'transactionalEmail.ts', 'notificationCopy.ts', 'notify.ts', 'jobNotify.ts']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
    assert.ok(!/MARKETING|resolveResendKey|marketingKey|emailMarketing|broadcast|outreach/i.test(src), `${f} touches a marketing path`);
  }
  const sender = fs.readFileSync(path.join(dir, 'notifyEmail.ts'), 'utf8');
  assert.match(sender, /env\.get\('RESEND_API_KEY'\)/);
});

test('the marketing key resolver no longer falls back to the transactional key', () => {
  const src = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', '_shared', 'resend', 'client.ts'), 'utf8');
  assert.match(src, /if \(purpose === 'marketing'\) return \{ key: null, envName: null, keyFallback: false \};/);
  assert.ok(!/keyFallback: purpose === 'marketing'/.test(src));
});

test('the migration is additive: new statuses, retry columns, suppression, audited admin retry', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261207150000_notification_delivery_reliability.sql'), 'utf8');
  for (const s of ['QUEUED', 'RETRYING', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'SKIPPED']) assert.ok(sql.includes(`'${s}'`), s);
  for (const c of ['attempts', 'next_attempt_at', 'last_error', 'payload', 'email_suppressed_at', 'email_categories']) assert.ok(sql.includes(`add column if not exists ${c}`), c);
  assert.match(sql, /notification_deliveries_provider_message_idx/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /insert into public\.admin_audit_log[\s\S]*notification_delivery\.retry/);
  assert.match(sql, /add value if not exists 'TRIAL_USED'/);
  assert.match(sql, /add value if not exists 'SUBSCRIPTION_PAYMENT_DUE'/);
  assert.ok(!/\bdrop (table|column)\b/i.test(sql));
});

test('SUBSCRIPTION_PAYMENT_DUE is essential billing mail: always sent, no unsubscribe, opens the subscription page', () => {
  assert.ok(isEssential('SUBSCRIPTION_PAYMENT_DUE'));
  assert.equal(categoryOfEvent('SUBSCRIPTION_PAYMENT_DUE'), null);
  assert.equal(emailDecision('SUBSCRIPTION_PAYMENT_DUE', { email_enabled: false, email_suppressed_at: 'x' }), 'SEND');
  const ka = buildTransactionalEmail('SUBSCRIPTION_PAYMENT_DUE', null, '/account/subscription', 'https://unsub.example/x');
  assert.equal(ka.subject, 'შენი HOMATCH-ის გეგმისთვის გადახდაა საჭირო');
  assert.ok(ka.html.includes('https://homatch.live/account/subscription'));
  assert.ok(!ka.html.includes('unsub.example'), 'essential mail never carries an unsubscribe link');
  const push = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'push-send', 'index.ts'), 'utf8');
  assert.match(push, /eventType\.startsWith\('SUBSCRIPTION_'\)[\s\S]{0,300}return 'billing'/, 'push files every SUBSCRIPTION_* type under billing');
});

test('subscription, payment and trial events always link to /account/subscription; others keep their own link', async () => {
  for (const t of ['SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_ENDED', 'SUBSCRIPTION_PAYMENT_DUE', 'PAYMENT_FAILED', 'TRIAL_USED']) {
    assert.equal(deepLinkFor(t, '/credits'), SUBSCRIPTION_PAGE, t);
  }
  assert.equal(deepLinkFor('VERIFY_COMPLETE', '/verify?job=1'), '/verify?job=1');
  withEnv({});
  const { notify } = await import('../notify.ts');
  const emitted = [];
  const sb = { rpc: async (fn, args) => { emitted.push(args); return { data: 'n-1', error: null }; }, functions: { invoke: async () => ({}) } };
  await notify(sb, { userId: USER, type: 'SUBSCRIPTION_PAYMENT_DUE', title: 'x', deepLink: '/billing', email: false });
  assert.equal(emitted[0].p_deep_link, '/account/subscription');
  assert.equal(emitted[0].p_type, 'SUBSCRIPTION_PAYMENT_DUE');
});
