// The event-driven notification layer, end to end against an in-memory
// database that enforces the same unique keys as the migration:
//
//   1 a quiet cycle costs nothing (0 AI, 0 push, 0 email)
//   2 one meaningful event → exactly one notification
//   3 unchanged evidence → nothing resent
//   4 escalation → one new, louder notification (email attempted, logged)
//   5 resolution → one calm notification
//   8 the Notification Center row carries the event
//   9 cross-tenant: one customer's cycle never touches another's events,
//     and campaign actions refuse another customer's campaign
//  10 no lead PII or secret reaches a title, body or email
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://x.supabase.co' })[k] } };

const { processConditions } = await import('../notifier.ts');
const { guardCondition, briefDue, briefLines } = await import('../monitor.ts');
const { handleAction } = await import('../actions.ts');
const { detect } = await import('../../../../src/lib/metaAds/detect.ts');
const { buildBrief } = await import('../../../../src/lib/metaAds/events.ts');

const UNIQUE = {
  meta_events: ['key'],
  meta_event_notifications: ['event_id', 'transition', 'evidence_fingerprint'],
  notification_deliveries: ['notification_id', 'channel'],
  meta_ai_summaries: ['purpose', 'fingerprint', 'locale'],
};

function fakeDb(seed = {}) {
  const tables = structuredClone(seed);
  const rpcCalls = [];
  const invokes = [];
  let seq = 0;
  const from = (name) => {
    const rows = () => (tables[name] ??= []);
    const filters = [];
    let op = { kind: 'select' };
    const match = (r) => filters.every((f) => f(r));
    const dupOf = (r) => (UNIQUE[name] ? rows().find((x) => UNIQUE[name].every((k) => x[k] === r[k])) : null);
    const api = {
      select() { return api; }, order() { return api; }, limit() { return api; },
      eq(c, v) { filters.push((r) => r[c] === v); return api; },
      in(c, vs) { filters.push((r) => vs.includes(r[c])); return api; },
      is(c, v) { filters.push((r) => (r[c] ?? null) === v); return api; },
      not() { return api; }, lt() { return api; }, lte() { return api; }, gt() { return api; }, gte() { return api; }, or() { return api; }, like() { return api; },
      update(patch) { op = { kind: 'update', patch }; return api; },
      insert(v) {
        const list = Array.isArray(v) ? v : [v];
        const out = [];
        for (const r of list) {
          if (dupOf(r)) return chain({ data: null, error: { message: 'duplicate key value violates unique constraint' } });
          const row = { id: `${name}-${++seq}`, created_at: new Date().toISOString(), ...r };
          rows().push(row); out.push(row);
        }
        return chain({ data: out, error: null });
      },
      upsert(v, opts = {}) {
        const keys = String(opts.onConflict ?? '').split(',').filter(Boolean);
        const hit = keys.length ? rows().find((x) => keys.every((k) => x[k] === v[k])) : null;
        if (hit) { Object.assign(hit, v); return chain({ data: [hit], error: null }); }
        return api.insert(v);
      },
      async maybeSingle() { return { data: run()[0] ?? null, error: null }; },
      async single() { return { data: run()[0] ?? null, error: null }; },
      then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
    };
    const chain = (result) => Object.assign(Promise.resolve(result), {
      select: () => ({ single: async () => ({ data: result.data?.[0] ?? null, error: result.error }), maybeSingle: async () => ({ data: result.data?.[0] ?? null, error: result.error }) }),
    });
    const run = () => {
      const hit = rows().filter(match);
      if (op.kind === 'update') for (const r of hit) Object.assign(r, op.patch);
      return hit;
    };
    return api;
  };
  return {
    from, tables, rpcCalls, invokes,
    rpc: async (fn, args) => {
      rpcCalls.push([fn, args]);
      if (fn === 'notify_emit') {
        const dup = (tables.notifications ??= []).find((n) => args.p_dedupe_key && n.dedupe_key === args.p_dedupe_key);
        if (dup) return { data: dup.id, error: null };
        const id = `notif-${++seq}`;
        tables.notifications.push({ id, user_id: args.p_user_id, type: args.p_type, title: args.p_title, body: args.p_body, priority: args.p_priority,
          deep_link: args.p_deep_link, dedupe_key: args.p_dedupe_key, metadata: args.p_metadata });
        return { data: id, error: null };
      }
      return { data: null, error: null };
    },
    functions: { invoke: async (fn, opts) => { invokes.push([fn, opts]); return { data: null, error: null }; } },
  };
}

const users = () => ({
  users: [
    { id: 'u1', email: 'owner1@example.com', preferred_language: 'en' },
    { id: 'u2', email: 'owner2@example.com', preferred_language: 'ka' },
  ],
  notification_preferences: [{ user_id: 'u1', categories: {}, push_enabled: true, email_enabled: true }],
  push_subscriptions: [{ id: 's1', user_id: 'u1', revoked_at: null }],
});
const camp = { id: 'c1', user_id: 'u1', name: 'Vake 2BR' };
const T0 = Date.parse('2026-10-05T10:00:00Z');
const at = (min) => new Date(T0 + min * 60_000).toISOString();

const deterioration = (severity = 'IMPORTANT', change = 0.4) => ({
  type: 'PERFORMANCE_DETERIORATED', subject: 'campaign', severity, actionRequired: severity === 'CRITICAL',
  evidence: { metric: 'COST_PER_RESULT', change: change >= 0.75 ? 1 : 0.25, confidence: severity === 'CRITICAL' ? 'HIGH_CONFIDENCE' : 'MEANINGFUL_SIGNAL' },
  facts: { change, currentMinor: 900, previousMinor: 600, currency: 'USD' },
  deepLink: '/outreach/meta/campaigns/c1?tab=performance',
});
const SCOPE = ['PERFORMANCE_DETERIORATED', 'PERFORMANCE_IMPROVED'];
const opts = (min) => ({ aiEnabled: true, now: at(min) });

test('1 · a quiet cycle: no condition, no event, no AI, no push, no email', async () => {
  const db = fakeDb(users());
  const s = await processConditions(db, camp, 'u1', [], SCOPE, opts(0));
  assert.deepEqual(s, { conditions: 0, notifications: 0, aiCalls: 0, emails: 0, pushEligible: 0 });
  assert.equal(db.rpcCalls.length, 0, 'notify_emit never called');
  assert.equal((db.tables.meta_events ?? []).length, 0);
  // And a stable campaign produces no condition in the first place.
  const flat = { currency: 'USD', spendMinor: 10000, impressions: 20000, reach: null, clicks: 400, linkClicks: 300, landingPageViews: 0, leads: 40, messages: 0, registrations: 0, postEngagements: 0 };
  const conds = detect({ id: 'c1', goal: 'LEADS_ON_META', status: 'ACTIVE', currency: 'USD', current: flat, previous: flat,
    outcomesCurrent: {}, outcomesPrevious: {}, leadsCurrent: 40, leadsPrevious: 40, health: {}, recommendations: [], creativeClasses: [], connectionOk: true });
  assert.deepEqual(conds, [], 'identical windows are not news');
});

test('2 · 3 · one event → one notification; unchanged evidence → nothing resent', async () => {
  const db = fakeDb(users());
  const s1 = await processConditions(db, camp, 'u1', [deterioration()], SCOPE, opts(0));
  assert.equal(s1.notifications, 1);
  assert.equal(s1.pushEligible, 1, 'IMPORTANT → in-app + push');
  assert.equal(s1.emails, 0, 'IMPORTANT never emails');
  assert.equal(db.tables.notifications.length, 1);
  assert.equal(db.tables.notifications[0].priority, 'HIGH');
  assert.equal(db.invokes.length, 1, 'push-send asked to decide delivery');
  for (const m of [15, 30, 45, 60]) {
    const s = await processConditions(db, camp, 'u1', [deterioration()], SCOPE, opts(m));
    assert.equal(s.notifications, 0, `cycle +${m}m resends nothing`);
  }
  assert.equal(db.tables.notifications.length, 1);
  assert.equal(db.tables.meta_events.length, 1, 'one canonical event, updated in place');
  assert.equal(db.tables.meta_events[0].first_seen_at, at(0));
  assert.equal(db.tables.meta_events[0].last_seen_at, at(60));
});

test('4 · escalation: a CRITICAL change notifies once more, email attempted and logged — never faked', async () => {
  const db = fakeDb(users());
  await processConditions(db, camp, 'u1', [deterioration()], SCOPE, opts(0));
  const s = await processConditions(db, camp, 'u1', [deterioration('CRITICAL', 0.9)], SCOPE, opts(15));
  assert.equal(s.notifications, 1, 'the escalation itself');
  assert.equal(db.tables.notifications.length, 2);
  assert.equal(db.tables.notifications[1].priority, 'CRITICAL');
  const email = db.tables.notification_deliveries.find((d) => d.channel === 'EMAIL');
  assert.ok(email, 'an email attempt is recorded');
  assert.equal(email.status, 'SKIPPED', 'no provider key in this test: SKIPPED, never SENT');
  assert.equal(email.reason, 'NO_PROVIDER');
  assert.equal(s.emails, 0);
  const again = await processConditions(db, camp, 'u1', [deterioration('CRITICAL', 0.9)], SCOPE, opts(30));
  assert.equal(again.notifications, 0, 'the same critical evidence is not repeated');
});

test('5 · resolution: gone for two cycles → one calm notification, then silence', async () => {
  const db = fakeDb(users());
  await processConditions(db, camp, 'u1', [deterioration()], SCOPE, opts(0));
  const miss1 = await processConditions(db, camp, 'u1', [], SCOPE, opts(15));
  assert.equal(miss1.notifications, 0, 'one missing cycle is not a resolution');
  const miss2 = await processConditions(db, camp, 'u1', [], SCOPE, opts(30));
  assert.equal(miss2.notifications, 1, 'resolved');
  assert.equal(db.tables.meta_events[0].state, 'RESOLVED');
  const n = db.tables.notifications.at(-1);
  assert.equal(n.metadata.transition, 'RESOLVED');
  assert.equal(n.priority, 'LOW', 'a resolution of an IMPORTANT event stays in-app');
  const later = await processConditions(db, camp, 'u1', [], SCOPE, opts(45));
  assert.equal(later.notifications, 0);
});

test('8 · the Notification Center row carries the canonical event', async () => {
  const db = fakeDb(users());
  await processConditions(db, camp, 'u1', [deterioration()], SCOPE, opts(0));
  const n = db.tables.notifications[0];
  const e = db.tables.meta_events[0];
  assert.equal(n.user_id, 'u1');
  assert.equal(n.type, 'META_CAMPAIGN_STATUS');
  assert.equal(n.deep_link, '/outreach/meta/campaigns/c1?tab=performance');
  assert.deepEqual({ kind: n.metadata.kind, eventId: n.metadata.eventId, category: n.metadata.category, pref: n.metadata.pref },
    { kind: 'META_EVENT', eventId: e.id, category: 'CAMPAIGN', pref: 'meta_performance' });
  assert.match(n.title, /\S/);
  const hist = db.tables.meta_event_notifications;
  assert.equal(hist.length, 1);
  assert.equal(hist[0].notification_id, n.id);
  assert.deepEqual(hist[0].channels, ['IN_APP', 'PUSH']);
});

test('preferences: performance alerts off → nothing; Guard strikes are mandatory', async () => {
  const seed = users();
  seed.notification_preferences[0].categories = { meta_performance: false };
  const db = fakeDb(seed);
  const s = await processConditions(db, camp, 'u1', [deterioration()], SCOPE, opts(0));
  assert.equal(s.notifications, 0);
  const strike = guardCondition(camp, { action: 'MATERIAL_EDIT', incidentId: 'inc1', decision: { level: 'STRIKE', action: 'NONE', points: 2, windowPoints: 8, strikesAfter: 1, suspend: false, customerKey: 'guard_warning_count' } });
  const g = await processConditions(db, camp, 'u1', [strike], [], opts(0));
  assert.equal(g.notifications, 1, 'integrity messages ignore category switches');
  assert.equal(db.tables.notifications.at(-1).type, 'META_GUARD');
  // A maybe is an admin's question first, never a customer alarm.
  assert.equal(guardCondition(camp, { action: 'POSSIBLE_DUPLICATE', incidentId: 'inc2', decision: { level: 'REVIEW_REQUIRED', action: 'NONE', points: 0, windowPoints: 0, strikesAfter: 0, suspend: false, customerKey: 'x' } }), null);
});

test('9 · cross-tenant: another customer\'s cycle never touches these events; actions refuse foreign campaigns', async () => {
  const db = fakeDb(users());
  await processConditions(db, camp, 'u1', [deterioration()], SCOPE, opts(0));
  const other = { id: 'c1', user_id: 'u2', name: 'x' };
  await processConditions(db, other, 'u2', [], SCOPE, opts(15));
  await processConditions(db, other, 'u2', [], SCOPE, opts(30));
  assert.equal(db.tables.meta_events[0].state, 'OPEN', 'u2 cannot resolve u1\'s event');
  assert.ok(db.tables.notifications.every((n) => n.user_id === 'u1'));

  db.tables.meta_campaigns = [{ id: '11111111-1111-1111-1111-111111111111', user_id: 'u1', status: 'ACTIVE', goal: 'LEADS_ON_META', currency: 'USD' }];
  const json = (b, s = 200) => ({ status: s, body: b });
  for (const action of ['campaign_detail', 'pause', 'end', 'edit_budget', 'strategy_preview']) {
    const r = await handleAction({ sb: db, uid: 'u2', me: { id: 'u2' }, body: { campaignId: '11111111-1111-1111-1111-111111111111', dailyBudgetCents: 900 },
      action, settings: {}, mode: 'MOCK', json, audit: async () => {} });
    assert.equal(r.status, 404, `${action} on another customer's campaign is not found`);
  }
  for (const action of ['admin_guard_overview', 'admin_guard_act', 'admin_fee_policy_set', 'admin_fee_policy_get', 'admin_meta_economics']) {
    const r = await handleAction({ sb: db, uid: 'u2', me: { id: 'u2', is_admin: false }, body: {}, action, settings: {}, mode: 'MOCK', json, audit: async () => {} });
    assert.equal(r.status, 403, `${action} is admin-only`);
  }
});

test('10 · no lead PII or secret in any title, body or email', async () => {
  const db = fakeDb(users());
  const leaky = { id: 'c1', user_id: 'u1', name: 'Call Nino +995 555 12 34 56 or nino@example.com' };
  await processConditions(db, leaky, 'u1', [deterioration('CRITICAL', 0.9)], SCOPE, opts(0));
  const n = db.tables.notifications[0];
  for (const text of [n.title, n.body]) {
    assert.doesNotMatch(text, /nino@example\.com/);
    assert.doesNotMatch(text, /555 12 34 56/);
  }
  const blob = JSON.stringify(db.tables);
  assert.doesNotMatch(blob, /EAA[A-Za-z0-9]{5,}/, 'no Meta token anywhere');
  assert.doesNotMatch(blob, /re_[A-Za-z0-9]{10,}/, 'no Resend key anywhere');
});

test('briefs: 08:00 local, weekly on Mondays, daily only when opted in; totals never mix currencies', () => {
  const mondayTbilisi8 = Date.parse('2026-10-05T04:00:00Z'); // 08:00 Asia/Tbilisi, a Monday
  assert.deepEqual(briefDue(mondayTbilisi8, 'Asia/Tbilisi', { dailyBrief: false, weeklyBrief: true }).map((d) => d.period), ['WEEKLY']);
  assert.deepEqual(briefDue(mondayTbilisi8, 'Asia/Tbilisi', { dailyBrief: true, weeklyBrief: true }).map((d) => d.period), ['DAILY', 'WEEKLY']);
  assert.deepEqual(briefDue(mondayTbilisi8 + 3_600_000, 'Asia/Tbilisi', { dailyBrief: true, weeklyBrief: true }), [], '09:00 is not brief time');
  const b = buildBrief('WEEKLY', 'W:2026-10-05', [
    { id: 'a', name: 'A', status: 'ACTIVE', currency: 'USD', spendMinor: 5000, results: 10, leads: 10, qualified: 3, prevSpendMinor: null, prevResults: null, attention: false },
    { id: 'b', name: 'B', status: 'ACTIVE', currency: 'GEL', spendMinor: 8000, results: 4, leads: 4, qualified: 1, prevSpendMinor: null, prevResults: null, attention: true },
  ], 2, 1);
  assert.equal(b.totals.length, 2, 'one line per currency');
  const lines = briefLines(b, 'ka');
  assert.ok(lines.some((l) => l.includes('ლიდები')));
  assert.ok(lines.every((l) => !/\{\{/.test(l)), 'every placeholder filled');
});
