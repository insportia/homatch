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
import { qualify } from '../findBuyers/qualify.ts';
import { financingBadges } from '../../findBuyers/campaignReport.ts';

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

/* ── buyer intent ≠ property match ─────────────────────────────────────────
   100% buyer-intent precision is not 100% match precision: neither genuine
   buyer kept for this property is a Strong match, each for stated reasons. */
const keptOf = (rows) => rows.filter((x) => x.r.qualification.category !== 'REJECTED')
  .map((x) => ({ n: x.n, category: x.r.qualification.category })).sort((a, b) => a.n - b.n);

test('SALE: exactly leads 6 (WEAK) and 12 (POTENTIAL, financing to confirm) are kept — none Strong', () => {
  const rows = shown('SALE');
  assert.deepEqual(keptOf(rows), [{ n: 6, category: 'WEAK' }, { n: 12, category: 'POTENTIAL' }]);
  const q = (n) => rows.find((x) => x.n === n).r.qualification;
  /* 6: 3 rooms as the property, but only districts other than Krtsanisi; no budget. */
  assert.equal(q(6).requirementsFit, 'COMPATIBLE');
  assert.equal(q(6).locationFit, 'INCOMPATIBLE');
  assert.deepEqual(q(6).limitations, ['BUDGET_UNKNOWN', 'LOCATION_OTHER_AREA']);
  /* 12: pays the seller over time with 10,000 GEL down (~2% of $213,840); city only. The seller's
     agreement is not assumed refused: Potential, never Strong, both risks shown. */
  assert.equal(q(12).financingFit, 'STRETCH');
  assert.deepEqual(q(12).limitations, ['BUDGET_UNKNOWN', 'LOCATION_CITY_ONLY', 'ROOMS_UNKNOWN', 'FINANCING_SELLER_INSTALMENTS', 'DOWN_PAYMENT_LOW']);
  /* The other genuine buyers: a confirmed budget mismatch, and the repost. */
  assert.deepEqual(q(7).reasons, ['BUDGET_INCOMPATIBLE']);
  assert.deepEqual(q(11).reasons, ['BUDGET_INCOMPATIBLE']);
  assert.deepEqual(q(13).reasons, ['DUPLICATE']);
});

test('RENT (same texts, $600/month): exactly tenants 4, 10 and 25 are kept, with their limitations', () => {
  const rows = shown('RENT', { totalPrice: 600 });
  assert.deepEqual(keptOf(rows), [{ n: 4, category: 'POTENTIAL' }, { n: 10, category: 'WEAK' }, { n: 25, category: 'WEAK' }]);
});

const SALE_DNA = buildPropertyDna(fixture.property);
const q1 = (text) => { const r = classifyDemand(text, { kind: 'POST' }); return { r, q: qualify(r, SALE_DNA, { ageDays: 1 }) }; };

test('financing: unstated is unknown (no penalty); a mortgage with a real down payment can be Strong', () => {
  const plain = q1('Куплю 3-комнатную квартиру в Крцаниси, бюджет 215000$');
  assert.equal(plain.q.financingFit, 'UNKNOWN');
  assert.equal(plain.q.category, 'STRONG');
  const mortgage = q1('ვიყიდი 3 ოთახიან ბინას კრწანისში იპოთეკით, ბიუჯეტი 215000$, პირველადი შენატანი 45000$');
  assert.equal(mortgage.r.financing, 'MORTGAGE');
  assert.equal(mortgage.q.financingFit, 'COMPATIBLE');
  assert.equal(mortgage.q.category, 'STRONG');
  assert.deepEqual(mortgage.q.limitations, ['FINANCING_MORTGAGE']);
});

test('financing: a low down payment caps a confirmed budget+place buyer at Potential, never Strong', () => {
  const low = q1('Куплю 3-комнатную квартиру в Крцаниси в ипотеку, бюджет 215000$, первоначальный взнос 10000$');
  assert.equal(low.q.financingFit, 'STRETCH');
  assert.equal(low.q.category, 'POTENTIAL');
  assert.ok(low.q.limitations.includes('DOWN_PAYMENT_LOW'));
});

test('financing words are read in every language', () => {
  for (const t of ['ვიყიდი ბინას განვადებით', 'Куплю квартиру в рассрочку', 'Looking to buy an apartment in installments', "Taksitle daire almak istiyorum", 'أريد شراء شقة بالتقسيط', 'רוצה לקנות דירה בתשלומים']) {
    assert.equal(classifyDemand(t, { kind: 'POST' }).financing, 'INSTALMENTS', t);
  }
  for (const t of ['ვიყიდი ბინას იპოთეკით', 'Куплю квартиру в ипотеку', 'Looking to buy a flat with a mortgage', 'Konut kredisi ile daire almak istiyorum', 'أريد شراء شقة برهن عقاري', 'רוצה לקנות דירה עם משכנתא']) {
    assert.equal(classifyDemand(t, { kind: 'POST' }).financing, 'MORTGAGE', t);
  }
});

/* ── financing is a risk to show, not a verdict (2026-10-16 review) ─────── */
const STRONG_TEXT = 'Куплю 3-комнатную квартиру в Крцаниси, бюджет 215000$';
const qr = (text, ratio) => qualify(classifyDemand(text, { kind: 'POST' }), SALE_DNA, { ageDays: 1, ...(ratio == null ? {} : { lowDownPaymentRatio: ratio }) });

test('seller instalments are UNCONFIRMED, not refused: an otherwise Strong buyer is Potential, never Weak', () => {
  const base = qr(STRONG_TEXT);
  const inst = qr(`${STRONG_TEXT}, в рассрочку`);
  assert.equal(inst.financingFit, 'UNCONFIRMED');
  assert.equal(inst.category, 'POTENTIAL');
  assert.deepEqual(inst.limitations, ['FINANCING_SELLER_INSTALMENTS']);
  assert.ok(inst.score < base.score, `${inst.score} < ${base.score}`);
});

test('bank financing is not seller financing: a mortgage with a real down payment stays Strong at full score', () => {
  const base = qr(STRONG_TEXT);
  const m = qr(`${STRONG_TEXT}, ипотека, первоначальный взнос 50000$`);
  assert.equal(m.financingFit, 'COMPATIBLE');
  assert.equal(m.category, 'STRONG');
  assert.equal(m.score, base.score);
});

test('the down-payment ratio is a configurable heuristic: off at 0, stricter or looser by setting', () => {
  const text = `${STRONG_TEXT}, ипотека, первоначальный взнос 30000$`; // ~14% of $213,840
  assert.equal(qr(text).category, 'STRONG', 'default 10%: 14% is not low');
  assert.equal(qr(text, 0.2).category, 'POTENTIAL', '20%: 14% is low');
  assert.ok(qr(text, 0.2).limitations.includes('DOWN_PAYMENT_LOW'));
  assert.equal(qr(`${STRONG_TEXT}, ипотека, первоначальный взнос 10000$`, 0).category, 'STRONG', '0 turns the flag off');
});

test('score and category agree: a financing risk never raises the score or the category, and never alone makes a lead Weak', () => {
  const rank = { REJECTED: 0, WEAK: 1, POTENTIAL: 2, STRONG: 3 };
  const bases = [STRONG_TEXT, 'Куплю квартиру в Тбилиси', 'Куплю 3-комнатную квартиру в Ваке, бюджет 100000$'];
  for (const b of bases) {
    const base = qr(b);
    for (const add of [', в рассрочку', ', ипотека, первоначальный взнос 5000$', ', в рассрочку, первоначальный взнос 5000$']) {
      const q = qr(b + add);
      assert.ok(q.score <= base.score, `${b + add}: ${q.score} > ${base.score}`);
      assert.ok(rank[q.category] <= rank[base.category], `${b + add}: ${q.category} above ${base.category}`);
      if (base.category !== 'WEAK') assert.notEqual(q.category, 'WEAK', `${b + add}: financing alone made it Weak`);
      if (q.category === 'STRONG') assert.ok(!['UNCONFIRMED', 'STRETCH'].includes(q.financingFit));
    }
  }
});

test('the lead card shows each financing limitation as a badge, in a fixed order; nothing when not stated', () => {
  assert.deepEqual(financingBadges(['BUDGET_UNKNOWN', 'DOWN_PAYMENT_LOW', 'FINANCING_SELLER_INSTALMENTS']).map((b) => b.key),
    ['fbr_financing_instalments', 'fbr_financing_low_down']);
  assert.deepEqual(financingBadges(['FINANCING_MORTGAGE']).map((b) => b.key), ['fbr_financing_mortgage']);
  assert.deepEqual(financingBadges(null), []);
  assert.deepEqual(financingBadges(['BUDGET_UNKNOWN']), []);
});

/* ── live test 2026-10-16 (campaign 46dcaf3f, VILLION SALE): every stored lead, judged by
   hand against its original post, must land in its people-first class ───────────── */
test('live test 2026-10-16: sellers and agencies recruiting sellers are supply, never buyers', () => {
  const supply = [
    /* a seller's listing opening with a question to readers ("Ищете …?") */
    'Ищете жилье «для себя», а не типовой ремонт под сдачу? Продается эксклюзивная угловая квартира в элитном комплексе «Your Home on Lisi».',
    /* a broker offering to sell other people's homes */
    'თუ გაქვთ ბინა, სახლი ან კომერციული ფართი გასაყიდი ან გასაქირავებელი, სიამოვნებით დაგეხმარებით. პირადად მოვალ, გადავიღებ ფოტოებს და ვიპოვო რეალური მყიდველი ან დამქირავებელი.',
    /* an agency taking exclusive listings */
    '🏡 თქვენ გაქვთ გასაყიდი უძრავი ქონება? ჩვენ გვყავს გუნდი, რომელიც მის გაყიდვაზე იმუშავებს! 📌 ვიღებთ უძრავ ქონებას ექსკლუზიურ გაყიდვაში!',
    'Хотите продать квартиру? Поможем продать быстро, найдем покупателя.',
    'Do you have an apartment to sell? We will sell your property fast — exclusive listing, no stress.',
  ];
  for (const text of supply) {
    const r = classifyDemand(text);
    assert.ok(['SALE_OFFER', 'RENT_OFFER', 'AGENT'].includes(r.role), `${text.slice(0, 40)} → ${r.role}`);
    const q = qualify(r, SALE_DNA, { ageDays: 1, duplicate: false });
    assert.equal(q.category, 'REJECTED', text.slice(0, 40));
  }
});

test('live test 2026-10-16: real buyers stay buyers, including one who asks whoever sells', () => {
  for (const text of [
    'სალამი, მეგობრებო! ვეძებ ბინას იპოთეკით, 2 საძინებლით, რომლის შეძენასაც შევძლებ საბანკო დაფინანსებით.',
    'ბენდუქიძეში თუ ყიდით ვინმე ბინას მომწერეთ პირადში ან დამირეკეთ',
    'Кто продает 3-комнатную квартиру в Крцаниси? Напишите в личку.',
    /* a buyer asking sellers with no service promise is still a buyer */
    'თუ გაქვთ ბინა გასაყიდი კრწანისში, მომწერეთ',
  ]) {
    const r = classifyDemand(text);
    assert.equal(r.role, 'BUY_SEEKER', `${text.slice(0, 40)} → ${r.role} ${r.evidence}`);
  }
});

test('live test 2026-10-16: a seeker who never said buy or rent is an interested person to verify', async () => {
  const { boundModelReading } = await import('../findBuyers/demandClassifier.ts');
  const { classifyBuyerIntent } = await import('../findBuyers/buyerIntent.ts');
  const text = 'ვეძებ ბინას 3ოთახიანს ვარკეთილში';
  const rule = classifyDemand(text);
  for (const model of [null, { role: 'RENT_SEEKER', transaction: 'RENT' }, { role: 'BUY_SEEKER', transaction: 'BUY' }]) {
    const r = model ? boundModelReading(rule, model) : rule;
    const q = qualify(r, SALE_DNA, { ageDays: 1, duplicate: false });
    assert.equal(q.category, 'WEAK', JSON.stringify(model));
    assert.ok(q.limitations.includes('TRANSACTION_UNCONFIRMED'));
    assert.equal(classifyBuyerIntent({ text, kind: 'POST', reading: r }).resultType, 'INTEREST', 'never a confirmed buyer, never dropped');
  }
  /* a generic question with no listing context is not a buyer */
  assert.notEqual(classifyBuyerIntent({ text: 'საძინებელი რამდენი?\nფასი?', kind: 'COMMENT', parent: null }).resultType, 'DIRECT');
});
