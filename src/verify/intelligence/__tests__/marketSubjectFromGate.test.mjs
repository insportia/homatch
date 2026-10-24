// marketSubjectFromGate.test.mjs — live test dd42a656 (2026-10-24): the gate read an APARTMENT in საბურთალო from the register
// and accepted 47 MyHome flats; the report's market section guessed LAND from document text and refused all of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntelligenceBundle } from '../bundle.ts';
import { buildEvidencePackage } from '../evidencePackage.ts';

const flat = (i, ppsm) => ({
  source: 'MyHome.ge', url: `https://www.myhome.ge/udzravi-qoneba/iyideba-3-otaxiani-bina-saburtaloze-${26000000 + i}/`,
  address: 'ნუცუბიძის ქ. 125ა, საბურთალო, თბილისი', district: 'საბურთალო', area: String(70 + (i % 6)), rooms: '3', price: String((70 + (i % 6)) * ppsm),
  currency: 'USD', pricePerSqm: String(ppsm), propertyType: 'RESIDENTIAL', sourcePropertyType: 'APARTMENT', listingStatus: 'ACTIVE',
  comparableType: 'SAME_DISTRICT', discoveryMethod: 'MARKETPLACE_WORKER_SEARCH', transactionType: 'BUY', retrievedAt: '2026-10-24T14:28:00Z', listingDate: '2026-10-20',
});

test('the market section prices a register-confirmed flat from the flats the gate accepted', () => {
  const comparables = [1500, 1600, 1700, 1800, 1650, 1550].map((p, i) => flat(i, p));
  const report = {
    // Text that once made the guess LAND: the register's own header.
    propertyType: 'მიწის (უძრავი ქონების) საკადასტრო კოდი',
    assetClass: 'LAND',
    market: { comparables, eligibility: { state: 'OK', subject: { assetClass: 'APARTMENT', assetClassBasis: 'REGISTRY', district: 'საბურთალო', areaSqm: 74.3 } } },
    exactUnit: { area: 74.3 },
  };
  const b = buildIntelligenceBundle(report, buildEvidencePackage(report));
  const m = b.market;
  assert.ok(m, 'a market is built');
  assert.equal(m.hierarchy?.valuation?.subjectKind ?? 'APARTMENT', 'APARTMENT');
  assert.equal(m.hierarchy?.excluded?.PROPERTY_TYPE_MISMATCH ?? 0, 0, 'no flat is refused as another kind');
  assert.equal(m.hierarchy?.excluded?.DISTRICT_UNKNOWN ?? 0, 0, 'the gate district places them');
  // Owner 2026-10-24: no street/project tier, so the same district's asking range prices it, labelled as such.
  assert.equal(m.headline.basis, 'SAME_DISTRICT');
  assert.ok(m.headline.count >= 5, `headline count ${m.headline.count}`);
  assert.equal(m.hierarchy.valuation.state, 'ESTIMATE');
  assert.deepEqual(m.hierarchy.valuation.levelsUsed, [5]);
});

test('without a register-based gate the text guess still decides (no new trust in an identity guess)', () => {
  const report = { market: { comparables: [flat(1, 1500)], eligibility: { subject: { assetClass: 'APARTMENT', assetClassBasis: 'IDENTITY' } } }, assetClass: 'LAND', propertyType: 'მიწის ნაკვეთი' };
  const b = buildIntelligenceBundle(report, buildEvidencePackage(report));
  assert.notEqual(b.market?.hierarchy?.valuation?.subjectKind, 'APARTMENT');
});

test('f51a2908: a parking subject is priced from the garage adverts the gate accepted', async () => {
  const { comparableKindOf, kindsCompatible } = await import('../marketHierarchy.ts');
  const garage = { url: 'https://www.myhome.ge/udzravi-qoneba/iyideba-avtofarexi-komertsiuli-farti-isanshi-26447026', propertyType: 'COMMERCIAL', sourcePropertyType: 'PARKING' };
  assert.equal(comparableKindOf(garage), 'PARKING');
  assert.equal(kindsCompatible('PARKING', comparableKindOf(garage)), true);
});
