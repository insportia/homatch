// HOMATCH INVESTMENT INTELLIGENCE — the five numbers that are the deal.
//
// WHY FIVE AND NOT FIFTEEN
//
// This strip is what somebody reads in the two seconds before they decide
// whether to keep reading. Fifteen metrics is a dashboard and communicates
// nothing; five is an answer. Each one is a different QUESTION rather than
// a different slice of the same one:
//
//   what it yields          the headline return on the price
//   what it clears          cash, after costs and after the bank
//   when it pays back       the question most people actually have
//   what the deal returns   the whole hold-and-exit scenario
//   what it cost            the capital that had to leave the account
//
// The gold one is the answer to whatever the Consultant was last asked
// about; the others stay quiet. One emphasis at a time is what makes an
// emphasis mean anything.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { InvestmentModel } from '@/investment/types';
import type { CapabilityId } from '@/investment/consultant/capabilities';
import { FigureValue, formatMoney, intlLocaleFor } from './primitives';

const HIGHLIGHT_FOR: Partial<Record<CapabilityId, string>> = {
  INCOME_AND_YIELD: 'yield',
  VACANCY_REALITY: 'yield',
  MONEY_BACK: 'payback',
  CASH_FLOW: 'cashflow',
  FINANCING: 'cashflow',
  HOLD_AND_SELL: 'deal',
  RENOVATE_AND_SELL: 'deal',
  EXIT_DELAY: 'deal',
  STRESS_TEST: 'deal',
};

export function SnapshotRail({
  model,
  focus,
}: {
  model: InvestmentModel;
  focus: CapabilityId[];
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const currency = model.currency;
  const highlight = focus.length ? (HIGHLIGHT_FOR[focus[0]] ?? 'yield') : 'yield';

  const cells = [
    {
      id: 'yield',
      labelKey: 'inv_snap_gross_yield',
      figure: model.yields.grossYieldOnPurchasePrice,
      kind: 'percent' as const,
      subKey: 'inv_snap_gross_yield_sub',
    },
    {
      id: 'cashflow',
      labelKey: 'inv_snap_cash_flow',
      figure: model.leverage.annualNetCashFlowAfterDebt,
      kind: 'money' as const,
      subKey: 'inv_snap_cash_flow_sub',
    },
    {
      id: 'payback',
      labelKey: 'inv_snap_payback',
      figure: model.payback.propertyPaybackYears,
      kind: 'years' as const,
      subKey: 'inv_snap_payback_sub',
    },
    {
      id: 'deal',
      labelKey: 'inv_snap_deal_return',
      figure: model.holdAndExit?.returnOnInvestedCashPercent ?? {
        value: null,
        unavailable: 'MISSING_INPUT' as const,
      },
      kind: 'percent' as const,
      subKey: 'inv_snap_deal_return_sub',
    },
  ];

  return (
    <div className="hm-invest-panel overflow-hidden">
      <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5 lg:divide-x rtl:lg:divide-x-reverse">
        {cells.map((cell) => (
          <div
            key={cell.id}
            className={cn(
              'p-5 transition-colors',
              cell.id === highlight && 'bg-[hsl(var(--gold-soft))]',
            )}
          >
            <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              {t(cell.labelKey)}
            </p>
            <p
              className={cn(
                'mt-1.5 font-display text-2xl font-semibold leading-none',
                cell.id === highlight ? 'text-[hsl(var(--gold-ink))]' : 'text-foreground',
              )}
            >
              <FigureValue figure={cell.figure} kind={cell.kind} currency={currency} />
            </p>
            <p className="mt-1.5 text-2xs text-muted-foreground">{t(cell.subKey)}</p>
          </div>
        ))}
        <div className="p-5">
          <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('inv_snap_capital')}
          </p>
          <p className="mt-1.5 font-display text-2xl font-semibold leading-none text-foreground">
            {formatMoney(model.capital.investorCashInvested, currency, locale, { compact: true })}
          </p>
          <p className="mt-1.5 text-2xs text-muted-foreground">{t('inv_snap_capital_sub')}</p>
        </div>
      </div>
    </div>
  );
}
