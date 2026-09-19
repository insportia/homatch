// WHERE EACH MONTH ACTUALLY GOES.
//
// The four headline figures used to live here too. They moved to the
// top of the page, where the answer belongs; what is left is the part
// somebody opens deliberately — the split of the first payment, and the
// schedule behind it.
//
// WHY THE SCHEDULE IS NOT A TABLE ON A PHONE
//
// It was: five columns of currency at 320px, which renders as five
// columns of about eleven pixels each. Below the `sm` breakpoint each
// month is a card instead, and the thing a borrower is actually looking
// for — how much of this payment is interest — is a bar rather than two
// numbers they have to divide in their head.
//
// And not 240 rows either. The first year, the last year, and one row
// per year in between: the shape of an amortizing loan is entirely
// visible from that, and a 240-row list is a wall nobody reads.

import React, { useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Module, formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import type { AmortizationRow, MortgageCalculationResult } from '@/mortgage/types';

/**
 * Which months to show.
 *
 * Every month of the first year, because that is the one somebody is
 * about to live through; then one row a year; then the final month,
 * because the last payment being almost all principal is the clearest
 * possible illustration of what amortization does.
 */
export function scheduleHighlights(schedule: AmortizationRow[]): AmortizationRow[] {
  if (schedule.length <= 14) return schedule;
  const picked = new Map<number, AmortizationRow>();
  for (const row of schedule.slice(0, 12)) picked.set(row.month, row);
  for (const row of schedule) {
    if (row.month % 12 === 0) picked.set(row.month, row);
  }
  const last = schedule[schedule.length - 1];
  picked.set(last.month, last);
  return [...picked.values()].sort((a, b) => a.month - b.month);
}

export function ScheduleView({
  result,
  currency,
}: {
  result: MortgageCalculationResult;
  currency: string;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(
    () => (showAll ? result.amortizationSchedule : scheduleHighlights(result.amortizationSchedule)),
    [showAll, result.amortizationSchedule],
  );

  const firstRow = result.amortizationSchedule[0];

  return (
    <>
      <Module
        id="schedule"
        eyebrowKey="mortgage_mod_schedule_eyebrow"
        titleKey="mortgage_schedule_title"
        subtitleKey="mortgage_schedule_explainer"
      >
        {/* Where the first payment actually goes. The single most
            useful thing about an amortizing loan, and the one nobody is
            told: early on, most of it is interest. */}
        {firstRow && firstRow.totalPayment > 0 ? (
          <div className="mb-8">
            <p className="mb-2.5 text-sm text-muted-foreground">{t('mortgage_first_payment_split')}</p>
            <div className="flex h-9 w-full overflow-hidden rounded-lg" dir="ltr">
              <div
                className="flex items-center justify-center bg-[hsl(var(--gold))] text-2xs font-medium text-[hsl(var(--primary-foreground))]"
                style={{ width: `${(firstRow.interestPortion / firstRow.totalPayment) * 100}%` }}
              >
                {firstRow.interestPortion / firstRow.totalPayment > 0.22
                  ? t('mortgage_schedule_col_interest')
                  : null}
              </div>
              <div
                className="flex items-center justify-center bg-[hsl(var(--secondary))] text-2xs font-medium text-muted-foreground"
                style={{ width: `${(firstRow.principalPortion / firstRow.totalPayment) * 100}%` }}
              >
                {firstRow.principalPortion / firstRow.totalPayment > 0.22
                  ? t('mortgage_schedule_col_principal')
                  : null}
              </div>
              <div
                className="bg-[hsl(var(--muted))]"
                style={{ width: `${(firstRow.recurringKnownCosts / firstRow.totalPayment) * 100}%` }}
              />
            </div>
            <p className="mt-2 text-2xs text-muted-foreground">
              {t('mortgage_first_payment_note', {
                interest: formatMoney(firstRow.interestPortion, currency, locale),
                principal: formatMoney(firstRow.principalPortion, currency, locale),
              })}
            </p>
          </div>
        ) : null}

        {/* Cards on a phone, a table from `sm` up. Two renderings of the
            same rows rather than one rendering that scrolls sideways. */}
        <ul className="space-y-2 sm:hidden">
          {rows.map((row) => (
            <li key={row.month} className="rounded-xl border border-border bg-[hsl(var(--secondary))] p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {t('mortgage_schedule_month', { n: row.month })}
                </span>
                <span className="text-sm tabular-nums text-foreground">
                  {formatMoney(row.totalPayment, currency, locale)}
                </span>
              </div>
              <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full" dir="ltr">
                <div
                  className="bg-[hsl(var(--gold))]"
                  style={{ width: `${(row.interestPortion / Math.max(row.totalPayment, 1)) * 100}%` }}
                />
                <div
                  className="bg-[hsl(var(--border))]"
                  style={{ width: `${(row.principalPortion / Math.max(row.totalPayment, 1)) * 100}%` }}
                />
              </div>
              <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-2xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t('mortgage_schedule_col_interest')}</dt>
                  <dd className="tabular-nums text-foreground">
                    {formatMoney(row.interestPortion, currency, locale)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t('mortgage_schedule_col_principal')}</dt>
                  <dd className="tabular-nums text-foreground">
                    {formatMoney(row.principalPortion, currency, locale)}
                  </dd>
                </div>
                <div className="col-span-2 flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t('mortgage_schedule_col_remaining')}</dt>
                  <dd className="tabular-nums text-foreground">
                    {formatMoney(row.remainingPrincipal, currency, locale)}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>

        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[32rem] text-sm">
            <caption className="sr-only">{t('mortgage_schedule_title')}</caption>
            <thead>
              <tr className="text-2xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="py-2 text-start font-medium">
                  {t('mortgage_schedule_col_month')}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t('mortgage_schedule_col_interest')}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t('mortgage_schedule_col_principal')}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t('mortgage_schedule_col_payment')}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t('mortgage_schedule_col_remaining')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.month} className="border-t border-border">
                  <td className="py-2 tabular-nums text-foreground">{row.month}</td>
                  <td className="py-2 text-end tabular-nums text-muted-foreground">
                    {formatMoney(row.interestPortion, currency, locale)}
                  </td>
                  <td className="py-2 text-end tabular-nums text-muted-foreground">
                    {formatMoney(row.principalPortion, currency, locale)}
                  </td>
                  <td className="py-2 text-end tabular-nums text-foreground">
                    {formatMoney(row.totalPayment, currency, locale)}
                  </td>
                  <td className="py-2 text-end tabular-nums text-muted-foreground">
                    {formatMoney(row.remainingPrincipal, currency, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {result.amortizationSchedule.length > rows.length || showAll ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className={cn(
              'mt-4 min-h-11 rounded-full border border-border px-4 text-xs text-muted-foreground',
              'transition-colors hover:border-[hsl(var(--gold-border))] hover:text-foreground',
            )}
          >
            {showAll
              ? t('mortgage_schedule_show_summary')
              : t('mortgage_schedule_show_full', { n: result.amortizationSchedule.length })}
          </button>
        ) : null}
      </Module>
    </>
  );
}
