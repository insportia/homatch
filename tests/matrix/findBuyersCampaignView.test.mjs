// Find Buyers: per-search results and the two-campaign dashboard (2026-10-15).
//
// Regression for production campaign d8b69c51: its 2 WEAK leads were stored and
// readable but sorted behind 37 older leads in one property-wide list (page 5 of 9
// per page). The list now opens on the latest search; these premises pin that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); } catch { ts = createRequire(new URL('../../official-worker/package.json', import.meta.url))('typescript'); }
const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const mod = (() => {
  const js = ts.transpileModule(read('src/findBuyers/leadCampaigns.ts'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const ctx = { exports: {}, module: { exports: {} } };
  ctx.module.exports = ctx.exports;
  vm.runInNewContext(js, ctx);
  return ctx.exports;
})();

const lead = (job, cat, at) => ({ matching_job_id: job, match_category: cat, created_at: at });

test('the latest search comes first, with its own counts (the two-lead scenario)', () => {
  const older = Array.from({ length: 37 }, (_, i) => lead('70b0d32b', null, `2026-10-0${1 + (i % 8)}T10:00:00Z`));
  const latest = [lead('d8b69c51', 'WEAK', '2026-10-13T10:21:50Z'), lead('d8b69c51', 'WEAK', '2026-10-13T10:22:14Z')];
  const campaigns = mod.indexLeadCampaigns([...older, ...latest]);
  assert.equal(campaigns.length, 2);
  assert.equal(campaigns[0].jobId, 'd8b69c51', 'newest search first');
  assert.deepEqual({ total: campaigns[0].total, weak: campaigns[0].weak, strong: campaigns[0].strong }, { total: 2, weak: 2, strong: 0 });
  assert.equal(campaigns[1].uncategorised, 37, 'legacy leads stay uncategorised, never strong');
  const summary = mod.externalSummary(campaigns);
  assert.deepEqual({ qualified: summary.qualified, potential: summary.potential, weak: summary.weak, searches: summary.searches },
    { qualified: 0, potential: 0, weak: 2, searches: 2 }, 'weak signals are never counted as strong');
});

test('expand externally is offered only after free matching found nobody, and never while a search runs', () => {
  assert.equal(mod.showExpandOffer(null, false), false, 'not while loading');
  assert.equal(mod.showExpandOffer(3, false), false);
  assert.equal(mod.showExpandOffer(0, true), false);
  assert.equal(mod.showExpandOffer(0, false), true);
});

test('the results are scoped to one search and a failed read is never shown as empty', () => {
  const svc = read('src/services/findBuyersLeads.ts');
  assert.match(svc, /if \(jobId\) q = q\.eq\('matching_job_id', jobId\)/);
  assert.match(svc, /return \{ rows: \[\], total: 0, failed: true \}/);
  const hook = read('src/components/findBuyers/useExternalResults.ts');
  assert.match(hook, /campaigns\?\.\[0\]\?\.jobId/, 'defaults to the latest search');
  const view = read('src/components/findBuyers/ExternalResultsView.tsx');
  assert.match(view, /data-testid="fbx-results-error"/);
});

test('Find Buyers 3.0: the dashboard lists no leads; each result kind has its own page', () => {
  /* Matching workspace (owner, 2026-10-24): /matches is the one workspace; every older result page
     address redirects into it with the right product (their files stay, unrouted). */
  const routes = read('src/routes.tsx');
  const esc = (path) => path.replace(/[/:]/g, (c) => `\\${c}`);
  assert.match(routes, new RegExp(`path: '${esc('/property/:id/matches')}',\\s*element: <MatchingWorkspacePage />`));
  for (const [path, target] of [['/property/:id/buyers/external', 'external'], ['/property/:id/buyers/internal', 'internal'],
    ['/property/:id/buyers/opportunity/:key', 'external'], ['/property/:id/buyers/lead/:leadId', 'external'], ['/property/:id/leads', 'internal']]) {
    assert.match(routes, new RegExp(`path: '${esc(path)}',\\s*element: <LegacyMatchingRedirect target="${target}" />`), path);
  }
  const home = read('src/pages/property/FindBuyersHomePage.tsx');
  for (const list of ['PotentialBuyerCard', 'ExternalResultsView', 'InternalMatchesSection ', '<InternalMatchesSection']) {
    assert.ok(!home.includes(list), `the dashboard renders no lead list (${list})`);
  }
  const external = read('src/pages/property/MatchesPage.tsx');
  assert.ok(!external.includes('<InternalMatchesSection'), 'external results never include HOMATCH members');
});

test('internal matches never start research; the one start action only opens the budget step', () => {
  /* Recovery UX (owner, 2026-10-17): one primary action; opening the internal matches only
     queues the free native matcher; the start opens the budget step and launches nothing. */
  const home = read('src/pages/property/FindBuyersHomePage.tsx');
  const block = home.slice(home.indexOf('<FindBuyersDashboard'), home.indexOf('/>', home.indexOf('<FindBuyersDashboard')));
  assert.match(block, /onOpenInternal=\{\(\) => \{ requestLeadMatching\(propertyId\)/);
  assert.doesNotMatch(block.slice(block.indexOf('onOpenInternal'), block.indexOf('canClear')), /start=1|launch|match-campaign/);
  assert.match(block, /onStart=\{\(\) => navigate\(`\$\{base\}\/buyers\/external\?start=1`\)\}/);
  const external = read('src/pages/property/MatchesPage.tsx');
  assert.match(external, /searchParams\.get\('start'\) !== '1'\) return;\s*setShowBudget\(true\);/, '?start=1 only opens the budget dialog');
  const svc = read('src/services/homatchLeads.ts');
  assert.match(svc, /internal_leads_request_matching[\s\S]{0,120}if \(error\) throw/, 'a refused request is reported');
});
