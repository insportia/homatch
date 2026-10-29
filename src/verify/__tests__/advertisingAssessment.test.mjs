/* V3 writes the advertising assessment in code: cited, never an inference beyond the Ad Library. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deterministicAdvertisingAssessment } from '../developerAds.ts';

const view = (over = {}) => ({
  outcome: 'COMPLETE', verifiedAt: '2026-10-20T10:00:00Z', platformSearched: 'META_AD_LIBRARY', country: 'GE',
  searchedFor: ['X'], identity: { developerNames: ['X'], legalName: null, projectNames: [], basis: 'IDENTITY' },
  activeCount: 3, historicalCount: 5, unknownStatusCount: 0, platforms: ['facebook', 'instagram'],
  advertisers: [{ pageName: 'X Development', owner: 'DEVELOPER', url: null, activeAds: 3 }],
  projectsAdvertised: ['X Residence'], themes: [], concentration: 'MULTI_PLATFORM', examples: [], socialProfiles: [],
  librarySearchUrl: null, otherAdvertiserAds: 0, duplicatesRemoved: 0, limitations: [], ...over,
});
const items = [{ id: 'e1', source: 'NAPR' }, { id: 'e7', source: 'Meta Ad Library' }];

test('a visible ads view becomes a cited, bounded assessment', () => {
  const a = deterministicAdvertisingAssessment(view(), items);
  assert.ok(a);
  assert.deepEqual(a.cites, ['e7']);
  assert.match(a.statement, /3 აქტიური და 5 ადრინდელი/);
  assert.match(a.statement, /არ ადასტურებს გაყიდვებს/);
  assert.ok(a.points.some((p) => p.includes('X Development')));
});

test('no evidence, no assessment: disabled stage, missing view or nothing to cite', () => {
  assert.equal(deterministicAdvertisingAssessment(view({ outcome: 'DISABLED' }), items), null);
  assert.equal(deterministicAdvertisingAssessment(null, items), null);
  assert.equal(deterministicAdvertisingAssessment(undefined), null);
  assert.equal(deterministicAdvertisingAssessment(view(), [{ id: 'e1', source: 'NAPR' }]), null);
});

test('no ads found is said plainly, without reading it as inactivity', () => {
  const a = deterministicAdvertisingAssessment(view({ activeCount: 0, historicalCount: 0 }), items);
  assert.match(a.statement, /ვერ მოიძებნა/);
  assert.match(a.statement, /არ ნიშნავს, რომ დეველოპერი არ არის აქტიური/);
});
