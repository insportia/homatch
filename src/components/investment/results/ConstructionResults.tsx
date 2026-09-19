// HOMATCH INVESTMENT INTELLIGENCE — the off-plan result.
//
// The two capital figures lead, because they are the thing an investor most
// often conflates: what the property COMMITS them to and what they have
// actually PAID are different numbers, and the return is a different number
// against each.
//
// The payment schedule is drawn rather than tabulated. A deposit followed
// by twenty instalments and a balloon at completion has a shape, and the
// shape is the point — it is when the money leaves, which is what makes a
// delay expensive.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type {
  CompletedPriceScenario,
  ConstructionDelayRow,
  ConstructionModel,
} from '@/investment/calculations/construction';
import { FigureValue, Metric, Module, formatMoney, formatPercent, intlLocaleFor } from '../primitives';

export function ConstructionResults({
  model,
  delays,
  priceScenarios,
}: {
  model: ConstructionModel;
  delays: ConstructionDelayRow[];
  priceScenarios: CompletedPriceScenario[];
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const currency = model.currency;

  const committed = model.totalCapitalCommitted.value ?? 0;
  const deployed = model.investorCashDeployed.value ?? 0;
  const owed = model.remainingObligation.value ?? 0;
  /*
   * The bar is drawn against PAID PLUS OWED, not against the price.
   *
   * Those are exactly the two figures printed above it, so the picture and
   * the numbers are the same claim. The price is a third number — it
   * excludes the buying costs that are already out of the investor's
   * pocket — and using it as the denominator made the two segments add up
   * to slightly more than the bar, which is a diagram quietly disagreeing
   * with the arithmetic beside it.
   */
  const outlay = deployed + owed;

  return (
    <>
      <Module
        id="capital"
        eyebrowKey="inv_mod_capital_eyebrow"
        titleKey="inv_mod_capital_title"
        subtitleKey="inv_mod_capital_sub"
      >
        <div className="grid gap-6 sm:grid-cols-3">
          <Metric
            labelKey="inv_m_capital_committed"
            figure={model.totalCapitalCommitted}
            kind="money"
            currency={currency}
            noteKey="inv_m_capital_committed_note"
          />
          <Metric
            labelKey="inv_m_cash_deployed"
            figure={model.investorCashDeployed}
            kind="money"
            currency={currency}
            emphasis
            noteKey="inv_m_cash_deployed_note"
          />
          <Metric
            labelKey="inv_m_still_owed"
            figure={model.remainingObligation}
            kind="money"
            currency={currency}
            noteKey="inv_m_still_owed_note"
          />
        </div>

        {outlay > 0 ? (
          <div className="mt-6">
            <div className="flex h-9 w-full overflow-hidden rounded-lg">
              <div
                className="flex items-center justify-center bg-[hsl(var(--gold))] text-2xs font-medium text-[hsl(var(--primary-foreground))]"
                style={{ width: `${(deployed / outlay) * 100}%` }}
              >
                {deployed / outlay > 0.18 ? t('inv_m_cash_deployed') : null}
              </div>
              <div
                className="flex items-center justify-center bg-[hsl(var(--secondary))] text-2xs font-medium text-muted-foreground"
                style={{ width: `${(owed / outlay) * 100}%` }}
              >
                {owed / outlay > 0.18 ? t('inv_m_still_owed') : null}
              </div>
            </div>
          </div>
        ) : null}

        {model.deployment.length > 2 ? (
          <div className="mt-8">
            <h3 className="font-display text-base font-semibold text-foreground">
              {t('inv_schedule_title')}
            </h3>
            <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">
              {t('inv_schedule_sub')}
            </p>
            <svg
              viewBox="0 0 600 160"
              className="mt-4 h-40 w-full"
              role="img"
              aria-label={t('inv_schedule_chart_label')}
              preserveAspectRatio="none"
            >
              <path
                d={cumulativePath(model.deployment, committed)}
                fill="hsl(var(--gold) / 0.16)"
                stroke="none"
              />
              <path
                d={cumulativeLine(model.deployment, committed)}
                fill="none"
                stroke="hsl(var(--gold))"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1="0"
                x2="600"
                y1={150 - (committed / Math.max(committed, 1)) * 140}
                y2={150 - (committed / Math.max(committed, 1)) * 140}
                stroke="hsl(var(--border))"
                strokeDasharray="4 5"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <p className="mt-2 text-2xs text-muted-foreground">
              {t('inv_schedule_note', { months: model.monthsToExit })}
            </p>
          </div>
        ) : null}
      </Module>

      <Module
        id="completion"
        eyebrowKey="inv_mod_completion_eyebrow"
        titleKey="inv_mod_completion_title"
        subtitleKey="inv_mod_completion_sub"
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            labelKey="inv_m_completed_value"
            figure={model.expectedCompletedValue}
            kind="money"
            currency={currency}
            noteKey="inv_m_completed_value_note"
          />
          <Metric
            labelKey="inv_m_appreciation"
            figure={model.expectedAppreciation}
            kind="money"
            currency={currency}
          />
          <Metric
            labelKey="inv_m_appreciation_pct"
            figure={model.appreciationPercent}
            kind="percent"
            decimals={1}
          />
          <Metric
            labelKey="inv_m_net_proceeds"
            figure={model.expectedSaleProceeds}
            kind="money"
            currency={currency}
            noteKey="inv_m_net_proceeds_offplan_note"
          />
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[26rem] text-sm">
            <caption className="sr-only">{t('inv_offplan_table_caption')}</caption>
            <tbody>
              {[
                { key: 'inv_row_completed_value', figure: model.expectedCompletedValue },
                { key: 'inv_row_selling_costs', figure: model.sellingCosts, negative: true },
                { key: 'inv_row_still_owed', figure: model.remainingObligation, negative: true },
                { key: 'inv_row_net_proceeds', figure: model.expectedSaleProceeds },
                { key: 'inv_row_cash_deployed', figure: model.investorCashDeployed, negative: true },
                { key: 'inv_row_net_profit', figure: model.netProfit },
              ].map((row) => (
                <tr key={row.key} className="border-b border-border last:border-0">
                  <th scope="row" className="py-2.5 text-start font-normal text-muted-foreground">
                    {t(row.key)}
                  </th>
                  <td
                    className={cn(
                      'py-2.5 text-end tabular-nums',
                      row.negative ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    <FigureValue
                      figure={
                        row.negative && row.figure.value !== null
                          ? { ...row.figure, value: -Math.abs(row.figure.value) }
                          : row.figure
                      }
                      kind="money"
                      currency={currency}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-3 text-2xs leading-relaxed text-muted-foreground">
          {t('inv_offplan_scenario_note')}
        </p>
      </Module>

      <Module
        id="returns"
        eyebrowKey="inv_mod_returns_eyebrow"
        titleKey="inv_mod_returns_title"
        subtitleKey="inv_mod_returns_sub"
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            labelKey="inv_m_roi_on_cash"
            figure={model.returnOnInvestorCashPercent}
            kind="percent"
            decimals={1}
            emphasis
            noteKey="inv_m_roi_on_cash_note"
          />
          <Metric
            labelKey="inv_m_roi_on_committed"
            figure={model.returnOnTotalCapitalPercent}
            kind="percent"
            decimals={1}
            noteKey="inv_m_roi_on_committed_note"
          />
          <Metric
            labelKey="inv_m_annualized"
            figure={model.annualizedReturnPercent}
            kind="percent"
            decimals={1}
          />
          <Metric
            labelKey="inv_m_margin_of_safety"
            figure={model.marginOfSafetyPercent}
            kind="percent"
            decimals={1}
            noteKey="inv_m_margin_of_safety_note"
          />
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          <Metric
            labelKey="inv_be_completed_value"
            figure={model.breakEvenExitPrice}
            kind="money"
            currency={currency}
            noteKey="inv_be_completed_value_note"
          />
          <Metric
            labelKey="inv_be_completed_per_sqm"
            figure={model.breakEvenExitPricePerSqm}
            kind="money"
            currency={currency}
          />
          <Metric
            labelKey="inv_be_required_completed"
            figure={model.requiredExitForTargetReturn}
            kind="money"
            currency={currency}
            noteKey="inv_be_required_completed_note"
          />
        </div>
      </Module>

      {delays.length > 1 ? (
        <Module
          id="delay"
          eyebrowKey="inv_mod_delay_eyebrow"
          titleKey="inv_mod_offplan_delay_title"
          subtitleKey="inv_mod_offplan_delay_sub"
        >
          <div className="space-y-3">
            {delays.map((row) => (
              <div
                key={row.delayMonths}
                className="rounded-xl border border-border bg-[hsl(var(--secondary))] p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">
                    {row.delayMonths === 0
                      ? t('inv_delay_on_time')
                      : t('inv_delay_late', { n: row.delayMonths })}
                  </p>
                  <p className="text-sm tabular-nums text-muted-foreground">
                    {t('inv_delay_annualised_becomes')}{' '}
                    <span
                      className={cn(
                        'font-display text-lg font-semibold',
                        row.delayMonths === 0
                          ? 'text-foreground'
                          : 'text-[hsl(var(--destructive))]',
                      )}
                    >
                      <FigureValue figure={row.annualizedReturnPercent} kind="percent" decimals={1} />
                    </span>
                  </p>
                </div>
                {row.delayMonths > 0 ? (
                  <p className="mt-2 text-2xs text-muted-foreground">
                    {t('inv_delay_extra_costs')}{' '}
                    <span className="tabular-nums text-foreground">
                      <FigureValue
                        figure={row.additionalHoldingCosts}
                        kind="money"
                        currency={currency}
                      />
                    </span>
                    {' · '}
                    {t('inv_delay_months_total', { n: row.monthsToExit })}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
          <p className="mt-4 text-2xs text-muted-foreground">{t('inv_offplan_delay_note')}</p>
        </Module>
      ) : null}

      {priceScenarios.length ? (
        <Module
          id="price-scenarios"
          eyebrowKey="inv_mod_lab_eyebrow"
          titleKey="inv_mod_price_scenarios_title"
          subtitleKey="inv_mod_price_scenarios_sub"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <caption className="sr-only">{t('inv_price_scenarios_caption')}</caption>
              <thead>
                <tr className="text-2xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 text-start font-medium">
                    {t('inv_col_completed_value')}
                  </th>
                  <th scope="col" className="py-2 text-end font-medium">
                    {t('inv_col_profit')}
                  </th>
                  <th scope="col" className="py-2 text-end font-medium">
                    {t('inv_col_return_on_cash')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {priceScenarios.map((row) => (
                  <tr key={row.changePercent} className="border-t border-border">
                    <td className="py-2.5 tabular-nums text-foreground">
                      {formatMoney(row.completedValue, currency, locale)}
                      <span className="ms-2 text-2xs text-muted-foreground">
                        {row.changePercent > 0 ? '+' : ''}
                        {formatPercent(row.changePercent, locale, 0)}
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
                        figure={row.returnOnInvestorCashPercent}
                        kind="percent"
                        decimals={1}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Module>
      ) : null}
    </>
  );
}

function cumulativeLine(
  points: ConstructionModel['deployment'],
  peak: number,
): string {
  if (!points.length) return '';
  const last = points[points.length - 1].month || 1;
  const max = Math.max(peak, 1);
  return points
    .map((point, index) => {
      const x = (point.month / last) * 600;
      const y = 150 - (point.cumulativePaid / max) * 140;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function cumulativePath(points: ConstructionModel['deployment'], peak: number): string {
  if (!points.length) return '';
  return `${cumulativeLine(points, peak)} L600,160 L0,160 Z`;
}
