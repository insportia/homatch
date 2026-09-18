// HOMATCH INVESTMENT INTELLIGENCE — when the money comes back.
//
// WHY THIS MODULE IS AS PROMINENT AS THE YIELD ONE
//
// Most people understand "sixteen and a half years until I have my money
// back" immediately and "a 6.2% net yield" only approximately. They are
// the same fact stated two ways, and the product should lead with the one
// that lands.
//
// TWO CURVES ON ONE AXIS, WHICH IS THE POINT
//
//   cash recovered     what the investor has actually received
//   equity built       principal the tenant's rent has repaid on the loan
//
// The second is real and it is NOT cash: it is locked in the property
// until a sale. Drawing them together, with the cash line solid and the
// equity line dashed, is the honest picture — and it is why the crossing
// point of the SOLID line is the one labelled "money back".

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { InvestmentModel } from '@/investment/types';
import { Metric, Module, NeedsInput, formatMoney, intlLocaleFor } from './primitives';

export function MoneyBackModule({
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
  const payback = model.payback;
  const timeline = payback.timeline;
  const cashInvested = model.capital.investorCashInvested;

  const hasCurve = timeline.length > 2;
  const lastMonth = hasCurve ? timeline[timeline.length - 1].month : 0;
  const crossing = payback.equityRecoveryMonth.value;

  /*
   * THE DOMAIN HAS TO INCLUDE NEGATIVES, AND THIS IS WHY.
   *
   * The first version clamped every value at zero. On a deal where the rent
   * does not cover the mortgage — which is most leveraged deals in their
   * first years, and exactly the case a reader needs to SEE — the cash line
   * was drawn flat along the axis floor. A cumulative loss of forty
   * thousand and a cumulative position of nothing rendered identically,
   * and the flat line read as "breaking even".
   *
   * So the scale spans the real minimum to the real maximum, and the zero
   * line is drawn. A line below zero now looks like what it is.
   */
  const values = hasCurve
    ? timeline.flatMap((p) => [p.cumulativeNetCashFlow, p.cumulativePrincipalRepaid])
    : [0];
  const domainMax = Math.max(cashInvested, ...values, 1);
  const domainMin = Math.min(0, ...values);
  const span = domainMax - domainMin || 1;
  /** Value → y, inside a 10..190 band. */
  const yOf = (value: number) => 190 - ((value - domainMin) / span) * 180;

  return (
    <Module
      id="money-back"
      eyebrowKey="inv_mod_payback_eyebrow"
      titleKey="inv_mod_payback_title"
      subtitleKey="inv_mod_payback_sub"
      focused={focused}
    >
      <div className="grid gap-6 sm:grid-cols-3">
        <Metric
          labelKey="inv_m_property_payback"
          figure={payback.propertyPaybackYears}
          kind="years"
          emphasis
          noteKey="inv_m_property_payback_note"
        />
        <Metric
          labelKey="inv_m_equity_payback"
          figure={payback.equityPaybackYears}
          kind="years"
          noteKey="inv_m_equity_payback_note"
        />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('inv_m_capital_invested')}
          </p>
          <p className="mt-1.5 font-display text-2xl font-semibold leading-none text-foreground">
            {formatMoney(model.capital.totalPropertyCapital, currency, locale)}
          </p>
          <p className="mt-1.5 text-2xs text-muted-foreground">
            {t('inv_m_capital_invested_note', {
              cash: formatMoney(cashInvested, currency, locale),
            })}
          </p>
        </div>
      </div>

      {hasCurve ? (
        <div className="mt-8">
          <h3 className="font-display text-base font-semibold text-foreground">
            {t('inv_recovery_title')}
          </h3>
          <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">{t('inv_recovery_sub')}</p>

          <div className="relative mt-5">
            <svg
              viewBox="0 0 600 200"
              className="h-52 w-full"
              role="img"
              aria-label={t('inv_recovery_chart_label')}
              preserveAspectRatio="none"
            >
              {/* Zero. Only drawn when the chart actually crosses it, so a
                  purely positive deal is not given a redundant axis. */}
              {domainMin < 0 ? (
                <line
                  x1="0"
                  x2="600"
                  y1={yOf(0)}
                  y2={yOf(0)}
                  stroke="hsl(var(--border))"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {/* The line the investor is trying to cross. */}
              <line
                x1="0"
                x2="600"
                y1={yOf(cashInvested)}
                y2={yOf(cashInvested)}
                stroke="hsl(var(--gold))"
                strokeDasharray="4 5"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
              {/* Equity built by principal repayment. Not cash. */}
              <path
                d={seriesPath(timeline.map((p) => p.cumulativePrincipalRepaid), yOf, lastMonth, timeline)}
                fill="none"
                stroke="hsl(var(--info))"
                strokeWidth="1.5"
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
              {/* Cash actually received. Negative is drawn as negative. */}
              <path
                d={seriesPath(timeline.map((p) => p.cumulativeNetCashFlow), yOf, lastMonth, timeline)}
                fill="none"
                stroke="hsl(var(--foreground))"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
              {crossing !== null ? (
                <g>
                  <line
                    x1={(crossing / lastMonth) * 600}
                    x2={(crossing / lastMonth) * 600}
                    y1="10"
                    y2="190"
                    stroke="hsl(var(--gold))"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={(crossing / lastMonth) * 600}
                    cy={yOf(cashInvested)}
                    r="5"
                    fill="hsl(var(--gold))"
                  />
                </g>
              ) : null}
            </svg>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-2xs">
              <LegendItem className="bg-foreground" labelKey="inv_recovery_legend_cash" />
              <LegendItem className="bg-[hsl(var(--info))]" labelKey="inv_recovery_legend_equity" dashed />
              <LegendItem className="bg-[hsl(var(--gold))]" labelKey="inv_recovery_legend_target" dashed />
            </div>

            <p className="mt-4 text-sm text-foreground">
              {crossing !== null
                ? t('inv_recovery_crossing', {
                    years: (crossing / 12).toFixed(1),
                    month: crossing,
                  })
                : t('inv_recovery_no_crossing')}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <NeedsInput missing={missing} />
        </div>
      )}
    </Module>
  );
}

function LegendItem({
  className,
  labelKey,
  dashed,
}: {
  className: string;
  labelKey: string;
  dashed?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <span className="flex items-center gap-2 text-muted-foreground">
      <span
        className={`inline-block h-[2px] w-6 ${className}`}
        style={dashed ? { backgroundImage: 'none', opacity: 0.85 } : undefined}
        aria-hidden="true"
      />
      {t(labelKey)}
    </span>
  );
}

function seriesPath(
  values: number[],
  yOf: (value: number) => number,
  lastMonth: number,
  timeline: Array<{ month: number }>,
): string {
  if (!values.length || lastMonth === 0) return '';
  return values
    .map((value, index) => {
      const x = (timeline[index].month / lastMonth) * 600;
      const y = yOf(value);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
