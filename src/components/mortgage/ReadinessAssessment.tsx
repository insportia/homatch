import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, ChevronDown, RotateCcw, ExternalLink } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/components/workspace/primitives';
import { ChoiceField, YesNoField } from '@/components/workspace/controls';
import { AskHomatch } from '@/components/mortgage/askConsultant';
import { HomiAvatar } from '@/components/homi/HomiAvatar';
import { HomiChecklistCard } from '@/components/homi/HomiCards';
import type { LtvLimitRuleData, MortgageInput, MortgageRule, PtiLimitRuleData } from '@/mortgage/types';
export type { ReadinessAnswers } from '@/mortgage/readiness';
import {
  EMPTY_ANSWERS as EMPTY, toReadinessInput, type ReadinessAnswers,
  assessReadiness, bandThresholdFor, CREDIT_HISTORY, INCOME_HISTORY, INCOME_SOURCES, RESIDENCY, readinessScenarios,
  type CreditHistory, type IncomeHistory, type IncomeSource, type ReadinessResult, type Residency,
} from '@/mortgage/readiness';
import { classifyCurrency, ptiCurrencyClass } from '@/mortgage/rules/ptiLtv';

/*
 * MORTGAGE READINESS — the guided, optional part of the consultant.
 *
 * Collapsed behind one button so the calculator above stays the first
 * screen. Seven short steps, one at a time, answered by tapping wherever a
 * tap will do. Everything stays on this device (localStorage), never sent
 * anywhere except as the consultant's context when the person asks HOMI.
 *
 * The result is a READINESS assessment against published rules: never a bank
 * decision, never an approval percentage. That sentence is always on screen.
 */


const KEY = 'homatch.mortgage.readiness.v1';

function load(): ReadinessAnswers {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return raw && typeof raw === 'object' ? { ...EMPTY, ...raw } : EMPTY;
  } catch { return EMPTY; }
}

const num = (v: string): number | null => {
  const n = Number(v.replace(/[\s,]/g, ''));
  return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};


const STEPS = ['income', 'source', 'debt', 'co', 'collateral', 'situation', 'credit'] as const;
type Step = typeof STEPS[number];

function MoneyInput({ id, value, onChange, currency, labelKey }: { id: string; value: number | null; onChange: (v: number | null) => void; currency: string; labelKey: string }) {
  const { t } = useLanguage();
  const [text, setText] = useState(value === null ? '' : String(value));
  return (
    <label htmlFor={id} className="grid gap-1.5 text-sm text-muted-foreground">
      {t(labelKey)}
      <span className="flex items-center gap-2">
        <input
          id={id}
          inputMode="decimal"
          value={text}
          onChange={(e) => { setText(e.target.value); onChange(num(e.target.value)); }}
          className="h-11 w-full max-w-xs rounded-xl border border-border bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]"
        />
        <span className="text-sm font-medium text-foreground">{currency}</span>
      </span>
    </label>
  );
}

const STATUS_ICON = {
  OK: <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />,
  ATTENTION: <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />,
  NOT_MET: <XCircle className="h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />,
  UNKNOWN: <HelpCircle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />,
};

export function ReadinessAssessment({
  input, ptiRules, ltvRules, onResult,
}: {
  input: MortgageInput | null;
  ptiRules: MortgageRule<PtiLimitRuleData>[];
  ltvRules: MortgageRule<LtvLimitRuleData>[];
  /** Reports the latest result (or null) so the consultant can explain it. */
  onResult?: (result: { answers: ReadinessAnswers; result: ReadinessResult } | null) => void;
}) {
  const { t, lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<ReadinessAnswers>(load);
  const [step, setStep] = useState<number>(0);
  const [done, setDone] = useState(() => load().income !== null && load().credit !== null);

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(answers)); } catch { /* storage unavailable */ } }, [answers]);
  const set = <K extends keyof ReadinessAnswers>(k: K, v: ReadinessAnswers[K]) => setAnswers((a) => ({ ...a, [k]: v }));

  const currency = input?.propertyCurrency ?? 'GEL';
  const foreign = classifyCurrency(currency) === 'FOREIGN';
  const money = (v: number) => formatMoney(v, currency, lang, { narrowSymbol: true });
  const band = bandThresholdFor(ptiRules, ptiCurrencyClass(currency, answers.incomeInLoanCurrency ?? undefined));

  const rInput = input ? toReadinessInput(answers, input) : null;
  const result = useMemo(() => (rInput && done ? assessReadiness(rInput, ptiRules, ltvRules) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(rInput), done, ptiRules, ltvRules]);
  const scenarios = useMemo(() => (rInput && result && result.tier !== 'INCOMPLETE' ? readinessScenarios(rInput, ptiRules, ltvRules) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result]);

  useEffect(() => { onResult?.(result ? { answers, result } : null); }, [result, answers, onResult]);

  if (!input) return null;

  const current: Step = STEPS[step];
  const canNext = current === 'income' ? answers.income !== null && answers.income > 0
      && (!foreign || (answers.incomeInLoanCurrency !== null && answers.incomeAtLeastBand !== null))
    : current === 'source' ? answers.source !== null && answers.history !== null
    : current === 'debt' ? answers.hasDebt === false || (answers.hasDebt === true && answers.debt !== null)
    : current === 'co' ? answers.hasCoBorrower === false || (answers.hasCoBorrower === true && answers.coIncome !== null)
    : current === 'collateral' ? answers.hasCollateral === false || (answers.hasCollateral === true && answers.collateral !== null)
    : current === 'situation' ? answers.residency !== null && answers.hasGuarantor !== null && answers.costsKnown !== null
    : answers.credit !== null;

  const next = () => { if (step < STEPS.length - 1) setStep(step + 1); else { setDone(true); } };

  const tierText: Record<ReadinessResult['tier'], string> = {
    HIGH: t('mortgage_rd_tier_high'), MEDIUM: t('mortgage_rd_tier_medium'),
    CONDITIONS: t('mortgage_rd_tier_conditions'), INCOMPLETE: t('mortgage_rd_tier_incomplete'),
  };
  const tierTone: Record<ReadinessResult['tier'], string> = {
    HIGH: 'border-emerald-300 bg-emerald-50 text-emerald-900',
    MEDIUM: 'border-amber-300 bg-amber-50 text-amber-900',
    CONDITIONS: 'border-rose-300 bg-rose-50 text-rose-900',
    INCOMPLETE: 'border-border bg-secondary text-foreground',
  };

  return (
    <section id="readiness" className="hm-workspace-panel scroll-mt-24 p-5 sm:p-7" aria-labelledby="readiness-title">
      <header className="flex flex-wrap items-start gap-4">
        <HomiAvatar state={!open ? 'idle' : done ? (result?.tier === 'HIGH' ? 'happy' : result?.tier === 'CONDITIONS' ? 'encouraging' : 'explaining') : 'listening'} crop="upper" size={64} />
        <div className="min-w-0 flex-1">
          <h2 id="readiness-title" className="font-display text-xl font-semibold leading-tight text-foreground">{t('mortgage_rd_title')}</h2>
          <p className="mt-1.5 max-w-[60ch] text-sm text-muted-foreground">{t('mortgage_rd_intro')}</p>
        </div>
      </header>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-5 inline-flex min-h-12 items-center rounded-full bg-[hsl(var(--gold))] px-6 text-[15px] font-semibold text-[hsl(var(--primary-foreground))]"
        >
          {t('mortgage_rd_cta')}
        </button>
      ) : !done ? (
        <div className="mt-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label={t('mortgage_rd_step', { n: step + 1, total: STEPS.length })}>
              <div className="h-full bg-[hsl(var(--gold))] transition-[width] motion-reduce:transition-none" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
            </div>
            <span className="text-xs text-muted-foreground">{t('mortgage_rd_step', { n: step + 1, total: STEPS.length })}</span>
          </div>

          <div className="grid gap-5">
            {current === 'income' && (
              <>
                <MoneyInput id="rd-income" value={answers.income} onChange={(v) => set('income', v)} currency={currency} labelKey="mortgage_rd_q_income" />
                {foreign && (
                  <>
                    <div className="grid gap-2">
                      <p id="rd-hedged" className="text-sm text-foreground">{t('mortgage_rd_q_same_currency', { currency })}</p>
                      <YesNoField labelledBy="rd-hedged" value={answers.incomeInLoanCurrency === null ? undefined : answers.incomeInLoanCurrency ? 'YES' : 'NO'} onChange={(v) => set('incomeInLoanCurrency', v === null ? null : v === 'YES')} />
                    </div>
                    {band !== null && (
                      <div className="grid gap-2">
                        <p id="rd-band" className="text-sm text-foreground">{t('mortgage_rd_q_band', { amount: band.toLocaleString(lang) })}</p>
                        <YesNoField labelledBy="rd-band" value={answers.incomeAtLeastBand === null ? undefined : answers.incomeAtLeastBand ? 'YES' : 'NO'} onChange={(v) => set('incomeAtLeastBand', v === null ? null : v === 'YES')} />
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {current === 'source' && (
              <>
                <div className="grid gap-2">
                  <p id="rd-source" className="text-sm font-medium text-foreground">{t('mortgage_rd_q_source')}</p>
                  <ChoiceField labelledBy="rd-source" value={answers.source ?? undefined}
                    options={INCOME_SOURCES.map((s) => ({ value: s, labelKey: `mortgage_rd_src_${s.toLowerCase()}` }))}
                    onChange={(v) => set('source', v as IncomeSource | null)} />
                </div>
                <div className="grid gap-2">
                  <p id="rd-history" className="text-sm font-medium text-foreground">{t('mortgage_rd_q_history')}</p>
                  <ChoiceField labelledBy="rd-history" value={answers.history ?? undefined}
                    options={INCOME_HISTORY.map((h) => ({ value: h, labelKey: `mortgage_rd_hist_${h.toLowerCase()}` }))}
                    onChange={(v) => set('history', v as IncomeHistory | null)} />
                </div>
              </>
            )}

            {current === 'debt' && (
              <div className="grid gap-3">
                <p id="rd-debt" className="text-sm font-medium text-foreground">{t('mortgage_rd_q_debt')}</p>
                <YesNoField labelledBy="rd-debt" value={answers.hasDebt === null ? undefined : answers.hasDebt ? 'YES' : 'NO'} onChange={(v) => set('hasDebt', v === null ? null : v === 'YES')} />
                {answers.hasDebt && <MoneyInput id="rd-debt-amt" value={answers.debt} onChange={(v) => set('debt', v)} currency={currency} labelKey="mortgage_rd_q_debt_amount" />}
              </div>
            )}

            {current === 'co' && (
              <div className="grid gap-3">
                <p id="rd-co" className="text-sm font-medium text-foreground">{t('mortgage_rd_q_co')}</p>
                <YesNoField labelledBy="rd-co" value={answers.hasCoBorrower === null ? undefined : answers.hasCoBorrower ? 'YES' : 'NO'} onChange={(v) => set('hasCoBorrower', v === null ? null : v === 'YES')} />
                {answers.hasCoBorrower && (
                  <>
                    <MoneyInput id="rd-co-inc" value={answers.coIncome} onChange={(v) => set('coIncome', v)} currency={currency} labelKey="mortgage_rd_q_co_income" />
                    <MoneyInput id="rd-co-debt" value={answers.coDebt} onChange={(v) => set('coDebt', v)} currency={currency} labelKey="mortgage_rd_q_co_debt" />
                  </>
                )}
                <Explainer q="mortgage_rd_x_co_q" a="mortgage_rd_x_co_a" />
              </div>
            )}

            {current === 'collateral' && (
              <div className="grid gap-3">
                <p id="rd-col" className="text-sm font-medium text-foreground">{t('mortgage_rd_q_collateral')}</p>
                <YesNoField labelledBy="rd-col" value={answers.hasCollateral === null ? undefined : answers.hasCollateral ? 'YES' : 'NO'} onChange={(v) => set('hasCollateral', v === null ? null : v === 'YES')} />
                {answers.hasCollateral && <MoneyInput id="rd-col-val" value={answers.collateral} onChange={(v) => set('collateral', v)} currency={currency} labelKey="mortgage_rd_q_collateral_value" />}
                <p className="text-sm text-muted-foreground">{t('mortgage_rd_collateral_note')}</p>
              </div>
            )}

            {current === 'situation' && (
              <div className="grid gap-5">
                <div className="grid gap-2">
                  <p id="rd-res" className="text-sm font-medium text-foreground">{t('mortgage_rd_q_residency')}</p>
                  <ChoiceField labelledBy="rd-res" value={answers.residency ?? undefined}
                    options={RESIDENCY.map((r) => ({ value: r, labelKey: `mortgage_rd_res_${r.toLowerCase()}` }))}
                    onChange={(v) => set('residency', v as Residency | null)} />
                </div>
                <div className="grid gap-2">
                  <p id="rd-guar" className="text-sm font-medium text-foreground">{t('mortgage_rd_q_guarantor')}</p>
                  <YesNoField labelledBy="rd-guar" value={answers.hasGuarantor === null ? undefined : answers.hasGuarantor ? 'YES' : 'NO'} onChange={(v) => set('hasGuarantor', v === null ? null : v === 'YES')} />
                </div>
                <div className="grid gap-2">
                  <p id="rd-costs" className="text-sm font-medium text-foreground">{t('mortgage_rd_q_costs')}</p>
                  <YesNoField labelledBy="rd-costs" value={answers.costsKnown === null ? undefined : answers.costsKnown ? 'YES' : 'NO'} onChange={(v) => set('costsKnown', v === null ? null : v === 'YES')} />
                  <p className="text-sm text-muted-foreground">{t('mortgage_rd_costs_note')}</p>
                </div>
              </div>
            )}

            {current === 'credit' && (
              <div className="grid gap-2">
                <p id="rd-credit" className="text-sm font-medium text-foreground">{t('mortgage_rd_q_credit')}</p>
                <ChoiceField labelledBy="rd-credit" value={answers.credit ?? undefined}
                  options={CREDIT_HISTORY.map((c) => ({ value: c, labelKey: `mortgage_rd_credit_${c.toLowerCase()}` }))}
                  onChange={(v) => set('credit', v as CreditHistory | null)} />
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm font-medium text-foreground">
                {t('mortgage_rd_back')}
              </button>
            )}
            <button
              type="button"
              aria-disabled={!canNext}
              onClick={() => { if (canNext) next(); }}
              className={cn('inline-flex min-h-11 items-center rounded-full px-6 text-sm font-semibold',
                canNext ? 'bg-[hsl(var(--gold))] text-[hsl(var(--primary-foreground))]' : 'cursor-not-allowed bg-muted text-muted-foreground')}
            >
              {step < STEPS.length - 1 ? t('mortgage_rd_next') : t('mortgage_rd_finish')}
            </button>
          </div>
        </div>
      ) : result ? (
        <ResultView result={result} scenarios={scenarios} answers={answers} currency={currency} money={money}
          tierText={tierText[result.tier]} tierTone={tierTone[result.tier]}
          onEdit={() => { setDone(false); setStep(0); }}
          onReset={() => { setAnswers(EMPTY); setDone(false); setStep(0); }} />
      ) : null}
    </section>
  );
}

function Explainer({ q, a }: { q: string; a: string }) {
  const { t } = useLanguage();
  return (
    <details className="group rounded-xl border border-border bg-background px-4">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-foreground">
        {t(q)}
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <p className="pb-4 text-sm leading-relaxed text-muted-foreground">{t(a)}</p>
    </details>
  );
}

function ResultView({
  result, scenarios, answers, currency, money, tierText, tierTone, onEdit, onReset,
}: {
  result: ReadinessResult;
  scenarios: ReturnType<typeof readinessScenarios>;
  answers: ReadinessAnswers;
  currency: string;
  money: (v: number) => string;
  tierText: string;
  tierTone: string;
  onEdit: () => void;
  onReset: () => void;
}) {
  const { t, lang } = useLanguage();
  const pct = (v: number | null) => (v === null ? '' : `${v.toLocaleString(lang, { maximumFractionDigits: 1 })}%`);
  const checkText = (key: string, status: string, vars: Record<string, string | number> = {}) => {
    const v = { ...vars, pti: pct(vars.pti as number ?? null), limit: pct(vars.limit as number ?? null), ltv: pct(vars.ltv as number ?? null), withCollateral: pct(vars.withCollateral as number ?? null) };
    /* Over the limit on the property alone, within it once extra collateral counts. */
    if (key === 'LTV' && status === 'ATTENTION' && vars.withCollateral !== undefined) return t('mortgage_rd_check_ltv_collateral', v);
    return t(`mortgage_rd_check_${key.toLowerCase()}_${status.toLowerCase()}`, v);
  };
  const profile = answers.source ?? 'SALARIED';

  return (
    <div className="mt-6 grid gap-6">
      <div className={cn('rounded-2xl border p-5', tierTone)}>
        <p className="text-sm font-semibold uppercase tracking-[0.08em]">{t('mortgage_rd_result_label')}</p>
        <p className="mt-1 font-display text-2xl font-semibold">{tierText}</p>
        <p className="mt-2 text-sm">{t('mortgage_rd_no_probability')}</p>
      </div>

      <div>
        <h3 className="mb-3 text-base font-semibold text-foreground">{t('mortgage_rd_factors_title')}</h3>
        <ul className="grid gap-2.5">
          {result.checks.map((c) => (
            <li key={c.key} className="flex items-start gap-3 rounded-xl border border-border bg-background p-3.5">
              {STATUS_ICON[c.status]}
              <span className="text-sm leading-relaxed text-foreground">{checkText(c.key, c.status, c.vars)}</span>
            </li>
          ))}
        </ul>
        {result.ptiRule && (
          <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {t('mortgage_rd_source', {
              authority: /National Bank of Georgia/i.test(result.ptiRule.authority) ? t('mortgage_rd_nbg') : result.ptiRule.authority,
              date: new Date(`${result.ptiRule.verifiedAt}T12:00:00Z`).toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' }),
            })}
            <a href={result.ptiRule.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-[hsl(var(--gold-ink))] underline">
              {t('mortgage_rd_source_link')} <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </p>
        )}
      </div>

      {result.maxLoan !== null && result.maxPayment !== null && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-background p-4">
            <p className="text-sm text-muted-foreground">{t('mortgage_rd_max_loan_title')}</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{money(result.maxLoan)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('mortgage_rd_max_loan_note', { payment: money(result.maxPayment) })}</p>
          </div>
          <div className="rounded-2xl border border-border bg-background p-4">
            <p className="text-sm text-muted-foreground">{t('mortgage_rd_payment_title')}</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{money(result.monthlyPayment)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('mortgage_rd_payment_note', { pti: pct(result.ptiPercent) })}</p>
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-3 text-base font-semibold text-foreground">{t('mortgage_rd_gaps_title')}</h3>
        {result.gaps.length ? (
          <ul className="grid gap-2">
            {result.gaps.map((g) => (
              <li key={g.key} className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-900">
                {t(`mortgage_rd_gap_${g.key.toLowerCase()}`, { amount: money(g.amount) })}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-900">{t('mortgage_rd_gaps_none')}</p>
        )}
      </div>

      {scenarios.length > 1 && (
        <div>
          <h3 className="mb-1 text-base font-semibold text-foreground">{t('mortgage_rd_compare_title')}</h3>
          <p className="mb-3 text-sm text-muted-foreground">{t('mortgage_rd_improve_sub')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {scenarios.map((s) => {
              const r = s.result;
              const ok = !r.checks.some((c) => c.status === 'NOT_MET');
              return (
                <div key={s.key} className={cn('rounded-2xl border p-4', s.key === 'AS_ENTERED' ? 'border-[hsl(var(--gold-border))]' : 'border-border', 'bg-background')}>
                  <p className="text-sm font-semibold text-foreground">{t(`mortgage_rd_sc_${s.key.toLowerCase()}`, Object.fromEntries(Object.entries(s.vars).map(([k, v]) => [k, k === 'years' ? v : money(v)])))}</p>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div><dt className="text-muted-foreground">{t('mortgage_rd_sc_payment')}</dt><dd className="font-medium text-foreground">{money(r.monthlyPayment)}</dd></div>
                    <div><dt className="text-muted-foreground">{t('mortgage_rd_sc_pti')}</dt><dd className="font-medium text-foreground">{pct(r.ptiPercent)}</dd></div>
                    {/* With extra collateral a bank may count it: show that figure, so "without the collateral" has something to compare against. */}
                    <div><dt className="text-muted-foreground">{t('mortgage_rd_sc_ltv')}</dt><dd className="font-medium text-foreground">{pct(r.ltvWithCollateralPercent ?? r.ltvPercent)}</dd></div>
                  </dl>
                  <p className={cn('mt-2 text-xs font-medium', ok ? 'text-emerald-700' : 'text-rose-700')}>
                    {ok ? t('mortgage_rd_sc_ok') : t('mortgage_rd_sc_not_ok')}
                  </p>
                  {s.key === 'NO_COLLATERAL' && <p className="mt-1 text-xs text-muted-foreground">{t('mortgage_rd_collateral_note')}</p>}
                  {s.key === 'WITH_CO_BORROWER' && <p className="mt-1 text-xs text-muted-foreground">{t('mortgage_rd_with_co_note')}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-base font-semibold text-foreground">{t('mortgage_rd_profile_title')}</h3>
        <p className="mb-3 text-sm leading-relaxed text-muted-foreground">{t(`mortgage_rd_profile_${profile.toLowerCase()}`)}</p>
        <HomiChecklistCard id={`mortgage_docs_${profile.toLowerCase()}`} />
      </div>

      <div className="grid gap-2">
        <h3 className="text-base font-semibold text-foreground">{t('mortgage_rd_learn_title')}</h3>
        <Explainer q="mortgage_rd_x_co_q" a="mortgage_rd_x_co_a" />
        <Explainer q="mortgage_rd_x_guarantor_q" a="mortgage_rd_x_guarantor_a" />
        <Explainer q="mortgage_rd_x_self_q" a="mortgage_rd_x_self_a" />
        <Explainer q="mortgage_rd_x_valuation_q" a="mortgage_rd_x_valuation_a" />
      </div>

      <div>
        <h3 className="mb-2 text-base font-semibold text-foreground">{t('mortgage_rd_steps_title')}</h3>
        <ol className="grid list-decimal gap-1.5 ps-5 text-sm leading-relaxed text-foreground">
          {[1, 2, 3, 4, 5].map((n) => <li key={n}>{t(`mortgage_rd_steps_${n}`)}</li>)}
        </ol>
      </div>

      <div>
        <h3 className="mb-2 text-base font-semibold text-foreground">{t('mortgage_rd_ask_title')}</h3>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <AskHomatch key={n} question={t(`mortgage_rd_ask_${n}`)} label={t(`mortgage_rd_ask_${n}`)} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onEdit} className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm font-medium text-foreground">
          {t('mortgage_rd_edit')}
        </button>
        <button type="button" onClick={onReset} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm text-muted-foreground">
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> {t('mortgage_rd_reset')}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{t('mortgage_rd_privacy')}</p>
      <p className="sr-only">{currency}</p>
    </div>
  );
}
