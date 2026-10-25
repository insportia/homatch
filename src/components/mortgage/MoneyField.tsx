// HOMATCH HOME FINANCING — one money amount, in whatever currency it is in.
//
// Every money input in the mortgage flow carries a currency picker. In the
// loan currency the field is exactly what it was (the caller's own input or
// chip row, passed as children). In any other currency the field becomes a
// plain amount box, and under it the converted figure, the rate and the
// date the National Bank of Georgia published it.
//
// The value handed to onChange is ALWAYS in the loan currency, so no engine
// changes. When there is no rate for the chosen currency the value is null
// (the field is treated as empty and says why), never the typed number and
// never zero.

import React, { useEffect, useId, useState } from 'react';
import { ArrowRightLeft, TriangleAlert } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import {
  MAIN_ENTRY_CURRENCIES, OTHER_ENTRY_CURRENCIES, convertAmount, entryInLoanCurrency, isRateOld, type FxTable,
} from '@/mortgage/fx';
import { useFxRates, useMoneyEntry } from './fxRates';

export const MONEY_INPUT_CLASS =
  'min-h-12 w-full min-w-0 rounded-xl border border-border bg-[hsl(var(--input))] px-4 text-base ' +
  'text-foreground shadow-card outline-none transition-colors focus:border-[hsl(var(--gold-border))] focus:ring-2 focus:ring-gold/20';

const parse = (raw: string): number | null => {
  const cleaned = raw.replace(/[\s  ]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** The picker on its own: a framed native select, so phones get their own wheel and screen readers a combobox. */
export function CurrencyPicker({ value, onChange, table, labelledBy, className }: {
  value: string;
  onChange: (code: string) => void;
  table: FxTable;
  labelledBy?: string;
  className?: string;
}) {
  const { t } = useLanguage();
  const others = OTHER_ENTRY_CURRENCIES.filter((c) => c in table || c === value);
  const extra = Object.keys(table).filter((c) => !(MAIN_ENTRY_CURRENCIES as readonly string[]).includes(c) && !(others as readonly string[]).includes(c)).sort();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t('mortgage_fx_amount_currency')}
      aria-describedby={labelledBy}
      className={cn(
        'min-h-12 shrink-0 cursor-pointer appearance-none rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] bg-[length:12px] bg-[position:right_0.6rem_center] bg-no-repeat pe-7 ps-3 text-sm font-semibold text-[hsl(var(--gold-ink))] shadow-card outline-none transition-colors hover:border-[hsl(var(--gold))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] rtl:bg-[position:left_0.6rem_center]',
        className,
      )}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' fill='none' stroke='%23a07a1f' stroke-width='1.6'/%3E%3C/svg%3E\")" }}
    >
      <optgroup label={t('mortgage_fx_main_currencies')}>
        {MAIN_ENTRY_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </optgroup>
      {others.length + extra.length > 0 ? (
        <optgroup label={t('mortgage_fx_more_currencies')}>
          {[...others, ...extra].map((c) => <option key={c} value={c}>{c}</option>)}
        </optgroup>
      ) : null}
    </select>
  );
}

/** "About 270,000 ₾ · 1 USD = 2.7 GEL, National Bank of Georgia, 24 Oct 2026", or why there is no figure. */
export function ConversionLine({ amount, from, to, table, loading }: { amount: number | null; from: string; to: string; table: FxTable; loading: boolean }) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  if (from === to) return null;
  if (loading) return <p className="mt-1.5 text-xs text-muted-foreground" role="status">{t('mortgage_fx_rate_loading')}</p>;
  const unit = convertAmount(1, from, to, table);
  if (!unit) {
    return (
      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-[hsl(var(--destructive))]" role="alert">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t('mortgage_fx_rate_unavailable', { code: from, loan: to })}
      </p>
    );
  }
  const date = unit.rateDate ? new Date(`${unit.rateDate}T12:00:00Z`).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const converted = amount === null ? null : convertAmount(amount, from, to, table);
  return (
    <div className="mt-2 rounded-xl border border-border bg-[hsl(var(--secondary))] px-3 py-2">
      {converted ? (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <ArrowRightLeft className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
          {t('mortgage_fx_converted', { amount: formatMoney(converted.value, to, locale) })}
        </p>
      ) : null}
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t('mortgage_fx_rate_line', { from, rate: unit.rate.toLocaleString(locale, { maximumFractionDigits: 4 }), to, date })}
      </p>
      {isRateOld(unit.rateDate) ? <p className="mt-0.5 text-xs text-[hsl(var(--gold-ink))]">{t('mortgage_fx_rate_old', { date })}</p> : null}
    </div>
  );
}

/**
 * A money field with a currency picker.
 *
 * `children` is the loan-currency control (the caller's own input or chips);
 * it is shown untouched while the picker reads the loan currency.
 */
export function MoneyField({
  id,
  persistKey,
  loanCurrency,
  value,
  onChange,
  labelledBy,
  children,
  inputRef,
}: {
  id?: string;
  /** A scenario field name: the typed amount and currency are saved with the scenario. */
  persistKey?: string;
  loanCurrency: string;
  /** In the loan currency. */
  value: number | null;
  onChange: (value: number | null) => void;
  labelledBy?: string;
  children: React.ReactNode;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const fx = useFxRates();
  const [entry, setEntry] = useMoneyEntry(persistKey);
  const foreign = entry !== null && entry.currency !== loanCurrency;
  const [text, setText] = useState(() => (entry?.amount ?? '') === '' ? '' : String(entry?.amount));
  const autoId = useId();
  const inputId = id ?? `money-${autoId}`;

  /* Keep the loan-currency value in step with the typed entry: when the rate
     arrives, when the loan currency changes. Never while rates are loading,
     so a reload does not blank a stored figure for a second. */
  useEffect(() => {
    if (!foreign || fx.loading || !entry) return;
    const next = entryInLoanCurrency(entry, loanCurrency, fx.table)?.value ?? null;
    if (next !== value) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foreign, fx.loading, fx.table, entry?.amount, entry?.currency, loanCurrency]);

  /* An entry replaced from outside (a saved scenario reopened) shows its own amount. */
  useEffect(() => {
    const amount = entry?.amount ?? null;
    if (parse(text) !== amount) setText(amount === null ? '' : String(amount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.amount]);

  /* Back in the loan currency: the entry has done its job. */
  useEffect(() => {
    /* The typed amount is now simply in the loan currency: keep it as typed. */
    if (entry && entry.currency === loanCurrency) {
      if (entry.amount !== value) onChange(entry.amount);
      setEntry(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.currency, loanCurrency]);

  const pick = (code: string) => {
    if (code === loanCurrency) { setEntry(null); return; }
    const from = entry && entry.amount !== null ? entry : value !== null ? { amount: value, currency: loanCurrency } : null;
    const seeded = from ? convertAmount(from.amount as number, from.currency, code, fx.table) : null;
    const amount = seeded ? Math.round(seeded.value) : null;
    setText(amount === null ? '' : String(amount));
    setEntry({ amount, currency: code });
  };

  return (
    <div>
      <div className="flex items-stretch gap-2">
        <div className="min-w-0 flex-1">
          {foreign ? (
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              inputMode="decimal"
              aria-labelledby={labelledBy}
              value={text}
              onChange={(e) => { setText(e.target.value); setEntry({ amount: parse(e.target.value), currency: entry!.currency }); }}
              className={MONEY_INPUT_CLASS}
            />
          ) : children}
        </div>
        <CurrencyPicker value={foreign ? entry!.currency : loanCurrency} onChange={pick} table={fx.table} labelledBy={labelledBy} />
      </div>
      {foreign ? <ConversionLine amount={entry!.amount} from={entry!.currency} to={loanCurrency} table={fx.table} loading={fx.loading} /> : null}
    </div>
  );
}
