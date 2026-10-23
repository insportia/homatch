// engine.test.mjs — the Verify engine selector (src/verify/engine.ts, VERIFY_V2_PLAN.md §1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { engineForNewJob, engineOf, parseEngineSetting, VERIFY_V2_AVAILABLE } from '../engine.ts';

const at = '2026-10-23T12:00:00.000Z';

test('missing, malformed and unknown settings are V1', () => {
  for (const v of [null, undefined, '', 'v2', 'V3', 2, {}, { active: 'v2' }, { active: null }, []]) {
    assert.equal(parseEngineSetting(v).active, 'V1', JSON.stringify(v));
  }
  assert.equal(parseEngineSetting({ active: 'V2' }).active, 'V2');
  assert.equal(parseEngineSetting('V2').active, 'V2');
});

test('V2 requested before it is deployed creates a V1 job and records the request', () => {
  assert.deepEqual(engineForNewJob({ active: 'V2' }, at, false), { version: 'V1', requested: 'V2', selectedAt: at });
});

test('V2 requested once deployed creates a V2 job; V1 always creates V1', () => {
  assert.deepEqual(engineForNewJob({ active: 'V2' }, at, true), { version: 'V2', selectedAt: at });
  assert.deepEqual(engineForNewJob({ active: 'V1' }, at, true), { version: 'V1', selectedAt: at });
  assert.deepEqual(engineForNewJob(null, at, true), { version: 'V1', selectedAt: at });
});

test('the job keeps its stamp; jobs from before the selector read as V1', () => {
  assert.equal(engineOf({ _engine: { version: 'V2' } }), 'V2');
  assert.equal(engineOf({ _engine: { version: 'V1' } }), 'V1');
  assert.equal(engineOf({}), 'V1');
  assert.equal(engineOf(null), 'V1');
});

test('V2 is not selectable in this release', () => {
  assert.equal(VERIFY_V2_AVAILABLE, false);
});

test('research-agent stamps the engine once at creation, keeps it on the finished row, and never shows it to customers', () => {
  const src = readFileSync(fileURLToPath(new URL('../../../supabase/functions/research-agent/index.ts', import.meta.url)), 'utf8');
  assert.match(src, /const engine = engineForNewJob\(await adminSettingJson\(sb, VERIFY_ENGINE_SETTING_KEY\), now\(\)\);/);
  assert.match(src, /result_json: \{ _lang: lang, _engine: engine,/);
  assert.match(src, /_engine: prior\._engine \?\? null,/);
  assert.match(src, /delete r\._engine;/);
  assert.match(src, /'_engine', '_developerAds'\]\) delete r\[k\];/);
  // Read once: the live setting is never consulted after creation.
  assert.equal((src.match(/VERIFY_ENGINE_SETTING_KEY/g) ?? []).length, 2, 'import + the single creation-time read');
});
