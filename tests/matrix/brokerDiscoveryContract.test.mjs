// BROKER DISCOVERY + BROKER PLATFORM — the contracts, read off the sources.
//
// These are source-level guards in the repo's matrix idiom: they parse the
// migration and the functions that implement the money-touching invariants,
// so a refactor that quietly drops "never charge the same user twice for the
// same broker" fails here before it reaches a wallet.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const migration = read('supabase/migrations/20260928500000_broker_discovery_library_and_platform.sql');
const supplyDiscovery = read('supabase/functions/supply-discovery/index.ts');
const findProperty = read('supabase/functions/find-property/index.ts');
const findPropertyPlan = read('supabase/functions/find-property-plan/index.ts');
const launchPanel = read('src/components/campaign/CampaignLaunchPanel.tsx');
const brokersPage = read('src/pages/BrokersPage.tsx');
const brokersService = read('src/services/brokers.ts');
const crmPage = read('src/pages/BrokerCrmPage.tsx');

/* ── The dedup contract lives in the database ─────────────────────────── */

test('user_broker_discoveries is unique per (user, broker) — the no-double-charge fact', () => {
  assert.match(migration, /unique \(user_id, broker_id\)/);
  assert.match(migration, /on conflict \(user_id, broker_id\) do nothing/);
});

test('only rows the insert created are charged, and the charge follows the atomic-unlock ledger idiom', () => {
  // The charge multiplies the unit by the count of NEW rows only.
  assert.match(migration, /v_unit \* array_length\(v_new, 1\)/);
  // Balance is read FOR UPDATE so concurrent sweeps serialize.
  assert.match(migration, /from public\.credit_accounts ca where ca\.user_id = p_user_id for update/);
  // The ledger row is typed, referenced, and appended — never edited.
  assert.match(migration, /'BROKER_DISCOVERY'::public\.ledger_type/);
  assert.ok(!/update public\.credit_ledger/i.test(migration), 'the ledger is append-only');
});

test('broker_discovery_deliver is service-role only and validates intent', () => {
  const fn = migration.slice(migration.indexOf('create or replace function public.broker_discovery_deliver'));
  assert.match(fn, /auth\.role\(\) <> 'service_role'/);
  assert.match(fn, /'SELL', 'RENT_OUT', 'BUY', 'RENT'/);
});

test('delivery cannot spend past the balance', () => {
  assert.match(migration, /coalesce\(array_length\(v_new, 1\), 0\) >= v_affordable/);
});

test('the private library is owner-read only, with no client write path', () => {
  assert.match(migration, /create policy ubd_owner_reads on public\.user_broker_discoveries\s+for select using \(user_id = public\.auth_user_id\(\)\)/);
  assert.ok(
    !/create policy \S+ on public\.user_broker_discoveries\s+for (insert|update|delete)/i.test(migration),
    'no insert/update/delete policies: the deliver function is the only writer',
  );
});

/* ── Discovered is still not registered ───────────────────────────────── */

test('the deliver path never writes into the paid directory', () => {
  const fn = migration.slice(
    migration.indexOf('create or replace function public.broker_discovery_deliver'),
    migration.indexOf('comment on function public.broker_discovery_deliver'),
  );
  assert.ok(!fn.includes('broker_directory_listings'), 'discovery cannot touch registrations');
});

test('the public directory view still requires ACTIVE and a current paid_until', () => {
  const view = migration.slice(
    migration.indexOf('create or replace view public.broker_directory_public'),
    migration.indexOf('grant select on public.broker_directory_public'),
  );
  assert.match(view, /status = 'ACTIVE'/);
  assert.match(view, /paid_until > now\(\)/);
});

test('the apply function still cannot be talked into a status, a paid_until or a broker link', () => {
  const fn = migration.slice(
    migration.indexOf('create or replace function public.broker_directory_apply'),
    migration.indexOf('comment on function public.broker_directory_apply'),
  );
  assert.ok(!fn.includes('p_status'), 'no status argument');
  assert.ok(!fn.includes('p_paid_until'), 'no paid_until argument');
  assert.ok(!fn.includes('p_broker_id'), 'no broker link argument');
  assert.match(fn, /'PENDING_REVIEW'/);
});

test('the Found-for-You card disallows the directory badge and shows the observed disclosure', () => {
  const card = brokersPage.slice(
    brokersPage.indexOf('function DiscoveredCard'),
    brokersPage.indexOf('* The page'),
  );
  assert.ok(card.includes('broker_disclosure_observed'));
  assert.ok(!card.includes('broker_disclosure_directory'), 'a discovered firm never wears the registered badge');
});

test('the private library is read through the auth-scoped RPC, not a table select', () => {
  assert.match(migration, /v_uid uuid := public\.auth_user_id\(\)/);
  assert.ok(brokersService.includes("rpc('list_my_discovered_brokers'"));
  assert.ok(!brokersService.includes("from('user_broker_discoveries')"));
});

/* ── Opt-in reaches execution, OFF spends nothing ─────────────────────── */

test('supply-discovery delivers only when the campaign opted in, with the owner intent', () => {
  assert.match(supplyDiscovery, /discover_brokers === true/);
  assert.match(supplyDiscovery, /'RENT' \? 'RENT_OUT' : 'SELL'/);
  assert.match(supplyDiscovery, /rpc\('broker_discovery_deliver'/);
});

test('find-property delivers only for opted-in subscriptions, with the seeker intent', () => {
  assert.match(findProperty, /discover_brokers === true/);
  assert.match(findProperty, /'RENT' : 'BUY'/);
});

test('the plan confirm stores the opt-in strictly — absence means OFF', () => {
  assert.match(findPropertyPlan, /discoverBrokers === true/);
});

/* ── No price in any component ────────────────────────────────────────── */

test('the campaign opt-in shows the catalogue price, never a hardcoded one', () => {
  assert.ok(launchPanel.includes('brokerDiscoveryPricing'));
  assert.ok(!/[0-9]+(\.[0-9]+)? ?(CR|credits)/i.test(launchPanel), 'no literal credit price in the panel');
});

/* ── Analytics honesty ────────────────────────────────────────────────── */

test('engagement events are click facts with hourly dedup, recorded only for public listings', () => {
  assert.match(migration, /unique \(listing_id, event_type, viewer_key, bucket\)/);
  assert.match(migration, /'PHONE_CLICK'/);
  const recorder = migration.slice(migration.indexOf('create or replace function public.record_broker_profile_event'));
  assert.match(recorder, /status = 'ACTIVE' and l\.paid_until is not null and l\.paid_until > now\(\)/);
  // The event vocabulary itself contains no completion claims: every allowed
  // name is a click, an impression or an open.
  const vocab = migration.match(/event_type in \(([^)]+)\)/)?.[1] ?? '';
  assert.ok(vocab.length > 0, 'the event_type constraint exists');
  for (const name of vocab.match(/'[A-Z_]+'/g) ?? []) {
    assert.ok(/CLICK|IMPRESSION|OPEN/.test(name), `${name} states a measurement, not an outcome`);
  }
});

test('the CRM labels clicks as clicks', () => {
  assert.ok(crmPage.includes('broker_crm_metric_phone_clicks'));
  assert.ok(crmPage.includes('broker_crm_metrics_honesty'));
});

test('stats are owner-or-admin only', () => {
  const stats = migration.slice(migration.indexOf('create or replace function public.broker_profile_event_stats'));
  assert.match(stats, /v_owner <> auth\.uid\(\) and not public\.is_admin\(\)/);
});
