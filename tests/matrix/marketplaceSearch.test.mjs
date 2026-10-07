// FIND PROPERTY — MARKETPLACE SEARCH foundation, as wired.
//
// Source-level guards for what the unit tests cannot see: the readiness gate
// runs on the SERVER before anything is written, Marketplace Search never
// touches billing, every customer read is scoped to the caller, workers never
// hold a Supabase key, fixtures never reach production code, Verify and the
// other hard boundaries did not move, and every dynamic i18n key exists in all
// six bundles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const MS = 'supabase/functions/marketplace-search/index.ts';
const WI = 'supabase/functions/marketplace-worker-ingest/index.ts';
const SH = 'supabase/functions/_shared/marketplaceSearch.ts';
const MIG = 'supabase/migrations/20261010100000_marketplace_search_foundation.sql';

function walk(dir) {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (name === 'node_modules') continue;
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

test('server readiness gate: start re-sanitises the brief and refuses before any write', () => {
  const ms = code(MS);
  const start = ms.indexOf("if (action === 'start')");
  const gate = ms.indexOf("readiness.state !== 'READY'", start);
  const firstInsert = ms.indexOf('.insert(', start);
  assert.ok(start > 0 && gate > start && firstInsert > gate, 'the gate precedes every insert');
  assert.match(ms, /const brief = sanitizeBrief\(body\.brief\)/);
  assert.match(ms, /SEARCH_NOT_READY/);
  assert.match(ms, /if \(switches\.providersKilled && !switches\.myhomeEnabled\) return json\(\{ error: 'SOURCES_PAUSED' \}, 409\)/);
  assert.match(ms, /worker\.workerId === 'myhome-agent'\s*\? switches\.myhomeEnabled : !switches\.providersKilled/);
  assert.match(ms, /if \(!switches\.enabled\) return json\(\{ error: 'MARKETPLACE_SEARCH_OFF' \}, 409\)/);
});

test('free: Marketplace Search never reserves, charges, settles or imports billing', () => {
  for (const f of [MS, WI, SH]) {
    const c = code(f);
    assert.doesNotMatch(c, /billing\.ts|wallet_|beginExecution|settle|reserve|credits_charged|billing_grant/i, f);
  }
  for (const f of walk('src/research-core/marketplace')) assert.doesNotMatch(code(f), /billing|wallet|credit/i, f);
});

test('ownership: every customer read of a search is scoped to the caller; internals never leave', () => {
  const ms = code(MS);
  assert.match(ms, /\.eq\('id', id\)\.eq\('user_id', userId\)/);
  assert.match(ms, /\.eq\('user_id', userId\)\.eq\('idempotency_key', key\)/);
  assert.doesNotMatch(ms, /select\('[^']*internal/, 'customer reads select the public view only');
  assert.match(ms, /\.select\('view'\)\.eq\('search_id', search\.id\)/);
  assert.match(ms, /readAll<\{ view: CustomerProperty \}>/);
});

test('workers: own token checked against a sha256 hash, constant-time; no Supabase key handed out; bounded payload', () => {
  const wi = code(WI);
  assert.match(wi, /sameHex\(presented, worker\.token_hash\)/);
  assert.match(wi, /worker\.state !== 'ACTIVE' \|\| !worker\.enabled/);
  assert.match(wi, /run\.worker_id !== workerId/);
  assert.match(wi, /validateWorkerReport\(body\.result, worker\.source_key\)/);
  assert.match(wi, /MAX_BODY_BYTES/);
  assert.doesNotMatch(wi, /json\(\{[^)]*(serviceKey|token_hash|SERVICE_ROLE)/, 'the key and the hash are used, never returned');
  const deploy = read('.github/workflows/deploy.yml');
  assert.match(deploy, /"marketplace-search"/);
  assert.match(deploy, /"marketplace-worker-ingest"/);
  assert.match(read('supabase/config.toml'), /\[functions\.marketplace-worker-ingest\]\nverify_jwt = false/);
});

test('migration: additive, switch seeded OFF, RLS on, service-role writes, admin-only reads, token hash never granted', () => {
  const sql = read(MIG);
  assert.doesNotMatch(sql, /^\s*(begin|commit)\s*;/im, 'the runner owns the transaction');
  assert.doesNotMatch(sql, /\bdrop table\b|\btruncate\b|\bdelete from\b/i);
  assert.match(sql, /'marketplace_search_enabled', 'false'::jsonb/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /using \(public\.is_admin\(\)\)/);
  assert.match(sql, /revoke all on function public\.claim_marketplace_worker_runs\(text, integer, integer\) from public, anon, authenticated/);
  assert.match(sql, /constraint discovery_marketplace_workers_enabled_requires_active check \(not enabled or state = 'ACTIVE'\)/);
  const grant = sql.match(/grant select \(([^)]*)\)\s*on public\.discovery_marketplace_workers/);
  assert.ok(grant && !grant[1].includes('token_hash'));
  assert.doesNotMatch(sql, /insert into public\.discovery_marketplace_workers/i, 'no worker is registered, let alone activated');
});

test('fixtures are isolated: no production file imports the marketplace fixture set', () => {
  const offenders = [...walk('src'), ...walk('supabase/functions')]
    .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !f.includes('__tests__'))
    .filter((f) => /marketplaceFixtures/.test(read(f)));
  assert.deepEqual(offenders, []);
  assert.doesNotMatch(code('src/services/marketplaceSearch.ts'), /fixture|mock|sample/i, 'no fallback data on the client');
});

test('hard boundaries: Verify, Meta Ads, Design Studio, AI TALK, Communications, billing untouched by the new code', () => {
  const files = [...walk('src/research-core/marketplace'), ...walk('src/components/findProperty'), 'src/services/marketplaceSearch.ts', MS, WI, SH];
  for (const f of files) {
    assert.doesNotMatch(code(f), /from ['"][^'"]*(\/verify\/|verify-|metaAds|meta-ads|designStudio|design-studio|\/comm\/|ai-talk|_shared\/billing|_shared\/fx)[^'"]*['"]/i, f);
    assert.doesNotMatch(code(f), /gemini|apify|dataforseo/i, f);
  }
});

test('the existing Find Property stays the default until the switch is on', () => {
  const page = code('src/pages/FindPropertyPage.tsx');
  assert.match(page, /if \(!caps\.marketplaceEnabled\) return <LegacyFindPropertyPage \/>/);
  assert.match(page, /result\.alsoSeenAt/, 'the legacy experience is intact');
  assert.match(code('src/services/marketplaceSearch.ts'), /return \{ marketplaceEnabled: false, activeSources: 0, deepSearchAvailable: false \}/,
    'an unreachable service never shows the new experience');
});

test('bare Find Property prefers the latest search with a real property catalogue', () => {
  const edge = code('supabase/functions/marketplace-search/index.ts');
  assert.match(edge, /\.gt\('properties_count', 0\)/, 'a newer zero-result failure must not hide prior results');
  assert.match(edge, /if \(usable\) search = usable/, 'the usable catalogue is the default workspace');
  assert.match(edge, /else \{[\s\S]*order\('created_at'/, 'accounts with no results still receive their latest search state');
});

test('approved Georgian copy is used verbatim', () => {
  const tr = read('src/i18n/translations.ts');
  const ka = tr.slice(tr.indexOf('const ka: Partial'), tr.indexOf('const ru: Partial'));
  for (const s of [
    'მომიყევი, რას ეძებ 🏡',
    'ყველაფერი მზადაა ✨',
    'ფასებში სხვაობა ვიპოვეთ',
    'დაკავშირებამდე გადაამოწმე მიმდინარე ფასი და პირობები.',
    'შენი მოთხოვნა ასობით მარკეტფლეისი ყველა შესაბამისი განცხადება ერთ სივრცეში',
    'აღარ დაკარგო საათები სხვადასხვა საიტზე ძებნაში, ერთი და იმავე განცხადებების ნახვასა და ათობით გვერდის ერთმანეთთან შედარებაში.',
    'უბრალოდ უთხარი HOMATCH-ს რას ეძებ.',
    'ჩვენ ერთდროულად მოვძებნით შენს მოთხოვნასთან შესაბამის განცხადებებს საქართველოში და იმ უცხოურ პლატფორმებზეც, სადაც საქართველოს უძრავი ქონება ქვეყნდება.',
    'რამდენიმე წუთში ერთ სივრცეში მიიღებ შეგროვებულ, გაფილტრულ და შენს მოთხოვნაზე მორგებულ შედეგებს, რათა დრო ძიებაზე კი არა, სწორი არჩევანის გაკეთებაზე დახარჯო.',
    'ერთი მოთხოვნა. ბევრი წყარო. ბევრად ნაკლები ძებნა.',
    'მიუთითე რა ტიპის ქონებას ეძებ, სად და რა ბიუჯეტით. დანარჩენ სამუშაოს HOMATCH შეასრულებს.',
    'ჩვენ მოვძებნით მიმდინარე განცხადებებს სხვადასხვა წყაროში, გავაერთიანებთ ერთი და იმავე ქონების დუბლირებულ განცხადებებს, შევადარებთ ფასებსა და ინფორმაციას და შენს მოთხოვნასთან ყველაზე ახლოს მდგომ ვარიანტებს პირველ რიგში გაჩვენებთ.',
    'მომიძებნე ქონება',
    'HOMATCH უკვე ეძებს შენთვის',
    'შედეგები გამოჩნდება ეტაპობრივად, როგორც კი სხვადასხვა წყაროდან მივიღებთ.',
    'ძიება გრძელდება...',
    'შედეგები მზადაა',
    'ზუსტი შესაბამისობა ჯერ ვერ ვიპოვეთ',
    'ეს ვარიანტები შენს მაქსიმალურ ბიუჯეტს ოდნავ აჭარბებს, თუმცა რეალური უპირატესობები აქვს. გაჩვენებთ მხოლოდ იმ შემთხვევებში, როცა დამატებით ფასს მნიშვნელოვანი განსხვავება ახლავს.',
  ]) assert.ok(ka.includes(s), s);
  assert.ok(!tr.includes('მარკეტპლეის'), 'the word is მარკეტფლეისი, never მარკეტპლეისი');
  assert.match(ka, /^ {2}mps_mode_title: 'შენი მოთხოვნა ასობით მარკეტფლეისი ყველა შესაბამისი განცხადება ერთ სივრცეში',$/m, 'the title carries no added punctuation');
  assert.doesNotMatch(ka.match(/^ {2}mps_[\s\S]*?(?=\n\n {2}\/\*|$)/m)?.[0] ?? '', /შესატყვისი/, 'match is დამთხვევა');
});

test('every dynamic mps_ key used by the interface exists in all six bundles', async () => {
  const { MARKETPLACE_SEARCH_STRINGS: S } = await import(pathToFileURL(join(root, 'scripts/marketplace-search-i18n-data.mjs')).href);
  const has = (k) => Object.prototype.hasOwnProperty.call(S, k);
  const want = [];
  for (const v of ['BUY', 'MONTHLY_RENT', 'DAILY_RENT']) want.push(`mps_tx_${v}`);
  for (const v of ['APARTMENT', 'HOUSE', 'PENTHOUSE', 'LAND', 'COMMERCIAL', 'OFFICE', 'VILLA', 'TOWNHOUSE', 'STUDIO', 'OTHER']) want.push(`mps_pt_${v}`);
  for (const v of ['NEW_BUILD', 'OLD_BUILD', 'UNDER_CONSTRUCTION', 'ANY']) want.push(`mps_bs_${v}`);
  for (const v of ['RENOVATED', 'GREEN_FRAME', 'WHITE_FRAME', 'BLACK_FRAME', 'NEEDS_RENOVATION', 'ANY']) want.push(`mps_rn_${v}`);
  for (const v of ['transactionType', 'propertyType', 'location', 'price', 'area', 'rooms', 'bedrooms', 'buildingStatus']) want.push(`mps_req_${v}`);
  for (const u of ['plain', 'area']) want.push(`mps_range_${u}`, `mps_from_${u}`, `mps_upto_${u}`);
  for (const w of ['rooms', 'bedrooms']) want.push(`mps_${w}_n`, `mps_${w}_from`, `mps_${w}_range`);
  for (const s of ['DONE', 'ACTIVE', 'PENDING']) want.push(`mps_stage_state_${s}`);
  for (const s of ['VERIFIED', 'RECENT', 'STALE']) want.push(`mps_fresh_${s}`);
  const reasons = read('src/research-core/marketplace/pipeline.ts').match(/export type ReasonCode =([^;]+);/)[1].match(/'([A-Z_]+)'/g).map((x) => x.slice(1, -1));
  for (const r of reasons) want.push(`mps_reason_${r}`);
  const adv = read('src/research-core/marketplace/upgrade.ts').match(/export type AdvantageCode =([^;]+);/)[1].match(/'([A-Z_]+)'/g).map((x) => x.slice(1, -1));
  for (const a of adv) want.push(`mps_adv_${a}`);
  const trade = read('src/research-core/marketplace/results-intelligence.ts').match(/export type TradeoffCode =([^;]+);/)[1].match(/'([A-Z_]+)'/g).map((x) => x.slice(1, -1));
  for (const tc of trade) want.push(`mps_tradeoff_${tc}`);
  // Only emitted reason codes become translation keys; description signal enums do not.
  const sellerReasons = [...read('src/research-core/marketplace/seller.ts').matchAll(/reasons\.push\(([^;]+)\)|reasonCodes:\s*\[([^\]]*)\]/g)]
    .flatMap((m) => [...(m[1] ?? m[2]).matchAll(/'([A-Z][A-Z_]+)'/g)].map((code) => code[1]))
    .filter((c) => !['OWNER'].includes(c));
  for (const c of sellerReasons) want.push(`mps_seller_reason_${c}`);
  for (const f of ['price', 'pricePerSqm', 'area', 'rooms', 'bedrooms', 'location', 'buildingStatus', 'renovation', 'floor', 'parking', 'furnished', 'freshness', 'seller', 'sourceCount']) want.push(`mps_cmp_${f}`);
  const missing = want.filter((k) => !has(k));
  assert.deepEqual(missing, []);
  const tr = read('src/i18n/translations.ts');
  for (const k of want) assert.equal((tr.match(new RegExp(`^ {2}${k}: `, 'gm')) ?? []).length, 6, `${k} in six bundles`);
});

test('Snake is optional, self-contained and never touches the search', () => {
  for (const f of ['src/components/findProperty/SnakeGame.tsx', 'src/components/findProperty/SnakeThumbnail.tsx']) {
    assert.doesNotMatch(code(f), /services\/|supabase|searchStatus|startSearch|cancelSearch|understand\(/, f);
  }
  const snake = code('src/components/findProperty/SnakeGame.tsx');
  assert.match(snake, /ArrowUp/);
  assert.match(snake, /w: 'U'/);
  assert.match(snake, /onPointerUp/);
  assert.match(snake, /addEventListener\('touchmove', stop, \{ passive: false \}\)/, 'a swipe never scrolls the page');
  const exp = code('src/components/findProperty/MarketplaceSearchExperience.tsx');
  assert.match(exp, /const \[playing, setPlaying\] = useState\(false\)/, 'not playing by default');
  assert.match(exp, /<SnakeOverlay t=\{t\} open=\{playing\}/, 'the game lives at page level, above the search');
  assert.match(exp, /view === 'SEARCH' && !playing && search\?\.terminal/, 'the search finishing never closes the game');
  const view = code('src/components/findProperty/SearchingView.tsx');
  assert.match(view, /<SnakeThumbnail t=\{t\} onOpen=\{onPlay\}/);
  assert.doesNotMatch(view, /mps_snake_cta|mps_snake_optional/);
});

test('concurrent orchestration: one batch dispatch, bounded parallel claims, independent leases and retries', () => {
  const ms = code(MS);
  assert.match(ms, /\.insert\(eligible\.map\(/, 'every eligible worker gets its run in one insert');
  const wi = code(WI);
  assert.match(wi, /p_lease_seconds: leaseSeconds/);
  assert.match(wi, /action === 'heartbeat'/);
  assert.match(wi, /retryDecision\(/);
  assert.match(wi, /reapRuns\(/);
  const sh = code(SH);
  assert.match(sh, /readAll<\{ raw: ExternalListingCandidate/, 'every listing is read, page by page');
  assert.doesNotMatch(sh, /\.limit\(MAX_LISTINGS/);
  const sql = read(MIG);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /v_worker\.max_concurrency - v_worker_live/);
  assert.match(sql, /greatest\(1, v_global\) - v_global_live/);
  assert.match(sql, /'marketplace_max_concurrent_runs', '40'::jsonb/);
});

test('results are never capped: exact counts, a real total, every group pages to the end', () => {
  const ms = code(MS);
  assert.match(ms, /resultCatalogue\(db, search\)\)\.filter\(\(p\) => isCurrentResult\(p\)\)/);
  assert.match(ms, /totalProperties:/);
  assert.doesNotMatch(ms, /select\('result_group'\)/, 'no row-capped counting');
  const rv = code('src/components/findProperty/ResultsView.tsx');
  assert.doesNotMatch(rv, /IntersectionObserver/);
  assert.match(rv, /browseSearchResults/);
  assert.match(rv, /pageNumbers/);
  assert.match(rv, /mps_total_found/);
  assert.match(rv, /fpr_page_status/);
});

test('no fake progress: the searching view renders only server counters', () => {
  const view = code('src/components/findProperty/SearchingView.tsx');
  assert.doesNotMatch(view, /%\s*\}|Math\.random|setInterval/);
  assert.match(view, /c\.listingsDiscovered/);
  assert.match(view, /search\.stages\.map/);
});

test('source-level: new paths are owned by the DISCOVERY component', () => {
  const comp = read('scripts/release/components.mjs');
  assert.match(comp, /components\\\/findProperty/);
  assert.match(comp, /'marketplace-search', 'marketplace-worker-ingest'/);
  assert.ok(existsSync(join(root, 'tests/sql/run-marketplace.sh')));
  assert.equal(relative(root, join(root, MIG)).replaceAll('\\', '/'), MIG);
});

test('understand: atomic per-user quota checked BEFORE any model call; 429 with Retry-After; fails closed', () => {
  const ms = code(MS);
  const u = ms.indexOf("if (action === 'understand')");
  const quota = ms.indexOf('consumeUnderstandQuota(db, userId)', u);
  const model = ms.indexOf('openaiStructured(', u);
  assert.ok(u > 0 && quota > u && model > quota, 'the quota is consumed before OpenAI is called');
  assert.match(ms, /429, \{ 'Retry-After': String\(quota\.retryAfterSeconds\) \}/);
  assert.match(ms, /code: 'RATE_LIMIT_EXCEEDED'/, 'the same contract investment-consultant uses');
  const sh = code(SH);
  assert.match(sh, /rpc\('consume_marketplace_rate_limit'/);
  assert.match(sh, /window: 'UNAVAILABLE'/, 'an unreadable quota refuses the call');
  assert.doesNotMatch(sh, /from ['"][^'"]*\/comm\//, 'no Communications import');
  const sql = read(MIG);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('marketplace_rate_limit:'/);
  assert.match(sql, /insert into public\.rate_limit_events \(user_id, operation\)/);
  assert.match(sql, /revoke all on function public\.consume_marketplace_rate_limit\(uuid, text, integer, integer, integer, integer\) from public, anon, authenticated/);
});
