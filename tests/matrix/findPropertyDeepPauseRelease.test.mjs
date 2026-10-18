// PAID FIND PROPERTY DEEP SEARCH — paused (owner, 2026-10-18). Contract: the migration moves
// exactly two switches; every paid path on main refuses or skips while they are off; the free
// portal search and Find Buyers are untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261116100000_find_property_deep_paused.sql');
const code = sql.replace(/--.*$/gm, '');

test('the migration turns off only the Deep Search control and its social switch', () => {
  assert.match(code, /update public\.service_controls[\s\S]*frontend_enabled = false[\s\S]*backend_enabled = false[\s\S]*where service_key = 'find_property_deep'/);
  assert.match(code, /update public\.admin_settings[\s\S]*'false'::jsonb[\s\S]*where key = 'find_property_social_enabled'/);
  assert.doesNotMatch(code, /\b(delete|drop|truncate|insert)\b/i);
  for (const other of ["'find_property'", "'find_buyers'", 'marketplace_search_enabled', 'find_property_discovery_enabled']) assert.ok(!code.includes(other), other);
  assert.doesNotMatch(code, /\b(begin|commit)\b/i, 'the runner owns the transaction');
});

test('start is refused before any reservation while find_property_deep is off', () => {
  const run = read('supabase/functions/find-property-run/index.ts');
  const gate = run.indexOf("serviceBackendEnabled(db, 'find_property_deep')");
  assert.ok(gate > 0);
  const reserve = run.indexOf('await beginExecution(');
  assert.ok(reserve > 0 && gate < reserve, 'the gate comes before the credit reservation (beginExecution)');
  assert.match(run.slice(gate, gate + 200), /return json\(serviceDisabledBody\('find_property_deep'\), 503\)/);
});

test('the worker starts no social offer run while find_property_social_enabled is off', () => {
  const offers = read('supabase/functions/_shared/findProperty/socialOffers.ts');
  assert.match(offers, /enabled: m\.get\('find_property_social_enabled'\) === true/);
  assert.match(offers, /if \(!settings\.enabled\) return out\(\{ outcome: 'CANCELLED'/);
  const paid = read('supabase/functions/_shared/findProperty/paidAvailability.ts');
  assert.match(paid, /offers\.enabled/);
});

test('the paid UI follows the control; Find Buyers and the free search have their own', () => {
  assert.match(read('src/pages/FindPropertyPage.tsx'), /useServiceVisible\('find_property_deep'\)/);
});
