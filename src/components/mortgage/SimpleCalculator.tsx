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
// ANY CURRENCY IN, ONE CURRENCY OUT
//
// The loan currency (lari by default) is what the calculation runs in. The
// price and the deposit each carry their own currency picker, so a flat
// advertised in dollars is typed in dollars and converted with the National
// Bank of Georgia's official rate; the rate and its date sit under the field.
// See MoneyField.tsx and src/mortgage/fx.ts.
//
// THE BUTTON IS NEVER DISABLED.
//
// The page this replaced had a grey Calculate button above four
// placeholders that read as filled values, and nothing said which field
// was empty. So this one is always pressable: press it with a field
// missing and that exact field says what it needs and takes the cursor.
// A control that cannot be pressed cannot explain itself.

import React, { useMemo, useRef, useState } from 'react';
import { Banknote } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import { MORTGAGE_CURRENCIES } from '@/mortgage/currencies';
import { mortgageDerivedPercent } from '@/mortgage/presets';
import { TermInfo } from './TermInfo';
import { MoneyField, MONEY_INPUT_CLASS } from './MoneyField';
import { useMoneyEntry } from './fxRates';
import type { GlossaryTerm } from '@/mortgage/glossary';
import type { DraftField, FinancingDraft } from './useFinancingSession';

const QUICK_TERMS = [10, 15, 20, 25, 30];

/** Which field a press of Calculate is complaining about, if any. */
export type CalculatorField = 'propertyPrice' | 'downPayment' | 'termYears' | 'rate';

function Field({
  id,
  label,
  hint,
  error,
  term,
  aside,
  children,
}: {
  id: string;
  /** A small control at the end of the label row. */
  aside?: React.ReactNode;
  label: string;
  /** A financial term worth explaining beside the label. */
  term?: GlossaryTerm;
  hint?: string | null;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <label htmlFor={id} className="block text-[15px] font-semibold text-foreground">
          {label}
        </label>
        {term ? <TermInfo term={term} /> : null}
        {aside ? <div className="ms-auto">{aside}</div> : null}
      </div>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-[hsl(var(--destructive))]" role="alert">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

const INPUT_CLASS = MONEY_INPUT_CLASS;

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

  /* A deposit typed as a percentage is in the loan currency by definition, so
     any amount typed earlier in another currency stops applying. */
  const [, setDownEntry] = useMoneyEntry('downPayment');
  const setDown = (raw: number | null) => {
    if (downMode === 'PERCENT') setDownEntry(null);
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

  const downInput = (
    <input
      ref={refs.downPayment}
      id="mtg-down"
      type="text"
      inputMode="decimal"
      value={number(downValue)}
      onChange={(e) => { setProblem(null); setDown(parse(e.target.value)); }}
      className={INPUT_CLASS}
    />
  );

  return (
    <section id="calculator" className="hm-customer-panel p-5 sm:p-7">
      <div className="grid gap-5 sm:grid-cols-2">
        {/* ── Loan currency. Amounts below can be typed in any currency. ── */}
        <Field
          id="mtg-currency"
          label={t('mortgage_label_currency')}
          hint={t('mortgage_fx_loan_currency_hint')}
        >
          <select
            id="mtg-currency"
            value={currency}
            onChange={(e) => set('currency', e.target.value)}
            className={cn(INPUT_CLASS, 'cursor-pointer appearance-none font-semibold')}
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
          <MoneyField
            id="mtg-price"
            persistKey="propertyPrice"
            loanCurrency={currency}
            value={draft.propertyPrice}
            onChange={(v) => { setProblem(null); set('propertyPrice', v); }}
            inputRef={refs.propertyPrice}
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
          </MoneyField>
        </Field>

        {/* ── Deposit ── */}
        <Field
          id="mtg-down"
          label={t('mortgage_label_down_payment')}
          term="DOWN_PAYMENT"
          aside={(
            <div className="flex shrink-0 rounded-xl border border-border bg-[hsl(var(--secondary))] p-1" role="group" aria-label={t('mortgage_label_down_payment')}>
              {(['AMOUNT', 'PERCENT'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setDownMode(mode)}
                  aria-pressed={downMode === mode}
                  aria-label={mode === 'AMOUNT' ? t('mortgage_calc_down_in_money') : t('mortgage_calc_down_in_percent')}
                  className={cn(
                    'min-h-10 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]',
                    downMode === mode
                      ? 'bg-[hsl(var(--gold))] text-[hsl(var(--primary-foreground))]'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {mode === 'AMOUNT' ? <Banknote className="h-4 w-4" aria-hidden="true" /> : '%'}
                </button>
              ))}
            </div>
          )}
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
          <div>
            <div className="min-w-0">
              {downMode === 'AMOUNT' ? (
                <MoneyField
                  id="mtg-down"
                  persistKey="downPayment"
                  loanCurrency={currency}
                  value={draft.downPayment}
                  onChange={(v) => { setProblem(null); set('downPayment', v); }}
                  inputRef={refs.downPayment}
                >
                  {downInput}
                </MoneyField>
              ) : downInput}
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
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t('mortgage_label_term_years')}>
            {QUICK_TERMS.map((years) => (
              <button
                key={years}
                type="button"
                onClick={() => { setProblem(null); set('termMonths', years * 12); }}
                aria-pressed={termYears === years}
                className={cn(
                  'min-h-10 min-w-12 rounded-xl border px-3 text-sm font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]',
                  termYears === years
                    ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))] shadow-card'
                    : 'border-border bg-card text-foreground hover:border-[hsl(var(--gold-border))]',
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
          term="NOMINAL_RATE"
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
          className="mt-6 min-h-12 w-full rounded-xl bg-[hsl(var(--gold))] px-8 text-base font-bold text-[#161309] shadow-card transition-colors hover:bg-[hsl(var(--gold-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto"
        >
          {t('mortgage_calculate')}
        </button>
      ) : null}
    </section>
  );
}
