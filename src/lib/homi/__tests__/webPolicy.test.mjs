// THE OWNER'S BUG: "I asked 'find me an apartment' and it went to the internet
// instead of choosing our services." The decision now lives in code; these
// tests pin it. Web is OFF unless live data is genuinely needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideTurnPolicy, detectService, servicesNamedIn, turnPolicyPrompt } from '../webPolicy.ts';

const p = (text, opts) => decideTurnPolicy(text, opts);

test('property searches route to Find Property with the web OFF, in all six languages', () => {
  const cases = [
    'find me an apartment',
    'Find me a 2 bedroom apartment in Vake under $120,000',
    "I'm looking for a flat in Batumi",
    'I want to rent a house near the sea',
    'show me apartments in Saburtalo',
    'მომიძებნე ბინა ვაკეში',
    'ოროთახიანი ბინა მინდა საბურთალოზე 100 000 დოლარამდე',
    'ქირით ბინას ვეძებ ბათუმში',
    'найди мне квартиру в Тбилиси',
    'хочу снять квартиру в Батуми',
    'Tiflis’te daire arıyorum',
    'أبحث عن شقة في تبليسي',
    'אני מחפש דירה בטביליסי',
  ];
  for (const text of cases) {
    const r = p(text);
    assert.equal(r.web, 'OFF', text);
    assert.equal(r.service, 'FIND_PROPERTY', text);
    assert.equal(r.reason, 'PROPERTY_SEARCH', text);
  }
});

test('a property search beats a live-data cue: prices today is still Find Property', () => {
  const r = p('find me a flat in Vake, what are prices today?');
  assert.deepEqual([r.web, r.service], ['OFF', 'FIND_PROPERTY']);
});

test('owners looking for buyers or tenants route to Find buyers or tenants, web OFF', () => {
  for (const text of ['I want to sell my apartment', 'how do I find tenants for my flat', 'მინდა ბინა გავაქირავო', 'მყიდველი მინდა ვიპოვო', 'хочу продать квартиру', 'evimi satmak istiyorum', 'רוצה למכור את הדירה']) {
    const r = p(text);
    assert.equal(r.web, 'OFF', text);
    assert.equal(r.service, 'FIND_BUYERS_TENANTS', text);
  }
});

test('the web opens only for live data: exchange rate, current law or tax, news, company checks', () => {
  for (const [text, reason] of [
    ['what is the dollar to lari exchange rate today', 'LIVE_DATA'],
    ['ლარის კურსი რამდენია?', 'LIVE_DATA'],
    ['какой сейчас курс доллара', 'LIVE_DATA'],
    ['any news about Georgian real estate this week', 'LIVE_DATA'],
    ['what property tax do foreigners pay in Georgia', 'LEGAL_OR_TAX'],
    ['what does the law say about foreigners buying agricultural land', 'LEGAL_OR_TAX'],
    ['is the developer Archi reliable', 'COMPANY_CHECK'],
    ['შპს ახალი ქალაქი სანდოა?', 'COMPANY_CHECK'],
  ]) {
    const r = p(text);
    assert.equal(r.web, 'ON', text);
    assert.equal(r.reason, reason, text);
  }
});

test('an explicit request to check online, or a pasted link, is honoured', () => {
  assert.equal(p('search the web for flats in Vake').reason, 'EXPLICIT_WEB');
  assert.equal(p('what is on https://example.com/listing/1').web, 'ON');
  assert.equal(p('ინტერნეტში გადაამოწმე').web, 'ON');
});

test('everything else stays internal: stable knowledge and HOMATCH products, no web', () => {
  for (const text of [
    'Is Vake or Saburtalo better for a family with two kids?',
    'how does a mortgage work in Georgia',
    'what should I check before buying an apartment',
    'how much is my flat worth',
    'is this apartment a good deal',
    'what is a cadastral code',
    'გამარჯობა, როგორ ხარ?',
  ]) {
    assert.equal(p(text).web, 'OFF', text);
  }
});

test('"this flat", "my flat" and "home loan" are not property searches', () => {
  assert.notEqual(detectService('I want to know if this apartment is overpriced'), 'FIND_PROPERTY');
  assert.notEqual(detectService('how much is my flat worth'), 'FIND_PROPERTY');
  assert.equal(detectService('I need a home loan'), 'MORTGAGE');
});

test('services a question is about are detected for the card', () => {
  assert.equal(detectService('can you check the owner of this property'), 'VERIFY');
  assert.equal(detectService('what does clause 5 of my contract mean'), 'CONTRACT_INTELLIGENCE');
  assert.equal(detectService('რა ღირს იპოთეკა თვეში'), 'MORTGAGE');
  assert.equal(detectService('what rental yield can I expect'), 'INVESTMENT');
  assert.equal(detectService('I am moving to Georgia next year'), 'FOR_EXPATS');
  assert.equal(detectService('hello'), null);
});

test('product names in a reply become cards; plain words do not', () => {
  assert.deepEqual(servicesNamedIn('You can run Verify on it before signing.'), ['VERIFY']);
  assert.deepEqual(servicesNamedIn('HOMATCH-ის ქონების მოძებნა ზუსტად ამას აკეთებს'), ['FIND_PROPERTY']);
  assert.deepEqual(servicesNamedIn('Read the contract carefully.'), []);
});

test('the paid property analysis keeps its own web rules', () => {
  assert.deepEqual(p('find me a cheaper flat', { marketplace: true }), { web: 'ON', reason: 'PROPERTY_ANALYSIS', service: null });
});

test('the prompt states the policy, and a property search forbids portals and invented listings', () => {
  const off = turnPolicyPrompt(p('find me an apartment'));
  assert.match(off, /WEB THIS TURN: OFF/);
  assert.match(off, /never recommend other portals/);
  assert.match(off, /Include FIND_PROPERTY in suggested_actions/);
  assert.match(turnPolicyPrompt(p('lari exchange rate today')), /WEB THIS TURN: AVAILABLE/);
  assert.match(turnPolicyPrompt(p('I want to sell my flat')), /Never call anybody a confirmed buyer/);
});
