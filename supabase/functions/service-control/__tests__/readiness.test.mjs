import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readiness, SECRETS_CHECKED, TABLES_CHECKED } from '../readiness.ts';

const all = (list) => Object.fromEntries(list.map((k) => [k, true]));
const full = () => ({
  secrets: all(SECRETS_CHECKED), r2Configured: true, tables: all(TABLES_CHECKED), settings: { ai_talk_enabled: true, design_studio_billing_enabled: true },
  routes: [{ role: 'TELEPHONY', provider: 'VAPI', enabled: true, kill_switch: false }, { role: 'MESSAGING', provider: 'META', enabled: true, kill_switch: false }],
  products: [{ code: 'AI_CALL', enabled: true, pricing_active: true, kill_switch: false }, { code: 'WHATSAPP', enabled: true, pricing_active: true, kill_switch: false }],
});

test('everything present → every service READY', () => {
  for (const k of ['publishing', 'ai_call_center', 'ai_talk', 'whatsapp', 'live_chat', 'design_studio']) {
    const r = readiness(k, full());
    assert.equal(r.ready, true, `${k}: ${r.missing}`);
  }
});

test('a missing credential, schema or provider route is BLOCKING and named, never valued', () => {
  const f = full();
  f.secrets.CARTESIA_API_KEY = false;
  f.secrets.RUNPOD_API_KEY = false;
  f.r2Configured = false;
  f.routes[0].kill_switch = true;
  f.routes[1].enabled = false;
  f.tables.live_chat_messages = false;
  assert.deepEqual(readiness('ai_talk', f).missing, ['SECRET_CARTESIA_API_KEY']);
  assert.deepEqual(readiness('design_studio', f).missing, ['SECRET_RUNPOD_API_KEY', 'STORAGE_R2_NOT_CONFIGURED']);
  assert.deepEqual(readiness('ai_call_center', f).missing, ['ROUTE_TELEPHONY_VAPI_OFF']);
  assert.deepEqual(readiness('whatsapp', f).missing, ['ROUTE_MESSAGING_META_OFF']);
  assert.deepEqual(readiness('live_chat', f).missing, ['SCHEMA_live_chat_messages']);
  for (const k of ['ai_talk', 'design_studio', 'ai_call_center', 'whatsapp', 'live_chat']) assert.equal(readiness(k, f).ready, false);
});

test('a service\'s own downstream switches are NOTES: ON never reads as "everything works"', () => {
  const f = full();
  f.settings.ai_talk_enabled = false;
  f.products[0].pricing_active = false;
  f.tables.publishing_accounts = false;
  f.secrets.PUBLISHING_WORKER_TOKEN = false;
  assert.deepEqual(readiness('ai_talk', f), { ready: true, missing: [], notes: ['AI_TALK_SETTING_OFF'] });
  assert.deepEqual(readiness('ai_call_center', f), { ready: true, missing: [], notes: ['PRODUCT_AI_CALL_NOT_PRICED'] });
  const p = readiness('publishing', f);
  assert.equal(p.ready, true, 'the owner-handoff workspace runs without the automation pieces');
  assert.ok(p.notes.includes('PUBLISHING_CENTRAL_MIGRATION_NOT_APPLIED') && p.notes.includes('PUBLISHING_WORKER_TOKEN_NOT_SET'));
});

test('today\'s production shape: telephony and messaging kill-switched → AI Call Center and WhatsApp are NOT READY', () => {
  const f = full();
  f.routes = [{ role: 'TELEPHONY', provider: 'VAPI', enabled: true, kill_switch: true }, { role: 'MESSAGING', provider: 'META', enabled: true, kill_switch: true }];
  assert.ok(readiness('ai_call_center', f).missing.includes('ROUTE_TELEPHONY_VAPI_OFF'));
  assert.ok(readiness('whatsapp', f).missing.includes('ROUTE_MESSAGING_META_OFF'));
});
