// Admin Demand Intelligence: admin-gated, audited, honest numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const SQL = read('supabase/migrations/20261107094700_admin_demand_intelligence.sql');
const PAGE = read('src/pages/admin/AdminDemandIntelligencePage.tsx');
const ROUTES = read('src/routes.tsx');
const NAV = read('src/admin/navigation.ts');

test('every public admin_demand_* RPC checks is_admin first', () => {
  for (const fn of ['admin_demand_customers', 'admin_demand_export', 'admin_demand_customer_profile', 'admin_demand_analytics']) {
    const body = SQL.slice(SQL.indexOf(`function public.${fn}(`));
    const begin = body.indexOf('begin');
    assert.match(body.slice(begin, begin + 200), /if not public\.is_admin\(\) then raise exception 'forbidden'/, fn);
  }
  for (const helper of ['admin_demand_rows(jsonb)', 'admin_demand_interest_match(public.customer_demand_interests, jsonb)']) {
    assert.ok(SQL.includes(`revoke all on function public.${helper} from public, anon, authenticated`), helper);
  }
});

test('profile views and exports are audited', () => {
  assert.match(SQL, /'DEMAND_PROFILE_VIEWED'/);
  assert.match(SQL, /'DEMAND_INTELLIGENCE_EXPORT'[\s\S]{0,120}'rows', v_count/);
});

test('money is the wallet and booked cost, unknown stays null; free searches charge 0', () => {
  assert.match(SQL, /usage_reservations r where r\.id::text = j\.billing_grant->>'reservationId'/);
  assert.match(SQL, /'homatchProfitUsd', case when charged_usd is not null and spend_usd is not null/);
  assert.match(SQL, /'freeCreditsCharged', 0/);
});

test('route, navigation and admin-only wiring', () => {
  assert.match(ROUTES, /path: '\/admin\/demand-intelligence', element: adminWrap\(<AdminDemandIntelligencePage \/>\), adminOnly: true/);
  assert.match(NAV, /path: '\/admin\/demand-intelligence', labelKey: 'admin_nav_demand_intelligence'/);
  assert.doesNotMatch(PAGE, /Math\.random|faker|mock/i, 'no fabricated data');
  assert.doesNotMatch(PAGE, /confirmed buyer/i);
});
