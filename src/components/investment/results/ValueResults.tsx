// HOMATCH INVESTMENT INTELLIGENCE — what the property is worth TO THIS PLAN.
//
// THE ONE RULE THIS FILE EXISTS TO KEEP
//
// There is no single number. An investment value is a set of boundaries,
// and quoting the middle of them as "the value" would be the most
// confident lie the product could tell. So the answer is drawn as a scale:
//
//   TARGET ENTRY ──── MAXIMUM ──── BREAK-EVEN
//     buy here        still works    nothing left
//
// with the asking market range behind it and the investor's own proposed
// price marked on it. Where the marker falls IS the answer, and it is
// legible in one look without reading a single figure.
//
// The market band and the calculated boundaries are drawn in different
// materials — a soft band versus hard ticks — because one is what other
// people are asking and the other is what this plan can afford. Conflating
// them is how investors end up paying the market's price for their own
// strategy's risk.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { AcquisitionValueResult } from '@/investment/calculations/acquisitionValue';
import type { MarketComparableRange } from '@/investment/calculations/valuation';
import { Metric, Module, formatMoney, intlLocaleFor } from '../primitives';

const VERDICT_TONE: Record<AcquisitionValueResult['verdictKey'], string> = {
  inv_value_verdict_comfortable:
    'border-[hsl(var(--success)/0.4)] bg-[hsl(var(--success)/0.08)] text-[hsl(var(--success))]',
  inv_value_verdict_tight:
    'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]',
  inv_value_verdict_below_requirement:
    'border-[hsl(var(--warning)/0.45)] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]',
  inv_value_verdict_does_not_work:
    'border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.07)] text-[hsl(var(--destructive))]',
  inv_value_verdict_no_price: 'border-border bg-[hsl(var(--secondary))] text-muted-foreground',
};

export function ValueResults({
  result,
  proposedPrice,
  areaSqm,
  comparableRange,
}: {
  result: AcquisitionValueResult;
  proposedPrice: number | null;
  areaSqm: number | null;
  comparableRange: MarketComparableRange | null;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const currency = result.currency;

  return (
    <>
      <Module
        id="verdict"
        eyebrowKey="inv_mod_value_eyebrow"
        titleKey="inv_mod_value_title"
        subtitleKey="inv_mod_value_sub"
      >
        <p
          className={cn(
            'rounded-xl border px-4 py-3.5 text-sm font-medium leading-relaxed',
            VERDICT_TONE[result.verdictKey],
          )}
        >
          {t(result.verdictKey)}
        </p>

        <PriceScale
          target={result.targetEntryPrice.value}
          maximum={result.maximumPrice.value}
          breakEven={result.breakEvenPrice.value}
          proposed={proposedPrice}
          range={comparableRange}
          currency={currency}
          locale={locale}
        />

        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          <Metric
            labelKey="inv_v_target_entry"
            figure={result.targetEntryPrice}
            kind="money"
            currency={currency}
            emphasis
            noteKey="inv_v_target_entry_note"
          />
          <Metric
            labelKey="inv_v_maximum"
            figure={result.maximumPrice}
            kind="money"
            currency={currency}
            noteKey="inv_v_maximum_note"
          />
          <Metric
            labelKey="inv_v_break_even"
            figure={result.breakEvenPrice}
            kind="money"
            currency={currency}
            noteKey="inv_v_break_even_note"
          />
        </div>

        {areaSqm !== null && areaSqm > 0 ? (
          <div className="mt-6 grid gap-6 border-t border-border pt-6 sm:grid-cols-2">
            <Metric
              labelKey="inv_v_target_entry_per_sqm"
              figure={result.targetEntryPricePerSqm}
              kind="money"
              currency={currency}
            />
            <Metric
              labelKey="inv_v_maximum_per_sqm"
              figure={result.maximumPricePerSqm}
              kind="money"
              currency={currency}
            />
          </div>
        ) : null}

        <p className="mt-6 max-w-[64ch] rounded-lg border border-dashed border-border px-4 py-3 text-2xs leading-relaxed text-muted-foreground">
          {t('inv_v_no_single_number')}
        </p>
      </Module>

      <Module
        id="at-your-price"
        eyebrowKey="inv_mod_at_price_eyebrow"
        titleKey="inv_mod_at_price_title"
        subtitleKey="inv_mod_at_price_sub"
      >
        {proposedPrice !== null && proposedPrice > 0 ? (
          <>
            <p className="mb-5 text-sm text-muted-foreground">
              {t('inv_v_at_price_intro', {
                price: formatMoney(proposedPrice, currency, locale),
              })}
            </p>
            <div className="grid gap-6 sm:grid-cols-3">
              <Metric
                labelKey="inv_v_profit_at_price"
                figure={result.profitAtProposedPrice}
                kind="money"
                currency={currency}
                emphasis
              />
              <Metric
                labelKey="inv_v_return_at_price"
                figure={result.returnAtProposedPricePercent}
                kind="percent"
                decimals={1}
              />
              <Metric
                labelKey="inv_m_margin_of_safety"
                figure={result.marginOfSafetyPercent}
                kind="percent"
                decimals={1}
                noteKey="inv_v_margin_note"
              />
            </div>
          </>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {t('inv_v_add_price_prompt')}
          </p>
        )}
      </Module>

      {comparableRange ? (
        <Module
          id="market-range"
          eyebrowKey="inv_mod_market_range_eyebrow"
          titleKey="inv_mod_market_range_title"
          subtitleKey="inv_mod_market_range_sub"
        >
          <div className="grid gap-6 sm:grid-cols-3">
            <Metric
              labelKey="inv_v_market_low"
              figure={{ value: comparableRange.low, unavailable: null }}
              kind="money"
              currency={comparableRange.currency}
            />
            <Metric
              labelKey="inv_v_market_median"
              figure={{ value: comparableRange.median, unavailable: null }}
              kind="money"
              currency={comparableRange.currency}
            />
            <Metric
              labelKey="inv_v_market_high"
              figure={{ value: comparableRange.high, unavailable: null }}
              kind="money"
              currency={comparableRange.currency}
            />
          </div>
          <p className="mt-5 text-2xs leading-relaxed text-muted-foreground">
            {comparableRange.basis === 'ASKING'
              ? t('inv_v_market_asking_note', {
                  listings: comparableRange.observationCount,
                  sources: comparableRange.independentSourceCount,
                })
              : t('inv_v_market_sold_note', {
                  sales: comparableRange.observationCount,
                  sources: comparableRange.independentSourceCount,
                })}
          </p>
        </Module>
      ) : null}
    </>
  );
}

/* ── The scale ──────────────────────────────────────────────────────── */

function PriceScale({
  target,
  maximum,
  breakEven,
  proposed,
  range,
  currency,
  locale,
}: {
  target: number | null;
  maximum: number | null;
  breakEven: number | null;
  proposed: number | null;
  range: MarketComparableRange | null;
  currency: string;
  locale: string;
}) {
  const { t } = useLanguage();

  const anchors = [target, maximum, breakEven, proposed, range?.low, range?.high].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0,
  );
  if (anchors.length < 2) return null;

  const rawLow = Math.min(...anchors);
  const rawHigh = Math.max(...anchors);
  const pad = Math.max((rawHigh - rawLow) * 0.12, rawHigh * 0.02);
  const low = Math.max(0, rawLow - pad);
  const high = rawHigh + pad;
  const span = high - low || 1;
  const at = (value: number) => ((value - low) / span) * 100;

  const ticks = [
    target !== null
      ? { value: target, labelKey: 'inv_v_target_entry', tone: 'hsl(var(--success))' }
      : null,
    maximum !== null
      ? { value: maximum, labelKey: 'inv_v_maximum', tone: 'hsl(var(--gold))' }
      : null,
    breakEven !== null
      ? { value: breakEven, labelKey: 'inv_v_break_even', tone: 'hsl(var(--destructive))' }
      : null,
  ].filter((tick): tick is { value: number; labelKey: string; tone: string } => tick !== null);

  return (
    <div className="mt-8">
      {/*
       * Forced LTR: the scale runs cheap → expensive left to right in every
       * language. It is a number line, not a sentence, and mirroring it
       * would invert what "below the maximum" looks like.
       */}
      <div className="relative h-[8.5rem]" dir="ltr">
        {range ? (
          <div
            className="absolute top-[3.1rem] h-3 rounded-full bg-[hsl(var(--secondary))]"
            style={{
              left: `${at(range.low)}%`,
              width: `${Math.max(at(range.high) - at(range.low), 0.6)}%`,
            }}
            title={`${formatMoney(range.low, range.currency, locale)} - ${formatMoney(range.high, range.currency, locale)}`}
          />
        ) : null}

        <div className="absolute top-[3.45rem] h-1.5 w-full rounded-full bg-[hsl(var(--border))]" />

        {maximum !== null ? (
          <div
            className="absolute top-[3.45rem] h-1.5 rounded-s-full bg-[hsl(var(--success)/0.4)]"
            style={{ left: 0, width: `${at(maximum)}%` }}
          />
        ) : null}

        {ticks.map((tick) => (
          <div
            key={tick.labelKey}
            className="absolute top-[2.6rem] -translate-x-1/2"
            style={{ left: `${at(tick.value)}%` }}
          >
            <div className="h-[2.2rem] w-0.5 rounded" style={{ background: tick.tone }} />
            <p className="mt-1.5 w-24 -translate-x-[45%] text-center text-2xs leading-tight text-muted-foreground">
              <span className="block truncate font-medium text-foreground">
                {formatMoney(tick.value, currency, locale)}
              </span>
              {t(tick.labelKey)}
            </p>
          </div>
        ))}

        {proposed !== null && proposed > 0 ? (
          <div className="absolute top-0 -translate-x-1/2" style={{ left: `${at(proposed)}%` }}>
            <p className="mb-1 whitespace-nowrap rounded-full border border-[hsl(var(--gold-border))] bg-[hsl(var(--card))] px-2.5 py-1 text-2xs font-medium text-[hsl(var(--gold-ink))] shadow-[var(--shadow-soft)]">
              {t('inv_v_your_price')} {formatMoney(proposed, currency, locale)}
            </p>
            <div className="mx-auto h-[2.1rem] w-0.5 rounded bg-[hsl(var(--gold-ink))]" />
          </div>
        ) : null}
      </div>

      <p className="mt-2 text-2xs text-muted-foreground">
        {range ? t('inv_v_scale_legend_with_market') : t('inv_v_scale_legend')}
      </p>
    </div>
  );
}
