/*
 * A search while it runs. The progress bar is sources finished / sources
 * dispatched; the counters are the server's. When the search ends the view says
 * so and moves to results — nothing here can keep "searching" after the server
 * marked the search terminal.
 */
import { ArrowRight, ChevronDown, Gamepad2, X } from 'lucide-react';
import type { SearchSummary } from '@/services/marketplaceSearch';
import type { T } from '../format';
import { btn, cx, Eyebrow, naturalDate, Pill, searchBudget, searchPlace, searchTitle, Surface } from './primitives';
import { SourceStates, sourceProgress } from './SourceStates';

const STAGE_KEY: Record<string, string> = {
  SEARCHING_LISTINGS: 'mps_stage_searching', CHECKING_DETAILS: 'mps_stage_details', MERGING: 'mps_stage_merging',
  COMPARING_PRICES: 'mps_stage_prices', SELECTING: 'mps_stage_selecting',
};

export function SearchProgress({ t, search, onViewResults, onCancel, onPlay, onNewSearch, deep }: {
  t: T; search: SearchSummary; onViewResults: () => void; onCancel: () => void; onPlay: () => void; onNewSearch: () => void;
  deep?: React.ReactNode;
}) {
  const c = search.counters;
  const ready = (search.status === 'RESULTS_AVAILABLE' || search.terminal) && (search.totalProperties ?? c.uniqueProperties) > 0;
  const progress = sourceProgress(search);
  const pct = Math.round(progress.fraction * 100);

  if (search.unavailable) {
    return (
      <Surface className="space-y-4 p-6 sm:p-8" role="status">
        <Pill tone="danger">{t('fpw_status_FAILED')}</Pill>
        <h2 className="font-display text-xl font-semibold text-foreground">{t('mps_unavailable_title')}</h2>
        <p className="max-w-[60ch] text-[15px] text-muted-foreground">{t(search.unavailable === 'NO_SOURCES' ? 'mps_unavailable_no_sources' : 'mps_unavailable_failed')}</p>
        <button type="button" onClick={onNewSearch} className={btn.primary}>{t('mps_new_search')}</button>
      </Surface>
    );
  }

  return (
    <div className={cx('grid gap-5', deep ? 'xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] xl:items-start' : '')}>
      <Surface className="overflow-hidden" aria-labelledby="mps-searching">
        <div className="space-y-5 p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <Eyebrow>{search.terminal ? t('fpx_search_finished') : t('fpx_search_running')}</Eyebrow>
              <h2 id="mps-searching" dir="auto" className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">{searchTitle(search.brief, t)}</h2>
              <p dir="auto" className="text-sm text-muted-foreground">{[searchPlace(search.brief, t), searchBudget(search.brief, t), naturalDate(search.createdAt)].filter(Boolean).join(' · ')}</p>
            </div>
            <Pill tone={search.terminal ? 'success' : 'live'} pulse={!search.terminal}>{t(`fpw_status_${search.status}`)}</Pill>
          </div>

          <div className="space-y-2" aria-live="polite">
            <div className="text-sm">
              <span className="font-semibold text-foreground">{t('mps_sources_progress', { done: progress.done, total: progress.total })}</span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label={t('fpx_sources_label')}>
              <div className="h-full rounded-full bg-[linear-gradient(90deg,#0C1119,hsl(var(--gold)))] transition-[width] duration-700" style={{ width: `${Math.max(pct, search.terminal ? 100 : 4)}%` }} />
              {!search.terminal ? <div className="pointer-events-none absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-white/60 to-transparent motion-safe:animate-[hm-flow_1.8s_linear_infinite] motion-reduce:hidden" aria-hidden="true" /> : null}
            </div>
          </div>

          <dl className="grid grid-cols-3 gap-2">
            {([['fpx_counter_found', c.listingsDiscovered], ['fpx_counter_unique', c.uniqueProperties], ['fpx_counter_strong', c.strongMatches]] as const).map(([k, v]) => (
              <div key={k} className="min-w-0 rounded-xl bg-muted/70 p-3">
                <dt className="truncate text-2xs font-medium text-muted-foreground">{t(k)}</dt>
                <dd className="mt-0.5 font-display text-2xl font-semibold tabular-nums text-foreground">{v}</dd>
              </div>
            ))}
          </dl>

          <SourceStates t={t} search={search} />

          {ready ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.07)] p-4" role="status">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{t('mps_progressive_title')}</p>
                <p className="text-sm text-muted-foreground">{t('fpx_results_ready_body')}</p>
              </div>
              <button type="button" onClick={onViewResults} className={btn.primary}>{t('mps_progressive_cta')}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /></button>
            </div>
          ) : null}

          <details className="group rounded-xl border border-border px-4 py-3 text-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium text-muted-foreground"><span>{t('fpx_diagnostics')}</span><ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true" /></summary>
            <ol className="mt-3 space-y-1.5" aria-label={t('mps_stages_label')}>
              {search.stages.map((s) => (
                <li key={s.stage} className="flex items-center justify-between gap-3">
                  <span className={s.state === 'PENDING' ? 'text-muted-foreground' : 'text-foreground'}>{t(STAGE_KEY[s.stage])}</span>
                  <span className="text-xs text-muted-foreground">{t(`mps_stage_state_${s.state}`)}</span>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 border-t border-border pt-1.5"><span>{t('mps_counter_validated')}</span><span className="tabular-nums">{c.listingsValidated}</span></li>
            </ol>
          </details>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            {!search.terminal ? <button type="button" onClick={onCancel} className={btn.ghost}><X className="h-4 w-4" aria-hidden="true" />{t('mps_cancel')}</button> : <span />}
            {!search.terminal ? <button type="button" onClick={onPlay} data-action="mps-snake-open" className={btn.ghost}><Gamepad2 className="h-4 w-4" aria-hidden="true" />{t('fpx_play_while')}</button> : null}
          </div>
        </div>
      </Surface>
      {deep ? <div className="min-w-0">{deep}</div> : null}
    </div>
  );
}
