// checkSpendCap — the monthly spend_cap_* gate used by outreach-send and Email
// Studio (capacity audit 2026-10-18). The thresholds and the decision rule are
// unchanged; what changed is HOW month-to-date spend is read:
//   * summed in SQL (provider_spend_totals_since) instead of a row select that
//     stopped at PostgREST's max rows and under-counted a busy month;
//   * paged, never truncated, while that function is not yet applied;
//   * a read failure refuses the paid send instead of counting the month as $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkSpendCap, monthToDateSpend, sumSpendRows } from '../spend_cap.ts';

const settings = (caps) => ({ data: Object.entries(caps).map(([k, v]) => ({ key: `spend_cap_${k}`, value: v })), error: null });

/** A fake supabase client: `rpc` answers the aggregate (or PGRST202), `from` serves settings and paged rows. */
function fakeDb({ caps, aggregate, rows = [], rpcError = null, rowsError = null, maxRows = 1000 }) {
  const calls = { rpc: 0, pages: [] };
  return {
    calls,
    rpc(name, args) {
      calls.rpc += 1;
      assert.equal(name, 'provider_spend_totals_since');
      assert.ok(args.p_since);
      return Promise.resolve(rpcError ? { data: null, error: rpcError } : { data: aggregate, error: null });
    },
    from(table) {
      if (table === 'admin_settings') return { select: () => ({ like: () => Promise.resolve(settings(caps)) }) };
      assert.equal(table, 'cost_events');
      const q = {
        select: () => q, gte: () => q, order: () => q,
        range(from, to) {
          calls.pages.push([from, to]);
          if (rowsError) return Promise.resolve({ data: null, error: rowsError });
          return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + maxRows)), error: null });
        },
      };
      return q;
    },
  };
}

test('sums per lower-cased provider; NULL cost counts as 0 (same grouping as before)', () => {
  assert.deepEqual(sumSpendRows([{ provider: 'OPENAI', cost_usd: 1.5 }, { provider: 'openai', cost_usd: '2' }, { provider: 'RESEND', cost_usd: null }]), { openai: 3.5, resend: 0 });
});

test('the SQL aggregate is used when available — one call, no row transfer', async () => {
  const db = fakeDb({ caps: { global: 250, resend: 100 }, aggregate: [{ provider: 'resend', cost_usd: 40 }, { provider: 'openai', cost_usd: 10 }] });
  const r = await checkSpendCap(db, 'RESEND');
  assert.equal(db.calls.rpc, 1);
  assert.equal(db.calls.pages.length, 0);
  assert.equal(r.allowed, true);
  assert.equal(r.provider_pct, 40);
  assert.equal(r.global_pct, 20);
});

test('the decision rule is unchanged: ≥100% of either cap blocks, ≥80% warns, a missing cap is unlimited', async () => {
  const blocked = await checkSpendCap(fakeDb({ caps: { global: 250, resend: 100 }, aggregate: [{ provider: 'resend', cost_usd: 100 }] }), 'RESEND');
  assert.deepEqual([blocked.allowed, blocked.provider_blocked, blocked.global_blocked], [false, true, false]);
  const global = await checkSpendCap(fakeDb({ caps: { global: 250 }, aggregate: [{ provider: 'openai', cost_usd: 250 }] }), 'TWILIO');
  assert.deepEqual([global.allowed, global.global_blocked], [false, true]);
  const warn = await checkSpendCap(fakeDb({ caps: { global: 250, twilio: 5 }, aggregate: [{ provider: 'twilio', cost_usd: 4 }] }), 'TWILIO');
  assert.deepEqual([warn.allowed, warn.warning], [true, true]);
  const uncapped = await checkSpendCap(fakeDb({ caps: {}, aggregate: [{ provider: 'cartesia', cost_usd: 5000 }] }), 'CARTESIA');
  assert.equal(uncapped.allowed, true);
});

test('before the function is applied (PGRST202) every row is read page by page — never a truncated sum', async () => {
  const rows = Array.from({ length: 2500 }, () => ({ provider: 'RESEND', cost_usd: 0.04 }));
  const db = fakeDb({ caps: { global: 250, resend: 100 }, rpcError: { code: 'PGRST202', message: 'not found' }, rows });
  const spent = await monthToDateSpend(db, new Date().toISOString());
  assert.equal(db.calls.pages.length, 3);
  assert.ok(Math.abs(spent.resend - 100) < 1e-9, String(spent.resend));
  // the old single select would have stopped at 1000 rows = $40 and allowed the send
  const r = await checkSpendCap(fakeDb({ caps: { global: 250, resend: 100 }, rpcError: { code: 'PGRST202', message: 'x' }, rows }), 'RESEND');
  assert.equal(r.allowed, false);
});

test('a spend read failure refuses the paid send (it used to count the month as $0 and allow it)', async () => {
  const viaRpc = await checkSpendCap(fakeDb({ caps: { global: 250 }, rpcError: { code: '57014', message: 'timeout' } }), 'RESEND');
  assert.deepEqual([viaRpc.allowed, viaRpc.spend_unknown], [false, true]);
  const viaRows = await checkSpendCap(fakeDb({ caps: { global: 250 }, rpcError: { code: 'PGRST202', message: 'x' }, rowsError: { message: 'boom' } }), 'RESEND');
  assert.deepEqual([viaRows.allowed, viaRows.spend_unknown], [false, true]);
});

test('spend-cap-check answers the service role only', () => {
  const src = readFileSync(new URL('../../spend-cap-check/index.ts', import.meta.url), 'utf8');
  assert.match(src, /if \(!isServiceCaller\(req\.headers\.get\('Authorization'\), Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)\)\) \{/);
  assert.ok(src.indexOf('isServiceCaller(req') < src.indexOf('checkSpendCap(supabase, provider)'));
});

test('the aggregate migration groups exactly like the TypeScript and is service-role only', () => {
  const sql = readFileSync(new URL('../../../migrations/20261115100000_provider_spend_totals.sql', import.meta.url), 'utf8');
  assert.match(sql, /select lower\(c\.provider::text\) as provider, coalesce\(sum\(coalesce\(c\.cost_usd, 0\)\), 0\) as cost_usd/);
  assert.match(sql, /where c\."timestamp" >= p_since/);
  assert.match(sql, /revoke all on function public\.provider_spend_totals_since\(timestamptz\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.provider_spend_totals_since\(timestamptz\) to service_role;/);
});
