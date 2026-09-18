// The single outbound HTTP path.
//
// Everything that protects a source, and everything that protects Homatch from
// a source, lives in HttpClient rather than in adapters — so an adapter author
// cannot bypass it by accident. These tests are the proof that it is actually
// in the path and not merely available.

import test from 'node:test';
import assert from 'node:assert/strict';

import { HttpClient } from '../fetch/http-client.ts';
import { MockTransport } from '../fetch/mock-transport.ts';
import { RateLimiter } from '../flow/rate-limiter.ts';
import { CircuitBreakerRegistry } from '../flow/circuit-breaker.ts';
import { NetworkPolicy, StaticDnsResolver, permissiveNetworkPolicy } from '../net/network-policy.ts';
import { SourceAccessPolicyRegistry, DEFAULT_SOURCE_POLICY } from '../net/source-policy.ts';
import { RobotsChecker } from '../net/robots.ts';

const FAST = { concurrency: 8, requestsPerSecond: 1000, burst: 1000 };

const policy = (over = {}) => ({
  ...DEFAULT_SOURCE_POLICY,
  id: over.id ?? 'portal',
  domains: over.domains ?? ['portal.test'],
  sourceFamily: 'portal.test',
  kind: 'PROPERTY_PORTAL',
  robots: 'NOT_APPLICABLE',
  rate: FAST,
  ...over,
});

function client({ routes = [], policies = [policy()], networkPolicy, robots, ...rest } = {}) {
  const transport = new MockTransport(routes);
  const http = new HttpClient({
    transport,
    rateLimiter: new RateLimiter({ defaultPolicy: FAST }),
    breakers: new CircuitBreakerRegistry(),
    networkPolicy: networkPolicy ?? permissiveNetworkPolicy(),
    sourcePolicies: new SourceAccessPolicyRegistry(policies),
    requirePinningTransport: false,
    ...(robots ? { robots } : {}),
    ...rest,
  });
  return { transport, http };
}

test('a transport that cannot pin is refused unless explicitly allowed', () => {
  // Validating an address and then connecting by hostname leaves the DNS
  // rebinding window open, so the check is on by default and has to be turned
  // off deliberately.
  const nonPinning = new MockTransport([]);
  Object.defineProperty(nonPinning, 'pinsAddresses', { value: false });
  assert.throws(
    () =>
      new HttpClient({
        transport: nonPinning,
        rateLimiter: new RateLimiter({ defaultPolicy: FAST }),
        breakers: new CircuitBreakerRegistry(),
        networkPolicy: permissiveNetworkPolicy(),
      }),
    /pin/i,
  );
});

test('the requested, fetched, final and identity URLs are all reported separately', () => {
  // Conflating the fetch URL with the canonical one was a real bug:
  // canonicalization strips query parameters, which can change or destroy the
  // resource being requested.
  const { http } = client({
    routes: [{ match: /portal\.test/, body: 'ok' }],
    policies: [policy({ canonicalization: { stripWww: true, stripTracking: true } })],
  });
  return http
    .fetch('https://www.portal.test/listing?id=5&utm_source=x')
    .then((result) => {
      assert.match(result.fetchUrl, /id=5/, 'the fetch URL lost a real parameter');
      assert.match(result.canonicalIdentityUrl, /id=5/);
      assert.ok(!result.canonicalIdentityUrl.includes('utm_source'));
      assert.equal(result.requestedUrl.includes('www.'), true);
    });
});

test('every redirect hop is re-checked against the network policy', () => {
  // A redirect is attacker-controlled input and is the classic way past an
  // entry-point-only check.
  const networkPolicy = new NetworkPolicy({
    resolver: new StaticDnsResolver({
      'portal.test': ['93.184.216.34'],
      'evil.test': ['127.0.0.1'],
    }),
  });
  const { http } = client({
    routes: [
      { match: 'https://portal.test/start', redirectTo: 'https://evil.test/inside', status: 302 },
      { match: /evil\.test/, body: 'secrets' },
    ],
    policies: [policy(), policy({ id: 'evil', domains: ['evil.test'] })],
    networkPolicy,
  });

  return assert.rejects(
    () => http.fetch('https://portal.test/start'),
    (error) => {
      assert.equal(error.name, 'NetworkPolicyError');
      assert.equal(error.decision.reason, 'PRIVATE_ADDRESS');
      return true;
    },
  );
});

test('a redirect chain is followed and recorded', () => {
  const { http } = client({
    routes: [
      { match: 'https://portal.test/a', redirectTo: 'https://portal.test/b', status: 301 },
      { match: 'https://portal.test/b', redirectTo: 'https://portal.test/c', status: 302 },
      { match: 'https://portal.test/c', body: 'final' },
    ],
  });
  return http.fetch('https://portal.test/a').then((result) => {
    assert.equal(result.body, 'final');
    assert.equal(result.finalUrl, 'https://portal.test/c');
    assert.equal(result.redirectChain.length, 2);
    assert.equal(result.networkRequests, 3);
  });
});

test('a redirect loop ends the chain instead of being returned as a success', () => {
  // Returning the bare 3xx would hand the caller an empty body dressed up as
  // a document.
  const { http } = client({
    routes: [
      { match: 'https://portal.test/loop', redirectTo: 'https://portal.test/loop2', status: 302 },
      { match: 'https://portal.test/loop2', redirectTo: 'https://portal.test/loop', status: 302 },
    ],
  });
  return assert.rejects(() => http.fetch('https://portal.test/loop'), /HTTP 302/);
});

test('a cross-domain redirect is refused when the policy forbids it', () => {
  const { http } = client({
    routes: [
      { match: 'https://portal.test/out', redirectTo: 'https://elsewhere.test/x', status: 302 },
      { match: /elsewhere\.test/, body: 'no' },
    ],
    policies: [policy({ redirects: { follow: true, max: 5, allowCrossDomain: false } })],
  });
  return assert.rejects(() => http.fetch('https://portal.test/out'), /cross-domain/i);
});

test('a disabled source is refused before anything reaches the network', () => {
  const { transport, http } = client({ policies: [policy({ enabled: false })] });
  return assert.rejects(
    () => http.fetch('https://portal.test/x'),
    (error) => {
      assert.equal(error.name, 'SourceDisabledError');
      assert.equal(transport.totalCalls, 0, 'a disabled source was contacted');
      return true;
    },
  );
});

test('a method the policy does not allow is refused', () => {
  const { http } = client({ policies: [policy({ allowedMethods: ['GET'] })] });
  return assert.rejects(() => http.fetch('https://portal.test/x', { method: 'HEAD' }), /HEAD/);
});

test('robots.txt is fetched only AFTER the SSRF check, never before', () => {
  // Checking robots first would mean issuing a request to an unvalidated host
  // in order to decide whether we may issue a request to it.
  const networkPolicy = new NetworkPolicy({
    resolver: new StaticDnsResolver({ 'portal.test': ['127.0.0.1'] }),
  });
  let robotsFetches = 0;
  const robots = new RobotsChecker({
    fetcher: async () => {
      robotsFetches += 1;
      return { status: 200, body: 'User-agent: *\nAllow: /' };
    },
    userAgent: 'HomatchResearch',
  });
  const { http } = client({
    policies: [policy({ robots: 'RESPECT' })],
    networkPolicy,
    robots,
  });

  return assert.rejects(
    () => http.fetch('https://portal.test/x'),
    () => {
      assert.equal(robotsFetches, 0, 'robots.txt was fetched for an unvalidated host');
      return true;
    },
  );
});

test('a source configured RESPECT with no checker refuses rather than ignoring robots', () => {
  const { http } = client({ policies: [policy({ robots: 'RESPECT' })] });
  return assert.rejects(() => http.fetch('https://portal.test/x'), /robots/i);
});

test('a disallowed path is not fetched', () => {
  const robots = new RobotsChecker({
    fetcher: async () => ({ status: 200, body: 'User-agent: *\nDisallow: /private' }),
    userAgent: 'HomatchResearch',
  });
  const { transport, http } = client({
    routes: [{ match: /portal\.test/, body: 'x' }],
    policies: [policy({ robots: 'RESPECT' })],
    robots,
  });
  return assert.rejects(
    () => http.fetch('https://portal.test/private/thing'),
    (error) => {
      assert.match(error.name, /Robots/);
      assert.equal(transport.totalCalls, 0);
      return true;
    },
  );
});

test('a 429 is retried and its Retry-After respected; a 404 is not retried', () => {
  const { transport, http } = client({
    routes: [
      { match: 'https://portal.test/flaky', failFirst: 1, failStatus: 429, failHeaders: { 'retry-after': '0' }, body: 'recovered' },
      { match: 'https://portal.test/missing', status: 404 },
    ],
    maxAttempts: 3,
    backoff: { baseMs: 1 },
  });

  return http
    .fetch('https://portal.test/flaky')
    .then((result) => {
      assert.equal(result.body, 'recovered');
      assert.equal(transport.callsFor('https://portal.test/flaky'), 2);
      return assert.rejects(() => http.fetch('https://portal.test/missing'), /HTTP 404/);
    })
    .then(() => {
      // A missing page stays missing; retrying it is a loop with a cost.
      assert.equal(transport.callsFor('https://portal.test/missing'), 1);
    });
});

test('the byte cap stops a large response rather than buffering it', () => {
  const { http } = client({
    routes: [{ match: /portal\.test/, body: 'x'.repeat(10_000) }],
    policies: [policy({ maxResponseBytes: 100 })],
  });
  return http.fetch('https://portal.test/big').then((result) => {
    assert.equal(result.truncated, true);
    assert.ok(result.body.length <= 100);
  });
});

test('the content type is detected from the header and the body', () => {
  const { http } = client({
    routes: [
      { match: 'https://portal.test/j', headers: { 'content-type': 'application/json' }, body: '{"a":1}' },
    ],
  });
  return http.fetch('https://portal.test/j').then((result) => {
    assert.equal(result.contentType.mime, 'application/json');
    assert.equal(result.contentType.kind, 'JSON');
  });
});

test('the validated addresses actually contacted are reported for the audit trail', () => {
  const networkPolicy = new NetworkPolicy({
    resolver: new StaticDnsResolver({ 'portal.test': ['93.184.216.34'] }),
  });
  const { http } = client({
    routes: [{ match: /portal\.test/, body: 'ok' }],
    networkPolicy,
  });
  return http.fetch('https://portal.test/x').then((result) => {
    assert.deepEqual(result.contactedAddresses, ['93.184.216.34']);
    assert.equal(result.policyId, 'portal');
    assert.equal(result.sourceVisibility, 'PUBLIC');
  });
});
