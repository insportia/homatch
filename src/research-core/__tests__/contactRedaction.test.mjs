// PHASE 2 hardening (D3) — a community post's contacts never reach the text a
// Find Property customer sees, and the property facts all survive.
import test from 'node:test';
import assert from 'node:assert/strict';

import { CONTACT_MASK, redactContacts } from '../discovery/contact-redaction.ts';

const LEAKS = [
  /\d{3}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{2}/, // 555 12 34 56 / 599123456
  /\+\s*\d/,
  /@[A-Za-z]/,
  /t\.me|wa\.me|whatsapp\.com|viber:\/\//i,
];
const noLeak = (text) => LEAKS.forEach((pattern) => assert.doesNotMatch(text, pattern, `leaked ${pattern} in: ${text}`));

test('Georgian listing: the phone goes, rooms, area, floor, district, price stay', () => {
  const post = 'ქირავდება 2 ოთახიანი ბინა ვაკეში, ჭავჭავაძის 45, 65 მ², მე-5 სართული, 700$ ტელ: 599 12 34 56';
  const { text, removed } = redactContacts(post);
  noLeak(text);
  assert.equal(removed.phone, 1);
  for (const kept of ['2 ოთახიანი', 'ვაკეში', 'ჭავჭავაძის 45', '65 მ²', 'მე-5 სართული', '700$']) assert.ok(text.includes(kept), kept);
  assert.ok(text.endsWith(`ტელ: ${CONTACT_MASK}`));
});

test('Georgian: a bare mobile right after a price, and a Tbilisi landline with a call word', () => {
  const a = redactContacts('იყიდება ბინა საბურთალოზე 85 მ2 ფასი 120 000 $ 599123456');
  noLeak(a.text);
  assert.ok(a.text.includes('120 000 $') && a.text.includes('85 მ2'));
  const b = redactContacts('ქირავდება ბინა, დარეკეთ 032 2 12 34 56');
  assert.equal(b.removed.phone, 1);
  assert.ok(!/12 34 56/.test(b.text));
});

test('Russian-style listing: +995 / 8 (999) phones, @handle, WhatsApp link, Viber number', () => {
  const post = 'Сдается квартира в Батуми, ул. Руставели 12, 45 м2, 3/9 этаж, 500$/мес. '
    + 'Звоните +995 (555) 12-34-56, @batumi_rent, WhatsApp: wa.me/995555123456. '
    + 'Продаю 1-комн., 38 м², цена 52000 USD, тел. 8 (999) 123-45-67, Viber 555 777 888';
  const { text, removed } = redactContacts(post);
  noLeak(text);
  assert.deepEqual(removed, { phone: 3, handle: 1, link: 1, email: 0 });
  for (const kept of ['Руставели 12', '45 м2', '3/9 этаж', '500$/мес', '38 м²', '52000 USD']) assert.ok(text.includes(kept), kept);
});

test('English listing: handle, t.me link and e-mail go; listing id, cadastral code, price, sqm stay', () => {
  const post = 'For sale: 3-room flat, 92 sqm, 9/12 floor, Chavchavadze ave 45, Vake. ID 36733497, '
    + 'cadastral 01.14.12.004.017, $185,000. Contact @VakeHomes or t.me/vakehomes, agent@example.ge';
  const { text, removed } = redactContacts(post);
  noLeak(text);
  assert.doesNotMatch(text, /example\.ge/);
  assert.deepEqual(removed, { phone: 0, handle: 1, link: 1, email: 1 });
  for (const kept of ['3-room', '92 sqm', '9/12 floor', 'Chavchavadze ave 45', 'Vake', 'ID 36733497', '01.14.12.004.017', '$185,000']) {
    assert.ok(text.includes(kept), kept);
  }
});

test('nothing to redact: prices, areas and identifiers are left exactly as written', () => {
  for (const post of [
    'Tbilisi, Saburtalo, 1 500 000 GEL, 3 rooms, 2/9',
    'იყიდება 120 მ² კერძო სახლი, ფასი 250000 ლარი, ID: 123456789',
    'Квартира 75 м², 4 этаж из 12, цена 95 000 $',
  ]) {
    const { text, removed } = redactContacts(post);
    assert.equal(text, post);
    assert.deepEqual(removed, { phone: 0, handle: 0, link: 0, email: 0 });
  }
});

test('deterministic and idempotent: redacting twice changes nothing more', () => {
  const once = redactContacts('ბინა ვაკეში 80 მ², 90000$, 555 77 78 88 @owner_ge').text;
  assert.equal(redactContacts(once).text, once);
  assert.equal(redactContacts(null).text, '');
});
