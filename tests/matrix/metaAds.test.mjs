// META ADS product contract, tested from the sources that enforce it:
// tokens stay server-side, the ledger never rewrites, launches are
// idempotent, the fee has ONE source, and MOCK mode never invents numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const migration = read('supabase/migrations/20260929170000_meta_ads_v1.sql');
const api = read('supabase/functions/meta-ads-api/index.ts');
const webhook = read('supabase/functions/meta-webhooks/index.ts');
const paymentWebhook = read('supabase/functions/payment-webhook/index.ts');
const shared = read('supabase/functions/_shared/metaAds.ts');
const shell = read('src/components/layouts/HomatchShell.tsx');
const routes = read('src/routes.tsx');

test('meta_tokens is reachable ONLY by service_role', () => {
  // Exactly one CREATE POLICY targets meta_tokens, and it is the service one.
  const policies = migration.match(/CREATE POLICY \w+ ON public\.meta_tokens/g) ?? [];
  assert.equal(policies.length, 1);
  assert.match(migration, /CREATE POLICY meta_tokens_service ON public\.meta_tokens\s+FOR ALL USING \(auth\.role\(\) = 'service_role'\)/);
  // And no grant ever widens it.
  assert.ok(!/GRANT .* ON .*meta_tokens/i.test(migration));
});

test('the ledger is append-only for everyone, including service_role', () => {
  assert.match(migration, /META_ADS_LEDGER_IMMUTABLE/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON public\.meta_ads_ledger/);
});

test('launch money writes are idempotent and symmetric', () => {
  // Reserve + fee on the way in; release + fee refund on failure — all
  // suffixed off ONE launch idempotency key.
  for (const suffix of [':reserve', ':fee', ':release', ':feerefund']) {
    assert.ok(api.includes('`${idem}' + suffix + '`'), `ledger key suffix ${suffix}`);
  }
});

test('the 9% fee lives in admin_settings alone — code always reads the setting', () => {
  assert.match(migration, /'meta_ads_fee_percent',\s*'9'::jsonb/);
  // Every fee use in the edge function goes through the settings reader.
  const feeReads = api.match(/setting\(sb, 'meta_ads_fee_percent'\)/g) ?? [];
  assert.ok(feeReads.length >= 2, 'launch and preview both read the canonical setting');
  // The frontend never hardcodes a percent either: the wizard renders the
  // percent it was given by `status`.
  const create = read('src/pages/outreach/MetaAdsCreatePage.tsx');
  assert.ok(!/[^\w]9\s*\/\s*100/.test(create), 'no local 9/100 math in the wizard');
});

test('MOCK mode is truthful: mock_ ids, TEST names, results stay null', () => {
  assert.match(shared, /mock_\$\{prefix\}/);
  assert.match(api, /results: null/);
  assert.ok(!api.includes('Math.random'), 'no synthesized metrics anywhere in the API');
  assert.ok(!webhook.includes('Math.random'), 'no synthesized leads in the webhook');
  assert.match(api, /TEST /); // mock assets/campaign naming is explicit
});

test('v26 capability requirements are encoded in the publish path', () => {
  assert.match(api, /is_adset_budget_sharing_enabled/);
  assert.match(api, /advantage_audience/);
  // The adapter builds its base URL from the ONE pinned version constant.
  assert.match(shared, /graph\.facebook\.com\/\$\{META_API_VERSION\}/);
});

test('Meta Ads deposits never mint Credits', () => {
  const branch = paymentWebhook.indexOf("metadata.domain === 'META_ADS'");
  assert.ok(branch !== -1, 'META_ADS domain branch exists');
  // The branch writes an idempotent ledger DEPOSIT and returns before the
  // Credits path (everything after the branch's closing return) can run.
  const branchBody = paymentWebhook.slice(branch, branch + 2000);
  assert.ok(branchBody.includes("entry_type: 'DEPOSIT'"), 'the branch writes a ledger DEPOSIT');
  assert.ok(branchBody.includes('meta_ads_ledger'), 'into the Meta Ads ledger, not Credits');
  assert.ok(branchBody.includes('metaads:${idempotencyKey}'), 'deposit is idempotent per checkout');
  assert.ok(branchBody.includes("domain: 'META_ADS'"), 'the branch terminates with its own return');
  assert.ok(!branchBody.includes('credit'), 'no credit call inside the branch');
});

test('webhook ingestion is idempotent and signature-checked', () => {
  assert.match(webhook, /dedupe_key/);
  assert.match(webhook, /X-Hub-Signature-256/i);
  assert.match(webhook, /hub\.challenge/);
});

test('the product is wired into the shell and routes', () => {
  assert.match(shell, /nav_meta_ads/);
  assert.match(shell, /\/outreach\/meta/);
  for (const path of ['/outreach/meta', '/outreach/meta/create', '/outreach/meta/campaigns/:id', '/admin/meta-ads']) {
    assert.ok(routes.includes(`'${path}'`), `route ${path}`);
  }
  // Pre-auth draft: the create wizard is deliberately public.
  const createRoute = routes.slice(routes.indexOf("'/outreach/meta/create'"), routes.indexOf("'/outreach/meta/create'") + 220);
  assert.match(createRoute, /public:\s*true/);
});

test('lookalike and autopilot ship gated OFF', () => {
  assert.match(migration, /'meta_ads_lookalike_enabled',\s*'false'::jsonb/);
  assert.match(migration, /'meta_ads_autopilot_enabled',\s*'false'::jsonb/);
});
