// Property inventory wiring (owner, 2026-10-19): Supabase is the searchable inventory, R2 only
// heavy material, and nothing here changes matching, billing or paid services by itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const SCHEMA = read('supabase/migrations/20261119100000_property_inventory.sql');
const BACKFILL = read('supabase/migrations/20261119100100_property_inventory_backfill.sql');
const MIGRATION = `${SCHEMA}\n${BACKFILL}`;
const INGEST = read('supabase/functions/marketplace-worker-ingest/index.ts');
const INVENTORY = read('supabase/functions/_shared/marketplaceInventory.ts');
const fn = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.upsert_marketplace_inventory'), MIGRATION.indexOf('revoke all on function public.upsert_marketplace_inventory'));

test('a sighting is never a verification: the inventory upsert never sets last_verified_at or VALID', () => {
  assert.doesNotMatch(fn, /last_verified_at\s*=\s*(excluded|now|d\.)/);
  assert.doesNotMatch(fn, /'VALID'/);
  assert.match(fn, /'UNVERIFIED', 'MARKETPLACE'/, 'new rows are UNVERIFIED and marked MARKETPLACE');
  assert.match(fn, /coalesce\(excluded\.\w+, o\.\w+\)/, 'a missing fact never erases a known one');
  assert.match(fn, /greatest\(o\.last_seen_at, excluded\.last_seen_at\)/, 'an older sighting cannot move last_seen_at back');
  assert.match(MIGRATION, /grant execute on function public\.upsert_marketplace_inventory\(text, jsonb\) to service_role/);
  assert.match(MIGRATION, /revoke all on function public\.upsert_marketplace_inventory\(text, jsonb\) from public, anon, authenticated/);
});

test('matching is unchanged until the owner decides: supply-matching skips MARKETPLACE rows unless its setting is on', () => {
  const sm = read('supabase/functions/supply-matching/index.ts');
  assert.match(sm, /'supply_matching_marketplace_inventory'/);
  assert.match(sm, /if \(!includeMarketplace\) q = q\.is\('ingest_channel', null\)/);
  assert.doesNotMatch(MIGRATION, /(insert into|update) public\.admin_settings/, 'the migration does not turn it on');
});

test('release order: the backfill and the schedule are a separate migration, applied after the matcher filter is live', () => {
  assert.doesNotMatch(SCHEMA, /do nothing|cron\.schedule/, 'no backfill and no schedule in part 1');
  assert.match(BACKFILL, /RELEASE ORDER: after 20261119100000 AND after the supply-matching edge deploy/);
  assert.match(BACKFILL, /on conflict \(source_id, external_id\) do nothing/, 'rows another lane wrote are left alone');
});

test('freshness: revalidate-supply is scheduled, bounded, and never re-reads worker-only portals', () => {
  assert.match(MIGRATION, /cron\.schedule\('homatch-revalidate-supply', '41 \* \* \* \*'/);
  assert.match(MIGRATION, /'x-cron-token', \(select value #>> '\{\}' from public\.admin_settings where key = 'revalidation_worker_token'\)/);
  assert.match(MIGRATION, /"limit":25/);
  assert.match(read('supabase/functions/revalidate-supply/index.ts'), /\.not\('adapter_id', 'in', `\(\$\{\[\.\.\.WORKER_ONLY_SOURCES\]\.join\(','\)\}\)`\)/);
});

test('ingest: every report is written through after the answer and can never fail it', () => {
  assert.match(INGEST, /recordInventory\(db, worker\.source_key, report\.listings, nowDate\)/);
  assert.match(INGEST, /\.catch\(\(e\) => console\.error\(JSON\.stringify\(\{ event: 'inventory_failed'/);
  assert.match(INGEST, /afterResponse\(inventory\)/);
  assert.match(INVENTORY, /runtime\.waitUntil\(work\)/);
  /* The pool's own CACHED rows are not new sightings: only worker reports reach recordInventory. */
  assert.doesNotMatch(read('supabase/functions/_shared/marketplaceSearch.ts'), /recordInventory/);
});

test('R2: one private namespace, read back before it is trusted, bounded, never browser-signable, no photos, no contacts', () => {
  assert.match(INVENTORY, /namespace: NAMESPACE/);
  assert.match(INVENTORY, /const NAMESPACE = 'property-inventory'/);
  assert.match(INVENTORY, /visibility: 'PRIVATE'/);
  assert.match(INVENTORY, /\(await sha256Hex\(body\)\) !== sha256/, 'an index upload is registered only after its bytes are read back');
  assert.match(INVENTORY, /expiresIn: 300/);
  assert.match(INVENTORY, /INDEX_KEEP = 3/);
  assert.match(INVENTORY, /snapshotOf\(/, 'snapshots go through snapshotOf (no seller phone or e-mail)');
  assert.doesNotMatch(INVENTORY, /images|image_urls/, 'third-party photos are never copied');
  assert.doesNotMatch(read('supabase/functions/_shared/storage/keys.ts'), /property-inventory/, 'not a browser-signable namespace');
  assert.match(INGEST, /if \(!INDEXED_WORKERS\.has\(workerId\)\) return json\(\{ error: 'NOT_INDEXED' \}, 403\)/);
  assert.match(INVENTORY, /INDEXED_WORKERS = new Set\(\['homege-agent', 'allhome-agent'\]\)/);
});

test('search stays on Supabase: the shared pool has its index and every marketplace source', () => {
  assert.match(MIGRATION, /discovery_marketplace_listings_pool_idx\s+on public\.discovery_marketplace_listings \(source_key, observed_at desc\)/);
  const search = read('supabase/functions/_shared/marketplaceSearch.ts');
  for (const k of ["'myhome-agent': 'myhome-ge'", "'ssge-agent': 'ss-ge'", "'placege-agent': 'place-ge'", "'homege-agent': 'home-ge'", "'allhome-agent': 'allhome-ge'"]) assert.ok(search.includes(k), k);
  assert.doesNotMatch(search, /getObject|signedUrl|objectStore/, 'a customer search never opens an R2 object');
});

test('paid and protected services untouched: no paid switch, wallet or Deep Search in this change', () => {
  for (const text of [MIGRATION, INVENTORY]) assert.doesNotMatch(text, /find_property_deep|find_property_social_enabled|wallet|credit_ledger|reserve_|apify/i);
});
