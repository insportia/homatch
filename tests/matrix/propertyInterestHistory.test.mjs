// The interest history speaks the same place vocabulary as the matcher, and never
// turns behaviour into seller intent or into a match.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const SQL = read('supabase/migrations/20261107093700_property_interest_history.sql');
const PLACE = read('src/research-core/normalize/place.ts');

const rowsOf = (src, re) => [...src.matchAll(re)].map((m) => m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).join('|'));

test('SQL place rows are exactly the PLACES table of normalize/place.ts', () => {
  const ts = rowsOf(PLACE.slice(PLACE.indexOf('const PLACES'), PLACE.indexOf('const INDEX')), /^\s*\[([^\]]+)\],/gm);
  const sql = rowsOf(SQL.slice(SQL.indexOf('with places(names)'), SQL.indexOf('select coalesce(')), /\(array\[([^\]]+)\]\)/g);
  assert.ok(ts.length >= 24);
  assert.deepEqual(sql, ts);
});

test('seller/landlord sides only on explicit events; observed is behaviour only', () => {
  assert.match(SQL, /constraint property_interest_sell_side_explicit check/);
  assert.match(SQL, /or \(intent_basis = 'EXPLICIT' and event_type in \('PROPERTY_LISTED'/);
  assert.match(SQL, /constraint property_interest_observed_kinds check/);
});

test('telemetry is not intent: nothing here creates demand rows or matches', () => {
  const code = SQL.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /insert into public\.(intent_profiles|active_search_subscriptions|supply_matches|matches)\b/);
});

test('instrumentation never blocks the source write', () => {
  for (const fn of ['interest_event_from_search', 'interest_event_from_subscription', 'interest_event_from_contact', 'interest_event_from_listing', 'interest_event_from_paid_run']) {
    const body = SQL.slice(SQL.indexOf(`function public.${fn}()`));
    assert.match(body.slice(0, 3000), /exception when others then raise warning/, fn);
  }
});

test('customer surface: own rows, minimised, opt-out, erasure; retention off by default', () => {
  assert.match(SQL, /using \(user_id = public\.current_homatch_user_id\(\)\)/);
  assert.match(SQL, /'TRACKING_OFF'/);
  assert.match(SQL, /function public\.delete_my_property_interest_history\(\)/);
  assert.match(SQL, /\('interest_history_purge_enabled', 'false'::jsonb\)/);
  assert.match(SQL, /revoke all on function public\.record_interest_event\(jsonb\) from public, anon, authenticated/);
});
