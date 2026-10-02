// discoverySafeFetch.test.mjs — the worker's discovery hop (PHASE 2).
// Proven: only public unicast addresses, every DNS answer checked, no literal
// IPs, no odd ports or schemes, the connection pinned to the validated address
// (no second lookup), no redirect followed, the body capped, token-only route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import {
  isPublicAddress, resolveSafeTarget, safeFetch, sendPinned, SafeFetchError,
} from '../.tstest-build/discovery/SafeFetch.js';
import { mountDiscoveryRoutes } from '../.tstest-build/discovery/routes.js';

test('private, loopback, link-local, metadata, CGNAT, multicast and v6 local ranges are refused', () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1',
    '64:ff9b::a00:1', 'ff02::1']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['8.8.8.8', '185.12.34.56', '2a00:1450:4001::1']) assert.equal(isPublicAddress(ip), true, ip);
});

test('a name with ANY private answer is refused; literal IPs, odd ports and schemes never resolve', async () => {
  const mixed = async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.5', family: 4 }];
  await assert.rejects(resolveSafeTarget('https://portal.example/x', mixed), (e) => e instanceof SafeFetchError && e.kind === 'BLOCKED_ADDRESS');
  const pub = async () => [{ address: '8.8.8.8', family: 4 }];
  await assert.rejects(resolveSafeTarget('https://169.254.169.254/latest', pub), (e) => e.kind === 'BLOCKED_ADDRESS');
  await assert.rejects(resolveSafeTarget('https://portal.example:8443/', pub), (e) => e.kind === 'BLOCKED_PORT');
  await assert.rejects(resolveSafeTarget('file:///etc/passwd', pub), (e) => e.kind === 'BLOCKED_PROTOCOL');
  await assert.rejects(resolveSafeTarget('https://user:pw@portal.example/', pub), (e) => e.kind === 'BAD_URL');
  const ok = await resolveSafeTarget('https://portal.example/list?page=2', pub);
  assert.equal(ok.address, '8.8.8.8');
});

test('the real resolver refuses localhost', async () => {
  await assert.rejects(safeFetch({ url: 'http://localhost/' }), (e) => e instanceof SafeFetchError && e.kind === 'BLOCKED_ADDRESS');
});

test('the connection goes to the PINNED address, a redirect is returned not followed, and the body is capped', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: 'http://169.254.169.254/' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('x'.repeat(5000));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    /* The hostname does not exist anywhere; only the pin can reach the server. */
    const target = { url: new URL(`http://pinned-only.invalid:${port}/page`), address: '127.0.0.1', family: 4 };
    const res = await sendPinned(target, { url: target.url.toString(), maxBytes: 1000 });
    assert.equal(res.status, 200);
    assert.equal(res.remoteAddress, '127.0.0.1');
    assert.equal(res.truncated, true);
    assert.equal(res.bytes, 1000);
    assert.equal(res.body.length, 1000);
    const redirect = await sendPinned({ ...target, url: new URL(`http://pinned-only.invalid:${port}/redirect`) }, { url: '' });
    assert.equal(redirect.status, 302, 'the 3xx comes back to the caller, whose policy decides the next hop');
  } finally {
    server.close();
  }
});

test('the route is token-only and answers a typed refusal', async () => {
  const app = express();
  app.use(express.json());
  mountDiscoveryRoutes(app, { token: 'secret-token' });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const anonymous = await fetch(`${base}/discovery/fetch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"url":"https://example.com"}' });
    assert.equal(anonymous.status, 401);
    const blocked = await fetch(`${base}/discovery/fetch`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer secret-token' },
      body: JSON.stringify({ url: 'http://localhost:6379/' }),
    });
    const json = await blocked.json();
    assert.equal(json.ok, false);
    assert.equal(json.error.kind, 'BLOCKED_PORT');
  } finally {
    server.close();
  }
});
