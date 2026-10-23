// Service Control Center edge function: admin-only door, readiness-gated activation,
// optimistic versioning, pause-all, no secret ever returned. Database and caller faked.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.Deno = { env: { get: () => undefined } };
const { handler } = await import('../index.ts');

const SIX = ['publishing', 'ai_call_center', 'ai_talk', 'whatsapp', 'live_chat', 'design_studio'];
// The live products added by the expansion (migration 20261110090000), seeded ON as in production.
const LIVE = ['find_property', 'find_property_deep', 'find_buyers', 'internal_matching', 'curated_leads', 'verify', 'contracts', 'mortgage', 'investment', 'for_expats',
  'meta_ads', 'email_campaigns', 'ai_assistant', 'brokers_directory', 'broker_desk', 'developers'];
const KEYS = [...SIX, ...LIVE];
const SECRET_VALUE = 'sk-live-super-secret-value';

function world({ admin = true, secrets = {}, killTelephony = true } = {}) {
  const t = {
    service_controls: KEYS.map((k) => {
      const on = LIVE.includes(k);
      return { service_key: k, frontend_enabled: on, backend_enabled: on, version: 1, reason: 'Initial state', updated_by: null, updated_at: 'then' };
    }),
    admin_audit_log: [],
    users: [{ id: 'u-admin', auth_id: 'auth-admin', full_name: 'Owner', email: 'o@h.test' }],
    admin_settings: [{ key: 'ai_talk_enabled', value: true }],
    comm_provider_routes: [{ role: 'TELEPHONY', provider: 'VAPI', enabled: true, kill_switch: killTelephony }, { role: 'MESSAGING', provider: 'META', enabled: true, kill_switch: true }],
    billable_products: [],
    publishing_engine_listings: [], comm_talk_sessions: [], outreach_campaigns: [], comm_conversations: [], live_chat_messages: [], ds_projects: [],
  };
  const from = (table) => {
    const filters = [];
    const q = {
      select: () => q, limit: () => q, order: () => q,
      eq: (k, v) => { filters.push((r) => r[k] === v); return q; },
      in: (k, vs) => { filters.push((r) => vs.includes(r[k])); return q; },
      gt: () => q, not: () => q,
      insert: async (row) => { (t[table] ??= []).push(row); return { error: null }; },
      maybeSingle: async () => ({ data: (t[table] ?? []).filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
      then: (ok, ko) => Promise.resolve(table in t
        ? { data: t[table].filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r })), count: t[table].length, error: null }
        : { data: null, error: { code: '42P01' } }).then(ok, ko),
    };
    return q;
  };
  const rpc = {
    service_control_set({ p_key, p_frontend, p_backend, p_expected_version, p_reason, p_request_id }) {
      const row = t.service_controls.find((r) => r.service_key === p_key);
      let result = 'CHANGED';
      if (row.version !== p_expected_version) result = 'CONFLICT';
      else if (row.frontend_enabled === p_frontend && row.backend_enabled === p_backend) result = 'UNCHANGED';
      else Object.assign(row, { frontend_enabled: p_frontend, backend_enabled: p_backend, version: row.version + 1, reason: p_reason, updated_by: 'u-admin' });
      t.admin_audit_log.push({ admin_id: 'u-admin', action: 'SERVICE_CONTROL_SET', entity_type: 'service_controls', entity_id: p_key, metadata: { result, request_id: p_request_id }, created_at: 'now' });
      return { data: { result, control: { ...row } }, error: null };
    },
    // Same reach as the SQL: the original six only.
    service_control_pause_all() {
      const six = t.service_controls.filter((r) => SIX.includes(r.service_key));
      const changed = six.filter((r) => r.backend_enabled || r.frontend_enabled).map((r) => r.service_key);
      for (const r of six) Object.assign(r, { frontend_enabled: false, backend_enabled: false });
      return { data: { result: changed.length ? 'CHANGED' : 'UNCHANGED', changed }, error: null };
    },
    service_control_pause_group({ p_group, p_confirm }) {
      t.pauseGroupCalls = [...(t.pauseGroupCalls ?? []), { p_group, p_confirm }];
      return { data: { result: 'CHANGED', group: p_group, changed: [] }, error: null };
    },
  };
  const caller = (authorization) => ({
    auth: { getUser: async () => (authorization === 'Bearer nobody' ? { data: { user: null }, error: { message: 'bad' } } : { data: { user: { id: authorization === 'Bearer admin' ? 'auth-admin' : 'auth-customer' } }, error: null }) },
    rpc: async (name, args) => (name === 'is_admin' ? { data: admin && authorization === 'Bearer admin', error: null } : rpc[name](args)),
  });
  const env = (k) => ({ CARTESIA_API_KEY: SECRET_VALUE, OPENAI_API_KEY: SECRET_VALUE, ...secrets })[k];
  return { t, deps: { env, db: { from }, caller } };
}

async function call(w, action, body = {}, token = 'admin', origin = 'https://homatch.live') {
  const res = await handler(new Request('https://edge.test/service-control', { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, ...body }) }), w.deps);
  return { status: res.status, body: await res.json() };
}

test('only an administrator, from the HOMATCH origin, with a valid session', async () => {
  const w = world();
  assert.equal((await call(w, 'overview', {}, 'admin', 'https://evil.test')).status, 403);
  assert.equal((await call(w, 'overview', {}, 'nobody')).status, 401);
  const customer = await call(w, 'overview', {}, 'customer');
  assert.equal(customer.status, 403);
  assert.equal(customer.body.code, 'ADMIN_REQUIRED');
  assert.equal((await call(w, 'set', { service: 'ai_talk', frontend: false, backend: true, expectedVersion: 1 }, 'customer')).status, 403);
  assert.equal((await call(w, 'pause_all', {}, 'customer')).status, 403);
  assert.equal(w.t.service_controls.every((r) => r.backend_enabled === LIVE.includes(r.service_key) && r.version === 1), true, 'nothing changed for a non-admin');
});

test('overview: every service, effective state, readiness by NAME, never a secret value', async () => {
  const w = world();
  const r = await call(w, 'overview');
  assert.equal(r.status, 200);
  /* Service order: the six, the live products, then the paid ones that fail closed — Deep Search
     (2026-10-18) and the legacy paid external discovery (matching workspace, 2026-10-24). */
  assert.deepEqual(r.body.services.map((s) => s.key), [...SIX, ...LIVE.filter((k) => k !== 'find_property_deep'), 'find_property_deep', 'find_buyers_external']);
  const six = r.body.services.filter((s) => SIX.includes(s.key));
  assert.ok(six.every((s) => s.effective === 'PAUSED' && s.frontend === false && s.backend === false && s.failMode === 'CLOSED'), 'the six stay paused and fail closed');
  const live = r.body.services.filter((s) => LIVE.includes(s.key) && s.key !== 'find_property_deep');
  assert.ok(live.every((s) => s.frontend === true && s.backend === true && s.failMode === 'OPEN'), 'the live products are on and fail open');
  assert.equal(r.body.services.find((s) => s.key === 'find_property_deep').failMode, 'CLOSED', 'paid Deep Search fails closed');
  const legacy = r.body.services.find((s) => s.key === 'find_buyers_external');
  assert.deepEqual([legacy.failMode, legacy.backend, legacy.group], ['CLOSED', false, 'discovery'], 'legacy paid discovery: closed and OFF');
  assert.equal(r.body.services.find((s) => s.key === 'verify').group, 'intelligence');
  assert.equal(r.body.services.find((s) => s.key === 'meta_ads').group, 'marketing');
  const talk = r.body.services.find((s) => s.key === 'ai_talk');
  assert.equal(talk.readiness.ready, true);
  const calls = r.body.services.find((s) => s.key === 'ai_call_center');
  assert.equal(calls.readiness.ready, false);
  assert.ok(calls.readiness.missing.includes('SECRET_VAPI_PRIVATE_API_KEY') && calls.readiness.missing.includes('ROUTE_TELEPHONY_VAPI_OFF'));
  assert.doesNotMatch(JSON.stringify(r.body), new RegExp(SECRET_VALUE), 'no secret value in the response');
  assert.equal(r.body.propagationSeconds, 10);
});

test('activation is refused while a blocking prerequisite is missing — audited, nothing changes', async () => {
  const w = world();
  const r = await call(w, 'set', { service: 'ai_call_center', frontend: false, backend: true, expectedVersion: 1, reason: 'try', requestId: 'req-12345678' });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'NOT_READY');
  assert.ok(r.body.missing.includes('ROUTE_TELEPHONY_VAPI_OFF'));
  assert.equal(w.t.service_controls.find((x) => x.service_key === 'ai_call_center').backend_enabled, false, 'left safely disabled');
  assert.equal(w.t.admin_audit_log.at(-1).action, 'SERVICE_CONTROL_NOT_READY');
  assert.equal(w.t.admin_audit_log.at(-1).metadata.request_id, 'req-12345678');
});

test('sequenced activation: backend first, then frontend; a stale version conflicts; disabling is never readiness-gated', async () => {
  const w = world();
  assert.equal((await call(w, 'set', { service: 'ai_talk', frontend: true, backend: false, expectedVersion: 1 })).body.code, 'FRONTEND_REQUIRES_BACKEND');
  const on = await call(w, 'set', { service: 'ai_talk', frontend: false, backend: true, expectedVersion: 1, requestId: 'req-aaaaaaaa' });
  assert.equal(on.status, 200);
  assert.equal(on.body.result, 'CHANGED');
  assert.equal(on.body.control.version, 2);
  const stale = await call(w, 'set', { service: 'ai_talk', frontend: true, backend: true, expectedVersion: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'VERSION_CONFLICT');
  assert.equal(stale.body.control.version, 2, 'the newer state is returned so the page can refresh');
  assert.equal((await call(w, 'set', { service: 'ai_talk', frontend: true, backend: true, expectedVersion: 2 })).body.result, 'CHANGED');
  assert.equal((await call(w, 'set', { service: 'ai_talk', frontend: true, backend: true, expectedVersion: 3 })).body.result, 'UNCHANGED', 'a repeated click is a no-op');
  // Turning OFF a service that is not ready is always allowed.
  const w2 = world();
  w2.t.service_controls.find((x) => x.service_key === 'ai_call_center').backend_enabled = true;
  assert.equal((await call(w2, 'set', { service: 'ai_call_center', frontend: false, backend: false, expectedVersion: 1 })).body.result, 'CHANGED');
});

test('pause all switches off only the six and reports what changed; bad input is refused', async () => {
  const w = world();
  Object.assign(w.t.service_controls.find((x) => x.service_key === 'live_chat'), { backend_enabled: true, frontend_enabled: true });
  const r = await call(w, 'pause_all', { reason: 'owner pause', requestId: 'req-bbbbbbbb' });
  assert.deepEqual(r.body, { result: 'CHANGED', changed: ['live_chat'] });
  assert.ok(LIVE.every((k) => w.t.service_controls.find((x) => x.service_key === k).backend_enabled), 'pause all never reaches a live product');
  assert.equal((await call(w, 'set', { service: 'billing', frontend: false, backend: false, expectedVersion: 1 })).body.code, 'SERVICE_UNKNOWN');
  assert.equal((await call(w, 'set', { service: 'ai_talk', frontend: 'yes', backend: false, expectedVersion: 1 })).body.code, 'INVALID_ARGUMENT');
  assert.equal((await call(w, 'nope')).body.code, 'UNKNOWN_ACTION');
});

test('group pause: one known group, the group name typed as confirmation, never a global switch', async () => {
  const w = world();
  assert.equal((await call(w, 'pause_group', { group: 'marketing' })).body.code, 'CONFIRMATION_REQUIRED');
  assert.equal((await call(w, 'pause_group', { group: 'marketing', confirm: 'yes' })).body.code, 'CONFIRMATION_REQUIRED');
  assert.equal((await call(w, 'pause_group', { group: 'everything', confirm: 'everything' })).body.code, 'GROUP_UNKNOWN');
  assert.equal((await call(w, 'pause_group', { group: 'other', confirm: 'other' })).body.code, 'GROUP_UNKNOWN');
  assert.equal((await call(w, 'pause_group', { group: 'marketing', confirm: 'marketing' }, 'customer')).status, 403);
  assert.equal(w.t.pauseGroupCalls, undefined, 'nothing reached the database before a valid confirmation');
  const ok = await call(w, 'pause_group', { group: 'marketing', confirm: 'marketing', reason: 'drill', requestId: 'req-cccccccc' });
  assert.equal(ok.status, 200);
  assert.deepEqual(w.t.pauseGroupCalls, [{ p_group: 'marketing', p_confirm: 'marketing' }], 'the confirmation is passed through for the database to check again');
});

test('readiness for a live product names its own switches as notes, never as blockers', async () => {
  const { readiness } = await import('../readiness.ts');
  const facts = { secrets: { OPENAI_API_KEY: true }, r2Configured: true,
    tables: { discovery_runs: true, outreach_campaigns: true },
    settings: { find_property_social_enabled: false, provider_disabled_list: '["DATAFORSEO"]', outreach_email_sending_enabled: false },
    routes: [], products: [] };
  const deep = readiness('find_property_deep', facts);
  assert.equal(deep.ready, true, 'a dormant own setting does not block');
  assert.ok(deep.notes.includes('FIND_PROPERTY_SOCIAL_SETTING_OFF'));
  const email = readiness('email_campaigns', facts);
  assert.equal(email.ready, true);
  assert.ok(email.notes.includes('EMAIL_SENDING_SETTING_OFF'));
  assert.equal(readiness('verify', { ...facts, secrets: {} }).ready, false, 'Verify cannot run without its AI key');
});
