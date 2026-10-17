/*
 * A search while it runs. The progress bar is sources finished / sources
 * dispatched; the counters are the server's. When the search ends the view says
 * so and moves to results — nothing here can keep "searching" after the server
 * marked the search terminal.
 *
 * 2026-10-16 (owner): while a search runs the customer never sees WHICH sites
 * are read. The field shows anonymous points of light, the bar counts sources
 * without naming them; the real source appears only on result cards and in the
 * results filter.
 */
import { useState } from 'react';
import { ArrowRight, ChevronDown, Clock3, Gamepad2, Sparkles, Square } from 'lucide-react';
import type { SearchSummary } from '@/services/marketplaceSearch';
import type { T } from '../format';
import { btn, cx, naturalDate, searchBudget, searchPlace, searchTitle, sourceState, Surface } from './primitives';
import { sourceProgress } from './SourceStates';
import { DiscoveryField, type FieldNode } from './DiscoveryField';
import { useElapsed } from './elapsed';

const FIELD_STATE = { WAITING: 'IDLE', SEARCHING: 'ACTIVE', FOUND: 'DONE', NONE: 'DONE', UNAVAILABLE: 'UNAVAILABLE', FAILED: 'UNAVAILABLE', TIMED_OUT: 'UNAVAILABLE' } as const;

const STAGE_KEY: Record<string, string> = {
  SEARCHING_LISTINGS: 'mps_stage_searching', CHECKING_DETAILS: 'mps_stage_details', MERGING: 'mps_stage_merging',
  COMPARING_PRICES: 'mps_stage_prices', SELECTING: 'mps_stage_selecting',
};

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0C1119]';

export function SearchProgress({ t, search, onViewResults, onCancel, onPlay, onNewSearch, deep }: {
  t: T; search: SearchSummary; onViewResults: () => void; onCancel: () => void; onPlay: () => void; onNewSearch: () => void;
  deep?: React.ReactNode;
}) {
  const c = search.counters;
  const ready = search.terminal && (search.totalProperties ?? c.uniqueProperties) > 0;
  const answered = (search.sources ?? []).filter((src) => sourceState(src, true) === 'FOUND' || sourceState(src, true) === 'NONE').length;
  const progress = sourceProgress(search);
  const width = search.terminal ? 1 : Math.max(progress.fraction, 0.04);
  const elapsed = useElapsed(search.createdAt, !search.terminal);
  const [confirmStop, setConfirmStop] = useState(false);
  // Anonymous points: the field keeps each source's real state, never its name.
  const fieldNodes: FieldNode[] = (search.sources ?? []).map((src, i) => ({ key: `node-${i}`, label: '', state: FIELD_STATE[sourceState(src, search.terminal)] }));
  const current = search.stages.find((s) => s.state === 'ACTIVE') ?? search.stages.find((s) => s.state === 'PENDING');

  if (search.unavailable) {
    return (
      <Surface className="space-y-4 p-6 sm:p-8" role="status">
        <h2 className="font-display text-xl font-semibold text-foreground">{t('mps_unavailable_title')}</h2>
        <p className="max-w-[60ch] text-[15px] text-muted-foreground">{t(search.unavailable === 'NO_SOURCES' ? 'mps_unavailable_no_sources' : 'mps_unavailable_failed')}</p>
        <button type="button" onClick={onNewSearch} className={btn.primary}>{t('mps_new_search')}</button>
      </Surface>
    );
  }

  return (
    <div className={cx('grid gap-5', deep ? 'xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] xl:items-start' : '')}>
      <section aria-labelledby="mps-searching" data-search-stage
        className="relative overflow-hidden rounded-[28px] bg-[#0C1119] text-white shadow-[0_30px_80px_-40px_rgba(12,17,25,0.9)] ring-1 ring-[hsl(var(--gold)/0.22)]">
        <div className="pointer-events-none absolute -top-32 start-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-[hsl(var(--gold)/0.16)] blur-3xl rtl:translate-x-1/2" aria-hidden="true" />
        <div className="relative space-y-6 p-5 sm:p-8">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <p className="inline-flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold))]">
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  {!search.terminal ? <span className="absolute inline-flex h-full w-full rounded-full bg-[hsl(var(--gold))] opacity-70 motion-safe:animate-ping" /> : null}
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[hsl(var(--gold))]" />
                </span>
                {search.terminal ? t('fpx_search_finished') : t('fpx_search_running')}
              </p>
              <h2 id="mps-searching" dir="auto" className="font-display text-2xl font-semibold tracking-[-0.02em] sm:text-[28px]">{searchTitle(search.brief, t)}</h2>
              <p dir="auto" className="text-sm text-white/60">{[searchPlace(search.brief, t), searchBudget(search.brief, t), naturalDate(search.createdAt)].filter(Boolean).join(' · ')}</p>
            </div>
            {!search.terminal ? (
              <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 font-display text-lg font-semibold tabular-nums text-white" data-elapsed>
                <Clock3 className="h-4 w-4 text-[hsl(var(--gold))]" aria-hidden="true" /><span className="sr-only">{t('fpv_elapsed', { time: elapsed })}</span><span aria-hidden="true">{elapsed}</span>
              </p>
            ) : null}
          </header>

          {fieldNodes.length ? (
            <figure className="relative">
              <DiscoveryField nodes={fieldNodes} terminal={search.terminal} />
              {current && !search.terminal ? (
                <figcaption className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4" aria-live="polite">
                  <span className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--gold)/0.35)] bg-[#0C1119]/80 px-4 py-1.5 text-xs font-semibold text-[hsl(var(--gold))] shadow-lg backdrop-blur" data-current-stage>
                    <Sparkles className="h-3.5 w-3.5 motion-safe:animate-pulse" aria-hidden="true" />{t(STAGE_KEY[current.stage])}
                  </span>
                </figcaption>
              ) : <figcaption className="sr-only">{t('fpv_field_label')}</figcaption>}
            </figure>
          ) : null}

          <div className="space-y-2.5" aria-live="polite">
            {/* Stacked, never side by side: a long note beside a short label squeezed the label
                into a one-word column on phones (owner screenshot, 2026-10-17). */}
            <div className="space-y-1 text-sm" data-progress-copy>
              <p className="font-semibold text-white/90">{t('mps_sources_progress', { done: progress.done, total: progress.total })}</p>
              {!search.terminal ? <p className="text-xs leading-relaxed text-white/55" data-duration-note>{t('fpv_duration_note')}</p> : null}
            </div>
            <div className="relative h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label={t('fpx_sources_label')}>
              <div className="h-full origin-left rounded-full bg-[linear-gradient(90deg,hsl(var(--gold)/0.55),hsl(var(--gold)))] transition-transform duration-700 rtl:origin-right" style={{ transform: `scaleX(${width})` }} />
              {!search.terminal ? <div className="pointer-events-none absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-white/50 to-transparent motion-safe:animate-[hm-flow_1.8s_linear_infinite] motion-reduce:hidden" aria-hidden="true" /> : null}
            </div>
          </div>

          <dl className="grid grid-cols-3 gap-2 sm:gap-3">
            {([['fpx_counter_found', c.listingsDiscovered], ['fpx_counter_unique', c.uniqueProperties], ['fpx_counter_strong', c.strongMatches]] as const).map(([k, v]) => (
              <div key={k} className="min-w-0 rounded-2xl border border-white/[0.07] bg-white/[0.04] p-3 sm:p-4">
                <dt className="text-2xs font-medium leading-snug text-white/55 break-words">{t(k)}</dt>
                <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-white sm:text-3xl">{v}</dd>
              </div>
            ))}
          </dl>

          {/* Completion gate (owner, 2026-10-17): results open only when the server marks the
              search terminal, every source job ended. Never redirected; the customer chooses. */}
          {search.terminal ? (
            <div className="space-y-3 rounded-2xl border border-[hsl(var(--gold)/0.4)] bg-[hsl(var(--gold)/0.1)] p-4 sm:p-5" role="status" data-search-done={search.status}>
              <p className="font-display text-lg font-semibold text-white">{t(search.status === 'CANCELLED' ? 'fpv_done_cancelled_title' : 'fpv_done_title')}</p>
              <p className="text-sm leading-relaxed text-white/75">
                {search.status === 'CANCELLED' ? t('fpv_done_cancelled_body')
                  : search.partial ? t('fpv_done_partial', { n: Math.max(0, progress.total - answered), total: progress.total })
                    : t('fpv_done_body')}
              </p>
              {ready ? <button type="button" onClick={onViewResults} data-action="view-results" className={`${btn.gold} w-full sm:w-auto`}>
                {t('fpv_view_results', { n: search.totalProperties ?? c.uniqueProperties })}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
              </button> : null}
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-white/55" data-results-wait>{t('fpv_results_wait')}</p>
          )}

          <details className="group rounded-2xl border border-white/[0.08] px-4 py-3 text-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium text-white/60"><span>{t('fpx_diagnostics')}</span><ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true" /></summary>
            <ol className="mt-3 space-y-1.5" aria-label={t('mps_stages_label')}>
              {search.stages.map((s) => (
                <li key={s.stage} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
                  <span className={s.state === 'PENDING' ? 'text-white/45' : 'text-white/90'}>{t(STAGE_KEY[s.stage])}</span>
                  <span className="whitespace-nowrap text-xs text-white/50">{t(`mps_stage_state_${s.state}`)}</span>
                </li>
              ))}
              <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-t border-white/10 pt-1.5 text-white/80"><span>{t('mps_counter_validated')}</span><span className="tabular-nums">{c.listingsValidated}</span></li>
            </ol>
          </details>

          {!search.terminal ? (
            <div className="flex flex-col-reverse gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
              {confirmStop ? (
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('fpv_stop_confirm')} data-stop-confirm>
                  <span className="text-sm text-white/80">{t('fpv_stop_confirm')}</span>
                  <button type="button" onClick={onCancel} data-action="mps-cancel-confirm"
                    className={`inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[hsl(0_72%_58%)] px-4 text-sm font-semibold text-white transition hover:brightness-110 ${focus}`}>
                    <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />{t('fpv_stop_yes')}
                  </button>
                  <button type="button" onClick={() => setConfirmStop(false)} className={`inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-semibold text-white/80 hover:text-white ${focus}`}>{t('fpv_keep_searching')}</button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmStop(true)} data-action="mps-cancel"
                  className={`group inline-flex min-h-[44px] items-center justify-center gap-2.5 rounded-full border border-white/15 bg-white/[0.03] px-5 text-sm font-semibold text-white/80 transition hover:border-[hsl(0_72%_58%/0.6)] hover:text-white ${focus}`}>
                  <span className="grid h-5 w-5 place-items-center rounded-full border border-current" aria-hidden="true"><Square className="h-2 w-2 fill-current" /></span>{t('mps_cancel')}
                </button>
              )}
              <button type="button" onClick={onPlay} data-action="mps-snake-open"
                className={`group relative inline-flex min-h-[52px] items-center justify-center gap-3 overflow-hidden rounded-full bg-[linear-gradient(135deg,hsl(var(--gold)),hsl(38_70%_62%))] ps-2 pe-6 text-start text-[#0C1119] shadow-[0_12px_32px_-12px_hsl(var(--gold)/0.9)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-12px_hsl(var(--gold)/1)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${focus}`}>
                <span className="pointer-events-none absolute inset-y-0 -start-1/3 w-1/3 skew-x-[-20deg] bg-white/40 opacity-0 transition group-hover:opacity-100 motion-safe:group-hover:animate-[hm-flow_1.2s_ease-in-out]" aria-hidden="true" />
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[#0C1119] text-[hsl(var(--gold))]" aria-hidden="true"><Gamepad2 className="h-[18px] w-[18px]" /></span>
                <span className="min-w-0 text-sm font-bold leading-tight">{t('fpv_play_snake')}</span>
              </button>
            </div>
          ) : null}
        </div>
      </section>
      {deep ? <div className="min-w-0">{deep}</div> : null}
    </div>
  );
}
