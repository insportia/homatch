// marketLandUse.test.mjs — land is compared with land of the same designation, and a repost is one listing (prod 176264ba, 2026-10-23).
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMarketEligibility, landUseOf } from '../marketEligibility.ts';
import { parseRegisterExtract } from '../intelligence/propertyRegister.ts';

const subject = (over = {}) => ({
  assetClass: 'LAND', assetClassBasis: 'REGISTRY', areaSqm: 7800, areaBasis: 'REGISTRY_LAND', landAreaSqm: 7800, landUse: 'NON_AGRICULTURAL',
  rooms: null, city: 'თბილისი', district: 'კრწანისი', areaKey: null, locality: 'კრწანისი', latitude: null, longitude: null,
  project: null, address: 'კრწანისის ქ. 49', transactionType: 'BUY', ...over,
});
const plot = (id, slug, area, price, street = 'თელეთის ქ. ') => ({
  source: 'myhome.ge', url: `https://www.myhome.ge/udzravi-qoneba/iyideba-${slug}-miwis-nakveti-krwanisshi-${id}/`,
  area, price, currency: 'USD', pricePerSqm: Math.round(price / area), address: `${street}, კრწანისი, თბილისი`,
  district: 'კრწანისი', comparableType: 'SAME_DISTRICT', listingStatus: 'ACTIVE', propertyType: 'LAND', dealType: 'SALE',
});
// The reference job's six "comparables": one agricultural plot posted four times, one more agricultural, one non-agricultural.
const reference = [
  plot('26292103', 'sasoflo-sameurneo', 4200, 168000),
  plot('26254765', 'sasoflo-sameurneo', 4200, 168000),
  plot('26247734', 'sasoflo-sameurneo', 4200, 168000),
  plot('26183733', 'sasoflo-sameurneo', 4200, 168000),
  plot('25866135', 'ara-sasoflo-sameurneo', 5000, 225000, 'კრწანისის ქ. '),
  plot('26172867', 'sasoflo-sameurneo', 4500, 93000, 'კრწანისის ქ. '),
];

test('land designation is read from Georgian text and from a listing address', () => {
  assert.equal(landUseOf('არასასოფლო სამეურნეო'), 'NON_AGRICULTURAL');
  assert.equal(landUseOf('არასასოფლო-სამეურნეო'), 'NON_AGRICULTURAL');
  assert.equal(landUseOf('სასოფლო-სამეურნეო'), 'AGRICULTURAL');
  assert.equal(landUseOf('https://www.myhome.ge/udzravi-qoneba/iyideba-ara-sasoflo-sameurneo-miwis-nakveti-x-1/'), 'NON_AGRICULTURAL');
  assert.equal(landUseOf('https://www.myhome.ge/udzravi-qoneba/iyideba-sasoflo-sameurneo-miwis-nakveti-x-1/'), 'AGRICULTURAL');
  assert.equal(landUseOf('მიწის ნაკვეთი', null, undefined), null, 'a listing that states neither is unknown, not a mismatch');
});

test('a non-agricultural plot is not valued with agricultural land; the four reposts never count four times', () => {
  const g = applyMarketEligibility(reference, subject());
  assert.deepEqual(g.accepted.map((c) => String(c.url).match(/(\d+)\/$/)[1]), ['25866135']);
  assert.equal(g.rejectedCounts.LAND_USE_MISMATCH, 5);
});

test('reposts of one plot (same area, price and street) are one listing even when the designation is unknown', () => {
  const unknown = reference.slice(0, 4).map((c) => ({ ...c, url: c.url.replace('sasoflo-sameurneo-', '') }));
  const g = applyMarketEligibility(unknown, subject({ landUse: null }));
  assert.equal(g.accepted.length, 1);
  assert.equal(g.rejectedCounts.DUPLICATE, 3);
});

test('without a register designation, land listings are not filtered by designation', () => {
  const g = applyMarketEligibility([reference[0], reference[4]], subject({ landUse: null }));
  assert.equal(g.accepted.length, 2);
});

test('an apartment subject is never judged by land designation', () => {
  const flat = { ...reference[4], propertyType: 'APARTMENT', url: 'https://www.myhome.ge/udzravi-qoneba/iyideba-bina-sasoflo-x-9/', area: 80, price: 120000, pricePerSqm: 1500 };
  const g = applyMarketEligibility([flat], subject({ assetClass: 'APARTMENT', areaSqm: 80, landUse: 'NON_AGRICULTURAL' }));
  assert.ok(!g.rejectedCounts.LAND_USE_MISMATCH);
});

test('the register parser reads the current label (დანიშნულება) and a wrapped value', () => {
  const extract = (label) => [
    'ამონაწერი საჯარო რეესტრიდან', 'მისამართი: ქალაქი თბილისი, კრწანისის', 'ქუჩა, N 49',
    'ნაკვეთის საკუთრების ტიპი:', 'თანასაკუთრება', `ნაკვეთის ${label}: არასასოფლო`, 'სამეურნეო',
    'დაზუსტებული ფართობი: 7800.00 კვ.მ.', 'საკუთრების განყოფილება',
  ].join('\n');
  assert.equal(parseRegisterExtract(extract('დანიშნულება'), 'r1')?.landFunction, 'არასასოფლო სამეურნეო');
  assert.equal(parseRegisterExtract(extract('ფუნქცია'), 'r2')?.landFunction, 'არასასოფლო სამეურნეო');
  assert.equal(parseRegisterExtract(extract('ფუნქცია').replace('არასასოფლო\nსამეურნეო', 'არასასოფლო სამეურნეო'), 'r3')?.landFunction, 'არასასოფლო სამეურნეო');
});
