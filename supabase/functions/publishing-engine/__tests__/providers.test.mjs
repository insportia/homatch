// Providers, adapters, robots.txt and the contact footer. Pure — no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contactFooter, contactLinks, formatPhone, normalizeContacts, stripFooter, withFooter } from '../contacts.ts';
import { OPERATIONS, PROFILES, adapterFor, configFor, configs, profileById, robotsAllows, sanitizePatch } from '../providers.ts';

const C = [{ phone: '+995555123456', whatsapp: true, viber: true }];

test('the footer has the agreed shape, in plain text', () => {
  assert.equal(contactFooter(C), 'დაგვიკავშირდით მხოლოდ მითითებულ ნომრებზე:\n\n📞 +995 555 12 34 56\n📱 WhatsApp · Viber');
  assert.equal(contactFooter([{ phone: '+995555123456', whatsapp: false, viber: false }]), 'დაგვიკავშირდით მხოლოდ მითითებულ ნომრებზე:\n\n📞 +995 555 12 34 56', 'call only: no app line');
  assert.equal(contactFooter([{ phone: '+995555123456', whatsapp: false, viber: true }], 'en').split('\n').pop(), '📱 Viber');
  assert.equal(contactFooter([{ phone: 'garbage', whatsapp: true, viber: true }]), '', 'an invalid number produces no footer');
  assert.doesNotMatch(contactFooter(C), /<|>|\*\*|\[/);
});

test('the footer is appended exactly once, and is never stored in the description', () => {
  const once = withFooter('ბინა ვაკეში', C);
  assert.equal(withFooter(once, C), once, 'appending to a copy that already carries the footer does not double it');
  assert.equal(stripFooter(once), 'ბინა ვაკეში');
  assert.equal(withFooter('', C), contactFooter(C));
  // Changing the numbers replaces the old footer rather than stacking a second one.
  const changed = withFooter(once, [{ phone: '+995577000000', whatsapp: false, viber: false }]);
  assert.equal((changed.match(/დაგვიკავშირდით/g) ?? []).length, 1);
  assert.match(changed, /\+995 577 00 00 00/);
  assert.doesNotMatch(changed, /555 12 34 56/);
  // A description that merely mentions the header mid-text keeps its words.
  const prose = 'დაგვიკავშირდით მხოლოდ მითითებულ ნომრებზე: ან მოგვწერეთ საიტზე';
  assert.equal(stripFooter(prose), prose);
});

test('contact links: tel always, WhatsApp / Viber only when switched on', () => {
  assert.deepEqual(contactLinks(C[0]), { call: 'tel:+995555123456', whatsapp: 'https://wa.me/995555123456', viber: 'viber://chat?number=%2B995555123456' });
  assert.deepEqual(contactLinks({ phone: '+995555123456', whatsapp: false, viber: false }), { call: 'tel:+995555123456', whatsapp: null, viber: null });
  assert.equal(formatPhone('+12025550123'), '+12025550123');
  assert.deepEqual(normalizeContacts([{ phone: '+995 555 12-34-56', whatsapp: 'yes', viber: 1 }]), [{ phone: '+995555123456', whatsapp: false, viber: false }], 'only literal true switches a channel on');
});

test('the browser copy of contacts.ts is byte-identical to the server copy', () => {
  const server = readFileSync(new URL('../contacts.ts', import.meta.url), 'utf8');
  const browser = readFileSync(new URL('../../../../src/publishing/contacts.ts', import.meta.url), 'utf8');
  assert.equal(browser, server);
});

test('every adapter refuses API operations with an explicit capability error', () => {
  for (const c of configs()) {
    const a = adapterFor(c);
    for (const op of OPERATIONS) assert.deepEqual(a.run(op), { ok: false, code: 'CAPABILITY_NOT_SUPPORTED', capability: op, provider: c.id });
    assert.equal(a.getCapabilities().accountConnection, false);
  }
  assert.equal(PROFILES.length, 8);
});

test('owner-confirmed portals can never be switched to automated checks', () => {
  const korter = profileById('korter');
  assert.equal(sanitizePatch(korter, { verification: 'PAGE_CHECK' }).error, 'PAGE_CHECK_NOT_PERMITTED');
  const row = { id: 'korter', enabled: true, sort: 5, create_url: null, logo_url: null, verification: 'PAGE_CHECK', max_photos: null, description_max: null, required_fields: [] };
  assert.equal(configFor(korter, row).verification, 'OWNER_CONFIRMED', 'even a row that says PAGE_CHECK is ignored');
  assert.equal(adapterFor(configFor(korter, row)).canCheckPage(), false);
  // ...but a page-check portal may be relaxed to owner confirmation.
  assert.deepEqual(sanitizePatch(profileById('homege'), { verification: 'OWNER_CONFIRMED' }).patch, { verification: 'OWNER_CONFIRMED' });
});

test('admin patches: links stay on https and the portal\'s own domain; rules from the whitelist only', () => {
  const place = profileById('placege');
  assert.equal(sanitizePatch(place, { createUrl: 'https://place.ge/ge/ads/add' }).patch.create_url, 'https://place.ge/ge/ads/add');
  for (const bad of ['http://place.ge/add', 'https://place.ge.evil.test/add', 'https://evil.test/', 'javascript:alert(1)', 'https://u:p@place.ge/']) {
    assert.equal(sanitizePatch(place, { createUrl: bad }).error, 'CREATE_URL_MUST_BE_ON_PORTAL', bad);
  }
  assert.equal(sanitizePatch(place, { logoUrl: 'http://cdn.test/logo.png' }).error, 'LOGO_URL_MUST_BE_HTTPS');
  assert.equal(sanitizePatch(place, { logoUrl: null }).patch.logo_url, null);
  assert.equal(sanitizePatch(place, { requiredFields: ['area', 'password'] }).error, 'INVALID_REQUIRED_FIELDS');
  assert.deepEqual(sanitizePatch(place, { requiredFields: ['area', 'area', 'bathrooms'] }).patch.required_fields, ['area', 'bathrooms']);
  assert.equal(sanitizePatch(place, { maxPhotos: 0 }).error, 'INVALID_MAX_PHOTOS');
  assert.equal(sanitizePatch(place, { enabled: 'no' }).error, 'INVALID_ENABLED');
  assert.equal(sanitizePatch(place, { domains: ['evil.test'] }).error, 'NOTHING_TO_UPDATE', 'domains are facts, not settings');
});

test('an unconfirmed create URL falls back to the portal home page and says so', () => {
  const c = configFor(profileById('homege'));
  assert.equal(c.createUrl, 'https://www.home.ge');
  assert.equal(c.createUrlVerified, false);
  assert.equal(configFor(profileById('myhome')).createUrlVerified, true);
});

test('robots.txt: agent groups, longest match, Allow wins ties, wildcards and anchors', () => {
  const txt = 'User-agent: *\nDisallow: /index.php\nDisallow: /private/\nAllow: /private/ok\n\nUser-agent: BadBot\nDisallow: /\n';
  assert.equal(robotsAllows(txt, '/binebis-kidva-gakidva-2345678-10.html'), true);
  assert.equal(robotsAllows(txt, '/index.php?search=1'), false);
  assert.equal(robotsAllows(txt, '/private/x'), false);
  assert.equal(robotsAllows(txt, '/private/ok/1'), true);
  assert.equal(robotsAllows(txt, '/anything', 'BadBot/1.0'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /*.pdf$\n', '/a.pdf'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /*.pdf$\n', '/a.pdf?x'), true);
  assert.equal(robotsAllows('', '/x'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow:\n', '/x'), true, 'an empty Disallow allows everything');
});
