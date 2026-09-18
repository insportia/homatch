// HOMATCH INVESTMENT INTELLIGENCE — the capital stack and what debt costs.
//
// WHAT THE STACK SHOWS THAT A TABLE DOES NOT
//
// Two bars. The first is how the PROPERTY was paid for — equity against
// debt. The second is what the investor's own cash actually consists of,
// which is almost never just the deposit: acquisition costs, renovation,
// furnishing and the lender's own one-time charges are all cash out of the
// same pocket, and every one of them is missing from the calculation
// people usually do in their head.
//
// The two bars are deliberately the same width and stacked, so the gap
// between "my 35%" and "what I actually paid" is a shape rather than a
// subtraction the reader has to perform.
//
// INTEREST AGAINST PRINCIPAL
//
// Shown over the HOLD period, not over the loan's whole term, because the
// hold is the decision. Early in a twenty-year loan almost the entire
// payment is interest, and an investor planning a one-year exit is buying
// that fact whether or not anybody tells them.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { InvestmentModel } from '@/investment/types';
import { FigureValue, Metric, Module, NeedsInput, formatMoney, intlLocaleFor } from './primitives';

export function FinancingModule({
  model,
  focused,
  missing,
}: {
  model: InvestmentModel;
  focused: boolean;
  missing: string[];
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const currency = model.currency;
  const leverage = model.leverage;
  const capital = model.capital;

  if (!leverage.financed) {
    return (
      <Module
        id="financing"
        eyebrowKey="inv_mod_financing_eyebrow"
        titleKey="inv_mod_financing_title"
        subtitleKey="inv_mod_financing_sub"
        focused={focused}
      >
        <p className="mb-4 text-sm text-foreground">{t('inv_financing_all_cash')}</p>
        <NeedsInput missing={missing} />
      </Module>
    );
  }

  const price = capital.purchasePrice || 1;
  const equity = leverage.downPayment.value ?? 0;
  const loan = leverage.loanAmount.value ?? 0;

  const cashParts = [
    { key: 'downPayment', amount: equity, className: 'bg-[hsl(var(--gold))]' },
    { key: 'acquisitionCosts', amount: capital.acquisitionCosts, className: 'bg-[hsl(var(--info))]' },
    { key: 'renovation', amount: capital.renovationCost, className: 'bg-[hsl(var(--chart-4))]' },
    { key: 'furnishing', amount: capital.furnishingCost, className: 'bg-[hsl(var(--chart-5))]' },
    { key: 'financingUpfront', amount: capital.financingUpfrontCosts, className: 'bg-[hsl(var(--muted-foreground))]' },
  ].filter((part) => part.amount > 0);
  const cashTotal = capital.investorCashInvested || 1;

  const interest = leverage.interestPaidOverHold.value ?? 0;
  const principal = leverage.principalRepaidOverHold.value ?? 0;
  const serviced = interest + principal || 1;

  const dscr = leverage.debtServiceCoverageRatio.value;

  return (
    <Module
      id="financing"
      eyebrowKey="inv_mod_financing_eyebrow"
      titleKey="inv_mod_financing_title"
      subtitleKey="inv_mod_financing_sub"
      focused={focused}
    >
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Metric labelKey="inv_m_loan_amount" figure={leverage.loanAmount} kind="money" currency={currency} />
        <Metric labelKey="inv_m_ltv" figure={leverage.loanToValuePercent} kind="percent" decimals={1} />
        <Metric
          labelKey="inv_m_monthly_payment"
          figure={leverage.monthlyPayment}
          kind="money"
          currency={currency}
          emphasis
          decimals={0}
        />
        <Metric
          labelKey="inv_m_cash_on_cash"
          figure={model.yields.cashOnCashReturn}
          kind="percent"
          noteKey="inv_m_cash_on_cash_note"
        />
      </div>

      {/* ── The stack ─────────────────────────────────────────────── */}
      <div className="mt-8 space-y-6">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('inv_stack_property')}
          </p>
          <div className="flex h-9 w-full overflow-hidden rounded-lg">
            <div
              className="flex items-center justify-center bg-[hsl(var(--gold))] text-2xs font-medium text-[hsl(var(--primary-foreground))]"
              style={{ width: `${(equity / price) * 100}%` }}
            >
              {equity / price > 0.14 ? t('inv_stack_equity') : null}
            </div>
            <div
              className="flex items-center justify-center bg-[hsl(var(--secondary))] text-2xs font-medium text-muted-foreground"
              style={{ width: `${(loan / price) * 100}%` }}
            >
              {loan / price > 0.14 ? t('inv_stack_debt') : null}
            </div>
          </div>
          <div className="mt-2 flex justify-between text-2xs text-muted-foreground">
            <span>
              {t('inv_stack_equity')} {formatMoney(equity, currency, locale)}
            </span>
            <span>
              {t('inv_stack_debt')} {formatMoney(loan, currency, locale)}
            </span>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('inv_stack_cash')}
          </p>
          <div className="flex h-9 w-full overflow-hidden rounded-lg">
            {cashParts.map((part) => (
              <div
                key={part.key}
                className={cn('h-full', part.className)}
                style={{ width: `${(part.amount / cashTotal) * 100}%` }}
                title={t(`inv_cashpart_${part.key}`)}
              />
            ))}
          </div>
          <ul className="mt-3 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
            {cashParts.map((part) => (
              <li key={part.key} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className={cn('h-2 w-2 rounded-full', part.className)} aria-hidden="true" />
                  {t(`inv_cashpart_${part.key}`)}
                </span>
                <span className="tabular-nums text-foreground">
                  {formatMoney(part.amount, currency, locale)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-border pt-3 text-sm">
            <span className="text-muted-foreground">{t('inv_stack_cash_total')} </span>
            <span className="font-display font-semibold tabular-nums text-[hsl(var(--gold-ink))]">
              {formatMoney(capital.investorCashInvested, currency, locale)}
            </span>
          </p>
        </div>
      </div>

      {/* ── Interest against principal over the hold ─────────────── */}
      <div className="mt-8">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('inv_debt_split', { months: model.holdAndExit?.holdMonths ?? 12 })}
        </p>
        <div className="flex h-9 w-full overflow-hidden rounded-lg">
          <div
            className="flex items-center justify-center bg-[hsl(var(--destructive)/0.75)] text-2xs font-medium text-foreground"
            style={{ width: `${(interest / serviced) * 100}%` }}
          >
            {interest / serviced > 0.16 ? t('inv_debt_interest') : null}
          </div>
          <div
            className="flex items-center justify-center bg-[hsl(var(--success)/0.7)] text-2xs font-medium text-foreground"
            style={{ width: `${(principal / serviced) * 100}%` }}
          >
            {principal / serviced > 0.16 ? t('inv_debt_principal') : null}
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <SmallStat labelKey="inv_debt_interest" figure={leverage.interestPaidOverHold} currency={currency} />
          <SmallStat labelKey="inv_debt_principal" figure={leverage.principalRepaidOverHold} currency={currency} />
          <SmallStat labelKey="inv_debt_remaining" figure={leverage.remainingDebtAtExit} currency={currency} />
        </div>
        <p className="mt-3 text-2xs text-muted-foreground">{t('inv_debt_principal_note')}</p>
      </div>

      {/* ── Coverage ─────────────────────────────────────────────── */}
      <div
        className={cn(
          'mt-6 rounded-xl border p-4',
          dscr !== null && dscr < 1
            ? 'border-[hsl(var(--warning)/0.45)] bg-[hsl(var(--gold-soft))]'
            : 'border-border bg-[hsl(var(--secondary))]',
        )}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('inv_m_dscr')}
          </p>
          <p className="font-display text-lg font-semibold text-foreground">
            <FigureValue figure={leverage.debtServiceCoverageRatio} kind="ratio" />
          </p>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {dscr === null
            ? t('inv_dscr_unknown')
            : dscr < 1
              ? t('inv_dscr_below', {
                  amount: formatMoney(
                    Math.abs(leverage.annualNetCashFlowAfterDebt.value ?? 0),
                    currency,
                    locale,
                  ),
                })
              : t('inv_dscr_above', {
                  amount: formatMoney(leverage.annualNetCashFlowAfterDebt.value ?? 0, currency, locale),
                })}
        </p>
      </div>
    </Module>
  );
}

function SmallStat({
  labelKey,
  figure,
  currency,
}: {
  labelKey: string;
  figure: InvestmentModel['leverage']['interestPaidOverHold'];
  currency: string;
}) {
  const { t } = useLanguage();
  return (
    <div className="rounded-lg border border-border bg-[hsl(var(--secondary))] px-3 py-2.5">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">{t(labelKey)}</p>
      <p className="mt-1 font-display text-base font-semibold text-foreground">
        <FigureValue figure={figure} kind="money" currency={currency} />
      </p>
    </div>
  );
}
