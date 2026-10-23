// Paid Deep Search paused by the owner (2026-10-18): one persistent, audited Admin switch
// (service find_property_deep, OFF by migration) and every paid path behind it. Nothing is
// deleted: campaigns, results and money records stay; started provider runs still finish
// and settle; past results stay readable at no charge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const RUN = read('supabase/functions/find-property-run/index.ts');
const OFFERS = read('supabase/functions/_shared/findProperty/socialOffers.ts');
const MARKET = read('supabase/functions/_shared/marketplaceSearch.ts');
/* The pause itself shipped in #269 (migration 20261116100000, already applied in production). */
const SQL = read('supabase/migrations/20261116100000_find_property_deep_paused.sql');
const EXPERIENCE = read('src/components/findProperty/MarketplaceSearchExperience.tsx');
const RESULTS_VIEW = read('src/components/findProperty/ResultsView.tsx');
const HEADER = read('src/components/findProperty/workspace/WorkspaceHeader.tsx');
const PAGE = read('src/pages/FindPropertyPage.tsx');
const CAMPAIGN_PAGE = read('src/pages/FindPropertyCampaignPage.tsx');
const CONTROL = read('supabase/functions/service-control/index.ts');

test('the switch: the existing Service Control row, OFF in production since #269; this PR moves no switch', () => {
  assert.match(SQL, /update public\.service_controls\s+set frontend_enabled = false,\s+backend_enabled = false,\s+version = version \+ 1,/);
  assert.match(SQL, /where service_key = 'find_property_deep'/);
  const code = SQL.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /\b(delete|truncate|drop|insert)\b/i, 'only switches move; no history is touched');
  for (const other of ['find_property_test_campaign', 'wallet', 'usage_reservations', 'credit_ledger']) {
    assert.ok(!code.includes(other), `${other} is not changed by the pause`);
  }
  /* No migration in this PR moves either switch: reactivation is the owner's, in Admin. */
  assert.ok(!existsSync(new URL('../../supabase/migrations/20261115100000_find_property_deep_paused.sql', import.meta.url)));
  const ours = read('supabase/migrations/20261117090000_find_property_campaign_results.sql').replace(/--.*$/gm, '');
  assert.ok(!/service_controls|find_property_social_enabled/.test(ours), 'the results migration touches no switch');
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

test('interface: the free search exactly as before paid campaigns; past campaigns readable by direct link only', () => {
  assert.match(PAGE, /deepOffered=\{caps\.deepSearchAvailable && deepVisible\}/, 'offered only when ON and fully available: no "soon" or "off" notice ever reaches a customer');
  assert.match(EXPERIENCE, /onStart=\{\(\) => \(deepOffered \? setView\('CHOOSE'\) : void doStart\(\)\)\}/);
  assert.match(EXPERIENCE, /startLabel=\{deepOffered \? t\('fpx_continue_modes'\) : undefined\}/, 'the original start button');
  assert.match(EXPERIENCE, /view === 'CHOOSE' && brief && deepOffered &&/);
  assert.match(EXPERIENCE, /\{deepOffered && deepCredits && search/);
  assert.match(HEADER, /\{deepOffered \? <li[^>]*data-mode-tile="DEEP"/);
  assert.match(HEADER, /t\(deepOffered \? 'fpx_header_sub' : 'fpx_header_sub_free'\)/, 'no paid hint in the subtitle');
  assert.match(RESULTS_VIEW, /const view: View = asked === 'paid' && !deepOffered \? 'all' : asked;/);
  assert.match(RESULTS_VIEW, /\{deepOffered && search\.terminal && view === 'all' \? <DeepSearchPanel/);
  assert.doesNotMatch(RESULTS_VIEW, /PastCampaignLink|campaignResultsPath/, 'nothing paid on the free results screen');
  /* The campaign page itself is not behind the switch. */
  assert.doesNotMatch(CAMPAIGN_PAGE, /ServiceGate|useServiceVisible/);
});

test('fail closed: an unreadable, missing or stale switch never shows or runs paid Deep Search', async () => {
  const edge = await import('../../supabase/functions/_shared/serviceControl.ts');
  const front = await import('../../src/lib/serviceControls/core.ts');
  /* find_buyers_external (legacy paid Find Buyers discovery) joined the fail-closed list on 2026-10-24. */
  assert.deepEqual([...edge.PAID_CLOSED_BY_DEFAULT], ['find_property_deep', 'find_buyers_external']);
  assert.ok(!edge.LIVE_BY_DEFAULT.includes('find_property_deep') && !front.LIVE_BY_DEFAULT.includes('find_property_deep'));
  assert.deepEqual(edge.defaultState('find_property_deep'), { frontend: false, backend: false }, 'server: unreadable → OFF');
  assert.deepEqual(front.HIDDEN_SNAPSHOT.services.find_property_deep, { frontend: false, backend: false }, 'browser: before an answer → hidden');
  assert.equal(front.toSnapshot([]).services.find_property_deep.frontend, false, 'a missing row → hidden');
  assert.equal(front.toSnapshot(null).services.find_property_deep.frontend, false, 'a malformed answer → hidden');
  assert.equal(front.initialSnapshot({ find_property_deep: true }).services.find_property_deep.frontend, false, 'never shown from browser memory');
  assert.equal(front.toSnapshot([{ service_key: 'find_property_deep', frontend_enabled: true, backend_enabled: true }]).services.find_property_deep.frontend, true, 'only an explicit ON row shows it');
  /* The free search's own switch is untouched and still fails open. */
  assert.ok(edge.LIVE_BY_DEFAULT.includes('find_property') && edge.LIVE_BY_DEFAULT.includes('find_buyers'));
});
