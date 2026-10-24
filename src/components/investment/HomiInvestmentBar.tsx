// HOMATCH INVESTMENT — HOMI beside the numbers.
//
// The investment workspace stays what it is: clicking, not typing. These
// buttons hand the investor's CURRENT figures to HOMI on its own page, with
// one ready question, so the explanation is about their scenario and not a
// generic one. The figures travel as page context; HOMI is told to explain
// them, never to recompute them.

import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { HomiAvatar } from '@/components/homi/HomiAvatar';
import type { StrategyRun } from '@/investment/strategies/run';
import { summarySlots } from '@/investment/strategies/summary';

export function HomiInvestmentBar({ run }: { run: StrategyRun }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const m = run.model;
  const context = {
    type: 'workspace' as const,
    data: {
      surface: 'investment',
      strategy: run.strategy,
      figures: summarySlots(run).map((s) => ({ label: t(s.labelKey), value: s.figure.value, kind: s.kind })),
      inputs: m ? {
        currency: m.currency,
        purchasePrice: m.input.purchasePrice,
        monthlyRent: m.input.monthlyRent ?? null,
        vacantMonthsPerYear: m.input.vacantMonthsPerYear ?? null,
        netOperatingIncomeYear: m.income.netOperatingIncome.value,
        netYieldOnPricePercent: m.yields.netYieldOnPurchasePrice.value,
        cashOnCashPercent: m.yields.cashOnCashReturn.value,
      } : null,
      note: 'Figures come from the HOMATCH investment calculator. Explain them; do not recompute or invent market data or returns.',
    },
  };
  const ask = (key: string) => navigate('/ai', { state: { context, prompt: t(key) } });

  return (
    <div className="hm-invest-panel flex flex-wrap items-center gap-3 p-4">
      <HomiAvatar state="explaining" crop="upper" size={48} />
      <p className="min-w-0 flex-1 text-sm text-foreground">{t('inv_homi_lead')}</p>
      <div className="flex flex-wrap gap-2">
        {['inv_homi_explain', 'inv_homi_decide', 'inv_homi_changes'].map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => ask(key)}
            className="inline-flex min-h-11 items-center rounded-full border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-4 text-sm font-medium text-[hsl(var(--gold-ink))] transition-colors hover:bg-[hsl(var(--gold))] hover:text-[hsl(var(--primary-foreground))]"
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}
