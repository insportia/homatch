// SYSTEM HEALTH — queues and stuck work (_shared/opsHealth.ts). The levels, the checks
// against a fake database, and the wiring into system-health and its Admin card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { levelFor, worstLevel, opsChecks, opsProbes } = await import('../opsHealth.ts');

test('levels: empty is ok, age and any-item rules escalate, an unreadable check is a warning', () => {
  const rule = { warnAgeSec: 1200, alertAgeSec: 3600 };
  assert.equal(levelFor(0, null, rule), 'ok');
  assert.equal(levelFor(3, 60, rule), 'ok');
  assert.equal(levelFor(3, 1200, rule), 'warn');
  assert.equal(levelFor(3, 3600, rule), 'alert');
  assert.equal(levelFor(1, 1, { alertIfAny: true }), 'alert');
  assert.equal(levelFor(1, 1, { warnIfAny: true, alertAgeSec: 600 }), 'warn');
  assert.equal(levelFor(1, 600, { warnIfAny: true, alertAgeSec: 600 }), 'alert');
  assert.equal(levelFor(null, null, rule), 'warn');
  assert.equal(worstLevel([{ level: 'ok' }, { level: 'warn' }]), 'warn');
  assert.equal(worstLevel([{ level: 'warn' }, { level: 'alert' }]), 'alert');
  assert.equal(worstLevel([]), 'ok');
});

/* A PostgREST stand-in with the filters the probes use. */
function fakeDb(tables, broken = new Set()) {
  return {
    from(name) {
      const st = { filters: [], head: false, order: null, limit: null };
      const cmp = { eq: (x, v) => x === v, in: (x, v) => v.includes(x), is: (x, v) => (v === null ? x == null : x === v), lt: (x, v) => x != null && x < v, gte: (x, v) => x != null && x >= v };
      const b = {
        select: (_c, o) => { if (o?.head) st.head = true; return b; },
        order: (c, o) => { st.order = [c, o?.ascending !== false]; return b; },
        limit: (n) => { st.limit = n; return b; },
        then: (ok, bad) => Promise.resolve().then(() => {
          if (broken.has(name)) return { data: null, count: null, error: { message: 'boom' } };
          let rows = (tables[name] ?? []).filter((r) => st.filters.every(([op, c, v]) => cmp[op](r[c], v)));
          if (st.head) return { data: null, count: rows.length, error: null };
          if (st.order) rows = [...rows].sort((a, z) => (String(a[st.order[0]]) < String(z[st.order[0]]) ? -1 : 1) * (st.order[1] ? 1 : -1));
          if (st.limit != null) rows = rows.slice(0, st.limit);
          return { data: rows, count: rows.length, error: null };
        }).then(ok, bad),
      };
      for (const op of Object.keys(cmp)) b[op] = (c, v) => { st.filters.push([op, c, v]); return b; };
      return b;
    },
  };
}

const NOW = Date.parse('2026-10-18T06:40:00Z');
const at = (min) => new Date(NOW - min * 60_000).toISOString();

test('the 8f6b8544 shape: a campaign stuck in ranking for 12 minutes is an alert, with its age', async () => {
  const db = fakeDb({ matching_jobs: [
    { id: 'job-1', status: 'ranking', updated_at: at(12) },
    { id: 'job-2', status: 'ranking', updated_at: at(1) },
    { id: 'job-3', status: 'completed', updated_at: at(60) },
  ] });
  const checks = await opsChecks(db, NOW);
  const stuck = checks.find((c) => c.key === 'campaigns_stuck_finishing');
  assert.deepEqual(stuck, { key: 'campaigns_stuck_finishing', count: 1, oldestAgeSec: 720, level: 'alert' });
  assert.equal(worstLevel(checks), 'alert');
});

test('an idle platform is all ok; a held credit past expiry and an unbooked run are alerts', async () => {
  const idle = await opsChecks(fakeDb({}), NOW);
  assert.equal(idle.length, opsProbes(NOW).length);
  assert.ok(idle.every((c) => c.level === 'ok' && c.count === 0 && c.oldestAgeSec === null));

  const checks = await opsChecks(fakeDb({
    usage_reservations: [{ status: 'RESERVED', expires_at: at(5) }, { status: 'RESERVED', expires_at: new Date(NOW + 60_000).toISOString() }, { status: 'SETTLED', expires_at: at(500) }],
    find_buyers_actor_runs: [{ cost_booked_at: null, created_at: at(180) }, { cost_booked_at: null, created_at: at(10) }],
    discovery_query_queue: [{ status: 'PENDING', created_at: at(25) }, { status: 'DONE', created_at: at(900) }],
  }), NOW);
  const by = Object.fromEntries(checks.map((c) => [c.key, c]));
  assert.equal(by.reservations_overdue.count, 1);
  assert.equal(by.reservations_overdue.level, 'alert');
  assert.equal(by.find_buyers_runs_unbooked.count, 1, 'a run younger than 2 h is still in flight');
  assert.equal(by.find_buyers_runs_unbooked.level, 'alert');
  assert.equal(by.discovery_queue_open.level, 'warn', '25 minutes waiting');
});

test('a check that cannot read is reported as unreadable; the others still run', async () => {
  const checks = await opsChecks(fakeDb({ matching_jobs: [] }, new Set(['verify_tasks'])), NOW);
  const vt = checks.filter((c) => c.key.startsWith('verify_tasks'));
  assert.ok(vt.length === 2 && vt.every((c) => c.count === null && c.level === 'warn'));
  assert.equal(checks.find((c) => c.key === 'campaigns_stuck_finishing').level, 'ok');
});

test('system-health reports the checks and keeps alerts in its history; the Admin card names every check', () => {
  const fn = readFileSync(new URL('../../system-health/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /import \{ opsChecks, worstLevel \} from '\.\.\/_shared\/opsHealth\.ts';/);
  assert.match(fn, /const ops = \{ level: worstLevel\(checks\), checks \};/);
  assert.match(fn, /OPS_ALERT: \$\{opsAlerts\.join\(', '\)\}/);
  assert.match(fn, /if \(!hUser\?\.is_admin\) return json\(\{ error: 'Forbidden — admin only' \}, 403\);/, 'still admin only');
  const page = readFileSync(new URL('../../../../src/pages/admin/AdminHealthPage.tsx', import.meta.url), 'utf8');
  for (const p of opsProbes(NOW)) assert.match(page, new RegExp(`${p.key}: 'admin_ops_${p.key}'`), p.key);
});
