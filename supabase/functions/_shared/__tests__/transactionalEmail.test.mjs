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
  /* A Find Buyers / Tenants search the person ran earns one; a saved search noticing a listing does not. */
  assert.equal(emailEventFor('SEARCH_COMPLETE', 'FIND_CLIENTS_DONE'), 'SEARCH_DONE');
  assert.equal(emailEventFor('SEARCH_COMPLETE'), null);
  for (const lang of ['ka', 'en', 'ru', 'tr', 'ar', 'he']) {
    const e = buildTransactionalEmail('SEARCH_DONE', lang, '/property/p/buyers/external?job=m');
    assert.ok(!/confirmed buyer|[–—]/i.test(e.text), `${lang}: never "confirmed buyer", no dashes`);
  }
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
  // The host that serves the PNG directly: the apex answers 308, and Outlook does not follow
  // redirects for images (2026-10-30: the logo was missing there).
  assert.match(e.html, /<img src="https:\/\/www\.homatch\.live\/images\/logo\/homatch-icon\.png" width="40" height="40" alt="HOMATCH"/);
  assert.ok(!e.html.includes('src="https://homatch.live/'), 'never the redirecting apex for an image');
  assert.match(e.html, />HOMATCH<\/td>/, 'the wordmark is text: the header still reads HOMATCH with images blocked');
  assert.match(e.html, /<meta name="color-scheme" content="light dark">/);
  assert.match(e.html, /bgcolor="#0C1119"/, 'Outlook paints the dark header from bgcolor');
  assert.ok(!e.html.includes('<x>'));
});

test('every language and direction gets the same logo header; RTL mirrors only the spacing', () => {
  for (const lang of ['ka', 'en', 'ru', 'tr', 'ar', 'he']) {
    const e = buildTransactionalEmail('VERIFY_DONE', lang, '/verify');
    assert.equal((e.html.match(/homatch-icon\.png/g) ?? []).length, 1, lang);
    assert.match(e.html, lang === 'ar' || lang === 'he' ? /padding-left:12px/ : /padding-right:12px/, lang);
  }
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

/*
 * The premise changed (owner, 2026-10-29): credits are no longer sold and a failed payment
 * is usually a subscription charge. So a failed payment email no longer talks about a
 * top-up or Credits, and it must not promise anything about a plan either: it only says the
 * payment did not go through and changed nothing.
 */
test('a failed payment email is plan neutral: no Credits, no top-up, no plan promise, in any language', () => {
  const banned = /credit|top-up|კრედიტ|ბალანსის შევსება|кредит|пополнени|kredi|bakiye|رصيد|أرصدة|קרדיט|טעינ|renew|გეგმა განახლ|продл|yenilen|تتجدد|תתחדש/i;
  for (const lang of ['ka', 'en', 'ru', 'tr', 'ar', 'he']) {
    const e = buildTransactionalEmail('PAYMENT_FAILED', lang, '/billing');
    assert.ok(!banned.test(e.text), `PAYMENT_FAILED ${lang}: ${e.text}`);
  }
  assert.ok(buildTransactionalEmail('PAYMENT_FAILED', 'en', '/billing').text.includes('changed nothing on your account'));
});

test('a notice emitted with email: false never reaches the email leg', async () => {
  globalThis.Deno = { env: { get: () => undefined } };
  const { notify } = await import('../notify.ts');
  const db = fakeDb();
  let emitted = 0;
  const sb = { ...db, rpc: async () => { emitted += 1; return { data: `n-${emitted}`, error: null }; }, functions: { invoke: async () => ({ data: null, error: null }) } };
  await notify(sb, { userId: 'u', type: 'SERVICE_FAILED', title: 't', email: false, metadata: { kind: 'DOCUMENT_UNREADABLE', reason: 'doc_error_requires_ocr' } });
  assert.equal(db.deliveries.length, 0, 'no delivery row, no email');
  await notify(sb, { userId: 'u', type: 'SERVICE_FAILED', title: 't' });
  assert.equal(db.deliveries.length, 1, 'a real failure still takes the email leg (SKIPPED here: no provider)');
  assert.equal(db.deliveries[0].reason, 'NO_PROVIDER');
});
