import { ArrowRight, CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import React from 'react';
import type { SearchSummary } from '@/services/marketplaceSearch';
import { SnakeThumbnail } from './SnakeThumbnail';
import type { T } from './format';

const STAGE_KEY: Record<string, string> = {
  SEARCHING_LISTINGS: 'mps_stage_searching', CHECKING_DETAILS: 'mps_stage_details', MERGING: 'mps_stage_merging',
  COMPARING_PRICES: 'mps_stage_prices', SELECTING: 'mps_stage_selecting',
};

/**
 * The search, while it runs. Every number on this screen is a real counter
 * from the server; there is no animated percentage. The stage list moves only
 * when its counter does. Snake is optional and never blocks anything.
 */
export function SearchingView({ t, search, onViewResults, onCancel, onPlay, onNewSearch }: {
  t: T; search: SearchSummary; onViewResults: () => void; onCancel: () => void; onPlay: () => void; onNewSearch: () => void;
}) {
  const c = search.counters;
  /* Real results exist (from whichever sources finished): they can be opened now. */
  const ready = (search.status === 'RESULTS_AVAILABLE' || search.terminal) && (search.totalProperties ?? c.uniqueProperties) > 0;

  if (search.unavailable) {
    return (
      <section className="hm-discovery-panel space-y-3 p-6 sm:p-8" role="status">
        <h2 className="font-display text-xl font-semibold text-foreground">{t('mps_unavailable_title')}</h2>
        <p className="text-[15px] text-muted-foreground">{t(search.unavailable === 'NO_SOURCES' ? 'mps_unavailable_no_sources' : 'mps_unavailable_failed')}</p>
        <button type="button" onClick={onNewSearch}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t('mps_new_search')}
        </button>
      </section>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
      <section aria-labelledby="mps-searching" className="relative overflow-hidden rounded-2xl bg-[#0C1119] p-6 text-white shadow-hover sm:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_0%_0%,hsl(38_92%_56%/0.16),transparent_60%)] motion-safe:animate-pulse" aria-hidden="true" />
        <div className="relative space-y-6">
          <div className="space-y-1">
            <h2 id="mps-searching" className="font-display text-2xl font-semibold tracking-[-0.02em]">{t('mps_searching_title')}</h2>
            <p className="text-[15px] text-white/80">{t('mps_searching_body')}</p>
            <p className="text-sm text-white/60" aria-live="polite">
              {c.sourcesTotal ? t('mps_sources_progress', { done: c.sourcesCompleted, total: c.sourcesTotal }) : null}
            </p>
          </div>
          <ol className="space-y-3" aria-label={t('mps_stages_label')}>
            {search.stages.map((s) => (
              <li key={s.stage} className="flex items-center gap-3">
                {s.state === 'DONE' ? <CheckCircle2 className="h-5 w-5 shrink-0 text-[hsl(38_92%_62%)]" aria-hidden="true" />
                  : s.state === 'ACTIVE' ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-white" aria-hidden="true" />
                    : <Circle className="h-5 w-5 shrink-0 text-white/30" aria-hidden="true" />}
                <span className={`text-[15px] ${s.state === 'PENDING' ? 'text-white/50' : 'text-white'}`}>{t(STAGE_KEY[s.stage])}</span>
                <span className="sr-only">{t(`mps_stage_state_${s.state}`)}</span>
              </li>
            ))}
          </ol>
          <dl className="grid grid-cols-2 gap-3">
            {[
              ['mps_counter_discovered', c.listingsDiscovered],
              ['mps_counter_validated', c.listingsValidated],
              ['mps_counter_unique', c.uniqueProperties],
              ['mps_counter_strong', c.strongMatches],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <dt className="text-xs text-white/60">{t(k as string)}</dt>
                <dd className="mt-1 font-display text-2xl font-semibold tabular-nums">{v as number}</dd>
              </div>
            ))}
          </dl>
          {ready ? (
            <div className="space-y-2 rounded-xl border border-[hsl(38_92%_60%/0.4)] bg-white/[0.05] p-4" role="status">
              <p className="font-semibold">{t('mps_progressive_title')}</p>
              <p className="text-sm text-white/75">{t('mps_progressive_body')}</p>
              <button type="button" onClick={onViewResults}
                className="mt-1 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[hsl(38_92%_56%)] px-5 text-sm font-semibold text-[#0C1119] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                {t('mps_progressive_cta')}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <button type="button" onClick={onCancel} className="inline-flex items-center gap-1.5 text-sm text-white/60 underline-offset-4 hover:underline">
            <XCircle className="h-4 w-4" aria-hidden="true" />{t('mps_cancel')}
          </button>
        </div>
      </section>

      <aside className="space-y-3 lg:pt-1">
        <SnakeThumbnail t={t} onOpen={onPlay} searching={!search.terminal} />
      </aside>
    </div>
  );
}
