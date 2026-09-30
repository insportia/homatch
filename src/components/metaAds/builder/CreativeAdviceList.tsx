// CREATIVE QUALITY ADVICE — creativeAdvice() rendered in the customer's
// words. Four severities, one of which blocks: BLOCKING_ERROR (red). INFO is
// neutral; RECOMMENDATION and WARNING are amber and never stop anyone.
import React from 'react';
import { AlertTriangle, Info, Lightbulb, XCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { AdviceItem } from '@/lib/metaAds/creativeAdvice';
import { adviceKey, adviceTone } from './masterLogic';

const TONE = {
  neutral: 'border-border bg-[hsl(var(--secondary))]/50 text-muted-foreground',
  amber: 'border-[hsl(38_80%_45%)]/35 bg-[hsl(45_95%_55%)]/10 text-[hsl(32_78%_28%)] dark:text-[hsl(40_90%_70%)]',
  red: 'border-destructive/35 bg-destructive/10 text-destructive',
} as const;

function Icon({ severity }: { severity: string }) {
  const cls = 'mt-0.5 h-3.5 w-3.5 shrink-0';
  if (severity === 'BLOCKING_ERROR') return <XCircle className={cls} aria-hidden />;
  if (severity === 'WARNING') return <AlertTriangle className={cls} aria-hidden />;
  if (severity === 'RECOMMENDATION') return <Lightbulb className={cls} aria-hidden />;
  return <Info className={cls} aria-hidden />;
}

const vars = (p?: Record<string, string | number>) => Object.fromEntries(Object.entries(p ?? {}).map(([k, v]) => [k, String(v)]));

export function AdviceList({ items, className }: { items: AdviceItem[]; className?: string }) {
  const { t } = useLanguage();
  if (items.length === 0) return null;
  return (
    <ul className={cn('space-y-1.5', className)}>
      {items.map((a, i) => (
        <li key={`${a.code}-${i}`} data-severity={a.severity}
          className={cn('flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-2xs leading-relaxed', TONE[adviceTone(a.severity)])}>
          <Icon severity={a.severity} />
          <span className="min-w-0">
            <span className="sr-only">{t(`mm_b_sev_${a.severity}`)}: </span>
            {t(adviceKey(a.code), vars(a.params))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Campaign-wide advice plus what the budget can test well. */
export function CreativeBudgetAdvice({ general, recommendedCount, heldBackCount, loading }: {
  general: AdviceItem[]; recommendedCount: number | null; heldBackCount: number; loading: boolean;
}) {
  const { t } = useLanguage();
  if (!recommendedCount && general.length === 0) return null;
  return (
    <div className="space-y-2 rounded-2xl border border-[hsl(var(--gold-border))]/60 bg-[hsl(var(--gold-soft))]/40 p-3.5" aria-live="polite" aria-busy={loading}>
      {recommendedCount ? (
        <p className="text-[13px] font-medium text-foreground">
          {t(recommendedCount === 1 ? 'mm_b_budget_tests_one' : 'mm_b_budget_tests_n', { n: String(recommendedCount) })}
          {heldBackCount > 0 && <span className="block text-2xs font-normal text-muted-foreground">{t('mm_b_held_back_summary', { n: String(heldBackCount) })}</span>}
        </p>
      ) : null}
      <AdviceList items={general} />
    </div>
  );
}
