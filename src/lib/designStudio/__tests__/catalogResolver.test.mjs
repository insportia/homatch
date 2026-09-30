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
