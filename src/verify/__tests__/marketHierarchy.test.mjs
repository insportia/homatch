// HOMATCH Verify — the market LOCATION HIERARCHY and the deterministic
// valuation (P0, production job 8ba97da9, 2026-10-11).
//
// Flat N601, Krtsanisi St. 6, 94.10 m², a premium new development. The report
// listed Didi Dighomi, Gldani, Varketili and Saburtalo listings as its market,
// and printed "≈ $900–3,000/m² (city context)" beside prose saying no reliable
// valuation was possible. The fixture is the run's own 51 comparables,
// sanitized (fixtures/krtsanisiMarketFixture.mjs).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { COMPARABLES, CITYWIDE, KRTSANISI_LOCAL, reportWith, SUBJECT_REPORT } from './fixtures/krtsanisiMarketFixture.mjs';
import { buildIntelligenceBundle } from '../intelligence/bundle.ts';
import { buildEvidencePackage } from '../intelligence/evidencePackage.ts';
import { buildMarketIntelligence, scoreComparable, MIN_RELIABLE_SAMPLE } from '../intelligence/marketIntelligence.ts';
import {
  enforceValuation,
  marketForPrompt,
  subjectMarketFacts,
  MIN_DEFENSIBLE_COMPARABLES,
  SIZE_BAND,
} from '../intelligence/marketHierarchy.ts';
import { streetOf, streetRelation } from '../intelligence/marketGeography.ts';
import { buildIntelligencePrompt } from '../intelligence/prompt.ts';
import { marketView } from '../marketPresentation.ts';
import { browserOfficial } from '../intelligence/__tests__/fixtures/propertyRegisterFixture.mjs';
import { VERIFY_P0_MARKET_STRINGS } from '../../../scripts/verify-p0-market-i18n-data.mjs';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');

const DISTANT = ['დიდი დიღომი', 'გლდანი', 'ვარკეთილი', 'საბურთალო', 'დიდუბე', 'ნავთლუღი', 'ნაძალადევი', 'ისანი', 'ვაკე', 'ვერა', 'სამგორი', 'მუხიანი', 'ლისის ტბა', 'ნუცუბიძის', 'დიღმის მასივი'];
const isDistant = (text) => DISTANT.some((d) => String(text ?? '').includes(d));

const run = (comparables = COMPARABLES, over = {}) => {
  const report = reportWith(comparables, over);
  const pkg = buildEvidencePackage(report);
  return { report, pkg, bundle: buildIntelligenceBundle(report, pkg) };
};

/* ------------------------------------------------------------------ *
 * The street the whole job turned on                                   *
 * ------------------------------------------------------------------ */

test('job 8ba97da9: listings on Krtsanisi Street are the same street, whatever the address tail or spelling', () => {
  const subject = 'თბილისი, კრწანისის ქ. 6';
  assert.equal(streetRelation(subject, 'კრწანისის ქ., ორთაჭალა, თბილისი'), 'SAME_STREET');
  assert.equal(streetRelation(subject, 'ქრწანისის ქ. 6'), 'SAME_ADDRESS', 'the registry spelling ქრწანისის is the same street');
  assert.equal(streetRelation(subject, 'Krtsanisi St. 6, Tbilisi'), 'SAME_ADDRESS');
  assert.equal(streetRelation(subject, 'ул. Крцаниси 6'), 'SAME_ADDRESS');
  assert.equal(streetRelation(subject, 'კრწანისის მეორე შესახვევი 4, ორთაჭალა, თბილისი'), 'STREET_BRANCH');
  assert.equal(streetRelation(subject, 'არტურ ლაისტის ქ. ორთაჭალა თბილისი, თბილისი'), null);
  assert.equal(streetRelation(subject, 'თეიმურაზის ქ. დიდი დიღომი თბილისი, თბილისი'), null);
  // "ქ. თბილისი" (city) is not a street called Tbilisi.
  assert.equal(streetOf('ქ. თბილისი, კრწანისის ქუჩა 6').stem, 'krtsanis');
});

/* ------------------------------------------------------------------ *
 * Distant districts are excluded entirely                              *
 * ------------------------------------------------------------------ */

test('job 8ba97da9: no Didi Dighomi / Gldani / Varketili / Saburtalo listing reaches the customer, the evidence or the model', () => {
  const { pkg, bundle } = run();
  const m = bundle.market;
  assert.equal(m.analyzedCount, 51, 'the gathered pool is still analysed and counted');

  // The curated customer set.
  assert.ok(m.hierarchy.comparables.length >= 1);
  for (const c of m.hierarchy.comparables) {
    assert.ok(!isDistant(c.address), `distant listing shown: ${c.address}`);
    assert.ok(['KRTSANISI', 'ORTACHALA'].includes(c.district), c.district);
  }
  assert.equal(m.hierarchy.excluded.UNRELATED_DISTRICT + (m.hierarchy.excluded.DISTRICT_UNKNOWN ?? 0), 47);

  // The persisted comparableSelection — direct AND context.
  for (const s of [...bundle.comparables.direct, ...bundle.comparables.context]) {
    assert.notEqual(s.tier, 'WIDER_MARKET');
    assert.ok(!isDistant(s.comparable.address), s.comparable.address);
  }
  assert.equal(bundle.comparables.context.length, 0);

  // No citywide band: the UI's context chip read "Wider market · 1,600 USD/m²".
  assert.ok(!m.tiers.some((t) => t.tier === 'WIDER_MARKET'));
  assert.deepEqual(marketView(m).context, []);
  assert.ok(marketView(m).comparables.every((c) => c.districtKey === 'vrx_area_ortachala' || c.districtKey === 'vrx_area_krtsanisi'));

  // Citable evidence: only the Krtsanisi listing (sources list + model cites).
  const marketItems = pkg.items.filter((i) => i.category === 'MARKET');
  assert.ok(marketItems.length >= 1);
  assert.ok(marketItems.every((i) => !isDistant(i.claim) && /კრწანისის/.test(i.claim)), JSON.stringify(marketItems.map((i) => i.claim)));

  // What the model is handed.
  const pm = marketForPrompt(m);
  assert.ok(!isDistant(JSON.stringify(pm)), 'the model was handed distant listings');
  const { user } = buildIntelligencePrompt(pkg, bundle, 'APARTMENT');
  for (const d of ['დიდი დიღომი', 'გლდანი', 'ვარკეთილი', 'საბურთალო']) assert.ok(!user.includes(d), `${d} reached the prompt`);
  assert.ok(!/"median":\s*1600/.test(user), 'the citywide median reached the prompt');
});

/* ------------------------------------------------------------------ *
 * The before / after list for this job                                 *
 * ------------------------------------------------------------------ */

test('job 8ba97da9: the curated list is Krtsanisi St. only, with size band, deal type, date and reason', () => {
  const { bundle } = run();
  const h = bundle.market.hierarchy;
  assert.deepEqual(h.sizeBand, { min: 61.2, max: 127 }, `±${SIZE_BAND * 100}% of 94.10 m²`);
  assert.deepEqual(
    h.comparables.map((c) => [c.level, c.reason, c.area, c.pricePerSqm, c.dealType, c.priceKind, c.freshness]),
    [[3, 'SAME_STREET', 127, 3465, 'SALE', 'ASKING', 'UNDATED']],
  );
  assert.ok(h.comparables[0].flags.includes('LISTING_DATE_UNKNOWN'));
  assert.ok(h.comparables[0].flags.includes('ASKING_NOT_TRANSACTION'));
  assert.equal(h.comparables[0].valuationUse, false, 'one listing never prices the subject');
  // The two larger Krtsanisi listings (130 m², 149.5 m²) and the 53 m² Ortachala flat fall outside the band.
  const ranked = bundle.market.ranked;
  for (const area of [130, 149.5, 53]) {
    const c = ranked.find((r) => r.area === area && ['ORTACHALA', 'KRTSANISI'].includes(r.district));
    assert.ok(c, `missing ${area}`);
    assert.ok(c.exclusions.includes('SIZE_OUT_OF_BAND'), `${area}: ${c.exclusions}`);
  }
  // A 2023 Didube ask is stale as well as distant.
  assert.ok(ranked.find((r) => r.pricePerSqm === 1880 && r.listingDate?.startsWith('2023')).exclusions.includes('STALE'));
});

/* ------------------------------------------------------------------ *
 * Hierarchy order                                                      *
 * ------------------------------------------------------------------ */

const at = (o) => ({ source: 'ss.ge', currency: 'USD', dealType: 'SALE', listingDate: '2026-09-20', retrievedAt: '2026-10-11', area: '95', ...o });
const LADDER = [
  at({ url: 'https://example.test/l5', address: 'ორთაჭალა, თბილისი', pricePerSqm: '1900' }),
  at({ url: 'https://example.test/l4', project: 'Ortachala Riverside', address: 'ორთაჭალა, თბილისი', pricePerSqm: '2050' }),
  at({ url: 'https://example.test/l3', address: 'კრწანისის ქ., ორთაჭალა, თბილისი', pricePerSqm: '2100' }),
  at({ url: 'https://example.test/l2', address: 'ქრწანისის ქ. 6, თბილისი', pricePerSqm: '2150' }),
  at({ url: 'https://example.test/l1', project: 'Villion Krtsanisi Homes', address: 'კრწანისის ქ. 6', pricePerSqm: '2000', comparableType: 'SAME_PROJECT' }),
];

test('Krtsanisi / Ortachala are kept in hierarchy order: project, address, street, nearby premium peer', () => {
  const { bundle } = run([...CITYWIDE, ...LADDER]);
  const h = bundle.market.hierarchy;
  assert.deepEqual(h.comparables.map((c) => [c.level, c.reason]), [
    [1, 'SAME_PROJECT'], [2, 'SAME_ADDRESS'], [3, 'SAME_STREET'], [4, 'NEARBY_PREMIUM_PEER'],
  ], 'level 5 shown although levels 1-4 already reach the threshold');
  assert.deepEqual(bundle.comparables.direct.map((d) => d.reasonKey), [
    'cmp_reason_same_project', 'cmp_reason_same_address', 'cmp_reason_same_street', 'cmp_reason_peer_project',
  ]);
  // Four defensible local asks: an ESTIMATE, from levels 1-4 only.
  const v = bundle.market.valuation;
  assert.equal(v.state, 'ESTIMATE');
  assert.deepEqual(v.levelsUsed, [1, 2, 3, 4]);
  assert.deepEqual(v.pricePerSqm, { median: 2075, min: 2000, max: 2150 });
  assert.equal(v.priceBasis, 'ASKING');
  // One number, one source: the headline IS the valuation.
  assert.deepEqual([bundle.market.headline.min, bundle.market.headline.median, bundle.market.headline.max], [2000, 2075, 2150]);
});

test('broader nearby (level 5) appears only when levels 1-4 are thin, with its reason, and never prices the home', () => {
  const thin = run([...CITYWIDE, LADDER[0], LADDER[2]]).bundle;
  const h = thin.market.hierarchy;
  assert.deepEqual(h.comparables.map((c) => [c.level, c.reason, c.valuationUse]), [
    [3, 'SAME_STREET', false],
    [5, 'BROADER_NEARBY_ADJACENT_DISTRICT', false],
  ]);
  assert.deepEqual(thin.comparables.context.map((c) => c.reasonKey), ['cmp_reason_adjacent_district']);
  assert.equal(thin.market.valuation.state, 'INSUFFICIENT_EVIDENCE');
});

/* ------------------------------------------------------------------ *
 * The customer gate                                                    *
 * ------------------------------------------------------------------ */

test('size band, deal type, building class, availability and freshness each keep a listing away', () => {
  const subject = { project: 'Villion Krtsanisi Homes', address: 'თბილისი, კრწანისის ქ. 6', district: 'კრწანისი', area: 94.1, dealType: 'SALE', buildingClass: 'NEW_BUILD', currency: 'USD' };
  const street = (o) => scoreComparable(subject, at({ address: 'კრწანისის ქ., თბილისი', pricePerSqm: '2000', ...o }));
  assert.deepEqual(street({}).exclusions, []);
  assert.ok(street({ area: '60' }).exclusions.includes('SIZE_OUT_OF_BAND'));
  assert.ok(street({ area: '128' }).exclusions.includes('SIZE_OUT_OF_BAND'));
  assert.ok(street({ area: undefined }).exclusions.includes('SIZE_UNKNOWN'));
  assert.ok(street({ dealType: 'RENT', pricePerSqm: '15' }).exclusions.includes('DEAL_TYPE_MISMATCH'));
  assert.ok(street({ dealType: undefined, url: 'https://ss.ge/qiravdeba-3-otaxiani-bina-1' }).exclusions.includes('DEAL_TYPE_MISMATCH'));
  assert.ok(street({ similarity: 'ძველი აშენებული, ჩეხური პროექტი' }).exclusions.includes('CLASS_MISMATCH'));
  assert.ok(street({ listingStatus: 'expired' }).exclusions.includes('EXPIRED'));
  assert.ok(street({ listingDate: '2025-06-01' }).exclusions.includes('STALE'));
  assert.equal(street({ listingDate: '2026-02-01' }).freshness, 'AGING');
  assert.equal(street({ listingDate: undefined }).freshness, 'UNDATED');
  assert.deepEqual(street({ listingDate: undefined }).exclusions, [], 'an undated ask observed live is flagged, not dropped');
  assert.equal(street({ priceKind: 'TRANSACTION' }).priceKind, 'TRANSACTION');
  assert.equal(street({}).priceKind, 'ASKING');
});

test('the subject area comes from the property extract when exactUnit has none — no area, no size band', () => {
  const facts = subjectMarketFacts({ ...SUBJECT_REPORT, exactUnit: { code: 'x' }, browserOfficial: browserOfficial() });
  assert.equal(facts.area, 83.2);
  assert.equal(facts.buildingClass, 'NEW_BUILD');
  const { bundle } = run(COMPARABLES, { exactUnit: { code: '01.18.06.019.055.03.01.601' }, browserOfficial: browserOfficial() });
  assert.ok(bundle.market.hierarchy.sizeBand, 'the register area did not reach the size band');
});

/* ------------------------------------------------------------------ *
 * INSUFFICIENT_EVIDENCE: no number, no contradiction                   *
 * ------------------------------------------------------------------ */

// The live report's own MARKET section and highlight (job 8ba97da9).
const LIVE_MARKET_BODY =
  'ამ ბინის ფასის შეფასება ახლა ფრთხილად უნდა გაკეთდეს. იმავე პროექტში ან იმავე ქუჩაზე საკმარისი აქტიური განცხადებები არ არის, ' +
  'ხოლო კრწანისის ფარგლებში მხოლოდ ერთი ახლო, მაგრამ მნიშვნელოვნად უფრო დიდი ბინის შეთავაზებაა ხელმისაწვდომი. ' +
  'ამიტომ Villion Krtsanisi Homes-ისთვის სანდო საბაზრო დიაპაზონის ან კონკრეტული სამართლიანი ფასის თქმა ამ ეტაპზე არასწორი სიზუსტე იქნებოდა. ' +
  'თბილისის სხვადასხვა უბანში აქტიური მოთხოვნის ფასები დაახლოებით 900-3,000 დოლარის ფარგლებში მერყეობს კვადრატულ მეტრზე, ' +
  'თუმცა ეს ქალაქის კონტექსტია და არა ამ პროექტის ღირებულება.';

const liveReport = () => ({
  summary: { label: 'POSITIVE', statement: 'კარგი პროექტი.', highlights: [
    { dimension: 'MARKET_POSITION', sentiment: 'BALANCED', headline: 'ფასის შედარება ჯერ შეზღუდულია', detail: 'სანდო საბაზრო დიაპაზონის დადგენა ახლა ზედმეტად ზუსტი იქნებოდა.', cites: [] },
  ] },
  keyFindings: [{ finding: 'კომპანიის ვალდებულება 2,000,000 USD-ზე საქართველოს ბანკის სასარგებლოდ.', whyItMatters: 'განვითარების დაფინანსება.', sentiment: 'BALANCED', cites: [] }],
  sections: [
    { key: 'MARKET', title: 'ბაზარი და ფასის პოზიციონირება', body: LIVE_MARKET_BODY, cites: [], metrics: [
      { label: 'ქალაქის კონტექსტი', value: 'დაახლოებით $900–3,000/მ²' },
      { label: 'პროექტის შედარებადი ბაზა', value: 'შეზღუდული' },
    ] },
    { key: 'SNAPSHOT', title: 'ბინა', body: 'ფართი 94.10 მ², მეექვსე სართული.', cites: [], metrics: [{ label: 'ფართი', value: '94.10 მ²' }] },
  ],
  attentionPoints: [],
  finalView: 'კარგი არჩევანია.',
  rejectedBecause: [],
});

const MONEY = /[$€₾]\s?\d|\d[\d\s.,]*\s?(?:\$|usd|დოლარ)|\d\s?\/\s?(?:მ²|კვ)/iu;

test('INSUFFICIENT_EVIDENCE: the valuation carries no number, and neither may the prose', () => {
  const { bundle } = run();
  const m = bundle.market;
  assert.ok(MIN_DEFENSIBLE_COMPARABLES === MIN_RELIABLE_SAMPLE && MIN_DEFENSIBLE_COMPARABLES === 3);
  assert.equal(m.valuation.state, 'INSUFFICIENT_EVIDENCE');
  assert.equal(m.valuation.reasonCode, 'TOO_FEW_DEFENSIBLE_COMPARABLES');
  assert.equal(m.valuation.pricePerSqm, null);
  assert.equal(m.valuation.usedComparables, 0);
  for (const v of [m.median, m.min, m.max, m.mean, m.headline.median, m.headline.min, m.headline.max]) assert.equal(v, null);
  assert.equal(marketView(m).headline.state, 'EVIDENCE_LIMITED');

  const out = enforceValuation(liveReport(), m);
  const market = out.sections.find((s) => s.key === 'MARKET');
  assert.ok(!MONEY.test(market.body), `a price survived: ${market.body}`);
  assert.ok(!/900|3,000/.test(market.body));
  assert.deepEqual(market.metrics, [{ label: 'პროექტის შედარებადი ბაზა', value: 'შეზღუდული' }], 'the "$900–3,000/m² city context" metric survived');
  // The honest statement stays: the report says no valuation, and only that.
  assert.match(market.body, /სანდო საბაზრო დიაპაზონის/);
  // Non-market facts and areas are untouched: a company obligation is a legal fact, 94.10 m² is not a price.
  assert.match(out.keyFindings[0].finding, /2,000,000 USD/);
  assert.deepEqual(out.sections.find((s) => s.key === 'SNAPSHOT').metrics, [{ label: 'ფართი', value: '94.10 მ²' }]);
  assert.ok(out.rejectedBecause.some((r) => r.includes('INSUFFICIENT_EVIDENCE')));
});

test('ESTIMATE: the range is the answer, and a "no reliable valuation" sentence is removed', () => {
  const { bundle } = run([...CITYWIDE, ...LADDER]);
  assert.equal(bundle.market.valuation.state, 'ESTIMATE');
  const out = enforceValuation(liveReport(), bundle.market);
  const market = out.sections.find((s) => s.key === 'MARKET');
  assert.ok(!/სანდო საბაზრო დიაპაზონის/.test(market.body), 'the prose still denies the valuation');
  assert.equal(out.summary.highlights[0].detail, '');
  // No contradiction left either way: never both a number-free denial and a valuation.
  for (const s of out.sections) assert.ok(!/სანდო[^.]*დიაპაზონ[^.]*(?:არასწორ|ზედმეტ)/u.test(s.body));
});

test('the synthesis applies the override and the prompt tells the model the rule', () => {
  const report = read('src/verify/intelligence/report.ts');
  assert.match(report, /return enforceValuation\(removeRepeatedSentences\(stripFalseScarcity\(/);
  const prompt = read('src/verify/intelligence/prompt.ts');
  assert.match(prompt, /marketIntelligence: marketForPrompt\(bundle\?\.market\)/);
  assert.match(prompt, /INSUFFICIENT_EVIDENCE/);
  assert.match(prompt, /write NO price figure for this home or its/);
  assert.match(prompt, /never also say that no reliable valuation is possible/);
  assert.doesNotMatch(prompt, /neverCallTheMarketInsufficientWhenComparablesExist/);
});

test('i18n: the new reason keys exist in all six locales (en, ka, ru, tr, ar, he)', () => {
  for (const [k, v] of Object.entries(VERIFY_P0_MARKET_STRINGS)) {
    assert.equal(v.length, 6, k);
    assert.ok(v.every((s) => typeof s === 'string' && s.trim()), k);
  }
  for (const k of ['cmp_reason_same_address', 'cmp_reason_street_branch', 'cmp_reason_adjacent_district']) {
    assert.ok(VERIFY_P0_MARKET_STRINGS[k], k);
  }
});

test('the raw pool is never mutated into the curated set (sanity on the fixture)', () => {
  assert.equal(COMPARABLES.length, 51);
  assert.equal(KRTSANISI_LOCAL.length, 3);
  const m = buildMarketIntelligence({ address: 'თბილისი, კრწანისის ქ. 6', district: 'კრწანისი', area: 94.1 }, COMPARABLES);
  assert.equal(m.tierCounts.WIDER_MARKET + m.tierCounts.SAME_STREET + m.tierCounts.SAME_DISTRICT, 51);
  assert.equal(m.tierCounts.SAME_STREET, 3, 'the three Krtsanisi Street listings are the immediate micro-location');
});
