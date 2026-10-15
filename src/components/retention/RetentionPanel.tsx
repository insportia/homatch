/*
 * The one retention notice on the Verify and Contracts history screens.
 *
 * Renders NOTHING unless the server has given this customer at least one
 * dated record — so before retention is activated (or for a customer with
 * only legacy records) the screens look exactly as they did. When it does
 * render it says only what is true: the policy, what expires soon, what has
 * expired, and how to start again. No report content is shown here.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { fetchRetention, localDate, retentionView, type RetentionProduct, type RetentionView } from '@/services/retention';

export function RetentionPanel({ product }: { product: RetentionProduct }) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [view, setView] = useState<RetentionView | null>(null);

  useEffect(() => {
    let alive = true;
    fetchRetention(product).then((rows) => { if (alive) setView(retentionView(rows)); });
    return () => { alive = false; };
  }, [product]);

  if (!view || (view.active.length === 0 && view.expired.length === 0)) return null;

  const isVerify = product === 'VERIFY_REPORT';
  const startNew = () => navigate(isVerify ? '/verify' : '/contracts');

  return (
    <section aria-labelledby={`retention-${product}`} className="space-y-3 rounded-lg border border-border/60 p-4">
      <h2 id={`retention-${product}`} className="flex items-center gap-2 text-sm font-semibold">
        <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t('rt_title')}
      </h2>
      <p className="min-w-0 break-words text-xs leading-relaxed text-muted-foreground">
        {t(isVerify ? 'rt_policy_verify' : 'rt_policy_contracts')}
      </p>

      {view.expiringSoon.length > 0 ? (
        <ul className="space-y-1.5" aria-label={t('rt_expiring_title')}>
          {view.expiringSoon.map((r) => (
            <li key={r.source_id} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
              <span className="min-w-0 break-words">{t('rt_available_until', { date: localDate(r.expires_at!, lang) })}</span>
              <span className="tabular-nums text-amber-600 dark:text-amber-400">
                {r.daysLeft <= 1 ? t('rt_last_day') : t('rt_days_left', { n: r.daysLeft })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {view.expired.length > 0 ? (
        <div className="space-y-1.5">
          <h3 className="flex items-center gap-2 text-xs font-semibold">
            <Archive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t('rt_expired_title')}
          </h3>
          <ul className="space-y-1">
            {view.expired.slice(0, 20).map((r) => (
              <li key={r.source_id} className="min-w-0 break-words text-xs text-muted-foreground">
                {t('rt_expired_on', { date: localDate(r.expires_at!, lang) })}
              </li>
            ))}
          </ul>
          <p className="min-w-0 break-words text-2xs text-muted-foreground">{t('rt_expired_body')}</p>
        </div>
      ) : null}

      <Button size="sm" variant="outline" onClick={startNew}>
        {t(isVerify ? 'rt_new_verify' : 'rt_new_analysis')}
      </Button>
    </section>
  );
}
