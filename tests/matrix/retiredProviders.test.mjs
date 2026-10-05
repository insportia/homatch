// DATAFORSEO IS RETIRED, AND NO CODE PATH CAN REACH IT. APIFY IS LIVE AGAIN
// (owner, 2026-10-04) ONLY THROUGH THE SINGLE MEMO23 CLIENT.
//
// The generic Apify execution deleted in 2026-09 stays deleted: no endpoint,
// no credential read and no executor outside _shared/findBuyers/memo23Client.ts.
//
// Retirement used to be a fact about admin_settings: provider_kill_switch = true
// and both names in provider_disabled_list. Every path that read those settings
// was safe. Three that did not were found on 2026-09-27:
//
//   social-collect          constructed ApifyProvider on any POST naming an
//                           active source and launched a paid actor run.
//   provider-health-check   sent a live DataForSEO SERP query (billed) and a
//                           live Apify request every time an admin pressed Test.
//   discovery-queue-worker  still carried the full launch and dataset-reconcile
//                           code, the reconcile half gated by nothing at all.
//
// Plus _shared/jobs.ts and _shared/providers.ts, which held the same fetches in
// importable form. These tests make "retired" a property of the code: the
// endpoints are not in supabase/functions, so no setting can bring them back.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { stripComments } from '../../scripts/lib/stripComments.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FUNCTIONS = join(root, 'supabase', 'functions');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const read = (p) => readFileSync(p, 'utf8');
/* Comments are stripped: several files explain in prose which host they no
   longer call, and a guard that fails on its own documentation guards nothing. */
const code = (p) => stripComments(read(p));
const fnCode = (name) => code(join(FUNCTIONS, name));

/* The ONE exception, authorised by the owner on 2026-10-04 for FIND BUYERS /
   FIND TENANTS: memo23 Actors through a single client that refuses any other
   Actor. The generic APIFY provider (and DataForSEO) stay retired below. */
const MEMO23_CLIENT = join(FUNCTIONS, '_shared', 'findBuyers', 'memo23Client.ts');

test('no edge code names a DataForSEO or Apify endpoint', () => {
  const hits = [];
  for (const file of walk(FUNCTIONS)) {
    const src = code(file);
    for (const host of [/dataforseo\.com/i, /apify\.com/i]) {
      if (file === MEMO23_CLIENT && String(host) === String(/apify\.com/i)) continue;
      if (host.test(src)) hits.push(`${relative(root, file)} → ${host}`);
    }
  }
  assert.deepEqual(hits, [], `retired provider endpoints are reachable:\n${hits.join('\n')}`);
});

test('no edge code reads the retired providers’ credentials', () => {
  /* A credential read is the first half of a request. Without one, a retired
     provider cannot be called even if an endpoint were reintroduced by string
     concatenation. */
  const hits = [];
  for (const file of walk(FUNCTIONS)) {
    const src = code(file);
    for (const cred of [/APIFY_API_TOKEN/, /APIFY_[A-Z]+_ACTOR_ID/, /DATAFORSEO_LOGIN/, /DATAFORSEO_PASSWORD/]) {
      if (file === MEMO23_CLIENT && String(cred) === String(/APIFY_API_TOKEN/)) continue;
      if (cred.test(src)) hits.push(`${relative(root, file)} → ${cred}`);
    }
  }
  assert.deepEqual(hits, [], `retired provider credentials are read:\n${hits.join('\n')}`);
});

test('the memo23 client is the only Apify door, runs memo23 Actors only, and never leaks the token', () => {
  const src = code(MEMO23_CLIENT);
  assert.match(src, /\^memo23~\[a-z0-9\]/, 'Actor ids are restricted to memo23');
  assert.match(src, /assertMemo23ActorId\(actorId\)/);
  assert.match(src, /maxTotalChargeUsd/, 'every run is capped at its reservation');
  assert.match(src, /function scrub/, 'errors are scrubbed of the token');
  assert.doesNotMatch(src, /console\.(log|error|warn)\([^)]*token/i, 'the token is never logged');
  assert.equal((read(MEMO23_CLIENT).match(/APIFY_API_TOKEN/g) ?? []).length >= 1, true);
  /* No other edge file reads the token or names the host (asserted above), and
     nothing in the frontend may name either. */
  const front = [];
  const walkSrc = (dir) => { for (const e of readdirSync(dir)) { const f = join(dir, e); if (statSync(f).isDirectory()) walkSrc(f); else if (/\.(ts|tsx)$/.test(e) && /APIFY_API_TOKEN|api\.apify\.com/.test(read(f))) front.push(relative(root, f)); } };
  walkSrc(join(root, 'src'));
  assert.deepEqual(front, [], 'the frontend never names the Apify token or API');
  /* Apify is no longer retired; DataForSEO is. */
  assert.match(fnCode('_shared/retiredProviders.ts'), /RETIRED_PROVIDERS = \['DATAFORSEO'\] as const/);
  /* The admin Test is one free account read: GET /users/me, never a run or an Actor. */
  const check = src.slice(src.indexOf('export async function accountCheck('), src.indexOf('export async function actorDefinition('));
  assert.match(check, /call\('GET', '\/users\/me'/);
  assert.doesNotMatch(check, /POST|\/runs|\/acts\//, 'the account check must never start or name an Actor');
});

test('the retired-provider list names DataForSEO only; Apify answers APIFY_ONLY_VIA_MEMO23 off the memo23 path', () => {
  const shared = fnCode('_shared/retiredProviders.ts');
  assert.match(shared, /RETIRED_PROVIDERS = \['DATAFORSEO'\] as const/);
  assert.match(shared, /export const APIFY_ONLY_VIA_MEMO23 = 'APIFY_ONLY_VIA_MEMO23:/);
});

test('social-collect (generic Apify collection) answers 423 not-executable and does nothing else', () => {
  const src = fnCode('social-collect/index.ts');
  assert.match(src, /error: APIFY_ONLY_VIA_MEMO23/);
  assert.match(src, /notExecutable: true/);
  assert.match(src, /status: 423/);
  assert.doesNotMatch(src, /ApifyProvider/, 'social-collect still constructs the Apify provider');
  assert.doesNotMatch(src, /fetch\(/, 'social-collect still makes a network call');
  assert.doesNotMatch(src, /\.from\(/, 'social-collect still touches the database');
});

test('the retired provider classes no longer exist', () => {
  const src = fnCode('_shared/providers.ts');
  assert.doesNotMatch(src, /class DataForSEOProvider/);
  assert.doesNotMatch(src, /class ApifyProvider/);
});

test('provider-health-check reports DataForSEO retired before it could test anything; Apify is tested only via the memo23 account check', () => {
  const src = fnCode('provider-health-check/index.ts');
  const guard = src.indexOf('if (isRetiredProvider(upper))');
  assert.ok(guard > 0, 'the retired short-circuit is gone');
  assert.ok(guard < src.indexOf('fetch('), 'a request can be built before the retired check');
  assert.match(src.slice(guard, guard + 600), /status: 'RETIRED'/);
  assert.doesNotMatch(src, /case 'DATAFORSEO'/, 'a live test case for retired DataForSEO is back');
  const apify = src.slice(src.indexOf("case 'APIFY':"), src.indexOf("case 'SCRAPINGBEE':"));
  assert.match(apify, /await accountCheck\(\)/, 'the Apify test goes through the memo23 client');
  assert.doesNotMatch(apify, /fetch\(|startRun|actorDefinition|Deno\.env/, 'the Apify test builds no request of its own and reads no credential');
});

test('discovery-queue-worker fails retired jobs before any provider code', () => {
  const src = fnCode('discovery-queue-worker/index.ts');
  const exec = src.slice(src.indexOf('async function executeProvider('));
  assert.match(exec, /if \(isRetiredProvider\(provider\)\) \{\s*throw new ProviderError\(`PROVIDER_RETIRED/);
  /* Non-retryable: a retired job must not bounce back into the queue forever. */
  assert.match(exec, /PROVIDER_RETIRED: \$\{retiredReason\(provider\)\}`, false, 423/);
  /* The generic APIFY provider has no executor: refused before any provider code. */
  assert.match(exec, /if \(provider === 'APIFY'\) \{\s*throw new ProviderError\(APIFY_ONLY_VIA_MEMO23, false, 423\)/);
  assert.doesNotMatch(src, /executeDataForSEO|executeApify|fetchApifyDataset|apifyRequest/);
  /* Reconcile read paid generic Apify datasets and consulted no setting: still off. */
  assert.match(src, /mode: 'reconcile', notExecutable: true/);
});

test('the portable job library cannot reach a retired provider either', () => {
  const src = fnCode('_shared/jobs.ts');
  assert.match(src, /retiredJob\('discoverMarketSources', 'DATAFORSEO'\)/);
  assert.match(src, /retiredJob\('collectSourceUpdates', 'APIFY'\)/);
});

test('the admin screen offers no control that could re-enable DataForSEO; Apify has Test and its own switch, which no preset changes', () => {
  const page = stripComments(read(join(root, 'src', 'pages', 'admin', 'AdminProvidersPage.tsx')));
  assert.match(page, /RETIRED_PROVIDERS = \['DATAFORSEO'\]/);
  /* A preset keeps Apify's current state (it never silently enables Apify). */
  assert.match(page, /disabledProviders\.includes\('APIFY'\) \? \['APIFY'\] : \[\]/);
  /* Apify's switch is not hidden behind the legacy external-discovery kill switch. */
  assert.match(page, /globalKillSwitch && h\.provider\.toUpperCase\(\) !== 'APIFY'/);
  /* The per-card enable and test buttons are not rendered for a retired card. */
  assert.match(page, /\{retired \? \(/);
  /* Every write to provider_disabled_list keeps the retired name in it. */
  const writes = [...page.matchAll(/updateAdminSetting\('provider_disabled_list', ([^)]+)\)/g)];
  assert.ok(writes.length > 0, 'guard: the page no longer writes the disabled list');
  for (const [, arg] of writes) {
    assert.match(arg, /withRetired\(/, `provider_disabled_list written without the retired names: ${arg}`);
  }
});
