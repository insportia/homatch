// ssgeProbe.test.mjs — the start-up probe classifies how SS.ge refused, without bypassing anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudflareRefusal, probeSsgePublicPage } from '../src/marketplace/ssge/probe.mjs';

test('Cloudflare challenge, firewall block and rate limit are told apart; other answers are not refusals', () => {
  assert.equal(cloudflareRefusal(403, { server: 'cloudflare', 'cf-mitigated': 'challenge' }), 'CHALLENGE');
  assert.equal(cloudflareRefusal(403, { server: 'cloudflare', 'cf-ray': 'x' }), 'FIREWALL_BLOCK');
  assert.equal(cloudflareRefusal(429, { server: 'cloudflare' }), 'RATE_LIMIT');
  assert.equal(cloudflareRefusal(403, { server: 'nginx' }), null);
  assert.equal(cloudflareRefusal(200, { server: 'cloudflare' }), null);
});

test('a 403 bootstrap is reported with its refusal kind and the egress address, and nothing is retried', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('ipify')) return Response.json({ ip: '203.0.113.7' });
    return new Response('blocked', { status: 403, headers: { server: 'cloudflare', 'cf-ray': 'abc' } });
  };
  const r = await probeSsgePublicPage({ fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.equal(r.refusal, 'FIREWALL_BLOCK');
  assert.equal(r.egressIp, '203.0.113.7');
  assert.equal(calls.filter((u) => u.includes('ss.ge')).length, 1, 'one bootstrap request, no retry');
});
