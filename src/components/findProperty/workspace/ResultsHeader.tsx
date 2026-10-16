/*
 * The answer at a glance: what was searched and when, how many properties, how many
 * strong matches and why the rest are not, and every source with its real state.
 * Replaces the old full-width black technical panel.
 */
import { CalendarDays, ChevronDown, Info, Pencil, Search, X } from 'lucide-react';
import type { RefObject } from 'react';
import type { SearchBrowsePage, SearchSummary } from '@/services/marketplaceSearch';
import { criteriaChips, removeCriterion, type T } from '../format';
import { requirementLabel } from '../PropertyCard';
import { btn, cx, Eyebrow, naturalDate, Pill, searchTitle, sourceState, Surface } from './primitives';
import { SourceStates } from './SourceStates';

export function ResultsHeader({ t, search, data, onNewSearch, onChangeCriteria, headingRef }: {
  t: T; search: SearchSummary; data: SearchBrowsePage | null; onNewSearch: () => void; onChangeCriteria: (edit: ReturnType<typeof removeCriterion>) => void;
  headingRef: RefObject<HTMLDivElement | null>;
}) {
  const chips = criteriaChips(search.brief, t);
  const sources = search.sources ?? [];
  const withResults = sources.filter((s) => sourceState(s, search.terminal) === 'FOUND').length;
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

        <ul className="flex flex-wrap gap-2 border-t border-border px-5 py-3.5 sm:px-6" aria-label={t('mps_your_search')} data-search-summary>
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
          <div className="grid grid-cols-3 border-t border-border">
            <p className="sr-only">{t('mps_total_found', { n: data.totalCurrent })}</p>
            <Kpi label={t('fpx_kpi_properties')} value={data.totalCurrent} testId="mps-total" />
            <Kpi label={t('fpx_kpi_strong')} value={data.summary.strong} accent />
            <Kpi label={t('fpx_kpi_alternatives')} value={data.summary.close} />
          </div>
        ) : <div className="h-[84px] animate-pulse border-t border-border bg-muted/40" aria-busy="true" />}

        {data && data.summary.unconfirmed?.length && data.summary.strong < data.totalCurrent ? (
          <p className="flex items-start gap-2 border-t border-border bg-[hsl(var(--gold)/0.06)] px-5 py-3 text-sm leading-relaxed text-foreground/85 sm:px-6" data-testid="mps-unconfirmed">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
            <span>{t('fpr_unconfirmed_summary', { list: data.summary.unconfirmed.slice(0, 4).map((u) => `${requirementLabel(u.code, t)} (${u.count})`).join(' · ') })}</span>
          </p>
        ) : null}
        {search.partial ? (
          <div role="status" className="flex items-start gap-2 border-t border-border px-5 py-3 text-sm sm:px-6">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--warning))]" aria-hidden="true" />
            <p><span className="font-semibold text-foreground">{t('mps_partial_title')}</span> <span className="text-muted-foreground">{t('mps_partial_body')}</span></p>
          </div>
        ) : null}
      </Surface>

      {sources.length ? (
        <details className="group rounded-2xl border border-border bg-card px-5 py-3.5 shadow-sm sm:px-6" open={!search.terminal}>
          <summary className="flex min-h-[32px] cursor-pointer list-none flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-foreground">{t('fpx_sources_summary', { n: sources.length, found: withResults })}</span>
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">{search.partial ? <Pill tone="warning">{t('fpx_partial')}</Pill> : null}<ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true" /></span>
          </summary>
          <div className="mt-3 space-y-3">
            <SourceStates t={t} search={search} compact />
            <p className="text-xs leading-relaxed text-muted-foreground">{t('fpr_freshness_policy')}{data?.summary.unknownDates ? ` ${t('fpr_unknown_dates', { n: data.summary.unknownDates })}` : ''}</p>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, accent, testId }: { label: string; value: number; accent?: boolean; testId?: string }) {
  return (
    <div className="min-w-0 border-e border-border px-4 py-3.5 last:border-e-0 sm:px-6">
      <p className={cx('font-display text-2xl font-semibold tabular-nums sm:text-[28px]', accent ? 'text-[hsl(var(--gold-ink))]' : 'text-foreground')} data-testid={testId}>{value}</p>
      <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
    </div>
  );
}
