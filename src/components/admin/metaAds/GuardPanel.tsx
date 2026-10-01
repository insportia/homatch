// ADMIN — CAMPAIGN GUARD. Accounts with their strikes and warnings, incidents
// with their evidence (admin-only, collapsed), the admin action log, and the
// eight audited acts. Every act needs a stated reason (≥3 characters, checked
// again server-side) and a confirmation; the audit rows are written by the
// meta-ads-api function, never by this page.
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Confirm, IdChip, When } from '@/components/admin/control/AdminKit';
import { Owner } from './people';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { adminGuardAct, adminGuardOverview, type AdminGuardAct } from '@/services/metaAds';
import { errorText, JsonDetails, MIN_REASON, Panel } from './kit';

type Overview = Awaited<ReturnType<typeof adminGuardOverview>>;
type Target = { incidentId?: string; targetUserId?: string; adAccountId?: string; campaignId?: string };

const RESOLVED = new Set(['CLEARED', 'DISMISSED', 'REVIEWED']);
const DESTRUCTIVE: ReadonlySet<AdminGuardAct> = new Set(['SUSPEND_ACCOUNT', 'RESTORE_CONFIG']);


function levelTone(level: string) {
  if (level === 'STRIKE' || level === 'REVIEW_REQUIRED') return 'border-destructive/30 bg-destructive/10 text-destructive';
  if (level === 'WARNING') return 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]';
  return 'border-border bg-[hsl(var(--secondary))] text-muted-foreground';
}

function evidenceOf(inc: Overview['incidents'][number]): unknown {
  const raw = (inc as { meta_guard_evidence?: unknown }).meta_guard_evidence;
  if (Array.isArray(raw)) return raw.map((r) => (r && typeof r === 'object' ? (r as { evidence?: unknown }).evidence : r));
  if (raw && typeof raw === 'object') return (raw as { evidence?: unknown }).evidence;
  return null;
}

export function GuardPanel() {
  const { t } = useLanguage();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<{ act: AdminGuardAct; target: Target } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData(await adminGuardOverview()); } catch (e) { setError(errorText(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const ask = (act: AdminGuardAct, target: Target) => { setReason(''); setPending({ act, target }); };

  const run = async () => {
    if (!pending || reason.trim().length < MIN_REASON) return;
    setBusy(true);
    try {
      await adminGuardAct(pending.act, reason.trim(), pending.target);
      toast.success(t('mm_a_act_done'));
      setPending(null);
      await load();
    } catch (e) {
      toast.error(t('mm_a_act_failed', { error: errorText(e) }));
    } finally { setBusy(false); }
  };

  const actButton = (act: AdminGuardAct, target: Target, variant: 'outline' | 'destructive' | 'default' = 'outline') => (
    <Button key={act} size="sm" variant={variant} onClick={() => ask(act, target)}>{t(`mm_a_act_${act}`)}</Button>
  );

  if (loading && !data) return <Skeleton className="h-40 rounded-2xl" />;
  if (error && !data) {
    return (
      <Panel>
        <p role="alert" className="text-sm text-destructive">{t('mm_a_load_failed')}</p>
        <p dir="ltr" className="mt-1 break-words text-2xs text-muted-foreground">{error}</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => void load()}>{t('mm_a_retry')}</Button>
      </Panel>
    );
  }
  if (!data) return null;

  const maxStrikes = Number((data.policy as { maxStrikes?: number })?.maxStrikes ?? NaN);

  return (
    <div className="space-y-4">
      <Panel
        title={data.enabled ? t('mm_a_guard_on') : t('mm_a_guard_off')}
        actions={(
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            {t('mm_a_refresh')}
          </Button>
        )}
      >
        {Number.isFinite(maxStrikes) && <p className="text-sm text-muted-foreground">{t('mm_a_max_strikes', { n: maxStrikes })}</p>}
        <JsonDetails label={t('mm_a_guard_policy')} value={data.policy} />
      </Panel>

      <Panel title={t('mm_a_accounts')}>
        {data.accounts.length === 0 ? <p className="text-sm text-muted-foreground">{t('mm_a_no_accounts')}</p> : (
          <ul className="space-y-2">
            {data.accounts.map((a) => (
              <li key={`${a.user_id}:${a.ad_account_external_id}`} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                  <span className={cn('rounded-full border px-2 text-2xs font-semibold leading-5',
                    a.status === 'SUSPENDED' ? 'border-destructive/30 bg-destructive/10 text-destructive'
                      : a.status === 'WATCH' ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                        : 'border-border bg-[hsl(var(--secondary))] text-muted-foreground')}>
                    {t(a.status === 'SUSPENDED' ? 'mm_a_acct_suspended' : a.status === 'WATCH' ? 'mm_a_acct_watch' : 'mm_a_acct_active')}
                  </span>
                  <span>{t('mm_a_account')}: <b className="font-mono" dir="ltr">{a.ad_account_external_id}</b></span>
                  <span>{t('mm_a_user')}: <Owner id={a.user_id} /></span>
                  <span>{t('mm_a_strikes', { n: a.active_strikes })}</span>
                  <span>{t('mm_a_warnings', { n: a.active_warnings })}</span>
                  {a.suspended_at && <span className="text-muted-foreground">{t('mm_a_suspended_at', { at: new Date(a.suspended_at).toLocaleString() })}</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {a.status === 'SUSPENDED'
                    ? actButton('REINSTATE_ACCOUNT', { targetUserId: a.user_id, adAccountId: a.ad_account_external_id }, 'default')
                    : actButton('SUSPEND_ACCOUNT', { targetUserId: a.user_id, adAccountId: a.ad_account_external_id }, 'destructive')}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t('mm_a_incidents')}>
        {data.incidents.length === 0 ? <p className="text-sm text-muted-foreground">{t('mm_a_no_incidents')}</p> : (
          <ul className="space-y-2">
            {data.incidents.map((inc) => {
              const open = !RESOLVED.has(String(inc.status));
              return (
                <li key={inc.id} className="space-y-2 rounded-xl border border-border p-3 text-[13px]">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className={cn('rounded-full border px-2 text-2xs font-semibold leading-5', levelTone(inc.level))}>
                      <span className="sr-only">{t('mm_a_level')}: </span>{inc.level}
                    </span>
                    <span>{t('mm_a_action')}: <b className="font-mono" dir="ltr">{inc.action}</b></span>
                    <span>{t('mm_a_status')}: <b>{inc.status}</b></span>
                    <span>{t('mm_a_points')}: <span className="tabular-nums" dir="ltr">{inc.points}</span></span>
                    <When at={inc.created_at} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                    <span>{t('mm_a_protective')}: <span className="font-mono" dir="ltr">{inc.protective_action || '—'} / {inc.protective_status || '—'}</span></span>
                    <span>{t('mm_a_account')}: <span className="font-mono" dir="ltr">{inc.ad_account_external_id}</span></span>
                    <span>{t('mm_a_user')}: <Owner id={inc.user_id} /></span>
                    {inc.campaign_id && <span>{t('mm_a_campaign')}: <IdChip id={inc.campaign_id} /></span>}
                  </div>
                  <JsonDetails label={t('mm_a_evidence')} value={evidenceOf(inc)} />
                  <div className="flex flex-wrap gap-2">
                    {open && (
                      <>
                        {actButton('CLEAR_INCIDENT', { incidentId: inc.id })}
                        {actButton('DISMISS_INCIDENT', { incidentId: inc.id })}
                        {actButton('MARK_REVIEWED', { incidentId: inc.id })}
                      </>
                    )}
                    {inc.campaign_id && (
                      <>
                        {actButton('UNLOCK_CAMPAIGN', { campaignId: inc.campaign_id })}
                        {actButton('ACCEPT_EXTERNAL', { campaignId: inc.campaign_id })}
                        {actButton('RESTORE_CONFIG', { campaignId: inc.campaign_id }, 'destructive')}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title={t('mm_a_actions_log')}>
        {data.actions.length === 0 ? <p className="text-sm text-muted-foreground">{t('mm_a_no_actions')}</p> : (
          <ul className="space-y-1.5 text-[13px]">
            {data.actions.map((a, i) => (
              <li key={String(a.id ?? i)} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border/60 pb-1.5 last:border-0">
                <When at={String(a.created_at ?? '')} />
                <b className="font-mono" dir="ltr">{String(a.action ?? '')}</b>
                <span>{t('mm_a_user')}: <Owner id={String(a.target_user_id ?? '')} /></span>
                <span className="min-w-0 break-words text-muted-foreground">{t('mm_a_reason')}: {String(a.reason ?? '')}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Confirm
        open={pending !== null}
        onOpenChange={(v) => { if (!v && !busy) setPending(null); }}
        title={pending ? t('mm_a_confirm_title', { action: t(`mm_a_act_${pending.act}`) }) : ''}
        description={t('mm_a_confirm_desc')}
        confirmLabel={t('mm_a_confirm')}
        onConfirm={() => void run()}
        busy={busy}
        destructive={pending ? DESTRUCTIVE.has(pending.act) : false}
        confirmDisabled={reason.trim().length < MIN_REASON}
      >
        <label className="block space-y-1 text-sm" htmlFor="mm-guard-reason">
          <span className="font-medium">{t('mm_a_reason_label')}</span>
          <Textarea id="mm-guard-reason" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={t('mm_a_reason_ph')} maxLength={500} required aria-required="true" />
        </label>
      </Confirm>
    </div>
  );
}
