// The Asset Resolver: resemblance to the SOURCE wins; quality only breaks
// near ties; scale is a hard truth; provider and import order are not.

import test from 'node:test';
import assert from 'node:assert/strict';
import { rank, PREFERRED_PROVIDER } from '../catalogResolver.ts';

const sofa = (id, o = {}) => ({
  homatchAssetId: id, kind: 'MODEL', sourceProvider: 'blendkit', canonicalCategory: 'OBJECT.FURNITURE', canonicalSubcategory: 'SOFA',
  styles: ['modern'], colors: [], materials: ['fabric'], aliases: [], sizeM: { width: 2.4, depth: 0.95, height: 0.8 }, roomKinds: ['LIVING'],
  qualityTier: 'STANDARD', webSuitability: 0.8, state: 'READY', ...o,
});

test('the picture wins over quality: a standard cream curved fabric sofa beats a premium black leather rectangular one', () => {
  const want = { kind: 'MODEL', objectType: 'SOFA', styles: ['modern'], color: '#efe4cf', materials: ['fabric'], shape: ['curved'], sizeM: { width: 2.8, depth: 1.8, height: 0.8 }, room: 'LIVING' };
  const premiumBlack = sofa('hma_premium', { qualityTier: 'PREMIUM', colors: ['#141414'], materials: ['leather'], aliases: ['rectangular'], sizeM: { width: 2.8, depth: 1.0, height: 0.8 } });
  const standardCream = sofa('hma_standard', { qualityTier: 'STANDARD', colors: ['#f1e6d2'], materials: ['fabric'], aliases: ['curved'], sizeM: { width: 2.75, depth: 1.75, height: 0.82 } });
  const [first] = rank(want, [premiumBlack, standardCream]);
  assert.equal(first.homatchAssetId, 'hma_standard');
});

test('scale is a hard truth: a look-alike at an absurd size cannot win on tags', () => {
  const want = { kind: 'MODEL', objectType: 'SOFA', styles: ['modern'], materials: ['fabric'], sizeM: { width: 2.2, depth: 0.9, height: 0.85 } };
  const tiny = sofa('hma_tiny', { styles: ['modern', 'minimal'], aliases: ['modern', 'fabric'], sizeM: { width: 0.4, depth: 0.2, height: 0.15 } });
  const right = sofa('hma_right', { styles: [], materials: [], sizeM: { width: 2.25, depth: 0.92, height: 0.83 } });
  assert.equal(rank(want, [tiny, right])[0].homatchAssetId, 'hma_right');
});

test('the object type is a filter, not a score; only READY, never REJECT', () => {
  const want = { kind: 'MODEL', objectType: 'SOFA' };
  const chair = sofa('hma_chair', { canonicalSubcategory: 'CHAIR' });
  const failed = sofa('hma_failed', { state: 'FAILED' });
  const rejected = sofa('hma_reject', { qualityTier: 'REJECT' });
  const ok = sofa('hma_ok');
  assert.deepEqual(rank(want, [chair, failed, rejected, ok]).map((r) => r.homatchAssetId), ['hma_ok']);
  assert.deepEqual(rank({ kind: 'MODEL', objectType: 'SOFA' }, [sofa('hma_sec', { canonicalSubcategory: 'SECTIONAL_SOFA' })]).length, 1, 'a sectional is a kind of sofa');
});

test('provider preference is a nudge per kind, never a filter; import and row order change nothing', () => {
  assert.deepEqual(PREFERRED_PROVIDER, { MATERIAL: 'polyhaven', ENVIRONMENT: 'polyhaven', MODEL: 'blendkit' });
  const want = { kind: 'MODEL', objectType: 'SOFA', color: '#efe4cf' };
  const ph = sofa('hma_a_polyhaven', { sourceProvider: 'polyhaven', colors: ['#efe4cf'] });
  const bk = sofa('hma_b_blendkit', { sourceProvider: 'blendkit', colors: ['#efe4cf'] });
  assert.equal(rank(want, [ph, bk])[0].homatchAssetId, 'hma_b_blendkit', 'equal resemblance: the preferred provider');
  assert.deepEqual(rank(want, [bk, ph]), rank(want, [ph, bk]), 'row order does not matter');
  // A clearly closer Poly Haven object still wins: preference never overrides resemblance.
  const closer = sofa('hma_c_polyhaven', { sourceProvider: 'polyhaven', colors: ['#efe4cf'] });
  const farther = sofa('hma_d_blendkit', { colors: ['#1a1a1a'] });
  assert.equal(rank(want, [farther, closer])[0].homatchAssetId, 'hma_c_polyhaven');
  // Exact ties are broken by the asset id (a hash), not by who came first.
  const t1 = sofa('hma_z'); const t2 = sofa('hma_a');
  assert.deepEqual(rank({ kind: 'MODEL', objectType: 'SOFA' }, [t1, t2]).map((r) => r.homatchAssetId), ['hma_a', 'hma_z']);
});

test('materials: surface and colour decide; environments: the light', () => {
  const mat = (id, o) => ({ homatchAssetId: id, kind: 'MATERIAL', sourceProvider: 'polyhaven', canonicalCategory: 'MATERIAL.WOOD', canonicalSubcategory: 'FLOOR_BOARDS', styles: [], colors: [], materials: ['wood'], aliases: ['oak', 'floor'], appliesTo: ['FLOOR'], state: 'READY', ...o });
  const want = { kind: 'MATERIAL', objectType: 'FLOOR_BOARDS', color: 'oak', materials: ['oak'], surface: 'FLOOR' };
  const light = mat('hma_light', { colors: ['oak'] });
  const dark = mat('hma_dark', { colors: ['walnut'] });
  const wall = mat('hma_wall', { appliesTo: ['WALL'], colors: ['oak'] });
  assert.deepEqual(rank(want, [dark, light, wall]).map((r) => r.homatchAssetId), ['hma_light', 'hma_dark']);
  const env = (id, lighting) => ({ homatchAssetId: id, kind: 'ENVIRONMENT', sourceProvider: 'polyhaven', canonicalCategory: 'ENVIRONMENT.SKY', canonicalSubcategory: 'PURE_SKY', styles: [], colors: [], materials: [], aliases: [], lighting, state: 'READY' });
  assert.equal(rank({ kind: 'ENVIRONMENT', lighting: 'SUNSET' }, [env('hma_day', 'DAY'), env('hma_sunset', 'SUNSET')])[0].homatchAssetId, 'hma_sunset');
});

test('what the want does not say is not held against anyone', () => {
  const r = rank({ kind: 'MODEL', objectType: 'SOFA' }, [sofa('hma_x', { colors: [] })]);
  assert.equal(r.length, 1);
  assert.equal(r[0].parts.color, undefined);
  assert.ok(r[0].score > 0);
});

test('asking for a colour the candidate cannot show is not a free pass', () => {
  const want = { kind: 'MODEL', objectType: 'SOFA', color: '#efe4cf' };
  const unknown = sofa('hma_unknown', { colors: [] });
  const close = sofa('hma_close', { colors: ['#e8dcc0'] });
  assert.equal(rank(want, [unknown, close])[0].homatchAssetId, 'hma_close');
});

test('a double bed is found by size, and a single bed at the wrong size cannot win on words', () => {
  const bed = (id, o) => sofa(id, { canonicalSubcategory: 'BED', roomKinds: ['BEDROOM'], ...o });
  const want = { kind: 'MODEL', objectType: 'BED', styles: ['modern'], shape: ['double'], sizeM: { width: 1.7, depth: 2.15, height: 1.0 } };
  const singleButWordy = bed('hma_single', { styles: ['modern'], aliases: ['double', 'modern'], sizeM: { width: 0.95, depth: 2.05, height: 0.9 } });
  const double = bed('hma_double', { styles: [], aliases: [], sizeM: { width: 1.72, depth: 2.12, height: 1.0 } });
  assert.equal(rank(want, [singleButWordy, double])[0].homatchAssetId, 'hma_double');
});

test('a period piece does not answer a modern request (and the reverse)', () => {
  const fridge = (id, o) => sofa(id, { canonicalCategory: 'OBJECT.APPLIANCE', canonicalSubcategory: 'REFRIGERATOR', roomKinds: ['KITCHEN'], sizeM: { width: 0.72, depth: 0.72, height: 1.8 }, ...o });
  const modernWant = { kind: 'MODEL', objectType: 'REFRIGERATOR', styles: ['modern'], sizeM: { width: 0.7, depth: 0.7, height: 1.85 } };
  const retroPremium = fridge('hma_retro', { qualityTier: 'PREMIUM', styles: [], aliases: ['1930s', 'vintage'] });
  const plainStandard = fridge('hma_plain', { qualityTier: 'STANDARD', styles: [], aliases: ['whirlpool'] });
  assert.equal(rank(modernWant, [retroPremium, plainStandard])[0].homatchAssetId, 'hma_plain');
  const periodWant = { ...modernWant, styles: ['vintage'] };
  const modern = fridge('hma_modern', { styles: ['modern'], aliases: ['modern'] });
  assert.equal(rank(periodWant, [modern, retroPremium])[0].homatchAssetId, 'hma_retro');
});

test('a fallback wins only when it is clearly closer', () => {
  const want = { kind: 'MODEL', objectType: 'SOFA', sizeM: { width: 2.2, depth: 0.95, height: 0.85 } };
  const fallbackSlightlyCloser = sofa('hma_fb', { qualityTier: 'FALLBACK', sizeM: { width: 2.2, depth: 0.95, height: 0.85 } });
  const standard = sofa('hma_std', { qualityTier: 'STANDARD', sizeM: { width: 2.25, depth: 0.97, height: 0.86 } });
  assert.equal(rank(want, [fallbackSlightlyCloser, standard])[0].homatchAssetId, 'hma_std');
  const standardFar = sofa('hma_far', { qualityTier: 'STANDARD', sizeM: { width: 3.2, depth: 1.4, height: 0.85 } });
  assert.equal(rank(want, [fallbackSlightlyCloser, standardFar])[0].homatchAssetId, 'hma_fb');
});
