// A hundred people ask about the same flat in the same second.
//
// Homatch's research_cache already stops the SECOND request from repeating the
// first. It does nothing about the hundred that arrive together, which is
// precisely when a subject is popular and precisely when the money is spent.
//
// Every assertion below is against a call log, not against a counter the code
// under test maintains — `MockTransport.callsFor(url)` counts hops that were
// actually issued, so "one fetch" means one fetch.

import test from 'node:test';
import assert from 'node:assert/strict';

import { HttpClient } from '../fetch/http-client.ts';
import { MockTransport } from '../fetch/mock-transport.ts';
import { CachedFetcher } from '../fetch/cached-fetcher.ts';
import { RateLimiter } from '../flow/rate-limiter.ts';
import { CircuitBreakerRegistry } from '../flow/circuit-breaker.ts';
import { permissiveNetworkPolicy } from '../net/network-policy.ts';
import { SourceAccessPolicyRegistry, DEFAULT_SOURCE_POLICY } from '../net/source-policy.ts';
import { documentFingerprint } from '../bridge/cache-key.ts';

const PUBLIC_CONTEXT = { visibilityScope: 'PUBLIC_GLOBAL' };

function portalPolicy(overrides = {}) {
  return {
    ...DEFAULT_SOURCE_POLICY,
    id: 'portal',
    domains: ['portal.test'],
    sourceFamily: 'portal.test',
    kind: 'PROPERTY_PORTAL',
    robots: 'NOT_APPLICABLE',
    rate: { concurrency: 8, requestsPerSecond: 1000, burst: 1000 },
    ...overrides,
  };
}

/** A DocumentStore over a Map, standing in for research_cache. */
function memoryStore() {
  const rows = new Map();
  const touches = [];
  return {
    rows,
    touches,
    async get(fingerprint) {
      return rows.get(fingerprint) ?? null;
    },
    async put(document) {
      rows.set(document.fingerprint, document);
    },
    async touch(fingerprint) {
      touches.push(fingerprint);
    },
  };
}

function harness({ policies = [portalPolicy()], store = memoryStore(), delayMs = 5, now } = {}) {
  const transport = new MockTransport(
    [{ match: /portal\.test/, body: '<html><title>Flat</title></html>', delayMs }],
    {},
  );
  const registry = new SourceAccessPolicyRegistry(policies);
  const httpClient = new HttpClient({
    transport,
    rateLimiter: new RateLimiter({ defaultPolicy: { concurrency: 8, requestsPerSecond: 1000, burst: 1000 } }),
    breakers: new CircuitBreakerRegistry(),
    networkPolicy: permissiveNetworkPolicy(),
    sourcePolicies: registry,
    requirePinningTransport: false,
  });
  const fetcher = new CachedFetcher({ httpClient, policies: registry, store, ...(now ? { now } : {}) });
  return { transport, fetcher, store, registry };
}

test('a hundred concurrent requests for one URL produce exactly one fetch', async () => {
  const { transport, fetcher } = harness();
  const url = 'https://portal.test/listing/1';

  const results = await Promise.all(
    Array.from({ length: 100 }, () => fetcher.fetch(url, { context: PUBLIC_CONTEXT })),
  );

  assert.equal(transport.callsFor(url), 1, 'more than one network call was issued');
  assert.equal(results.length, 100);
  for (const result of results) {
    assert.equal(result.document.body.includes('Flat'), true, 'a joiner got no document');
  }

  const coalesced = results.filter((r) => r.path === 'COALESCED');
  assert.equal(coalesced.length, 99, 'the joiners were not counted as coalesced');
});

test('a coalesced request reports no network call of its own', async () => {
  // If a joiner counted as a network request, the saving would be invisible in
  // exactly the ledger that exists to show it.
  const { fetcher } = harness();
  const url = 'https://portal.test/listing/2';

  const results = await Promise.all(
    Array.from({ length: 10 }, () => fetcher.fetch(url, { context: PUBLIC_CONTEXT })),
  );

  const network = results.reduce((sum, r) => sum + r.usage.networkRequests, 0);
  const joined = results.reduce((sum, r) => sum + r.usage.coalescedRequests, 0);
  assert.equal(network, 1);
  assert.equal(joined, 9);
});

test('a free public page is never counted as a billable request', async () => {
  // Billability is a fact about the provider, not about the request. A policy
  // with no providerCode has no registry row and costs nothing.
  const { fetcher } = harness();
  const result = await fetcher.fetch('https://portal.test/free', { context: PUBLIC_CONTEXT });
  assert.equal(result.usage.networkRequests >= 1, true);
  assert.equal(result.usage.billableRequests, 0);
});

test('a second request after the first completes is served from the cache', async () => {
  const { transport, fetcher } = harness();
  const url = 'https://portal.test/listing/3';

  const first = await fetcher.fetch(url, { context: PUBLIC_CONTEXT });
  const second = await fetcher.fetch(url, { context: PUBLIC_CONTEXT });

  assert.equal(transport.callsFor(url), 1);
  assert.equal(first.path, 'NETWORK');
  assert.ok(second.path.startsWith('CACHE'));
  assert.equal(second.usage.cacheHits, 1);
});

test('a forced refresh is not answered from the cache it is replacing', async () => {
  // The bug this exists for: an earlier design re-checked the cache inside the
  // coalesced worker, so a forced refresh joined the queue and was handed back
  // the stale copy it was trying to replace. A refresh button that refreshed
  // nothing.
  const { transport, fetcher } = harness();
  const url = 'https://portal.test/listing/4';

  await fetcher.fetch(url, { context: PUBLIC_CONTEXT });
  const refreshed = await fetcher.fetch(url, { context: PUBLIC_CONTEXT, forceRefresh: true });

  assert.equal(transport.callsFor(url), 2, 'the forced refresh did not reach the network');
  assert.equal(refreshed.path, 'NETWORK');
});

test('two tenants asking for the same PRIVATE page do not share a fetch or a cache entry', async () => {
  // Not a policy check that could be forgotten — the keys they build differ,
  // so a cross-tenant hit is arithmetically impossible.
  const store = memoryStore();
  const { transport, fetcher } = harness({
    policies: [portalPolicy({ visibility: 'PRIVATE' })],
    store,
  });
  const url = 'https://portal.test/private/5';

  const [a, b] = await Promise.all([
    fetcher.fetch(url, { context: { visibilityScope: 'TENANT_PRIVATE', tenantId: 'tenant-a' } }),
    fetcher.fetch(url, { context: { visibilityScope: 'TENANT_PRIVATE', tenantId: 'tenant-b' } }),
  ]);

  assert.equal(transport.callsFor(url), 2, 'two tenants shared one private fetch');
  assert.notEqual(a.document.fingerprint, b.document.fingerprint);
  assert.equal(store.rows.size, 2);
});

test('a PRIVATE source narrows a PUBLIC_GLOBAL request rather than trusting it', async () => {
  const a = documentFingerprint({
    url: 'https://portal.test/x',
    canonicalization: {},
    provider: 'portal',
    context: { visibilityScope: 'PUBLIC_GLOBAL', tenantId: 't1' },
    visibility: 'PRIVATE',
  });
  const b = documentFingerprint({
    url: 'https://portal.test/x',
    canonicalization: {},
    provider: 'portal',
    context: { visibilityScope: 'PUBLIC_GLOBAL', tenantId: 't2' },
    visibility: 'PRIVATE',
  });
  assert.notEqual(a, b, 'a private source was cached globally');
});

test('a stale-window hit is served immediately and refreshed exactly once behind it', async () => {
  const store = memoryStore();
  let clock = 1_000_000;
  const { transport, fetcher } = harness({
    policies: [portalPolicy({ cacheTtlMs: 1000, cacheStaleMs: 60_000 })],
    store,
    now: () => clock,
  });
  const url = 'https://portal.test/listing/6';

  await fetcher.fetch(url, { context: PUBLIC_CONTEXT });
  assert.equal(transport.callsFor(url), 1);

  // Past the TTL, inside the stale window.
  clock += 5000;

  const burst = await Promise.all(
    Array.from({ length: 20 }, () => fetcher.fetch(url, { context: PUBLIC_CONTEXT })),
  );
  for (const result of burst) {
    assert.equal(result.path, 'CACHE_AGING', 'a customer waited for a refresh');
    assert.equal(result.freshness, 'AGING');
  }

  // Let the background refresh settle.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(transport.callsFor(url), 2, 'twenty stale hits caused more than one refresh');
});

test('past the stale window the copy is not served at all', async () => {
  const store = memoryStore();
  let clock = 2_000_000;
  const { transport, fetcher } = harness({
    policies: [portalPolicy({ cacheTtlMs: 1000, cacheStaleMs: 1000 })],
    store,
    now: () => clock,
  });
  const url = 'https://portal.test/listing/7';

  await fetcher.fetch(url, { context: PUBLIC_CONTEXT });
  clock += 10_000;
  const result = await fetcher.fetch(url, { context: PUBLIC_CONTEXT });

  assert.equal(result.path, 'NETWORK');
  assert.equal(transport.callsFor(url), 2);
});

test('different URLs are not coalesced together', async () => {
  const { transport, fetcher } = harness();
  await Promise.all([
    fetcher.fetch('https://portal.test/a', { context: PUBLIC_CONTEXT }),
    fetcher.fetch('https://portal.test/b', { context: PUBLIC_CONTEXT }),
  ]);
  assert.equal(transport.callsFor('https://portal.test/a'), 1);
  assert.equal(transport.callsFor('https://portal.test/b'), 1);
});

test('a failed fetch is not cached as a success', async () => {
  const transport = new MockTransport([{ match: /portal\.test/, alwaysFail: true, failStatus: 500 }]);
  const registry = new SourceAccessPolicyRegistry([portalPolicy()]);
  const store = memoryStore();
  const fetcher = new CachedFetcher({
    httpClient: new HttpClient({
      transport,
      rateLimiter: new RateLimiter({ defaultPolicy: { concurrency: 4, requestsPerSecond: 1000, burst: 1000 } }),
      breakers: new CircuitBreakerRegistry(),
      networkPolicy: permissiveNetworkPolicy(),
      sourcePolicies: registry,
      requirePinningTransport: false,
      maxAttempts: 1,
    }),
    policies: registry,
    store,
  });

  await assert.rejects(() => fetcher.fetch('https://portal.test/broken', { context: PUBLIC_CONTEXT }));
  assert.equal(store.rows.size, 0, 'a 500 was written to the cache');
});
