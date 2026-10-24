// scalingPolicy.test.mjs — Dynamic Railway scaling (owner 2026-10-24): what may be asked for, what the autoscaler
// would do (1 → 3 → 6 → 3 → 1 with cooldowns), 10-replica readiness without activating it, the Railway client's
// one-service guard and read-back, and the edge function's authorisation and audit wiring.
// The metrics SQL is proven on PGlite by scripts/verify/scaling-metrics-db-check.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scalingSettings, validateTarget, autoDecision, ladder, monthlyCostUsd, SCALING_DEFAULTS, PLAN_LIMITS, HARD_MAX_REPLICAS } from '../scalingPolicy.ts';
import { RailwayClient, WORKER_SERVICE_ID } from '../../../supabase/functions/_shared/railwayScaling.ts';

const code = (p) => readFileSync(fileURLToPath(new URL(`../../../${p}`, import.meta.url)), 'utf8');

test('defaults: MANUAL, Hobby, 1/3/6, owner-approved ceiling 3; nothing missing turns automation on', () => {
  const s = scalingSettings(null);
  assert.deepEqual(s, SCALING_DEFAULTS);
  assert.equal(s.mode, 'MANUAL');
  assert.equal(scalingSettings({ mode: 'automatic' }).mode, 'MANUAL', 'only the exact value enables it');
  assert.equal(scalingSettings({ approvedMax: 10 }).approvedMax, 6, 'Hobby caps at 6 replicas per service');
  assert.equal(scalingSettings({ plan: 'pro', approvedMax: 99 }).approvedMax, HARD_MAX_REPLICAS);
  assert.deepEqual([scalingSettings({ min: 4, normal: 2, burst: 1 }).normal, scalingSettings({ min: 4, normal: 2, burst: 1 }).burst], [4, 4], 'the ladder never goes backwards');
});

test('manual requests: refused for the plan, the approval, queue mode, the spending ceiling; 1..10 only', () => {
  const ctx = (o = {}) => ({ settings: scalingSettings({ approvedMax: 6 }), current: 1, executionMode: 'QUEUE', estimateUsd: 30, ...o });
  assert.equal(validateTarget(3, ctx()), null);
  assert.equal(validateTarget(2.5, ctx()), 'NOT_AN_INTEGER');
  assert.equal(validateTarget(0, ctx()), 'OUT_OF_RANGE');
  assert.equal(validateTarget(11, ctx()), 'OUT_OF_RANGE');
  assert.equal(validateTarget(10, ctx()), 'PLAN_UPGRADE_REQUIRED', 'Hobby: 10 needs Pro — never upgraded automatically');
  assert.equal(validateTarget(6, ctx({ settings: scalingSettings({ approvedMax: 3 }) })), 'OVER_APPROVED_MAX');
  assert.equal(validateTarget(3, ctx({ executionMode: 'LEGACY' })), 'QUEUE_MODE_REQUIRED');
  assert.equal(validateTarget(1, ctx({ executionMode: 'LEGACY', current: 3 })), null, 'going back to one is always allowed');
  assert.equal(validateTarget(6, ctx({ settings: scalingSettings({ approvedMax: 6, monthlyCeilingUsd: 50 }), estimateUsd: 80 })), 'OVER_SPENDING_CEILING');
  assert.equal(validateTarget(1, ctx({ settings: scalingSettings({ approvedMax: 6, monthlyCeilingUsd: 1 }), current: 3, estimateUsd: 80 })), null, 'scaling down is never blocked by cost');
  assert.equal(validateTarget(1, ctx()), 'UNCHANGED');
});

test('10-replica readiness: on Pro with approval 10 is a valid rung and request; on Hobby it is not, and nothing activates it alone', () => {
  const pro = scalingSettings({ plan: 'PRO', approvedMax: 10, burst: 6 });
  assert.deepEqual(ladder(pro), [1, 3, 6, 10]);
  assert.equal(validateTarget(10, { settings: pro, current: 6, executionMode: 'QUEUE', estimateUsd: 0 }), null);
  assert.equal(PLAN_LIMITS.HOBBY.replicas, 6);
  // MANUAL: the decision is only advisory ("wouldDo"); the tick skips unless AUTOMATIC (wiring test below).
  assert.deepEqual(autoDecision({ queued: 500, running: 90, oldestQueuedSeconds: 900 }, 6, pro, 9999).target, 10);
});

test('autoscaler transitions 1 → 3 → 6 → 3 → 1, one rung at a time, with cooldowns and hysteresis', () => {
  const s = scalingSettings({ mode: 'AUTOMATIC', approvedMax: 6 });
  const burst = { queued: 120, running: 40, oldestQueuedSeconds: 400 };
  const idle = { queued: 0, running: 2, oldestQueuedSeconds: 0 };
  let n = 1;
  const step = (load, since) => { const d = autoDecision(load, n, s, since); if (d) n = d.target; return d; };
  assert.equal(step(burst, 9999).target, 3);
  assert.equal(step(burst, 60), null, 'inside the up cooldown: stay');
  assert.equal(step(burst, s.cooldownUpSeconds).target, 6);
  assert.equal(step(burst, 9999), null, 'at the approved ceiling: stay');
  assert.equal(step(idle, s.cooldownDownSeconds - 1), null, 'down waits longer than up');
  assert.equal(step({ queued: 3, running: 2, oldestQueuedSeconds: 5 }, 9999), null, 'anything waiting blocks a step down');
  assert.equal(step(idle, s.cooldownDownSeconds).target, 3);
  assert.equal(step({ queued: 0, running: 8, oldestQueuedSeconds: 0 }, 9999), null, 'eight busy tasks do not fit one replica at 3 per replica');
  assert.equal(step(idle, 9999).target, 1);
  assert.equal(step(idle, 9999), null, 'at the minimum');
  // An old queue alone (few tasks, waiting long) also justifies a step up.
  assert.equal(autoDecision({ queued: 2, running: 15, oldestQueuedSeconds: 600 }, 1, s, 9999).target, 3);
  // Lowering the approval pulls the count down at once, regardless of cooldowns.
  assert.equal(autoDecision(burst, 6, scalingSettings({ approvedMax: 3 }), 0).target, 3);
});

test('cost: measured per-replica usage times Railway prices; an estimate, scaled by replica count', () => {
  assert.equal(monthlyCostUsd(1, { ramGb: 1.3, vcpu: 0.01 }), 13.2);
  assert.equal(monthlyCostUsd(3, { ramGb: 1.3, vcpu: 0.01 }), 39.6);
  assert.equal(monthlyCostUsd(2, { ramGb: 1, vcpu: 0 }, { ramGb: 3, vcpu: 1 }, 0.5), 2 * (10 * 0.5 + 50 * 0.5));
});

test('Railway client: only the worker service, read back after every change, provider errors without secrets', async () => {
  const calls = [];
  let replicas = 1;
  const fetcher = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    calls.push({ query: query.split('(')[0].trim(), headers: init.headers, variables });
    if (query.includes('serviceInstanceUpdate')) { replicas = Object.values(variables.input.multiRegionConfig)[0].numReplicas; return Response.json({ data: { serviceInstanceUpdate: true } }); }
    if (query.includes('serviceInstanceRedeploy')) return Response.json({ data: { serviceInstanceRedeploy: true } });
    if (query.includes('serviceInstance(')) return Response.json({ data: { serviceInstance: { region: 'ams', numReplicas: replicas, latestDeployment: { id: 'd1', status: 'SUCCESS', createdAt: 'x' } } } });
    return Response.json({ errors: [{ message: 'nope' }] }, { status: 400 });
  };
  const rw = new RailwayClient({ get: (k) => (k === 'RAILWAY_PROJECT_TOKEN' ? 'secret-token' : undefined) }, fetcher);
  assert.equal((await rw.instance()).replicas, 1);
  await rw.setReplicas('ams', 3);
  assert.equal((await rw.instance()).replicas, 3);
  assert.equal(calls[0].headers['Project-Access-Token'], 'secret-token', 'least-privilege project token header');
  assert.ok(calls.every((c) => c.variables.serviceId === undefined || c.variables.serviceId === WORKER_SERVICE_ID));
  await assert.rejects(rw.gql('query x { y }', { serviceId: 'another-service' }), /RAILWAY_SERVICE_NOT_ALLOWED/);
  const err = await rw.gql('query bad { z }', {}).catch((e) => e.message);
  assert.match(err, /RAILWAY_API_ERROR 400: nope/);
  assert.doesNotMatch(err, /secret-token/);
  const usage = await rw.usage(7);
  assert.equal(usage.memoryGbAvg, null, 'unanswered metrics are null, never invented');
  await assert.rejects(new RailwayClient({ get: () => undefined }, fetcher).instance(), /RAILWAY_NOT_CONFIGURED/);
});

test('wiring: admin-only and server-checked, confirmation required, every outcome logged, autoscaler off unless AUTOMATIC', () => {
  const fn = code('supabase/functions/verify-scaling/index.ts');
  assert.match(fn, /select\('id, is_admin'\)\.eq\('auth_id', user\.id\)/);
  assert.match(fn, /if \(me\?\.is_admin !== true\) return json\(\{ error: 'FORBIDDEN' \}, 403\)/);
  assert.match(fn, /if \(body\?\.confirm !== true\) return json\(\{ error: 'CONFIRMATION_REQUIRED' \}, 400\)/);
  assert.match(fn, /if \(patch\.mode === 'AUTOMATIC' && body\?\.confirmAutomatic !== true\)/);
  assert.match(fn, /if \(s\.mode !== 'AUTOMATIC' \|\| !rw\) return json\(\{ ok: true, skipped/);
  for (const st of ['REFUSED', 'VERIFIED', 'FAILED']) assert.ok(fn.includes(`status: '${st}'`) || fn.includes(`'${st}'`), st);
  assert.doesNotMatch(fn, /RAILWAY_(PROJECT|API)_TOKEN/, 'the token is read only inside _shared/railwayScaling.ts');
  const sql = code('supabase/migrations/20261201096000_verify_scaling.sql');
  assert.match(sql, /'\{"mode":"MANUAL"/);
  assert.match(sql, /on conflict \(key\) do nothing/, 'an existing owner setting is never overwritten');
  const shared = code('supabase/functions/_shared/railwayScaling.ts');
  assert.doesNotMatch(shared, /serviceCreate|serviceDelete|serviceConnect/, 'it cannot create, delete or reconnect a service');
});
