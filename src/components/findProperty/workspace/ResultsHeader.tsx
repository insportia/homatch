/*
 * The answer at a glance, in plain words: what the customer asked, when, how many
 * homes we found and how many fit everything. Source states sit in one quiet
 * status line that opens to the detail; nothing technical is in the way.
 */
import { CalendarDays, ChevronDown, Pencil, RotateCcw, Search, X } from 'lucide-react';
import type { RefObject } from 'react';
import type { SearchBrowsePage, SearchSummary } from '@/services/marketplaceSearch';
import { criteriaChips, num, removeCriterion, type T } from '../format';
import { btn, cx, Eyebrow, naturalDate, Pill, searchTitle, sourceState, Surface } from './primitives';

export function ResultsHeader({ t, search, data, onNewSearch, onChangeCriteria, headingRef }: {
  t: T; search: SearchSummary; data: SearchBrowsePage | null; onNewSearch: () => void; onChangeCriteria: (edit: ReturnType<typeof removeCriterion>) => void;
  headingRef: RefObject<HTMLDivElement | null>;
}) {
  const chips = criteriaChips(search.brief, t);
  const sources = search.sources ?? [];
  const states = sources.map((s) => sourceState(s, search.terminal));
  const finished = states.filter((st) => st !== 'WAITING' && st !== 'SEARCHING').length;
  const answered = states.filter((st) => st === 'FOUND' || st === 'NONE').length;
  const ageDays = Math.floor((Date.now() - Date.parse(search.createdAt)) / 86_400_000);
  return (
    <div ref={headingRef} className="scroll-mt-24 space-y-4" aria-live="polite">
      <Surface className="overflow-hidden">
        <div className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <Eyebrow>{t('fpx_results_eyebrow')}</Eyebrow>
            <h2 dir="auto" className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">{searchTitle(search.brief, t)}</h2>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground" data-testid="mps-search-date">
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" aria-hidden="true" />{t('fpr_search_from', { date: naturalDate(search.createdAt) })}</span>
              {ageDays >= 2 ? <Pill tone="warning">{t('fpx_older_search', { n: ageDays })}</Pill> : null}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" onClick={() => onChangeCriteria(null)} data-action="edit-search" className={btn.quiet}><Pencil className="h-4 w-4" aria-hidden="true" />{t('fpw_edit_search')}</button>
            <button type="button" onClick={onNewSearch} className={btn.primary}><Search className="h-4 w-4 text-[hsl(var(--gold))]" aria-hidden="true" />{t('mps_new_search')}</button>
          </div>
        </div>

        {search.brief.originalText ? (
          <div className="border-t border-border px-5 pt-3.5 sm:px-6">
            <p className="text-2xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{t('fpv_you_asked')}</p>
            <q dir="auto" className="mt-1 block line-clamp-3 text-[15px] italic leading-relaxed text-foreground/85">{search.brief.originalText}</q>
          </div>
        ) : null}
        <ul className="flex flex-wrap gap-2 px-5 py-3.5 sm:px-6" aria-label={t('mps_your_search')} data-search-summary>
          {chips.map((c) => {
            const edit = removeCriterion(c.key);
            return (
              <li key={c.key} data-criterion={c.key} dir="auto" className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-border bg-muted/50 py-1 ps-3 pe-1 text-xs font-medium text-foreground">
                {c.label}
                {edit ? <button type="button" onClick={() => onChangeCriteria(edit)} aria-label={t('fpw_remove_criterion', { label: c.label })} className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]"><X className="h-3.5 w-3.5" aria-hidden="true" /></button> : <span className="pe-2" />}
              </li>
            );
          })}
        </ul>

        {data ? (
          <p className="border-t border-border px-5 py-4 text-[15px] leading-relaxed text-foreground sm:px-6" data-testid="mps-found-line">
            <span className="sr-only" data-testid="mps-total">{data.totalCurrent}</span>
            {t(data.summary.strong > 0 ? 'fpv_found_line' : 'fpv_found_line_none', { total: num(data.totalCurrent), strong: num(data.summary.strong) })}
          </p>
        ) : <div className="h-[56px] animate-pulse border-t border-border bg-muted/40" aria-busy="true" />}
      </Surface>

      {sources.length ? (
        <details className="group rounded-2xl border border-border bg-card px-5 py-1 shadow-sm sm:px-6" open={!search.terminal || undefined} data-source-status>
          <summary className="flex min-h-[44px] cursor-pointer list-none flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-sm text-foreground/85">
              <span className={cx('h-2 w-2 rounded-full', !search.terminal ? 'bg-[hsl(var(--gold))] motion-safe:animate-pulse' : search.partial ? 'bg-[hsl(var(--gold-ink))]' : 'bg-[hsl(var(--success))]')} aria-hidden="true" />
              {!search.terminal ? t('fpv_status_running', { n: sources.length - finished }) : search.partial ? t('fpv_status_partial', { done: answered, n: sources.length }) : t('fpv_status_done', { n: sources.length })}
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">{t('fpv_status_details')}<ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true" /></span>
          </summary>
          <div className="space-y-3 pb-4 pt-2">
            <p className="text-xs leading-relaxed text-muted-foreground">{t('fpr_freshness_policy')}{data?.summary.unknownDates ? ` ${t('fpr_unknown_dates', { n: data.summary.unknownDates })}` : ''}</p>
            {search.terminal && search.partial ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/60 px-3.5 py-2.5">
                <p className="text-sm text-foreground/80">{t('fpv_search_again_note')}</p>
                <button type="button" onClick={() => onChangeCriteria(null)} className={btn.quiet} data-action="search-again"><RotateCcw className="h-4 w-4" aria-hidden="true" />{t('fpv_search_again')}</button>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

