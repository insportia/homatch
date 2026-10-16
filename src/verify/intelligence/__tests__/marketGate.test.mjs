// HOMATCH Verify — the market gate (2026-10-10).
//
// Production job 220ed087, Villion Krtsanisi Homes (Krtsanisi St. 6, district
// ორთაჭალა, Old Tbilisi): the report's market headline was
//
//   min 928 · max 3000 · median 1600 · basis PEER_PROJECT · count 39
//   tiers: SAME_DISTRICT 1 ($3,460) · PEER_PROJECT 39
//
// and the 39 "peer projects" were in Saburtalo, Navtlughi, Didi Dighomi and
// Didube. The project's own archived offer was ≈ $2,004/m² and its marketing
// ≈ $1,800–2,200/m² — asking prices. These tests pin the gate that stops a
// citywide spread being presented as this project's valuation.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildMarketIntelligence,
  scoreComparable,
  trimOutliers,
  HEADLINE_TIERS,
  MIN_RELIABLE_SAMPLE,
} from '../marketIntelligence.ts';
import { areaOf, areAdjacent } from '../marketGeography.ts';
import { marketShape } from '../marketNarrative.ts';
import { draftSnapshot } from '../marketSnapshot.ts';
import { buildIntelligenceBundle } from '../bundle.ts';
import { buildEvidencePackage } from '../evidencePackage.ts';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');

/* ------------------------------------------------------------------ *
 * The Villion fixture — synthetic, faithful to the production shape   *
 * ------------------------------------------------------------------ */

const VILLION = {
  project: 'VILLION Krtsanisi Homes',
  address: 'Krtsanisi St. 6, Tbilisi',
  district: 'ორთაჭალა',
  area: 94.1,
  rooms: 3,
  currency: 'USD',
  projectAsking: [{ pricePerSqm: 1800, origin: 'DEVELOPER_MARKETING', currency: 'USD' }],
};

const listing = (i, project, address, ppsm) => ({
  source: i % 2 ? 'myhome.ge' : 'ss.ge',
  url: `https://www.myhome.ge/pr/${1000 + i}/`,
  project,
  address,
  area: String(80 + i),
  pricePerSqm: String(ppsm),
  currency: 'USD',
  listingStatus: 'ACTIVE',
  propertyType: 'RESIDENTIAL',
  // How production labelled them: the old fallback.
  comparableType: 'PEER_PROJECT',
});

const ELSEWHERE = [
  listing(1, 'Saburtalo Park', 'ვაჟა-ფშაველას გამზ. 41, საბურთალო, თბილისი', 928),
  listing(2, 'Saburtalo Sky', 'საბურთალო, თბილისი', 1450),
  listing(3, 'Navtlughi Residence', 'ნავთლუღი, თბილისი', 1100),
  listing(4, 'Navtlughi Garden', 'Navtlughi, Tbilisi', 1250),
  listing(5, 'Didi Dighomi Towers', 'დიდი დიღომი, თბილისი', 1600),
  listing(6, 'Dighomi Lake', 'დიდი დიღომი, თბილისი', 1700),
  listing(7, 'Didube Plaza', 'დიდუბე, თბილისი', 1650),
  listing(8, 'Didube City', 'Didube, Tbilisi', 2100),
  listing(9, 'Saburtalo Hills', 'საბურთალო, თბილისი', 3000),
  listing(10, 'Navtlughi Park', 'ნავთლუღი, თბილისი', 1800),
];

const SAME_DISTRICT_3460 = {
  ...listing(11, 'Ortachala Premium', 'ორთაჭალა, თბილისი', 3460),
  comparableType: 'MICRO_LOCATION',
};

const ARCHIVED_OWN_OFFER = {
  source: 'web.archive.org',
  url: 'https://web.archive.org/web/2025/https://villion.ge/apartments',
  project: 'VILLION Krtsanisi Homes',
  address: 'Krtsanisi St. 6, Tbilisi',
  area: '94',
  pricePerSqm: '2004',
  currency: 'USD',
  listingStatus: 'EXPIRED',
  similarity: 'archived offer for this project',
  comparableType: 'SAME_PROJECT',
};

const VILLION_COMPARABLES = [...ELSEWHERE, SAME_DISTRICT_3460, ARCHIVED_OWN_OFFER];

test('Villion regression: listings in Saburtalo / Navtlughi / Didi Dighomi / Didube are never PEER_PROJECT', () => {
  const m = buildMarketIntelligence(VILLION, VILLION_COMPARABLES);
  assert.equal(m.tierCounts.PEER_PROJECT, 0, 'a citywide development was labelled a peer of a Krtsanisi building');
  assert.equal(m.tierCounts.WIDER_MARKET, 10);
  for (const c of m.ranked.filter((r) => r.tier === 'WIDER_MARKET')) {
    assert.ok(c.relevanceReasons.includes('OTHER_DISTRICT'), JSON.stringify(c.relevanceReasons));
    assert.equal(c.headlineEligible, false);
  }
  assert.equal(m.tierCounts.SAME_DISTRICT, 1, 'the $3,460 Ortachala listing is district context');
});

test('Villion regression: the headline is EVIDENCE_LIMITED and the $928–$3,000 spread is never the headline', () => {
  const m = buildMarketIntelligence(VILLION, VILLION_COMPARABLES);
  assert.equal(m.basis, 'EVIDENCE_LIMITED');
  assert.equal(m.headline.state, 'EVIDENCE_LIMITED');
  assert.equal(m.basisIsThin, true);
  for (const v of [m.min, m.max, m.median, m.mean, m.headline.min, m.headline.max, m.headline.median]) {
    assert.equal(v, null, 'a headline figure was produced from context listings');
  }
  assert.notEqual(m.min, 928);
  assert.notEqual(m.max, 3000);
  assert.equal(m.subjectValuation, 'EVIDENCE_LIMITED');
  assert.equal(m.contextAvailable, true, 'the wider market is still context a reader can be told about');
  assert.equal(m.positioning, undefined);
  // Context bands are published, and flagged as context.
  for (const t of m.tiers) {
    if (t.tier === 'SAME_DISTRICT' || t.tier === 'WIDER_MARKET') assert.equal(t.contextOnly, true);
  }
  // Why, in stable codes.
  const codes = m.whySelected.map((w) => w.code);
  assert.ok(codes.includes('EVIDENCE_LIMITED'));
  assert.ok(m.whySelected.some((w) => w.code === 'EXCLUDED_OTHER_DISTRICT' && w.count === 10));
  assert.ok(m.whySelected.some((w) => w.code === 'CONTEXT_ONLY_TIER' && w.tier === 'WIDER_MARKET' && w.count === 10));
});

test('Villion regression: the project\'s own prices surface as ASKING evidence, never as transactions', () => {
  const m = buildMarketIntelligence(VILLION, VILLION_COMPARABLES);
  const asks = m.projectAskingEvidence;
  assert.ok(asks.length >= 2);
  for (const a of asks) {
    assert.equal(a.kind, 'ASKING');
    assert.equal(a.notTransaction, true);
  }
  const archived = asks.find((a) => a.origin === 'ARCHIVED_OFFER');
  assert.ok(archived, 'the archived own offer was lost');
  assert.equal(archived.pricePerSqm, 2004);
  assert.ok(asks.some((a) => a.origin === 'DEVELOPER_MARKETING' && a.pricePerSqm === 1800));
  assert.deepEqual(
    { min: m.projectAskingRange.min, max: m.projectAskingRange.max },
    { min: 1800, max: 2004 },
  );
  assert.equal(m.askingNotTransaction, true);
});

test('Villion regression, through the real bundle: synthesis computes the same gate', () => {
  const report = {
    projectProfile: { name: 'VILLION Krtsanisi Homes', address: 'Krtsanisi St. 6, Tbilisi' },
    reconciledIdentity: { project: 'VILLION Krtsanisi Homes', address: 'Krtsanisi St. 6, Tbilisi' },
    exactUnit: { area: '94.1' },
    market: { comparables: VILLION_COMPARABLES, startingPricePerSqm: '1800' },
  };
  const bundle = buildIntelligenceBundle(report, buildEvidencePackage(report));
  const m = bundle.market;
  assert.ok(m);
  assert.equal(m.tierCounts.PEER_PROJECT, 0);
  assert.equal(m.basis, 'EVIDENCE_LIMITED');
  assert.equal(m.min, null);
  assert.equal(m.max, null);
  assert.ok(m.projectAskingEvidence.some((a) => a.origin === 'DEVELOPER_MARKETING' && a.pricePerSqm === 1800));
  assert.ok(m.projectAskingEvidence.some((a) => a.origin === 'ARCHIVED_OFFER' && a.pricePerSqm === 2004));
  // Nothing evidence-limited is ever stored as a reusable segment answer.
  assert.equal(draftSnapshot({ scope: 'PROJECT', key: 'villion' }, m), null);
  // And the narrative frame treats it as background, not as this building.
  const shape = marketShape(m);
  assert.equal(shape.evidenceLimited, true);
  assert.equal(shape.basisIsLocal, false);
  assert.equal(shape.headlineKey, 'verify_mkt_frame_wider');
});

/* ------------------------------------------------------------------ *
 * The individual rules                                                *
 * ------------------------------------------------------------------ */

test('wrong-district rejection: a named, well-priced development in a non-adjacent district is wider market', () => {
  const c = scoreComparable(VILLION, listing(1, 'Vake Boutique', 'ვაკე, თბილისი', 2000), { priceAnchor: 2004 });
  assert.equal(c.tier, 'WIDER_MARKET');
  assert.ok(c.relevanceReasons.includes('OTHER_DISTRICT'));
  assert.ok(!c.relevanceReasons.includes('PRICE_BAND_MATCH'), 'segment was even considered for a distant listing');
  // The research layer's PEER_PROJECT label proves nothing.
  assert.equal(c.headlineEligible, false);
  // Ortachala ↔ Krtsanisi are adjacent; Ortachala ↔ Vake are not.
  assert.equal(areAdjacent('ORTACHALA', 'KRTSANISI'), true);
  assert.equal(areAdjacent('ORTACHALA', 'VAKE'), false);
  assert.equal(areAdjacent('ORTACHALA', 'NAVTLUGHI'), false);
});

test('premium-segment matching: nearby named developments are peers only inside the (tighter) premium band', () => {
  const subject = { project: 'Villion', address: 'თბილისი, კრწანისი', district: 'კრწანისი', segment: 'PREMIUM', currency: 'USD' };
  const comps = [
    listing(1, 'Sololaki Court', 'სოლოლაკი, თბილისი', 2100),
    listing(2, 'Old Town Lofts', 'ძველი თბილისი', 1950),
    listing(3, 'Krtsanisi Park', 'კრწანისი, თბილისი', 2050),
    listing(4, 'Mtatsminda Budget', 'მთაწმინდა, თბილისი', 1600),
    { ...listing(5, 'Villion', 'თბილისი, კრწანისი', 2000), comparableType: 'SAME_PROJECT' },
  ];
  const m = buildMarketIntelligence(subject, comps);
  assert.equal(m.tierCounts.PEER_PROJECT, 3);
  assert.equal(m.basis, 'PEER_PROJECT');
  assert.equal(m.median, 2050);
  const budget = m.ranked.find((c) => c.url?.endsWith('/1004/'));
  assert.equal(budget.tier, 'WIDER_MARKET', 'an economy-priced development counted as a premium peer');
  assert.ok(budget.relevanceReasons.includes('PRICE_BAND_MISMATCH'));
  assert.ok(m.max <= 2100);

  // Without the premium signal the 0.75 floor admits it (1600 / 2000 = 0.8).
  const standard = buildMarketIntelligence({ ...subject, segment: undefined }, comps);
  assert.equal(standard.tierCounts.PEER_PROJECT, 4);

  // Condition is a segment signal too, and an unknown one is never a match.
  const greenSubject = { ...subject, segment: undefined, condition: 'მწვანე კარკასი' };
  const renovatedPeer = scoreComparable(greenSubject, { ...listing(6, 'Sololaki Court', 'სოლოლაკი', 2000), condition: 'ახალი რემონტი' });
  assert.equal(renovatedPeer.tier, 'WIDER_MARKET');
  assert.ok(renovatedPeer.relevanceReasons.includes('CONDITION_MISMATCH'));
  const unknownPeer = scoreComparable({ ...subject, segment: undefined }, listing(7, 'Sololaki Court', 'სოლოლაკი', 2000));
  assert.equal(unknownPeer.tier, 'WIDER_MARKET');
  assert.ok(unknownPeer.relevanceReasons.includes('SEGMENT_UNKNOWN'));
});

test('small-sample valuation: two same-project asks are evidence, not a range', () => {
  const own = (ppsm, i) => ({ ...ARCHIVED_OWN_OFFER, url: `https://ss.ge/x-${i}`, listingStatus: 'ACTIVE', similarity: null, pricePerSqm: String(ppsm) });
  const m = buildMarketIntelligence({ ...VILLION, projectAsking: [], pricePerSqm: 1950 }, [own(1900, 1), own(2100, 2)]);
  assert.ok(MIN_RELIABLE_SAMPLE >= 3);
  assert.equal(m.basis, 'EVIDENCE_LIMITED');
  assert.equal(m.count, 2);
  assert.equal(m.min, null);
  assert.equal(m.max, null);
  assert.equal(m.positioning, undefined, 'a unit was positioned against two asks');
  assert.deepEqual(m.projectAskingEvidence.map((a) => [a.origin, a.pricePerSqm]), [
    ['SAME_PROJECT_LISTING', 1900], ['SAME_PROJECT_LISTING', 2100],
  ]);
  // A third makes it a range.
  const three = buildMarketIntelligence({ ...VILLION, projectAsking: [] }, [own(1900, 1), own(2100, 2), own(2000, 3)]);
  assert.equal(three.basis, 'SAME_PROJECT');
  assert.deepEqual([three.min, three.median, three.max], [1900, 2000, 2100]);
});

test('outlier trimming: one absurd ask does not stretch the headline range', () => {
  const street = (ppsm, i) => ({ url: `https://ss.ge/s-${i}`, address: 'Krtsanisi St. 10, Tbilisi', area: '90', pricePerSqm: String(ppsm), currency: 'USD', listingStatus: 'ACTIVE' });
  const m = buildMarketIntelligence(VILLION, [1800, 1820, 1850, 1880, 1900, 5200].map(street));
  assert.equal(m.basis, 'SAME_STREET');
  assert.equal(m.headline.outliersTrimmed, 1);
  assert.equal(m.headline.trimMethod, 'IQR_1_5');
  assert.equal(m.max, 1900, 'the $5,200 outlier reached the headline');
  assert.equal(m.count, 5);
  const out = m.ranked.find((c) => c.pricePerSqm === 5200);
  assert.equal(out.outlier, true);
  assert.ok(out.relevanceReasons.includes('OUTLIER_TRIMMED'));
  assert.ok(m.whySelected.some((w) => w.code === 'OUTLIERS_TRIMMED' && w.count === 1));
  // Below four listings nothing is trimmed.
  assert.equal(trimOutliers([1, 2, 100], (x) => x).trimmed.length, 0);
});

test('dedupe is kept: one flat posted twice still gets one vote', () => {
  const street = (ppsm, url) => ({ url, address: 'Krtsanisi St. 10, Tbilisi', area: '90', pricePerSqm: String(ppsm), currency: 'USD', listingStatus: 'ACTIVE' });
  const m = buildMarketIntelligence(VILLION, [
    street(1800, 'https://ss.ge/a'), street(1800, 'https://SS.ge/a?utm=x'),
    street(1850, 'https://ss.ge/b'), street(1900, 'https://ss.ge/c'),
  ]);
  assert.equal(m.duplicatesRemoved, 1);
  assert.equal(m.count, 3);
  assert.ok(m.whySelected.some((w) => w.code === 'DUPLICATES_REMOVED' && w.count === 1));
});

test('only SAME_PROJECT / SAME_STREET / PEER_PROJECT may form the headline', () => {
  assert.deepEqual([...HEADLINE_TIERS], ['SAME_PROJECT', 'SAME_STREET', 'PEER_PROJECT']);
});

test('a measured distance within 600 m is the immediate micro-location', () => {
  const c = scoreComparable(VILLION, { address: 'Tbilisi', pricePerSqm: '1900', distanceM: 420, comparableType: 'MICRO_LOCATION' });
  assert.equal(c.tier, 'SAME_STREET');
  assert.ok(c.relevanceReasons.includes('WITHIN_600M'));
  // A MICRO_LOCATION label without a measurement proves nothing.
  const unmeasured = scoreComparable(VILLION, { address: 'Tbilisi', pricePerSqm: '1900', comparableType: 'MICRO_LOCATION' });
  assert.equal(unmeasured.tier, 'WIDER_MARKET');
});

test('neighbourhoods are read in three scripts, with case endings, and a street name is only a weak hint', () => {
  assert.deepEqual(areaOf('Krtsanisi St. 6, Tbilisi'), { area: 'KRTSANISI', viaStreetName: true });
  assert.deepEqual(areaOf('კრწანისის ქუჩა 6, ორთაჭალა'), { area: 'ORTACHALA', viaStreetName: false });
  assert.deepEqual(areaOf('ბინა ვაკეში'), { area: 'VAKE', viaStreetName: false });
  assert.deepEqual(areaOf('Тбилиси, Ваке, ул. Чавчавадзе 40'), { area: 'VAKE', viaStreetName: false });
  assert.deepEqual(areaOf('დიდი დიღომი'), { area: 'DIDI_DIGHOMI', viaStreetName: false });
  assert.equal(areaOf('ბინა ვერანდით'), null, '"ვერა" matched inside "ვერანდა"');
  // The explicit district beats the street the subject is on.
  const c = scoreComparable(VILLION, listing(1, 'Old Tbilisi Lofts', 'კრწანისი, თბილისი', 1950), { priceAnchor: 2004 });
  assert.ok(c.relevanceReasons.includes('ADJACENT_DISTRICT'), 'Ortachala subject vs Krtsanisi comparable must be adjacent, not same');
  assert.equal(c.tier, 'PEER_PROJECT');
});

test('the synthesis prompt forbids a district/city spread as the project value and explains EVIDENCE_LIMITED', () => {
  const src = read('src/verify/intelligence/prompt.ts');
  assert.match(src, /NEVER quote a district or city spread/);
  assert.match(src, /EVIDENCE_LIMITED there is NO market range for this project/);
  assert.match(src, /projectAskingEvidence/);
});

test('the lane and the marketplace fold no longer fall back to PEER_PROJECT', () => {
  const lane = read('src/verify/marketLane.ts');
  const mp = read('src/verify/marketplaceComparables.ts');
  assert.match(lane, /return usedDistrict \? 'SAME_DISTRICT' : 'WIDER_MARKET';/);
  assert.doesNotMatch(mp, /return 'PEER_PROJECT'/);
  assert.match(mp, /return \{ type: 'WIDER_MARKET', distanceM \};/);
});
