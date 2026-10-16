// FIND BUYERS — intent precision on the VILLION baseline, per campaign side
// (2026-10-16). The 37 leads the first production campaign (2026-10-09, a SALE)
// showed as qualified, each with a manual class. A SALE campaign keeps only
// genuine buyers; the same texts in a RENT campaign keep only genuine tenants;
// job posts, listings, brokers, commercial space and the repost never pass.
// Then a multilingual battery of generic "looking for" phrasings that are not
// home seekers, and genuine buyers/tenants that must not be lost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPropertyDna } from '../findBuyers/propertyDna.ts';
import { requalifyLeads } from '../findBuyers/requalify.ts';
import { classifyDemand } from '../findBuyers/demandClassifier.ts';
import { extractTextFacts } from '../findBuyers/textFacts.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/villionCampaignLeads.json', import.meta.url), 'utf8'));
const now = Date.parse(fixture.campaign.evaluatedAt);
const leads = fixture.leads.map((l) => ({ id: String(l.n), text: l.text, publishedAt: l.at, url: l.url, author: l.author ?? null }));

/* Manual class of every lead (fixture number). */
const CLASS = {
  BUYER: [6, 7, 11, 12], TENANT: [2, 4, 5, 9, 10, 23, 24, 25], BROKER: [8, 26], DUPLICATE: [13],
  JOB: [14, 15, 16, 17, 18, 19, 20, 21, 28, 29, 30, 31, 33, 36], SUPPLY: [1, 3, 22, 27, 32, 34, 35], COMMERCIAL: [37],
};
const classOf = (n) => Object.keys(CLASS).find((k) => CLASS[k].includes(n));

test('every one of the 37 leads has exactly one manual class', () => {
  const all = Object.values(CLASS).flat().sort((a, b) => a - b);
  assert.deepEqual(all, fixture.leads.map((l) => l.n).sort((a, b) => a - b));
});

function shown(transaction, extra = {}) {
  const dna = buildPropertyDna({ ...fixture.property, transactionType: transaction, ...extra });
  return requalifyLeads(leads, dna, { now }).map((r) => ({ n: Number(r.id), r }));
}

test('SALE campaign: only genuine buyers are shown — no tenant, job, listing, broker, commercial or repost', () => {
  const rows = shown('SALE');
  const kept = rows.filter((x) => x.r.qualification.category !== 'REJECTED');
  assert.ok(kept.length > 0);
  for (const { n, r } of kept) assert.equal(classOf(n), 'BUYER', `lead ${n} shown as ${r.reading.role}`);
  for (const n of CLASS.TENANT) assert.ok(rows.find((x) => x.n === n).r.qualification.reasons.includes('WRONG_TRANSACTION'), `tenant ${n}`);
  for (const n of CLASS.JOB) assert.ok(rows.find((x) => x.n === n).r.qualification.reasons.includes('JOB_SEARCH'), `job ${n}`);
});

test('RENT campaign with the same texts: only genuine tenants are shown; buyers are the wrong transaction', () => {
  const rows = shown('RENT', { totalPrice: 600 });
  const kept = rows.filter((x) => x.r.qualification.category !== 'REJECTED');
  assert.ok(kept.length > 0);
  for (const { n, r } of kept) assert.equal(classOf(n), 'TENANT', `lead ${n} shown as ${r.reading.role}`);
  for (const n of CLASS.BUYER) assert.ok(rows.find((x) => x.n === n).r.qualification.reasons.includes('WRONG_TRANSACTION'), `buyer ${n}`);
  /* "ვიქირავებ სალონში კაბინეტს" — a room in a beauty salon, not a home. */
  assert.ok(rows.find((x) => x.n === 37).r.qualification.reasons.includes('NON_RESIDENTIAL'));
});

test('ბინა only at a word start: კაბინეტი (office room) is commercial, not an apartment', () => {
  const r = classifyDemand('ვიქირავებ სალონში კაბინეტს ლოკაციას განვიხილავ ნებისმიერ ადგილას', { kind: 'POST' });
  assert.equal(r.propertyType, 'COMMERCIAL');
  assert.equal(r.residential, false);
  assert.equal(extractTextFacts('ქირავდება კაბინეტი ვაკეში').propertyType === 'APARTMENT', false);
  /* Every inflection of ბინა still counts. */
  for (const t of ['ვეძებ ბინას ქირით ვაკეში', 'ვიყიდი 3 ოთახიან ბინას', 'ბინის ყიდვა მინდა კრწანისში']) {
    assert.equal(classifyDemand(t, { kind: 'POST' }).residential, true, t);
  }
  assert.equal(extractTextFacts('იყიდება ბინა კრწანისში').propertyType, 'APARTMENT');
});

/* [text, acceptable roles] — generic "looking for" that is not a home seeker never becomes one. */
const NOT_HOME_SEEKERS = [
  ['Ищу работу в Тбилиси, опыт продаж', ['JOB']], ['ищу няню для ребенка в Ваке', ['JOB', 'IRRELEVANT']],
  ['Ищу мастера по ремонту ванной', ['SERVICE']], ['ищу попутчиков в Батуми', ['IRRELEVANT']], ['Ищу друзей в Тбилиси', ['IRRELEVANT']],
  ['Куплю машину Toyota Prius', ['IRRELEVANT']], ['ვეძებ სამსახურს თბილისში', ['JOB']], ['ვეძებ ძიძას ბავშვისთვის', ['JOB']], ['ვიყიდი მანქანას', ['IRRELEVANT']],
  ['looking for a job in Tbilisi', ['JOB']], ['Looking for a cleaner for my apartment', ['SERVICE']], ['looking for a car to buy', ['IRRELEVANT']],
  ["Tiflis'te iş arıyorum", ['JOB']], ['أبحث عن عمل في تبليسي', ['JOB']], ['מחפש עבודה בטביליסי', ['JOB']],
  ['Apartment for sale in Vake, looking for a serious buyer, 150000$', ['SALE_OFFER']], ['Продаю квартиру, ищу покупателя', ['SALE_OFFER']],
];
const BUYERS = [
  'Куплю 3-комнатную квартиру в Крцаниси до 220000$', 'ვიყიდი 3 ოთახიან ბინას კრწანისში', 'Looking to buy a 3 bedroom apartment in Tbilisi',
  "Tiflis'te satılık daire arıyorum", "Tiflis'te satılık 3+1 daire arıyoruz", 'أبحث عن شقة للشراء في تبليسي', 'מחפש לקנות דירה בטביליסי',
  'I am looking for an apartment for sale in Tbilisi, 3 rooms', 'Ищу квартиру на продажу в Крцаниси',
];
const TENANTS = [
  'Сниму квартиру в Ваке на длительный срок', 'ვიქირავებ ბინას ვაკეში გრძელვადიანად', 'Looking to rent a flat in Vake',
  "Tiflis'te kiralık daire arıyorum", 'أبحث عن شقة للإيجار في تبليسي', 'מחפש דירה להשכרה בטביליסי', 'ვეძებ ბინას სამსახურთან ახლოს ქირით',
];

for (const [t, ok] of NOT_HOME_SEEKERS) {
  test(`not a home seeker: ${t}`, () => {
    const r = classifyDemand(t, { kind: 'POST' });
    assert.ok(ok.includes(r.role), `${r.role} [${r.evidence}]`);
  });
}
for (const t of BUYERS) test(`buyer, in any language: ${t}`, () => assert.equal(classifyDemand(t, { kind: 'POST' }).role, 'BUY_SEEKER'));
for (const t of TENANTS) test(`tenant, in any language: ${t}`, () => assert.equal(classifyDemand(t, { kind: 'POST' }).role, 'RENT_SEEKER'));
