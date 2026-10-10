// FIND BUYERS — the demand classifier in six languages, beyond the VILLION
// baseline: buy vs rent, seeker vs advertiser, job/service/irrelevant, money
// parsing, comments in context, and the model bound.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDemand, classifyComment, boundModelReading, moneyMentions } from '../findBuyers/demandClassifier.ts';
import { qualify } from '../findBuyers/qualify.ts';
import { buildPropertyDna } from '../findBuyers/propertyDna.ts';
import { canonicalSourceUrl, requalifyLeads } from '../findBuyers/requalify.ts';

const CASES = [
  /* buyers */
  ['en', 'Looking to buy a 3-bedroom apartment in Vake, budget up to $250,000', 'BUY_SEEKER', 'BUY'],
  ['en', 'We want to buy a flat in Tbilisi, ready to pay cash around 200k $', 'BUY_SEEKER', 'BUY'],
  ['ru', 'Куплю трёхкомнатную квартиру в Ваке или Сабуртало, бюджет до 230 000$', 'BUY_SEEKER', 'BUY'],
  ['ru', 'Ищу квартиру для покупки в Крцаниси, рассматриваю ипотеку', 'BUY_SEEKER', 'BUY'],
  ['ka', 'ვიყიდი 2 საძინებლიან ბინას კრწანისში, ბიუჯეტი 220 000$', 'BUY_SEEKER', 'BUY'],
  ['ka', 'ვეძებ ბინას საყიდლად ორთაჭალაში', 'BUY_SEEKER', 'BUY'],
  ['tr', 'Tiflis Vake bölgesinde satın almak için 3+1 daire arıyorum, bütçe 200 bin $', 'BUY_SEEKER', 'BUY'],
  ['ar', 'أبحث عن شقة للشراء في تبليسي بميزانية 200 ألف دولار', 'BUY_SEEKER', 'BUY'],
  ['he', 'מחפש דירה לקנות בטביליסי, תקציב עד 250,000$', 'BUY_SEEKER', 'BUY'],
  /* renters */
  ['en', 'Looking for a 1 bedroom flat in Saburtalo, $600 per month, long term', 'RENT_SEEKER', 'RENT'],
  ['ru', 'Сниму квартиру в Ваке на длительный срок до 700$', 'RENT_SEEKER', 'RENT'],
  ['ka', 'ვეძებ ბინას ქირით ვაკეში, 500$ თვეში', 'RENT_SEEKER', 'RENT'],
  ['tr', 'Batum\'da kiralık daire arıyorum, aylık 500 dolar', 'RENT_SEEKER', 'RENT'],
  ['ar', 'أبحث عن شقة للإيجار في تبليسي شهري 600 دولار', 'RENT_SEEKER', 'RENT'],
  ['he', 'מחפשת דירה לשכור בטביליסי לחודש', 'RENT_SEEKER', 'RENT'],
  /* advertisers */
  ['en', 'Apartment for sale in Vake, 120 m², 3 bedrooms, price $310,000', 'SALE_OFFER', 'BUY'],
  ['ru', 'Продается 3-комнатная квартира в Сабуртало, 95 м², 180 000$', 'SALE_OFFER', 'BUY'],
  ['ka', 'იყიდება 3 ოთახიანი ბინა კრწანისში, 97 კვ.მ, 214 000$', 'SALE_OFFER', 'BUY'],
  ['tr', 'Tiflis\'te satılık 2+1 daire, 85 m2, 150.000 $', 'SALE_OFFER', 'BUY'],
  ['ar', 'شقة للبيع في باتومي 70 متر مربع 90000 دولار', 'SALE_OFFER', 'BUY'],
  ['he', 'דירה למכירה בבטומי, 3 חדרים, 160,000$', 'SALE_OFFER', 'BUY'],
  ['en', 'For rent: 2-bedroom flat in Vera, $900/month', 'RENT_OFFER', 'RENT'],
  ['ru', 'Сдаётся квартира в Ваке, 2 спальни, 800$ в месяц', 'RENT_OFFER', 'RENT'],
  ['ka', 'ქირავდება ბინა საბურთალოზე, 2 ოთახიანი, 600$', 'RENT_OFFER', 'RENT'],
  /* not property demand */
  ['en', 'Looking for a job as a waiter in Tbilisi', 'JOB', null],
  ['ka', 'ვეძებ სამუშაოს თბილისში, მაქვს გამოცდილება', 'JOB', null],
  ['tr', 'Tiflis\'te iş arıyorum, garsonluk deneyimim var', 'JOB', null],
  ['ar', 'أبحث عن وظيفة في تبليسي', 'JOB', null],
  ['he', 'מחפשת עבודה בטביליסי', 'JOB', null],
  ['en', 'We offer apartment renovation and repair, call us', 'SERVICE', null],
  ['ru', 'Ищу попутчика до Батуми', 'IRRELEVANT', null],
  ['ka', 'ვეძებ კარგ სტომატოლოგს ვაკეში', 'IRRELEVANT', null],
  ['en', 'Looking for recommendations for a good restaurant', 'IRRELEVANT', null],
  ['en', 'I am a realtor, I have many apartments in Vake, message me', 'SALE_OFFER', 'BUY', ['SALE_OFFER', 'AGENT', 'UNCLEAR']],
];

for (const [lang, text, role, tx, allowed] of CASES) {
  test(`${lang}: ${text.slice(0, 60)} → ${role}`, () => {
    const r = classifyDemand(text);
    const ok = allowed ?? [role];
    assert.ok(ok.includes(r.role), `got ${r.role} [${r.evidence}]`);
    if (tx && !allowed) assert.equal(r.transaction, tx, `transaction [${r.evidence}]`);
  });
}

test('a seeker verb alone is never real-estate demand', () => {
  for (const t of ['ищу', 'looking for', 'ვეძებ', 'arıyorum', 'أبحث', 'מחפש', 'ищу нянечку для сына', 'ვეძებ ძიძას']) {
    const r = classifyDemand(t);
    assert.ok(!['BUY_SEEKER', 'RENT_SEEKER'].includes(r.role), `${t} → ${r.role}`);
  }
});

test('money: ranges, thousands separators, k-suffix; a phone number on the next line is not a budget', () => {
  assert.deepEqual(moneyMentions('бюджет 50 000-70 000$').map((m) => m.amount), [50000, 70000]);
  assert.deepEqual(moneyMentions('Price: $154900').map((m) => m.amount), [154900]);
  assert.deepEqual(moneyMentions('budget 200k $').map((m) => m.amount), [200000]);
  assert.deepEqual(moneyMentions('до 500$\n\n511251200,ватсап').map((m) => m.amount), [500]);
  assert.deepEqual(moneyMentions('600ლ მხოლოდ').map((m) => [m.amount, m.currency]), [[600, 'GEL']]);
});

test('a down payment is not a budget', () => {
  const r = classifyDemand('Куплю квартиру в Тбилиси, первоначальный взнос 20 000$');
  assert.equal(r.role, 'BUY_SEEKER');
  assert.equal(r.budget, null);
  assert.equal(r.downPayment.amount, 20000);
});

const dna = buildPropertyDna({ transactionType: 'SALE', propertyType: 'APARTMENT', countryCode: 'GE', city: 'Tbilisi', district: 'Krtsanisi', totalPrice: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2 });

test('Strong needs a confirmed budget AND a compatible place; unknowns cap at Potential', () => {
  const strong = qualify(classifyDemand('ვიყიდი 2 საძინებლიან ბინას ორთაჭალაში, ბიუჯეტი 220 000$'), dna, { ageDays: 1 });
  assert.equal(strong.category, 'STRONG', JSON.stringify(strong));
  assert.equal(strong.locationFit, 'COMPATIBLE'); /* Ortachala is in Krtsanisi */
  const noBudget = qualify(classifyDemand('Куплю квартиру в Крцаниси'), dna, { ageDays: 1 });
  assert.equal(noBudget.category, 'POTENTIAL');
  assert.equal(noBudget.budgetFit, 'UNKNOWN');
  const nearby = qualify(classifyDemand('Looking to buy a 2 bedroom apartment in Sololaki, budget $210,000'), dna, { ageDays: 2 });
  assert.equal(nearby.locationFit, 'NEARBY');
  assert.equal(nearby.category, 'STRONG');
  const otherCity = qualify(classifyDemand('Куплю квартиру в Батуми до 220 000$'), dna, { ageDays: 2 });
  assert.equal(otherCity.category, 'REJECTED');
  assert.ok(otherCity.reasons.includes('OTHER_CITY'));
  const stale = qualify(classifyDemand('Куплю квартиру в Крцаниси до 220 000$'), dna, { ageDays: 45 });
  assert.equal(stale.category, 'REJECTED');
  assert.ok(stale.reasons.includes('STALE'));
});

test('rental campaigns want tenants: a buyer is the wrong transaction there', () => {
  const rentDna = buildPropertyDna({ transactionType: 'RENT', propertyType: 'APARTMENT', city: 'Tbilisi', district: 'Vake', totalPrice: 900, currency: 'USD', bedrooms: 2 });
  const tenant = qualify(classifyDemand('Сниму 2-комнатную квартиру в Ваке до 1000$'), rentDna, { ageDays: 1 });
  assert.notEqual(tenant.category, 'REJECTED');
  const buyer = qualify(classifyDemand('Куплю квартиру в Ваке до 300 000$'), rentDna, { ageDays: 1 });
  assert.ok(buyer.reasons.includes('WRONG_TRANSACTION'));
});

test('comments in context: interest under a comparable sale listing is a buyer; bare "PM" is not', () => {
  const parent = { role: 'SALE_OFFER', similarity: 82 };
  assert.equal(classifyComment('Is it still available? What is the price for the 3-room one?', parent).role, 'BUY_SEEKER');
  assert.equal(classifyComment('ფასი? აქტუალურია?', parent).role, 'BUY_SEEKER');
  for (const bare of ['PM', '+', 'interested', 'ინტერესი']) assert.ok(!['BUY_SEEKER', 'RENT_SEEKER'].includes(classifyComment(bare, parent).role), bare);
  /* Under someone's request, "call me" is a seller replying. */
  assert.equal(classifyComment('call me, I have one', { role: 'BUY_SEEKER', similarity: 60 }).role, 'SALE_OFFER');
});

test('the model resolves UNCLEAR only, cannot overturn job/offer evidence, and cannot invent a budget', () => {
  const job = classifyDemand('Ищу работу в Тбилиси');
  assert.equal(boundModelReading(job, { role: 'BUY_SEEKER', transaction: 'BUY' }).role, 'JOB');
  const unclear = classifyDemand('ვეძებ ბინას თბილისში');
  assert.equal(unclear.role, 'UNCLEAR');
  const resolved = boundModelReading(unclear, { role: 'BUY_SEEKER', transaction: 'BUY' });
  assert.equal(resolved.role, 'BUY_SEEKER');
  assert.equal(resolved.budget, null);
  /* A $500 budget is a rent whatever the model says. */
  const cheap = classifyDemand('ვეძებ ბინას თბილისში, 500$');
  assert.equal(boundModelReading({ ...cheap, role: 'UNCLEAR', needsModel: true }, { role: 'BUY_SEEKER', transaction: 'BUY' }).role, 'RENT_SEEKER');
});

test('canonical URLs fold FB permalink forms, hosts and tracking parameters', () => {
  assert.equal(canonicalSourceUrl('https://m.facebook.com/groups/123/posts/456/?mibextid=x'), canonicalSourceUrl('https://www.facebook.com/groups/123/permalink/456/'));
  const rows = requalifyLeads([
    { id: 'a', text: 'Куплю квартиру в Крцаниси', publishedAt: '2026-10-08T10:00:00Z', url: 'https://www.facebook.com/groups/1/permalink/9/' },
    { id: 'b', text: 'Куплю квартиру в Крцаниси!', publishedAt: '2026-10-08T11:00:00Z', url: 'https://m.facebook.com/groups/1/posts/9?ref=share' },
  ], dna, { now: Date.parse('2026-10-09T00:00:00Z') });
  assert.equal(rows[1].duplicateOf, 'a');
  assert.ok(rows[1].qualification.reasons.includes('DUPLICATE'));
});
