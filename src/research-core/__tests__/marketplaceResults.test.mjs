import test from 'node:test';
import assert from 'node:assert/strict';
import { listingActivity } from '../marketplace/freshness.ts';
import { descriptionSignals } from '../marketplace/description-signals.ts';
import { normalizeCandidate } from '../marketplace/normalize.ts';
import { classifyPair } from '../marketplace/property-entity.ts';
import { processSearch, publicView } from '../marketplace/pipeline.ts';
import { browseResults, catalogueRevision, filtersFromParams, resultParams, pageNumbers } from '../marketplace/browse-results.ts';
import { shouldResumeSearch } from '../marketplace/search-entry.ts';
import { classifySeller } from '../marketplace/seller.ts';
import * as F from './fixtures/marketplaceFixtures.mjs';
const now = F.FIXTURE_NOW;
const date = (days) => new Date(now.getTime() - days * 86400000).toISOString();
const process = (list, request = F.FIXTURE_REQUEST) => processSearch({ candidates: F.fixtureCandidates(list), request, now });
const views = (list, request) => process(list, request).properties.map(publicView);

test('30-day freshness: exact boundary, expired, unknown, malformed, naive and future dates', () => {
  assert.equal(listingActivity(date(30), null, now).expired, false);
  assert.equal(listingActivity(date(30.000001), null, now).expired, true);
  for (const at of [null, 'garbage', '2026-10-03T12:00:00', date(-1)]) {
    const result = listingActivity(at, null, now);
    assert.equal(result.at, null); assert.equal(result.ageDays, null); assert.equal(result.expired, false);
  }
});
test('source update is labelled separately; observation never renews source age', () => {
  assert.equal(listingActivity(date(70), date(2), now).basis, 'UPDATED');
  assert.equal(listingActivity(date(2), date(70), now).basis, 'PUBLISHED');
  const result = process([F.listing({ publishedAt: date(31), observedAt: date(0) }), F.listing({ sourceListingId: 'unknown', publishedAt: null })]);
  assert.equal(result.properties.length, 1);
  assert.equal(result.stats.rejected.LISTING_OVER_30_DAYS, 1);
  assert.equal(result.properties[0].intelligence.activity.ageDays, null);
});
test('read time: a result ages out of pages, counts and facets without another crawl', () => {
  const data = views([F.listing({ publishedAt: date(29), updatedAt: null })]);
  assert.equal(browseResults(data, {}, 1, now).total, 1);
  const page = browseResults(data, {}, 1, new Date(now.getTime() + 2 * 86400000));
  assert.equal(page.total, 0); assert.equal(page.totalCurrent, 0); assert.equal(page.summary.excludedOld, 1);
  assert.deepEqual(page.facets.sources, []);
});
test('unknown age is disclosed and does not match a requested recent-age filter', () => {
  const data = views([F.listing({ publishedAt: null })]);
  assert.equal(browseResults(data, {}, 1, now).summary.unknownDates, 1);
  assert.equal(browseResults(data, { ageDays: 7 }, 1, now).total, 0);
});

test('catalogue revision is order-independent and changes with data or freshness eligibility', async () => {
  const data = views([F.listing({ publishedAt: date(29) }), F.listing({ sourceListingId: 'second', areaSqm: 101 })]);
  const revision = await catalogueRevision(data, now);
  assert.equal(revision.length, 64);
  assert.equal(await catalogueRevision([...data].reverse(), now), revision);
  assert.notEqual(await catalogueRevision(data.map((p) => ({ ...p, score: p.score + 0.01 })), now), revision);
  assert.notEqual(await catalogueRevision(data, new Date(now.getTime() + 2 * 86400000)), revision);
  data[0].intelligence.section = 'FRESH';
  data[0].listings[0].publishedAt = date(1);
  assert.notEqual(await catalogueRevision(data, now), await catalogueRevision(data, new Date(now.getTime() + 3 * 86400000)));
});

test('saved fresh sections age out without another crawl and inconsistent source chronology is disclosed', () => {
  const data = views([F.listing({ publishedAt: date(1), updatedAt: null })]);
  data[0].intelligence.section = 'FRESH';
  assert.equal(browseResults(data, { section: 'FRESH' }, 1, now).total, 1);
  const later = new Date(now.getTime() + 4 * 86400000);
  assert.equal(browseResults(data, { section: 'FRESH' }, 1, later).total, 0);
  assert.equal(browseResults(data, {}, 1, later).items[0].intelligence.activity.ageDays, 5);
  assert.equal(data[0].intelligence.section, 'FRESH', 'stored view is never mutated by browsing');
  assert.equal(listingActivity(date(2), date(4), now).invalidDate, true);
});
test('description signals preserve excerpts, negation and structured uncertainty', () => {
  const signals = descriptionSignals('No parking. Fully furnished. Central heating. Balcony with a city view. Price negotiable.');
  assert.equal(signals.find((s) => s.code === 'PARKING').polarity, 'NEGATED');
  assert.equal(signals.find((s) => s.code === 'BALCONY').basis, 'DESCRIPTION');
  const p = views([F.listing({ description: 'Parking and balcony available.', parking: null })], { ...F.FIXTURE_REQUEST, niceToHave: ['PARKING', 'BALCONY', 'POOL'] })[0];
  assert.equal(p.facts.parking, null);
  assert.ok(p.intelligence.preferences.mentioned.includes('PARKING'));
  assert.deepEqual(p.intelligence.preferences.unconfirmed, ['POOL']);
});
test('Georgian and Russian evidence is recognized without inventing facts', () => {
  for (const text of ['ბინა ავეჯით, ცენტრალური გათბობით და აივნით', 'Квартира с мебелью, балкон, центральное отопление']) {
    const codes = descriptionSignals(text).map((s) => s.code);
    assert.ok(codes.includes('FURNISHED')); assert.ok(codes.includes('BALCONY')); assert.ok(codes.includes('CENTRAL_HEATING'));
  }
});
test('explicit negative mandatory amenities exclude; unconfirmed mandatory facts need verification; soft preference never excludes', () => {
  const noParking = F.listing({ parking: false });
  const excluded = views([noParking], { ...F.FIXTURE_REQUEST, mustHave: ['PARKING'] });
  assert.equal(excluded.filter((v) => v.group !== 'OTHER').length, 0, 'never among the homes that fit');
  assert.ok(excluded.every((v) => v.mismatch.includes('REQUIRED_PARKING')), 'outside the request, with why');
  assert.equal(views([noParking], { ...F.FIXTURE_REQUEST, niceToHave: ['PARKING'] }).length, 1);
  const unknown = views([F.listing()], { ...F.FIXTURE_REQUEST, mustHave: ['PARKING'] })[0];
  assert.ok(unknown.unverified.includes('REQUIRED_PARKING'));
  assert.equal(unknown.intelligence.section, 'CLOSE');
  assert.equal(unknown.intelligence.strong, false, 'unknown mandatory facts cannot become a best match');
});
test('developer project mention does not classify the publisher as a developer', () => {
  const l = normalizeCandidate(F.listing({ description: 'Built by developer Archi. My apartment for sale.', seller: {} }), { now });
  assert.equal(classifySeller(l, { propertiesPerPhone: new Map() }).classification, 'UNKNOWN');
});

test('negative agency and ownership language does not become a publisher claim', () => {
  const owner = views([F.listing({ description: 'I am the owner. No agency and no commission.', seller: { declaredType: 'UNKNOWN', publicPhone: '+995555111222', sourceListingCount: 1 } })])[0];
  assert.equal(owner.seller.classification, 'LIKELY_OWNER');
  const unclear = views([F.listing({ description: 'I am not the owner.', seller: { declaredType: 'UNKNOWN', publicPhone: '+995555111222', sourceListingCount: 1 } })])[0];
  assert.equal(unclear.seller.classification, 'UNKNOWN');
});
test('same-site duplicate merges require shared property media; different apartments stay separate', () => {
  const images = F.CONFIRMED_IDENTITY.images;
  const a = normalizeCandidate(F.listing({ ...F.CONFIRMED_IDENTITY, sourceListingId: 'a', images }), { now });
  const b = normalizeCandidate(F.listing({ ...F.CONFIRMED_IDENTITY, sourceListingId: 'b', images }), { now });
  assert.equal(classifyPair(a, b).tier, 'LIKELY_SAME_PROPERTY');
  assert.equal(classifyPair(a, { ...b, floor: a.floor + 1 }).tier, 'DISTINCT_PROPERTY');
  assert.equal(classifyPair(a, { ...b, images: [images[0]] }).tier, 'POSSIBLE_SAME_PROPERTY');
});
test('one primary is freshest, stable, complete; old duplicates cannot lower its price', () => {
  const common = F.CONFIRMED_IDENTITY;
  const list = [F.listing({ ...common, sourceListingId: 'a', publishedAt: date(5) }), F.listing({ ...common, sourceListingId: 'b', publishedAt: date(1) }), F.listing({ ...common, sourceListingId: 'old', price: 130000, publishedAt: date(31) })];
  const output = process(list);
  assert.equal(output.properties.length, 1);
  assert.equal(output.properties[0].intelligence.primaryListingId, 'source-a:b');
  assert.equal(output.properties[0].intelligence.otherListingCount, 1);
  assert.equal(output.properties[0].facts.priceUsd, 150000);
  assert.deepEqual(output.properties, process([...list].reverse()).properties);
});
test('repeated source reports choose latest observation deterministically', () => {
  const list = [F.listing({ observedAt: date(1), price: 140000 }), F.listing({ observedAt: date(0), price: 150000 })];
  assert.deepEqual(process(list).properties, process([...list].reverse()).properties);
  assert.equal(process(list).properties[0].facts.priceUsd, 150000);
});
test('freshness breaks otherwise comparable ranking ties and explanations disclose compromises', () => {
  const data = views([F.listing({ sourceListingId: 'old', publishedAt: date(20) }), F.listing({ sourceListingId: 'new', publishedAt: date(1) })], { ...F.FIXTURE_REQUEST, niceToHave: ['POOL'] });
  const page = browseResults(data, {}, 1, now);
  assert.equal(page.items[0].key, 'source-a:new');
  assert.deepEqual(page.items[0].intelligence.preferences.unconfirmed, ['POOL']);
});
test('structured/text contradiction is a neutral warning and never creates a fraud claim', () => {
  const p = views([F.listing({ parking: false, description: 'Private parking included.' })])[0];
  assert.ok(p.intelligence.warnings.includes('INFORMATION_CONFLICT'));
  assert.equal(p.intelligence.section, 'CLOSE');
  assert.doesNotMatch(JSON.stringify(p), /fraud|scam/i);
});
test('800 properties: all 67 numbered pages deterministic, bounded and without duplicate keys', () => {
  const data = views(Array.from({ length: 800 }, (_, i) => F.listing({ sourceListingId: `v${i}`, images: [], price: 130000 + i * 10, floor: 1 + i % 24 })));
  const seen = new Set();
  for (let n = 1; n <= 67; n++) {
    const page = browseResults(data, {}, n, now);
    assert.equal(page.pages, 67); assert.ok(page.items.length <= 12);
    for (const p of page.items) { assert.ok(!seen.has(p.key)); seen.add(p.key); }
  }
  assert.equal(seen.size, 800);
  assert.deepEqual(browseResults(data, {}, 2, now), browseResults([...data].reverse(), {}, 2, now));
  assert.equal(browseResults(data, {}, 999, now).page, 67);
});
test('filters operate on whole canonical dataset, not only the rendered page', () => {
  const data = views(Array.from({ length: 40 }, (_, i) => F.listing({ sourceListingId: `v${i}`, price: 130000 + i * 1000, areaSqm: 80 + i % 25, images: [] })));
  const page = browseResults(data, { priceMax: 140000, areaMin: 80, roomsMin: 3, bedroomsMin: 2, source: 'source-a', building: 'NEW_BUILD', condition: 'RENOVATED' }, 1, now);
  assert.equal(page.total, 11); assert.ok(page.items.every((p) => p.facts.priceUsd <= 140000));
  assert.equal(browseResults(data, { priceMin: 200000 }, 1, now).total, 0);
});
test('one intelligent section per canonical property; no empty sections count as populated', () => {
  const data = views(F.ALL_FIXTURE_LISTINGS.filter((p) => p.currency === 'USD'));
  const page = browseResults(data, {}, 1, now);
  assert.equal(Object.values(page.sections).reduce((a, b) => a + b, 0), page.total);
  for (const section of Object.keys(page.sections)) assert.equal(browseResults(data, { section }, 1, now).total, page.sections[section]);
});
test('filter edits reset to page 1; numbered navigation preserves search, filters and revision', () => {
  const initial = new URLSearchParams('search=s1&page=7&revision=r1&fp_priceMax=150000');
  const edit = resultParams(initial, { areaMin: 85 });
  assert.equal(edit.get('page'), '1'); assert.equal(edit.get('revision'), 'r1');
  const next = resultParams(edit, {}, 3);
  assert.equal(next.get('search'), 's1'); assert.equal(next.get('page'), '3');
  assert.deepEqual(filtersFromParams(next), { priceMax: 150000, areaMin: 85 });
  assert.deepEqual(pageNumbers(33, 67), [1, 'gap', 32, 33, 34, 'gap', 67]);
});
test('terminal unavailable history never hijacks bare entry, explicit recovery remains accessible', () => {
  const failed = { terminal: true, unavailable: 'FAILED', createdAt: now.toISOString() };
  assert.equal(shouldResumeSearch(failed, null, now.getTime()), false);
  assert.equal(shouldResumeSearch(failed, 'history', now.getTime()), true);
  assert.equal(shouldResumeSearch({ ...failed, terminal: false }, null, now.getTime()), true);
});
test('possible duplicates stay separate, point at each other, and the duplicates filter shows both', () => {
  const images = F.CONFIRMED_IDENTITY.images;
  const list = [F.listing({ ...F.CONFIRMED_IDENTITY, sourceListingId: 'a', images }), F.listing({ ...F.CONFIRMED_IDENTITY, sourceListingId: 'b', images: [images[0]], price: 158000 })];
  const output = process(list);
  assert.equal(output.properties.length, 2, 'never merged');
  assert.equal(output.stats.possibleDuplicates, 1);
  const [x, y] = output.properties.map(publicView);
  for (const [p, other] of [[x, y], [y, x]]) {
    assert.ok(p.intelligence.warnings.includes('POSSIBLE_DUPLICATE'));
    assert.equal(p.identity.status, 'INSUFFICIENT_EVIDENCE');
    assert.equal(p.possibleMatches.length, 1);
    assert.equal(p.possibleMatches[0].key, other.key);
    assert.equal(p.possibleMatches[0].priceUsd, other.facts.priceUsd);
    assert.equal(p.possibleMatches[0].exactUrl, other.listings[0].exactUrl);
  }
  const page = browseResults([x, y], { duplicatesOnly: true }, 1, now);
  assert.equal(page.total, 2);
  assert.equal(page.facets.possibleDuplicates, 2);
  assert.equal(page.facets.duplicates, 0);
  const single = process([F.listing({ sourceListingId: 'solo' })]).properties.map(publicView)[0];
  assert.equal('possibleMatches' in single, false, 'only possible duplicates carry partners');
});
test('seller type and contact come from what the source and the seller actually published', () => {
  const agent = normalizeCandidate({ ...F.listing({ sourceListingId: 'ag' }), retrievalMetadata: { userType: 'agent' } }, { now });
  assert.equal(agent.seller.declaredType, 'BROKER', 'MyHome "agent" is the source declaring an agent');
  assert.equal(classifySeller(agent, { propertiesPerPhone: new Map() }).classification, 'BROKER');
  const physical = normalizeCandidate({ ...F.listing({ sourceListingId: 'ph', seller: { declaredType: null, publicPhone: null, sourceListingCount: 1 } }), retrievalMetadata: { userType: 'physical' } }, { now });
  assert.equal(physical.seller.declaredType, null, 'a private person is not declared an owner');
  const written = normalizeCandidate(F.listing({ sourceListingId: 'tx', description: 'ბინა იყიდება. დარეკეთ: 599 12 34 56', seller: { declaredType: null, publicPhone: null, sourceListingCount: 1 } }), { now });
  assert.equal(written.seller.publicPhone, '+995 599 12 34 56');
  assert.equal(written.seller.phoneFromDescription, true);
  const view = views([F.listing({ sourceListingId: 'tx', description: 'ბინა იყიდება. დარეკეთ: 599 12 34 56', seller: { declaredType: null, publicPhone: null, sourceListingCount: 1 } })])[0];
  assert.equal(view.listings[0].seller.publicPhone, '+995 599 12 34 56');
  assert.equal(view.listings[0].seller.phoneFromDescription, true);
  const none = normalizeCandidate(F.listing({ sourceListingId: 'np', description: 'No contact here.', seller: { declaredType: null, publicPhone: null, sourceListingCount: 1 } }), { now });
  assert.equal(none.seller.publicPhone, null); assert.equal(none.seller.phoneFromDescription, false);
});
test('duplicate reasons name what a person can check: photos, description, phone, place, address and layout', async () => {
  const { matchReasons } = await import('../marketplace/pipeline.ts');
  assert.deepEqual(matchReasons(['shared listing images', 'substantial shared description']).sort(), ['DESCRIPTION', 'PHOTOS']);
  assert.deepEqual(matchReasons(['same canonical url']), ['SAME_LISTING']);
  assert.deepEqual(matchReasons(['corroborated photo set, specific address, description and unit configuration']).sort(), ['ADDRESS_AND_LAYOUT', 'DESCRIPTION', 'PHOTOS']);
  assert.deepEqual(matchReasons(['price within 2%']), [], 'nothing a person could not check is offered as a reason');
  const confirmed = views(F.fixtureCandidates ? [F.listing({ ...F.CONFIRMED_IDENTITY, source: 'source-a', sourceListingId: 'x1' }), F.listing({ ...F.CONFIRMED_IDENTITY, source: 'source-b', sourceListingId: 'x2' })] : [])
    .find((p) => p.identity?.status === 'CONFIRMED_DUPLICATE');
  if (confirmed) assert.ok(confirmed.identity.reasons.length >= 1);
});

test('seller filter: OWNER groups verified and likely owners only; unknown is never an owner', async () => {
  const { sellerMatches } = await import('../marketplace/browse-results.ts');
  assert.ok(sellerMatches('VERIFIED_OWNER', 'OWNER'));
  assert.ok(sellerMatches('LIKELY_OWNER', 'OWNER'));
  for (const c of ['UNKNOWN', 'AGENCY', 'BROKER', 'DEVELOPER']) assert.equal(sellerMatches(c, 'OWNER'), false, c);
  assert.ok(sellerMatches('BROKER', 'BROKER'));
  assert.equal(sellerMatches('LIKELY_OWNER', 'VERIFIED_OWNER'), false, 'an exact value stays exact');
});
