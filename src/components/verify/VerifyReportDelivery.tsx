// The research finished; the REPORT did not arrive (yet). Research completion
// is not report delivery (src/verify/reportDelivery.ts; prod 674df06e,
// 2026-10-29): this card replaces the old evidence-only fallback, which
// presented a finished-looking report shell while synthesis had FAILED.
//
//   PREPARING    the report is being written or retried by the server: a
//                calm wait, re-checked every minute while the tab is visible
//                (a re-check reads the persisted report or answers "pending";
//                it never starts a second build).
//   FAILED       every attempt was spent: an honest failure, nothing charged
//                (billing released the use), Admin can retry the report.
//   LOAD_FAILED  the report exists but could not be loaded here: try again.
import React, { useEffect, useRef } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';

export type VerifyReportDeliveryView = 'PREPARING' | 'FAILED' | 'LOAD_FAILED';

const RECHECK_MS = 60_000;

export function VerifyReportDelivery({ state, busy, onRetry }: { state: VerifyReportDeliveryView | null; busy: boolean; onRetry: () => void }) {
  const { t } = useLanguage();
  const view: VerifyReportDeliveryView = state ?? 'PREPARING';
  /* The latest callback, so a parent re-render never restarts the minute. */
  const retry = useRef(onRetry);
  retry.current = onRetry;

  useEffect(() => {
    if (view !== 'PREPARING' || busy) return;
    const id = window.setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') retry.current();
    }, RECHECK_MS);
    return () => window.clearInterval(id);
  }, [view, busy]);

  if (view === 'FAILED') {
    return (
      <section role="alert" className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/10 p-5" data-testid="verify-report-failed" aria-labelledby="verify-report-failed-title">
        <h2 id="verify-report-failed-title" className="flex items-center gap-2 text-base font-semibold">
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <span className="min-w-0 break-words">{t('verify_delivery_failed_title')}</span>
        </h2>
        <p className="min-w-0 break-words text-sm leading-6 text-muted-foreground">{t('verify_delivery_failed_body')}</p>
        <p className="min-w-0 break-words text-sm leading-6 text-muted-foreground">{t('verify_delivery_failed_charge')}</p>
      </section>
    );
  }

  const loadFailed = view === 'LOAD_FAILED';
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5" data-testid={loadFailed ? 'verify-report-load-failed' : 'verify-report-preparing'} aria-labelledby="verify-report-delivery-title" aria-busy={busy}>
      <h2 id="verify-report-delivery-title" className="flex items-center gap-2 text-base font-semibold">
        {loadFailed
          ? <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          : <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        <span className="min-w-0 break-words">{t(loadFailed ? 'verify_delivery_load_failed_title' : 'verify_delivery_preparing_title')}</span>
      </h2>
      <p className="min-w-0 break-words text-sm leading-6 text-muted-foreground" aria-live="polite">
        {t(loadFailed ? 'verify_delivery_load_failed_body' : 'verify_delivery_preparing_body')}
      </p>
      <Button type="button" variant="outline" size="sm" className="h-auto min-h-11 whitespace-normal px-4 py-2" disabled={busy} onClick={onRetry}>
        <RefreshCw className={`me-2 h-4 w-4 shrink-0 ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
        {t(busy ? 'verify_delivery_checking' : loadFailed ? 'verify_delivery_try_again' : 'verify_delivery_check_again')}
      </Button>
    </section>
  );
}
