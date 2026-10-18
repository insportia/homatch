// Paid Deep Search paused by the owner (2026-10-18): one persistent, audited Admin switch
// (service find_property_deep, OFF by migration) and every paid path behind it. Nothing is
// deleted: campaigns, results and money records stay; started provider runs still finish
// and settle; past results stay readable at no charge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const RUN = read('supabase/functions/find-property-run/index.ts');
const OFFERS = read('supabase/functions/_shared/findProperty/socialOffers.ts');
const MARKET = read('supabase/functions/_shared/marketplaceSearch.ts');
const SQL = read('supabase/migrations/20261115100000_find_property_deep_paused.sql');
const EXPERIENCE = read('src/components/findProperty/MarketplaceSearchExperience.tsx');
const RESULTS_VIEW = read('src/components/findProperty/ResultsView.tsx');
const HEADER = read('src/components/findProperty/workspace/WorkspaceHeader.tsx');
const PAGE = read('src/pages/FindPropertyPage.tsx');
const CAMPAIGN_PAGE = read('src/pages/FindPropertyCampaignPage.tsx');
const CONTROL = read('supabase/functions/service-control/index.ts');

test('the switch: the existing Service Control row, turned OFF by migration and nothing else', () => {
  assert.match(SQL, /update public\.service_controls\s+set frontend_enabled = false,\s+backend_enabled = false,\s+version = version \+ 1,/);
  assert.match(SQL, /where service_key = 'find_property_deep';/);
  const code = SQL.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /\b(delete|truncate|drop|insert)\b/i, 'only the switch moves; no history is touched');
  for (const other of ['find_property_social_enabled', 'find_property_test_campaign', 'admin_settings', 'wallet', 'usage_reservations']) {
    assert.ok(!code.includes(other), `${other} is not changed by the pause`);
  }
  /* Admin flips it back through the audited, admin-only service-control function. */
  assert.match(CONTROL, /caller\.rpc\('is_admin'\)/);
  assert.match(CONTROL, /find_property_deep: \[/, 'Admin sees open campaigns and actor runs before switching');
});

test('server: no new campaign, resume, preview price or test amount while OFF; stop stays open', () => {
  assert.match(RUN, /if \(action === 'start' && !\(await serviceBackendEnabled\(db, 'find_property_deep'\)\)\) \{\n\s+return json\(serviceDisabledBody\('find_property_deep'\), 503\);/);
  assert.ok(RUN.indexOf("action === 'start' && !(await serviceBackendEnabled") < RUN.indexOf('beginExecution('), 'refused before any reservation');
  assert.match(RUN, /if \(action === 'resume' && !\(await serviceBackendEnabled\(db, 'find_property_deep'\)\)\) \{\n\s+return json\(serviceDisabledBody\('find_property_deep'\), 503\);/);
  assert.match(RUN, /if \(!\(await serviceBackendEnabled\(db, 'find_property_deep'\)\)\) return json\(\{ success: true, testOption: null \}\);/);
  assert.match(RUN, /const available = serviceOn && /);
  assert.match(RUN, /!serviceOn \? 'PAID_CAMPAIGNS_OFF'/);
  /* The read-only results action has no switch: viewing past results never charges. */
  const results = RUN.slice(RUN.indexOf("if (action === 'results')"), RUN.indexOf("if (action === 'admin_campaigns')"));
  assert.ok(results.length > 0 && !results.includes('serviceBackendEnabled'), 'past results stay readable while paused');
  for (const money of ['beginExecution', 'rpc(\'find_property_reserve', 'settle']) assert.ok(!results.includes(money), `results never reaches ${money}`);
});

test('worker: no new provider run or reservation while OFF; started runs still finish and book', () => {
  const exec = OFFERS.slice(OFFERS.indexOf('export async function executeOfferJob'), OFFERS.indexOf('async function start('));
  const gate = exec.indexOf("serviceBackendEnabled(db, 'find_property_deep')");
  assert.ok(gate > 0, 'the worker asks the switch');
  assert.match(exec, /if \(!\(await serviceBackendEnabled\(db, 'find_property_deep'\)\)\) return out\(\{ outcome: 'CANCELLED', error: 'SERVICE_PAUSED' \}\);/);
  assert.ok(gate < exec.indexOf('return start(db, job, run);'), 'before start (find_property_reserve_actor_run + memo23 startRun)');
  assert.ok(exec.indexOf('return poll(') < gate, 'an already-started run is polled and booked, never abandoned');
});

test('new free searches get no paid social posts while OFF', () => {
  assert.match(MARKET, /import \{ serviceBackendEnabled \} from '\.\/serviceControl\.ts';/);
  assert.match(MARKET, /if \(await serviceBackendEnabled\(db, 'find_property_deep'\)\) candidates\.push\(\.\.\.await loadSocialCandidates\(/);
});

test('interface: the free search exactly as before paid campaigns; past campaigns readable', () => {
  assert.match(PAGE, /deepOffered=\{deepVisible\}/);
  assert.match(EXPERIENCE, /onStart=\{\(\) => \(deepOffered \? setView\('CHOOSE'\) : void doStart\(\)\)\}/);
  assert.match(EXPERIENCE, /startLabel=\{deepOffered \? t\('fpx_continue_modes'\) : undefined\}/, 'the original start button');
  assert.match(EXPERIENCE, /view === 'CHOOSE' && brief && deepOffered &&/);
  assert.match(EXPERIENCE, /\{deepOffered && deepCredits && search/);
  assert.match(HEADER, /\{deepOffered \? <li[^>]*data-mode-tile="DEEP"/);
  assert.match(RESULTS_VIEW, /const view: View = asked === 'paid' && !deepOffered \? 'all' : asked;/);
  assert.match(RESULTS_VIEW, /\{deepOffered && search\.terminal && view === 'all' \? <DeepSearchPanel/);
  assert.match(RESULTS_VIEW, /\{!deepOffered && search\.terminal && view === 'all' \? <PastCampaignLink/);
  /* The campaign page itself is not behind the switch. */
  assert.doesNotMatch(CAMPAIGN_PAGE, /ServiceGate|useServiceVisible/);
});
