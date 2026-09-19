// HOMATCH INVESTMENT INTELLIGENCE — the renovate-and-resell result.
//
// The flip's own vocabulary, in the order a flipper checks it: what the
// deal costs all-in per m², where the money went, what the sale has to
// reach, and how much room there is before it stops working.
//
// WHY THIS DOES NOT REUSE THE SHARED SCENARIO GRID OR THE CAPITAL DIAGRAM
//
// It did, and the screen contradicted itself. Both of those are built on
// the rental engine, whose position is what the PROPERTY cost; a flip's is
// that plus the monthly carry and the other-works line. So the cost module
// said the deal cost $155,818, the capital diagram said $155,260, and the
// stress grid reported the same profit at twelve months and at twenty-four
// — on a page that had just charged $93 a month to hold it.
//
// Every figure below is a complete re-run of the flip's own model. The
// tables and the headline are the same arithmetic, which is the only way
// they can be trusted to agree.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { InvestmentModel } from '@/investment/types';
import type {
  RenovateResellModel,
  RenovateScenarioRow,
  RenovateTimingRow,
} from '@/investment/calculations/renovate';
import { FigureValue, Metric, Module, formatMoney, formatPercent, intlLocaleFor } from '../primitives';

export function RenovateResults({
  model,
  flip,
  scenarios,
  timings,
}: {
  model: InvestmentModel;
  flip: RenovateResellModel;
  scenarios: RenovateScenarioRow[];
  timings: RenovateTimingRow[];
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const currency = model.currency;

  const costRows: Array<{ key: string; amount: number }> = [
    { key: 'purchasePrice', amount: flip.costs.purchasePrice },
    { key: 'acquisitionCosts', amount: flip.costs.acquisitionCosts },
    { key: 'renovation', amount: flip.costs.renovation },
    { key: 'furnishing', amount: flip.costs.furnishing },
    { key: 'otherRenovationCosts', amount: flip.costs.otherRenovationCosts },
    { key: 'holdingCosts', amount: flip.costs.holdingCosts },
  ].filter((row) => row.amount > 0);

  return (
    <>
      <Module
        id="costs"
        eyebrowKey="inv_mod_costs_eyebrow"
        titleKey="inv_mod_costs_title"
        subtitleKey="inv_mod_costs_sub"
      >
        <div className="grid gap-6 sm:grid-cols-3">
          <Metric
            labelKey="inv_m_total_invested"
            figure={{ value: flip.costs.totalInvestedCapital, unavailable: null }}
            kind="money"
            currency={currency}
            emphasis
          />
          <Metric
            labelKey="inv_m_all_in_per_sqm"
            figure={flip.allInCostPerSqm}
            kind="money"
            currency={currency}
            noteKey="inv_m_all_in_per_sqm_note"
          />
          <Metric
            labelKey="inv_m_your_cash"
            figure={{ value: flip.costs.investorCashInvested, unavailable: null }}
            kind="money"
            currency={currency}
          />
        </div>

        <ul className="mt-6 space-y-1.5 border-t border-border pt-4">
          {costRows.map((row) => (
            <li key={row.key} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{t(`inv_cost_row_${row.key}`)}</span>
              <span className="tabular-nums text-foreground">
                {formatMoney(row.amount, currency, locale)}
              </span>
            </li>
          ))}
        </ul>
      </Module>

      <Module
        id="sale"
        eyebrowKey="inv_mod_sale_eyebrow"
        titleKey="inv_mod_sale_title"
        subtitleKey="inv_mod_sale_sub"
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            labelKey="inv_m_expected_sale"
            figure={flip.expectedSalePrice}
            kind="money"
            currency={currency}
            noteKey="inv_m_expected_sale_note"
          />
          <Metric
            labelKey="inv_m_expected_sale_per_sqm"
            figure={flip.expectedSalePricePerSqm}
            kind="money"
            currency={currency}
          />
          <Metric
            labelKey="inv_m_selling_costs"
            figure={flip.sellingCosts}
            kind="money"
            currency={currency}
          />
          <Metric
            labelKey="inv_m_net_proceeds"
            figure={flip.netSaleProceeds}
            kind="money"
            currency={currency}
          />
        </div>
      </Module>

      <Module
        id="break-even"
        eyebrowKey="inv_mod_breakeven_eyebrow"
        titleKey="inv_mod_breakeven_title"
        subtitleKey="inv_mod_breakeven_sub"
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Metric
            labelKey="inv_be_sale_price"
            figure={flip.breakEvenSalePrice}
            kind="money"
            currency={currency}
            emphasis
            noteKey="inv_be_sale_price_note"
          />
          <Metric
            labelKey="inv_be_sale_per_sqm"
            figure={flip.breakEvenSalePricePerSqm}
            kind="money"
            currency={currency}
          />
          <Metric
            labelKey="inv_m_margin_of_safety"
            figure={flip.marginOfSafetyPercent}
            kind="percent"
            decimals={1}
            noteKey="inv_m_margin_of_safety_note"
          />
          <Metric
            labelKey="inv_be_required_sale"
            figure={flip.requiredSalePriceForTargetReturn}
            kind="money"
            currency={currency}
            noteKey="inv_be_required_sale_note"
          />
          <Metric
            labelKey="inv_be_required_sale_per_sqm"
            figure={flip.requiredSalePricePerSqmForTargetReturn}
            kind="money"
            currency={currency}
          />
          <Metric
            labelKey="inv_be_max_renovation"
            figure={flip.maximumRenovationBudget}
            kind="money"
            currency={currency}
            noteKey="inv_be_max_renovation_note"
          />
        </div>
      </Module>

      {scenarios.length > 1 ? (
        <Module
          id="resale-scenarios"
          eyebrowKey="inv_mod_lab_eyebrow"
          titleKey="inv_mod_resale_scenarios_title"
          subtitleKey="inv_mod_resale_scenarios_sub"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <caption className="sr-only">{t('inv_resale_scenarios_caption')}</caption>
              <thead>
                <tr className="text-2xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 text-start font-medium">
                    {t('inv_col_sale_price')}
                  </th>
                  <th scope="col" className="py-2 text-end font-medium">
                    {t('inv_col_profit')}
                  </th>
                  <th scope="col" className="py-2 text-end font-medium">
                    {t('inv_col_return_on_cash')}
                  </th>
                  <th scope="col" className="py-2 text-end font-medium">
                    {t('inv_sum_annualized')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((row) => {
                  const isBase = row.changePercent === 0;
                  return (
                    <tr
                      key={row.changePercent}
                      className={cn(
                        'border-t border-border',
                        isBase && 'bg-[hsl(var(--gold-soft))]',
                      )}
                    >
                      <td className="py-2.5 tabular-nums text-foreground">
                        {formatMoney(row.salePrice, currency, locale)}
                        <span className="ms-2 text-2xs text-muted-foreground">
                          {isBase
                            ? t('inv_scenario_your_assumption')
                            : `${row.changePercent > 0 ? '+' : ''}${formatPercent(row.changePercent, locale, 0)}`}
                        </span>
                      </td>
                      <td
                        className={cn(
                          'py-2.5 text-end tabular-nums',
                          (row.netProfit.value ?? 0) < 0
                            ? 'text-[hsl(var(--destructive))]'
                            : 'text-foreground',
                        )}
                      >
                        <FigureValue figure={row.netProfit} kind="money" currency={currency} />
                      </td>
                      <td className="py-2.5 text-end tabular-nums text-muted-foreground">
                        <FigureValue
                          figure={row.returnOnInvestedCashPercent}
                          kind="percent"
                          decimals={1}
                        />
                      </td>
                      <td className="py-2.5 text-end tabular-nums text-muted-foreground">
                        <FigureValue
                          figure={row.annualizedReturnPercent}
                          kind="percent"
                          decimals={1}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-2xs leading-relaxed text-muted-foreground">
            {t('inv_resale_scenarios_note')}
          </p>
        </Module>
      ) : null}

      {timings.length > 1 ? (
        <Module
          id="timing"
          eyebrowKey="inv_mod_delay_eyebrow"
          titleKey="inv_mod_flip_timing_title"
          subtitleKey="inv_mod_flip_timing_sub"
        >
          <div className="space-y-3">
            {timings.map((row, index) => (
              <div
                key={row.monthsToSale}
                className="flex flex-wrap items-baseline justify-between gap-3 rounded-xl border border-border bg-[hsl(var(--secondary))] px-4 py-3"
              >
                <p className="text-sm text-foreground">
                  {index === 0
                    ? t('inv_timing_as_planned', { n: row.monthsToSale })
                    : t('inv_timing_months', { n: row.monthsToSale })}
                </p>
                <p className="text-sm tabular-nums text-muted-foreground">
                  <FigureValue figure={row.netProfit} kind="money" currency={currency} />
                  {' · '}
                  <span
                    className={cn(
                      'font-display text-lg font-semibold',
                      index === 0 ? 'text-foreground' : 'text-[hsl(var(--gold-ink))]',
                    )}
                  >
                    <FigureValue figure={row.annualizedReturnPercent} kind="percent" decimals={1} />
                  </span>
                  <span className="ms-1.5 text-2xs">{t('inv_sum_annualized')}</span>
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-2xs leading-relaxed text-muted-foreground">
            {t('inv_flip_timing_note')}
          </p>
        </Module>
      ) : null}
    </>
  );
}
