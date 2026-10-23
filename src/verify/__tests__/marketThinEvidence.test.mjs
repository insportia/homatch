// marketThinEvidence.test.mjs — one valid comparable is never presented as a market value (prod 176264ba, 2026-10-23).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { insufficiencyOf, marketView } from '../marketPresentation.ts';
import { applyMarketEligibility, rangeBasis, MIN_ELIGIBLE_FOR_RANGE } from '../marketEligibility.ts';

const insufficient = (kind, have = 1) => ({
  valuation: { state: 'INSUFFICIENT_EVIDENCE', defensibleComparables: have, minimumComparables: 3, subjectKind: kind },
  hierarchy: { excluded: {} },
});

test('fewer than three valid comparables: no range is computed at all', () => {
  assert.equal(MIN_ELIGIBLE_FOR_RANGE, 3);
  const one = {
    source: 'myhome.ge', url: 'https://www.myhome.ge/udzravi-qoneba/iyideba-ara-sasoflo-sameurneo-miwis-nakveti-krwanisshi-25866135/',
    area: 5000, price: 225000, currency: 'USD', pricePerSqm: 45, address: 'კრწანისის ქ. , კრწანისი, თბილისი', district: 'კრწანისი',
    comparableType: 'SAME_DISTRICT', listingStatus: 'ACTIVE', propertyType: 'LAND', dealType: 'SALE',
  };
  const subject = { assetClass: 'LAND', assetClassBasis: 'REGISTRY', areaSqm: 7800, areaBasis: 'REGISTRY_LAND', landAreaSqm: 7800, landUse: 'NON_AGRICULTURAL', rooms: null, city: 'თბილისი', district: 'კრწანისი', areaKey: null, locality: 'კრწანისი', latitude: null, longitude: null, project: null, address: 'x', transactionType: 'BUY' };
  const gate = applyMarketEligibility([one], subject);
  assert.equal(gate.accepted.length, 1);
  assert.deepEqual(rangeBasis(gate).kept, [], 'one comparable yields no median, min or max');
});

test('the card explains the shortfall; a land plot is compared with plots, not homes', () => {
  assert.equal(insufficiencyOf(insufficient('LAND')).bodyKey, 'vfm6_insufficient_body_land');
  assert.equal(insufficiencyOf(insufficient('APARTMENT')).bodyKey, 'vfm_insufficient_body');
  assert.equal(insufficiencyOf(insufficient(null)).bodyKey, 'vfm_insufficient_body');
  assert.equal(insufficiencyOf(insufficient('LAND')).have, 1);
});

test('a one-listing band is not shown as a context median', () => {
  const v = marketView({
    currency: 'USD',
    headline: { state: 'EVIDENCE_LIMITED' },
    ...insufficient('LAND'),
    tiers: [
      { tier: 'SAME_DISTRICT', median: 45, min: 45, max: 45, count: 1, contextOnly: true, thin: true },
      { tier: 'SAME_STREET', median: 33, min: 21, max: 45, count: 2, contextOnly: true, thin: true },
    ],
  });
  assert.deepEqual(v.context.map((c) => [c.tier, c.count]), [['SAME_STREET', 2]]);
});

test('the land explanation exists in all six languages with both placeholders', () => {
  const src = readFileSync(fileURLToPath(new URL('../../i18n/translations.ts', import.meta.url)), 'utf8');
  const lines = src.split('\n').filter((l) => l.trim().startsWith('vfm6_insufficient_body_land:'));
  assert.equal(lines.length, 6);
  for (const l of lines) assert.ok(l.includes('{{need}}') && l.includes('{{have}}'), l);
  const card = readFileSync(fileURLToPath(new URL('../../components/verify/MarketPosition.tsx', import.meta.url)), 'utf8');
  assert.match(card, /t\(info\.bodyKey \?\? 'vfm_insufficient_body', vars\)/);
});
