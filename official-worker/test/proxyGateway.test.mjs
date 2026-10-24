// proxyGateway.test.mjs — the shared network layer (Verify at scale): routing per domain, sticky vs rotating
// sessions, exact byte metering per job and worker, and blocks that suspend traffic instead of rotating IPs.
// A local HTTP server stands in for the sites; a local CONNECT-less HTTP proxy stands in for the provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { parseProxyConfig, parseRoutes, routeFor, proxyCredentials, withTraffic, TrafficMeter, DomainBreaker, isBlock, browserProxyFor } from '../.tstest-build/net/proxyGateway.js';
import { RoutingDispatcher } from '../.tstest-build/net/routingDispatcher.js';
import { fetch as ufetch } from 'undici';

const env = (o) => ({ PROXY_ENABLED: '1', PROXY_HOST: 'gw.example.test', PROXY_PORT: '823', PROXY_USERNAME: 'acct', PROXY_PASSWORD: 'secret', PROXY_PROVIDER: 'dataimpulse',
  PROXY_STICKY_TEMPLATE: '{user}__cr.{country};sessid.{session}', PROXY_ROTATING_TEMPLATE: '{user}__cr.{country}', PROXY_COST_PER_GB_USD: '1', ...o });

test('config: off unless every credential is set; routes are suffix-matched; nothing is proxied by default', () => {
  assert.equal(parseProxyConfig({}).enabled, false);
  assert.equal(parseProxyConfig(env({ PROXY_PASSWORD: '' })).enabled, false);
  const cfg = parseProxyConfig(env({ PROXY_ROUTES: '{"ss.ge":{"mode":"proxy","session":"rotating"},"napr.gov.ge":"direct","bad host":"proxy"}' }));
  assert.equal(cfg.enabled, true);
  assert.deepEqual(Object.keys(cfg.routes).sort(), ['napr.gov.ge', 'ss.ge']);
  assert.equal(routeFor('home.ss.ge', cfg).route.mode, 'proxy');
  assert.equal(routeFor('www.napr.gov.ge', cfg).route.mode, 'direct');
  assert.equal(routeFor('myhome.ge', cfg), null, 'unlisted: direct');
  assert.deepEqual(parseRoutes('not json'), {});
});

test('credentials: sticky keeps one exit per job and site; rotating does not carry a session', () => {
  const cfg = parseProxyConfig(env());
  const sticky = proxyCredentials(cfg, { mode: 'proxy', session: 'sticky', blockAssets: true }, 'job-1:napr.gov.ge');
  assert.equal(sticky.username, 'acct__cr.ge;sessid.job1naprgovge');
  assert.equal(proxyCredentials(cfg, { mode: 'proxy', session: 'rotating', blockAssets: true }, 'x').username, 'acct__cr.ge');
  assert.equal(sticky.server, 'http://gw.example.test:823');
  assert.equal(browserProxyFor(parseProxyConfig(env({ PROXY_ROUTES: '{"ss.ge":"proxy"}' })), 'https://home.ss.ge/ka', 'J1').username, 'acct__cr.ge;sessid.J1ssge');
  assert.equal(browserProxyFor(parseProxyConfig(env()), 'https://myhome.ge', 'J1'), undefined);
});

test('a block opens the breaker after N in a row and suspends the domain; success resets the count', () => {
  let t = 0;
  const b = new DomainBreaker(3, 1000, () => t);
  b.onResult('ss.ge', true); b.onResult('ss.ge', true); b.onResult('ss.ge', false); b.onResult('ss.ge', true);
  assert.equal(b.isOpen('ss.ge'), false);
  b.onResult('ss.ge', true); b.onResult('ss.ge', true);
  assert.equal(b.isOpen('ss.ge'), true);
  t = 1001;
  assert.equal(b.isOpen('ss.ge'), false, 'the cooldown ends');
  assert.equal(isBlock(403), true);
  assert.equal(isBlock(429), true);
  assert.equal(isBlock(200, '<div class="g-recaptcha">'), true);
  assert.equal(isBlock(200, '<html>listings</html>'), false);
});

test('every request is metered per job, worker and domain, with exact bytes; a suspended domain is refused locally', async () => {
  let hits = 0;
  const body = 'x'.repeat(5000);
  const server = http.createServer((req, res) => { hits++; if (req.url === '/blocked') { res.writeHead(403); res.end('no'); return; } res.writeHead(200, { 'content-type': 'text/plain' }); res.end(body); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const cfg = parseProxyConfig({ PROXY_ROUTES: '{"localtest.me":"direct"}', PROXY_BREAKER_BLOCKS: '2' });
  const d = new RoutingDispatcher(cfg, new TrafficMeter(cfg), new DomainBreaker(2, 60_000));
  // 127.0.0.1 has no routed domain; route the breaker by hand through a listed name.
  await withTraffic({ jobId: 'J1', worker: 'verify' }, () => ufetch(`http://127.0.0.1:${port}/ok`, { dispatcher: d }).then((r) => r.text()));
  await withTraffic({ jobId: 'J1', worker: 'verify' }, () => ufetch(`http://127.0.0.1:${port}/ok`, { dispatcher: d, method: 'POST', body: 'abc' }).then((r) => r.text()));
  await withTraffic({ jobId: null, worker: 'ssge' }, () => ufetch(`http://127.0.0.1:${port}/ok`, { dispatcher: d }).then((r) => r.text()));
  const rows = d.meter.drain();
  const verify = rows.find((r) => r.jobId === 'J1');
  assert.equal(verify.requests, 2);
  assert.equal(verify.via, 'direct');
  assert.ok(verify.bytesDown >= 2 * 5000 && verify.bytesDown < 2 * 5000 + 1000, `bytesDown ${verify.bytesDown}`);
  assert.ok(verify.bytesUp >= 3, 'the POST body is counted');
  assert.equal(rows.find((r) => r.worker === 'ssge').requests, 1);
  assert.equal(d.meter.size(), 0, 'drained');

  // Breaker on a routed domain: two blocks suspend it; the third call never leaves the worker.
  d.breaker.onResult('localtest.me', true); d.breaker.onResult('localtest.me', true);
  const before = hits;
  await assert.rejects(ufetch(`http://localtest.me:${port}/x`, { dispatcher: d }), /SOURCE_SUSPENDED|fetch failed/);
  assert.equal(hits, before, 'no request was sent while suspended');
  await d.close();
  server.close();
});

test('wiring: the layer is installed only when asked; browser tasks get proxy, asset blocking and metering; usage is flushed', async () => {
  const { readFileSync } = await import('node:fs');
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(index, /const network = installNetworkLayer\(proxyConfig\);/);
  assert.match(index, /startVerifyQueue\(\{ orchestrator, launchJobBrowser, closeJobBrowser, beforeShutdown, browserNet: browserNetFor \}\)/);
  assert.match(index, /gateway\.call\('proxy_usage', \{ rows: rows\.slice\(0, 500\)/);
  const rd = readFileSync(new URL('../src/net/routingDispatcher.ts', import.meta.url), 'utf8');
  assert.match(rd, /if \(!cfg\.enabled && !\/\^\(1\|true\|on\)\$\/i\.test\(String\(env\.PROXY_METERING/);
  const ex = readFileSync(new URL('../src/queue/executor.ts', import.meta.url), 'utf8');
  assert.match(ex, /withTraffic\(\{ jobId: task\.jobId \?\? null, worker: 'verify' \}/);
  const br = readFileSync(new URL('../src/browser/LocalBrowserRuntime.ts', import.meta.url), 'utf8');
  assert.match(br, /\.\.\.\(net\.proxy \? \{ proxy: net\.proxy \} : \{\}\)/);
  assert.match(br, /BLOCKABLE_RESOURCE_TYPES\.has\(req\.resourceType\(\)\)/);
  const q = readFileSync(new URL('../../supabase/functions/verify-queue/index.ts', import.meta.url), 'utf8');
  assert.ok(q.includes("case 'proxy_usage'"));
  const { installNetworkLayer } = await import('../.tstest-build/net/routingDispatcher.js');
  assert.equal(installNetworkLayer(parseProxyConfig({}), {}), null, 'off by default: Node\'s own dispatcher stays');
});
