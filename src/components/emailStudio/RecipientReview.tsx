import { Link } from 'react-router-dom';
import { CheckCircle2, MinusCircle, ShieldCheck } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { reasonKey, type EligibilitySummary } from '@/emailStudio/eligibility';
import { INK, INK_SOFT, QUIET_BUTTON } from './styles';

/** Unlocked leads with their eligibility reason — display names only. */
export function RecipientReview({
  summary, selected, onToggle, onSelectAll, loading, disabled, leadsHref,
}: {
  summary: EligibilitySummary | null;
  selected: Set<string>;
  onToggle: (unlockId: string, on: boolean) => void;
  onSelectAll: () => void;
  loading: boolean;
  disabled: boolean;
  leadsHref: string;
}) {
  const { t } = useLanguage();
  if (loading || !summary) return <p className={cn('text-sm', INK_SOFT)} role="status">{t('es_loading')}</p>;
  if (!summary.items.length) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-[hsl(38_28%_80%)] p-4">
        <p className={cn('max-w-prose text-sm', INK_SOFT)}>{t('es_no_leads')}</p>
        <Link to={leadsHref} className={QUIET_BUTTON}>{t('es_open_leads')}</Link>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn('text-[15px] font-semibold', INK)} aria-live="polite">
          {t('es_recipients_summary', { eligible: summary.eligibleCount, total: summary.total })}
          <span className={cn('ms-2 text-sm font-normal', INK_SOFT)}>{t('es_recipient_selected', { count: selected.size })}</span>
        </p>
        <button type="button" className={QUIET_BUTTON} onClick={onSelectAll} disabled={disabled || summary.eligibleCount === 0}>
          {t('es_select_all_eligible')}
        </button>
      </div>
      <p className={cn('flex items-start gap-2 text-sm', INK_SOFT)}>
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(152_45%_35%)]" aria-hidden="true" />
        {t('es_recipients_privacy')}
      </p>
      <ul className="divide-y divide-[hsl(38_28%_90%)] rounded-xl border border-[hsl(38_28%_88%)]">
        {summary.items.map((item, i) => {
          const id = item.unlockId ?? `none-${i}`;
          const checkboxId = `es-rcpt-${id}`;
          return (
            <li key={id} className="flex min-h-[56px] items-center gap-3 px-3 py-2">
              {item.eligible && item.unlockId ? (
                <Checkbox id={checkboxId} className="h-5 w-5" checked={selected.has(item.unlockId)} disabled={disabled}
                  onCheckedChange={(v) => onToggle(item.unlockId!, v === true)} />
              ) : (
                <MinusCircle className="h-5 w-5 shrink-0 text-[hsl(218_12%_62%)]" aria-hidden="true" />
              )}
              <label htmlFor={item.eligible ? checkboxId : undefined} className="min-w-0 flex-1">
                <span className={cn('block truncate text-[15px] font-medium', INK)}>{item.displayName || '—'}</span>
                <span className={cn('flex items-center gap-1 text-sm', item.eligible ? 'text-[hsl(152_45%_30%)]' : INK_SOFT)}>
                  {item.eligible ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                  {t(reasonKey(item.eligible ? null : item.reason))}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
