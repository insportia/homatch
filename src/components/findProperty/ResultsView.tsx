import { ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { filtersFromParams, pageNumbers, resultParams, type ResultFilters } from '@/research-core/marketplace/browse-results';
import { RESULT_SECTIONS } from '@/research-core/marketplace/result-evidence';
import { MarketplaceError, type PropertyView, type SearchSummary, type SearchBrowsePage, browseSearchResults } from '@/services/marketplaceSearch';
import { PropertyCard } from './PropertyCard';
import { ResultFiltersPanel } from './ResultFiltersPanel';
import { DeepSearchCard } from './SearchModeSelect';
import { type T, criteriaChips } from './format';

export function ResultsView({ t, search, onOpen, compare, onToggleCompare, onNewSearch, onChangeCriteria, deepSearchAvailable, version }: {
  t: T; search: SearchSummary; onOpen: (p: PropertyView) => void; compare: string[]; onToggleCompare: (p: PropertyView) => void;
  onNewSearch: () => void; onChangeCriteria: (field: 'price' | 'area') => void; deepSearchAvailable: boolean; version: number;
}) {
  const [params, setParams] = useSearchParams();
  const filters = filtersFromParams(params), filterKey = JSON.stringify(filters);
  const requestedPage = Math.max(1, Math.trunc(Number(params.get('page'))) || 1);
  const revision = params.get('revision') ?? undefined;
  const [data, setData] = useState<SearchBrowsePage | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const initialVersion = useRef(version), heading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    void browseSearchResults(search.id, JSON.parse(filterKey), requestedPage, revision).then((page) => {
      if (!alive) return;
      setData(page);
      if (!revision || page.page !== requestedPage) {
        const next = new URLSearchParams(params); next.set('revision', page.revision); next.set('page', String(page.page)); setParams(next, { replace: true });
      }
    }).catch((e) => { if (alive) setError(e instanceof MarketplaceError ? e.code : 'REQUEST_FAILED'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [search.id, filterKey, requestedPage, revision, retry]);
  const update = (patch: Partial<ResultFilters>, page?: number) => { setParams(resultParams(params, patch, page)); if (page !== undefined) heading.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  const reset = () => { const next = new URLSearchParams(params); for (const key of [...next.keys()]) if (key.startsWith('fp_')) next.delete(key); next.set('page', '1'); setParams(next); };
  const refresh = () => { const next = new URLSearchParams(params); next.delete('revision'); next.set('page', '1'); initialVersion.current = version; setParams(next); setRetry((n) => n + 1); };
  const changed = error === 'RESULTS_CHANGED' || version !== initialVersion.current;
  const showItems = !loading && !error;
  const sorted = !!filters.sort && filters.sort !== 'RANKED';
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <ul className="flex min-w-0 flex-wrap gap-2" aria-label={t('mps_your_search')}>{criteriaChips(search.brief, t).map((c) => <li key={c.key} className="rounded-full border border-border px-3 py-1.5 text-xs" dir="auto">{c.label}</li>)}</ul>
      <button type="button" onClick={onNewSearch} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold"><Search className="h-4 w-4" aria-hidden="true" />{t('mps_new_search')}</button>
    </div>
    <div ref={heading} className="scroll-mt-24 space-y-2" aria-live="polite">
      {data ? <><p className="font-display text-xl font-semibold sm:text-2xl" data-testid="mps-total">{t('mps_total_found', { n: data.totalCurrent })}</p><p className="text-sm text-muted-foreground">{t('fpr_summary', { strong: data.summary.strong, close: data.summary.close, verify: data.summary.verification })}</p><p className="max-w-[80ch] text-xs leading-relaxed text-muted-foreground">{t('fpr_freshness_policy')}{data.summary.unknownDates ? ` ${t('fpr_unknown_dates', { n: data.summary.unknownDates })}` : ''}</p></> : null}
      {!search.terminal ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('mps_progressive_body')}</p> : null}
      {search.partial ? <div role="status" className="space-y-1"><p className="text-sm font-medium">{t('mps_partial_title')}</p><p className="text-sm text-muted-foreground">{t('mps_partial_body')}</p></div> : null}
    </div>
    {data ? <ResultFiltersPanel t={t} filters={filters} facets={data.facets} onChange={update} onReset={reset} /> : null}
    {changed ? <div className="hm-discovery-panel flex flex-wrap items-center justify-between gap-3 p-4" role="status"><p className="text-sm">{t('fpr_results_changed')}</p><button type="button" onClick={refresh} className="min-h-[44px] rounded-xl border border-border px-4 text-sm font-semibold">{t('fpr_refresh')}</button></div> : null}
    {error && error !== 'RESULTS_CHANGED' ? <div role="alert" className="hm-discovery-panel space-y-3 p-4"><p>{t('mps_error_generic')}</p><button type="button" onClick={() => setRetry((n) => n + 1)} className="min-h-[44px] rounded-xl border px-4">{t('fpr_retry')}</button></div> : null}
    {data ? <div className="flex flex-wrap gap-2" aria-label={t('fpr_sections')}><button type="button" onClick={() => update({ section: undefined })} aria-pressed={!filters.section} className={`min-h-[44px] rounded-xl border px-3 text-sm ${!filters.section ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold)/0.1)]' : 'border-border'}`}>{t('fpr_all')}</button>{RESULT_SECTIONS.filter((s) => data.sections[s] > 0).map((section) => <button key={section} type="button" onClick={() => update({ section })} aria-pressed={filters.section === section} className={`min-h-[44px] rounded-xl border px-3 text-sm ${filters.section === section ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold)/0.1)]' : 'border-border'}`}>{t(`fpr_section_${section}`)} <span className="text-muted-foreground">{data.sections[section]}</span></button>)}</div> : null}
    {loading ? <div role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />{t('fpr_loading')}</div> : null}
    {showItems && data && data.total === 0 && (search.terminal || data.totalCurrent > 0) ? <section className="hm-discovery-panel space-y-3 p-5 sm:p-6" aria-labelledby="mps-empty"><h2 id="mps-empty" className="font-display text-xl font-semibold">{t(data.totalCurrent ? 'fpr_filtered_empty' : 'mps_empty_title')}</h2><p className="max-w-[70ch] text-sm text-muted-foreground">{t(data.totalCurrent ? 'fpr_filtered_empty_body' : 'fpr_empty_hard')}</p><div className="flex flex-wrap gap-2">{data.totalCurrent ? <button type="button" onClick={reset} className="min-h-[44px] rounded-xl border border-border px-4 text-sm">{t('fpr_clear')}</button> : <><button type="button" onClick={() => onChangeCriteria('area')} className="min-h-[44px] rounded-xl border border-border px-4 text-sm">{t('mps_empty_area')}</button><button type="button" onClick={() => onChangeCriteria('price')} className="min-h-[44px] rounded-xl border border-border px-4 text-sm">{t('mps_empty_budget')}</button></>}</div></section> : null}
    {showItems && data && sorted && data.total > 0 ? <section aria-labelledby="mps-g-SORTED" className="space-y-3"><div><h2 id="mps-g-SORTED" className="font-display text-lg font-semibold sm:text-xl">{t(`fpr_sort_${filters.sort}`)}</h2><p className="mt-1 text-xs text-muted-foreground">{t('fpr_sorted_body')}</p></div><div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">{data.items.map((p) => <PropertyCard key={p.key} p={p} t={t} onOpen={() => onOpen(p)} compareSelected={compare.includes(p.key)} onToggleCompare={() => onToggleCompare(p)} />)}</div></section> : null}
    {showItems && data && !sorted ? RESULT_SECTIONS.map((section) => {
      const items = data.items.filter((p) => (p.intelligence?.section ?? (p.group === 'UPGRADE' ? 'UPGRADE' : p.group === 'BEST' ? 'BEST' : 'CLOSE')) === section);
      return items.length ? <section key={section} aria-labelledby={`mps-g-${section}`} className="space-y-3"><div><h2 id={`mps-g-${section}`} className="font-display text-lg font-semibold sm:text-xl">{t(`fpr_section_${section}`)}</h2><p className="mt-1 max-w-[75ch] text-xs leading-relaxed text-muted-foreground">{t(`fpr_section_body_${section}`)}</p></div><div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">{items.map((p) => <PropertyCard key={p.key} p={p} t={t} onOpen={() => onOpen(p)} compareSelected={compare.includes(p.key)} onToggleCompare={() => onToggleCompare(p)} />)}</div></section> : null;
    }) : null}
    {showItems && data && data.total > 0 ? <div className="space-y-3 border-t border-border pt-5"><p className="text-center text-xs text-muted-foreground" role="status">{t('fpr_page_status', { from: (data.page - 1) * data.pageSize + 1, to: Math.min(data.page * data.pageSize, data.total), total: data.total })}</p><nav aria-label={t('fpr_pagination')} className="flex flex-wrap items-center justify-center gap-1.5" dir="ltr"><button type="button" disabled={data.page === 1} onClick={() => update({}, data.page - 1)} aria-label={t('fpr_previous')} className="grid h-11 w-11 place-items-center rounded-xl border border-border disabled:opacity-35"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>{pageNumbers(data.page, data.pages).map((p, i) => p === 'gap' ? <span key={`gap-${i}`} className="px-1 text-muted-foreground" aria-hidden="true">…</span> : <button type="button" key={p} aria-label={t('fpr_go_page', { n: p })} aria-current={p === data.page ? 'page' : undefined} onClick={() => update({}, p)} className={`h-11 min-w-11 rounded-xl border px-2 text-sm font-semibold ${p === data.page ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold)/0.12)]' : 'border-border hover:bg-muted'}`}>{p}</button>)}<button type="button" disabled={data.page === data.pages} onClick={() => update({}, data.page + 1)} aria-label={t('fpr_next')} className="grid h-11 w-11 place-items-center rounded-xl border border-border disabled:opacity-35"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button></nav></div> : null}
    {search.terminal ? <DeepSearchCard t={t} available={deepSearchAvailable} variant="results" /> : null}
  </div>;
}
