// HOMATCH INVESTMENT — best, base and cautious, side by side.
//
// The base case is exactly what the investor entered. The other two move
// only the things that genuinely move for a landlord (rent, empty months,
// running costs) by amounts stated on screen, and every figure comes from
// the same runInvestmentModel the rest of the page uses. Nothing here is a
// forecast or a market claim: they are the investor's own numbers, stressed.

import { useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { runInvestmentModel } from '@/investment/calculations';
import type { InvestmentInput, InvestmentModel, InvestmentOperatingCosts } from '@/investment/types';
import { Module, formatMoney, formatPercent, intlLocaleFor } from './primitives';

type Case = 'BEST' | 'BASE' | 'CAUTIOUS';

/* The stresses, stated once and shown to the investor verbatim. */
const STRESS: Record<Case, { rent: number; vacancyDelta: number; costs: number }> = {
  BEST: { rent: 1.1, vacancyDelta: -1, costs: 1 },
  BASE: { rent: 1, vacancyDelta: 0, costs: 1 },
  CAUTIOUS: { rent: 0.85, vacancyDelta: 2, costs: 1.2 },
};

/* Fields that are not amounts of money: a share of rent and a count of new tenancies. */
const NOT_MONEY = new Set(['managementPercentOfCollectedRent', 'tenanciesPerYear']);

function scaleCosts(costs: InvestmentOperatingCosts | undefined, k: number): InvestmentOperatingCosts | undefined {
  if (!costs || k === 1) return costs;
  const out: InvestmentOperatingCosts = { ...costs };
  for (const [key, value] of Object.entries(costs)) {
    if (typeof value === 'number' && !NOT_MONEY.has(key)) (out as Record<string, number>)[key] = value * k;
  }
  return out;
}

function stressed(input: InvestmentInput, c: Case): InvestmentModel | null {
  const s = STRESS[c];
  if (typeof input.monthlyRent !== 'number') return null;
  const vacant = Math.min(12, Math.max(0, (input.vacantMonthsPerYear ?? 0) + s.vacancyDelta));
  try {
    return runInvestmentModel({
      ...input,
      monthlyRent: input.monthlyRent * s.rent,
      vacantMonthsPerYear: vacant,
      operating: scaleCosts(input.operating, s.costs),
    });
  } catch {
    return null;
  }
}

export function ThreeScenariosModule({ model }: { model: InvestmentModel }) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const cases = useMemo(() => (['CAUTIOUS', 'BASE', 'BEST'] as Case[]).map((c) => ({ c, m: c === 'BASE' ? model : stressed(model.input, c) })), [model]);
  if (typeof model.input.monthlyRent !== 'number') return null;

  const money = (v: number | null) => (v === null ? '' : formatMoney(v, model.currency, locale));
  const pct = (v: number | null) => (v === null ? '' : formatPercent(v, locale, 1));

  return (
    <Module id="three-scenarios" titleKey="inv_three_title" subtitleKey="inv_three_sub">
      {/* The money the investor puts in, from the same model: the base every return below is measured against. */}
      <p className="mb-3 text-sm text-foreground" data-testid="inv-three-budget">
        <span className="text-muted-foreground">{t('inv_three_budget')}:</span>{' '}
        <span className="font-semibold">{money(model.capital.investorCashInvested)}</span>
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {cases.map(({ c, m }) => {
          const noi = m?.income.netOperatingIncome.value ?? null;
          const egi = m?.income.effectiveGrossIncome.value ?? null;
          /* With a loan, what is left for the investor is after the loan payments, not before. */
          const debt = m?.leverage.financed ? (m.leverage.annualDebtService.value ?? null) : 0;
          const net = noi === null || debt === null ? null : noi - debt;
          return (
            <div key={c} className={cn('rounded-2xl border p-4', c === 'BASE' ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]/40' : 'border-border bg-background')}>
              <p className="text-sm font-semibold text-foreground">{t(`inv_three_${c.toLowerCase()}`)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t(`inv_three_${c.toLowerCase()}_how`)}</p>
              <dl className="mt-3 grid gap-2 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">{t('inv_three_income_monthly')}</dt>
                  <dd className="font-medium text-foreground">{money(egi === null ? null : egi / 12)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">{t('inv_three_costs_monthly')}</dt>
                  <dd className="font-medium text-foreground">{money(egi === null || noi === null ? null : (egi - noi) / 12)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">{t(m?.leverage.financed ? 'inv_three_net_after_loan' : 'inv_three_net_monthly')}</dt>
                  <dd className="font-semibold text-foreground">{money(net === null ? null : net / 12)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">{t('inv_three_net_yield')}</dt>
                  <dd className="font-medium text-foreground">{pct(m?.yields.netYieldOnPurchasePrice.value ?? null)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">{t('inv_three_cash_return')}</dt>
                  <dd className="font-medium text-foreground">{pct(m?.yields.cashOnCashReturn.value ?? null)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">{t('inv_three_payback')}</dt>
                  <dd className="font-medium text-foreground">
                    {m?.payback.propertyPaybackYears.value != null ? t('inv_three_years', { n: m.payback.propertyPaybackYears.value.toLocaleString(locale, { maximumFractionDigits: 1 }) }) : ''}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
      <div className="mt-4 rounded-xl border border-border bg-background p-4">
        <p className="text-sm font-semibold text-foreground">{t('inv_three_what_changes')}</p>
        <ul className="mt-2 grid list-disc gap-1 ps-5 text-sm text-muted-foreground">
          <li>{t('inv_three_change_rent')}</li>
          <li>{t('inv_three_change_vacancy')}</li>
          <li>{t('inv_three_change_costs')}</li>
          <li>{t('inv_three_change_rate')}</li>
        </ul>
      </div>
    </Module>
  );
}
