// WHICH SPACE OPENS — AND WHICH ONES ARE REFUSED, OUT LOUD.
//
// The resolver decides what geometry a customer designs on. Getting it wrong
// quietly is the failure that matters: a design made on an apartment the
// developer has since re-published, or on a floor-plan scene the current
// engine can no longer rebuild, looks fine and is wrong.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpatialSource, tierOf, provenanceLabel } from '../spatialSource.ts';

const GEN = 'homatch-geo-1';
let n = 0;
const src = (over = {}) => ({
  id: `s${++n}`,
  project_id: 'p1',
  kind: 'FLOORPLAN_SCENE',
  status: 'READY',
  geometry_state: 'ESTIMATED',
  editability: 'GENERATED',
  dev_unit_id: null,
  upstream: null,
  floorplan_id: 'f1',
  model_object_key: null,
  model_sha256: null,
  model_bytes: null,
  model_mime: null,
  canonical: { schema: 1 },
  calibration: null,
  generator_version: GEN,
  provenance: {},
  failure: null,
  supersedes_id: null,
  created_at: '2026-09-29T10:00:00Z',
  ...over,
});
const dev = (over = {}) => src({
  kind: 'DEVELOPER_UNIT', geometry_state: 'VERIFIED', editability: 'UNCLASSIFIED',
  floorplan_id: null, canonical: null, generator_version: null,
  dev_unit_id: 'u1', upstream: { scene_id: 'sc1', version: '3' }, ...over,
});
const model = (over = {}) => src({
  kind: 'UPLOADED_MODEL', geometry_state: 'ESTIMATED', editability: 'FULLY_STRUCTURED',
  floorplan_id: null, canonical: null, generator_version: null,
  model_object_key: 'users/x/design-studio-models/p1/a.glb', ...over,
});

const resolve = (sources, extra = {}) =>
  resolveSpatialSource({ sources, supportedGenerators: [GEN], ...extra });

test('no source at all is tier E, not an error', () => {
  const r = resolve([]);
  assert.equal(r.tier, 'E');
  assert.equal(r.source, null);
  assert.deepEqual(r.rejected, []);
});

test('priority is A > B > C > D regardless of age', () => {
  const estimated = src({ created_at: '2026-09-29T12:00:00Z' });
  const calibrated = src({ geometry_state: 'CALIBRATED', created_at: '2026-09-29T11:00:00Z' });
  const uploaded = model({ created_at: '2026-09-29T09:00:00Z' });
  const developer = dev({ created_at: '2026-09-28T09:00:00Z' });

  assert.equal(resolve([estimated]).tier, 'D');
  assert.equal(resolve([estimated, calibrated]).source, calibrated);
  assert.equal(resolve([estimated, calibrated, uploaded]).source, uploaded);
  const all = resolve([estimated, calibrated, uploaded, developer]);
  assert.equal(all.source, developer);
  assert.equal(all.tier, 'A');
});

test('VERIFIED and CALIBRATED floor plans share tier C; the newest wins inside a tier', () => {
  const older = src({ geometry_state: 'VERIFIED', created_at: '2026-09-29T08:00:00Z' });
  const newer = src({ geometry_state: 'CALIBRATED', created_at: '2026-09-29T09:00:00Z' });
  assert.equal(tierOf(older), 'C');
  assert.equal(resolve([older, newer]).source, newer);
});

test('superseded, failed and processing sources are never opened', () => {
  const superseded = src({ status: 'SUPERSEDED', geometry_state: 'CALIBRATED' });
  const failed = model({ status: 'FAILED' });
  const processing = model({ status: 'PROCESSING' });
  const live = src();
  const r = resolve([superseded, failed, processing, live]);
  assert.equal(r.source, live);
  assert.deepEqual(r.rejected.map((x) => x.reason).sort(), ['FAILED', 'NOT_READY', 'SUPERSEDED']);
});

test('a developer apartment re-published since it was pinned is STALE, not silently used', () => {
  const pinned = dev();
  const fallback = src();
  const r = resolve([pinned, fallback], {
    developerCurrent: { u1: { scene_id: 'sc1', version: '4' } },
  });
  assert.equal(r.source, fallback, 'the stale developer geometry was opened');
  assert.deepEqual(r.rejected, [{ sourceId: pinned.id, reason: 'STALE_UPSTREAM' }]);
});

test('a developer apartment that is no longer published is WITHDRAWN', () => {
  const pinned = dev();
  const r = resolve([pinned], { developerCurrent: { u1: null } });
  assert.equal(r.tier, 'E');
  assert.deepEqual(r.rejected, [{ sourceId: pinned.id, reason: 'UPSTREAM_WITHDRAWN' }]);
});

test('an unchecked developer publication is usable and says it was not checked', () => {
  const r = resolve([dev()]);
  assert.equal(r.tier, 'A');
  assert.equal(r.freshnessUnchecked, true);
  const checked = resolve([dev()], { developerCurrent: { u1: { scene_id: 'sc1', version: '3' } } });
  assert.equal(checked.freshnessUnchecked, false);
});

test('a floor-plan scene from a generator this engine does not support is refused', () => {
  const old = src({ generator_version: 'homatch-geo-0' });
  const r = resolve([old]);
  assert.equal(r.tier, 'E');
  assert.deepEqual(r.rejected, [{ sourceId: old.id, reason: 'INCOMPATIBLE_GENERATOR' }]);
});

test('sources without their payload are refused rather than opened empty', () => {
  const noGeometry = src({ canonical: null });
  const noFile = model({ model_object_key: null });
  const noPin = dev({ upstream: null });
  const r = resolve([noGeometry, noFile, noPin]);
  assert.equal(r.tier, 'E');
  assert.equal(r.rejected.every((x) => x.reason === 'MISSING_PAYLOAD'), true);
});

test('an explicit choice beats the order, but only when it is usable', () => {
  const estimated = src();
  const developer = dev();
  const chosen = resolve([estimated, developer], { preferredSourceId: estimated.id });
  assert.equal(chosen.source, estimated);
  assert.equal(chosen.explicit, true);

  const staleChoice = resolve([estimated, developer], {
    preferredSourceId: developer.id,
    developerCurrent: { u1: { scene_id: 'sc1', version: '9' } },
  });
  assert.equal(staleChoice.source, estimated, 'a stale explicit choice was honoured');
  assert.equal(staleChoice.explicit, false);
});

test('the result is deterministic under input order', () => {
  const a = src({ id: 'x-a', created_at: '2026-09-29T10:00:00Z' });
  const b = src({ id: 'x-b', created_at: '2026-09-29T10:00:00Z' });
  assert.equal(resolve([a, b]).source.id, resolve([b, a]).source.id);
});

test('provenance speaks customer language, never kinds or enums', () => {
  assert.deepEqual(provenanceLabel(dev()), {
    originKey: 'ds_source_developer', geometryKey: 'ds_geometry_verified', editabilityKey: null,
  });
  assert.equal(provenanceLabel(model({ editability: 'VISUAL_MODEL' })).editabilityKey, 'ds_editability_visual');
  assert.equal(provenanceLabel(src()).geometryKey, 'ds_geometry_estimated');
});
