// HOMATCH Verify v6 — MARKET relevance and LOCATION, from the Digomi and
// Krtsanisi ledgers (production jobs eeefada9, dbf04e48, 8ba97da9).
//
//   eeefada9  flat N4, Kristian Stiven St. 18, Digomi: 186 citywide
//             comparables; reconciledIdentity carried a MyHome Saburtalo
//             address, so two Saburtalo flats became "same address"; the
//             neighbourhood said NO_LOCATION.
//   dbf04e48  parking space N17 in the same building, priced from apartments.
//   8ba97da9  flat N601, Krtsanisi St. 6: the excluded districts must be
//             relative to the subject, not a fixed Krtsanisi list.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CADASTRAL_PLAN_TEXT,
  COMPARABLES,
  FLAT_REPORT,
  PARKING_NEARBY,
  PARKING_REPORT,
  browserOfficial,
} from './fixtures/digomiMarketFixture.mjs';
import { buildIntelligenceBundle } from '../intelligence/bundle.ts';
import { buildEvidencePackage } from '../intelligence/evidencePackage.ts';
import { buildMarketIntelligence, scoreComparable } from '../intelligence/marketIntelligence.ts';
import {
  comparableKindOf,
  enforceValuation,
  kindsCompatible,
  officialSubjectAddress,
  parseOfficialAddress,
  propertyKindOfText,
  subjectMarketFacts,
  subjectPropertyKind,
  MAX_CUSTOMER_COMPARABLES,
} from '../intelligence/marketHierarchy.ts';
import { areAdjacent, firstAreaOf } from '../intelligence/marketGeography.ts';
import { marketView } from '../marketPresentation.ts';
import {
  centerFromBrowserOfficial,
  centerFromCadastralPlan,
  centerFromCadastralPlanText,
  displayName,
  geocodeQueries,
  haversineM,
  registerOrder,
  utmToLatLng,
} from '../intelligence/neighborhood.ts';
import { resolveNeighborhood } from '../intelligence/neighborhoodFetch.ts';
import { VERIFY_V6_MARKET_STRINGS } from '../../../scripts/verify-v6-market-i18n-data.mjs';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
const run = (report) => {
  const pkg = buildEvidencePackage(report);
  return { pkg, bundle: buildIntelligenceBundle(report, pkg) };
};
const UNRELATED = /საბურთალო|ვაკე|გლდანი|ვარკეთილი|ორთაჭალა|კრწანისი/;

/* ── the subject: its own address, area and kind ─────────────────────── */

test('eeefada9: the subject address is the register\'s, never the MyHome listing that leaked into reconciledIdentity', () => {
  const f = subjectMarketFacts(FLAT_REPORT);
  assert.equal(f.address, 'ქალაქი თბილისი, სოფელი დიღომი, კრისტიან სტივენის ქუჩა N18');
  assert.equal(f.district, 'დიღომი');
  assert.ok(!/საბურთალო|გელოვან/.test(JSON.stringify(f)), 'the Saburtalo listing address survived');
  assert.equal(f.area, 79.5, 'the register area from officialEvidence');
  assert.equal(f.propertyKind, 'APARTMENT');
});

test('a reconciled address is still used when it is the subject\'s own and agrees with the project', () => {
  const r = { reconciledIdentity: { address: 'თბილისი, კრწანისის ქ. 6' } };
  assert.equal(subjectMarketFacts(r).address, 'თბილისი, კრწანისის ქ. 6');
  const leaked = { projectProfile: { address: '18 Kristian Stiven Street, Digomi, Tbilisi' }, reconciledIdentity: { address: 'მარშალ გელოვანის გამზ. 23, საბურთალო, თბილისი' } };
  assert.equal(subjectMarketFacts(leaked).address, '18 Kristian Stiven Street, Digomi, Tbilisi');
  assert.equal(subjectMarketFacts(leaked).district, 'დიღომი', 'a neighbourhood that disagrees with the project is not the subject\'s');
});

test('official address and unit descriptor are read from the register sentence', () => {
  assert.deepEqual(
    parseOfficialAddress('საკადასტრო კოდი 01.18.06.019.055.03.01.601 რეგისტრირებულია მისამართზე: ქალაქი თბილისი, კრწანისის ქუჩა N6, „ც“ ბლოკი, სართული 6, ბინა N601.'),
    { address: 'ქალაქი თბილისი, კრწანისის ქუჩა N6', descriptor: '„ც“ ბლოკი, სართული 6, ბინა N601' },
  );
  assert.equal(officialSubjectAddress(PARKING_REPORT).descriptor, 'სართული 1, ავტოსადგომი N17 (მშენებარე)');
  assert.equal(parseOfficialAddress('უბრალო წინადადება მისამართის გარეშე.'), null);
});

test('property kind: parking, apartment, commercial, house; the register descriptor wins over amenities', () => {
  assert.equal(subjectPropertyKind(PARKING_REPORT), 'PARKING');
  assert.equal(subjectPropertyKind(FLAT_REPORT), 'APARTMENT', 'the project\'s "მიწისზედა პარკინგი" amenity made a flat a parking space');
  assert.equal(propertyKindOfText('კომერციული ფართი N3'), 'COMMERCIAL');
  assert.equal(propertyKindOfText('ინდივიდუალური საცხოვრებელი სახლი'), 'HOUSE');
  assert.equal(propertyKindOfText('ფართი (მშენებარე)'), null, 'a bare "area" is not a kind');
  assert.equal(comparableKindOf({ propertyType: 'RESIDENTIAL', url: 'https://www.myhome.ge/udzravi-qoneba/iyideba-3-otaxiani-bina-x/' }), 'APARTMENT');
  assert.equal(comparableKindOf({ propertyType: 'PARKING' }), 'PARKING');
  assert.equal(comparableKindOf({ url: 'https://ss.ge/ka/udzravi-qoneba/iyideba-avtosadgomi-1' }), 'PARKING');
  assert.equal(kindsCompatible('PARKING', 'APARTMENT'), false);
  assert.equal(kindsCompatible('PARKING', null), false, 'an unlabelled listing is not a parking space');
  assert.equal(kindsCompatible('APARTMENT', null), true);
  assert.equal(kindsCompatible(null, 'COMMERCIAL'), true, 'an unknown subject kind excludes nothing');
});

/* ── the market gate ─────────────────────────────────────────────────── */

test('eeefada9: nothing from Saburtalo or the rest of the city reaches the buyer; Gelovani 23 is not "same address"', () => {
  const { bundle } = run(FLAT_REPORT);
  const h = bundle.market.hierarchy;
  assert.ok(h.comparables.length > 0 && h.comparables.length <= MAX_CUSTOMER_COMPARABLES);
  for (const c of h.comparables) {
    assert.ok(!UNRELATED.test(c.address ?? ''), `an unrelated district was shown: ${c.address}`);
    assert.ok(c.level === 1 || ['DIGHOMI', 'DIDI_DIGHOMI', 'DIGHOMI_MASSIVE'].includes(c.district), `${c.address} is outside the subject's side of the city`);
    assert.notEqual(c.reason, 'SAME_ADDRESS', `${c.address} was taken for the subject's address`);
  }
  assert.equal(h.levelCounts[2], 0, 'a Saburtalo listing was level 2');
  assert.ok(h.comparables.some((c) => c.level === 1 && c.project === 'Kristian Stiven Street, 18'), 'the development\'s own asks are first');
});

test('price similarity alone is never relevance: a Saburtalo flat at the project\'s own price is excluded', () => {
  const facts = subjectMarketFacts(FLAT_REPORT);
  const twin = COMPARABLES.find((c) => c.url.includes('sab-4'));
  const s = scoreComparable({ ...facts, dealType: 'SALE' }, twin, { priceAnchor: 950 });
  assert.equal(s.level, null);
  assert.ok(s.exclusions.includes('UNRELATED_DISTRICT'));
});

test('the excluded districts are relative to the subject: Didi Dighomi is nearby for Digomi and unrelated for Krtsanisi', () => {
  const dd = COMPARABLES.find((c) => c.url.includes('dd-1'));
  const kr = COMPARABLES.find((c) => c.url.includes('kr-1'));
  const digomi = { address: 'ქალაქი თბილისი, სოფელი დიღომი, კრისტიან სტივენის ქუჩა N18', district: 'დიღომი', area: 79.5, dealType: 'SALE' };
  const krtsanisi = { address: 'თბილისი, კრწანისის ქ. 6', district: 'ორთაჭალა', area: 94.1, dealType: 'SALE' };
  assert.equal(scoreComparable(digomi, dd).level, 5);
  assert.ok(scoreComparable(digomi, kr).exclusions.includes('UNRELATED_DISTRICT'));
  assert.ok(scoreComparable(krtsanisi, dd).exclusions.includes('UNRELATED_DISTRICT'));
  assert.equal(scoreComparable(krtsanisi, kr).level, 5, 'Krtsanisi is next to Ortachala');
  assert.equal(firstAreaOf('დიღმის მასივი - III კვარტ., დიღმის მასივი, თბილისი').area, 'DIGHOMI_MASSIVE');
  assert.ok(areAdjacent('DIGHOMI', 'DIGHOMI_MASSIVE') && areAdjacent('DIDI_DIGHOMI', 'DIGHOMI_MASSIVE'));
});

test('a comparable premium development nearby is level 4 only with a matching segment; a name alone is not enough', () => {
  const subject = { address: 'თბილისი, კრწანისის ქ. 6', district: 'ორთაჭალა', area: 94.1, dealType: 'SALE', segment: 'PREMIUM' };
  const peer = { project: 'Ortachala Hills', address: 'ორთაჭალა, თბილისი', area: '90', pricePerSqm: '2900', listingStatus: 'ACTIVE', propertyType: 'RESIDENTIAL' };
  assert.equal(scoreComparable(subject, peer, { priceAnchor: 3000 }).level, 4);
  assert.equal(scoreComparable(subject, { ...peer, pricePerSqm: '1200' }, { priceAnchor: 3000 }).level, 5, 'a cheap project nearby was called a premium peer');
});

test('dbf04e48: a parking space is never priced from apartments, and the reason is explained', () => {
  const { bundle, pkg } = run(PARKING_REPORT);
  const m = bundle.market;
  assert.equal(m.valuation.state, 'INSUFFICIENT_EVIDENCE');
  assert.equal(m.valuation.subjectKind, 'PARKING');
  assert.equal(m.hierarchy.comparables.length, 0, 'apartments were shown beside a parking space');
  assert.equal(m.projectAskingEvidence.length, 0, 'the project\'s apartment asks were shown as the parking space\'s');
  assert.equal(m.headline.state === 'RANGE', false);
  assert.ok(m.hierarchy.excluded.PROPERTY_TYPE_MISMATCH >= 20);
  assert.equal(pkg.items.filter((i) => i.category === 'MARKET').length, 0, 'apartment listings were cited as parking evidence');
  const v = marketView(m);
  assert.equal(v.subjectKind, 'PARKING');
  assert.equal(v.insufficiency.missingKeys[0], 'vfm6_missing_same_kind_parking');
  assert.ok(!v.insufficiency.missingKeys.includes('vfm_missing_size'), 'apartment-size noise in a parking explanation');
  assert.equal(v.insufficiency.nextStepKeys[0], 'vfm6_next_parking_developer');
});

test('dbf04e48: a parking space offered nearby IS admitted', () => {
  const { bundle } = run({ ...PARKING_REPORT, market: { comparables: [...COMPARABLES, ...PARKING_NEARBY] } });
  const shown = bundle.market.hierarchy.comparables;
  assert.equal(shown.length, 1);
  assert.equal(shown[0].pricePerSqm, 1000);
});

test('the curated set: at most six, hierarchy order, project names, dates and asking vs transaction said', () => {
  const many = [...COMPARABLES];
  for (let i = 0; i < 8; i += 1) {
    many.push({ ...COMPARABLES[0], url: `https://example.test/homes/ks18-extra-${i}`, area: String(78 + i), pricePerSqm: String(940 + i * 5) });
  }
  const { bundle } = run({ ...FLAT_REPORT, market: { comparables: many } });
  const v = marketView(bundle.market);
  assert.ok(v.comparables.length <= 6);
  assert.ok(v.comparables.every((c) => c.priceKind === 'ASKING'));
  const firstBroader = v.comparables.findIndex((c) => c.broader);
  assert.ok(firstBroader === -1 || v.comparables.slice(firstBroader).every((c) => c.broader), 'broader-nearby stock ranked above the development\'s own');
  assert.ok(v.comparables.some((c) => c.project === 'Kristian Stiven Street, 18'));
  assert.ok(v.comparables.every((c) => c.listingDate === '2026-10-11'));
  assert.ok(v.comparables.every((c) => c.differences.some((d) => d.key === 'vfm_diff_asking')));
  assert.ok(v.method && v.method.excluded.some((e) => e.key === 'vfm6_ex_other_district'));
});

/* ── no verdict without the subject's own asking price ───────────────── */

const reportWithVerdict = () => ({
  summary: { statement: 'კარგი პროექტი.', highlights: [{ dimension: 'MARKET_POSITION', headline: 'ფასი მიმზიდველია', detail: 'ბინის ფასი მიმზიდველი და გონივრულია მსგავს შეთავაზებებთან შედარებით.' }] },
  sections: [{ key: 'MARKET', title: 'ბაზარი', body: 'იმავე პროექტში ოთხი შეთავაზებაა. ამ ბინის ფასი ბაზარზე დაბალია და მიმზიდველია. ფასის სამართლიანობის თქმა ამ ეტაპზე ვერ ხერხდება.', metrics: [] }],
  keyFindings: [{ finding: 'The asking price looks attractive for the area.', whyItMatters: 'x' }],
  attentionPoints: [],
  rejectedBecause: [],
});

test('no subject asking price: every attractive / reasonable / high verdict is removed; saying none can be given stays', () => {
  const { bundle } = run(FLAT_REPORT);
  assert.equal(bundle.market.subjectPricePerSqm, undefined);
  const out = enforceValuation(reportWithVerdict(), bundle.market);
  const body = out.sections.find((s) => s.key === 'MARKET').body;
  assert.ok(!/მიმზიდველ|დაბალია/.test(body), body);
  assert.match(body, /ვერ ხერხდება/);
  assert.match(body, /ოთხი შეთავაზებაა/);
  assert.ok(!out.summary.highlights.length || !/მიმზიდველ/.test(JSON.stringify(out.summary.highlights)));
  assert.ok(!/attractive/.test(JSON.stringify(out.keyFindings)));
  assert.equal(marketView(bundle.market).subjectPrice.state, 'UNKNOWN');
});

test('a subject price with an ESTIMATE allows a plain position; without an estimate, the price but no verdict', () => {
  const asks = Array.from({ length: 5 }, (_, i) => ({ ...COMPARABLES[0], url: `https://example.test/homes/ks18-${i}`, area: String(76 + i), pricePerSqm: String(940 + i * 10) }));
  const est = buildMarketIntelligence({ project: 'Kristian Stiven Street, 18', address: 'კრისტიან სტივენის ქუჩა 18, დიღომი, თბილისი', area: 79.5, dealType: 'SALE', pricePerSqm: 960, propertyKind: 'APARTMENT' }, asks, []);
  assert.equal(est.valuation.state, 'ESTIMATE');
  const sp = marketView(est).subjectPrice;
  assert.equal(sp.state, 'KNOWN');
  assert.match(sp.positionKey, /^vfm6_pos_/);
  const kept = enforceValuation(reportWithVerdict(), est);
  assert.match(kept.sections.find((s) => s.key === 'MARKET').body, /მიმზიდველია/);

  const thin = buildMarketIntelligence({ project: 'Kristian Stiven Street, 18', area: 79.5, dealType: 'SALE', pricePerSqm: 960 }, asks.slice(0, 1), []);
  assert.equal(marketView(thin).subjectPrice.state, 'KNOWN_NO_VERDICT');
  assert.equal(thin.positioning, undefined);
});

/* ── location: the parcel centre, never invented ─────────────────────── */

test('UTM 38N → WGS 84: the central meridian is 45°E and the Digomi parcel lands in Digomi', () => {
  const cm = utmToLatLng(500000, 4625970);
  assert.ok(Math.abs(cm.lng - 45) < 1e-9);
  const p = utmToLatLng(478660, 4625970);
  assert.ok(p.lat > 41.77 && p.lat < 41.80 && p.lng > 44.72 && p.lng < 44.76, JSON.stringify(p));
  // 1 km east is 1 km on the ground (within the projection's scale factor).
  const east = utmToLatLng(479660, 4625970);
  const d = haversineM(p, east);
  assert.ok(d > 995 && d < 1005, String(d));
});

test('eeefada9: the cadastral plan of THIS parcel gives the centre; another parcel\'s plan or a missing grid gives none', () => {
  const c = centerFromCadastralPlanText(CADASTRAL_PLAN_TEXT, '01.72.14.040.030');
  assert.ok(c && Math.abs(c.lat - 41.7853) < 0.001 && Math.abs(c.lng - 44.7432) < 0.001, JSON.stringify(c));
  assert.equal(centerFromCadastralPlanText(CADASTRAL_PLAN_TEXT, '01.18.06.019.055'), null, 'another parcel\'s plan was used');
  assert.equal(centerFromCadastralPlanText(CADASTRAL_PLAN_TEXT.replace(/UTM zone 38N/g, ''), '01.72.14.040.030'), null);
  assert.equal(centerFromCadastralPlanText(CADASTRAL_PLAN_TEXT.replace(/478680/g, '479900'), '01.72.14.040.030'), null, 'a grid wider than a sheet was trusted');
  assert.equal(centerFromBrowserOfficial(browserOfficial(), '01.72.14.040.030'), null, 'the start view #C= is not a parcel centre');
  assert.ok(centerFromCadastralPlan(browserOfficial(), '01.72.14.040.030'));
});

test('resolveNeighborhood: the cadastral plan centre is used before any geocode, and Overpass is measured from it', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ osm3s: { timestamp_osm_base: '2026-10-11T08:00:00Z' }, elements: [] }), { status: 200 });
  };
  const n = await resolveNeighborhood({ resultJson: FLAT_REPORT, query: '01.72.14.040.030.01.01.004', address: '18 Kristian Stiven Street, Digomi, Tbilisi', previous: { status: 'NO_LOCATION', center: null }, fetchImpl });
  assert.equal(n.status, 'OK');
  assert.equal(n.center.basis, 'CADASTRAL_PLAN');
  assert.equal(n.center.parcel, '01.72.14.040.030');
  assert.ok(!calls.some((u) => u.includes('nominatim')), 'geocoded although the official plan located the parcel');
  assert.equal(n.osmBase, '2026-10-11T08:00:00Z');
});

test('the register\'s city-first address is geocoded street first', () => {
  assert.equal(registerOrder('ქალაქი თბილისი, სოფელი დიღომი, კრისტიან სტივენის ქუჩა N18'), 'კრისტიან სტივენის ქუჩა 18, დიღომი, თბილისი');
  assert.deepEqual(geocodeQueries('ქალაქი თბილისი, სოფელი დიღომი, კრისტიან სტივენის ქუჩა N18')[0], 'კრისტიან სტივენის ქუჩა 18, დიღომი, თბილისი');
  assert.equal(registerOrder('18 Kristian Stiven Street, Digomi, Tbilisi'), '18 Kristian Stiven Street, Digomi, Tbilisi');
});

test('კარფური is spelled in Georgian when OSM has only the Latin name and a Georgian brand', () => {
  assert.equal(displayName({ shop: 'supermarket', name: 'Carrefour', brand: 'Carrefour', 'brand:ka': 'კარფური' }), 'კარფური');
  assert.equal(displayName({ shop: 'supermarket', name: 'Carrefour', 'name:ka': 'კარფური' }), 'კარფური');
  assert.equal(displayName({ shop: 'supermarket', name: 'Nikora' }), 'Nikora', 'a Georgian form was invented');
});

/* ── the approved copy and the components ────────────────────────────── */

const APPROVED_MARKET = [
  'ბინის ფასი მხოლოდ კვადრატული მეტრის ღირებულებით არ უნდა შევაფასოთ. მნიშვნელოვანია, რას ვადარებთ ერთმანეთს.',
  'ორი ბინა შეიძლება ერთი ზომის იყოს, მაგრამ განსხვავდებოდეს მდებარეობით, შენობის ხარისხით, დასრულების მდგომარეობითა და ინფრასტრუქტურით. ამიტომ შევარჩიეთ ისეთი შეთავაზებები, რომლებიც ამ ქონებას რეალურად ჰგავს.',
  'ქვემოთ ნახავთ, რა ფასებია მსგავს პროექტებში და რამდენად კონკურენტულად გამოიყურება განსახილველი ბინა.',
];
const APPROVED_LOCATION = [
  'ბინის შერჩევისას მხოლოდ თავად შენობა არ არის მნიშვნელოვანი. ყოველდღიურ კომფორტზე დიდ გავლენას ახდენს ისიც, რა მდებარეობს ახლოს.',
  'შევამოწმეთ ტრანსპორტის, მაღაზიების, სკოლების, სამედიცინო მომსახურებისა და დასასვენებელი სივრცეების შესახებ ხელმისაწვდომი ინფორმაცია, რათა უკეთ წარმოიდგინოთ, რამდენად მოსახერხებელია ეს ადგილი საცხოვრებლად.',
];

test('the approved MARKET and LOCATION copy is verbatim in Georgian and present in all six locales', () => {
  const S = VERIFY_V6_MARKET_STRINGS;
  assert.equal(S.vfm6_intro_title[1], 'ღირს თუ არა ბინა მოთხოვნილ ფასად?');
  assert.deepEqual([S.vfm6_intro_p1[1], S.vfm6_intro_p2[1], S.vfm6_intro_p3[1]], APPROVED_MARKET);
  assert.equal(S.vnb6_intro_title[1], 'როგორი იქნება აქ ყოველდღიური ცხოვრება?');
  assert.deepEqual([S.vnb6_intro_p1[1], S.vnb6_intro_p2[1]], APPROVED_LOCATION);
  const bundle = read('src/i18n/translations.ts');
  for (const [key, values] of Object.entries(S)) {
    assert.equal(values.length, 6, key);
    for (const v of values) {
      assert.ok(!v.includes('—'), `${key}: em dash in customer copy`);
      assert.ok(!/წუთ|minute|минут/i.test(v), `${key}: a travel time`);
    }
    assert.ok(bundle.includes(`${key}:`), `${key} was not applied to translations.ts`);
  }
});

test('MarketPosition: the approved intro first, the verdict rule, asking/transaction badges, the method collapsed', () => {
  const src = read('src/components/verify/MarketPosition.tsx');
  assert.ok(src.indexOf('<MarketIntro') < src.indexOf('{sections.map'), 'the intro is not first');
  assert.match(src, /<details[^>]*>/);
  assert.match(src, /vfm6_method_title/);
  assert.match(src, /vfm6_subject_price_unknown/);
  assert.match(src, /vfm6_badge_transaction/);
  assert.ok(!/text-\[1[01]px\]/.test(src));
  assert.ok(!/\b(?:ml|mr|pl|pr)-\d/.test(src), 'physical margins/paddings break RTL');
});

test('NeighborhoodSection: the approved LOCATION intro is exported, measured facts only, attribution and data date kept', () => {
  const src = read('src/components/verify/NeighborhoodSection.tsx');
  assert.match(src, /export const LocationIntro/);
  assert.match(src, /vnb6_intro_p1/);
  assert.match(src, /OSM_ATTRIBUTION/);
  assert.match(src, /verify_nb_source/);
  assert.ok(!/წუთ|minute/i.test(src));
  // F5 (2026-10-22): the plan is one of the official candidates read from the job's own browserOfficial.
  const fetchSrc = read('src/verify/intelligence/neighborhoodFetch.ts');
  assert.match(fetchSrc, /officialCenterCandidates\(rj\.browserOfficial/);
  assert.match(fetchSrc, /centerFromCadastralPlan\(browserOfficial, parcel\)/);
});
