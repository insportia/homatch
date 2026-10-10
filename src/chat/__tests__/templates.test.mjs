// PROPERTY CONVERSATIONS — the approved templates never invent a fact.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_LANGS, CHAT_TEMPLATE_STRINGS, chatLang, chatString, fillOfferTemplate, fillTemplate,
  offerFeatures, offerLocation, offerPrice,
} from '../templates.ts';
import { PROPERTY_CHAT_STRINGS } from '../../../scripts/property-chat-i18n-data.mjs';

const FULL = { city: 'Tbilisi', district: 'Krtsanisi', bedrooms: 2, area: 85, price: 185000, currency: 'USD' };

test('all three facts present: the approved English sentence, verbatim', () => {
  assert.equal(
    fillOfferTemplate(FULL, 'en'),
    'Hello! I believe this property may be relevant to your search. It is located in Krtsanisi, Tbilisi, offers 2 bedrooms, 85 m², and is listed at $185,000. If you\'d like, I can share more photos and answer any questions.',
  );
});

test('a missing fact removes its clause and nothing replaces it', () => {
  const noPrice = fillOfferTemplate({ ...FULL, price: null }, 'en');
  assert.doesNotMatch(noPrice, /listed at|\$/);
  assert.match(noPrice, /It is located in Krtsanisi, Tbilisi\. It offers 2 bedrooms, 85 m²\./);

  const onlyCity = fillOfferTemplate({ city: 'Tbilisi' }, 'en');
  assert.equal(onlyCity, 'Hello! I believe this property may be relevant to your search. It is located in Tbilisi. If you\'d like, I can share more photos and answer any questions.');

  const nothing = fillOfferTemplate({}, 'en');
  assert.doesNotMatch(nothing, /\d|located|offers|listed/, 'no facts → no factual clause at all');
});

test('no number appears that the facts did not contain', () => {
  for (const lang of CHAT_LANGS) {
    const text = fillOfferTemplate({ district: 'Vake', area: 120 }, lang);
    const digits = (text.match(/[0-9٠-٩]+/g) ?? []).join(',');
    assert.ok(/120|١٢٠/.test(text), `${lang}: area kept`);
    assert.ok(!/185|2 bed/.test(text), `${lang}: nothing invented (${digits})`);
    assert.doesNotMatch(text, /\{\{/, `${lang}: no unfilled hole`);
  }
});

test('a price without a valid currency is not quoted; zero or negative facts are absent', () => {
  assert.equal(offerPrice({ price: 100000, currency: null }, 'en'), null);
  assert.equal(offerPrice({ price: 100000, currency: 'dollars' }, 'en'), null);
  assert.equal(offerPrice({ price: 0, currency: 'USD' }, 'en'), null);
  assert.equal(offerFeatures({ bedrooms: 0, area: -3 }, 'en'), null);
  assert.equal(offerFeatures({ bedrooms: 1 }, 'en'), '1 bedroom');
  assert.equal(offerFeatures({ bedrooms: 2.5 }, 'en'), null, 'a fractional bedroom count is not a fact we can state');
  assert.equal(offerLocation({ city: 'Tbilisi', district: 'tbilisi' }), 'tbilisi');
  assert.equal(offerLocation({}), null);
});

test('the other modes are the approved copy, in every language', () => {
  assert.equal(fillTemplate('introduction', 'en'), "Hello! I noticed that your property requirements may align with a listing I have available. I'd be happy to share the details, photos and pricing if you're interested.");
  assert.equal(fillTemplate('follow_up', 'en'), "Hello again! I wanted to follow up on the property I shared earlier. Please let me know if you'd like any additional details or if you'd prefer to arrange a viewing.");
  assert.equal(fillTemplate('viewing', 'en'), "If this property interests you, I'd be happy to discuss a convenient time for a viewing.");
  assert.notEqual(fillTemplate('introduction', 'ka'), fillTemplate('introduction', 'en'));
  assert.equal(chatLang('xx'), 'en');
  assert.equal(chatLang('ka-GE'), 'ka');
});

test('the edge table and the UI bundle carry identical words', () => {
  for (const [key, row] of Object.entries(CHAT_TEMPLATE_STRINGS)) {
    assert.deepEqual(PROPERTY_CHAT_STRINGS[key], [...row], `${key} differs between src/chat/templates.ts and the i18n data`);
  }
});

test('Georgian copy uses the approved vocabulary', () => {
  const ka = Object.values(PROPERTY_CHAT_STRINGS).map((r) => r[1]).join('\n');
  assert.doesNotMatch(ka, /შესატყვისი/);
  assert.doesNotMatch(Object.values(PROPERTY_CHAT_STRINGS).map((r) => r[0]).join('\n'), /confirmed buyer/i);
});

test('the notification body never carries a placeholder for message text', () => {
  for (const lang of CHAT_LANGS) {
    assert.doesNotMatch(chatString('pc_notif_offer_body', lang), /\{\{/);
  }
});
