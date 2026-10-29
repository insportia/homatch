// ADMIN · the transactional email delivery log (/admin/notification-delivery).
//
// What an operator needs when somebody says "I never got the email": the event, its
// status (QUEUED, RETRYING, SENT, DELIVERED, BOUNCED, COMPLAINED, FAILED, SKIPPED),
// how many attempts, when the next one is, and the last error. Metadata only: no
// address, no subject, no message text (admin_notification_deliveries).
//
// "Retry now" schedules the delivery for the next jobs-worker tick under the same
// delivery id (so the provider idempotency key is reused) and is written to
// admin_audit_log by admin_notification_delivery_retry. Delivered, bounced,
// complained and skipped rows cannot be retried.

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/db/supabase';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Confirm, Empty, ErrorNote, IdChip, When } from '@/components/admin/control/AdminKit';

interface DeliveryRow {
  id: string;
  created_at: string;
  source: string | null;
  event_key: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  essential: boolean | null;
  user_id: string;
  retryable_payload: boolean;
}

const RETRYABLE = new Set(['FAILED', 'RETRYING', 'QUEUED']);
const TONE: Record<string, string> = {
  DELIVERED: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
  SENT: 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
  RETRYING: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
  QUEUED: 'border-amber-500/30 text-amber-600 dark:text-amber-400',
  FAILED: 'border-destructive/40 text-destructive',
  BOUNCED: 'border-destructive/40 text-destructive',
  COMPLAINED: 'border-destructive/40 text-destructive',
};

export function NotificationDeliveryLog({ days }: { days: number }) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState<'ALL' | 'PROBLEMS'>('PROBLEMS');
  const [rows, setRows] = useState<DeliveryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<DeliveryRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: e } = await supabase.rpc('admin_notification_deliveries', { p_filter: filter, p_days: Math.min(days, 90), p_limit: 200 });
    if (e) setError(e.message); else setRows(Array.isArray(data) ? (data as DeliveryRow[]) : []);
    setLoading(false);
  }, [filter, days]);
  useEffect(() => { void load(); }, [load]);

  const retry = async () => {
    if (!target) return;
    setBusy(true);
    const { data, error: e } = await supabase.rpc('admin_notification_delivery_retry', { p_id: target.id, p_note: null });
    setBusy(false);
    const result = (data ?? {}) as { ok?: boolean; error?: string };
    if (e || !result.ok) {
      toast.error(t('admin_ntf_retry_failed', { reason: e?.message ?? result.error ?? 'UNKNOWN' }));
    } else {
      toast.success(t('admin_ntf_retry_done'));
      setTarget(null);
      void load();
    }
  };

  return (
    <section className="space-y-3" aria-labelledby="ntf-log-title" data-testid="admin-notification-delivery-log">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id="ntf-log-title" className="text-base font-semibold">{t('admin_ntf_log_title')}</h2>
          <p className="text-xs text-muted-foreground">{t('admin_ntf_log_sub')}</p>
        </div>
        <div className="flex items-center gap-1">
          {(['PROBLEMS', 'ALL'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
              className={cn('min-h-9 rounded-full border px-3 text-sm', filter === f ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted')}>
              {t(f === 'ALL' ? 'admin_ntf_filter_all' : 'admin_ntf_filter_problems')}
            </button>
          ))}
          <button type="button" onClick={() => void load()} aria-label={t('admin_ntf_log_title')}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border hover:bg-muted">
            <RefreshCw className={cn('h-4 w-4', loading && 'motion-safe:animate-spin')} aria-hidden="true" />
          </button>
        </div>
      </div>

      {error ? <ErrorNote message={error} /> : null}
      {rows && rows.length === 0 ? <Empty>{t('admin_ntf_empty')}</Empty> : null}
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                {['admin_ntf_col_when', 'admin_ntf_col_event', 'admin_ntf_col_status', 'admin_ntf_col_attempts', 'admin_ntf_col_next', 'admin_ntf_col_error', 'admin_ntf_col_action']
                  .map((k) => <th key={k} scope="col" className="px-3 py-2 text-start font-medium">{t(k)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-3 py-2"><When at={r.created_at} /></td>
                  <td className="px-3 py-2">
                    <code dir="ltr" className="text-xs">{r.event_key ?? r.source ?? '—'}</code>
                    {r.essential ? <span className="ms-1 rounded bg-muted px-1 text-2xs text-muted-foreground">{t('admin_ntf_essential')}</span> : null}
                    <div className="mt-1"><IdChip id={r.user_id} /></div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', TONE[r.status] ?? 'border-border text-muted-foreground')} dir="ltr">{r.status}</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">{r.attempts} / {r.max_attempts}</td>
                  <td className="whitespace-nowrap px-3 py-2"><When at={r.next_attempt_at} /></td>
                  <td className="max-w-[260px] px-3 py-2"><code dir="ltr" className="block break-words text-xs text-muted-foreground">{r.last_error ?? '—'}</code></td>
                  <td className="px-3 py-2">
                    {RETRYABLE.has(r.status) && r.retryable_payload ? (
                      <button type="button" onClick={() => setTarget(r)}
                        className="min-h-9 rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted">
                        {t('admin_ntf_retry')}
                      </button>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Confirm open={target !== null} onOpenChange={(v) => { if (!v) setTarget(null); }}
        title={t('admin_ntf_retry')} description={t('admin_ntf_retry_confirm')}
        confirmLabel={t('admin_ntf_retry')} onConfirm={() => void retry()} busy={busy} />
    </section>
  );
}
