// A re-uploaded picture reuses the MODEL's reading, never the fused one.
//
// Production, after the fusion fix (PR #60) was deployed: the golden plan was
// uploaded again, the cache copied the earlier row's fused doc, and the review
// showed the old 15 doors — fusion never ran. The fixture is that production
// row: `doc` is the stale fused reading, `rawDoc` + `dimensionStrings` the
// model's own.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { cachedModelReading, DS_READ_VERSION } from '../floorplanRead.ts';
import { understand } from '../planRead/understand.ts';

const FIX = path.join(process.cwd(), 'tests/fixtures/design-studio');
const v2 = JSON.parse(fs.readFileSync(path.join(FIX, 'golden-floorplan.read-v2.json'), 'utf8'));

function loadPgm(file) {
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  const m = buf.subarray(0, 64).toString('latin1').match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  const width = Number(m[1]);
  const height = Number(m[2]);
  return { width, height, data: new Uint8Array(buf.buffer, buf.byteOffset + m[0].length, width * height) };
}

const row = () => JSON.parse(JSON.stringify({
  readVersion: DS_READ_VERSION, doc: v2.doc, rawDoc: v2.rawDoc,
  dimensionStrings: v2.dimensionStrings, rawDimensionStrings: v2.dimensionStrings,
}));

test('a cache hit hands back the raw model reading, re-keyed to the new upload, never the stale fused doc', () => {
  const it = row();
  const r = cachedModelReading(it, 'users/x/design-studio-floorplans/p/new.jpg');
  assert.ok(r);
  assert.equal(r.doc.doors.length, v2.rawDoc.doors.length);
  assert.notEqual(r.doc.doors.length, v2.doc.doors.length, 'the fixture really is stale: fused and raw differ');
  assert.equal(r.doc.sourceAssetId, 'users/x/design-studio-floorplans/p/new.jpg');
  r.doc.walls.length = 0;
  assert.ok(it.rawDoc.walls.length > 0, 'the cached row is not mutated by fusing its copy');
});

test('re-fusing the cached reading with the fusion running now gives the corrected plan, not the cached one', () => {
  const r = cachedModelReading(row(), 'k');
  const u = understand({ doc: r.doc, dimensionStrings: r.dimensionStrings, gray: loadPgm(path.join(FIX, 'golden-floorplan.pgm.gz')) });
  assert.equal(v2.doc.doors.length, 15, 'production served 15');
  assert.equal(u.doc.doors.length, 9);
});

test('no raw reading of this version: no reuse (the picture is read again)', () => {
  assert.equal(cachedModelReading({ ...row(), readVersion: 'ds-read-1' }, 'k'), null);
  const { rawDoc: _a, ...noRaw } = row();
  assert.equal(cachedModelReading(noRaw, 'k'), null);
  const { rawDimensionStrings: _b, ...noDims } = row();
  assert.equal(cachedModelReading(noDims, 'k'), null);
  assert.equal(cachedModelReading(null, 'k'), null);
});

test('the handler re-fuses on a cache hit instead of copying the interpretation', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/design-studio-reconstruct/floorplan.ts'), 'utf8');
  assert.match(src, /cachedModelReading\(reuse\.interpretation, plan\.object_key\)/);
  assert.match(src, /fuse\(cachedReading, 0\)/);
  assert.doesNotMatch(src, /\{\s*\.\.\.it,\s*doc:/, 'a copied fused doc is exactly the bug');
});
