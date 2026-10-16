import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Copy, Loader2, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { BriefEdit } from '@/research-core/marketplace/brief';
import { filtersFromParams, pageNumbers, type ResultFilters, resultParams } from '@/research-core/marketplace/browse-results';
import { assessProperty, isRecommended } from '@/research-core/marketplace/advisor';
import { browseSearchResults, MarketplaceError, type PropertyView, type SearchBrowsePage, type SearchSummary } from '@/services/marketplaceSearch';
import type { T } from './format';
import { PropertyCard } from './PropertyCard';
import { ResultsHeader } from './workspace/ResultsHeader';
import { DeepSearchPanel } from './workspace/DeepSearchPanel';
import { NativeMatchesPanel } from '@/components/matching/NativeMatchesPanel';
import { ResultFiltersPanel } from './ResultFiltersPanel';
import { SourceChips } from './workspace/SourceChips';
import { DuplicateListings } from './DuplicateListings';

export function ResultsView({ t, search, onOpen, compare, onToggleCompare, onNewSearch, onChangeCriteria, deepSearchAvailable, version }: {
  t: T; search: SearchSummary; onOpen: (p: PropertyView) => void; compare: string[]; onToggleCompare: (p: PropertyView) => void;
  onNewSearch: () => void; onChangeCriteria: (edit: BriefEdit | null) => void; deepSearchAvailable: boolean; version: number;
}) {
  const [params, setParams] = useSearchParams();
  /* Two dedicated pages over the same results (owner, 2026-10-16): ?view=best lists only the
     best matches, ?view=duplicates lists every home that may be published twice, each with
     the listings it may duplicate laid out beside it. */
  const view = params.get('view') === 'best' ? 'best' : params.get('view') === 'duplicates' ? 'duplicates' : null;
  const filters = filtersFromParams(params), filterKey = JSON.stringify(filters);
  const requestedPage = Math.max(1, Math.trunc(Number(params.get('page'))) || 1);
  const revision = params.get('revision') ?? undefined;
  const [data, setData] = useState<SearchBrowsePage | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const initialVersion = useRef(version), heading = useRef<HTMLDivElement>(null);
  const loadedQuery = useRef<string | null>(null);
  useEffect(() => {
    const queryKey = JSON.stringify([search.id, filterKey, requestedPage, revision ?? null, retry]);
    // Recording the revision returned by this exact request is URL bookkeeping,
    // not another acquisition. Keep mounted cards and open disclosures intact.
    if (loadedQuery.current === queryKey) { setError(null); setLoading(false); return; }
    let alive = true;
    setLoading(true); setError(null);
    void browseSearchResults(search.id, JSON.parse(filterKey), requestedPage, revision).then((page) => {
      if (!alive) return;
      loadedQuery.current = JSON.stringify([search.id, filterKey, page.page, page.revision, retry]);
      setData(page); setLoading(false);
      if (!revision || page.page !== requestedPage) {
        const next = new URLSearchParams(params); next.set('revision', page.revision); next.set('page', String(page.page)); setParams(next, { replace: true });
      }
    }).catch((e) => { if (alive) setError(e instanceof MarketplaceError ? e.code : 'REQUEST_FAILED'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [search.id, filterKey, requestedPage, revision, retry]);
  const update = (patch: Partial<ResultFilters>, page?: number) => {
    const next = resultParams(params, patch, page);
    // The two checkboxes open their own pages; clearing them goes back to all results.
    if (patch.strongOnly !== undefined) { if (patch.strongOnly) { next.set('view', 'best'); next.delete('fp_duplicatesOnly'); } else if (view === 'best') next.delete('view'); }
    if (patch.duplicatesOnly !== undefined) { if (patch.duplicatesOnly) { next.set('view', 'duplicates'); next.delete('fp_strongOnly'); } else if (view === 'duplicates') next.delete('view'); }
    setParams(next); if (page !== undefined) heading.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const openView = (v: 'best' | 'duplicates' | null) => {
    const next = new URLSearchParams(params);
    next.delete('fp_strongOnly'); next.delete('fp_duplicatesOnly'); next.set('page', '1');
    if (v === 'best') next.set('fp_strongOnly', 'true');
    if (v === 'duplicates') next.set('fp_duplicatesOnly', 'true');
    if (v) next.set('view', v); else next.delete('view');
    setParams(next); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const reset = () => { const next = new URLSearchParams(params); for (const key of [...next.keys()]) if (key.startsWith('fp_')) next.delete(key); next.set('page', '1'); setParams(next); };
  const refresh = () => { const next = new URLSearchParams(params); next.delete('revision'); next.set('page', '1'); initialVersion.current = version; setParams(next); setRetry((n) => n + 1); };
  const changed = error === 'RESULTS_CHANGED' || version !== initialVersion.current;
  const showItems = !loading && !error;
  const sorted = !!filters.sort && filters.sort !== 'RANKED';
  const flat = sorted || !!view;
  const activeFilters = Object.keys(filters).filter((key) => key !== 'sort' && key !== 'section').length;
  const card = (p: PropertyView) => <PropertyCard key={p.key} p={p} t={t} brief={search.brief} searchId={search.id} transaction={search.brief.transactionType?.value ?? null} onOpen={() => onOpen(p)} compareSelected={compare.includes(p.key)} onToggleCompare={() => onToggleCompare(p)} />;
  const recommended = data && !flat ? data.items.filter((p) => isRecommended(assessProperty(p, search.brief))) : [];
  const others = data && !flat ? data.items.filter((p) => !recommended.includes(p)) : [];
  const dupCount = data ? data.facets.duplicates + (data.facets.possibleDuplicates ?? 0) : 0;
  const viewCard = (p: PropertyView) => view === 'duplicates'
    ? <div key={p.key} className="space-y-2" data-duplicate-group={p.key}>{card(p)}<DuplicateListings p={p} t={t} open /></div>
    : card(p);
  return <div className="space-y-6">
    {view ? (
      <div ref={heading}><header className="space-y-3 rounded-[24px] bg-[#0C1119] p-5 text-white ring-1 ring-[hsl(var(--gold)/0.25)] sm:p-7" data-results-view={view}>
        <button type="button" onClick={() => openView(null)} data-action="all-results"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white/15 px-4 text-sm font-semibold text-white/85 transition hover:border-[hsl(var(--gold)/0.6)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t('fpv_all_results')}
        </button>
        <h1 className="inline-flex items-center gap-2.5 font-display text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
          {view === 'best' ? <Sparkles className="h-6 w-6 text-[hsl(var(--gold))]" aria-hidden="true" /> : <Copy className="h-6 w-6 text-[hsl(var(--gold))]" aria-hidden="true" />}
          {t(view === 'best' ? 'fpv_best_title' : 'fpv_dups_title')}
        </h1>
        <p className="max-w-[70ch] text-sm leading-relaxed text-white/70">{t(view === 'best' ? 'fpv_best_body' : 'fpv_dups_body')}</p>
      </header></div>
    ) : <ResultsHeader t={t} search={search} data={data} onNewSearch={onNewSearch} onChangeCriteria={onChangeCriteria} headingRef={heading} />}
    {!view && data && (data.summary.strong > 0 || dupCount > 0) ? (
      <nav className="flex flex-wrap gap-2" aria-label={t('fpv_quick_views')} data-quick-views>
        {data.summary.strong > 0 ? <button type="button" onClick={() => openView('best')} data-action="open-best"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[#0C1119] px-4 text-sm font-semibold text-white shadow-sm ring-1 ring-[hsl(var(--gold)/0.35)] transition hover:ring-[hsl(var(--gold))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
          <Sparkles className="h-4 w-4 text-[hsl(var(--gold))]" aria-hidden="true" />{t('fpv_best_cta', { n: data.summary.strong })}
        </button> : null}
        {dupCount > 0 ? <button type="button" onClick={() => openView('duplicates')} data-action="open-duplicates"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold text-foreground transition hover:border-[hsl(var(--gold-border))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
          <Copy className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{t('fpv_dups_cta', { n: dupCount })}
        </button> : null}
      </nav>
    ) : null}
    {/* HOMATCH members whose property fits these requirements, from the native matcher.
        Private messaging; a number only as the server allows. Renders nothing when empty. */}
    <NativeMatchesPanel role="SEEKER" />
    {data ? <SourceChips t={t} sources={data.facets.sources} total={data.totalCurrent} active={filters.source} onChange={(source) => update({ source }, 1)} /> : null}
    {data ? <details className="group rounded-2xl border border-border bg-card shadow-sm" open={activeFilters - (filters.source ? 1 : 0) > 0 || undefined} data-filters>
      <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
        <span className="inline-flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{t('fpv_filters')}{activeFilters ? <span className="rounded-full bg-muted px-2 text-2xs tabular-nums">{activeFilters}</span> : null}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-border p-2"><ResultFiltersPanel t={t} filters={filters} facets={data.facets} onChange={update} onReset={reset} /></div>
    </details> : null}
    {changed ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4" role="status"><p className="text-sm">{t('fpr_results_changed')}</p><button type="button" onClick={refresh} className="min-h-[44px] rounded-xl border border-border px-4 text-sm font-semibold">{t('fpr_refresh')}</button></div> : null}
    {error && error !== 'RESULTS_CHANGED' ? <div role="alert" className="space-y-3 rounded-2xl border border-border bg-card p-4"><p>{t('mps_error_generic')}</p><button type="button" onClick={() => setRetry((n) => n + 1)} className="min-h-[44px] rounded-xl border px-4">{t('fpr_retry')}</button></div> : null}
    {loading ? <div role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />{t('fpr_loading')}</div> : null}
    {showItems && data && data.total === 0 && (search.terminal || data.totalCurrent > 0) ? <section className="space-y-3 rounded-2xl border border-border bg-card p-5 sm:p-6" aria-labelledby="mps-empty"><h2 id="mps-empty" className="font-display text-xl font-semibold">{t(data.totalCurrent ? 'fpr_filtered_empty' : 'mps_empty_title')}</h2><p className="max-w-[70ch] text-sm text-muted-foreground">{t(data.totalCurrent ? 'fpr_filtered_empty_body' : 'fpr_empty_hard')}</p><div className="flex flex-wrap gap-2">{data.totalCurrent ? <button type="button" onClick={reset} className="min-h-[44px] rounded-xl border border-border px-4 text-sm">{t('fpr_clear')}</button> : <><button type="button" onClick={() => onChangeCriteria({ field: 'area', value: null })} className="min-h-[44px] rounded-xl border border-border px-4 text-sm">{t('mps_empty_area')}</button><button type="button" onClick={() => onChangeCriteria({ field: 'price', value: null })} className="min-h-[44px] rounded-xl border border-border px-4 text-sm">{t('mps_empty_budget')}</button></>}</div></section> : null}
    {showItems && data && flat && data.total > 0 ? <section aria-labelledby="mps-g-SORTED" className="space-y-3" data-results-group={view ?? 'SORTED'}><h2 id="mps-g-SORTED" className={view ? 'sr-only' : 'font-display text-lg font-semibold sm:text-xl'}>{view ? t(view === 'best' ? 'fpv_best_title' : 'fpv_dups_title') : t(`fpr_sort_${filters.sort}`)}</h2><div className="grid gap-4">{data.items.map(viewCard)}</div></section> : null}
    {showItems && recommended.length ? <section aria-labelledby="mps-g-REC" className="space-y-3" data-results-group="RECOMMENDED"><div><h2 id="mps-g-REC" className="font-display text-lg font-semibold sm:text-xl">{t('fpv_rec_title')}</h2><p className="mt-1 max-w-[75ch] text-sm text-muted-foreground">{t('fpv_rec_body')}</p></div><div className="grid gap-3">{recommended.map(card)}</div></section> : null}
    {showItems && others.length ? <section aria-labelledby="mps-g-OTHER" className="space-y-3" data-results-group="OTHER"><div><h2 id="mps-g-OTHER" className="font-display text-lg font-semibold sm:text-xl">{t('fpv_other_title')}</h2><p className="mt-1 max-w-[75ch] text-sm text-muted-foreground">{t('fpv_other_body')}</p></div><div className="grid gap-3">{others.map(card)}</div></section> : null}
    {showItems && data && data.total > 0 ? <div className="space-y-3 border-t border-border pt-5"><p className="text-center text-xs text-muted-foreground" role="status">{t('fpr_page_status', { from: (data.page - 1) * data.pageSize + 1, to: Math.min(data.page * data.pageSize, data.total), total: data.total })}</p><nav aria-label={t('fpr_pagination')} className="flex flex-wrap items-center justify-center gap-1.5" dir="ltr"><button type="button" disabled={data.page === 1} onClick={() => update({}, data.page - 1)} aria-label={t('fpr_previous')} className="grid h-11 w-11 place-items-center rounded-xl border border-border disabled:opacity-35"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>{pageNumbers(data.page, data.pages).map((p, i) => p === 'gap' ? <span key={`gap-${i}`} className="px-1 text-muted-foreground" aria-hidden="true">…</span> : <button type="button" key={p} aria-label={t('fpr_go_page', { n: p })} aria-current={p === data.page ? 'page' : undefined} onClick={() => update({}, p)} className={`h-11 min-w-11 rounded-xl border px-2 text-sm font-semibold ${p === data.page ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold)/0.12)]' : 'border-border hover:bg-muted'}`}>{p}</button>)}<button type="button" disabled={data.page === data.pages} onClick={() => update({}, data.page + 1)} aria-label={t('fpr_next')} className="grid h-11 w-11 place-items-center rounded-xl border border-border disabled:opacity-35"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button></nav></div> : null}
    {search.terminal && !view ? <DeepSearchPanel t={t} searchId={search.id} available={deepSearchAvailable} /> : null}
  </div>;
}
