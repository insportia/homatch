// FUNDING — what this campaign needs from the HOMATCH service balance.
//
// Every number is the server's (strategy_preview → fundingPlan with the
// customer's own fee percent). The browser never computes a fee; it only
// rounds a server-computed shortfall up for the Add-funds button.
import React, { useState } from 'react';
import { Info, Loader2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './MetaButton';
import { useLanguage } from '@/contexts/LanguageContext';
import { depositCheckout, moneyIn, type FundingRow } from '@/services/metaAds';
import { depositAmountCents } from './masterLogic';

export function FundingCard({ funding, currency, billing, loading }: {
  funding: FundingRow | null; currency: string; loading: boolean;
  billing?: 'CUSTOMER_AD_ACCOUNT' | 'HOMATCH_WALLET';
}) {
  const { t, lang } = useLanguage();
  const [busy, setBusy] = useState(false);
  const fmt = (c: number) => moneyIn(c, currency, lang);
  const viaWallet = billing === 'HOMATCH_WALLET';
  const addCents = funding ? depositAmountCents(funding.shortfallCents) : 0;
  /* 0% on the customer's own ad account (server-decided): HOMATCH holds
     nothing, so there is no balance to show, top up or disclose. */
  const exempt = !!funding && !viaWallet && Number(funding.feePercent) === 0;

  const addFunds = async () => {
    if (addCents <= 0) return;
    setBusy(true);
    try {
      const { url } = await depositCheckout(addCents);
      window.location.assign(url);
    } catch {
      toast.error(t('mm_b_funding_checkout_failed'));
      setBusy(false);
    }
  };

  return (
    <section data-mm-funding="" data-mm-field="funding" aria-labelledby="mm-b-funding" className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <h3 id="mm-b-funding" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Wallet className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden />{t('mm_b_funding_title')}
        </h3>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label={t('mm_b_strategy_updating')} />}
      </div>
      <div className="space-y-3 px-4 py-4 sm:px-5" aria-live="polite">
        {!funding ? (
          <p className="text-sm text-muted-foreground">{t(loading ? 'mm_b_strategy_loading' : 'mm_b_funding_pending')}</p>
        ) : (
          <>
            {exempt ? (
              <div data-mm-funding-exempt="" className="space-y-2">
                <dl className={`space-y-2 text-sm tabular-nums ${loading ? 'opacity-60' : ''}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="min-w-0 text-muted-foreground">{t('mm_b_funding_planned')}</dt>
                    <dd className="shrink-0 whitespace-nowrap font-medium text-foreground" dir="ltr">{fmt(funding.plannedMediaCents)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="min-w-0 text-muted-foreground">{t('mm_b_funding_fee', { pct: String(funding.feePercent) })}</dt>
                    <dd className="shrink-0 whitespace-nowrap font-semibold text-foreground" dir="ltr">{fmt(funding.requiredCents)}</dd>
                  </div>
                </dl>
                <p className="text-[13px] leading-relaxed text-[hsl(152_54%_26%)]">{t('mm_b_funding_exempt')}</p>
              </div>
            ) : (<>
            <dl className={`space-y-2 text-sm tabular-nums ${loading ? 'opacity-60' : ''}`}>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 text-muted-foreground">{t('mm_b_funding_planned')}</dt>
                <dd className="shrink-0 whitespace-nowrap font-medium text-foreground" dir="ltr">{fmt(funding.plannedMediaCents)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 text-muted-foreground">{t('mm_b_funding_fee', { pct: String(funding.feePercent) })}</dt>
                <dd className="shrink-0 whitespace-nowrap font-semibold text-foreground" dir="ltr">{fmt(funding.requiredCents)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 text-muted-foreground">{t('mm_b_funding_available')}</dt>
                <dd className="shrink-0 whitespace-nowrap font-medium text-foreground" dir="ltr">{fmt(funding.availableCents)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
                <dt className="min-w-0 font-semibold text-foreground">{t('mm_b_funding_shortfall')}</dt>
                <dd className={`shrink-0 whitespace-nowrap text-base font-bold ${funding.shortfallCents > 0 ? 'text-[hsl(32_78%_32%)]' : 'text-[hsl(152_54%_28%)]'}`} dir="ltr">
                  {fmt(funding.shortfallCents)}
                </dd>
              </div>
            </dl>
            {funding.shortfallCents > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={addFunds} disabled={busy}
                  className="gap-1.5 bg-[hsl(var(--gold))] font-bold text-[#161309] hover:bg-[hsl(var(--gold-hover))]">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t('mm_b_funding_add', { amount: fmt(addCents) })}
                </Button>
                {addCents > funding.shortfallCents && <span className="text-2xs text-muted-foreground">{t('mm_b_funding_min_note', { amount: fmt(addCents) })}</span>}
              </div>
            ) : (
              <p className="text-[13px] text-[hsl(152_54%_26%)]">{t('mm_b_funding_covered')}</p>
            )}
            {!viaWallet && <p className="text-2xs leading-relaxed text-muted-foreground">{t('mm_b_funding_meta_bills')}</p>}
            </>)}
          </>
        )}
        {!exempt && <p data-mm-disclosure="" className="flex items-start gap-2 rounded-xl bg-[hsl(var(--secondary))]/50 px-3 py-2.5 text-2xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{t('mm_b_funding_disclosure')}
        </p>}
      </div>
    </section>
  );
}
