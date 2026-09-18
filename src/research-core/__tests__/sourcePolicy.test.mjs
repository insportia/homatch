// What we are allowed to do to a source, and who decides.
//
// The load-bearing assertion in this file is the last group: a policy that
// names a provider code can only ever be switched OFF by research_providers,
// never on. DataForSEO and Apify are deliberately locked right now — the
// dataforseo-search edge function answers 423 with paidLaunchesBlocked, and
// the seeded research_providers rows have APIFY at LOCKED and
// BRIGHTDATA/TGSTAT disabled. Nothing in this work unlocks them, and the
// hydration direction is what makes that structural rather than a promise.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  SourceAccessPolicyRegistry,
  DEFAULT_SOURCE_POLICY,
  SourceDisabledError,
} from '../net/source-policy.ts';

const policy = (over = {}) => ({
  ...DEFAULT_SOURCE_POLICY,
  id: over.id ?? 'p',
  domains: over.domains ?? ['portal.test'],
  sourceFamily: over.sourceFamily ?? 'portal.test',
  kind: over.kind ?? 'PROPERTY_PORTAL',
  ...over,
});

test('an exact host beats a registrable domain', () => {
  const registry = new SourceAccessPolicyRegistry([
    policy({ id: 'wide', domains: ['portal.test'] }),
    policy({ id: 'narrow', domains: [], hosts: ['api.portal.test'] }),
  ]);
  assert.equal(registry.resolve('https://api.portal.test/x').id, 'narrow');
  assert.equal(registry.resolve('https://www.portal.test/x').id, 'wide');
});

test('an unconfigured source gets the conservative default', () => {
  const registry = new SourceAccessPolicyRegistry();
  const resolved = registry.resolve('https://whoever.example/x');
  assert.equal(resolved.matched, false);
  assert.equal(resolved.robots, 'RESPECT');
  assert.equal(resolved.browserRenderingAllowed, false);
  assert.equal(resolved.visibility, 'PUBLIC');
  assert.deepEqual(resolved.allowedMethods, ['GET', 'HEAD']);
});

test('every unconfigured source shares one family, so independence is under-counted', () => {
  // Deliberately pessimistic. The alternative — a family derived from the
  // domain — would assert independence that nobody ever checked.
  const registry = new SourceAccessPolicyRegistry();
  assert.equal(registry.resolve('https://a.example/').sourceFamily, 'unknown');
  assert.equal(registry.resolve('https://b.example/').sourceFamily, 'unknown');
});

test('source family is a required field on every configured policy', () => {
  // Nothing in a URL reveals syndication, and a default would be a guess.
  const src = readFileSync(
    join(process.cwd(), 'src', 'research-core', 'net', 'source-policy.ts'),
    'utf8',
  );
  assert.match(src, /\n {2}sourceFamily: string;/, 'sourceFamily is optional');
});

test('a policy carrying no provider code is a free page with no registry row', () => {
  const registry = new SourceAccessPolicyRegistry([policy()]);
  assert.equal(registry.resolve('https://portal.test/x').providerCode, null);
});

/* ── research_providers hydration ─────────────────────────────────────── */

test('a kill switch in research_providers disables the source', () => {
  const registry = new SourceAccessPolicyRegistry([
    policy({ id: 'seo', domains: ['seo.test'], providerCode: 'DATAFORSEO', enabled: true }),
  ]);
  registry.hydrateFromProviderRows([
    { provider_code: 'DATAFORSEO', enabled: true, kill_switch: true },
  ]);
  assert.equal(registry.resolve('https://seo.test/x').enabled, false);
});

test('a disabled provider disables the source', () => {
  const registry = new SourceAccessPolicyRegistry([
    policy({ id: 'apify', domains: ['apify.test'], providerCode: 'APIFY', enabled: true }),
  ]);
  registry.hydrateFromProviderRows([
    { provider_code: 'APIFY', enabled: false, kill_switch: true },
  ]);
  assert.equal(registry.resolve('https://apify.test/x').enabled, false);
});

test('hydration can NEVER enable a source the code left disabled', () => {
  // The direction is the safety property. A row in a table an admin can edit
  // must not be able to widen what the code permits.
  const registry = new SourceAccessPolicyRegistry([
    policy({ id: 'off', domains: ['off.test'], providerCode: 'DATAFORSEO', enabled: false }),
  ]);
  registry.hydrateFromProviderRows([
    { provider_code: 'DATAFORSEO', enabled: true, kill_switch: false },
  ]);
  assert.equal(registry.resolve('https://off.test/x').enabled, false);
});

test('a provider with no row at all is treated as not permitted', () => {
  // "Not registered" is not a licence to call it.
  const registry = new SourceAccessPolicyRegistry([
    policy({ id: 'ghost', domains: ['ghost.test'], providerCode: 'TGSTAT', enabled: true }),
  ]);
  registry.hydrateFromProviderRows([]);
  assert.equal(registry.resolve('https://ghost.test/x').enabled, false);
});

test('hydration leaves free public sources alone', () => {
  const registry = new SourceAccessPolicyRegistry([policy({ id: 'free', domains: ['free.test'] })]);
  registry.hydrateFromProviderRows([{ provider_code: 'DATAFORSEO', enabled: false, kill_switch: true }]);
  assert.equal(registry.resolve('https://free.test/x').enabled, true);
});

test('a disabled source throws an error that names no URL in its message', () => {
  const error = new SourceDisabledError('portal', 'https://portal.test/a?token=secret');
  assert.ok(!error.message.includes('secret'));
  assert.equal(error.code, 'POLICY_DENIED');
  assert.equal(error.retryable, false);
});

/* ── The locked providers stay locked ─────────────────────────────────── */

test('this work does not unlock DataForSEO or public source monitoring', () => {
  const root = process.cwd();
  const dataforseo = readFileSync(
    join(root, 'supabase', 'functions', 'dataforseo-search', 'index.ts'),
    'utf8',
  );
  const monitor = readFileSync(
    join(root, 'supabase', 'functions', 'source-monitor-public', 'index.ts'),
    'utf8',
  );
  for (const [name, src] of [['dataforseo-search', dataforseo], ['source-monitor-public', monitor]]) {
    assert.match(src, /paidLaunchesBlocked/, `${name} no longer reports the lock`);
    assert.match(src, /423/, `${name} no longer answers 423`);
  }
});

test('the core declares no source policy for a locked paid provider', () => {
  // There is no seeded catalogue in this pass at all: a source catalogue is a
  // legal and commercial decision per source, and shipping one here would be
  // making it silently.
  const registry = new SourceAccessPolicyRegistry();
  assert.deepEqual(registry.all(), []);
});
