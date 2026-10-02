// discoveryBrowserRender.test.mjs — the DISCOVERY browser (PHASE 2), not Verify's.
// Proven with a real Chromium where one is installed: off by default, allowlist
// only, every byte the page loads comes through the injected pinned fetcher
// (Chromium opens no connection of its own), images/fonts refused, scripts
// stripped from the output while JSON data blocks survive, challenge and login
// walls reported and never worked around, navigation and concurrency bounded,
// and the route is token-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import express from 'express';
import {
  renderPage, RenderError, sanitizeMarkup, hostAllowed, browserRenderConfig, DISCOVERY_BROWSER_UA,
} from '../.tstest-build/discovery/BrowserRender.js';
import { mountDiscoveryRoutes } from '../.tstest-build/discovery/routes.js';

/* The bundled Chromium, or the sandbox's preinstalled one when the bundled
   revision is absent (a dev box); null when neither exists and the real-render
   tests skip. */
async function chromiumLauncher() {
  try {
    const { chromium } = await import('playwright');
    const bundled = chromium.executablePath();
    const executablePath = existsSync(bundled) ? bundled : ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find(existsSync);
    if (!executablePath) return null;
    return () => chromium.launch({ headless: true, executablePath, args: ['--disable-dev-shm-usage', '--no-first-run'] });
  } catch {
    return null;
  }
}

const ON = { enabled: true, hosts: ['listing.example'], concurrency: 1 };

const LISTING = `<!doctype html><html><head><title>Flat</title>
<script type="application/ld+json">{"@type":"RealEstateListing","name":"2-room flat"}</script>
<script id="__NEXT_DATA__" type="application/json">{"props":{"id":20592132}}</script>
<script>fetch('/api/price').then(r => r.json()).then(d => { document.getElementById('p').textContent = d.price; });</script>
</head><body onload="x()"><h1>2-room flat</h1><div id="p">loading</div><img src="https://cdn.example/a.jpg">
<noscript>enable js</noscript></body></html>`;

function fakeWeb(pages) {
  const seen = [];
  const fetcher = async (request) => {
    seen.push(request.url);
    const page = pages[request.url];
    if (!page) return { url: request.url, status: 404, headers: { 'content-type': 'text/plain' }, body: 'nf', bytes: 2, truncated: false, durationMs: 1, remoteAddress: '8.8.8.8' };
    return { url: request.url, status: page.status ?? 200, headers: { 'content-type': page.type ?? 'text/html' }, body: page.body, bytes: page.body.length, truncated: false, durationMs: 1, remoteAddress: '8.8.8.8' };
  };
  return { fetcher, seen };
}

test('off by default, allowlist only, no credentials, http(s) only — before any browser starts', async () => {
  const launch = async () => { throw new Error('must not launch'); };
  assert.equal(browserRenderConfig({}).enabled, false);
  assert.deepEqual(browserRenderConfig({ DISCOVERY_BROWSER_ENABLED: 'true', DISCOVERY_BROWSER_HOSTS: 'www.myhome.ge, bad host,livo.ge' }).hosts, ['www.myhome.ge', 'livo.ge']);
  await assert.rejects(renderPage({ url: 'https://listing.example/' }, { config: { ...ON, enabled: false }, launch }), (e) => e.kind === 'DISABLED');
  await assert.rejects(renderPage({ url: 'https://evil.example/' }, { config: ON, launch }), (e) => e.kind === 'HOST_NOT_ALLOWED');
  await assert.rejects(renderPage({ url: 'file:///etc/passwd' }, { config: ON, launch }), (e) => e.kind === 'BAD_URL');
  await assert.rejects(renderPage({ url: 'https://u:p@listing.example/' }, { config: ON, launch }), (e) => e.kind === 'BAD_URL');
  assert.equal(hostAllowed('www.listing.example', ['listing.example']), true);
  assert.equal(hostAllowed('listing.example.evil.com', ['listing.example']), false);
});

test('sanitized output keeps ld+json and __NEXT_DATA__, drops executable scripts, handlers and noscript', () => {
  const out = sanitizeMarkup(LISTING);
  assert.match(out, /application\/ld\+json/);
  assert.match(out, /__NEXT_DATA__/);
  assert.doesNotMatch(out, /fetch\('\/api\/price'\)/);
  assert.doesNotMatch(out, /onload=/);
  assert.doesNotMatch(out, /<noscript/);
});

test('a real render: every request goes through the pinned fetcher, images refused, JS-built content returned', async (t) => {
  const launch = await chromiumLauncher();
  if (!launch) return t.skip('no Chromium on this machine');
  const { fetcher, seen } = fakeWeb({
    'https://listing.example/pr/20592132': { body: LISTING },
    'https://listing.example/api/price': { body: '{"price":"$185,000"}', type: 'application/json' },
  });
  const result = await renderPage({ url: 'https://listing.example/pr/20592132' }, { config: ON, fetcher, launch });
  assert.equal(result.status, 200);
  assert.match(result.html, /\$185,000/, 'content built by the page script is in the markup');
  assert.match(result.html, /RealEstateListing/);
  assert.doesNotMatch(result.html, /fetch\('\/api\/price'\)/);
  assert.deepEqual(seen.sort(), ['https://listing.example/api/price', 'https://listing.example/pr/20592132']);
  assert.ok(result.refusedRequests >= 1, 'the image was refused, not fetched');
  assert.ok(!seen.some((u) => u.includes('cdn.example')));
  assert.ok(result.renderMs > 0 && result.transferBytes > 0);
});

test('a challenge page and a redirect off the allowlist are reported, never worked around', async (t) => {
  const launch = await chromiumLauncher();
  if (!launch) return t.skip('no Chromium on this machine');
  const challenge = fakeWeb({ 'https://listing.example/': { status: 403, body: '<html><title>Just a moment...</title><div class="cf-chl">x</div></html>' } });
  await assert.rejects(renderPage({ url: 'https://listing.example/' }, { config: ON, fetcher: challenge.fetcher, launch }), (e) => e instanceof RenderError && e.kind === 'CHALLENGE');
  const login = fakeWeb({ 'https://listing.example/': { body: '<html><script>location.href="https://listing.example/login?next=/"</script></html>' }, 'https://listing.example/login?next=/': { body: '<html>sign in</html>' } });
  await assert.rejects(renderPage({ url: 'https://listing.example/' }, { config: ON, fetcher: login.fetcher, launch }), (e) => e.kind === 'LOGIN_WALL');
  const away = fakeWeb({ 'https://listing.example/': { body: '<html><script>location.href="https://elsewhere.example/"</script></html>' } });
  await assert.rejects(renderPage({ url: 'https://listing.example/' }, { config: ON, fetcher: away.fetcher, launch }));
  assert.ok(!away.seen.some((u) => u.includes('elsewhere.example')), 'the off-allowlist navigation never fetched');
});

test('concurrency is enforced', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const launch = async () => { await gate; throw new Error('stop'); };
  const first = renderPage({ url: 'https://listing.example/' }, { config: ON, launch }).catch((e) => e);
  await assert.rejects(renderPage({ url: 'https://listing.example/' }, { config: ON, launch }), (e) => e.kind === 'TOO_BUSY');
  release();
  assert.equal((await first).kind, 'BROWSER_UNAVAILABLE');
});

test('the render route is token-only and answers a typed refusal when the browser is off', async () => {
  const app = express();
  app.use(express.json());
  mountDiscoveryRoutes(app, { token: 'secret-token' });
  const server = http.createServer(app).listen(0);
  const { port } = server.address();
  try {
    const call = (auth) => fetch(`http://127.0.0.1:${port}/discovery/render`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify({ url: 'https://www.myhome.ge/' }),
    });
    assert.equal((await call(null)).status, 401);
    assert.equal((await call('Bearer user-jwt')).status, 401);
    const off = await (await call('Bearer secret-token')).json();
    assert.equal(off.ok, false);
    assert.equal(off.error.kind, 'DISABLED');
  } finally {
    server.close();
  }
});

test('the discovery browser shares no code with Verify and identifies itself honestly', () => {
  const src = readFileSync(new URL('../src/discovery/BrowserRender.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from '\.\.\/(browser|workflows|orchestrator|documents|index)/);
  assert.match(DISCOVERY_BROWSER_UA, /^HomatchResearch\//);
  assert.doesNotMatch(src, /stealth|navigator\.webdriver|captcha.*solv/i);
});
