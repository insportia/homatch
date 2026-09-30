// HOMATCH SMART STRATEGY — what the strategy engine will build, in plain
// words. Every number comes from strategy_preview; every sentence of the
// explanation is the translation of a reason code the server returned. A
// reason the server did not send is never shown, and nothing here invents
// one.
import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { StrategyPreview } from '@/services/metaAds';
import { planIssueKey, strategyExplanationKeys } from './masterLogic';

export function StrategyCard({ preview, loading, failed }: {
  preview: StrategyPreview | null; loading: boolean; failed: boolean;
}) {
  const { t } = useLanguage();
  const s = preview?.strategy ?? null;
  const explanation = s ? strategyExplanationKeys(s.reasonCodes, [...(s.targetingAdjustments ?? []), ...(preview?.targeting.adjustments ?? [])]) : [];
  const issues = [...new Set((preview?.issues ?? []).map((i) => planIssueKey(i.code)))];

  return (
    <section data-mm-strategy="" aria-labelledby="mm-b-strategy" className="overflow-hidden rounded-2xl border border-[hsl(var(--gold-border))]/60 bg-card shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-[hsl(var(--gold-soft))]/60 px-4 py-3 sm:px-5">
        <h3 id="mm-b-strategy" className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--gold-ink))]">
          <Sparkles className="h-4 w-4" aria-hidden />{t('mm_b_strategy_title')}
        </h3>
        {loading && <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" aria-hidden />{t('mm_b_strategy_updating')}</span>}
      </div>
      <div className="space-y-3 px-4 py-4 sm:px-5" aria-live="polite" aria-busy={loading}>
        {!preview && !loading && failed && <p className="text-sm text-muted-foreground">{t('mm_b_strategy_failed')}</p>}
        {!preview && loading && <p className="text-sm text-muted-foreground">{t('mm_b_strategy_loading')}</p>}
        {preview && !s && (
          <div className="space-y-1.5">
            <p className="text-sm text-foreground">{t('mm_b_strategy_waiting')}</p>
            {issues.length > 0 && (
              <ul className="space-y-1 text-[13px] text-muted-foreground">
                {issues.map((k) => <li key={k} className="flex items-start gap-2"><span aria-hidden>•</span><span>{t(k)}</span></li>)}
              </ul>
            )}
          </div>
        )}
        {s && (
          <>
            <dl className={`grid grid-cols-2 gap-2 ${loading ? 'opacity-60' : ''}`}>
              {[
                ['mm_b_strategy_ad_sets', String(s.adSetCount)],
                ['mm_b_strategy_ads', String(s.adCount)],
                ['mm_b_strategy_capacity', String(s.testingCapacity)],
                ['mm_b_strategy_confidence', t(s.confidence === 'HIGH' ? 'mm_b_confidence_HIGH' : 'mm_b_confidence_MEDIUM')],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-border px-3 py-2">
                  <dt className="text-2xs text-muted-foreground">{t(k)}</dt>
                  <dd className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{v}</dd>
                </div>
              ))}
            </dl>
            {explanation.length > 0 && (
              <div>
                <p className="text-[13px] font-medium text-foreground">{t('mm_b_strategy_why')}</p>
                <ul className="mt-1.5 space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {explanation.map((k) => <li key={k} className="flex items-start gap-2"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--gold))]" aria-hidden /><span>{t(k)}</span></li>)}
                </ul>
              </div>
            )}
            {s.confidence === 'MEDIUM' && <p className="text-2xs leading-relaxed text-muted-foreground">{t('mm_b_confidence_MEDIUM_d')}</p>}
          </>
        )}
      </div>
    </section>
  );
}
