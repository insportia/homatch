// How long a delivered Verify report stays available, and what an expired
// one looks like (20261127090000: 30 days from completion).
//
// The date is the server's (retention_my_records, the customer's own rows);
// nothing here computes an expiry. A report delivered before the cutover has
// no record and stays permanent — then this renders nothing at all.
import React, { useEffect, useState } from 'react';
import { CalendarClock, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/db/supabase';
import { useLanguage } from '@/contexts/LanguageContext';
import { daysLeft, localDate } from '@/services/retentionView';

export function VerifyReportValidity({ jobId }: { jobId: string | null }) {
  const { t, lang } = useLanguage();
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setExpiresAt(null);
    if (!jobId) return;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('retention_my_records', { p_product: 'VERIFY_REPORT', p_source_ids: [jobId] });
        const row = !error && Array.isArray(data) ? (data as Array<{ expires_at: string | null }>).find((r) => r.expires_at) : null;
        if (alive) setExpiresAt(row?.expires_at ?? null);
      } catch {
        /* no date known: say nothing rather than guess one */
      }
    })();
    return () => { alive = false; };
  }, [jobId]);

  if (!expiresAt) return null;
  const left = daysLeft(expiresAt);
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground" data-testid="verify-report-validity">
      <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{t('rt_available_until', { date: localDate(expiresAt, lang) })}</span>
      <span className="tabular-nums text-[hsl(var(--gold-ink))]">{left <= 1 ? t('rt_last_day') : t('rt_days_left', { n: String(left) })}</span>
    </p>
  );
}

/** An expired report: no content, the reason, and a fresh run at the current price. */
export function VerifyReportExpired({ priceCredits, onNewVerification }: { priceCredits: number | null; onNewVerification: () => void }) {
  const { t } = useLanguage();
  return (
    <section className="space-y-3 rounded-xl border border-[hsl(var(--gold-border))] bg-card p-5" data-testid="verify-report-expired" aria-labelledby="verify-report-expired-title">
      <h2 id="verify-report-expired-title" className="flex items-center gap-2 text-base font-semibold">
        <Archive className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t('verify_report_expired_title')}
      </h2>
      <p className="min-w-0 break-words text-sm leading-6 text-muted-foreground">{t('rt_expired_body')}</p>
      <Button type="button" className="h-auto min-h-11 whitespace-normal" onClick={onNewVerification}>
        {priceCredits != null ? t('verify_rerun_cta', { n: String(priceCredits) }) : t('rt_new_verify')}
      </Button>
    </section>
  );
}
