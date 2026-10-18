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

test('admins can re-check stored results with the current rules: preview, then an explicit apply', () => {
  const tools = read('src/components/admin/FindBuyersTestTools.tsx');
  assert.match(tools, /requalifyProperty\(id, false\)/, 'preview is a dry run');
  assert.match(tools, /disabled=\{!rqPreview \|\| rqPreview\.propertyId !== rqProperty\.trim\(\) \|\| busy !== null\} data-testid="fbx-requalify-apply"/, 'apply only after a preview of the same property');
  const svc = read('src/services/findBuyers.ts');
  assert.match(svc, /mode: 'admin_requalify', matchingJobId: c\.matching_job_id, apply/);
});

// Owner feedback 2026-10-17 (screenshots): words broke letter by letter in narrow cells, the
// push "off" button read as the status sentence, notifications were not premium, and the
// earlier internal matches (opened contacts) could not be removed.
test('Panel labels and headers keep whole words on a phone', () => {
  const page = read('src/pages/DashboardPage.tsx');
  assert.match(page, /flex min-w-0 flex-col items-start gap-2\.5/, 'icon above the stat label');
  assert.match(page, /flex-\[1_1_11rem\]/, 'card header title keeps a real width; the action wraps under it');
  assert.match(page, /whitespace-normal rounded-full px-5 py-2\.5 text-center/, 'mortgage CTA wraps inside its pill');
  const dash = read('src/components/findBuyers/FindBuyersDashboard.tsx');
  assert.match(dash, /block whitespace-nowrap font-medium tabular-nums[^"]*" dir="auto">\{fmt\(c\.createdAt\)\}/, 'previous-search date on its own line');
  const results = read('src/components/findBuyers/ExternalResultsView.tsx');
  assert.doesNotMatch(results, /line-clamp-2 w-full break-words text-2xs font-semibold leading-tight opacity-90/, 'tab labels are never clipped');
  assert.match(results, /grid grid-cols-1 gap-1\.5 rounded-2xl bg-white p-1\.5[^"]*min-\[440px\]:grid-cols-3/);
});

test('research cards name Facebook kinds only for Facebook', () => {
  const results = read('src/components/findBuyers/ExternalResultsView.tsx');
  assert.match(results, /toUpperCase\(\) === 'FACEBOOK' \|\| op\.sourceKind === 'AD' \? sourceKindKey\(op\.sourceKind\) : null/);
});

test('push settings: status and actions do not overlap; "Turn off" is an action', () => {
  const s = read('src/components/notifications/NotificationSettings.tsx');
  assert.match(s, /data-testid="notif-push-status"/);
  assert.match(s, /t\('notif_push_turn_off'\)/);
  assert.doesNotMatch(s, /\{t\('notif_push_off'\)\}/, 'the status sentence is not a button label');
  const i18n = read('src/i18n/translations.ts');
  assert.equal((i18n.match(/^\s*notif_push_turn_off:/gm) ?? []).length, 6);
});

test('earlier internal matches: a closed band, and opened contacts can be hidden (never deleted)', () => {
  const page = read('src/pages/property/MatchesPage.tsx');
  assert.match(page, /data-testid="fbx-legacy-toggle"/);
  assert.match(page, /\{showLegacy && currentMatches\.length > 0 && \(/);
  assert.match(page, /<ClearResultsDialog open=\{showClear\}[^>]*includeOpenedByDefault/);
  const dialog = read('src/components/findBuyers/ClearResultsDialog.tsx');
  assert.match(dialog, /includeOpenedByDefault = false/, 'never the default on the dashboard');
  assert.match(dialog, /includeOpened && opened > 0 && \(await hideOpenedContacts\(propertyId\)\) === null/);
  const mig = read('supabase/migrations/20261113090000_find_buyers_hide_opened_contacts.sql');
  assert.match(mig, /set owner_cleared_at = v_now[\s\S]*m\.status::text = 'UNLOCKED'/);
  assert.doesNotMatch(mig, /\bdelete\s+from\b/i);
  assert.match(mig, /p\.user_id = public\.auth_user_id\(\)/, 'owner only');
});
