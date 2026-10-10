import test from 'node:test';
import assert from 'node:assert/strict';
import { MyHomeEngine } from '../.tstest-build/marketplace/myhome/engine.js';
import { AcquisitionError, endpoints } from '../.tstest-build/marketplace/myhome/api.js';
import { myHomeRestricted } from '../../supabase/functions/_shared/myHomeAccess.ts';
import { readFileSync } from 'node:fs';
import { parsePublicPage, publicPage } from '../.tstest-build/marketplace/myhome/public-page.js';

test('persisted restriction prevents all transport calls after restart', async () => {
  let restricted = false, requests = 0;
  const store = { restricted: async () => restricted, restrict: async () => { restricted = true; } };
  const engine = new MyHomeEngine(); engine.configure(store);
  await engine.ready();
  await assert.rejects(engine.guard(async () => { requests++; throw new AcquisitionError('https://www.myhome.ge', 403, 'CHALLENGE_REQUIRED'); }), /CHALLENGE_REQUIRED/);
  assert.equal(restricted, true);
  const restarted = new MyHomeEngine(); restarted.configure(store);
  await assert.rejects(restarted.ready(), /ACCESS_RESTRICTED/);
  await assert.rejects(engine.guard(async () => { requests++; }), /ACCESS_RESTRICTED/);
  assert.equal(requests, 1, 'no retry, browser escalation or half-open probe');
});

test('failed health storage fails closed and does not erase original source errors', async () => {
  const engine = new MyHomeEngine();
  engine.configure({ restricted: async () => { throw Error('store unavailable'); }, restrict: async () => { throw Error('write unavailable'); } });
  await assert.rejects(engine.ready(), /store unavailable/);
  await assert.rejects(engine.guard(async () => { throw new AcquisitionError('https://www.myhome.ge', 401, 'HTTP 401'); }), /HTTP 401/);
  await assert.rejects(engine.ready(), /ACCESS_RESTRICTED/);
});

test('parser and transient failures do not become authorization claims', async () => {
  for (const status of [null, 200, 429, 500]) {
    const engine = new MyHomeEngine();
    await assert.rejects(engine.guard(async () => { throw new AcquisitionError('https://www.myhome.ge', status, 'failure'); }));
    await engine.ready(); assert.equal(engine.status().access, 'UNKNOWN');
  }
});

test('dictionary caching is bounded by endpoint/locale/TTL and never caches listings', async () => {
  let now = 0, requests = 0;
  const engine = new MyHomeEngine(() => now);
  const load = async () => ({ value: ++requests });
  const first = await engine.dictionary(endpoints.locations, 'en', load); first.value = 99;
  assert.deepEqual(await engine.dictionary(endpoints.locations, 'en', load), { value: 1 });
  assert.deepEqual(await engine.dictionary(endpoints.locations, 'ka', load), { value: 2 });
  now = 3_600_001;
  assert.deepEqual(await engine.dictionary(endpoints.locations, 'en', load), { value: 3 });
  await engine.dictionary(endpoints.list, 'ka', load); await engine.dictionary(endpoints.list, 'ka', load);
  assert.equal(requests, 5);
});

test('historical access evidence survives restart; only a newer deliberate clearance releases it', () => {
  const blocked = { created_at: '2026-10-09T11:20:34Z', errors: [{ code: 'ACCESS_DENIED' }] };
  assert.equal(myHomeRestricted(null, blocked), true);
  assert.equal(myHomeRestricted({ accessClearedAt: '2026-10-09T10:00:00Z' }, blocked), true);
  assert.equal(myHomeRestricted({ accessClearedAt: '2026-10-10T10:00:00Z' }, blocked), false);
  assert.equal(myHomeRestricted({ accessRestricted: true, accessClearedAt: '2026-10-10T10:00:00Z' }, blocked), true);
  assert.equal(myHomeRestricted({}, { ...blocked, errors: [{ code: 'PARSER_ERROR' }] }), false);
});

test('a HTTP200 challenge retains its real HTTP status and closes access; changed HTML does not', async () => {
  const engine = new MyHomeEngine();
  await assert.rejects(engine.guard(() => publicPage('https://www.myhome.ge/udzravi-qoneba/', async () => new Response('<html>cf_chl_ challenge-platform</html>'))),
    (error) => error.status === 200 && error.category === 'ACCESS_RESTRICTED');
  await assert.rejects(engine.ready(), /ACCESS_RESTRICTED/);
  await assert.rejects(publicPage('https://www.myhome.ge/udzravi-qoneba/', async () => new Response('<html>new layout</html>')),
    (error) => error.status === 200 && error.category === 'CONTRACT');
});

test('preserved successful Next detail fixture retains original identity, prices and photo provenance', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/myhome-public-next.json', import.meta.url), 'utf8'));
  const payload = parsePublicPage(`<script id="__NEXT_DATA__">${JSON.stringify(fixture.detail)}</script>`, fixture.detailUrl, '25610778');
  const raw = payload.data.statement;
  assert.equal(raw.id, 25610778); assert.equal(raw.price['2'].price_total, 165000);
  assert.equal(raw.area, 101); assert.ok(raw.uuid);
  assert.ok(raw.images.length > 1);
  assert.ok(raw.images.every((image) => image.large.startsWith('https://static-api-statements.tnet.ge/')));
  assert.ok(fixture.detailUrl.endsWith('-25610778/'));
});
