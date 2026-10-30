// Admin → Providers → Verify: research state and REPORT DELIVERY side by side.
//
// Research completion is not report delivery (src/verify/reportDelivery.ts;
// prod 674df06e, 2026-10-29: research COMPLETE, synthesis FAILED after four
// boot errors, no report, nothing saying why). Per recent job: the engine
// stamped at creation, research status, delivery state, report attempts, the
// last recorded failure (verify_report_failures: source, HTTP status, masked
// reason), per-stage cost, billing / plan-use state, and — for a finished job
// whose report FAILED and does not exist — "Retry report", which calls the
// audited admin_verify_retry_synthesis (20261208100000): the synthesis budget
// is given back and the driver builds the report from the stored evidence.
// Research is never re-run. Read through admin_verify_delivery (admin-checked
// server side, 20261208130000); before either migration is applied the card
// says so instead of failing.
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Confirm } from '@/components/admin/control/AdminKit';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';

/** i18n keys of the delivery states (literal, so the i18n audit sees every key). */
export const DELIVERY_LABEL_KEY: Record<string, string> = {
  RESEARCHING: 'adm_delivery_state_researching',
  PREPARING: 'adm_delivery_state_preparing',
  DELIVERED: 'adm_delivery_state_delivered',
  FAILED: 'adm_delivery_state_failed',
  RESEARCH_FAILED: 'adm_delivery_state_research_failed',
  STOPPED: 'adm_delivery_state_stopped',
};

interface StageCost { stage: string; model: string | null; usd: number | null; priced: boolean }
export interface DeliveryRow {
  id: string; subject: string | null; engine: string; researchStatus: string; researchStage: string | null;
  createdAt: string; researchCompletedAt: string | null; delivery: string; synthesisState: string | null;
  attempts: number; synthesisAt: string | null; hasReport: boolean;
  lastError: string | null; lastErrorSource: string | null; lastErrorStatus: number | null; lastErrorAt: string | null; failures: number;
  costUsd: number | null; stages: StageCost[]; billingState: string | null; usageState: string | null; usageReleaseReason: string | null;
  retryable: boolean;
}
interface DeliveryData { days: number; retryAvailable: boolean; rows: DeliveryRow[] }

/** A function the database does not have yet (migration not applied): PostgREST / Postgres codes. */
export function isMissingFunction(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function|does not exist/i.test(String(error.message ?? ''));
}

const usd = (n: number | null | undefined) => (typeof n === 'number' ? `$${n.toFixed(4)}` : '—');

export function VerifyDeliveryCard() {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<DeliveryData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading');
  const [problemsOnly, setProblemsOnly] = useState(true);
  const [target, setTarget] = useState<DeliveryRow | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    const { data: d, error } = await supabase.rpc('admin_verify_delivery', { p_days: 14, p_limit: 40, p_problems_only: problemsOnly });
    if (isMissingFunction(error)) { setState('missing'); return; }
    const v = d as DeliveryData | null;
    if (error || !v || !Array.isArray(v.rows)) { setState('failed'); return; }
    setData(v);
    setState('ready');
  }, [problemsOnly]);
  useEffect(() => { void load(); }, [load]);

  const retry = async () => {
    if (!target) return;
    setSaving(true);
    try {
      const { data: r, error } = await supabase.rpc('admin_verify_retry_synthesis', { p_job_id: target.id, p_reason: reason.trim() });
      if (isMissingFunction(error)) { toast.error(t('adm_delivery_retry_missing')); return; }
      if (error) throw error;
      const res = (r ?? {}) as { ok?: boolean; reason?: string };
      if (!res.ok) { toast.error(t('adm_delivery_retry_refused', { reason: String(res.reason ?? '') })); return; }
      toast.success(t('adm_delivery_retry_done'));
      setTarget(null);
      setReason('');
      void load();
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(lang === 'ka' ? 'ka-GE' : lang) : '—');
  const rows = data?.rows ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t('adm_delivery_title')}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={problemsOnly ? 'default' : 'outline'} aria-pressed={problemsOnly} onClick={() => setProblemsOnly((v) => !v)}>
              {t('adm_delivery_problems_only')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={state === 'loading'} aria-label={t('adm_delivery_refresh')}>
              <RefreshCw className={`h-4 w-4 ${state === 'loading' ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-2xs text-muted-foreground">{t('adm_delivery_intro')}</p>
        {state === 'missing' ? <p className="text-2xs text-muted-foreground">{t('adm_delivery_missing')}</p> : null}
        {state === 'failed' ? <p className="text-2xs text-muted-foreground">{t('adm_engine_stats_unavailable')}</p> : null}
        {state === 'ready' && data && !data.retryAvailable ? <p className="text-2xs text-muted-foreground">{t('adm_delivery_retry_missing')}</p> : null}
        {state === 'ready' && !rows.length ? <p className="text-2xs text-muted-foreground">{t('adm_delivery_none')}</p> : null}
        {rows.length ? (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="space-y-1 rounded-lg border border-border p-3 text-2xs" data-testid="adm-delivery-row">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant="outline">{r.engine}</Badge>
                  <span className="min-w-0 break-all font-medium text-foreground">{r.subject || r.id}</span>
                  <span className="text-muted-foreground">{fmt(r.createdAt)}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <span>{t('adm_delivery_research')}: <strong>{r.researchStatus}</strong></span>
                  <span>
                    {t('adm_delivery_report')}:{' '}
                    <strong className={r.delivery === 'FAILED' ? 'text-destructive' : ''}>{t(DELIVERY_LABEL_KEY[r.delivery] ?? 'adm_delivery_state_preparing')}</strong>
                    {r.synthesisState ? ` (${r.synthesisState})` : ''}
                  </span>
                  <span>{t('adm_delivery_attempts')}: {r.attempts}</span>
                  <span>{t('adm_delivery_cost')}: {usd(r.costUsd)}</span>
                  {r.billingState ? <span>{t('adm_delivery_billing')}: {r.billingState}</span> : null}
                  {r.usageState ? <span>{t('adm_delivery_usage')}: {r.usageState}{r.usageReleaseReason ? ` · ${r.usageReleaseReason}` : ''}</span> : null}
                </div>
                {r.lastError ? (
                  <p className="min-w-0 break-words text-muted-foreground">
                    {t('adm_delivery_last_error')} ({r.lastErrorSource ?? '—'}{r.lastErrorStatus ? ` · HTTP ${r.lastErrorStatus}` : ''} · {fmt(r.lastErrorAt)} · {r.failures}×): <span className="text-foreground">{r.lastError}</span>
                  </p>
                ) : null}
                {r.stages?.length ? (
                  <p className="min-w-0 break-words text-muted-foreground tabular-nums">
                    {t('adm_delivery_stages')}: {r.stages.map((s) => `${s.stage} ${usd(s.usd)}${s.priced ? '' : '?'}`).join(' · ')}
                  </p>
                ) : null}
                {r.retryable ? (
                  <Button size="sm" variant="outline" className="mt-1" disabled={saving || !data?.retryAvailable} onClick={() => setTarget(r)}>
                    {t('adm_delivery_retry')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
      <Confirm
        open={target !== null}
        onOpenChange={(v) => { if (!v) { setTarget(null); setReason(''); } }}
        title={t('adm_delivery_retry')}
        description={t('adm_delivery_retry_body')}
        confirmLabel={t('adm_delivery_retry')}
        onConfirm={() => void retry()}
        busy={saving}
        confirmDisabled={reason.trim().length < 3}
      >
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('adm_engine_reason')} aria-label={t('adm_engine_reason')} />
      </Confirm>
    </Card>
  );
}
