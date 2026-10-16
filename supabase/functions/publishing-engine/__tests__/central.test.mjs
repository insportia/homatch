// The central engine, pure: the owner-contact footer, the two contact identities,
// routing by portal capability and HOMATCH-account state, account status rules,
// the state machine's central commands and credential encryption.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerFooter, stripOwnerFooter, withFooter, withOwnerFooter } from '../contacts.ts';
import { centralCopy, emptyAccount, accountView, registeredStatus, routeFor, sanitizeAccountPatch, ACCOUNT_COLUMNS } from '../central.ts';
import { normalizeListing, transition } from '../domain.ts';
import { PROFILES, adapterFor, configs } from '../providers.ts';
import { openCredential, sealCredential } from '../vault.ts';

const P = Object.fromEntries(configs().map((c) => [c.id, c]));
const NOW = new Date('2026-10-16T12:00:00Z');
const OWNER = { name: 'ნინო ბერიძე', phone: '+995599111222' };
const HOMATCH_PHONE = '+995322000111';
const listing = () => normalizeListing({
  title: 'ბინა ვაკეში', description: { ka: 'სამოთახიანი ბინა.', en: 'Three-room flat.' }, propertyType: 'APARTMENT', dealType: 'SALE',
  price: 150000, city: 'თბილისი', contactName: OWNER.name, contacts: [{ phone: OWNER.phone }],
});
const registered = (over = {}) => ({ ...emptyAccount('myhome'), status: 'PUBLISHING_RESTRICTED', connection_method: 'MANUAL', account_label: 'homatch@myhome', contact_phone: HOMATCH_PHONE, ...over });

test('the owner footer reads exactly as specified, in Georgian', () => {
  assert.equal(ownerFooter(OWNER, 'ka'), [
    'საკონტაქტო ინფორმაცია',
    'ქონების მფლობელი: ნინო ბერიძე',
    'ტელეფონი: +995 599 11 12 22',
    'განცხადება გამოქვეყნებულია HOMATCH-ის მეშვეობით.',
  ].join('\n'));
  assert.match(ownerFooter(OWNER, 'en'), /^Contact information\nProperty owner: ნინო ბერიძე\nPhone: \+995 599 11 12 22\nThis listing was published via HOMATCH\.$/);
  assert.match(ownerFooter(OWNER, 'ru'), /Владелец недвижимости: ნინო ბერიძე/);
});

test('the owner footer is appended exactly once, at the end, however often it is applied', () => {
  const once = withOwnerFooter('ბინა.', OWNER, 'ka');
  assert.equal(withOwnerFooter(once, OWNER, 'ka'), once);
  assert.equal(withOwnerFooter(withOwnerFooter(once, OWNER, 'en'), OWNER, 'ka'), once, 'a footer in another language is replaced, not stacked');
  assert.equal(withOwnerFooter(withFooter('ბინა.', [{ phone: OWNER.phone, whatsapp: true, viber: false }], 'ka'), OWNER, 'ka'), once, 'a v1 number footer is replaced');
  assert.equal(once.split('საკონტაქტო ინფორმაცია').length - 1, 1);
  assert.ok(once.endsWith('განცხადება გამოქვეყნებულია HOMATCH-ის მეშვეობით.'));
  assert.equal(stripOwnerFooter(once), 'ბინა.');
  // Text the owner wrote that merely mentions the header is kept.
  assert.equal(stripOwnerFooter('საკონტაქტო ინფორმაცია მოგვიანებით'), 'საკონტაქტო ინფორმაცია მოგვიანებით');
});

test('no footer without a name and a valid number', () => {
  assert.equal(ownerFooter({ name: '', phone: OWNER.phone }), '');
  assert.equal(ownerFooter({ name: 'Nino', phone: '599111' }), '');
  assert.equal(withOwnerFooter('text', { name: '', phone: '' }), 'text');
});

test('the two contact identities never trade places in a HOMATCH-account copy', () => {
  for (const lang of ['ka', 'en']) {
    const copy = centralCopy(listing(), P.myhome, { contact_phone: HOMATCH_PHONE }, lang);
    assert.equal(copy.contactPhone, HOMATCH_PHONE, 'the portal contact field carries the HOMATCH account phone');
    assert.notEqual(copy.contactPhone, OWNER.phone);
    assert.ok(copy.description.endsWith(copy.footer), 'the owner footer is at the end');
    assert.ok(copy.footer.includes('+995 599 11 12 22'), 'the owner phone is in the footer');
    assert.ok(!copy.description.includes('+995 32 2000111') && !copy.description.includes(HOMATCH_PHONE), 'the HOMATCH phone is not in the owner footer');
    assert.equal(copy.description.split('+995 599 11 12 22').length - 1, 1, 'the owner phone appears exactly once');
  }
});

test('every portal is classified, and none claims automation that has not been verified', () => {
  assert.equal(PROFILES.length, 8);
  for (const c of configs()) {
    assert.ok(['API', 'BROWSER_ASSISTED', 'MANUAL_ADMIN', 'BLOCKED'].includes(c.capabilities.automation), c.id);
    assert.equal(c.capabilities.automation, 'MANUAL_ADMIN', `${c.id}: no verified API or permitted browser mechanism exists`);
    assert.ok(c.capabilities.automationNote, c.id);
    assert.equal(adapterFor(c).acceptsCredential(), false, `${c.id}: no mechanism would use a stored credential`);
    for (const op of ['connectAccount', 'testConnection', 'createListing', 'updateListing', 'deleteListing']) {
      assert.deepEqual(adapterFor(c).run(op), { ok: false, code: 'CAPABILITY_NOT_SUPPORTED', capability: op, provider: c.id });
    }
  }
  assert.equal(P.korter.capabilities.automationNote, 'TERMS_FORBID_AUTOMATED_ACCESS');
  assert.equal(P.binebi.capabilities.automationNote, 'BOT_CHALLENGE_ON_PUBLIC_PAGES');
});

test('routing: no account waits, a registered manual account goes to the admin queue, nothing is auto-queued', () => {
  assert.deepEqual(routeFor(P.myhome, null, NOW), { route: 'AUTH_REQUIRED' });
  assert.deepEqual(routeFor(P.myhome, emptyAccount('myhome'), NOW), { route: 'AUTH_REQUIRED' });
  assert.deepEqual(routeFor(P.myhome, registered(), NOW), { route: 'ADMIN_ACTION_REQUIRED' });
  assert.deepEqual(routeFor(P.myhome, registered({ status: 'SESSION_EXPIRED' }), NOW), { route: 'AUTH_REQUIRED' });
  assert.deepEqual(routeFor(P.myhome, registered({ session_expires_at: '2026-10-16T11:00:00Z' }), NOW), { route: 'AUTH_REQUIRED' });
  // Even a (hypothetically) available account does not auto-queue for a manual portal.
  assert.deepEqual(routeFor(P.myhome, registered({ status: 'PUBLISHING_AVAILABLE', verified_at: '2026-10-16T10:00:00Z' }), NOW), { route: 'ADMIN_ACTION_REQUIRED' });
  // An automatable portal auto-queues only with a verified available account.
  const api = { ...P.ssge, capabilities: { ...P.ssge.capabilities, automation: 'API' } };
  assert.deepEqual(routeFor(api, registered({ status: 'PUBLISHING_AVAILABLE', verified_at: null }), NOW), { route: 'ADMIN_ACTION_REQUIRED' });
  assert.deepEqual(routeFor(api, registered({ status: 'PUBLISHING_AVAILABLE', verified_at: '2026-10-16T10:00:00Z' }), NOW), { route: 'QUEUED' });
  assert.deepEqual(routeFor({ ...P.myhome, enabled: false }, registered(), NOW), { error: 'PORTAL_DISABLED' });
  assert.deepEqual(routeFor(P.myhome, registered({ status: 'UNSUPPORTED' }), NOW), { error: 'PORTAL_UNSUPPORTED' });
});

test('registering an account never yields a verified status', () => {
  assert.equal(registeredStatus(P.myhome, { account_label: null, contact_phone: null }), 'NOT_CONFIGURED');
  assert.equal(registeredStatus(P.myhome, { account_label: 'x', contact_phone: HOMATCH_PHONE }), 'PUBLISHING_RESTRICTED');
  const api = { ...P.ssge, capabilities: { ...P.ssge.capabilities, automation: 'API' } };
  assert.equal(registeredStatus(api, { account_label: 'x', contact_phone: HOMATCH_PHONE }), 'AUTH_REQUIRED');
  for (const c of configs()) assert.ok(!['CONNECTED', 'PUBLISHING_AVAILABLE'].includes(registeredStatus(c, { account_label: 'x', contact_phone: HOMATCH_PHONE })));
});

test('account form validation; the credential is never selected or shown', () => {
  assert.deepEqual(sanitizeAccountPatch({ accountLabel: ' homatch@myhome.ge ', contactPhone: '+995 32 200 01 11' }), { patch: { account_label: 'homatch@myhome.ge', contact_phone: '+995322000111', connection_method: 'MANUAL' } });
  assert.deepEqual(sanitizeAccountPatch({ accountLabel: '', contactPhone: HOMATCH_PHONE }), { error: 'ACCOUNT_LABEL_REQUIRED' });
  assert.deepEqual(sanitizeAccountPatch({ accountLabel: 'x', contactPhone: '123' }), { error: 'ACCOUNT_PHONE_INVALID' });
  assert.deepEqual(sanitizeAccountPatch({ accountLabel: 'password: hunter2', contactPhone: HOMATCH_PHONE }), { error: 'ACCOUNT_LABEL_INVALID' });
  assert.deepEqual(sanitizeAccountPatch({ accountLabel: 'x', contactPhone: HOMATCH_PHONE, connectionMethod: 'SCRAPE' }), { error: 'INVALID_CONNECTION_METHOD' });
  assert.ok(!ACCOUNT_COLUMNS.split(',').includes('credential'));
  const view = accountView({ ...registered(), credential: { ct: 'x', iv: 'y' }, credential_set_at: '2026-10-16T00:00:00Z' }, 'myhome');
  assert.equal('credential' in view, false);
  assert.equal(view.hasCredential, true);
});

const central = (over = {}) => ({ status: 'ADMIN_ACTION_REQUIRED', channel: 'HOMATCH_ACCOUNT', revision: 0, external_id: null, external_url: null, listing_version: 1, check_attempts: 0, last_checked_at: null, next_check_at: null, published_at: null, last_error: null, contact_consent_at: '2026-10-16T11:00:00Z', ...over });

test('publish: consent required, idempotent, never reports success, refuses a live copy', () => {
  assert.deepEqual(transition(null, { type: 'PUBLISH', listingVersion: 1, route: 'ADMIN_ACTION_REQUIRED', consentAt: '' }, NOW), { error: 'CONTACT_CONSENT_REQUIRED' });
  const t = transition(null, { type: 'PUBLISH', listingVersion: 1, route: 'ADMIN_ACTION_REQUIRED', consentAt: NOW.toISOString() }, NOW);
  assert.equal(t.set.status, 'ADMIN_ACTION_REQUIRED');
  assert.equal(t.set.channel, 'HOMATCH_ACCOUNT');
  assert.equal(t.set.published_at, null);
  assert.deepEqual(transition(central(), { type: 'PUBLISH', listingVersion: 1, route: 'ADMIN_ACTION_REQUIRED', consentAt: NOW.toISOString() }, NOW), { error: 'NO_CHANGE' });
  assert.equal(transition(central(), { type: 'PUBLISH', listingVersion: 2, route: 'ADMIN_ACTION_REQUIRED', consentAt: NOW.toISOString() }, NOW).set.listing_version, 2);
  for (const status of ['PUBLISHED', 'VERIFYING', 'OWNER_CONFIRMED', 'PUBLISHING', 'UNPUBLISH_REQUESTED']) {
    assert.deepEqual(transition(central({ status }), { type: 'PUBLISH', listingVersion: 2, route: 'ADMIN_ACTION_REQUIRED', consentAt: NOW.toISOString() }, NOW), { error: 'PUBLICATION_ALREADY_ACTIVE' }, status);
  }
  for (const status of ['REJECTED', 'FAILED', 'UNPUBLISHED']) {
    assert.equal(transition(central({ status }), { type: 'PUBLISH', listingVersion: 2, route: 'ADMIN_ACTION_REQUIRED', consentAt: NOW.toISOString() }, NOW).set.status, 'ADMIN_ACTION_REQUIRED', status);
  }
});

test('admin completion links the portal listing but is not "published" until the public page confirms it', () => {
  const linked = transition(central({ status: 'PUBLISHING' }), { type: 'ADMIN_COMPLETE', url: 'https://www.myhome.ge/ka/pr/123456/', externalId: '123456', listingVersion: 1, verification: 'PAGE_CHECK', admin: 'a' }, NOW);
  assert.equal(linked.set.status, 'VERIFYING');
  assert.equal(linked.set.published_at, undefined);
  const after = { ...central({ status: 'VERIFYING' }), ...linked.set };
  assert.equal(transition(after, { type: 'CHECK', outcome: { result: 'UNKNOWN', code: 'HTTP_200' } }, NOW).set.status, undefined, 'a generic answer is not a confirmation');
  assert.equal(transition(after, { type: 'CHECK', outcome: { result: 'LIVE' } }, NOW).set.status, 'PUBLISHED');
  const attested = transition(central({ status: 'PUBLISHING' }), { type: 'ADMIN_COMPLETE', url: 'https://korter.ge/x/4521', externalId: '4521', listingVersion: 1, verification: 'OWNER_CONFIRMED', admin: 'a' }, NOW);
  assert.equal(attested.set.status, 'OWNER_CONFIRMED');
  assert.equal(attested.detail.attestedBy, 'ADMIN');
});

test('admin queue commands and owner limits on a HOMATCH-account publication', () => {
  assert.equal(transition(central(), { type: 'ADMIN_CLAIM', admin: 'a' }, NOW).set.status, 'PUBLISHING');
  assert.equal(transition(central({ status: 'PUBLISHING' }), { type: 'ADMIN_RELEASE' }, NOW).set.status, 'ADMIN_ACTION_REQUIRED');
  assert.deepEqual(transition(central(), { type: 'ADMIN_REJECT', reason: '  ', admin: 'a' }, NOW), { error: 'REASON_REQUIRED' });
  const rej = transition(central({ status: 'PUBLISHING' }), { type: 'ADMIN_REJECT', reason: 'Portal moderation: photos', admin: 'a' }, NOW);
  assert.equal(rej.set.status, 'REJECTED');
  assert.equal(rej.set.status_reason, 'Portal moderation: photos');
  assert.equal(transition(central(), { type: 'ADMIN_FAIL', reason: 'Portal down', admin: 'a' }, NOW).set.status, 'FAILED');
  assert.equal(transition(central(), { type: 'CANCEL' }, NOW).set.status, 'UNPUBLISHED');
  assert.equal(transition(central({ status: 'AUTH_REQUIRED' }), { type: 'REROUTE', route: 'ADMIN_ACTION_REQUIRED' }, NOW).set.status, 'ADMIN_ACTION_REQUIRED');
  assert.deepEqual(transition(central({ status: 'PUBLISHED' }), { type: 'CANCEL' }, NOW), { error: 'NOT_QUEUED' });
  // The owner cannot link, attest removal of or mark-updated HOMATCH's copy.
  assert.deepEqual(transition(central({ status: 'VERIFICATION_FAILED' }), { type: 'LINK', url: 'https://www.myhome.ge/ka/pr/1/', externalId: '1', listingVersion: 1 }, NOW), { error: 'HOMATCH_MANAGED' });
  assert.deepEqual(transition(central({ status: 'UNPUBLISH_REQUESTED' }), { type: 'CONFIRM_REMOVED' }, NOW), { error: 'HOMATCH_MANAGED' });
  const un = transition(central({ status: 'PUBLISHED' }), { type: 'REQUEST_UNPUBLISH' }, NOW);
  assert.equal(un.set.status, 'UNPUBLISH_REQUESTED');
  assert.equal(un.set.next_check_at, null);
  assert.equal(transition(central({ status: 'UNPUBLISH_REQUESTED' }), { type: 'ADMIN_CONFIRM_REMOVED', admin: 'a' }, NOW).set.status, 'UNPUBLISHED');
  // Admin commands never act on an owner-handoff publication.
  assert.deepEqual(transition({ ...central(), channel: 'OWNER_HANDOFF', status: 'HANDOFF_READY' }, { type: 'ADMIN_CLAIM', admin: 'a' }, NOW), { error: 'NOT_AWAITING_ADMIN' });
});

test('credentials: AES-GCM, bound to the portal, unreadable without the key', async () => {
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const env = await sealCredential('s3cret-token', 'ssge', key);
  assert.equal(env.v, 1);
  assert.ok(!JSON.stringify(env).includes('s3cret'));
  assert.equal(await openCredential(env, 'ssge', key), 's3cret-token');
  await assert.rejects(openCredential(env, 'myhome', key), /CREDENTIAL_UNREADABLE/);
  const other = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  await assert.rejects(openCredential(env, 'ssge', other), /CREDENTIAL_KEY_MISMATCH/);
  await assert.rejects(sealCredential('x', 'ssge', undefined), /CREDENTIAL_KEY_NOT_CONFIGURED/);
  await assert.rejects(sealCredential('x', 'ssge', 'c2hvcnQ='), /CREDENTIAL_KEY_INVALID/);
});
