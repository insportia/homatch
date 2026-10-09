import { test } from 'node:test';
import assert from 'node:assert/strict';

import { marketContextFrom, companyFinanceFrom, adsViewFromCostRecord } from '../reportGaps.ts';
import { buildCompanyIntelligence } from '../companyIntelligence.ts';
import { extractControlStructure } from '../../researchPlan.ts';
import { withPropertyRegister } from '../registerEnrichment.ts';

/*
 * REGRESSION: job c80f7237. Three sections the research had and the report
 * lost — plus a bank director shown as the developer's. Shapes mirror the
 * stored result_json; personal numbers are placeholders.
 */

const DEV = '404670272';
const BANK = '204378869';
const enreg = (id, name, directorsBlock) => ({
  source: 'enreg', status: 'SEARCH_CONFIRMED', forEntity: { idCode: id, name }, queryEntered: id,
  documents: [{ rawText: directorsBlock, registryExtract: { idCode: id, legalName: name } }],
});
const BROWSER = {
  results: [
    enreg(DEV, 'შპს მილენიო გრუპი', 'დირექტორი\nკობა კვანტალიანი, 00000000001 ,ერთობლივი\nლევან ჩაჩუა, 00000000002 ,ერთობლივი'),
    { source: 'debtor', status: 'NO_RESULT_CONFIRMED', forEntity: { idCode: DEV }, debtorRecordFound: false, retrievedAt: '2026-10-09T08:12:27.156Z' },
    enreg(BANK, 'სს საქართველოს ბანკი', 'გენერალური დირექტორი\nარჩილ გაჩეჩილაძე, 00000000003 ,ერთპიროვნული'),
    { source: 'debtor', status: 'NO_RESULT_CONFIRMED', forEntity: { idCode: BANK }, debtorRecordFound: false },
    { source: 'rstax', status: 'TIMEOUT', forEntity: { idCode: DEV }, unavailable: true, unavailableReason: 'GIVE_UP_STALLED', documents: [] },
  ],
};
const RESULT = {
  browserOfficial: BROWSER,
  companyProfile: {
    name: 'შპს მილენიო გრუპი', idCode: DEV, sourceBasis: 'REGISTRY_CONFIRMED', registryFields: ['directors'],
    directors: [{ name: 'კობა კვანტალიანი', representation: 'ერთობლივი' }, { name: 'ლევან ჩაჩუა', representation: 'ერთობლივი' }],
    encumbrances: [{ kind: 'PLEDGE_LEASE', creditor: 'სს საქართველოს ბანკი (საქართველო) 204378869', reference: 'R23757008', registeredAt: '19/12/2023' }],
    liquidationRegistered: false, extractPreparedAt: '15/08/2024',
  },
  publicResearch: { financingBank: 'საქართველოს ბანკი' },
  market: { comparables: [], priceEvidence: [] },
  _reusePlan: { marketPlan: {
    refresh: false, scope: 'PROJECT', confidence: 'MEDIUM', usableComparables: 3,
    summary: 'reusing PROJECT snapshot (MEDIUM, 3 comparables, 45h old)',
    brief: '\nMARKET RANGE ALREADY ESTABLISHED FOR THIS SEGMENT.\nHomatch has current market intelligence for this project:\n  median 2200 USD per sqm, observed range 2077-3465\n  based on 3 comparable listings, confidence MEDIUM\n',
  } },
  projectProfile: { name: 'Villion Krtsanisi Homes', developer: 'Millenio Group' },
};

test('director: only the developer\'s own extract is read — never the pledge creditor\'s', () => {
  const scoped = extractControlStructure(BROWSER, DEV);
  assert.deepEqual(scoped.directors, ['კობა კვანტალიანი', 'ლევან ჩაჩუა']);
  assert.equal(scoped.representation, 'JOINT');
  assert.deepEqual(extractControlStructure(BROWSER, '999999999').directors, [], 'unknown code reads nothing');
  assert.deepEqual(extractControlStructure(BROWSER).directors, [], 'two entities and no code: ambiguous, nothing');
  assert.ok(!JSON.stringify(scoped).includes('0000000000'), 'personal numbers never leave the parser');
});

test('market: a reused project snapshot becomes a dated, structured market context', () => {
  const mc = marketContextFrom(RESULT, '2026-10-09T09:38:34.516+00:00');
  assert.deepEqual(
    { ...mc },
    { basis: 'HOMATCH_SNAPSHOT', scope: 'PROJECT', currency: 'USD', medianPerSqm: 2200, lowerPerSqm: 2077, upperPerSqm: 3465, listings: 3, confidence: 'MEDIUM', asOf: '2026-10-07', askingPrices: true },
  );
});

test('market: structured snapshot (new jobs) wins; own comparables or a refresh mean no context', () => {
  const structured = { ...RESULT, _reusePlan: { marketPlan: { refresh: false, snapshot: { scope_type: 'DISTRICT', currency: 'USD', median_price_per_sqm: '1800', lower_price_per_sqm: '1500', upper_price_per_sqm: 2100, usable_comparable_count: 7, confidence: 'HIGH', last_refreshed_at: '2026-10-01T00:00:00Z' } } } };
  const mc = marketContextFrom(structured);
  assert.equal(mc.medianPerSqm, 1800);
  assert.equal(mc.asOf, '2026-10-01');
  assert.equal(marketContextFrom({ ...RESULT, market: { comparables: [{}] } }), null);
  assert.equal(marketContextFrom({ ...RESULT, _reusePlan: { marketPlan: { ...RESULT._reusePlan.marketPlan, refresh: true } } }), null);
  assert.equal(marketContextFrom({}), null);
});

test('finance: debtor registry, pledge, liquidation and financing — and an RS.ge timeout is NOT a tax finding', () => {
  const f = companyFinanceFrom(RESULT, buildCompanyIntelligence(RESULT));
  assert.deepEqual(f.debtorRegistry, { state: 'NO_ENTRY', checkedOn: '2026-10-09' });
  assert.deepEqual(f.taxStatus, { state: 'NOT_CHECKED', checkedOn: null });
  assert.deepEqual(f.pledges, [{ creditor: 'სს საქართველოს ბანკი 204378869', reference: 'R23757008', registeredOn: '2023-12-19' }]);
  assert.equal(f.liquidationRegistered, false);
  assert.equal(f.registryExtractDate, '2024-08-15');
  assert.equal(f.financingPartner, 'საქართველოს ბანკი');
  // The BANK's own debtor result is never read as the developer's.
  const onlyBank = { ...RESULT, browserOfficial: { results: BROWSER.results.filter((r) => r.forEntity?.idCode === BANK) } };
  assert.equal(companyFinanceFrom(onlyBank, buildCompanyIntelligence(onlyBank)).debtorRegistry, null);
});

test('ads: a paid zero-result search lost by finish() is rebuilt as "searched, none found" — never more', () => {
  const view = adsViewFromCostRecord(RESULT, { success: true, source: 'actor=memo23~facebook-ads-library-scraper-ppe;basis=PROVIDER_REPORTED;items=0', timestamp: '2026-10-09T09:37:35Z' });
  assert.equal(view.outcome, 'COMPLETE');
  assert.equal(view.activeCount + view.historicalCount + view.unknownStatusCount, 0);
  assert.ok(view.searchedFor.length > 0);
  assert.equal(view.country, 'GE');
  // A non-zero result whose ads are gone, a failed run, or no record: nothing.
  assert.equal(adsViewFromCostRecord(RESULT, { success: true, source: 'items=4' }), null);
  assert.equal(adsViewFromCostRecord(RESULT, { success: false, source: 'items=0' }), null);
  assert.equal(adsViewFromCostRecord(RESULT, null), null);
});

test('read path adds the recovered sections without touching a report that already has them', () => {
  const out = withPropertyRegister({ report: null, market: null }, RESULT, {
    completedAt: '2026-10-09T09:38:34Z',
    adsCost: { success: true, source: 'items=0', timestamp: '2026-10-09T09:37:35Z' },
  });
  assert.equal(out.marketContext.medianPerSqm, 2200);
  assert.equal(out.companyFinance.taxStatus.state, 'NOT_CHECKED');
  assert.equal(out.developerAds.outcome, 'COMPLETE');
  const kept = withPropertyRegister({ report: null, market: { median: 1 }, developerAds: { outcome: 'CACHED' } }, RESULT, { adsCost: { success: true, source: 'items=0' } });
  assert.equal(kept.marketContext, undefined);
  assert.equal(kept.developerAds.outcome, 'CACHED');
});
