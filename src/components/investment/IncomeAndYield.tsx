// HOMATCH INVESTMENT INTELLIGENCE — Income & Yield, and the valuation lens.
//
// THREE VISUAL MOMENTS, EACH EARNING ITS PLACE
//
//   THE LADDER      what an empty month actually costs, as a shape rather
//                   than as three numbers. The bars are the collected rent
//                   and the gap above each one is the vacancy — so the
//                   thing you are looking at IS the loss.
//   THE SPECTRUM    the income-implied value as the required yield moves.
//                   A curve, because the relationship is a hyperbola and
//                   the point being made is that it BENDS: the first
//                   percentage point costs far more value than the fifth.
//   THE RAIL        where the price sits among the things we can compare
//                   it to, with a verdict only when there is evidence.
//
// WHAT THE SPECTRUM IS NOT
//
// It is not a valuation. Every label on it says what it is — a value
// implied by an income at a required yield — and the comparison against
// the market is a separate, evidence-gated component below it. The one
// thing this product must never do is let a reader come away believing an
// implied value is what the flat is worth.

import React, { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { InvestmentModel } from '@/investment/types';
import { vacancyLadder } from '@/investment/calculations/income';
import { incomeImpliedValue, positionAgainstEvidence } from '@/investment/calculations/valuation';
import type { MarketComparableRange } from '@/investment/calculations/valuation';
import { FigureValue, Metric, Module, NeedsInput, Segmented, formatMoney, formatPercent, intlLocaleFor } from './primitives';

/* ── Income & yield ─────────────────────────────────────────────────── */

export function IncomeAndYieldModule({
  model,
  focused,
  missing,
  onVacancyChange,
}: {
  model: InvestmentModel;
  focused: boolean;
  missing: string[];
  onVacancyChange: (months: number) => void;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const currency = model.currency;
  const income = model.income;

  const ladder = useMemo(
    () => vacancyLadder(model.input, [0, 1, 2, 3]),
    [model.input],
  );

  const vacantMonths = 12 - income.occupiedMonths;
  const maxIncome = Math.max(...ladder.map((row) => row.effectiveGrossIncome), 1);

  return (
    <Module
      id="income-yield"
      eyebrowKey="inv_mod_income_eyebrow"
      titleKey="inv_mod_income_title"
      subtitleKey="inv_mod_income_sub"
      focused={focused}
    >
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          labelKey="inv_m_gross_annual"
          figure={income.grossPotentialAnnualIncome}
          kind="money"
          currency={currency}
        />
        <Metric
          labelKey="inv_m_gross_yield"
          figure={model.yields.grossYieldOnPurchasePrice}
          kind="percent"
          emphasis
          noteKey="inv_m_gross_yield_note"
        />
        <Metric
          labelKey="inv_m_collected"
          figure={income.effectiveGrossIncome}
          kind="money"
          currency={currency}
          noteKey="inv_m_collected_note"
        />
        <Metric
          labelKey="inv_m_net_yield"
          figure={model.yields.netYieldOnPurchasePrice}
          kind="percent"
          noteKey="inv_m_net_yield_note"
        />
      </div>

      {income.operatingExpenses ? (
        <div className="mt-6 rounded-xl border border-border bg-[hsl(var(--secondary))] p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('inv_operating_costs')}
            </p>
            <p className="font-display text-lg font-semibold text-foreground">
              {formatMoney(income.operatingExpenses.totalAnnual, currency, locale)}
            </p>
          </div>
          <ul className="mt-3 space-y-1.5">
            {income.operatingExpenses.lines.map((line) => (
              <li key={line.key} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{t(`inv_cost_${line.key}`)}</span>
                <span className="tabular-nums text-foreground">
                  {formatMoney(line.annual, currency, locale)}
                </span>
              </li>
            ))}
          </ul>
          {income.operatingExpenses.knownGaps.length ? (
            <p className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-2xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {t('inv_cost_gaps', {
                  list: income.operatingExpenses.knownGaps.map((k) => t(`inv_cost_${k}`)).join(', '),
                })}
              </span>
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-6">
          <NeedsInput missing={missing.filter((k) => k === 'inv_need_operating_costs')} />
        </div>
      )}

      {/* ── The vacancy ladder ──────────────────────────────────── */}
      {ladder.length ? (
        <div className="mt-8">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-semibold text-foreground">
                {t('inv_vacancy_title')}
              </h3>
              <p className="mt-1 max-w-[56ch] text-sm text-muted-foreground">
                {t('inv_vacancy_sub')}
              </p>
            </div>
            <Segmented
              ariaLabelKey="inv_vacancy_control"
              value={vacantMonths}
              onChange={onVacancyChange}
              options={ladder.map((row) => ({
                value: row.vacantMonths,
                label: t('inv_vacancy_option', { n: row.vacantMonths }),
              }))}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            {ladder.map((row) => {
              const active = row.vacantMonths === vacantMonths;
              const fill = Math.max(4, (row.effectiveGrossIncome / maxIncome) * 100);
              return (
                <button
                  key={row.vacantMonths}
                  type="button"
                  onClick={() => onVacancyChange(row.vacantMonths)}
                  aria-pressed={active}
                  className={cn(
                    'rounded-xl border p-4 text-start transition-colors',
                    active
                      ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]'
                      : 'border-border bg-[hsl(var(--secondary))] hover:border-[hsl(var(--gold-border))]',
                  )}
                >
                  <p className="text-2xs uppercase tracking-wide text-muted-foreground">
                    {t('inv_vacancy_months_label', { n: row.vacantMonths })}
                  </p>
                  <p className="mt-1.5 font-display text-xl font-semibold tabular-nums text-foreground">
                    {formatMoney(row.effectiveGrossIncome, currency, locale)}
                  </p>
                  {/* The bar IS the collected rent; the track above it is
                      the rent that never arrives. */}
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                    <div
                      className={cn(
                        'h-full rounded-full transition-[width] duration-500',
                        active ? 'bg-[hsl(var(--gold))]' : 'bg-[hsl(var(--muted-foreground))]',
                      )}
                      style={{ width: `${fill}%` }}
                    />
                  </div>
                  <p className="mt-2.5 text-xs text-muted-foreground">
                    {t('inv_vacancy_gross')}{' '}
                    <span className="tabular-nums text-foreground">
                      <FigureValue figure={row.grossYieldOnPurchasePrice} kind="percent" />
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('inv_vacancy_net')}{' '}
                    <span className="tabular-nums text-foreground">
                      <FigureValue figure={row.netYieldOnPurchasePrice} kind="percent" />
                    </span>
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </Module>
  );
}

/* ── The income-implied value spectrum ──────────────────────────────── */

const SPECTRUM_YIELDS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function ImpliedValueModule({
  model,
  focused,
  missing,
  onBenchmarkChange,
}: {
  model: InvestmentModel;
  focused: boolean;
  missing: string[];
  onBenchmarkChange: (percent: number) => void;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const currency = model.currency;

  const bases = model.impliedValuations;
  const [basis, setBasis] = useState<string>('GROSS_POTENTIAL');
  const selected = bases.find((v) => v.basis === basis) ?? bases[0] ?? null;

  const benchmark = model.input.benchmarkYieldPercent ?? 6;
  const [hover, setHover] = useState<number | null>(null);
  const active = hover ?? benchmark;

  const impliedAtActive = selected ? incomeImpliedValue(selected.annualIncome, active) : null;

  const curve = useMemo(() => {
    if (!selected) return [];
    return SPECTRUM_YIELDS.map((y) => ({
      y,
      value: incomeImpliedValue(selected.annualIncome, y) ?? 0,
    }));
  }, [selected]);

  if (!selected) {
    return (
      <Module
        id="implied-value"
        eyebrowKey="inv_mod_implied_eyebrow"
        titleKey="inv_mod_implied_title"
        subtitleKey="inv_mod_implied_sub"
        focused={focused}
      >
        <NeedsInput missing={missing} />
      </Module>
    );
  }

  const maxValue = Math.max(...curve.map((p) => p.value), 1);

  return (
    <Module
      id="implied-value"
      eyebrowKey="inv_mod_implied_eyebrow"
      titleKey="inv_mod_implied_title"
      subtitleKey="inv_mod_implied_sub"
      focused={focused}
      actions={
        <Segmented
          ariaLabelKey="inv_implied_basis_label"
          value={basis}
          onChange={setBasis}
          options={bases.map((v) => ({ value: v.basis, label: t(`inv_basis_${v.basis}`) }))}
        />
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div>
          {/* The curve. An SVG rather than a chart library: it is ten
              points of a hyperbola and the only interaction is picking one,
              which is not worth 40KB of axis machinery. */}
          <div className="relative">
            <svg
              viewBox="0 0 400 180"
              className="h-44 w-full"
              role="img"
              aria-label={t('inv_implied_chart_label')}
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="inv-implied-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--gold))" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="hsl(var(--gold))" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d={areaPath(curve, maxValue)}
                fill="url(#inv-implied-fill)"
                stroke="none"
              />
              <path
                d={linePath(curve, maxValue)}
                fill="none"
                stroke="hsl(var(--gold))"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {curve.map((point, index) => {
                const x = (index / (curve.length - 1)) * 400;
                const y = 170 - (point.value / maxValue) * 150;
                const isActive = point.y === active;
                return (
                  <circle
                    key={point.y}
                    cx={x}
                    cy={y}
                    r={isActive ? 5 : 2.5}
                    fill={isActive ? 'hsl(var(--gold))' : 'hsl(var(--muted-foreground))'}
                  />
                );
              })}
            </svg>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {SPECTRUM_YIELDS.map((y) => (
              <button
                key={y}
                type="button"
                onMouseEnter={() => setHover(y)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(y)}
                onBlur={() => setHover(null)}
                onClick={() => onBenchmarkChange(y)}
                aria-pressed={y === benchmark}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-xs tabular-nums transition-colors',
                  y === benchmark
                    ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {formatPercent(y, locale, 0)}
              </button>
            ))}
          </div>
          <p className="mt-3 max-w-[64ch] text-sm text-muted-foreground">
            {t('inv_implied_explainer')}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-[hsl(var(--secondary))] p-5">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">
            {t('inv_implied_income_label', { basis: t(`inv_basis_${selected.basis}`) })}
          </p>
          <p className="mt-1 font-display text-lg font-semibold tabular-nums text-foreground">
            {formatMoney(selected.annualIncome, currency, locale)}
          </p>

          <div className="my-4 h-px bg-border" />

          <p className="text-2xs uppercase tracking-wide text-muted-foreground">
            {t('inv_implied_at', { yield: formatPercent(active, locale, 1) })}
          </p>
          <p className="mt-1 font-display text-3xl font-semibold leading-none text-[hsl(var(--gold-ink))]">
            {impliedAtActive === null ? '—' : formatMoney(impliedAtActive, currency, locale)}
          </p>
          <p className="mt-3 text-2xs leading-relaxed text-muted-foreground">
            {t('inv_implied_caveat')}
          </p>
        </div>
      </div>
    </Module>
  );
}

function linePath(points: Array<{ value: number }>, max: number): string {
  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 400;
      const y = 170 - (point.value / max) * 150;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function areaPath(points: Array<{ value: number }>, max: number): string {
  if (!points.length) return '';
  return `${linePath(points, max)} L400,180 L0,180 Z`;
}

/** Which reference point a marker is. Gold is the price you actually pay. */
function markerTone(key: string): string {
  if (key === 'PURCHASE_PRICE') return 'bg-[hsl(var(--gold))]';
  if (key === 'INCOME_IMPLIED') return 'bg-[hsl(var(--foreground))]';
  return 'bg-[hsl(var(--muted-foreground))]';
}

/* ── Is this expensive? ─────────────────────────────────────────────── */

export function PricePositionModule({
  model,
  comparableRange,
  focused,
  onResearch,
  researchAvailable,
}: {
  model: InvestmentModel;
  comparableRange: MarketComparableRange | null;
  focused: boolean;
  onResearch: () => void;
  researchAvailable: boolean;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const currency = model.currency;

  const impliedAtBenchmark =
    model.impliedValuations.find((v) => v.basis === 'GROSS_POTENTIAL')?.atBenchmark.value ?? null;

  const position = positionAgainstEvidence({
    purchasePrice: model.capital.purchasePrice,
    askingPrice: model.input.askingPrice,
    incomeImpliedValue: impliedAtBenchmark,
    comparableRange,
  });

  const amounts = position.points.map((p) => p.amount);
  const lo = Math.min(...amounts, model.capital.purchasePrice);
  const hi = Math.max(...amounts, model.capital.purchasePrice);
  const span = hi - lo || 1;
  const at = (value: number) => ((value - lo) / span) * 100;

  return (
    <Module
      id="price-position"
      eyebrowKey="inv_mod_price_eyebrow"
      titleKey="inv_mod_price_title"
      subtitleKey="inv_mod_price_sub"
      focused={focused}
      actions={
        researchAvailable && !comparableRange ? (
          <button
            type="button"
            onClick={onResearch}
            className="rounded-full border border-[hsl(var(--gold-border))] px-4 py-2 text-xs font-medium text-[hsl(var(--gold-ink))] transition-colors hover:bg-[hsl(var(--gold-soft))]"
          >
            {t('inv_price_research_cta')}
          </button>
        ) : null
      }
    >
      {/*
        THE RAIL.
        Markers alternate above and below the line. With six reference points
        inside a few percent of each other — which is the normal case, since
        they are all prices for the same flat — a single row of labels
        overlaps into an unreadable smear. Alternating halves the crowding
        without moving any marker off its true position.
      */}
      <div className="relative h-32">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[hsl(var(--muted))]" />
        {comparableRange ? (
          <div
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[hsl(var(--info)/0.45)]"
            style={{
              left: `${at(comparableRange.low)}%`,
              width: `${Math.max(1, at(comparableRange.high) - at(comparableRange.low))}%`,
            }}
            aria-hidden="true"
          />
        ) : null}
        {position.points.map((point, index) => {
          const above = index % 2 === 0;
          return (
            <div
              key={point.key}
              className={cn(
                'absolute flex w-24 -translate-x-1/2 flex-col items-center',
                above ? 'top-0 justify-end' : 'bottom-0 justify-start',
              )}
              style={{ left: `${at(point.amount)}%`, height: 'calc(50% + 0.375rem)' }}
            >
              {above ? (
                <>
                  <p className="text-center text-2xs leading-tight text-muted-foreground">
                    {t(`inv_pp_${point.key}`)}
                  </p>
                  <p className="mb-1 text-2xs font-medium tabular-nums text-foreground">
                    {formatMoney(point.amount, currency, locale, { compact: true })}
                  </p>
                  <div className={cn('h-4 w-[2px]', markerTone(point.key))} />
                </>
              ) : (
                <>
                  <div className={cn('h-4 w-[2px]', markerTone(point.key))} />
                  <p className="mt-1 text-center text-2xs leading-tight text-muted-foreground">
                    {t(`inv_pp_${point.key}`)}
                  </p>
                  <p className="text-2xs font-medium tabular-nums text-foreground">
                    {formatMoney(point.amount, currency, locale, { compact: true })}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-border bg-[hsl(var(--secondary))] p-4">
        <p className="text-sm text-foreground">{t(`inv_price_verdict_${position.verdict}`)}</p>
        {/*
          A difference of zero is not "$0 above" — it is the two figures
          agreeing, which is a different and more interesting thing to say.
          Rounded to the currency unit, because a two-cent gap between a
          purchase price and a value implied by a division is arithmetic
          noise, not a finding.
        */}
        {position.differenceVsIncomeImplied !== null ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {Math.abs(position.differenceVsIncomeImplied) < 1
              ? t('inv_price_matches_implied')
              : t('inv_price_vs_implied', {
                  amount: formatMoney(
                    Math.abs(position.differenceVsIncomeImplied),
                    currency,
                    locale,
                  ),
                  direction: t(
                    position.differenceVsIncomeImplied > 0 ? 'inv_price_above' : 'inv_price_below',
                  ),
                })}
          </p>
        ) : null}
        {comparableRange ? (
          <p className="mt-2 text-2xs text-muted-foreground">
            {t('inv_price_evidence_note', {
              sources: comparableRange.independentSourceCount,
              observations: comparableRange.observationCount,
              basis: t(`inv_basis_label_${comparableRange.basis}`),
            })}
          </p>
        ) : (
          <p className="mt-2 text-2xs text-muted-foreground">{t('inv_price_no_evidence_note')}</p>
        )}
      </div>
    </Module>
  );
}
