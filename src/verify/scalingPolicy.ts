// HOMATCH Verify — Railway replica scaling policy (Dynamic Railway Scaling, owner 2026-10-24).
//
// One worker service (homatch-official-worker), never a second one. This file
// decides, and only decides:
//   * which replica counts an operator may ask for (1–10), and why a count is
//     refused (plan limit, owner-approved ceiling, spending ceiling, or the
//     queue mode that makes more than one replica safe);
//   * what the automatic mode would want (min 1 → normal 3 → burst 6 → max),
//     with hysteresis and cooldowns so it never flaps; it is OFF until the
//     owner switches it on, and it never exceeds the approved ceiling or
//     upgrades the plan;
//   * a monthly cost estimate from MEASURED per-replica usage at Railway's
//     published prices — an estimate, never a guarantee.
// The edge function verify-scaling applies decisions through the Railway API.

export const RAILWAY_PRICE = { ramGbMonthUsd: 10, vcpuMonthUsd: 20 } as const;
export const PLAN_LIMITS: Record<string, { replicas: number; totalVcpu: number; totalRamGb: number; subscriptionUsd: number; includedUsageUsd: number }> = {
  HOBBY: { replicas: 6, totalVcpu: 48, totalRamGb: 48, subscriptionUsd: 5, includedUsageUsd: 5 },
  PRO: { replicas: 42, totalVcpu: 1000, totalRamGb: 1024, subscriptionUsd: 20, includedUsageUsd: 20 },
};
export const HARD_MAX_REPLICAS = 10;

export interface ScalingSettings {
  mode: 'MANUAL' | 'AUTOMATIC';
  plan: keyof typeof PLAN_LIMITS;
  min: number;
  normal: number;
  burst: number;
  /** The most the owner has approved; 10 only when set explicitly and the plan allows it. */
  approvedMax: number;
  /** Railway compute ceiling for this service, USD/month; 0 = none set. */
  monthlyCeilingUsd: number;
  /** Queued tasks per replica that justify the next step up. */
  upQueuedPerReplica: number;
  /** Oldest queued task age that justifies the next step up. */
  upOldestSeconds: number;
  /** Below this many busy tasks per remaining replica, a step down is allowed. */
  downBusyPerReplica: number;
  cooldownUpSeconds: number;
  cooldownDownSeconds: number;
  /** Per-replica capacity used for the hint (queue lanes per replica). */
  slotsPerReplica: number;
}

export const SCALING_DEFAULTS: ScalingSettings = {
  mode: 'MANUAL',
  plan: 'HOBBY',
  min: 1,
  normal: 3,
  burst: 6,
  approvedMax: 3,
  monthlyCeilingUsd: 0,
  upQueuedPerReplica: 15,
  upOldestSeconds: 180,
  downBusyPerReplica: 3,
  cooldownUpSeconds: 300,
  cooldownDownSeconds: 1200,
  slotsPerReplica: 15,
};

const int = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** admin_settings.verify_scaling → clamped settings; anything missing is the default (MANUAL). */
export function scalingSettings(raw: unknown): ScalingSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = SCALING_DEFAULTS;
  const plan = String(o.plan ?? d.plan).toUpperCase() in PLAN_LIMITS ? (String(o.plan ?? d.plan).toUpperCase() as ScalingSettings['plan']) : d.plan;
  const ceiling = Math.min(HARD_MAX_REPLICAS, PLAN_LIMITS[plan].replicas);
  const min = int(o.min, 1, ceiling, d.min);
  const approvedMax = int(o.approvedMax, 1, ceiling, Math.min(d.approvedMax, ceiling));
  const normal = Math.max(min, int(o.normal, 1, ceiling, d.normal));
  const burst = Math.max(normal, int(o.burst, 1, ceiling, d.burst));
  return {
    mode: o.mode === 'AUTOMATIC' ? 'AUTOMATIC' : 'MANUAL',
    plan, min, normal, burst, approvedMax,
    monthlyCeilingUsd: Math.max(0, Number(o.monthlyCeilingUsd) || 0),
    upQueuedPerReplica: int(o.upQueuedPerReplica, 1, 500, d.upQueuedPerReplica),
    upOldestSeconds: int(o.upOldestSeconds, 30, 3600, d.upOldestSeconds),
    downBusyPerReplica: int(o.downBusyPerReplica, 0, 100, d.downBusyPerReplica),
    cooldownUpSeconds: int(o.cooldownUpSeconds, 60, 7200, d.cooldownUpSeconds),
    cooldownDownSeconds: int(o.cooldownDownSeconds, 300, 86400, d.cooldownDownSeconds),
    slotsPerReplica: int(o.slotsPerReplica, 1, 200, d.slotsPerReplica),
  };
}

export interface ReplicaUsage { ramGb: number; vcpu: number }

/** Monthly compute estimate for n replicas from measured per-replica usage (busy replicas use more; see `busy`). */
export function monthlyCostUsd(replicas: number, idle: ReplicaUsage, busy: ReplicaUsage = idle, busyShare = 0): number {
  const per = (u: ReplicaUsage) => u.ramGb * RAILWAY_PRICE.ramGbMonthUsd + u.vcpu * RAILWAY_PRICE.vcpuMonthUsd;
  const share = Math.min(1, Math.max(0, busyShare));
  return Math.round(replicas * (per(idle) * (1 - share) + per(busy) * share) * 100) / 100;
}

export type Refusal = 'NOT_AN_INTEGER' | 'OUT_OF_RANGE' | 'PLAN_UPGRADE_REQUIRED' | 'OVER_APPROVED_MAX' | 'OVER_SPENDING_CEILING' | 'QUEUE_MODE_REQUIRED' | 'UNCHANGED';

/** Whether a requested count may be applied now; the first reason that stops it. */
export function validateTarget(target: unknown, ctx: { settings: ScalingSettings; current: number; executionMode: string; estimateUsd: number }): Refusal | null {
  const n = Number(target);
  if (!Number.isInteger(n)) return 'NOT_AN_INTEGER';
  if (n < 1 || n > HARD_MAX_REPLICAS) return 'OUT_OF_RANGE';
  if (n > PLAN_LIMITS[ctx.settings.plan].replicas) return 'PLAN_UPGRADE_REQUIRED';
  if (n > ctx.settings.approvedMax) return 'OVER_APPROVED_MAX';
  // Several replicas are only safe when Verify runs on the durable task queue (leases, fencing).
  if (n > 1 && ctx.executionMode !== 'QUEUE') return 'QUEUE_MODE_REQUIRED';
  if (n > ctx.current && ctx.settings.monthlyCeilingUsd > 0 && ctx.estimateUsd > ctx.settings.monthlyCeilingUsd) return 'OVER_SPENDING_CEILING';
  if (n === ctx.current) return 'UNCHANGED';
  return null;
}

export interface LoadSnapshot {
  queued: number;
  running: number;
  oldestQueuedSeconds: number;
}

/** The ladder the automatic mode climbs: min → normal → burst → approved max, one rung at a time. */
export function ladder(s: ScalingSettings): number[] {
  return [...new Set([s.min, s.normal, s.burst, s.approvedMax].filter((n) => n <= s.approvedMax))].sort((a, b) => a - b);
}

/**
 * What the automatic mode wants next, or null for "stay". Up when the queue is
 * deep or old; down only when the remaining replicas would still be lightly
 * loaded and nothing is waiting. Each direction has its own cooldown since the
 * last change, so a burst never makes it flap.
 */
export function autoDecision(load: LoadSnapshot, current: number, s: ScalingSettings, secondsSinceChange: number): { target: number; why: string } | null {
  if (current > s.approvedMax) return { target: s.approvedMax, why: 'above the approved maximum' };
  if (current < s.min) return { target: s.min, why: 'below the minimum' };
  const rungs = ladder(s);
  const up = rungs.find((r) => r > current);
  const down = [...rungs].reverse().find((r) => r < current);
  if (up !== undefined && secondsSinceChange >= s.cooldownUpSeconds) {
    if (load.queued >= s.upQueuedPerReplica * current) return { target: up, why: `queued ${load.queued} ≥ ${s.upQueuedPerReplica} per replica` };
    if (load.queued > 0 && load.oldestQueuedSeconds >= s.upOldestSeconds) return { target: up, why: `oldest queued ${load.oldestQueuedSeconds}s ≥ ${s.upOldestSeconds}s` };
  }
  if (down !== undefined && secondsSinceChange >= s.cooldownDownSeconds && load.queued === 0 && load.running <= s.downBusyPerReplica * down) {
    return { target: down, why: `idle: ${load.running} running fits ${down} replica(s)` };
  }
  return null;
}
