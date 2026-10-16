// RESEND — the health probe never sends an email, reads a sending-only key correctly,
// requires the sender domain to be verified, and proves the webhook secret against the
// same verifier email-webhook runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyKey, domainState, probeResend, summarize, webhookSecretState, RESEND_SENDER_DOMAIN,
} from '../resendProbe.ts';

const SECRET = `whsec_${Buffer.from('a-test-signing-secret-of-32-bytes!!').toString('base64')}`;

function fakeFetch(status, body, seen) {
  return async (url, init) => {
    seen?.push({ url: String(url), method: init?.method ?? 'GET' });
    return new Response(JSON.stringify(body), { status });
  };
}

test('a sending-only key is valid, not an error (the old probe reported it as ERROR)', () => {
  assert.deepEqual(classifyKey(401, { name: 'restricted_api_key', message: 'This API key is restricted to only send emails' }),
    { key: 'VALID_SENDING_ONLY', errorName: 'restricted_api_key' });
  assert.equal(classifyKey(200, { data: [] }).key, 'VALID_FULL_ACCESS');
  assert.equal(classifyKey(403, { name: 'invalid_api_key' }).key, 'INVALID');
  assert.equal(classifyKey(401, { name: 'missing_api_key' }).key, 'INVALID');
  assert.equal(classifyKey(503, null).key, 'UNREACHABLE', 'an outage is not a pass (the old probe said PASSED)');
});

test('the sender domain must be verified; a parent domain counts', () => {
  assert.deepEqual(domainState([{ name: 'auth.homatch.live', status: 'verified' }]), { domain: 'VERIFIED', status: 'verified' });
  assert.deepEqual(domainState([{ name: 'homatch.live', status: 'verified' }]), { domain: 'VERIFIED', status: 'verified' });
  assert.deepEqual(domainState([{ name: 'auth.homatch.live', status: 'pending' }]), { domain: 'NOT_VERIFIED', status: 'pending' });
  assert.deepEqual(domainState([{ name: 'reply.homatch.live', status: 'verified' }]), { domain: 'MISSING', status: null });
  assert.equal(RESEND_SENDER_DOMAIN, 'auth.homatch.live');
});

test('the webhook secret is proven with email-webhook\'s own verifier', async () => {
  assert.equal(await webhookSecretState(undefined), 'ABSENT');
  assert.equal(await webhookSecretState('  '), 'ABSENT');
  assert.equal(await webhookSecretState('not-a-resend-secret'), 'MALFORMED');
  assert.equal(await webhookSecretState('whsec_***not base64***'), 'MALFORMED');
  assert.equal(await webhookSecretState(SECRET), 'OK');
});

test('status: a working key without the webhook secret is not "passed"', () => {
  const base = { key: 'VALID_FULL_ACCESS', httpStatus: 200, errorName: null, domain: 'VERIFIED', domainStatus: 'verified', domains: [] };
  assert.deepEqual(summarize({ ...base, webhookSecret: 'OK' }), { status: 'REAL_TEST_PASSED', problem: null });
  assert.equal(summarize({ ...base, webhookSecret: 'ABSENT' }).status, 'CONFIGURED_UNVERIFIED');
  assert.match(summarize({ ...base, webhookSecret: 'ABSENT' }).problem, /RESEND_WEBHOOK_SECRET/);
  assert.equal(summarize({ ...base, domain: 'NOT_VERIFIED', domainStatus: 'pending', webhookSecret: 'OK' }).status, 'ERROR');
  assert.equal(summarize({ ...base, key: 'VALID_SENDING_ONLY', domain: 'UNKNOWN', webhookSecret: 'OK' }).status, 'REAL_TEST_PASSED');
  assert.equal(summarize({ ...base, key: 'INVALID', webhookSecret: 'OK' }).status, 'ERROR');
});

test('the probe makes exactly one GET to /domains and never POSTs (no email is sent)', async () => {
  const seen = [];
  const r = await probeResend('re_test', SECRET, fakeFetch(200, { data: [{ name: 'auth.homatch.live', status: 'verified', id: 'x', region: 'eu-west-1' }] }, seen));
  assert.deepEqual(seen, [{ url: 'https://api.resend.com/domains', method: 'GET' }]);
  assert.equal(r.status, 'REAL_TEST_PASSED');
  assert.deepEqual(r.domains, [{ name: 'auth.homatch.live', status: 'verified' }], 'names and statuses only');
  assert.ok(!JSON.stringify(r).includes('re_test') && !JSON.stringify(r).includes(SECRET), 'no secret value in the result');
  const restricted = await probeResend('re_test', undefined, fakeFetch(401, { name: 'restricted_api_key' }));
  assert.equal(restricted.key, 'VALID_SENDING_ONLY');
  assert.equal(restricted.status, 'CONFIGURED_UNVERIFIED');
  const down = await probeResend('re_test', SECRET, async () => { throw new Error('offline'); });
  assert.equal(down.status, 'ERROR');
});

test('provider-health-check uses the probe for RESEND and the old GET /emails test is gone', () => {
  const src = readFileSync(new URL('../../../provider-health-check/index.ts', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf("case 'RESEND'"), src.indexOf("case 'TWILIO'"));
  assert.match(block, /probeResend\(key, Deno\.env\.get\('RESEND_WEBHOOK_SECRET'\)\)/);
  assert.ok(!block.includes('api.resend.com/emails'), 'no request to the send endpoint');
});
