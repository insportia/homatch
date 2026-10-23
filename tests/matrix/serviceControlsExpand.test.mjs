// Service Control Center expansion (docs/claude/SERVICE_CONTROLS_INVENTORY.md): one list
// of services everywhere, platform addresses never gated, every service named in six
// languages, and every new server gate wired to the right key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const front = await import(join(ROOT, 'src/lib/serviceControls/core.ts'));
const edge = await import(join(ROOT, 'supabase/functions/_shared/serviceControl.ts'));
const { serviceForPath } = await import(join(ROOT, 'src/lib/serviceControls/routes.ts'));
const { translations } = await import(join(ROOT, 'src/i18n/translations.ts'));
const MIGRATION = read('supabase/migrations/20261110090000_service_controls_expand.sql');
/* The key list is redefined when a service is added; the newest definition is the truth.
   20261127090000 added the matching workspace keys (owner, 2026-10-24). */
const MATCHING = read('supabase/migrations/20261127090000_curated_leads_marketplace.sql');
const MATCHING_KEYS = ['internal_matching', 'curated_leads', 'find_buyers_external'];

test('one list of services: database, server and browser agree', () => {
  const check = MATCHING.match(/check \(service_key in \(([\s\S]*?)\)\);/)[1];
  const sqlKeys = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual([...edge.SERVICE_KEYS].sort(), sqlKeys);
  assert.deepEqual([...front.SERVICE_KEYS].sort(), sqlKeys);
  assert.deepEqual([...front.PAUSED_BY_DEFAULT], [...edge.PAUSED_BY_DEFAULT], 'the same six fail closed on both sides');
  assert.deepEqual([...front.LIVE_BY_DEFAULT], [...edge.LIVE_BY_DEFAULT]);
  assert.deepEqual([...front.PAID_CLOSED_BY_DEFAULT], [...edge.PAID_CLOSED_BY_DEFAULT], 'paid Deep Search fails closed on both sides');
});

test('every new row is seeded ON, in the group the Admin page shows', () => {
  const seeds = [...MIGRATION.matchAll(/\('([a-z_]+)',\s+(true|false), (true|false), '([a-z]+)'/g)];
  /* Seeded ON on 2026-11-10 when every one was live; paid Deep Search was paused later (20261116100000, #269). */
  const seededLive = [...edge.LIVE_BY_DEFAULT, ...edge.PAID_CLOSED_BY_DEFAULT].filter((k) => !MATCHING_KEYS.includes(k));
  assert.equal(seeds.length, seededLive.length);
  const api = read('supabase/functions/service-control/index.ts');
  for (const [, key, f, b, group] of seeds) {
    assert.ok(seededLive.includes(key), key);
    assert.equal(f + b, 'truetrue', `${key} is live today, so it is seeded ON`);
    assert.match(api, new RegExp(`${key}: '${group}'`), `${key} is in group ${group} on the Admin page too`);
  }
  // Top-level statements only: the pause functions' bodies ($$ … $$) flip switches when an
  // admin calls them, which is their job; the migration itself must not.
  const topLevel = MIGRATION.replace(/\$\$[\s\S]*?\$\$/g, '');
  assert.match(MIGRATION, /\$\$[\s\S]*update public\.service_controls set frontend_enabled = false/i, 'premise: the pause bodies are what the strip removes');
  assert.doesNotMatch(topLevel, /update public\.service_controls set (frontend|backend)_enabled/i, 'the migration never flips an existing switch');
});

test('platform addresses are never gated', () => {
  for (const path of ['/', '/dashboard', '/profile', '/credits', '/pricing', '/notifications', '/activity', '/chat', '/leads',
    '/property', '/property/add', '/property/123', '/property/123/edit', '/outreach', '/outreach/campaigns', '/outreach/billing',
    '/auth/login', '/about', '/for-buyers', '/for-owners', '/partners', '/admin/verify', '/admin/service-control',
    '/s/token', '/projects/acme/tower', '/buyer/token', '/p/ws/proj', '/embed/ws/proj', '/w/token', '/d/token']) {
    assert.equal(serviceForPath(path), null, `${path} must never be gated`);
  }
});

test('each product address belongs to its own service', () => {
  const expect = {
    '/find-property': 'find_property', '/find-property/search/1': 'find_property',
    '/property/1/matches': 'find_buyers', '/property/1/buyers/external': 'find_buyers', '/property/1/leads': 'find_buyers', '/property/1/buyer/k': 'find_buyers',
    '/verify': 'verify', '/verify/history': 'verify', '/contracts': 'contracts', '/mortgage': 'mortgage', '/investment': 'investment',
    '/for-expats/georgia': 'for_expats', '/outreach/meta': 'meta_ads', '/outreach/meta/create': 'meta_ads',
    '/outreach/email': 'email_campaigns', '/email-studio': 'email_campaigns', '/ai': 'ai_assistant',
    '/broker': 'broker_desk', '/broker/onboarding': 'broker_desk',
    '/brokers': 'brokers_directory', '/brokers/9': 'brokers_directory', '/admin/brokers': null,
    '/developers': 'developers', '/developers/home': 'developers',
    '/live-chat': 'live_chat', '/design-studio': 'design_studio', '/publishing': 'publishing', '/outreach/calls': 'ai_call_center',
  };
  for (const [path, key] of Object.entries(expect)) assert.equal(serviceForPath(path), key, path);
});

test('every service is named and described in all six languages', () => {
  const gate = read('src/components/serviceControls/ServiceGate.tsx');
  const page = read('src/pages/admin/AdminServiceControlPage.tsx');
  for (const key of front.SERVICE_KEYS) {
    assert.match(gate, new RegExp(`${key}: 'svc_name_${key}'`), `${key} has a name key`);
    assert.match(page, new RegExp(`${key}: 'svc_desc_${key}'`), `${key} has a description key`);
    for (const lang of ['en', 'ka', 'ru', 'tr', 'ar', 'he']) {
      assert.ok(translations[lang][`svc_name_${key}`], `svc_name_${key} in ${lang}`);
      assert.ok(translations[lang][`svc_desc_${key}`], `svc_desc_${key} in ${lang}`);
    }
  }
});

test('every new server gate checks its own key', () => {
  const gates = {
    'supabase/functions/marketplace-search/index.ts': ['find_property'],
    'supabase/functions/find-property-plan/index.ts': ['find_property'],
    'supabase/functions/find-property-run/index.ts': ['find_property_deep'],
    /* Paid Deep Search paused (2026-10-18): the worker and the free search's social add-in ask too. */
    'supabase/functions/_shared/findProperty/socialOffers.ts': ['find_property_deep'],
    'supabase/functions/_shared/marketplaceSearch.ts': ['find_property_deep'],
    'supabase/functions/match-campaign/index.ts': ['find_buyers', 'find_buyers_external'],
    /* Matching workspace (2026-10-24): the legacy paid discovery key closes new runs; unlocks
       ask the product's own key. */
    'supabase/functions/external-discovery-orchestrator/index.ts': ['find_buyers_external'],
    'supabase/functions/atomic-unlock/index.ts': ['internal_matching', 'curated_leads'],
    'supabase/functions/research-agent/index.ts': ['verify'],
    'supabase/functions/deal-room-document-analyze/index.ts': ['contracts'],
    'supabase/functions/deal-room-ai/index.ts': ['contracts'],
    'supabase/functions/jobs-worker/index.ts': ['contracts'],
    'supabase/functions/investment-research/index.ts': ['investment'],
    'supabase/functions/investment-consultant/index.ts': ['investment'],
    'supabase/functions/meta-ads-api/index.ts': ['meta_ads'],
    'supabase/functions/outreach-send/index.ts': ['email_campaigns'],
    'supabase/functions/comm-campaign-launch/index.ts': ['email_campaigns'],
    'supabase/functions/_shared/emailStudio.ts': ['email_campaigns'],
    'supabase/functions/homatch-ai/index.ts': ['find_property', 'mortgage', 'ai_call_center', 'ai_assistant'],
    'supabase/functions/developer-document-extract/index.ts': ['developers'],
    'supabase/functions/developer-floorplan-extract/index.ts': ['developers'],
  };
  for (const [file, keys] of Object.entries(gates)) {
    const src = read(file);
    for (const key of keys) assert.ok(src.includes(`'${key}'`), `${file} gates ${key}`);
    assert.match(src, /serviceBackendEnabled(ForCaller)?\(/, `${file} asks the switch`);
  }
  assert.match(MIGRATION, /before insert on public\.broker_listing_purchases[\s\S]*service_control_guard\('brokers_directory'\)/);
});

test('there is no global switch: group pause needs a typed confirmation, pause-all keeps its old reach', () => {
  assert.match(MIGRATION, /if p_confirm is distinct from p_group then raise exception 'CONFIRMATION_REQUIRED'/);
  assert.match(MIGRATION, /service_control_pause_all[\s\S]*where service_key in \('publishing', 'ai_call_center', 'ai_talk', 'whatsapp', 'live_chat', 'design_studio'\)/);
  const page = read('src/pages/admin/AdminServiceControlPage.tsx');
  assert.doesNotMatch(page, /pauseAllServices/, 'the Admin page offers no pause-everything button');
  assert.match(page, /disabled=\{pending\?\.kind === 'pause_group' && typed\.trim\(\) !== pending\.group\}/);
});

test('Brokers directory hidden means hidden everywhere (owner, 2026-10-18, replacing "Option A")', () => {
  // Every customer entry point to /brokers obeys brokers_directory; reversible, nothing deleted.
  assert.match(read('src/lib/serviceControls/routes.ts'), /\[\/\^\\\/brokers\(\\\/\|\$\)\/, 'brokers_directory'\]/, '/brokers and /brokers/:id are gated');
  assert.match(read('src/site/publicNav.ts'), /brokers: 'brokers_directory'/, 'the public B2B menu link');
  assert.match(read('src/site/render/SitePage.tsx'), /brokers: 'brokers_directory'/, 'the home page Brokers section');
  assert.match(read('src/lib/ai/serviceActions.ts'), /BROKERS: 'brokers_directory'/, 'the AI chip to the directory');
  assert.match(read('src/components/home/AiTalkPanel.tsx'), /destination && live && pathAvailable\(destination\.path\)/, 'AI TALK offers no paused address');
  assert.match(read('src/pages/BrokerCrmPage.tsx'), /isPublic && pathAvailable\(`\/brokers\/\$\{listing\.id\}`\)/, 'the desk links to the public profile only while it is shown');
  assert.match(read('src/pages/auth/SignupPage.tsx'), /\{deskVisible && <label[^>]*data-signup-professional/, 'no professional sign-up while the desk is hidden');
  // The sidebar, About grid and product entry page filter by address, so the route rule covers them.
  for (const f of ['src/components/layouts/HomatchShell.tsx', 'src/components/home/sections/about.tsx', 'src/pages/ProductEntryPage.tsx']) {
    assert.match(read(f), /pathAvailable\(/, f);
  }
  // The data is untouched: the public view still selects exactly the paid, current set.
  assert.match(read('supabase/migrations/20261001120000_workstream_b_final_hardening.sql'),
    /where l\.status = 'ACTIVE' and l\.paid_until is not null and l\.paid_until > now\(\)/);
});

test('Broker Desk while sales are paused: no Buy/Renew, a localized notice, a mapped refusal', () => {
  const desk = read('src/pages/BrokerCrmPage.tsx');
  assert.match(desk, /const salesOpen = useServiceVisible\('brokers_directory'\)/);
  assert.match(desk, /PURCHASABLE\.includes\(listing\.status\) && !suspended && price != null && salesOpen && \(/, 'the buy/renew button needs open sales');
  assert.match(desk, /<AlertDialog open=\{confirmBuy && salesOpen\}/, 'the price confirmation cannot open while paused');
  assert.match(desk, /data-testid="broker-sales-paused"/);
  assert.match(read('src/components/broker/errors.ts'), /SERVICE_DISABLED: 'broker_err_sales_paused'/, 'a refusal racing the pause reads clearly');
  for (const key of ['broker_desk_sales_paused_title', 'broker_desk_sales_paused_public', 'broker_desk_sales_paused_body', 'broker_err_sales_paused']) {
    for (const lang of ['en', 'ka', 'ru', 'tr', 'ar', 'he']) assert.ok(translations[lang][key], `${key} in ${lang}`);
  }
  for (const lang of ['en', 'ka', 'ru', 'tr', 'ar', 'he']) assert.match(translations[lang].broker_desk_sales_paused_public, /\{\{date\}\}/, `date placeholder in ${lang}`);
});

test('a paused product that mounts for a moment cannot strand its visitor on an error page', () => {
  const gate = read('src/components/serviceControls/ServiceGate.tsx');
  assert.match(gate, /<GateBoundary service=\{service\} loaded=\{snapshot\.loaded\}>\{children\}<\/GateBoundary>/, 'live children are wrapped');
  assert.match(gate, /if \(!this\.props\.loaded\) return <div className="min-h-\[50vh\]" aria-busy="true" \/>;\n\s*throw this\.state\.error;/,
    'an error waits for the first answer, then (still live) reaches the app boundary unchanged');
  const core = read('src/lib/serviceControls/core.ts');
  assert.match(core, /export const RETRY_AFTER_UNREADABLE_MS: readonly number\[\] = \[1_500, 4_000, 10_000\];/);
  assert.match(core, /if \(error\) \{ failed\(\); return; \}/, 'an unreadable answer schedules a quick retry');
});
