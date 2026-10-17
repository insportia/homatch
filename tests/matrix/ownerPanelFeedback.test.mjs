// Owner feedback 2026-10-17 (live search running): the Panel showed old "matches", the clear
// action was hard to find, and the broker add-on looked like a plain checkbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('the Panel headline counts the people the searches found, not the legacy matches table', () => {
  const page = read('src/pages/DashboardPage.tsx');
  const summary = read('src/services/dashboardSummary.ts');
  assert.match(summary, /getPortfolioPeople\(ids\)/);
  assert.match(page, /label=\{t\('dash_stat_people'\)\}[\s\S]{0,80}value=\{data\.people \? data\.people\.total : null\}/);
  assert.doesNotMatch(page, /label=\{t\('dash_total_matches'\)\}/, 'no legacy "total matches" headline');
  /* Running searches come from matching_jobs, not the property's standing flag. */
  assert.match(page, /label=\{t\('dash_stat_searching'\)\}[\s\S]{0,40}value=\{liveRuns\.length\}/);
  assert.doesNotMatch(page, /matching_status === 'ACTIVE'\)\.length/);
});

test('the portfolio count uses the results page rule, each person once', () => {
  const leads = read('src/services/findBuyersLeads.ts');
  assert.match(leads, /export async function getPortfolioPeople[\s\S]{0,900}placeLead\(classifyLead\([\s\S]{0,200}personKey\(/);
  assert.match(leads, /from\('find_buyers_current_leads'\)\.select\(columns\)\.in\('property_id', propertyIds\)/);
});

test('the live search strip is full-width text, opens the live module, never truncates', () => {
  const page = read('src/pages/DashboardPage.tsx');
  const strip = page.slice(page.indexOf('function LiveRunStrip'), page.indexOf('function MatchRow'));
  assert.doesNotMatch(strip, /\btruncate\b/);
  assert.match(strip, /t\('dash_live_title'\)/);
  assert.match(page, /onOpen=\{\(\) => navigate\(`\/property\/\$\{run\.property_id\}\/buyers\/external`\)\}/);
});

test('the dashboard features the newest search, a running one included', () => {
  const lc = read('src/findBuyers/leadCampaigns.ts');
  assert.match(lc, /export function featuredCampaign[\s\S]{0,140}return list\[0\];/);
});

test('clearing is a visible card on the Find Buyers dashboard and a button on the property page', () => {
  const dash = read('src/components/findBuyers/FindBuyersDashboard.tsx');
  assert.match(dash, /data-testid="fbd-clear"[\s\S]{0,600}t\('fbrx_clear_card_desc'\)[\s\S]{0,200}data-testid="fbd-clear-open" className=\{cn\(LINE_BTN/);
  const detail = read('src/pages/property/PropertyDetailPage.tsx');
  assert.match(detail, /data-testid="pow-clear-open"/);
  assert.match(detail, /<ClearResultsDialog open=\{clearOpen\}/);
});

test('the broker add-on is a premium switch with its price stated, never a literal price', () => {
  const panel = read('src/components/campaign/CampaignLaunchPanel.tsx');
  assert.match(panel, /role="switch"[\s\S]{0,80}aria-checked=\{discoverBrokers\}/);
  assert.match(panel, /t\('fbrx_broker_addon'\)/);
  assert.match(panel, /campaign_broker_opt_price/);
  assert.doesNotMatch(panel, /type="checkbox"[\s\S]{0,120}discoverBrokers/);
});
