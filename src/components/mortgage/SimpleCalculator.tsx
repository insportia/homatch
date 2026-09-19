// THE CALCULATOR. Five questions, one button.
//
// WHY IT IS PLAIN FIELDS AND NOT THE CLICK-FIRST CHIP ROWS
//
// The chips elsewhere in this product exist because a fee schedule is
// full of numbers nobody knows off the top of their head. These five are
// the opposite: a person arrives at a mortgage calculator already
// holding a price and a rate, and making them hunt for "250,000" among
// five suggestions is slower than typing it. The suggestions stay where
// they earn their keep — the advanced inputs, one section down.
//
// THE BUTTON IS NEVER DISABLED.
//
// The page this replaced had a grey Calculate button above four
// placeholders that read as filled values, and nothing said which field
// was empty. So this one is always pressable: press it with a field
// missing and that exact field says what it needs and takes the cursor.
// A control that cannot be pressed cannot explain itself.

import React, { useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import { MORTGAGE_CURRENCIES } from '@/mortgage/currencies';
import { mortgageDerivedPercent } from '@/mortgage/presets';
import type { DraftField, FinancingDraft } from './useFinancingSession';

const QUICK_TERMS = [10, 15, 20, 25, 30];

/** Which field a press of Calculate is complaining about, if any. */
export type CalculatorField = 'propertyPrice' | 'downPayment' | 'termYears' | 'rate';

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string | null;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block text-sm font-medium text-foreground"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-[hsl(var(--destructive))]">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

const INPUT_CLASS =
  'min-h-12 w-full min-w-0 rounded-xl border border-border bg-[hsl(var(--input))] px-4 text-base ' +
  'text-foreground outline-none transition-colors focus:border-[hsl(var(--gold-border))]';

export function SimpleCalculator({
  draft,
  set,
  onCalculate,
  calculated,
}: {
  draft: FinancingDraft;
  set: (field: DraftField, value: number | string | null) => void;
  onCalculate: () => void;
  calculated: boolean;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const currency = draft.currency;

  /* The deposit can be said either way round, and people think in both:
     "fifty thousand" and "twenty percent" are the same decision. */
  const [downMode, setDownMode] = useState<'AMOUNT' | 'PERCENT'>('AMOUNT');
  const [problem, setProblem] = useState<CalculatorField | null>(null);

  const refs = {
    propertyPrice: useRef<HTMLInputElement>(null),
    downPayment: useRef<HTMLInputElement>(null),
    termYears: useRef<HTMLInputElement>(null),
    rate: useRef<HTMLInputElement>(null),
  };

  const termYears = draft.termMonths === null ? null : draft.termMonths / 12;
  const downPercent = mortgageDerivedPercent({
    propertyPrice: draft.propertyPrice ?? undefined,
    downPayment: draft.downPayment ?? undefined,
  });

  const downValue = useMemo(() => {
    if (downMode === 'AMOUNT') return draft.downPayment;
    return downPercent;
  }, [downMode, draft.downPayment, downPercent]);

  const setDown = (raw: number | null) => {
    if (raw === null) return set('downPayment', null);
    if (downMode === 'AMOUNT') return set('downPayment', raw);
    const price = draft.propertyPrice;
    if (price === null) return set('downPayment', null);
    set('downPayment', Math.round((price * raw) / 100));
  };

  const firstProblem = (): CalculatorField | null => {
    if (draft.propertyPrice === null || draft.propertyPrice <= 0) return 'propertyPrice';
    if (draft.downPayment === null || draft.downPayment < 0) return 'downPayment';
    if (draft.downPayment >= draft.propertyPrice) return 'downPayment';
    if (draft.termMonths === null || draft.termMonths <= 0) return 'termYears';
    if (draft.nominalAnnualRatePercent === null || draft.nominalAnnualRatePercent < 0) return 'rate';
    return null;
  };

  const press = () => {
    const next = firstProblem();
    setProblem(next);
    if (next) {
      refs[next].current?.focus();
      return;
    }
    onCalculate();
  };

  const errorFor = (field: CalculatorField): string | null => {
    if (problem !== field) return null;
    if (field === 'downPayment' && draft.downPayment !== null && draft.propertyPrice !== null
        && draft.downPayment >= draft.propertyPrice) {
      return t('mortgage_calc_error_down_too_big');
    }
    return t('mortgage_calc_error_missing');
  };

  const number = (value: number | null) => (value === null ? '' : String(value));
  const parse = (raw: string): number | null => {
    if (raw.trim() === '') return null;
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  return (
    <section id="calculator" className="hm-workspace-panel p-5 sm:p-7">
      <div className="grid gap-5 sm:grid-cols-2">
        {/* ── Currency ── */}
        <Field
          id="mtg-currency"
          label={t('mortgage_label_currency')}
          hint={t('mortgage_currency_denomination_note')}
        >
          <select
            id="mtg-currency"
            value={currency}
            onChange={(e) => set('currency', e.target.value)}
            className={cn(INPUT_CLASS, 'appearance-none')}
          >
            {MORTGAGE_CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
        </Field>

        {/* ── Price ── */}
        <Field
          id="mtg-price"
          label={t('mortgage_label_property_price')}
          error={errorFor('propertyPrice')}
        >
          <input
            ref={refs.propertyPrice}
            id="mtg-price"
            type="text"
            inputMode="decimal"
            value={number(draft.propertyPrice)}
            onChange={(e) => { setProblem(null); set('propertyPrice', parse(e.target.value)); }}
            className={INPUT_CLASS}
          />
        </Field>

        {/* ── Deposit ── */}
        <Field
          id="mtg-down"
          label={t('mortgage_label_down_payment')}
          error={errorFor('downPayment')}
          hint={
            downMode === 'AMOUNT'
              ? downPercent !== null
                ? t('mortgage_calc_down_is_percent', { pct: downPercent })
                : null
              : draft.downPayment !== null
                ? t('mortgage_calc_down_is_amount', {
                    amount: formatMoney(draft.downPayment, currency, locale),
                  })
                : null
          }
        >
          <div className="flex items-stretch gap-2">
            <input
              ref={refs.downPayment}
              id="mtg-down"
              type="text"
              inputMode="decimal"
              value={number(downValue)}
              onChange={(e) => { setProblem(null); setDown(parse(e.target.value)); }}
              className={INPUT_CLASS}
            />
            <div className="flex shrink-0 rounded-xl border border-border bg-[hsl(var(--secondary))] p-1">
              {(['AMOUNT', 'PERCENT'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setDownMode(mode)}
                  aria-pressed={downMode === mode}
                  aria-label={mode === 'AMOUNT' ? t('mortgage_calc_down_in_money') : t('mortgage_calc_down_in_percent')}
                  className={cn(
                    'min-h-10 rounded-lg px-3 text-sm font-medium transition-colors',
                    downMode === mode
                      ? 'bg-[hsl(var(--gold))] text-[hsl(var(--primary-foreground))]'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {mode === 'AMOUNT' ? currency : '%'}
                </button>
              ))}
            </div>
          </div>
        </Field>

        {/* ── Term ── */}
        <Field
          id="mtg-term"
          label={t('mortgage_label_term_years')}
          error={errorFor('termYears')}
        >
          <input
            ref={refs.termYears}
            id="mtg-term"
            type="text"
            inputMode="numeric"
            value={number(termYears)}
            onChange={(e) => {
              setProblem(null);
              const years = parse(e.target.value);
              set('termMonths', years === null ? null : Math.round(years * 12));
            }}
            className={INPUT_CLASS}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {QUICK_TERMS.map((years) => (
              <button
                key={years}
                type="button"
                onClick={() => { setProblem(null); set('termMonths', years * 12); }}
                aria-pressed={termYears === years}
                className={cn(
                  'min-h-10 rounded-lg border px-3 text-xs font-medium transition-colors',
                  termYears === years
                    ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {years}
              </button>
            ))}
          </div>
        </Field>

        {/* ── Rate ── */}
        <Field
          id="mtg-rate-input"
          label={t('mortgage_label_nominal_rate')}
          error={errorFor('rate')}
          hint={t('mortgage_calc_rate_hint')}
        >
          <div className="flex items-stretch">
            <input
              ref={refs.rate}
              id="mtg-rate-input"
              type="text"
              inputMode="decimal"
              value={number(draft.nominalAnnualRatePercent)}
              onChange={(e) => { setProblem(null); set('nominalAnnualRatePercent', parse(e.target.value)); }}
              className={cn(INPUT_CLASS, 'rounded-e-none border-e-0')}
            />
            <span className="flex min-h-12 items-center rounded-e-xl border border-border bg-[hsl(var(--secondary))] px-3 text-sm text-muted-foreground">
              %
            </span>
          </div>
        </Field>
      </div>

      {!calculated ? (
        <button
          id="mtg-calculate"
          type="button"
          onClick={press}
          className="mt-6 min-h-12 w-full rounded-xl bg-[hsl(var(--gold))] px-6 text-base font-semibold text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--gold-hover))] sm:w-auto"
        >
          {t('mortgage_calculate')}
        </button>
      ) : null}
    </section>
  );
}
