import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Calculator, ListChecks, TrendingUp } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { formatMoney, formatPercent } from '@/components/workspace/primitives';
import { calculateMortgage } from '@/mortgage/calculations/amortization';
import { buildIncomeModel } from '@/investment/calculations/income';
import { paybackYears, percentOf } from '@/investment/calculations/core';
import {
  EMPLOYMENT_LABEL, EMPLOYMENT_PROFILES, HOMI_START_OPTIONS, HOMI_START_TITLE, pick,
  type HomiDeterministicIntent,
} from '@/lib/homi/content';
import { HOMI_CHECKLISTS, type HomiCardRef } from '@/lib/homi/cards';

/*
 * HOMI CARDS — the parts of a conversation you click instead of type.
 *
 * Every number here comes from HOMATCH's own engines (the mortgage payment
 * formula and the investment income model), computed in the browser from
 * what the person entered. Nothing is generated, nothing is fetched, and no
 * interest rate or rent is ever suggested: those are the person's inputs.
 */

export type HomiChipHandler = (label: string, intent?: HomiDeterministicIntent) => void;

const CARD = 'rounded-2xl border border-[hsl(var(--gold-border))] bg-card p-4 shadow-card';
const PILL = 'min-h-11 rounded-full border px-4 py-2 text-start text-sm transition-colors';
const FIELD = 'h-11 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]';

function numberOrNull(raw: string): number | null {
  const n = Number(raw.replace(/[\s,]/g, ''));
  return raw.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
}

/* ── Start menu ─────────────────────────────────────────────────────── */

export function HomiStartCard({ onChip, disabled }: { onChip: HomiChipHandler; disabled?: boolean }) {
  const { lang } = useLanguage();
  return (
    <div className={CARD} data-homi-card="START">
      <p className="mb-3 text-sm font-semibold text-foreground">{pick(HOMI_START_TITLE, lang)}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {HOMI_START_OPTIONS.map((o) => {
          const label = pick(o.label, lang);
          return (
            <button
              key={o.intent}
              type="button"
              disabled={disabled}
              onClick={() => onChip(label, o.intent)}
              className={cn(PILL, 'group flex items-center justify-between gap-2 border-border bg-background text-foreground hover:border-[hsl(var(--gold-border))] disabled:opacity-60')}
            >
              <span className="break-words">{label}</span>
              <ArrowRight className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))] rtl:rotate-180" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Income type picker (mortgage documents) ────────────────────────── */

export function HomiEmploymentCard({ onChip, disabled }: { onChip: HomiChipHandler; disabled?: boolean }) {
  const { lang, t } = useLanguage();
  return (
    <div className={CARD} data-homi-card="EMPLOYMENT_PICKER">
      <p className="mb-3 text-sm font-semibold text-foreground">{t('homi_card_income_source')}</p>
      <div className="flex flex-wrap gap-2">
        {EMPLOYMENT_PROFILES.map((p) => {
          const label = pick(EMPLOYMENT_LABEL[p], lang);
          return (
            <button
              key={p}
              type="button"
              disabled={disabled}
              onClick={() => onChip(label, `MORTGAGE_DOCS_${p}` as HomiDeterministicIntent)}
              className={cn(PILL, 'border-border bg-background text-foreground hover:border-[hsl(var(--gold-border))] disabled:opacity-60')}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Checklist, with progress kept on this device ───────────────────── */

const CHECK_KEY = (id: string) => `homatch.homi.checklist.${id}.v1`;

export function HomiChecklistCard({ id }: { id: string }) {
  const { lang, t } = useLanguage();
  const list = HOMI_CHECKLISTS[id];
  const [done, setDone] = useState<number[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(CHECK_KEY(id)) ?? '[]');
      return Array.isArray(raw) ? raw.filter((n) => Number.isInteger(n)) : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(CHECK_KEY(id), JSON.stringify(done)); } catch { /* storage unavailable */ }
  }, [done, id]);
  if (!list) return null;
  const total = list.items.length;
  const count = done.filter((i) => i < total).length;
  return (
    <div className={CARD} data-homi-card="CHECKLIST">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ListChecks className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
          {t('homi_card_checklist_title')}
        </p>
        <span className="text-xs text-muted-foreground">{t('homi_card_progress', { done: count, total })}</span>
      </div>
      <div
        className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={count}
        aria-label={t('homi_card_progress', { done: count, total })}
      >
        <div className="h-full bg-[hsl(38_92%_54%)] transition-[width] motion-reduce:transition-none" style={{ width: `${(count / total) * 100}%` }} />
      </div>
      <ul className="space-y-1.5">
        {list.items.map((item, i) => {
          const checked = done.includes(i);
          return (
            <li key={i}>
              <label className="relative flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-1 py-2 hover:bg-muted/50">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={checked}
                  onChange={() => setDone((d) => (checked ? d.filter((x) => x !== i) : [...d, i]))}
                />
                <span className={cn(
                  'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border peer-focus-visible:ring-2 peer-focus-visible:ring-[hsl(38_92%_56%)]',
                  checked ? 'border-[hsl(38_92%_54%)] bg-[hsl(38_92%_54%)] text-[#161309]' : 'border-border',
                )} aria-hidden="true">
                  {checked && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className={cn('text-sm leading-relaxed', checked ? 'text-muted-foreground line-through' : 'text-foreground')}>
                  {pick(item, lang)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── Monthly payment, live ───────────────────────────────────────────── */

const QUICK_CURRENCIES = ['GEL', 'USD', 'EUR'] as const;
const DOWN_STEPS = [10, 20, 30, 50];
const TERM_STEPS = [10, 15, 20, 25, 30];

export function HomiMortgageCard() {
  const { lang, t } = useLanguage();
  const navigate = useNavigate();
  const [currency, setCurrency] = useState<string>('USD');
  const [price, setPrice] = useState('');
  const [downPct, setDownPct] = useState(20);
  const [years, setYears] = useState(20);
  const [rate, setRate] = useState('');

  const priceN = numberOrNull(price);
  const rateN = numberOrNull(rate);
  const result = useMemo(() => {
    if (!priceN || priceN <= 0 || rateN === null || rateN > 60) return null;
    const downPayment = Math.round(priceN * downPct) / 100;
    const months = years * 12;
    /* The same engine and schedule as the Mortgage Consultant, so the two
       can never show different totals for the same scenario. */
    const r = calculateMortgage({ propertyPrice: priceN, propertyCurrency: currency, downPayment, termMonths: months, nominalAnnualRatePercent: rateN });
    return { downPayment, loan: r.loanAmount, monthly: r.monthlyPayment, totalInterest: r.totalInterest, months };
  }, [priceN, rateN, downPct, years, currency]);

  const money = (v: number) => formatMoney(v, currency, lang, { narrowSymbol: true });

  return (
    <div className={CARD} data-homi-card="MORTGAGE_QUICK">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Calculator className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
        {t('homi_card_mortgage_title')}
      </p>
      <div className="grid gap-3">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t('homi_card_price')}
            <input inputMode="decimal" className={FIELD} value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t('homi_card_currency')}
            <select className={cn(FIELD, 'w-24')} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {QUICK_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <fieldset>
          <legend className="mb-1 text-xs text-muted-foreground">{t('homi_card_down_payment', { pct: downPct })}</legend>
          <input type="range" min={0} max={90} step={5} value={downPct} onChange={(e) => setDownPct(Number(e.target.value))}
            className="w-full accent-[hsl(38_92%_54%)]" aria-label={t('homi_card_down_payment', { pct: downPct })} />
          <div className="mt-1 flex flex-wrap gap-1.5">
            {DOWN_STEPS.map((s) => (
              <button key={s} type="button" onClick={() => setDownPct(s)}
                className={cn('min-h-9 rounded-full border px-3 text-xs', s === downPct ? 'border-[hsl(38_92%_54%)] text-foreground' : 'border-border text-muted-foreground')}>
                {s}%
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-xs text-muted-foreground">{t('homi_card_term', { years })}</legend>
          <div className="flex flex-wrap gap-1.5">
            {TERM_STEPS.map((s) => (
              <button key={s} type="button" onClick={() => setYears(s)}
                className={cn('min-h-9 rounded-full border px-3 text-xs', s === years ? 'border-[hsl(38_92%_54%)] text-foreground' : 'border-border text-muted-foreground')}>
                {t('homi_card_years', { n: s })}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t('homi_card_rate')}
          <input inputMode="decimal" className={FIELD} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="%" />
          <span>{t('homi_card_rate_hint')}</span>
        </label>
      </div>

      <div className="mt-4 rounded-xl bg-[#0C1119] p-4 text-white" aria-live="polite">
        {result ? (
          <>
            <p className="text-xs text-white/70">{t('homi_card_monthly')}</p>
            <p className="text-2xl font-semibold text-[hsl(38_92%_62%)]">{money(result.monthly)}</p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div><dt className="text-white/60">{t('homi_card_loan')}</dt><dd>{money(result.loan)}</dd></div>
              <div><dt className="text-white/60">{t('homi_card_total_interest')}</dt><dd>{money(result.totalInterest)}</dd></div>
            </dl>
            <p className="mt-2 text-[13px] text-white/60">{t('homi_card_mortgage_note')}</p>
          </>
        ) : (
          <p className="text-sm text-white/75">{t('homi_card_mortgage_empty')}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => navigate('/mortgage', { state: { context: result && priceN && rateN !== null
          ? { price: priceN, currency, downPayment: result.downPayment, termMonths: result.months, rate: rateN }
          : {} } })}
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground"
      >
        {t('homi_card_open_mortgage')}
        <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      </button>
    </div>
  );
}

/* ── Rental return, live ─────────────────────────────────────────────── */

const VACANCY_STEPS = [0, 1, 2, 3];

export function HomiRoiCard() {
  const { lang, t } = useLanguage();
  const navigate = useNavigate();
  const [currency, setCurrency] = useState<string>('USD');
  const [price, setPrice] = useState('');
  const [rent, setRent] = useState('');
  const [vacant, setVacant] = useState(1);
  const [expenses, setExpenses] = useState('');

  const priceN = numberOrNull(price);
  const rentN = numberOrNull(rent);
  const expensesN = numberOrNull(expenses) ?? 0;
  const result = useMemo(() => {
    if (!priceN || priceN <= 0 || rentN === null) return null;
    const income = buildIncomeModel({
      currency, purchasePrice: priceN, monthlyRent: rentN, vacantMonthsPerYear: vacant,
      operating: { otherOperatingAnnual: expensesN },
    });
    const noi = income.netOperatingIncome.value;
    const gross = percentOf(income.grossPotentialAnnualIncome.value, priceN, 'gross');
    const net = percentOf(noi, priceN, 'net');
    const payback = paybackYears(priceN, noi, 'payback');
    return { income, noi, gross: gross.value, net: net.value, payback: payback.value };
  }, [currency, priceN, rentN, vacant, expensesN]);

  const money = (v: number) => formatMoney(v, currency, lang, { narrowSymbol: true });

  return (
    <div className={CARD} data-homi-card="ROI_QUICK">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <TrendingUp className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
        {t('homi_card_roi_title')}
      </p>
      <div className="grid gap-3">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t('homi_card_price')}
            <input inputMode="decimal" className={FIELD} value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t('homi_card_currency')}
            <select className={cn(FIELD, 'w-24')} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {QUICK_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t('homi_card_rent')}
          <input inputMode="decimal" className={FIELD} value={rent} onChange={(e) => setRent(e.target.value)} />
        </label>
        <fieldset>
          <legend className="mb-1 text-xs text-muted-foreground">{t('homi_card_vacancy')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {VACANCY_STEPS.map((s) => (
              <button key={s} type="button" onClick={() => setVacant(s)}
                className={cn('min-h-9 rounded-full border px-3 text-xs', s === vacant ? 'border-[hsl(38_92%_54%)] text-foreground' : 'border-border text-muted-foreground')}>
                {t('homi_card_months', { n: s })}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t('homi_card_expenses')}
          <input inputMode="decimal" className={FIELD} value={expenses} onChange={(e) => setExpenses(e.target.value)} />
        </label>
      </div>

      <div className="mt-4 rounded-xl bg-[#0C1119] p-4 text-white" aria-live="polite">
        {result && result.noi !== null ? (
          <>
            <p className="text-xs text-white/70">{t('homi_card_net_monthly')}</p>
            <p className="text-2xl font-semibold text-[hsl(38_92%_62%)]">{money(result.noi / 12)}</p>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-white/60">{t('homi_card_gross_yield')}</dt><dd>{result.gross !== null ? formatPercent(result.gross, lang, 1) : '—'}</dd></div>
              <div><dt className="text-white/60">{t('homi_card_net_yield')}</dt><dd>{result.net !== null ? formatPercent(result.net, lang, 1) : '—'}</dd></div>
              <div><dt className="text-white/60">{t('homi_card_payback')}</dt><dd>{result.payback !== null ? t('homi_card_years', { n: Math.round(result.payback * 10) / 10 }) : '—'}</dd></div>
            </dl>
            <p className="mt-2 text-[13px] text-white/60">{t('homi_card_roi_note')}</p>
          </>
        ) : (
          <p className="text-sm text-white/75">{t('homi_card_roi_empty')}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => navigate('/investment')}
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground"
      >
        {t('homi_card_open_investment')}
        <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Renders a validated list of card refs. Unknown refs render nothing. */
export function HomiCards({ cards, onChip, disabled }: { cards: HomiCardRef[]; onChip: HomiChipHandler; disabled?: boolean }) {
  if (!cards.length) return null;
  return (
    <div className="space-y-3">
      {cards.map((c, i) => {
        const key = `${c.type}:${c.id ?? ''}:${i}`;
        switch (c.type) {
          case 'START': return <HomiStartCard key={key} onChip={onChip} disabled={disabled} />;
          case 'EMPLOYMENT_PICKER': return <HomiEmploymentCard key={key} onChip={onChip} disabled={disabled} />;
          case 'CHECKLIST': return c.id ? <HomiChecklistCard key={key} id={c.id} /> : null;
          case 'MORTGAGE_QUICK': return <HomiMortgageCard key={key} />;
          case 'ROI_QUICK': return <HomiRoiCard key={key} />;
          default: return null;
        }
      })}
    </div>
  );
}
