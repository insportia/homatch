// PHASE 2 completion — the shared foundation is what both products actually
// run: cross-source duplicates are never billed or shown twice, the unified
// score ranks Find Property, the same person is never matched twice in Find
// Buyers, and the hard boundaries (Verify, Meta Ads, billing.ts, switches)
// did not move.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { billableDeliveries, planSettlement, propertyKeys } from '../../supabase/functions/_shared/findPropertySettlement.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const STARTED = '2026-10-02T10:00:00Z';
const obs = (over = {}) => ({
  entity_id: null, validation_state: 'FRESH', adapter_id: 'telegram-community', transaction: 'RENT', property_type: 'APARTMENT',
  city: 'Batumi', rent_amount: 700, rent_currency: 'USD', area_sqm: 65, rooms: 2, description: 'Сдается +995 599 12 34 56', ...over,
});
const row = (id, observation, at = '2026-10-02T10:05:00Z') => ({ observation_id: id, created_at: at, compatibility: 'COMPATIBLE', observation });

test('billing: one ad cross-posted in three channels is ONE delivered property', () => {
  const rows = [
    row('o1', obs({ content_fingerprint: 'cl1:abc', canonical_url: 'https://t.me/a/1', external_id: 'a/1' })),
    row('o2', obs({ content_fingerprint: 'cl1:abc', canonical_url: 'https://t.me/b/9', external_id: 'b/9' })),
    row('o3', obs({ content_fingerprint: 'cl1:abc', canonical_url: 'https://t.me/c/4', external_id: 'c/4' })),
  ];
  const d = billableDeliveries(rows, STARTED);
  assert.equal(d.delivered, 1);
  assert.equal(d.excluded.duplicate, 2);
});

test('billing: a portal listing and its Telegram repost (same phone, area, rooms) bill once; a different flat by the same broker bills', () => {
  const rows = [
    row('p1', obs({ adapter_id: 'ss-ge', canonical_url: 'https://home.ss.ge/ka/udzravi-qoneba/1', external_id: '1', description: 'call 599 12 34 56' })),
    row('t1', obs({ canonical_url: 'https://t.me/a/2', external_id: 'a/2', area_sqm: 65.5 })),
    row('t2', obs({ canonical_url: 'https://t.me/a/3', external_id: 'a/3', area_sqm: 40, rooms: 1, rent_amount: 450 })),
  ];
  assert.equal(billableDeliveries(rows, STARTED).delivered, 2);
});

test('billing: a property delivered before this run under another source is not billed again', () => {
  const rows = [
    row('old', obs({ content_fingerprint: 'cl1:z', canonical_url: 'https://t.me/a/7' }), '2026-10-01T09:00:00Z'),
    row('new', obs({ content_fingerprint: 'cl1:z', canonical_url: 'https://t.me/b/7' })),
  ];
  const d = billableDeliveries(rows, STARTED);
  assert.equal(d.delivered, 0);
  assert.equal(d.excluded.previouslyDelivered, 1);
  assert.deepEqual(planSettlement({ delivered: d.delivered, unitCredits: 10, authorizedMaxCredits: 50, reservationId: 'r' }),
    { action: 'RELEASE', credits: 0, reason: 'NO_DELIVERED_LISTINGS' }, 'zero delivered = zero charge, reservation released');
});

test('billing: observations of one resolved entity always stay one, even when dedupe alone would veto them', () => {
  const rows = [
    row('e1', obs({ entity_id: 'E', rent_amount: 700, canonical_url: 'https://t.me/a/1' })),
    row('e2', obs({ entity_id: 'E', rent_amount: 990, canonical_url: 'https://t.me/b/1' })),
  ];
  const keys = propertyKeys(rows);
  assert.equal(keys.get('e1'), keys.get('e2'));
  assert.equal(billableDeliveries(rows, STARTED).delivered, 1);
});

test('billing: uncertain pairs stay separate (never overmerge into an undercharge or a lost result)', () => {
  const rows = [
    row('u1', obs({ description: null, canonical_url: 'https://t.me/a/1', area_sqm: null, rooms: null })),
    row('u2', obs({ description: null, canonical_url: 'https://t.me/b/1', area_sqm: null, rooms: null })),
  ];
  assert.equal(billableDeliveries(rows, STARTED).delivered, 2);
});

test('wiring: Find Property shows each property once and keeps every other source as provenance', () => {
  const fp = code('supabase/functions/find-property/index.ts');
  assert.match(fp, /from '..\/..\/..\/src\/research-core\/discovery\/cross-source-dedupe\.ts'/);
  assert.match(fp, /kept\.alsoSeenAt\.push\(result\.attribution\)/);
  assert.match(fp, /content_fingerprint/);
  const page = code('src/pages/FindPropertyPage.tsx');
  assert.match(page, /result\.alsoSeenAt/);
  assert.match(code('src/components/customer/ListingCard.tsx'), /safeExternalUrl\(s\.url\)/, 'also-seen links pass the same URL contract');
  const tr = read('src/i18n/translations.ts');
  assert.equal((tr.match(/\bp2d_attr_also_seen:/g) ?? []).length, 6);
});

test('wiring: Find Property ranks with the unified score; Find Buyers never matches one person twice', () => {
  const sm = code('supabase/functions/supply-matching/index.ts');
  assert.match(sm, /unifiedScore\(e\.assessment\.score \* e\.freshnessFactor, e\.quality\)/);
  assert.match(sm, /candidateQuality\(fromObservationRow\(/);
  const rm = code('supabase/functions/run-matching-v2/index.ts');
  assert.match(rm, /if \(matchedPeople\.has\(person\)\) \{ skipped\+\+; duplicatePerson\+\+; continue; \}/);
  assert.match(rm, /matchedPeople\.add\(person\)/);
  assert.match(rm, /dedupe\(items/);
});

test('boundaries: Verify, Meta Ads, Design Studio and shared billing are not touched by the discovery foundation', () => {
  const discovery = ['src/research-core/discovery/cross-source-dedupe.ts', 'src/research-core/discovery/discovery-entity.ts',
    'src/research-core/discovery/source-capabilities.ts', 'src/research-core/match/unified-score.ts',
    'src/research-core/adapters/portal/candidates.ts', 'src/research-core/fetch/browser-transport.ts',
    'src/research-core/adapters/social/meta-graph-discovery.ts', 'src/research-core/discovery/audit-runtime.ts'];
  for (const f of discovery) {
    assert.ok(existsSync(join(root, f)), f);
    assert.doesNotMatch(code(f), /from ['"][^'"]*(verify|metaAds|design-studio|_shared\/billing)[^'"]*['"]/i, f);
  }
  assert.doesNotMatch(code('supabase/functions/_shared/findPropertySettlement.ts'), /^import (?!type)[^;]*from '\.\/billing\.ts'/m,
    'settlement imports only the ExecutionGrant type from billing.ts');
});

test('revalidation: re-read through the adapter, never a whole-page hash; the text fingerprint is never overwritten; no schedule', () => {
  const rv = code('supabase/functions/revalidate-supply/index.ts');
  assert.doesNotMatch(rv, /contentHash\(/);
  assert.doesNotMatch(rv, /update\.content_fingerprint\s*=/);
  assert.match(rv, /extractListing\(page\.body/);
  assert.match(rv, /judgeRevalidation\(/);
  assert.match(rv, /\.not\('adapter_id', 'like', '%-community'\)/);
  assert.match(rv, /priceHistory/);
  const scheduled = readdirSync(join(root, 'supabase/migrations'))
    .filter((f) => /cron\.schedule[\s\S]{0,400}revalidate-supply/.test(read(`supabase/migrations/${f}`)));
  assert.deepEqual(scheduled, [], 'no cron runs revalidate-supply: design first, schedule later');
});

test('backfill: deterministic, $0, cursor-paged, idempotent, dry-run capable — and returns before any model call', () => {
  const cs = read('supabase/functions/classify-signals-v2/index.ts');
  const start = cs.indexOf("if(mode==='community-supply-backfill')");
  const end = cs.indexOf('/* The five-minute schedule');
  const block = cs.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(block, /modelCalls:0/);
  assert.match(block, /order\('discovered_at',\{ascending:true\}\)/);
  assert.match(block, /gt\('discovered_at',after\)/);
  assert.match(block, /nextCursor/);
  assert.match(block, /if\(dryRun\)/);
  assert.doesNotMatch(block, /openai|OPENAI_API_KEY|cost_events|wallet_|billing/i);
  assert.ok(cs.indexOf("Deno.env.get('OPENAI_API_KEY')") > end, 'the model key is not even read on the backfill path');
  assert.match(code('supabase/functions/_shared/communitySupply.ts'), /onConflict: 'source_id,external_id'/);
});

test('Verify isolation: nothing Verify imports changed, and the worker that runs Verify is not in this release', () => {
  /* market/runtime.ts is imported by research-agent and the market lane; the Phase 2
     live-check runtime is a separate module, so Verify's bundle is unchanged. */
  const runtime = code('src/research-core/market/runtime.ts');
  assert.doesNotMatch(runtime, /candidates|browser-transport|includeCandidates|browserTransport/);
  for (const f of ['supabase/functions/research-agent/index.ts', 'supabase/functions/verify-synthesis/index.ts', 'supabase/functions/verification-handoff/index.ts']) {
    assert.doesNotMatch(read(f), /audit-runtime|candidates\.ts|browser-transport|cross-source-dedupe|discovery-entity/, f);
  }
  assert.ok(!existsSync(join(root, 'official-worker/src/discovery/BrowserRender.ts')), 'the discovery browser ships in its own worker release, not this one');
  assert.match(code('supabase/functions/source-audit/index.ts'), /createAuditPortalRuntime\(/);
});
