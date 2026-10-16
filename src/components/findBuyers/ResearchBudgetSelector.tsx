// FIND BUYERS — "Choose Your Research Budget", in credits.
//
// The customer chooses the TOTAL research budget: 100 / 500 / 1,000 / 1,500 / 2,000
// credits or a custom amount (whole credits, at least 100). It is a ceiling, not a
// price: the campaign is charged for what it actually uses and the rest returns to the
// wallet. Credits only — never dollars as the primary unit. More budget buys broader
// coverage, never a promise of more qualified leads (the helper says so).

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, Search, Wallet } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { getBudgetChoices } from '@/services/billing';
import { RESEARCH_MIN_CREDITS, RESEARCH_PRESETS } from '@/services/homatchLeads';
import { validateResearchBudget } from '@/leads/leadSummary';
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, SURFACE } from '@/components/leads/kit';
import { formatCreditsLabel } from '@/components/leads/LeadCard';

export const PRESET_COPY: Record<number, [string, string]> = {
  100: ['rb_preset_100_name', 'rb_preset_100_desc'],
  500: ['rb_preset_500_name', 'rb_preset_500_desc'],
  1000: ['rb_preset_1000_name', 'rb_preset_1000_desc'],
  1500: ['rb_preset_1500_name', 'rb_preset_1500_desc'],
  2000: ['rb_preset_2000_name', 'rb_preset_2000_desc'],
};

export function ResearchBudgetSelector({
  minCredits = RESEARCH_MIN_CREDITS, maxCredits, onRun, running = false, ctaKey = 'rb_cta_start',
}: {
  minCredits?: number;
  maxCredits?: number;
  onRun: (totalCredits: number) => void;
  running?: boolean;
  ctaKey?: string;
}) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [balance, setBalance] = useState<number | null>(null);
  const [presets, setPresets] = useState<number[]>([...RESEARCH_PRESETS]);
  const [chosen, setChosen] = useState<number | 'CUSTOM'>(RESEARCH_PRESETS[0]);
  const [custom, setCustom] = useState('');
  const floor = Math.max(RESEARCH_MIN_CREDITS, minCredits);

  useEffect(() => {
    let alive = true;
    getBudgetChoices('FIND_CLIENTS').then((c) => {
      if (!alive || !c) return;
      setBalance(Number(c.balance ?? 0));
      const fromServer = (c.presets ?? []).map((p) => Number(p.credits)).filter((n) => n >= floor);
      if (fromServer.length) setPresets(fromServer);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [floor]);

  const limits = { min: floor, max: maxCredits ?? 100000, balance };
  const value = chosen === 'CUSTOM' ? custom : chosen;
  const problem = useMemo(() => validateResearchBudget(value, limits), [value, floor, maxCredits, balance]); // eslint-disable-line react-hooks/exhaustive-deps
  const amount = Number(String(value).replace(/[\s,]/g, ''));
  const cr = (n: number) => formatCreditsLabel(n, lang);

  return (
    <section aria-labelledby="rb-title" className="space-y-4" data-testid="research-budget">
      <header>
        <p className={EYEBROW}>{t('rb_eyebrow')}</p>
        <h2 className="mt-1 font-display text-xl font-semibold leading-snug text-[hsl(224_14%_10%)]">{t('rb_headline')}</h2>
        <p className="mt-1 text-sm leading-relaxed text-[hsl(224_14%_28%)]">{t('rb_description')}</p>
      </header>

      <fieldset>
        <legend id="rb-title" className="text-sm font-semibold text-[hsl(224_14%_12%)]">{t('rb_selector_title')}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby="rb-title">
          {presets.map((p) => {
            const [nameKey, descKey] = PRESET_COPY[p] ?? ['rb_custom_name', 'rb_custom_desc'];
            const on = chosen === p;
            const unaffordable = balance != null && p > balance;
            return (
              <button key={p} type="button" role="radio" aria-checked={on} onClick={() => setChosen(p)} data-testid={`rb-preset-${p}`}
                className={cn(SURFACE, 'flex min-h-[5.5rem] items-start gap-3 p-3.5 text-start motion-safe:transition-shadow hover:shadow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]',
                  on && 'border-[hsl(var(--gold-border))] ring-2 ring-[hsl(38_92%_54%)]')}>
                <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                  on ? 'border-[hsl(38_92%_44%)] bg-[hsl(38_92%_54%)]' : 'border-[hsl(var(--border))] bg-white')} aria-hidden="true">
                  {on ? <Check className="h-3.5 w-3.5 text-[#161309]" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-display text-base font-bold tabular-nums" dir="ltr">{t('hl_credits_n', { n: cr(p) })}</span>
                    <span className="text-sm font-semibold text-[hsl(var(--gold-ink))]">{t(nameKey)}</span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-[hsl(224_14%_30%)]">{t(descKey)}</span>
                  {unaffordable ? <span className="mt-1 block text-xs font-medium text-[hsl(0_55%_40%)]">{t('rb_over_balance')}</span> : null}
                </span>
              </button>
            );
          })}
          <div className={cn(SURFACE, 'p-3.5', chosen === 'CUSTOM' && 'border-[hsl(var(--gold-border))] ring-2 ring-[hsl(38_92%_54%)]')}>
            <button type="button" role="radio" aria-checked={chosen === 'CUSTOM'} onClick={() => setChosen('CUSTOM')}
              className="flex w-full items-start gap-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]" data-testid="rb-preset-custom">
              <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                chosen === 'CUSTOM' ? 'border-[hsl(38_92%_44%)] bg-[hsl(38_92%_54%)]' : 'border-[hsl(var(--border))] bg-white')} aria-hidden="true">
                {chosen === 'CUSTOM' ? <Check className="h-3.5 w-3.5 text-[#161309]" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[hsl(var(--gold-ink))]">{t('rb_custom_name')}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-[hsl(224_14%_30%)]">{t('rb_custom_desc')}</span>
              </span>
            </button>
            {chosen === 'CUSTOM' ? (
              <label className="mt-2 block">
                <span className="sr-only">{t('rb_custom_name')}</span>
                <input inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value)} autoFocus
                  placeholder={t('rb_custom_placeholder', { min: cr(floor) })} aria-invalid={problem != null && custom !== ''}
                  className="min-h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 text-base font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]"
                  data-testid="rb-custom-input" />
              </label>
            ) : null}
          </div>
        </div>
      </fieldset>

      <p className="text-xs leading-relaxed text-[hsl(224_14%_30%)]">{t('rb_helper')}</p>
      {balance != null ? (
        <p className="flex items-center gap-1.5 text-xs text-[hsl(224_14%_30%)]"><Wallet className="h-3.5 w-3.5" aria-hidden="true" />{t('hl_bulk_balance', { n: cr(balance) })}</p>
      ) : null}
      {problem && !(chosen === 'CUSTOM' && custom === '') ? (
        <p role="alert" className="text-sm text-[hsl(0_55%_38%)]">{t(`rb_problem_${problem.toLowerCase()}`, { min: cr(floor) })}</p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        {problem === 'OVER_BALANCE' ? (
          <button type="button" className={cn(BTN_PRIMARY, 'sm:flex-1')} onClick={() => navigate('/credits')}>
            <Wallet className="h-4 w-4" aria-hidden="true" />{t('hl_top_up')}
          </button>
        ) : (
          <button type="button" className={cn(BTN_PRIMARY, 'sm:flex-1')} disabled={problem != null || running} onClick={() => onRun(amount)} data-testid="rb-start">
            {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
            {t(ctaKey)}
          </button>
        )}
        <a href="#rb-title" className={cn(BTN_SECONDARY, 'sm:w-auto')}>{t('rb_cta_review')}</a>
      </div>
    </section>
  );
}
