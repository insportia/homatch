// WHAT A VERIFICATION COST, WITHOUT LYING ABOUT WHAT IS NOT KNOWN.
//
// The Admin Verify COGS screen reads public.verify_billing_events through
// three admin-only RPCs. It computes no cost of its own — a second cost
// engine would only give us a second set of numbers to disagree with the
// first — so what is worth testing is not arithmetic. It is the two ways a
// cost screen misleads:
//
//   1. a figure that is not known rendered as zero, which reads as free;
//   2. a real figure rounded away, which reads as free for the same reason.
//      Verify stages cost fractions of a cent; at two decimals most of this
//      screen would be $0.00.
//
// Plus the boundary that must never move: COGS is internal. No customer
// surface may import it, and the RPCs behind it refuse anyone who is not an
// administrator.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { usd, num, secs, isFloorTotal } from '../cogsFormat.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20260919200000_verify_cogs_admin.sql');

/**
 * The migration with its prose removed.
 *
 * Both checks below are about what the SQL DOES. The header explains at
 * length why the guard is shaped the way it is — including a quotation of
 * the NULL-unsafe version it replaced — and a rule satisfied or broken by a
 * comment ABOUT the rule is not a rule at all.
 */
const migrationCode = () =>
  readFileSync(MIGRATION, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

/* ── UNKNOWN IS NOT ZERO ──────────────────────────────────────────────── */

test('an unknown cost never renders as a number', () => {
  for (const v of [null, undefined, NaN, Infinity]) {
    assert.equal(usd(v), '—', `${String(v)} must not become money`);
    assert.equal(num(v), '—');
    assert.equal(secs(v), '—');
  }
  // And a real zero is still a real zero — the two must stay distinguishable.
  assert.equal(usd(0), '$0.00');
  assert.equal(num(0), '0');
});

test('a cost below a cent keeps its precision instead of rounding to nothing', () => {
  // The measured production average is $0.365622 and single stages run far
  // below that. At two decimals these all read as free.
  assert.equal(usd(0.004), '$0.004000');
  assert.equal(usd(0.000042), '$0.000042');
  assert.equal(usd(0.0099), '$0.009900');
  // At or above a cent the ordinary precision is used.
  assert.equal(usd(0.01), '$0.01');
  assert.equal(usd(23.034176, 4), '$23.0342');
  assert.equal(usd(0.365622, 4), '$0.3656');
  // Negative amounts widen too rather than collapsing to -$0.00.
  assert.equal(usd(-0.004), '$-0.004000');
});

test('a total covering a partially priced run is labelled a floor', () => {
  // PARTIALLY_PRICED means a stage had no rate in the price book that
  // applied. Its measured part is real; the rest is missing, not zero.
  assert.equal(isFloorTotal(0), false);
  assert.equal(isFloorTotal(null), false);
  assert.equal(isFloorTotal(undefined), false);
  assert.equal(isFloorTotal(1), true);
  assert.equal(isFloorTotal(63), true);
});

test('durations read as durations', () => {
  assert.equal(secs(45), '45s');
  assert.equal(secs(603.4), '10m 3s');
  assert.equal(secs(0), '0s');
});

/* ── THE PANEL USES THEM, AND SAYS WHEN A TOTAL IS A FLOOR ────────────── */

test('the panel renders every figure through the honest formatters', () => {
  const src = readFileSync(join(ROOT, 'src', 'components', 'admin', 'VerifyCostPanel.tsx'), 'utf8');
  assert.match(src, /import \{ usd, num, secs, isFloorTotal \} from '@\/verify\/cogsFormat'/);
  // No second, local copy of the money formatter that could drift from the
  // tested one.
  assert.ok(!/function usd\(/.test(src), 'the panel must not keep its own usd()');
  // The floor is announced, and the total itself is relabelled.
  assert.match(src, /vcogs_floor_note/);
  assert.match(src, /incomplete \? t\('vcogs_stat_total_floor'\) : t\('vcogs_stat_total'\)/);
  // A failed read shows nothing rather than zeros.
  assert.match(src, /setSummary\(null\);\s*\n\s*setJobs\(\[\]\);/);
});

test('the service keeps an absent number absent', () => {
  const src = readFileSync(join(ROOT, 'src', 'services', 'verifyCogs.ts'), 'utf8');
  // Number(null) is 0 and Number('') is 0. The parser must reject both.
  assert.match(src, /if \(v === null \|\| v === undefined \|\| v === ''\) return null;/);
  assert.match(src, /Number\.isFinite\(n\) \? n : null/);
  // It reads the existing contract and nothing else.
  assert.match(src, /verify_cogs_summary/);
  assert.match(src, /verify_cogs_jobs/);
  assert.match(src, /verify_cogs_job/);
});

/* ── IT IS A READING SURFACE, NOT A SECOND COST ENGINE ────────────────── */

test('nothing in this feature recomputes a cost', () => {
  const sql = migrationCode();
  // Every figure comes from the existing view.
  assert.match(sql, /from public\.verify_billing_events/);
  // No rate table, no price book arithmetic, no per-job infrastructure share.
  assert.ok(!/price_book_entries|rate_per|\* *1000000|infra_allocation/i.test(sql),
    'the admin view must not compute cost, only read it');
});

test('the RPCs refuse anyone who is not an administrator, NULL role included', () => {
  const sql = migrationCode();
  const guards = sql.match(/if not \(coalesce\(auth\.role\(\), ''\) = 'service_role' or coalesce\(public\.is_admin\(\), false\)\) then/g) ?? [];
  assert.equal(guards.length, 3, 'all three functions must be gated');
  /*
   * Written first as `auth.role() <> 'service_role' and not is_admin()`.
   * auth.role() is NULL outside a PostgREST request, NULL <> 'service_role'
   * is NULL, and `NULL and true` is NULL — so the IF never fired and a caller
   * with no role at all was served. Proven against production before it was
   * corrected, which is why both sides are coalesced.
   */
  assert.ok(!/auth\.role\(\) <> 'service_role' and not/.test(sql),
    'the NULL-unsafe guard must not come back');
  assert.equal((sql.match(/raise exception 'FORBIDDEN'/g) ?? []).length, 3);
  // Refusal, not an empty result: an aggregate over a filtered-out row set
  // still returns one row, and jobs_count = 0 reads as "no verifications".
  assert.ok(!/where public\.is_admin\(\)/.test(sql),
    'gating by WHERE turns "not allowed" into "nothing to see"');
  // And the grants never reach anon.
  assert.match(sql, /revoke all on function public\.verify_cogs_summary/);
  assert.ok(!/grant execute on function public\.verify_cogs[a-z_]*\([^)]*\) to [^;]*anon/.test(sql));
});

test('CUSTOMER_COGS_EXPOSED = NO: no customer surface can reach these figures', () => {
  /*
   * The whole point of the boundary. verify_billing_events is cost, and cost
   * is not a customer's business — so the only things allowed to import the
   * service are the admin panel and this test.
   */
  const allowed = new Set([
    join('src', 'components', 'admin', 'VerifyCostPanel.tsx'),
    join('src', 'pages', 'admin', 'AdminVerifyCogsPage.tsx'),
  ]);
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const rel = full.slice(ROOT.length + 1);
      if (rel.includes('__tests__')) continue;
      const src = readFileSync(full, 'utf8');
      if (!/from '@\/services\/verifyCogs'/.test(src)) continue;
      if (!allowed.has(rel)) offenders.push(rel);
    }
  };
  walk(join(ROOT, 'src'));
  assert.deepEqual(offenders, [], 'these are not admin surfaces and must not read COGS');
});

test('the route is admin-only', () => {
  const routes = readFileSync(join(ROOT, 'src', 'routes.tsx'), 'utf8');
  const line = routes.split('\n').find((l) => l.includes("/admin/verify-cogs"));
  assert.ok(line, 'the route must exist');
  assert.match(line, /adminOnly: true/);
  assert.match(line, /adminWrap\(/);
});
