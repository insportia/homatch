// META ADS — Guard banner for the workspace. Calm by design: a suspended ad
// account pauses HOMATCH-managed actions, never the customer's statistics or
// leads. WATCH is a gentle notice; ACTIVE renders nothing at all.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { guardStatus, type GuardAccountRow, type GuardIncidentRow, type MetaStatus } from '@/services/metaAds';

export function GuardBanner({ guard }: { guard: MetaStatus['guard'] | undefined }) {
  const { t } = useLanguage();
  const accounts = guard?.enabled === false ? [] : (guard?.accounts ?? []);
  const suspended = accounts.filter(a => a.status === 'SUSPENDED');
  const watching = accounts.filter(a => a.status === 'WATCH');
  const needsDetail = suspended.length + watching.length > 0;
  const [incidents, setIncidents] = useState<GuardIncidentRow[]>([]);

  useEffect(() => {
    if (!needsDetail) return;
    let live = true;
    guardStatus().then(r => { if (live) setIncidents(r.incidents ?? []); }).catch(() => undefined);
    return () => { live = false; };
  }, [needsDetail]);

  if (!needsDetail) return null;
  const maxStrikes = guard?.maxStrikes ?? 0;
  // The most recent incident explains the state in the customer's words.
  const latest = incidents.find(i => i.customer_key) ?? null;
  const incidentText = (acct: GuardAccountRow) => latest
    ? t(`mm_${latest.customer_key}`, { count: acct.active_warnings, max: maxStrikes, strikes: acct.active_strikes })
    : null;

  return (
    <div className="space-y-2">
      {suspended.map(a => (
        <section key={a.ad_account_external_id} role="status" aria-live="polite"
          className="rounded-xl border border-[hsl(32_78%_36%)]/40 bg-[hsl(32_78%_36%)]/10 px-4 py-3 text-foreground">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(32_78%_42%)]" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-semibold">{t('mm_w_guard_suspended_title')}</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{t('mm_w_guard_suspended_body')}</p>
              <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-muted-foreground">
                <span className="break-all">{t('mm_w_guard_account', { id: a.ad_account_external_id })}</span>
                {maxStrikes > 0 && (
                  <span className="tabular-nums">{t('mm_w_guard_strikes', { count: a.active_strikes, max: maxStrikes })}</span>
                )}
              </p>
              {incidentText(a) && <p className="text-[13px] text-muted-foreground">{incidentText(a)}</p>}
              <Link to="/contact" className="inline-flex min-h-8 items-center text-sm font-semibold text-[hsl(var(--gold-ink))] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">
                {t('mm_w_guard_contact')}
              </Link>
            </div>
          </div>
        </section>
      ))}
      {suspended.length === 0 && watching.map(a => (
        <section key={a.ad_account_external_id} role="status"
          className="rounded-xl border border-border bg-[hsl(var(--secondary))] px-4 py-2.5 text-foreground">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm font-semibold">{t('mm_w_guard_watch_title')}</p>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{t('mm_w_guard_watch_body')}</p>
              {maxStrikes > 0 && a.active_strikes > 0 && (
                <p className="text-[13px] tabular-nums text-muted-foreground">{t('mm_w_guard_strikes', { count: a.active_strikes, max: maxStrikes })}</p>
              )}
              {incidentText(a) && <p className="text-[13px] text-muted-foreground">{incidentText(a)}</p>}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
