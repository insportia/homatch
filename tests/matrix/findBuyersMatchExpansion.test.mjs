// FIND BUYERS 2.0 — SMART INTERNAL MATCH EXPANSION (20261119090000) — the money, privacy and
// precision invariants, read from the SQL and the worker (a matrix gate; the functions were
// also executed against Postgres with fixtures before review, see the PR):
//   * prices: EXACT 50¢ = 5, NEARBY / SIMILAR 30¢ = 3, VIP 100¢ = 10 at 10 credits = $1;
//     the unlock prices each person at ONE key (VIP overrides) — never stacked;
//   * the table refuses an EXACT row without documented location + budget;
//   * nothing new is readable by the browser: RLS on, no policies, writes by the worker only;
//   * the owner's controls can only narrow what the worker stored, never widen it;
//   * the worker classifies with research-core/match/internalTiers.ts and retires only after
//     a complete pass; searching and browsing charge nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
const sql = read('supabase/migrations/20261119090000_find_buyers_2_match_expansion.sql');
const worker = read('supabase/functions/supply-matching/index.ts');
const fn = (name) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `guard: ${name} missing`);
  const body = sql.indexOf('$$', start);
  return sql.slice(start, sql.indexOf('$$;', body + 2) + 3);
};

test('three prices at the catalogue: EXACT 50¢, nearby / similar 30¢ (unchanged), VIP 100¢ (unchanged)', () => {
  assert.match(sql, /\('INTERNAL_LEAD_EXACT', 'HOMATCH Leads — Exact match contact unlock', 'FIXED',\s*true, 50,/);
  assert.doesNotMatch(sql, /set standard_retail_cents/, 'the existing 30¢ / 100¢ rows are not repriced here');
  const prices = fn('internal_lead_prices');
  for (const code of ['INTERNAL_LEAD_STANDARD', 'INTERNAL_LEAD_EXACT', 'INTERNAL_LEAD_PREMIUM']) assert.ok(prices.includes(code));
  assert.match(prices, /count\(\*\) = 3/, 'not active unless all three products exist');
  assert.doesNotMatch(sql, /(insert into|update) public\.admin_settings[^;]*credits_per_usd/i, 'the credit rate is read, never written');
});

test('one price per person, VIP overriding — the unlock reserves per key and never stacks', () => {
  const key = fn('internal_lead_price_key');
  assert.match(key, /when \(select s\.segment from public\.internal_lead_segment\(p_intent_profile_id\) s\) = 'PREMIUM' then 'PREMIUM'\s*when p_category = 'EXACT' then 'EXACT'\s*else 'STANDARD'/);
  const pick = fn('internal_lead_pick');
  assert.match(pick, /distinct on \(c\.demand_user_id\)/, 'a person once per selection');
  assert.match(pick, /internal_lead_rows\(p_user_id, c\.property_id\)/, 'only eligible, visible candidates');
  const unlock = fn('internal_leads_unlock');
  assert.match(unlock, /foreach v_seg in array array\['STANDARD', 'EXACT', 'PREMIUM'\]/);
  assert.match(unlock, /auth\.role\(\) <> 'service_role'/);
  assert.match(unlock, /pg_advisory_xact_lock/);
  assert.match(unlock, /internal_lead_unlock_batches b\s*where b\.account_user_id = p_user_id and b\.idempotency_key = p_idempotency_key/);
  assert.match(unlock, /u\.account_user_id = p_user_id and u\.lead_user_id = p\.lead_user_id/, 'an already-unlocked member is not charged');
  assert.match(sql, /check \(segment in \('STANDARD', 'EXACT', 'PREMIUM'\)\)/);
});

test('EXACT is documented or it is refused by the table', () => {
  assert.match(sql, /constraint internal_match_candidates_exact_is_documented check \(\s*category <> 'EXACT' or \(kind = 'EXACT_LOCATION' and geo_level = 'EXACT_AREA' and budget_verdict = 'WITHIN'\)\)/);
});

test('nothing new is readable by the browser, and the feed names nobody before an unlock', () => {
  for (const table of ['internal_match_candidates', 'internal_match_place_geo', 'internal_match_preferences']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated;`));
    assert.doesNotMatch(sql, new RegExp(`create policy[^;]*on public\\.${table}`), `${table} has no policy`);
  }
  for (const f of ['internal_match_upsert', 'internal_match_retire', 'internal_match_refresh_place_geo', 'internal_lead_pick', 'internal_lead_price_key']) {
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role;`), `${f} is service-role only`);
    assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to authenticated`));
  }
  const feed = fn('internal_leads_feed_v2');
  assert.match(feed, /pr\.user_id = v_me/, 'owner-only');
  assert.match(feed, /'displayName', case when pg\.unlocked then/);
  assert.match(feed, /'contactOptions', jsonb_build_object\(\s*'message', true,\s*'phone', pg\.share_phone_on_unlock and pg\.has_phone,/, 'channels as booleans only');
  assert.doesNotMatch(feed, /'phone', usr\.phone|'email', usr\.email/);
  const explanation = fn('internal_lead_explanation');
  assert.doesNotMatch(explanation, /demand_user_id|full_name|nickname|phone|email/, 'the explanation carries no identifier');
});

test('the owner can only narrow the reach the worker stored', () => {
  const set = fn('internal_match_preferences_set');
  assert.match(set, /greatest\(0, least\(v_max, \(p->>'nearbyKm'\)::numeric\)\)/);
  assert.match(set, /pr\.user_id = v_me/);
  const visible = fn('internal_match_visible');
  for (const kind of ['NEARBY_AREA', 'SIMILAR_PROPERTY', 'CITY_WIDE']) assert.ok(visible.includes(`p_kind = '${kind}'`));
  assert.match(visible, /p_budget in \('ABOVE_MAX_TOLERANCE', 'BELOW_MIN_TOLERANCE'\) and not pf\.budget_tolerance/);
  assert.doesNotMatch(visible, /EXACT_LOCATION/, 'exact matches are never hidden by a reach control');
  const rows = fn('internal_lead_rows');
  assert.match(rows, /from public\.internal_match_candidates c/);
  assert.match(rows, /internal_match_visible\(c\.property_id, c\.kind, c\.budget_verdict, c\.geo_km\)/);
  assert.match(rows, /accept_property_offers/);
  assert.match(rows, /conversation_blocks/);
  assert.match(rows, /order by c\.demand_user_id, \(c\.category = 'EXACT'\) desc/, 'one person once, their EXACT reading first');
});

test('the worker classifies with internalTiers.ts, writes free, and retires only after a complete pass', () => {
  assert.match(worker, /from '\.\.\/\.\.\/\.\.\/src\/research-core\/match\/internalTiers\.ts'/);
  assert.match(worker, /classifyInternalCandidate\(\{/);
  assert.match(worker, /db\.rpc\('internal_match_upsert'/);
  const retire = worker.indexOf("db.rpc('internal_match_retire'");
  const complete = worker.lastIndexOf('if (!nativeScan.complete)', retire);
  assert.ok(retire > 0 && complete > 0 && complete < retire, 'retirement follows the completeness check');
  assert.match(worker, /if \(!dryRun && !candidateWriteFailed\)/, 'a failed write retires nothing');
  assert.doesNotMatch(worker, /wallet_(reserve|settle)/, 'matching charges nothing');
  assert.match(sql, /insert into public\.native_match_property_queue \(property_id, reason, enqueued_at\)\s*select p\.id, 'MATCH_EXPANSION_V1'/);
});

test('geography is measured from geocoded listings, never assumed', () => {
  const geo = fn('internal_match_refresh_place_geo');
  assert.match(geo, /from public\.discovery_marketplace_listings d/);
  assert.match(geo, /public\.market_place_key\(l\.raw->>'district'\)/, 'one place vocabulary');
  assert.match(geo, /<= 3\.0/, 'bad geocodes (over 3 km from the area median) are dropped');
  assert.match(geo, /count\(ppsqm\) >= 3/, 'a price level needs evidence');
});
