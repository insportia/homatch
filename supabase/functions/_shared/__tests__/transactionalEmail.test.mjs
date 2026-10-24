// Transactional email: only the events a person started, in their language, at most once,
// never to someone who switched email off (except a failed payment), links only to our own paths.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTransactionalEmail, emailEventFor, maybeEmailNotification, pickLang, safeLink } from '../transactionalEmail.ts';

test('only person-initiated outcomes earn an email', () => {
  assert.equal(emailEventFor('VERIFY_COMPLETE'), 'VERIFY_DONE');
  assert.equal(emailEventFor('DOCUMENT_ANALYZED'), 'CONTRACT_DONE');
  assert.equal(emailEventFor('CREDITS_TOPPED_UP'), 'PAYMENT_OK');
  assert.equal(emailEventFor('PAYMENT_FAILED'), 'PAYMENT_FAILED');
  assert.equal(emailEventFor('SERVICE_FAILED'), 'SERVICE_FAILED');
  for (const t of ['NEW_MESSAGE', 'MATCH_AVAILABLE', 'ANNOUNCEMENT', 'META_LEAD', 'EXPAT_TASK_DUE']) assert.equal(emailEventFor(t), null, t);
});

test('the person\'s stored language, Georgian when none', () => {
  assert.equal(pickLang(null), 'ka');
  assert.equal(pickLang('xx'), 'ka');
  assert.equal(pickLang('en-US'), 'en');
  const ka = buildTransactionalEmail('CONTRACT_DONE', null, '/contracts/abc');
  assert.equal(ka.subject, 'ხელშეკრულების ანალიზი დასრულდა');
  assert.ok(ka.html.includes('დოკუმენტის გახსნა'));
  assert.ok(ka.html.includes('dir="ltr"'));
  const he = buildTransactionalEmail('PAYMENT_OK', 'he', '/credits');
  assert.ok(he.html.includes('dir="rtl"'));
  assert.ok(buildTransactionalEmail('VERIFY_DONE', 'ka', '/verify?job=1').subject === 'ქონების შემოწმება დასრულდა');
});

test('approved Georgian wording for every event', () => {
  const subjects = ['VERIFY_DONE', 'CONTRACT_DONE', 'PAYMENT_OK', 'PAYMENT_FAILED', 'SERVICE_FAILED'].map((e) => buildTransactionalEmail(e, 'ka', '/').subject);
  assert.deepEqual(subjects, ['ქონების შემოწმება დასრულდა', 'ხელშეკრულების ანალიზი დასრულდა', 'გადახდა წარმატებით შესრულდა', 'გადახდის შესრულება ვერ მოხერხდა', 'დავალების შესრულებისას პრობლემა წარმოიშვა']);
});

test('links are our own paths only; anything else goes to the home page', () => {
  assert.equal(safeLink('/contracts/123'), 'https://homatch.live/contracts/123');
  assert.equal(safeLink('//evil.example/x'), 'https://homatch.live/');
  assert.equal(safeLink('https://evil.example'), 'https://homatch.live/');
  assert.equal(safeLink('javascript:alert(1)'), 'https://homatch.live/');
  assert.equal(safeLink(null), 'https://homatch.live/');
});

test('the official logo is in the header and text is escaped', () => {
  const e = buildTransactionalEmail('VERIFY_DONE', 'en', '/verify?job=<x>');
  assert.ok(e.html.includes('https://homatch.live/images/logo/homatch-icon.png'));
  assert.ok(!e.html.includes('<x>'));
});

/* A tiny fake client: users, preferences, deliveries (unique per notification and channel). */
function fakeDb({ lang = 'ka', emailEnabled = null } = {}) {
  const deliveries = [];
  const table = (name) => {
    const q = { filters: {}, select() { return q; }, eq(k, v) { q.filters[k] = v; return q; },
      async maybeSingle() {
        if (name === 'users') return { data: { preferred_language: lang, email: 'person@example.com' } };
        if (name === 'notification_preferences') return { data: emailEnabled === null ? null : { email_enabled: emailEnabled } };
        if (name === 'notification_deliveries') return { data: deliveries.find((d) => d.notification_id === q.filters.notification_id && d.channel === q.filters.channel) ?? null };
        return { data: null };
      },
      async insert(row) {
        if (deliveries.some((d) => d.notification_id === row.notification_id && d.channel === row.channel)) return { error: { message: 'duplicate key' } };
        deliveries.push(row); return { error: null };
      } };
    return q;
  };
  return { from: table, deliveries };
}

test('opted-out people get no email, except for a failed payment; no provider key means SKIPPED, never faked', async () => {
  globalThis.Deno = { env: { get: () => undefined } };
  const off = fakeDb({ emailEnabled: false });
  assert.equal(await maybeEmailNotification(off, { notificationId: 'n1', userId: 'u', type: 'VERIFY_COMPLETE', deepLink: '/verify' }), 'OPTED_OUT');
  assert.equal(off.deliveries.length, 0);
  assert.equal(await maybeEmailNotification(off, { notificationId: 'n2', userId: 'u', type: 'PAYMENT_FAILED', deepLink: '/credits' }), 'SKIPPED');
  assert.equal(off.deliveries[0].reason, 'NO_PROVIDER');
  assert.equal(await maybeEmailNotification(off, { notificationId: 'n3', userId: 'u', type: 'NEW_MESSAGE' }), 'NOT_EMAILED');
});

test('the same notification is never emailed twice', async () => {
  globalThis.Deno = { env: { get: () => undefined } };
  const db = fakeDb();
  await maybeEmailNotification(db, { notificationId: 'n9', userId: 'u', type: 'DOCUMENT_ANALYZED', deepLink: '/contracts/1' });
  await maybeEmailNotification(db, { notificationId: 'n9', userId: 'u', type: 'DOCUMENT_ANALYZED', deepLink: '/contracts/1' });
  assert.equal(db.deliveries.length, 1);
});
