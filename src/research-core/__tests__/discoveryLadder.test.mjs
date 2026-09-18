// Free first, expensive last, honest when neither.
//
// Discovery has a cost gradient spanning four orders of magnitude: a cached
// document costs nothing, a database query costs a query, a public fetch
// costs a request, a browser costs seconds of CPU and a container. A pipeline
// that starts at the expensive end pays the maximum every time.
//
// And there is no paid-provider rung. Homatch's discovery is Homatch's code:
// the previous discovery function was built entirely on DataForSEO and Apify,
// which is exactly why it now has no capability at all. The last test in this
// file reads every source file in the core and fails if either name appears.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { climbLadder, LADDER } from '../discovery/ladder.ts';
import { AdapterRegistry } from '../discovery/adapter.ts';
import { planQueries } from '../discovery/query-plan.ts';
import { CachedFetcher } from '../fetch/cached-fetcher.ts';
import { HttpClient } from '../fetch/http-client.ts';
import { MockTransport } from '../fetch/mock-transport.ts';
import { RateLimiter } from '../flow/rate-limiter.ts';
import { CircuitBreakerRegistry } from '../flow/circuit-breaker.ts';
import { permissiveNetworkPolicy } from '../net/network-policy.ts';
import { SourceAccessPolicyRegistry, DEFAULT_SOURCE_POLICY } from '../net/source-policy.ts';

const NOW = Date.parse('2026-09-18T12:00:00.000Z');

const source = (over = {}) => ({
  id: over.id ?? 'src1',
  platform: over.platform ?? 'FACEBOOK',
  sourceType: 'FACEBOOK_GROUP',
  canonicalUrl: over.canonicalUrl ?? 'https://www.facebook.com/groups/g1/',
  externalId: null,
  name: 'A Group',
  countryCode: 'GE',
  city: 'Tbilisi',
  region: null,
  languages: ['ka', 'ru', 'en'],
  compatibleProfiles: [],
  propertyTerms: [],
  accessState: over.accessState ?? 'PUBLIC',
  active: true,
  discoveredAt: new Date(NOW - 86_400_000).toISOString(),
  lastScanAt: over.lastScanAt ?? null,
  lastSuccessAt: null,
  cursor: over.cursor ?? null,
  chronological: false,
  failureCount: 0,
  lastFailureReason: null,
  productivity: over.productivity ?? [],
});

const signal = (id, text = 'Looking to buy a 2BR in Vake, budget 150000 USD') => ({
  id,
  platform: 'FACEBOOK',
  contentType: 'POST',
  sourceUrl: 'https://www.facebook.com/groups/g1/',
  contentUrl: `https://www.facebook.com/groups/g1/posts/${id}`,
  parentUrl: null,
  parentExcerpt: null,
  author: { publicName: null, publicUrl: null },
  originalText: text,
  translatedText: null,
  language: 'en',
  publishedAt: '2026-09-17T10:00:00.000Z',
  discoveredAt: new Date(NOW).toISOString(),
  lastSeenAt: new Date(NOW).toISOString(),
  contentFingerprint: `fp-${id}`,
  direction: 'DEMAND',
  directionConfidence: 0.7,
  locationHints: { countryCode: null, city: null, district: null, mentions: [] },
  requirementHints: { bedrooms: null, areaSqm: null, budgetAmount: null, budgetCurrency: null },
  accessClass: 'PUBLIC',
});

function stubAdapter(behaviour = {}) {
  return {
    id: behaviour.id ?? 'stub',
    platform: 'FACEBOOK',
    capabilities: behaviour.capabilities ?? ['discover', 'fetch', 'extract', 'scanIncremental'],
    handles: () => true,
    canonicalize: (url) => url,
    async discover() {
      return behaviour.discover ?? { ok: true, value: [] };
    },
    async scan(request) {
      if (behaviour.scan) return behaviour.scan(request);
      return {
        ok: true,
        value: {
          signals: [signal(`${behaviour.id ?? 'stub'}-1`)],
          cursor: '2026-09-17T10:00:00.000Z',
          truncated: false,
          discovered: [],
        },
      };
    },
  };
}

const baseInput = (over = {}) => ({
  profileId: 'BUYER_SEARCH',
  direction: 'DEMAND',
  countryCode: 'GE',
  city: 'Tbilisi',
  languages: ['ka', 'ru', 'en'],
  queries: [],
  knownSources: [],
  adapters: new AdapterRegistry(),
  context: { async fetchDocument() { throw new Error('not used'); }, authenticatedSession: false, now: () => NOW },
  targetSignals: 10,
  maxSources: 5,
  includeComments: true,
  now: () => NOW,
  ...over,
});

const rung = (result, name) => result.rungs.find((r) => r.rung === name);

/* ── Order and honesty ────────────────────────────────────────────────── */

test('the ladder is cheapest-first and ends in an honest UNAVAILABLE', () => {
  assert.deepEqual([...LADDER], [
    'CACHE', 'FIRST_PARTY', 'KNOWN_SOURCES', 'PUBLIC_WEB', 'BROWSER', 'UNAVAILABLE',
  ]);
});

test('with nothing anywhere, the result is UNAVAILABLE rather than an empty success', async () => {
  const result = await climbLadder(baseInput());
  assert.equal(result.unavailable, true);
  assert.ok(rung(result, 'UNAVAILABLE'), 'the run did not record that it found nothing');
});

test('every rung is recorded, including the ones that were skipped and why', async () => {
  const result = await climbLadder(baseInput());
  const cache = rung(result, 'CACHE');
  assert.equal(cache.attempted, false);
  assert.match(cache.skippedReason, /cached fetcher/);

  const firstParty = rung(result, 'FIRST_PARTY');
  assert.match(firstParty.skippedReason, /no first-party port/);
});

test('Homatch\'s own data is consulted before the public web', async () => {
  const order = [];
  const result = await climbLadder(baseInput({
    firstParty: {
      async collect() {
        order.push('first-party');
        return [signal('own-1')];
      },
    },
    knownSources: [source()],
    adapters: new AdapterRegistry().register(
      stubAdapter({
        id: 'fb',
        scan: async () => { order.push('known-source'); return { ok: true, value: { signals: [signal('fb-1')], cursor: null, truncated: false, discovered: [] } }; },
      }),
    ),
    targetSignals: 2,
  }));

  assert.deepEqual(order, ['first-party', 'known-source']);
  assert.equal(result.signals.length, 2);
});

test('the climb stops as soon as the job has what it asked for', async () => {
  let scans = 0;
  const result = await climbLadder(baseInput({
    firstParty: { async collect() { return [signal('a'), signal('b'), signal('c')]; } },
    knownSources: [source()],
    adapters: new AdapterRegistry().register(
      stubAdapter({ id: 'fb', scan: async () => { scans += 1; return { ok: true, value: { signals: [], cursor: null, truncated: false, discovered: [] } }; } }),
    ),
    targetSignals: 3,
  }));

  assert.equal(scans, 0, 'a source was scanned after the target was already met');
  assert.equal(result.signals.length, 3);
});

/* ── One source failing is not the job failing ────────────────────────── */

test('a login wall on one source leaves the others and the run intact', async () => {
  const result = await climbLadder(baseInput({
    knownSources: [source({ id: 'walled' }), source({ id: 'open', canonicalUrl: 'https://www.facebook.com/groups/g2/' })],
    adapters: new AdapterRegistry().register(
      stubAdapter({
        id: 'fb',
        scan: async (request) =>
          request.source.id === 'walled'
            ? { ok: false, reason: 'LOGIN_WALL' }
            : { ok: true, value: { signals: [signal('good-1')], cursor: null, truncated: false, discovered: [] } },
      }),
    ),
  }));

  assert.equal(result.signals.length, 1, 'a failing source poisoned the whole run');
  const known = rung(result, 'KNOWN_SOURCES');
  assert.equal(known.failures.find((f) => f.sourceId === 'walled').reason, 'LOGIN_WALL');
});

test('a browser adapter failure is a PARTIAL result, not a poisoned one', async () => {
  const result = await climbLadder(baseInput({
    knownSources: [source({ id: 'needs-browser' }), source({ id: 'plain', canonicalUrl: 'https://www.facebook.com/groups/g2/' })],
    adapters: new AdapterRegistry().register(
      stubAdapter({
        id: 'fb',
        scan: async (request) =>
          request.source.id === 'needs-browser'
            ? { ok: false, reason: 'BROWSER_UNAVAILABLE' }
            : { ok: true, value: { signals: [signal('plain-1')], cursor: null, truncated: false, discovered: [] } },
      }),
    ),
  }));

  assert.equal(result.unavailable, false);
  assert.equal(result.signals.length, 1);
  assert.equal(
    rung(result, 'KNOWN_SOURCES').failures.find((f) => f.sourceId === 'needs-browser').reason,
    'BROWSER_UNAVAILABLE',
  );
});

test('a source with no adapter is recorded rather than silently skipped', async () => {
  const result = await climbLadder(baseInput({
    knownSources: [source({ id: 'orphan', platform: 'TELEGRAM', canonicalUrl: 'https://t.me/x' })],
  }));
  assert.equal(rung(result, 'KNOWN_SOURCES').failures[0].reason, 'NO_ADAPTER');
});

/* ── Incremental ──────────────────────────────────────────────────────── */

test('the stored cursor is passed to the adapter, so a re-scan reads only what is new', async () => {
  let seen = 'unset';
  await climbLadder(baseInput({
    knownSources: [source({ cursor: '2026-09-10T00:00:00.000Z' })],
    adapters: new AdapterRegistry().register(
      stubAdapter({ id: 'fb', scan: async (request) => { seen = request.cursor; return { ok: true, value: { signals: [], cursor: null, truncated: false, discovered: [] } }; } }),
    ),
  }));
  assert.equal(seen, '2026-09-10T00:00:00.000Z');
});

test('a source scanned moments ago is not re-scanned', async () => {
  const result = await climbLadder(baseInput({
    knownSources: [source({ lastScanAt: new Date(NOW - 60_000).toISOString() })],
    adapters: new AdapterRegistry().register(stubAdapter({ id: 'fb' })),
    minRescanIntervalMs: 3_600_000,
  }));
  assert.equal(rung(result, 'KNOWN_SOURCES').failures[0].reason, 'SCANNED_RECENTLY');
  assert.equal(result.signals.length, 0);
});

test('the browser rung is off unless the run asked for it, and says which', async () => {
  const off = await climbLadder(baseInput());
  assert.match(rung(off, 'BROWSER').skippedReason, /not requested/);

  const wanted = await climbLadder(baseInput({ allowBrowser: true }));
  assert.match(rung(wanted, 'BROWSER').skippedReason, /no browser capability available/);
});

/* ── Coalescing still works across concurrent jobs ────────────────────── */

test('two concurrent jobs asking for the same page produce one fetch', async () => {
  // The shared cached fetcher sits under every rung, so a buyer search and a
  // property search running at the same moment share the request rather than
  // each paying for it.
  const transport = new MockTransport([{ match: /portal\.test/, body: '<html>ok</html>', delayMs: 5 }]);
  const policies = new SourceAccessPolicyRegistry([
    {
      ...DEFAULT_SOURCE_POLICY,
      id: 'portal',
      domains: ['portal.test'],
      sourceFamily: 'portal.test',
      kind: 'PROPERTY_PORTAL',
      robots: 'NOT_APPLICABLE',
      rate: { concurrency: 8, requestsPerSecond: 1000, burst: 1000 },
    },
  ]);
  const rows = new Map();
  const fetcher = new CachedFetcher({
    httpClient: new HttpClient({
      transport,
      rateLimiter: new RateLimiter({ defaultPolicy: { concurrency: 8, requestsPerSecond: 1000, burst: 1000 } }),
      breakers: new CircuitBreakerRegistry(),
      networkPolicy: permissiveNetworkPolicy(),
      sourcePolicies: policies,
      requirePinningTransport: false,
    }),
    policies,
    store: {
      async get(fp) { return rows.get(fp) ?? null; },
      async put(doc) { rows.set(doc.fingerprint, doc); },
      async touch() {},
    },
  });

  const context = { visibilityScope: 'PUBLIC_GLOBAL' };
  const url = 'https://portal.test/listing/1';

  const buyerJob = Promise.all(
    Array.from({ length: 10 }, () => fetcher.fetch(url, { context })),
  );
  const propertyJob = Promise.all(
    Array.from({ length: 10 }, () => fetcher.fetch(url, { context })),
  );
  await Promise.all([buyerJob, propertyJob]);

  assert.equal(transport.callsFor(url), 1, 'two concurrent jobs each paid for the same page');
});

/* ── No paid provider, anywhere ───────────────────────────────────────── */

function coreFiles(dir = join(process.cwd(), 'src/research-core'), out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') coreFiles(full, out);
    } else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Source with comments stripped: the rule is about code, not about prose. */
const codeOf = (file) =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

test('no Research Core CODE reaches for Apify or DataForSEO', () => {
  // Not as an adapter, not as a fallback, not as a configuration flag, not as
  // an import and not as a URL. The old discovery function was built entirely
  // on them, which is why it has no capability today.
  //
  // Comments are excluded deliberately: two files explain at length that
  // these vendors are treated as non-existent, and a test that could not tell
  // an explanation from a dependency would force those explanations to be
  // deleted — losing the reasoning that keeps the rule alive.
  for (const file of coreFiles()) {
    const code = codeOf(file);
    for (const vendor of [/apify/i, /dataforseo/i, /data_for_seo/i]) {
      assert.ok(!vendor.test(code), `${file.split('research-core')[1]} uses ${vendor}`);
    }
  }
});

test('the ladder states in writing that there is no paid-provider rung', () => {
  // The counterpart to the test above: the rule has to be findable by the
  // next person, not only enforced.
  const ladder = readFileSync(join(process.cwd(), 'src/research-core/discovery/ladder.ts'), 'utf8');
  assert.match(ladder, /THERE IS NO PAID-PROVIDER RUNG/);
  assert.match(ladder, /treated as non-existent/);
});

test('no TODO in the core defers work to a vendor', () => {
  for (const file of coreFiles()) {
    const source = readFileSync(file, 'utf8');
    const todos = source.match(/(TODO|FIXME)[^\n]*/gi) ?? [];
    for (const todo of todos) {
      assert.ok(!/apify|dataforseo|serp api|scraper api/i.test(todo), `${file}: ${todo}`);
    }
  }
});

test('nothing in the core generates evidence with a model', () => {
  // AI may widen a query plan. It is never the crawler, never the source of
  // truth and never the final evidence filter — so no core file calls one.
  for (const file of coreFiles()) {
    const source = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    for (const pattern of [/openai/i, /anthropic/i, /chat\/completions/i, /gpt-[0-9]/i, /\bllm\b/i]) {
      assert.ok(!pattern.test(source), `${file.split('research-core')[1]} matches ${pattern}`);
    }
  }
});

test('the planner produces queries our own code can act on, with no vendor syntax', () => {
  const plan = planQueries(
    { countryCode: 'GE', city: 'Tbilisi', propertyTerms: ['apartment'], transaction: 'SALE' },
    'DEMAND',
    { maxQueries: 20 },
  );
  for (const query of plan.queries) {
    // `site:` operators are a search-vendor idiom; the old function built its
    // whole plan out of them and could do nothing without one.
    assert.ok(!/\bsite:/i.test(query.text), `vendor search syntax in "${query.text}"`);
  }
});
