// verify-scaling — Admin → Infrastructure → Verify Scaling (owner 2026-10-24).
//
// The replica count of the ONE Verify worker (homatch-official-worker) on
// Railway, with real numbers next to it. Actions:
//   status    admin    live replicas (Railway) + healthy replicas (worker
//                      beats) + queue depth/age, throughput, p95, measured CPU
//                      and RAM, cost estimates per count, recent events
//   scale     admin    { replicas, confirm: true, reason? } — validated against
//                      the plan, the owner-approved ceiling, the spending
//                      ceiling and queue mode; applied through Railway, read
//                      back, and written to verify_scaling_events either way
//   settings  admin    mode/thresholds/ceilings; AUTOMATIC needs
//                      confirmAutomatic: true
//   autoscale cron     the autoscaler tick (x-cron-token = verify_driver_token);
//                      does nothing unless the owner set mode AUTOMATIC
//   scale     cron     with source 'claude' and approvedBy: Claude Code applying
//                      an owner-approved change through the same checks and log
// The Railway token is a server secret (see _shared/railwayScaling.ts); the
// browser only ever sees counts, dollars and statuses.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { RailwayClient, railwayConfigured } from '../_shared/railwayScaling.ts';
import { autoDecision, HARD_MAX_REPLICAS, monthlyCostUsd, PLAN_LIMITS, scalingSettings, validateTarget, type ScalingSettings } from '../../../src/verify/scalingPolicy.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function setting(db: any, key: string): Promise<any> {
  const { data } = await db.from('admin_settings').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}

async function executionMode(db: any): Promise<string> {
  const v = await setting(db, 'verify_execution_mode');
  return String(typeof v === 'string' ? v : v?.mode ?? 'HTTP').toUpperCase();
}

async function lastChangeAt(db: any): Promise<number> {
  const { data } = await db.from('verify_scaling_events').select('created_at').eq('action', 'SCALE').in('status', ['APPLIED', 'VERIFIED']).order('created_at', { ascending: false }).limit(1);
  return data?.[0]?.created_at ? Date.parse(data[0].created_at) : 0;
}

async function record(db: any, e: Record<string, unknown>): Promise<void> {
  const { error } = await db.from('verify_scaling_events').insert(e);
  if (error) console.error('verify-scaling: event not recorded', error.message);
}

/** Per-replica measured usage: the window's average (lightly loaded) and peak (busy), divided by the replicas that produced it. */
function perReplica(usage: Awaited<ReturnType<RailwayClient['usage']>>, replicas: number) {
  const r = Math.max(1, replicas);
  if (usage.memoryGbAvg === null || usage.cpuAvg === null) return null;
  return {
    idle: { ramGb: usage.memoryGbAvg / r, vcpu: usage.cpuAvg / r },
    busy: { ramGb: (usage.memoryGbPeak ?? usage.memoryGbAvg) / r, vcpu: (usage.cpuPeak ?? usage.cpuAvg) / r },
  };
}

function costTable(per: ReturnType<typeof perReplica>, s: ScalingSettings) {
  if (!per) return null;
  return Array.from({ length: HARD_MAX_REPLICAS }, (_, i) => i + 1).map((n) => ({
    replicas: n,
    idleUsd: monthlyCostUsd(n, per.idle),
    busyUsd: monthlyCostUsd(n, per.busy),
    planAllows: n <= PLAN_LIMITS[s.plan].replicas,
    approved: n <= s.approvedMax,
  }));
}

async function status(db: any, rw: RailwayClient | null) {
  const s = scalingSettings(await setting(db, 'verify_scaling'));
  const [{ data: metrics }, events, mode] = await Promise.all([
    db.rpc('verify_scaling_metrics'),
    db.from('verify_scaling_events').select('created_at, source, action, status, from_replicas, to_replicas, reason').order('created_at', { ascending: false }).limit(20),
    executionMode(db),
  ]);
  let instance = null, usage = null, railwayError: string | null = null;
  if (rw) {
    try {
      instance = await rw.instance();
      usage = await rw.usage(7);
    } catch (e) {
      railwayError = String((e as Error)?.message ?? e).slice(0, 200);
    }
  }
  const per = usage && instance ? perReplica(usage, instance.replicas) : null;
  const load = { queued: Number(metrics?.queued ?? 0), running: Number(metrics?.running ?? 0), oldestQueuedSeconds: Number(metrics?.oldestQueuedSeconds ?? 0) };
  const since = (Date.now() - (await lastChangeAt(db))) / 1000;
  return {
    railway: { configured: !!rw, error: railwayError, instance, usage },
    settings: s,
    plan: { name: s.plan, ...PLAN_LIMITS[s.plan] },
    executionMode: mode,
    metrics,
    costs: costTable(per, s),
    autoscaler: { mode: s.mode, wouldDo: instance ? autoDecision(load, instance.replicas, s, since) : null },
    events: events.data ?? [],
  };
}

async function scale(db: any, rw: RailwayClient | null, target: unknown, who: { actor: string | null; source: 'admin' | 'autoscaler' | 'claude' }, reason: string) {
  const s = scalingSettings(await setting(db, 'verify_scaling'));
  if (!rw) {
    await record(db, { actor: who.actor, source: who.source, action: 'SCALE', status: 'REFUSED', to_replicas: Number(target) || null, reason, detail: { refusal: 'RAILWAY_NOT_CONFIGURED' } });
    return { ok: false, refusal: 'RAILWAY_NOT_CONFIGURED' };
  }
  const instance = await rw.instance();
  const per = perReplica(await rw.usage(7), instance.replicas);
  const estimate = per ? monthlyCostUsd(Number(target) || 0, per.busy) : 0;
  const refusal = validateTarget(target, { settings: s, current: instance.replicas, executionMode: await executionMode(db), estimateUsd: estimate });
  if (refusal) {
    await record(db, { actor: who.actor, source: who.source, action: 'SCALE', status: 'REFUSED', from_replicas: instance.replicas, to_replicas: Number(target) || null, reason, detail: { refusal, estimateUsd: estimate } });
    return { ok: false, refusal, current: instance.replicas };
  }
  const n = Number(target);
  try {
    await rw.setReplicas(instance.region, n);
    const after = await rw.instance();
    const verified = after.replicas === n;
    await record(db, { actor: who.actor, source: who.source, action: 'SCALE', status: verified ? 'VERIFIED' : 'APPLIED', from_replicas: instance.replicas, to_replicas: n, reason, detail: { region: instance.region, readBack: after.replicas, deployment: after.latestDeployment?.id ?? null, estimateUsd: estimate } });
    return { ok: true, from: instance.replicas, to: n, readBack: after.replicas, verified, deployment: after.latestDeployment };
  } catch (e) {
    const message = String((e as Error)?.message ?? e).slice(0, 200);
    await record(db, { actor: who.actor, source: who.source, action: 'SCALE', status: 'FAILED', from_replicas: instance.replicas, to_replicas: n, reason, detail: { error: message } });
    return { ok: false, refusal: 'RAILWAY_CALL_FAILED', error: message };
  }
}

/*
 * What an admin may change here. NOT the owner-approved ceiling (approvedMax) and NOT the Railway plan:
 * those are owner decisions, changed only by an owner-approved admin_settings update recorded in the
 * release log, so no admin session (or a stolen one) can lift the replica limit through this API.
 */
const SETTINGS_KEYS = ['mode', 'min', 'normal', 'burst', 'monthlyCeilingUsd', 'upQueuedPerReplica', 'upOldestSeconds', 'downBusyPerReplica', 'cooldownUpSeconds', 'cooldownDownSeconds', 'slotsPerReplica'];
const OWNER_ONLY_KEYS = ['approvedMax', 'plan'];

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? '');
  const rw = railwayConfigured(Deno.env) ? new RailwayClient(Deno.env) : null;
  try {
    // ── machine callers: the autoscaler tick and Claude Code with an owner approval ──
    const cron = req.headers.get('x-cron-token');
    if (cron) {
      const expected = await setting(db, 'verify_driver_token');
      if (!expected || cron !== expected) return json({ error: 'FORBIDDEN' }, 403);
      if (action === 'autoscale') {
        const s = scalingSettings(await setting(db, 'verify_scaling'));
        if (s.mode !== 'AUTOMATIC' || !rw) return json({ ok: true, skipped: s.mode !== 'AUTOMATIC' ? 'MANUAL_MODE' : 'RAILWAY_NOT_CONFIGURED' });
        const { data: m } = await db.rpc('verify_scaling_metrics');
        const instance = await rw.instance();
        const since = (Date.now() - (await lastChangeAt(db))) / 1000;
        const d = autoDecision({ queued: Number(m?.queued ?? 0), running: Number(m?.running ?? 0), oldestQueuedSeconds: Number(m?.oldestQueuedSeconds ?? 0) }, instance.replicas, s, since);
        if (!d) return json({ ok: true, stay: instance.replicas });
        return json(await scale(db, rw, d.target, { actor: null, source: 'autoscaler' }, d.why));
      }
      if (action === 'scale' && body?.source === 'claude') {
        const approvedBy = String(body?.approvedBy ?? '').trim().slice(0, 300);
        if (!approvedBy || body?.confirm !== true) return json({ error: 'APPROVAL_REQUIRED' }, 400);
        return json(await scale(db, rw, body.replicas, { actor: null, source: 'claude' }, `owner approval: ${approvedBy}`));
      }
      if (action === 'status') return json(await status(db, rw));
      return json({ error: 'UNKNOWN_ACTION' }, 400);
    }

    // ── admins: their own session, re-checked against users.is_admin server-side ──
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'UNAUTHORIZED' }, 401);
    const { data: { user } } = await createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } }).auth.getUser();
    if (!user) return json({ error: 'UNAUTHORIZED' }, 401);
    const { data: me } = await db.from('users').select('id, is_admin').eq('auth_id', user.id).maybeSingle();
    if (me?.is_admin !== true) return json({ error: 'FORBIDDEN' }, 403);

    if (action === 'status') return json(await status(db, rw));
    if (action === 'scale') {
      if (body?.confirm !== true) return json({ error: 'CONFIRMATION_REQUIRED' }, 400);
      return json(await scale(db, rw, body.replicas, { actor: user.id, source: 'admin' }, String(body?.reason ?? '').slice(0, 300) || 'admin'));
    }
    if (action === 'settings') {
      const current = (await setting(db, 'verify_scaling')) ?? {};
      const patch: Record<string, unknown> = {};
      if (body?.settings && OWNER_ONLY_KEYS.some((k) => k in body.settings)) {
        await record(db, { actor: user.id, source: 'admin', action: 'SETTINGS', status: 'REFUSED', reason: 'owner-only setting', detail: { keys: OWNER_ONLY_KEYS.filter((k) => k in body.settings) } });
        return json({ error: 'OWNER_APPROVAL_REQUIRED' }, 403);
      }
      for (const k of SETTINGS_KEYS) if (body?.settings && k in body.settings) patch[k] = body.settings[k];
      if (patch.mode === 'AUTOMATIC' && body?.confirmAutomatic !== true) return json({ error: 'CONFIRMATION_REQUIRED' }, 400);
      const next = scalingSettings({ ...current, ...patch });
      const { error } = await db.from('admin_settings').upsert({ key: 'verify_scaling', value: next, updated_by: me.id, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw error;
      await record(db, { actor: user.id, source: 'admin', action: 'SETTINGS', status: 'APPLIED', reason: String(body?.reason ?? '').slice(0, 300) || null, detail: { before: scalingSettings(current), after: next } });
      return json({ ok: true, settings: next });
    }
    return json({ error: 'UNKNOWN_ACTION' }, 400);
  } catch (e) {
    console.error('verify-scaling failed', String((e as Error)?.message ?? e).slice(0, 200));
    return json({ error: 'internal_error' }, 500);
  }
});
