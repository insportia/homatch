// HOMATCH INVESTMENT INTELLIGENCE — hold, exit, delay, stress, break-even.
//
// WHY THE SCENARIO GRID IS A HEAT MAP AND NOT A TABLE
//
// A four-by-two table of returns is eight numbers, and reading it means
// eight comparisons the reader performs in their head. A heat map is the
// same eight numbers with the comparison already done: the shape tells you
// which axis actually drives the outcome, which is the question somebody
// stress-testing a deal is really asking. The numbers are still printed —
// colour is the index, never the value.
//
// COLOUR IS SIGN, NOT SENTIMENT
//
// Positive and negative, at two intensities each. Not a five-stop
// red-to-green ramp: that reads as a rating, and this product does not
// rate deals. Whether a 3% annualised return is good depends on what else
// the investor could do with the money, and nothing here knows that.
//
// WHY EXIT DELAY GETS ITS OWN COMPONENT
//
// Because the answer is a DELTA. "What does it cost me if the sale slips
// six months" is not "here is a second absolute profit figure to compare
// by eye" — it is one number with a sign, and the ladder is built to put
// that number in front of the reader rather than the arithmetic behind it.

import React, { useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { InvestmentModel, SensitivityAxis, SensitivityMetric } from '@/investment/types';
import { buildExitDelayLadder, buildSensitivityGrid } from '@/investment/calculations/sensitivity';
import { FigureValue, Metric, Module, NeedsInput, Segmented, formatMoney, formatNumber, intlLocaleFor } from './primitives';

/* ── Hold and exit ──────────────────────────────────────────────────── */

const HOLD_OPTIONS = [12, 18, 24, 36, 60];

export function HoldAndExitModule({
  model,
  focused,
  missing,
  onHoldChange,
  onExitPriceChange,
}: {
  model: InvestmentModel;
  focused: boolean;
  missing: string[];
  onHoldChange: (months: number) => void;
  onExitPriceChange: (price: number) => void;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const currency = model.currency;
  const hold = model.holdAndExit;

  if (!hold) return null;

  const hasExit = hold.exitPrice.value !== null;

  const rows: Array<{ labelKey: string; figure: typeof hold.exitPrice; negative?: boolean }> = [
    { labelKey: 'inv_hold_rent_collected', figure: hold.rentCollectedOverHold },
    { labelKey: 'inv_hold_operating', figure: hold.operatingCostsOverHold, negative: true },
    { labelKey: 'inv_hold_debt_service', figure: hold.debtServiceOverHold, negative: true },
    { labelKey: 'inv_hold_net_cash_flow', figure: hold.netCashFlowOverHold },
    { labelKey: 'inv_hold_exit_price', figure: hold.exitPrice },
    { labelKey: 'inv_hold_selling_costs', figure: hold.sellingCosts, negative: true },
    { labelKey: 'inv_hold_debt_payoff', figure: hold.debtPayoff, negative: true },
    { labelKey: 'inv_hold_net_proceeds', figure: hold.netSaleProceeds },
    { labelKey: 'inv_hold_cash_invested', figure: hold.totalCashInvested, negative: true },
    { labelKey: 'inv_hold_cash_returned', figure: hold.totalCashReturned },
  ];

  return (
    <Module
      id="hold-exit"
      eyebrowKey="inv_mod_hold_eyebrow"
      titleKey="inv_mod_hold_title"
      subtitleKey="inv_mod_hold_sub"
      focused={focused}
      actions={
        <Segmented
          ariaLabelKey="inv_hold_control"
          value={hold.holdMonths}
          onChange={onHoldChange}
          options={HOLD_OPTIONS.map((m) => ({
            value: m,
            // "1 year(s)" is what a template looks like, not what a person
            // writes. The singular gets its own key so every locale can use
            // its own singular rather than an English parenthesis.
            label:
              m === 12
                ? t('inv_hold_one_year')
                : m % 12 === 0
                  ? t('inv_unit_years', { n: m / 12 })
                  : t('inv_unit_months', { n: m }),
          }))}
        />
      }
    >
      {!hasExit ? (
        <div className="mb-6 space-y-3">
          <NeedsInput missing={missing} />
          <ExitPriceQuickSet
            model={model}
            onExitPriceChange={onExitPriceChange}
          />
        </div>
      ) : null}

      <div className="grid gap-6 sm:grid-cols-3">
        <Metric
          labelKey="inv_m_profit"
          figure={hold.profit}
          kind="money"
          currency={currency}
          emphasis
          noteKey="inv_m_profit_note"
        />
        <Metric
          labelKey="inv_m_roi"
          figure={hold.returnOnInvestedCashPercent}
          kind="percent"
          noteKey="inv_m_roi_note"
        />
        <Metric
          labelKey="inv_m_annualized"
          figure={hold.annualizedReturnPercent}
          kind="percent"
        />
      </div>

      {hasExit ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <SourceSplit
            labelKey="inv_hold_from_price"
            figure={hold.capitalGainComponent}
            currency={currency}
            noteKey="inv_hold_from_price_note"
          />
          <SourceSplit
            labelKey="inv_hold_from_rent"
            figure={hold.incomeComponent}
            currency={currency}
            noteKey="inv_hold_from_rent_note"
          />
        </div>
      ) : null}

      <div className="mt-7 overflow-x-auto">
        <table className="w-full min-w-[26rem] text-sm">
          <caption className="sr-only">{t('inv_hold_table_caption')}</caption>
          <tbody>
            {rows.map((row) => (
              <tr key={row.labelKey} className="border-b border-border last:border-0">
                <th scope="row" className="py-2.5 text-start font-normal text-muted-foreground">
                  {t(row.labelKey)}
                </th>
                {/*
                  The SIGN comes from Intl, not from a glyph pasted in front
                  of it. Prefixing a U+2212 put two different minus
                  characters in one column — the outgoing rows carried the
                  typographic one and a genuinely negative cash flow carried
                  the ASCII one Intl produces. Negating the value instead
                  lets the locale decide, which for Arabic and Hebrew is not
                  a leading hyphen at all.
                */}
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

      {hasExit ? (
        <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-3 text-2xs leading-relaxed text-muted-foreground">
          {t('inv_hold_scenario_warning', {
            price: formatMoney(hold.exitPrice.value ?? 0, currency, locale),
          })}
        </p>
      ) : null}
    </Module>
  );
}

function ExitPriceQuickSet({
  model,
  onExitPriceChange,
}: {
  model: InvestmentModel;
  onExitPriceChange: (price: number) => void;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const base = model.capital.purchasePrice;
  const options = [-5, 0, 5, 10, 15].map((pct) => ({
    pct,
    price: Math.round((base * (100 + pct)) / 100),
  }));
  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">{t('inv_exit_quickset')}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.pct}
            type="button"
            onClick={() => onExitPriceChange(option.price)}
            className="rounded-full border border-border px-3.5 py-1.5 text-xs tabular-nums text-muted-foreground transition-colors hover:border-[hsl(var(--gold-border))] hover:text-foreground"
          >
            {formatMoney(option.price, model.currency, locale, { compact: true })}
            <span className="ms-1.5 opacity-70">
              {option.pct > 0 ? `+${option.pct}%` : `${option.pct}%`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SourceSplit({
  labelKey,
  figure,
  currency,
  noteKey,
}: {
  labelKey: string;
  figure: InvestmentModel['holdAndExit'] extends null ? never : { value: number | null; unavailable: string | null };
  currency: string;
  noteKey: string;
}) {
  const { t } = useLanguage();
  return (
    <div className="rounded-xl border border-border bg-[hsl(var(--secondary))] p-4">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">{t(labelKey)}</p>
      <p className="mt-1 font-display text-xl font-semibold text-foreground">
        <FigureValue figure={figure as never} kind="money" currency={currency} />
      </p>
      <p className="mt-1.5 text-2xs text-muted-foreground">{t(noteKey)}</p>
    </div>
  );
}

/* ── Exit delay ─────────────────────────────────────────────────────── */

export function ExitDelayModule({ model, focused }: { model: InvestmentModel; focused: boolean }) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const currency = model.currency;

  const rows = useMemo(() => buildExitDelayLadder(model.input, [0, 3, 6, 12]), [model.input]);
  const worst = Math.max(...rows.map((r) => Math.abs(r.profitDelta.value ?? 0)), 1);

  return (
    <Module
      id="exit-delay"
      eyebrowKey="inv_mod_delay_eyebrow"
      titleKey="inv_mod_delay_title"
      subtitleKey="inv_mod_delay_sub"
      focused={focused}
    >
      <div className="space-y-3">
        {rows.map((row) => {
          const delta = row.profitDelta.value;
          const share = delta === null ? 0 : (Math.abs(delta) / worst) * 100;
          return (
            <div key={row.delayMonths} className="rounded-xl border border-border bg-[hsl(var(--secondary))] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-foreground">
                  {row.delayMonths === 0
                    ? t('inv_delay_on_time')
                    : t('inv_delay_late', { n: row.delayMonths })}
                </p>
                <p
                  className={cn(
                    'font-display text-lg font-semibold tabular-nums',
                    delta === null
                      ? 'text-muted-foreground'
                      : delta < 0
                        ? 'text-[hsl(var(--destructive))]'
                        : delta > 0
                          ? 'text-[hsl(var(--success))]'
                          : 'text-muted-foreground',
                  )}
                >
                  {delta === null
                    ? '—'
                    : delta === 0
                      ? t('inv_delay_baseline')
                      : `${delta > 0 ? '+' : '−'}${formatMoney(Math.abs(delta), currency, locale)}`}
                </p>
              </div>
              {row.delayMonths > 0 ? (
                <>
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                    <div
                      className={cn(
                        'h-full rounded-full transition-[width] duration-500',
                        (delta ?? 0) < 0 ? 'bg-[hsl(var(--destructive)/0.8)]' : 'bg-[hsl(var(--success)/0.8)]',
                      )}
                      style={{ width: `${share}%` }}
                    />
                  </div>
                  <dl className="mt-3 grid gap-x-5 gap-y-1 text-2xs sm:grid-cols-3">
                    <DelayLine labelKey="inv_delay_extra_interest" figure={row.additionalInterest} currency={currency} />
                    <DelayLine labelKey="inv_delay_extra_costs" figure={row.additionalOperatingCosts} currency={currency} />
                    <DelayLine labelKey="inv_delay_extra_rent" figure={row.additionalRentCollected} currency={currency} />
                  </dl>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-2xs text-muted-foreground">{t('inv_delay_note')}</p>
    </Module>
  );
}

function DelayLine({
  labelKey,
  figure,
  currency,
}: {
  labelKey: string;
  figure: { value: number | null; unavailable: string | null };
  currency: string;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex items-baseline justify-between gap-2 sm:block">
      <dt className="text-muted-foreground">{t(labelKey)}</dt>
      <dd className="tabular-nums text-foreground">
        <FigureValue figure={figure as never} kind="money" currency={currency} />
      </dd>
    </div>
  );
}

/* ── The scenario laboratory ────────────────────────────────────────── */

const METRICS: SensitivityMetric[] = [
  'PROFIT',
  'RETURN_ON_INVESTED_CASH',
  'ANNUAL_NET_CASH_FLOW',
  'NET_YIELD',
];

const AXES: SensitivityAxis[] = ['EXIT_PRICE', 'VACANT_MONTHS', 'MONTHLY_RENT', 'INTEREST_RATE'];

export function ScenarioLabModule({ model, focused }: { model: InvestmentModel; focused: boolean }) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const currency = model.currency;

  const [metric, setMetric] = useState<SensitivityMetric>('PROFIT');
  const [rowAxis, setRowAxis] = useState<SensitivityAxis>('EXIT_PRICE');
  const [withHold, setWithHold] = useState(true);

  const rowValues = useMemo(() => axisValues(rowAxis, model), [rowAxis, model]);
  const columnValues = useMemo(() => (withHold ? [12, 18, 24] : []), [withHold]);

  const grid = useMemo(
    () =>
      buildSensitivityGrid({
        input: model.input,
        metric,
        rowAxis,
        rowValues,
        columnAxis: withHold ? 'HOLD_MONTHS' : null,
        columnValues,
      }),
    [model.input, metric, rowAxis, rowValues, withHold, columnValues],
  );

  const magnitudes = grid.cells
    .map((c) => (c.metric.value === null ? null : Math.abs(c.metric.value)))
    .filter((v): v is number => v !== null);
  const peak = magnitudes.length ? Math.max(...magnitudes) : 1;

  const renderCell = (value: number | null) => {
    if (value === null) return '—';
    if (metric === 'PROFIT' || metric === 'ANNUAL_NET_CASH_FLOW') {
      return formatMoney(value, currency, locale, { compact: true });
    }
    return `${formatNumber(value, locale, 1)}%`;
  };

  return (
    <Module
      id="scenario-lab"
      eyebrowKey="inv_mod_lab_eyebrow"
      titleKey="inv_mod_lab_title"
      subtitleKey="inv_mod_lab_sub"
      focused={focused}
    >
      <div className="mb-5 flex flex-wrap gap-3">
        <Segmented
          ariaLabelKey="inv_lab_metric_label"
          value={metric}
          onChange={setMetric}
          options={METRICS.map((m) => ({ value: m, label: t(`inv_metric_${m}`) }))}
        />
        <Segmented
          ariaLabelKey="inv_lab_axis_label"
          value={rowAxis}
          onChange={setRowAxis}
          options={AXES.map((a) => ({ value: a, label: t(`inv_axis_${a}`) }))}
        />
        <button
          type="button"
          onClick={() => setWithHold((v) => !v)}
          aria-pressed={withHold}
          className={cn(
            'rounded-full border px-3.5 py-1.5 text-xs transition-colors',
            withHold
              ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
              : 'border-border text-muted-foreground',
          )}
        >
          {t('inv_lab_vs_hold')}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-separate border-spacing-1 text-sm">
          <caption className="sr-only">{t('inv_lab_table_caption')}</caption>
          <thead>
            <tr>
              <th scope="col" className="w-32 text-start text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                {t(`inv_axis_${rowAxis}`)}
              </th>
              {withHold ? (
                columnValues.map((months) => (
                  <th
                    key={months}
                    scope="col"
                    className="text-center text-2xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {t('inv_unit_months', { n: months })}
                  </th>
                ))
              ) : (
                <th scope="col" className="text-center text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t(`inv_metric_${metric}`)}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rowValues.map((rowValue) => (
              <tr key={rowValue}>
                <th scope="row" className="text-start text-xs font-normal tabular-nums text-muted-foreground">
                  {axisLabel(rowAxis, rowValue, currency, locale, t)}
                </th>
                {(withHold ? columnValues : [null]).map((columnValue) => {
                  const cell = grid.cells.find(
                    (c) => c.rowValue === rowValue && c.columnValue === columnValue,
                  );
                  const value = cell?.metric.value ?? null;
                  const intensity = value === null ? 0 : Math.min(1, Math.abs(value) / peak);
                  const positive = (value ?? 0) >= 0;
                  return (
                    <td
                      key={String(columnValue)}
                      className="rounded-lg px-3 py-2.5 text-center tabular-nums text-foreground"
                      style={{
                        backgroundColor:
                          value === null
                            ? 'hsl(var(--muted))'
                            : positive
                              ? `hsl(var(--success) / ${0.10 + intensity * 0.30})`
                              : `hsl(var(--destructive) / ${0.10 + intensity * 0.30})`,
                      }}
                    >
                      {renderCell(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-2xs text-muted-foreground">{t('inv_lab_note')}</p>
    </Module>
  );
}

function axisValues(axis: SensitivityAxis, model: InvestmentModel): number[] {
  const price = model.capital.purchasePrice;
  const rent = model.input.monthlyRent ?? 0;
  switch (axis) {
    case 'EXIT_PRICE': {
      const base = model.input.exitPriceAssumption ?? price;
      return [1.15, 1.1, 1.05, 1, 0.95, 0.9].map((k) => Math.round((base * k) / 100) * 100);
    }
    case 'VACANT_MONTHS':
      return [0, 1, 2, 3];
    case 'MONTHLY_RENT':
      return rent > 0
        ? [1.15, 1.05, 1, 0.9, 0.8].map((k) => Math.round(rent * k))
        : [300, 400, 500, 600, 700];
    case 'INTEREST_RATE': {
      const base = model.input.financing?.annualRatePercent ?? 12;
      return [base - 3, base - 1.5, base, base + 1.5, base + 3].filter((r) => r >= 0);
    }
    default:
      return [];
  }
}

function axisLabel(
  axis: SensitivityAxis,
  value: number,
  currency: string,
  locale: string,
  t: (k: string, v?: Record<string, string | number>) => string,
): string {
  switch (axis) {
    case 'EXIT_PRICE':
    case 'MONTHLY_RENT':
      return formatMoney(value, currency, locale, { compact: axis === 'EXIT_PRICE' });
    case 'VACANT_MONTHS':
      return t('inv_vacancy_option', { n: value });
    case 'INTEREST_RATE':
      return `${formatNumber(value, locale, 1)}%`;
    default:
      return String(value);
  }
}

/* ── Break-even ─────────────────────────────────────────────────────── */

export function BreakEvenModule({ model, focused }: { model: InvestmentModel; focused: boolean }) {
  const currency = model.currency;
  const b = model.breakEven;
  return (
    <Module
      id="break-even"
      eyebrowKey="inv_mod_breakeven_eyebrow"
      titleKey="inv_mod_breakeven_title"
      subtitleKey="inv_mod_breakeven_sub"
      focused={focused}
    >
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Metric
          labelKey="inv_be_min_rent_noi"
          figure={b.minimumRentForZeroNoi}
          kind="money"
          currency={currency}
          noteKey="inv_be_min_rent_noi_note"
        />
        <Metric
          labelKey="inv_be_min_rent_cash"
          figure={b.minimumRentForZeroCashFlow}
          kind="money"
          currency={currency}
          noteKey="inv_be_min_rent_cash_note"
        />
        <Metric
          labelKey="inv_be_min_occupancy"
          figure={b.minimumOccupiedMonths}
          kind="months"
          decimals={1}
          noteKey="inv_be_min_occupancy_note"
        />
        <Metric
          labelKey="inv_be_exit_price"
          figure={b.breakEvenExitPrice}
          kind="money"
          currency={currency}
          emphasis
          noteKey="inv_be_exit_price_note"
        />
        <Metric
          labelKey="inv_be_exit_per_sqm"
          figure={b.breakEvenExitPricePerSqm}
          kind="money"
          currency={currency}
          decimals={0}
        />
        <Metric
          labelKey="inv_be_max_renovation"
          figure={b.maximumRenovationBudget}
          kind="money"
          currency={currency}
          noteKey="inv_be_max_renovation_note"
        />
      </div>
    </Module>
  );
}
