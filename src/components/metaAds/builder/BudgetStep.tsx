// BUDGET + DURATION, and the money summary.
//
// The browser never computes the fee. Totals come from plan_preview on the
// server (computeTotals with meta_ads_fee_percent); while a new value is
// being priced the summary says so instead of showing a stale number.
import React, { useEffect, useState } from 'react';
import { Info, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { money, type MetaCampaignRow, type MetaStatus, type StrategyPreview } from '@/services/metaAds';
import { parseDailyCents, parseDays } from './steps';
import { StepShell } from './ui';
import { StrategyCard } from './StrategyCard';
import { FundingCard } from './FundingCard';
import { LearningCard } from './FinishKit';

export interface Totals { mediaCents: number; feeCents: number; totalCents: number; feePercent: number }

export function BudgetStep({ campaign, status, patch, totals, pricing, strategy = null, strategyLoading = false, strategyFailed = false }: {
  campaign: MetaCampaignRow; status: MetaStatus | null;
  patch: (p: Partial<MetaCampaignRow>) => void; totals: Totals | null; pricing: boolean;
  /** strategy_preview: the plan this budget buys and what it needs from the balance. */
  strategy?: StrategyPreview | null; strategyLoading?: boolean; strategyFailed?: boolean;
}) {
  const { t } = useLanguage();
  const minDays = Math.max(2, status?.settings.minDurationDays ?? 2);
  const minDaily = status?.settings.minDailyCents ?? 200;
  const [daily, setDaily] = useState(String((campaign.daily_budget_cents ?? 500) / 100));
  const [days, setDays] = useState(String(campaign.duration_days ?? 7));
  useEffect(() => { setDaily(String((campaign.daily_budget_cents ?? 500) / 100)); }, [campaign.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDays(String(campaign.duration_days ?? 7)); }, [campaign.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dailyCents = parseDailyCents(daily);
  const dailyError = dailyCents === null ? 'madsb_budget_invalid' : dailyCents < minDaily ? 'madsb_budget_below_min' : null;
  const parsedDays = parseDays(days, minDays);
  const daysError = parsedDays.tooShort ? 'madsb_days_below_min' : parsedDays.days === null ? 'madsb_days_invalid' : null;

  return (
    <StepShell eyebrow={t('madsb_step_budget')} title={t('madsb_budget_title')} lead={t('madsb_budget_lead')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-foreground">{t('mads_budget_daily')}</span>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold" dir="ltr">$</span>
            <Input inputMode="decimal" dir="ltr" value={daily} aria-invalid={!!dailyError}
              onChange={(e) => {
                setDaily(e.target.value);
                const c = parseDailyCents(e.target.value);
                if (c !== null && c >= minDaily) patch({ daily_budget_cents: c });
              }} />
          </div>
          <span className={`mt-1 block text-2xs ${dailyError ? 'text-destructive' : 'text-muted-foreground'}`}>
            {t(dailyError ?? 'madsb_budget_min_hint', { min: money(minDaily) })}
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-foreground">{t('mads_budget_days')}</span>
          <Input inputMode="numeric" dir="ltr" value={days} aria-invalid={!!daysError}
            onChange={(e) => {
              setDays(e.target.value);
              const d = parseDays(e.target.value, minDays);
              if (d.days !== null) patch({ duration_days: d.days });
            }} />
          <span className={`mt-1 block text-2xs ${daysError ? 'text-destructive' : 'text-muted-foreground'}`}>
            {t(daysError ?? 'madsb_days_min_hint', { min: String(minDays) })}
          </span>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        {[5, 10, 20].map((v) => (
          <button key={v} type="button" dir="ltr"
            onClick={() => { setDaily(String(v)); patch({ daily_budget_cents: v * 100 }); }}
            className="rounded-full border border-border px-3 py-1 text-[13px] text-muted-foreground hover:border-[hsl(var(--gold-border))]">${v}/{t('madsb_per_day_short')}</button>
        ))}
        {[3, 7, 14, 30].map((v) => (
          <button key={`d${v}`} type="button"
            onClick={() => { setDays(String(v)); patch({ duration_days: v }); }}
            className="rounded-full border border-border px-3 py-1 text-[13px] text-muted-foreground hover:border-[hsl(var(--gold-border))]">{t('madsb_n_days', { n: String(v) })}</button>
        ))}
      </div>
      <FinancialSummary totals={totals} pricing={pricing} billing={status?.settings.budgetBilling} />
      <StrategyCard preview={strategy} loading={strategyLoading} failed={strategyFailed} />
      <FundingCard funding={strategy?.funding ?? null} loading={strategyLoading}
        currency={campaign.currency || status?.wallet?.currency || 'USD'} billing={status?.settings.budgetBilling} />
      <LearningCard compact />
    </StepShell>
  );
}

/** The premium money card, used in the budget step, the side rail and review. */
export function FinancialSummary({ totals, pricing, compact, billing }: {
  totals: Totals | null; pricing: boolean; compact?: boolean;
  /* Who pays Meta for the budget. The default (the customer's own ad
     account) is said plainly: Meta bills that account, HOMATCH never holds it. */
  billing?: 'CUSTOMER_AD_ACCOUNT' | 'HOMATCH_WALLET';
}) {
  const { t } = useLanguage();
  const viaWallet = billing === 'HOMATCH_WALLET';
  return (
    <div className="overflow-hidden rounded-2xl bg-[#0C1119] text-white shadow-hover ring-1 ring-[hsl(38_60%_40%)]/25">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 sm:px-5 py-3">
        <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(38_92%_60%)]">{t('madsb_money_title')}</p>
        {pricing && <span className="inline-flex items-center gap-1.5 text-2xs text-white/60"><Loader2 className="h-3 w-3 animate-spin" />{t('madsb_money_pricing')}</span>}
      </div>
      {!totals ? (
        <div className="px-4 sm:px-5 py-5 text-sm text-white/60">{t('madsb_money_pending')}</div>
      ) : (
        <dl className={`space-y-3 px-4 sm:px-5 py-4 tabular-nums ${pricing ? 'opacity-60' : ''}`}>
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="min-w-0 text-sm font-medium text-white/90">{t('madsb_money_media')}</dt>
              <dd className="shrink-0 whitespace-nowrap text-base font-semibold" dir="ltr">{money(totals.mediaCents)}</dd>
            </div>
            {!compact && <p className="mt-0.5 text-2xs leading-relaxed text-white/55">{t(viaWallet ? 'madsb_money_media_d' : 'madsb_money_media_d_customer')}</p>}
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="min-w-0 text-sm font-medium text-white/90">{t('madsb_money_fee', { pct: String(totals.feePercent) })}</dt>
              <dd className="shrink-0 whitespace-nowrap text-base font-semibold" dir="ltr">{money(totals.feeCents)}</dd>
            </div>
            {!compact && <p className="mt-0.5 text-2xs leading-relaxed text-white/55">{t('mm_b_money_fee_d')}</p>}
          </div>
          {/* The one number HOMATCH itself takes now. With the customer's own
              ad account that is the fee alone — Meta bills the budget to that
              account directly, so it is never added to what HOMATCH charges. */}
          <div className="border-t border-white/10 pt-3">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="min-w-0 text-sm font-semibold text-white">{t('madsb_charged_now')}</dt>
              <dd className="shrink-0 whitespace-nowrap text-2xl font-bold text-[hsl(38_92%_62%)]" dir="ltr" data-charged-now="">
                {money(viaWallet ? totals.totalCents : totals.feeCents)}
              </dd>
            </div>
            {!viaWallet && (
              <p className="mt-1 text-2xs leading-relaxed text-white/60">
                {t('madsb_money_meta_bills', { amount: money(totals.mediaCents) })}
              </p>
            )}
          </div>
        </dl>
      )}
      {!compact && (
        <p className="flex items-start gap-2 border-t border-white/10 bg-white/[0.03] px-4 sm:px-5 py-3 text-2xs leading-relaxed text-white/60">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t(viaWallet ? 'madsb_money_note' : 'madsb_money_note_customer')}
        </p>
      )}
    </div>
  );
}
