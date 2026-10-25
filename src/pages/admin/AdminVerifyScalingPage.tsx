import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { RefreshCw, AlertTriangle, Server } from 'lucide-react';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

/*
 * Admin → System → Verify Scaling (the owner's "Infrastructure → Verify
 * Scaling", 2026-10-24). The replica count of the ONE Verify worker on
 * Railway, next to the numbers that justify it. Everything shown comes from
 * verify-scaling (Railway's own API, the workers' 30-second beats and the
 * task queue); a number nobody measured is shown as unavailable, never
 * guessed. Changing the count needs a confirmation that states the monthly
 * cost difference and what will happen; the server re-checks admin rights,
 * the plan, the owner-approved ceiling and queue mode, and logs every
 * attempt. The Railway credential never reaches this page.
 */

interface CostRow { replicas: number; idleUsd: number; busyUsd: number; planAllows: boolean; approved: boolean }
interface ReplicaRow { replica: string; lastSeen: string; draining: boolean; running: number; rssMb: number | null; slots: number }
interface ScalingEvent { created_at: string; source: string; action: string; status: string; from_replicas: number | null; to_replicas: number | null; reason: string | null }
interface Status {
  railway: { configured: boolean; error: string | null; instance: { region: string; replicas: number; latestDeployment: { id: string; status: string; createdAt: string } | null } | null;
    usage: { memoryGbAvg: number | null; memoryGbPeak: number | null; cpuAvg: number | null; cpuPeak: number | null; windowDays: number } | null };
  settings: { mode: 'MANUAL' | 'AUTOMATIC'; plan: string; min: number; normal: number; burst: number; approvedMax: number; monthlyCeilingUsd: number; cooldownUpSeconds: number; cooldownDownSeconds: number; upQueuedPerReplica: number; upOldestSeconds: number };
  plan: { name: string; replicas: number; subscriptionUsd: number };
  executionMode: string;
  metrics: { queued: number; running: number; oldestQueuedSeconds: number; completedLast15m: number; jobsPerMinute: number; activeJobs: number; taskP95Seconds: number | null; healthyReplicas: number; replicas: ReplicaRow[] } | null;
  costs: CostRow[] | null;
  autoscaler: { mode: string; wouldDo: { target: number; why: string } | null };
  events: ScalingEvent[];
}

const usd = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(2)}` : '—');
const num = (n: number | null | undefined, digits = 0) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : '—');
const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 120 ? `${s}s` : s < 7200 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('verify-scaling', { body });
  if (error) throw error;
  return data;
}

function Tile({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'warn' | 'ok' }) {
  return (
    <div className="rounded-lg border border-border/60 p-3 min-w-0">
      <div className="text-xs text-muted-foreground truncate">{label}</div>
      <div className={cn('text-2xl font-semibold tabular-nums mt-0.5', tone === 'warn' && 'text-amber-500', tone === 'ok' && 'text-green-600 dark:text-green-400')}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

export default function AdminVerifyScalingPage() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [autoDialog, setAutoDialog] = useState(false);
  const [ceiling, setCeiling] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = (await call({ action: 'status' })) as Status;
      setStatus(s);
      setCeiling(s.settings.monthlyCeilingUsd ? String(s.settings.monthlyCeilingUsd) : '');
    } catch {
      toast.error(t('adm_vsc_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const current = status?.railway.instance?.replicas ?? null;
  const costOf = (n: number | null) => (n === null ? null : status?.costs?.find((c) => c.replicas === n) ?? null);
  const lastRequested = status?.events.find((e) => e.action === 'SCALE' && (e.status === 'VERIFIED' || e.status === 'APPLIED'))?.to_replicas ?? null;
  const desired = status?.settings.mode === 'AUTOMATIC' ? status.autoscaler.wouldDo?.target ?? current : lastRequested ?? current;

  const refusalOf = (n: number): string | null => {
    if (!status) return 'loading';
    if (!status.railway.configured) return t('adm_vsc_refuse_railway');
    if (n > status.plan.replicas) return t('adm_vsc_refuse_plan', { plan: status.plan.name, max: String(status.plan.replicas) });
    if (n > status.settings.approvedMax) return t('adm_vsc_refuse_approved', { max: String(status.settings.approvedMax) });
    if (n > 1 && status.executionMode !== 'QUEUE') return t('adm_vsc_refuse_queue');
    return null;
  };

  const applyScale = async () => {
    if (pending === null) return;
    setBusy(true);
    try {
      const r = await call({ action: 'scale', replicas: pending, confirm: true, reason: reason.trim() || undefined });
      if (r?.ok) toast.success(r.verified ? t('adm_vsc_scaled_verified', { n: String(r.to) }) : t('adm_vsc_scaled_applied', { n: String(r.to) }));
      else toast.error(t('adm_vsc_scale_refused', { why: String(r?.refusal ?? 'ERROR') }));
    } catch {
      toast.error(t('adm_vsc_scale_failed'));
    } finally {
      setBusy(false);
      setPending(null);
      setReason('');
      void load();
    }
  };

  const saveSettings = async (settings: Record<string, unknown>, confirmAutomatic = false) => {
    setBusy(true);
    try {
      const r = await call({ action: 'settings', settings, confirmAutomatic });
      if (r?.ok) toast.success(t('adm_vsc_settings_saved'));
      else toast.error(t('adm_vsc_scale_failed'));
    } catch {
      toast.error(t('adm_vsc_scale_failed'));
    } finally {
      setBusy(false);
      setAutoDialog(false);
      void load();
    }
  };

  if (loading && !status) {
    return <div className="space-y-4 max-w-5xl"><Skeleton className="h-8 w-64" /><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  const m = status?.metrics ?? null;
  const usage = status?.railway.usage ?? null;
  const fromCost = costOf(current), toCost = costOf(pending);
  const diff = (k: 'idleUsd' | 'busyUsd') => (fromCost && toCost ? toCost[k] - fromCost[k] : null);
  const signed = (n: number | null) => (n === null ? '—' : `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(2)}`);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-bold flex items-center gap-2"><Server className="h-5 w-5" />{t('admin_nav_verify_scaling')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('adm_vsc_subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="gap-1.5">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />{t('adm_vsc_refresh')}
        </Button>
      </div>

      {status && !status.railway.configured && (
        <div className="flex gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />{t('adm_vsc_not_configured')}</div>
      )}
      {status?.railway.error && (
        <div className="flex gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" /><span dir="ltr" className="break-all">{status.railway.error}</span></div>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('adm_vsc_replicas')}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile label={t('adm_vsc_current')} value={num(current)} hint={status?.railway.instance ? `${status.railway.instance.region} · ${status.railway.instance.latestDeployment?.status ?? '—'}` : t('adm_vsc_unavailable')} />
          <Tile label={t('adm_vsc_desired')} value={num(desired)} hint={status?.settings.mode === 'AUTOMATIC' ? t('adm_vsc_mode_automatic') : t('adm_vsc_mode_manual')} />
          <Tile label={t('adm_vsc_healthy')} value={num(m?.healthyReplicas)} tone={m && current !== null && m.healthyReplicas < current ? 'warn' : 'ok'} hint={t('adm_vsc_healthy_hint')} />
          <Tile label={t('adm_vsc_plan_max')} value={num(status?.plan.replicas)} hint={t('adm_vsc_plan_hint', { plan: status?.plan.name ?? '—', approved: String(status?.settings.approvedMax ?? '—') })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('adm_vsc_load')}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Tile label={t('adm_vsc_active_jobs')} value={num(m?.activeJobs)} />
          <Tile label={t('adm_vsc_queue_depth')} value={num(m?.queued)} hint={t('adm_vsc_running_n', { n: num(m?.running) })} />
          <Tile label={t('adm_vsc_queue_age')} value={m ? `${num(m.oldestQueuedSeconds)}s` : '—'} tone={m && m.oldestQueuedSeconds > (status?.settings.upOldestSeconds ?? 180) ? 'warn' : undefined} />
          <Tile label={t('adm_vsc_jobs_per_min')} value={num(m?.jobsPerMinute, 2)} hint={t('adm_vsc_tasks_15m', { n: num(m?.completedLast15m) })} />
          <Tile label={t('adm_vsc_p95')} value={m?.taskP95Seconds != null ? `${num(m.taskP95Seconds, 1)}s` : '—'} />
          <Tile label={t('adm_vsc_cpu_ram')} value={usage?.memoryGbAvg != null ? `${num(usage.memoryGbAvg, 2)} GB` : '—'}
            hint={usage?.cpuAvg != null ? t('adm_vsc_cpu_ram_hint', { cpu: num(usage.cpuAvg, 2), peakRam: num(usage.memoryGbPeak, 2), peakCpu: num(usage.cpuPeak, 2), days: String(usage.windowDays) }) : t('adm_vsc_unavailable')} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('adm_vsc_controls')}</CardTitle>
          <p className="text-xs text-muted-foreground">{t('adm_vsc_controls_hint')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
              const refusal = refusalOf(n);
              return (
                <Button key={n} size="sm" variant={n === current ? 'default' : 'outline'} disabled={busy || n === current || !!refusal}
                  title={refusal ?? undefined} aria-label={t('adm_vsc_set_to', { n: String(n) })} onClick={() => setPending(n)} className="w-11 tabular-nums">
                  {n}
                </Button>
              );
            })}
          </div>
          {status?.costs ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-muted-foreground text-start">
                  <th className="text-start font-medium py-1 pe-3">{t('adm_vsc_col_replicas')}</th>
                  <th className="text-start font-medium py-1 pe-3">{t('adm_vsc_col_light')}</th>
                  <th className="text-start font-medium py-1 pe-3">{t('adm_vsc_col_busy')}</th>
                  <th className="text-start font-medium py-1">{t('adm_vsc_col_status')}</th>
                </tr></thead>
                <tbody>
                  {status.costs.map((c) => (
                    <tr key={c.replicas} className={cn('border-t border-border/30', c.replicas === current && 'font-semibold')}>
                      <td className="py-1 pe-3 tabular-nums">{c.replicas}</td>
                      <td className="py-1 pe-3 tabular-nums" dir="ltr">{usd(c.idleUsd)}</td>
                      <td className="py-1 pe-3 tabular-nums" dir="ltr">{usd(c.busyUsd)}</td>
                      <td className="py-1">
                        {!c.planAllows ? <Badge variant="outline" className="border-amber-500 text-amber-500">{t('adm_vsc_needs_upgrade')}</Badge>
                          : !c.approved ? <Badge variant="outline">{t('adm_vsc_not_approved')}</Badge>
                          : <Badge variant="outline" className="border-green-600 text-green-600 dark:text-green-400">{t('adm_vsc_available')}</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-2">{t('adm_vsc_cost_note', { sub: usd(status.plan.subscriptionUsd) })}</p>
            </div>
          ) : <p className="text-sm text-muted-foreground">{t('adm_vsc_cost_unavailable')}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('adm_vsc_autoscaler')}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={status?.settings.mode === 'AUTOMATIC' ? 'default' : 'outline'}>{status?.settings.mode === 'AUTOMATIC' ? t('adm_vsc_mode_automatic') : t('adm_vsc_mode_manual')}</Badge>
            <span className="text-muted-foreground">{t('adm_vsc_policy', { min: String(status?.settings.min ?? '—'), normal: String(status?.settings.normal ?? '—'), burst: String(status?.settings.burst ?? '—'), max: String(status?.settings.approvedMax ?? '—') })}</span>
          </div>
          <p className="text-muted-foreground">
            {status?.autoscaler.wouldDo ? t('adm_vsc_would', { n: String(status.autoscaler.wouldDo.target) }) : t('adm_vsc_would_stay')}
            {status?.autoscaler.wouldDo && <span dir="ltr" className="ms-1">({status.autoscaler.wouldDo.why})</span>}
          </p>
          <div className="flex items-end gap-2 flex-wrap">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground block">{t('adm_vsc_ceiling')}</span>
              <Input inputMode="decimal" value={ceiling} onChange={(e) => setCeiling(e.target.value.replace(/[^0-9.]/g, ''))} className="w-32" dir="ltr" placeholder="0" />
            </label>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void saveSettings({ monthlyCeilingUsd: Number(ceiling) || 0 })}>{t('adm_vsc_save')}</Button>
            {status?.settings.mode === 'AUTOMATIC'
              ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void saveSettings({ mode: 'MANUAL' })}>{t('adm_vsc_switch_manual')}</Button>
              : <Button size="sm" variant="outline" disabled={busy || !status?.railway.configured} onClick={() => setAutoDialog(true)}>{t('adm_vsc_enable_auto')}</Button>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('adm_vsc_workers')}</CardTitle></CardHeader>
        <CardContent>
          {m?.replicas?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-muted-foreground">
                  <th className="text-start font-medium py-1 pe-3">{t('adm_vsc_col_worker')}</th>
                  <th className="text-start font-medium py-1 pe-3">{t('adm_vsc_col_seen')}</th>
                  <th className="text-start font-medium py-1 pe-3">{t('adm_vsc_col_running')}</th>
                  <th className="text-start font-medium py-1 pe-3">RAM</th>
                  <th className="text-start font-medium py-1">{t('adm_vsc_col_state')}</th>
                </tr></thead>
                <tbody>
                  {m.replicas.map((r) => {
                    const stale = Date.now() - Date.parse(r.lastSeen) > 90_000;
                    return (
                      <tr key={r.replica} className="border-t border-border/30">
                        <td className="py-1 pe-3 font-mono text-xs" dir="ltr">{r.replica.slice(0, 12)}</td>
                        <td className="py-1 pe-3 tabular-nums" dir="ltr">{ago(r.lastSeen)}</td>
                        <td className="py-1 pe-3 tabular-nums">{r.running}/{r.slots}</td>
                        <td className="py-1 pe-3 tabular-nums" dir="ltr">{r.rssMb != null ? `${r.rssMb} MB` : '—'}</td>
                        <td className="py-1">{r.draining ? t('adm_vsc_draining') : stale ? t('adm_vsc_stale') : t('adm_vsc_healthy_one')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-muted-foreground">{t('adm_vsc_no_beats')}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('adm_vsc_events')}</CardTitle></CardHeader>
        <CardContent>
          {status?.events.length ? (
            <ul className="space-y-1.5 text-sm">
              {status.events.map((e, i) => (
                <li key={i} className="flex flex-wrap gap-x-2 border-b border-border/30 pb-1.5 last:border-0">
                  <span className="text-muted-foreground tabular-nums" dir="ltr">{new Date(e.created_at).toLocaleString()}</span>
                  <Badge variant="outline">{e.status}</Badge>
                  <span>{e.action === 'SCALE' ? `${e.from_replicas ?? '—'} → ${e.to_replicas ?? '—'}` : t('adm_vsc_settings_event')}</span>
                  <span className="text-muted-foreground">{e.source}</span>
                  {e.reason && <span className="text-muted-foreground break-all" dir="auto">{e.reason}</span>}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">{t('adm_vsc_no_events')}</p>}
        </CardContent>
      </Card>

      <AlertDialog open={pending !== null} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('adm_vsc_confirm_title', { from: num(current), to: num(pending) })}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>{t('adm_vsc_confirm_cost', { light: signed(diff('idleUsd')), busy: signed(diff('busyUsd')) })}</p>
                <p>{pending !== null && current !== null && pending > current ? t('adm_vsc_confirm_up') : t('adm_vsc_confirm_down')}</p>
                <p>{t('adm_vsc_confirm_drain')}</p>
                <Input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 300))} placeholder={t('adm_vsc_reason')} dir="auto" />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('adm_vsc_cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void applyScale(); }}>{t('adm_vsc_confirm_apply', { n: num(pending) })}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={autoDialog} onOpenChange={setAutoDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('adm_vsc_auto_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('adm_vsc_auto_body', { max: String(status?.settings.approvedMax ?? '—'), ceiling: status?.settings.monthlyCeilingUsd ? usd(status.settings.monthlyCeilingUsd) : t('adm_vsc_no_ceiling') })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('adm_vsc_cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void saveSettings({ mode: 'AUTOMATIC' }, true); }}>{t('adm_vsc_enable_auto')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
