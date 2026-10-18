// FIND BUYERS 2.0 — a Marketplace Search becomes ONE real demand per distinct search
// (owner, 2026-10-18). The same search again refreshes the profile the person already has;
// a different search is a different demand; rooms and stated features reach the profile the
// matcher reads; and before the migration is applied the search still records its demand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { memDb } from './memDb.mjs';

globalThis.Deno ??= { env: { get: () => '' } };
const { recordSeekerIntent } = await import('../seekerIntent.ts');
const { toSearchPlanDraft, demandExtrasFromBrief, demandFingerprint, emptyBrief } = await import('../../../../src/research-core/marketplace/brief.ts');

function brief(districts = ['Krtsanisi']) {
  const b = emptyBrief('2 bedrooms in Krtsanisi up to 250k with parking');
  b.transactionType = { value: 'BUY', status: 'STATED' };
  b.propertyType = { value: 'APARTMENT', status: 'STATED' };
  b.city = { value: 'Tbilisi', status: 'STATED' };
  b.districts = { value: districts, status: 'STATED' };
  b.price = { value: { min: 150000, max: 250000 }, status: 'STATED' };
  b.bedrooms = { value: { min: 2, max: 2 }, status: 'STATED' };
  b.rooms = { value: { min: 3, max: 3 }, status: 'STATED' };
  b.parking = { value: true, status: 'STATED' };
  return b;
}
const record = (db, b, searchId) => recordSeekerIntent(db, 'user-1', toSearchPlanDraft(b), { marketplaceSearchId: searchId },
  { ...demandExtrasFromBrief(b), fingerprint: demandFingerprint(b) });

test('the same search twice is one demand, refreshed; rooms and features reach the profile', async () => {
  const m = memDb({ intent_profiles: [], active_search_subscriptions: [] });
  const first = await record(m.db, brief(), 's1');
  assert.ok(first);
  const second = await record(m.db, brief(), 's2');
  assert.equal(second, first, 'the existing demand is reused');
  assert.equal(m.tables.active_search_subscriptions.length, 1);
  assert.equal(m.tables.intent_profiles.length, 1);
  const sub = m.tables.active_search_subscriptions[0];
  assert.equal(sub.search_criteria.marketplaceSearchId, 's2', 'the latest search is the one remembered');
  assert.equal(sub.demand_source, 'MARKETPLACE_SEARCH');
  assert.match(sub.demand_fingerprint, /^[0-9a-f]{64}$/, 'stored as a hash, not the criteria');
  const ip = m.tables.intent_profiles[0];
  assert.equal(ip.rooms_min, 3); assert.equal(ip.rooms_max, 3);
  assert.deepEqual(ip.requirements, { parking: true });
  assert.ok(ip.last_active_at, 'activity refreshed');
});

test('a different search is a different demand', async () => {
  const m = memDb({ intent_profiles: [], active_search_subscriptions: [] });
  const a = await record(m.db, brief(['Krtsanisi']), 's1');
  const b = await record(m.db, brief(['Vake']), 's2');
  assert.notEqual(a, b);
  assert.equal(m.tables.active_search_subscriptions.length, 2);
});

test('before the migration is applied the search still records its demand (no new columns)', async () => {
  const m = memDb({ intent_profiles: [], active_search_subscriptions: [] });
  const NEW = ['requirements', 'last_active_at', 'demand_fingerprint', 'demand_source'];
  const db = {
    ...m.db,
    from(name) {
      const b = m.db.from(name);
      const insert = b.insert.bind(b);
      b.insert = (p) => (NEW.some((c) => c in p) ? { select: () => ({ single: async () => ({ data: null, error: { code: '42703', message: 'column does not exist' } }) }), then: (r) => r({ data: null, error: { code: '42703', message: 'column does not exist' } }) } : insert(p));
      const eq = b.eq.bind(b);
      b.eq = (c, v) => (c === 'demand_fingerprint' ? { limit: () => ({ maybeSingle: async () => ({ data: null, error: { code: '42703' } }) }) } : eq(c, v));
      return b;
    },
    rpc: m.db.rpc,
  };
  const id = await record(db, brief(), 's1');
  assert.ok(id, 'demand recorded');
  assert.equal(m.tables.active_search_subscriptions.length, 1);
  assert.equal(m.tables.intent_profiles[0].rooms_min, 3, 'rooms use columns that already existed');
});
