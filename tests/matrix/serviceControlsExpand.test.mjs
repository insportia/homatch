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

test('one list of services: database, server and browser agree', () => {
  const check = MIGRATION.match(/check \(service_key in \(([\s\S]*?)\)\);/)[1];
  const sqlKeys = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual([...edge.SERVICE_KEYS].sort(), sqlKeys);
  assert.deepEqual([...front.SERVICE_KEYS].sort(), sqlKeys);
  assert.deepEqual([...front.PAUSED_BY_DEFAULT], [...edge.PAUSED_BY_DEFAULT], 'the same six fail closed on both sides');
  assert.deepEqual([...front.LIVE_BY_DEFAULT], [...edge.LIVE_BY_DEFAULT]);
});

test('every new row is seeded ON, in the group the Admin page shows', () => {
  const seeds = [...MIGRATION.matchAll(/\('([a-z_]+)',\s+(true|false), (true|false), '([a-z]+)'/g)];
  assert.equal(seeds.length, edge.LIVE_BY_DEFAULT.length);
  const api = read('supabase/functions/service-control/index.ts');
  for (const [, key, f, b, group] of seeds) {
    assert.ok(edge.LIVE_BY_DEFAULT.includes(key), key);
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
    '/brokers': 'brokers_directory', '/brokers/9': 'brokers_directory', '/broker': 'broker_desk', '/broker/onboarding': 'broker_desk',
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
    'supabase/functions/match-campaign/index.ts': ['find_buyers'],
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
