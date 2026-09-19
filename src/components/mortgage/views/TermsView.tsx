// HOMATCH HOME FINANCING — what a longer or shorter term actually costs.
//
// The trade-off is the whole content, so it is drawn twice: once as two
// bars per row (monthly burden against lifetime interest, to the same
// scale across every row) and once as the deltas against the term the
// borrower has actually chosen.
//
// NO ROW IS RECOMMENDED. A shorter term is cheaper over a lifetime and
// harder every month, and which of those matters more is a fact about
// the borrower's life that this product does not have. The engine's own
// header says the same thing, and it is why compareTerms returns deltas
// rather than a ranking.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Module, formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import type { TermComparisonRow } from '@/mortgage/types';

export function TermsView({
  rows,
  currency,
  onSelectTerm,
}: {
  rows: TermComparisonRow[];
  currency: string;
  onSelectTerm: (termMonths: number) => void;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);

  const maxPayment = Math.max(...rows.map((r) => r.monthlyPayment), 1);
  const maxInterest = Math.max(...rows.map((r) => r.totalInterest), 1);

  return (
    <Module
      id="terms"
      eyebrowKey="mortgage_mod_terms_eyebrow"
      titleKey="mortgage_mod_terms_title"
      subtitleKey="mortgage_mod_terms_sub"
    >
      <ul className="space-y-2.5">
        {rows.map((row) => (
          <li key={row.termMonths}>
            <button
              type="button"
              onClick={() => onSelectTerm(row.termMonths)}
              aria-pressed={row.isSelected}
              className={cn(
                'w-full rounded-xl border p-4 text-start transition-colors',
                row.isSelected
                  ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]'
                  : 'border-border bg-[hsl(var(--secondary))] hover:border-[hsl(var(--gold-border))]',
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span
                  className={cn(
                    'font-display text-base font-semibold',
                    row.isSelected ? 'text-[hsl(var(--gold-ink))]' : 'text-foreground',
                  )}
                >
                  {t('mortgage_years_value', { years: row.termMonths / 12 })}
                </span>
                {row.isSelected ? (
                  <span className="text-2xs uppercase tracking-wide text-[hsl(var(--gold-ink))]">
                    {t('mortgage_term_compare_selected')}
                  </span>
                ) : (
                  <span className="text-2xs text-muted-foreground">
                    {row.monthlyPaymentDeltaVsSelected > 0 ? '+' : ''}
                    {formatMoney(row.monthlyPaymentDeltaVsSelected, currency, locale)}
                    {' / '}
                    {t('mortgage_per_month')}
                    {' · '}
                    {row.totalCostDeltaVsSelected > 0 ? '+' : ''}
                    {formatMoney(row.totalCostDeltaVsSelected, currency, locale)}
                    {' '}
                    {t('mortgage_lifetime')}
                  </span>
                )}
              </div>

              <div className="mt-3 space-y-2">
                <div>
                  <div className="flex items-baseline justify-between gap-2 text-2xs text-muted-foreground">
                    <span>{t('mortgage_metric_monthly_payment')}</span>
                    <span className="tabular-nums text-foreground">
                      {formatMoney(row.monthlyPayment, currency, locale)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[hsl(var(--muted))]" dir="ltr">
                    <div
                      className="h-full rounded-full bg-[hsl(var(--gold))]"
                      style={{ width: `${(row.monthlyPayment / maxPayment) * 100}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline justify-between gap-2 text-2xs text-muted-foreground">
                    <span>{t('mortgage_metric_total_interest')}</span>
                    <span className="tabular-nums text-foreground">
                      {formatMoney(row.totalInterest, currency, locale)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[hsl(var(--muted))]" dir="ltr">
                    <div
                      className="h-full rounded-full bg-[hsl(var(--info))]"
                      style={{ width: `${(row.totalInterest / maxInterest) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-5 max-w-[64ch] text-2xs leading-relaxed text-muted-foreground">
        {t('mortgage_terms_tradeoff_note')}
      </p>
    </Module>
  );
}
