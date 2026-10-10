import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_COOLDOWN_MS, MyHomeEngine } from '../.tstest-build/marketplace/myhome/engine.js';
import { AcquisitionError, endpoints } from '../.tstest-build/marketplace/myhome/api.js';
import { readFileSync } from 'node:fs';
import { parsePublicPage, publicPage } from '../.tstest-build/marketplace/myhome/public-page.js';

const store = (decisions = [{ mode: 'LIVE', retryAt: null }]) => {
  const calls = { decide: [], restrict: [], recovered: 0 };
  return { calls, decide: async (purpose) => { calls.decide.push(purpose); return decisions.length > 1 ? decisions.shift() : decisions[0]; },
    restrict: async (evidence) => { calls.restrict.push(evidence); }, recovered: async () => { calls.recovered++; } };
};

test('a refusal records a durable cooldown once and blocks this process only for a bounded time', async () => {
  let now = 0, requests = 0;
  const s = store();
  const engine = new MyHomeEngine(() => now); engine.configure(s);
  assert.equal((await engine.ready()).mode, 'LIVE');
  await assert.rejects(engine.guard(async () => { requests++; throw new AcquisitionError('https://www.myhome.ge', 403, 'HTTP 403; CHALLENGE_REQUIRED'); }), /CHALLENGE_REQUIRED/);
  assert.equal(s.calls.restrict.length, 1); assert.match(s.calls.restrict[0], /403/);
  await assert.rejects(engine.guard(async () => { requests++; }), /request not sent/);
  const local = await engine.ready();
  assert.equal(local.mode, 'CACHE_ONLY'); assert.equal(local.retryAt, new Date(LOCAL_COOLDOWN_MS).toISOString());
  assert.deepEqual(s.calls.decide, ['run'], 'the local latch answers without asking ingress');
  now = LOCAL_COOLDOWN_MS + 1;
  assert.equal((await engine.ready()).mode, 'LIVE', 'the latch expires; the durable state decides again');
  assert.equal(requests, 1, 'never retried, rotated or escalated');
});

test('an unreadable access state rejects (transient for the run) and a failed cooldown write keeps the local latch', async () => {
  const engine = new MyHomeEngine();
  engine.configure({ decide: async () => { throw Error('store unavailable'); }, restrict: async () => { throw Error('write unavailable'); }, recovered: async () => {} });
  await assert.rejects(engine.ready(), /store unavailable/);
  await assert.rejects(engine.guard(async () => { throw new AcquisitionError('https://www.myhome.ge', 401, 'HTTP 401'); }), /HTTP 401/);
  assert.equal((await engine.ready()).mode, 'CACHE_ONLY');
});

test('parser and transient failures never cool MyHome down', async () => {
  for (const status of [null, 200, 429, 500, 503]) {
    const s = store();
    const engine = new MyHomeEngine(); engine.configure(s);
    await assert.rejects(engine.guard(async () => { throw new AcquisitionError('https://www.myhome.ge', status, 'failure'); }));
    assert.equal((await engine.ready()).mode, 'LIVE'); assert.equal(s.calls.restrict.length, 0);
    assert.equal(engine.status().access, 'UNKNOWN');
  }
});

test('the startup check asks without spending the probe', async () => {
  const s = store([{ mode: 'CACHE_ONLY', retryAt: null }]);
  const engine = new MyHomeEngine(); engine.configure(s);
  await engine.ready('startup');
  assert.deepEqual(s.calls.decide, ['startup']);
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

test('a HTTP200 challenge retains its real HTTP status and closes access; changed HTML does not', async () => {
  const engine = new MyHomeEngine();
  await assert.rejects(engine.guard(() => publicPage('https://www.myhome.ge/udzravi-qoneba/', async () => new Response('<html>cf_chl_ challenge-platform</html>'))),
    (error) => error.status === 200 && error.category === 'ACCESS_RESTRICTED');
  assert.equal((await engine.ready()).mode, 'CACHE_ONLY');
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
