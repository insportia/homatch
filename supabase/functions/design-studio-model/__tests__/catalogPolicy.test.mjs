// The last check before either credential is used: what the catalogue
// signing route may sign. RF and UNKNOWN are never written or downloaded; a
// public key is only for CC0; a Blendkit download only for a file the asset
// listed at discovery.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { downloadRefusal, IMPORTABLE_LICENSES, writeRefusal } from '../catalogPolicy.ts';
import { CATALOG_KEY } from '../../../../src/lib/designStudio/catalogSource.ts';

// The route itself imports Deno modules; its patterns are read from its source.
const ROUTE_SRC = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/design-studio-model/catalog.ts'), 'utf8');
const pattern = (name) => { const m = new RegExp(`export const ${name} = /(.+)/;`).exec(ROUTE_SRC); return new RegExp(m[1]); };
const ROUTE_KEY = pattern('CATALOG_KEY');
const ROUTE_DOWNLOAD = pattern('BLENDKIT_DOWNLOAD');
const HMA = 'hma_abcdefghijklmnopqrstuvwxyz';
const key = (delivery, file = 'optimized/x.glb') => `design-studio/catalog/${delivery}/models/${HMA}/hmv_abcdefghijklmnopqrstuvwxyz/${file}`;
const UUID = '0f3b5c2e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const dl = (uuid) => `https://www.blendkit.com/api/v1/downloads/${uuid}/`;
const row = (license_class, o = {}) => ({ homatch_asset_id: HMA, source_provider: 'blendkit', license_class, source_asset: { files: [{ uuid: UUID }] }, ...o });

test('only CC0 is importable today — widening it is a legal decision', () => {
  assert.deepEqual([...IMPORTABLE_LICENSES], ['CC0']);
});

test('R2 write: CC0 may be stored in every class; RF and UNKNOWN nowhere; unrecorded assets never', () => {
  for (const d of ['public', 'licensed', 'restricted']) assert.equal(writeRefusal(key(d), row('CC0')), null, d);
  for (const lic of ['ROYALTY_FREE', 'UNKNOWN', '', 'FREE']) for (const d of ['public', 'licensed', 'restricted']) assert.equal(writeRefusal(key(d), row(lic)), 'LICENSE_NOT_IMPORTABLE', `${lic} ${d}`);
  assert.equal(writeRefusal(key('public'), undefined), 'ASSET_NOT_RECORDED');
});

test('Blendkit download: only a file the recorded CC0 asset listed', () => {
  assert.equal(downloadRefusal(dl(UUID), row('CC0')), null);
  assert.equal(downloadRefusal(dl(OTHER), row('CC0')), 'FILE_NOT_LISTED_FOR_ASSET', 'another asset’s file');
  assert.equal(downloadRefusal(dl(UUID), row('ROYALTY_FREE')), 'LICENSE_NOT_IMPORTABLE', 'RF stays blocked pending permission');
  assert.equal(downloadRefusal(dl(UUID), row('UNKNOWN')), 'LICENSE_NOT_IMPORTABLE');
  assert.equal(downloadRefusal(dl(UUID), row('CC0', { source_provider: 'polyhaven' })), 'ASSET_NOT_RECORDED', 'another provider’s asset');
  assert.equal(downloadRefusal(dl(UUID), undefined), 'ASSET_NOT_RECORDED');
  assert.equal(downloadRefusal(dl(UUID), row('CC0', { source_asset: null })), 'FILE_NOT_LISTED_FOR_ASSET');
  assert.ok(ROUTE_DOWNLOAD.test(dl(UUID)));
  for (const bad of [`https://evil.example/api/v1/downloads/${UUID}/`, `${dl(UUID)}../x/`, `${dl(UUID)}?x=1`, `http://www.blendkit.com/api/v1/downloads/${UUID}/`, `https://www.blendkit.com.evil.example/api/v1/downloads/${UUID}/`]) {
    assert.ok(!ROUTE_DOWNLOAD.test(bad), `the route refuses to send the key to ${bad}`);
  }
});

test('the route signs exactly the keys the core defines — no traversal, no other namespace', () => {
  assert.equal(ROUTE_KEY.source, CATALOG_KEY.source);
  for (const bad of [
    key('public', '../../../../customers/x.jpg'), key('public', '..'), key('public', '.hidden'), key('public', 'a/./b.glb'),
    key('private'), 'design-studio/models/x.glb', `/${key('public')}`, key('public', 'a\\b.glb'), key('public', 'a//b.glb'),
  ]) assert.ok(!ROUTE_KEY.test(bad), bad);
  assert.ok(ROUTE_KEY.test(key('restricted', 'source/x.glb')));
});

test('the route: service role only, the key only in the outbound header, a write checked against the DB', () => {
  const src = ROUTE_SRC;
  assert.match(src, /writeRefusal\(/, 'PUT is checked by licence');
  assert.match(src, /downloadRefusal\(/, 'provider-sign is checked by licence and file');
  const keyUses = src.split('\n').filter((l) => /BLENDKIT_API_KEY|blendkitKey/.test(l) && !/^\s*\/\//.test(l));
  for (const l of keyUses) assert.ok(!/console\.|JSON\.stringify|json\(|Response\(/.test(l), `the key never reaches a log or a response: ${l.trim()}`);
  assert.ok(!/console\.(log|info|warn|error)\([^)]*(filePath|signed|url)/i.test(src), 'no signed URL is logged');
});

test('purge: only PENDING_DELETE assets nothing references are deleted; everything else is refused with a reason', async () => {
  const { purgePlan } = await import('../catalogPolicy.ts');
  const H = (n) => `hma_${String(n).padStart(26, '0')}`;
  const imports = [
    { homatch_asset_id: H(1), lifecycle: 'PENDING_DELETE' },
    { homatch_asset_id: H(2), lifecycle: 'PENDING_DELETE' },
    { homatch_asset_id: H(3), lifecycle: 'DISABLED' },
    { homatch_asset_id: H(4), lifecycle: 'PENDING_DELETE' },
  ];
  const deps = [
    { homatch_asset_id: H(1), versions: 0, published: 0 },
    { homatch_asset_id: H(2), versions: 3, published: 1 },
    { homatch_asset_id: H(3), versions: 0, published: 0 },
  ];
  const p = purgePlan([H(1), H(2), H(3), H(4), H(5)], imports, deps);
  assert.deepEqual(p.deletable, [H(1)]);
  const why = Object.fromEntries(p.blocked.map((b) => [b.homatch_asset_id, b.reason]));
  assert.match(why[H(2)], /referenced by saved designs/);
  assert.equal(p.blocked.find((b) => b.homatch_asset_id === H(2)).versions, 3);
  assert.match(why[H(3)], /queue it for deletion first/, 'a DISABLED asset is never physically deleted');
  assert.match(why[H(4)], /could not be counted/, 'no dependency count, no deletion');
  assert.match(why[H(5)], /not in the catalogue/);
});

test('purge route: admin session (database flag), not impersonated, confirmed, bounded, re-counted server-side, audited', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/design-studio-model/catalogPurge.ts'), 'utf8');
  assert.match(src, /await caller\.rpc\('is_admin'\)/);
  assert.match(src, /refuseIfImpersonating\(admin, authHeader, CORS\)/);
  assert.match(src, /if \(body\.confirmCount !== ids\.length\)/);
  assert.match(src, /if \(ids\.length > MAX_PURGE\)/);
  assert.match(src, /await admin\.rpc\('ds_catalog_dependencies', \{ p_ids: ids \}\)/, 'dependencies are counted again now, not trusted from the browser');
  assert.match(src, /action: 'DELETED'/);
  assert.match(src, /action: 'DELETE_BLOCKED'/);
  assert.doesNotMatch(src, /console\.log\([^)]*(object_key|url)/i, 'no keys or URLs logged');
});
