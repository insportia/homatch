import { ArrowLeft, Bookmark, Check, ChevronLeft, ChevronRight, Copy, LayoutGrid, Loader2, SlidersHorizontal, Sparkles, Telescope, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { BriefEdit } from '@/research-core/marketplace/brief';
import { filtersFromParams, pageNumbers, type ResultFilters, resultParams } from '@/research-core/marketplace/browse-results';
import { assessProperty, isRecommended } from '@/research-core/marketplace/advisor';
import { browseSearchResults, MarketplaceError, propertyDetail, type PropertyView, type SearchBrowsePage, type SearchSummary } from '@/services/marketplaceSearch';
import { useSavedKeys } from '@/services/savedListings';
import type { T } from './format';
import { PropertyCard } from './PropertyCard';
import { ResultsHeader } from './workspace/ResultsHeader';
import { DeepSearchPanel } from './workspace/DeepSearchPanel';
import { NativeMatchesPanel } from '@/components/matching/NativeMatchesPanel';
import { ResultFiltersPanel } from './ResultFiltersPanel';
import { SourceChips } from './workspace/SourceChips';
import { DuplicateListings } from './DuplicateListings';

/*
 * Results (owner, 2026-10-17): one persistent switch — All results | Best matches |
 * Favorites — that never disappears, one compact Filters button, and everything else
 * (sources, sorting, refinements, possible duplicates) behind that button. The view
 * lives in the URL (?view=best|favorites|duplicates), so a property page and Back
 * return to exactly the same view and filters.
 */
type View = 'all' | 'best' | 'favorites' | 'duplicates' | 'paid';
const VIEWS: readonly View[] = ['all', 'best', 'favorites', 'duplicates', 'paid'];
/** View-owned filters: switching views sets them, the filter panel and "clear" never touch them. */
const VIEW_FILTERS = ['fp_strongOnly', 'fp_duplicatesOnly', 'fp_socialOnly'];
const FAVORITES_MAX = 60;

/** Favorites of THIS search: the customer's saved keys that resolve to one of its properties. */
function useFavoriteProperties(searchId: string, keys: ReadonlySet<string>, ready: boolean) {
  // The saved set is one shared Set mutated in place: key the memo on its contents, not its identity.
  const signature = [...keys].join('|');
  const mine = useMemo(() => [...keys].filter((k) => k.startsWith('mp:')).map((k) => k.slice(3)).slice(0, FAVORITES_MAX),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature]);
  const [found, setFound] = useState<Map<string, PropertyView | null>>(() => new Map());
  useEffect(() => {
    if (!ready) return;
    const missing = mine.filter((k) => !found.has(k));
    if (!missing.length) return;
    let alive = true;
    void Promise.all(missing.map((k) => propertyDetail(searchId, k).then((r) => [k, r.property] as const).catch(() => [k, null] as const)))
      .then((rows) => { if (alive) setFound((prev) => new Map([...prev, ...rows])); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchId, mine.join('|'), ready]);
  // A key removed from Favorites leaves at once; one added appears when its dossier loads.
  const items = mine.map((k) => found.get(k)).filter((p): p is PropertyView => !!p);
  return { items, loading: !ready || mine.some((k) => !found.has(k)) };
}

export function ResultsView({ t, search, onOpen, compare, onToggleCompare, onNewSearch, onChangeCriteria, deepSearchAvailable, deepOffered = true, version }: {
  t: T; deepOffered?: boolean; search: SearchSummary; onOpen: (p: PropertyView) => void; compare: string[]; onToggleCompare: (p: PropertyView) => void;
  onNewSearch: () => void; onChangeCriteria: (edit: BriefEdit | null) => void; deepSearchAvailable: boolean; version: number;
}) {
  const [params, setParams] = useSearchParams();
  const asked: View = (VIEWS as readonly string[]).includes(params.get('view') ?? '') ? params.get('view') as View : 'all';
  /* No paid results view while paid Deep Search is paused: an old ?view=paid link shows the free list. */
  const view: View = asked === 'paid' && !deepOffered ? 'all' : asked;
  const filters = filtersFromParams(params), filterKey = JSON.stringify(filters);
  const requestedPage = Math.max(1, Math.trunc(Number(params.get('page'))) || 1);
  const revision = params.get('revision') ?? undefined;
  const [data, setData] = useState<SearchBrowsePage | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [counts, setCounts] = useState<{ all: number; best: number; paid: number } | null>(null);
  const initialVersion = useRef(version), heading = useRef<HTMLDivElement>(null);
  const loadedQuery = useRef<string | null>(null);
  const saved = useSavedKeys();
  const favorites = useFavoriteProperties(search.id, saved.keys, saved.ready);

  useEffect(() => {
    if (view === 'favorites') { setLoading(false); return; }
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
      // The counts on the switch describe the whole search, not the current refinement.
      if (!filters.strongOnly && !filters.duplicatesOnly && !filters.socialOnly) setCounts({ all: page.totalCurrent, best: page.summary.strong, paid: page.facets.social ?? 0 });
      else setCounts((c) => (c ? { ...c, paid: page.facets.social ?? c.paid } : c));
      if (!revision || page.page !== requestedPage) {
        const next = new URLSearchParams(params); next.set('revision', page.revision); next.set('page', String(page.page)); setParams(next, { replace: true });
      }
    }).catch((e) => { if (alive) setError(e instanceof MarketplaceError ? e.code : 'REQUEST_FAILED'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.id, filterKey, requestedPage, revision, retry, view]);

  const update = (patch: Partial<ResultFilters>, page?: number) => { setParams(resultParams(params, patch, page)); if (page !== undefined) heading.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  const openView = (v: View) => {
    const next = new URLSearchParams(params);
    for (const key of VIEW_FILTERS) next.delete(key);
    next.set('page', '1');
    if (v === 'best') next.set('fp_strongOnly', 'true');
    if (v === 'duplicates') next.set('fp_duplicatesOnly', 'true');
    if (v === 'paid') next.set('fp_socialOnly', 'true');
    if (v === 'all') next.delete('view'); else next.set('view', v);
    setParams(next);
    if (v === 'duplicates') setFiltersOpen(false);
  };
  const reset = () => { const next = new URLSearchParams(params); for (const key of [...next.keys()]) if (key.startsWith('fp_') && !VIEW_FILTERS.includes(key)) next.delete(key); next.set('page', '1'); setParams(next); };
  const refresh = () => { const next = new URLSearchParams(params); next.delete('revision'); next.set('page', '1'); initialVersion.current = version; setParams(next); setRetry((n) => n + 1); };
  const changed = error === 'RESULTS_CHANGED' || version !== initialVersion.current;
  const showItems = !loading && !error && view !== 'favorites';
  const sorted = !!filters.sort && filters.sort !== 'RANKED';
  const flat = sorted || view !== 'all';
  const activeFilters = Object.keys(filters).filter((key) => !['sort', 'section', 'strongOnly', 'duplicatesOnly', 'socialOnly'].includes(key)).length;
  const card = (p: PropertyView) => <PropertyCard key={p.key} p={p} t={t} brief={search.brief} searchId={search.id} transaction={search.brief.transactionType?.value ?? null} onOpen={() => onOpen(p)} compareSelected={compare.includes(p.key)} onToggleCompare={() => onToggleCompare(p)} />;
  /* Every home found (owner, 2026-10-18): the ones that fit, then those outside the request. */
  const outside = data && !flat ? data.items.filter((p) => p.group === 'OTHER') : [];
  const fitting = data && !flat ? data.items.filter((p) => p.group !== 'OTHER') : [];
  const recommended = fitting.filter((p) => isRecommended(assessProperty(p, search.brief)));
  const others = fitting.filter((p) => !recommended.includes(p));
  const dupCount = data ? data.facets.duplicates + (data.facets.possibleDuplicates ?? 0) : 0;
  const viewCard = (p: PropertyView) => view === 'duplicates'
    ? <div key={p.key} className="space-y-2" data-duplicate-group={p.key}>{card(p)}<DuplicateListings p={p} t={t} open /></div>
    : card(p);

  const tab = (v: Exclude<View, 'duplicates'>, label: string, n: number | null, Icon: typeof Sparkles) => {
    const on = view === v;
    return (
      /* Phones: icon + count above a full label (never truncated, owner 2026-10-18); wider: one row. */
      <button type="button" role="tab" aria-selected={on} onClick={() => openView(v)} data-view-tab={v}
        className={`flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-1 text-xs font-semibold leading-tight transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] sm:min-h-[44px] sm:flex-row sm:gap-1.5 sm:px-2 sm:py-0 sm:text-sm ${on ? 'bg-[#0C1119] text-white shadow-sm' : 'text-foreground/75 hover:bg-muted hover:text-foreground'}`}>
        <span className="flex items-center gap-1">
          <Icon className={`h-4 w-4 shrink-0 ${on ? 'text-[hsl(var(--gold))]' : 'text-[hsl(var(--gold-ink))]'}`} aria-hidden="true" />
          {n !== null ? <span className={`shrink-0 rounded-full px-1.5 text-2xs tabular-nums sm:hidden ${on ? 'bg-white/15 text-[hsl(var(--gold))]' : 'bg-muted text-muted-foreground'}`}>{n}</span> : null}
        </span>
        <span className="max-w-full text-center [overflow-wrap:anywhere]" data-view-label>{label}</span>
        {n !== null ? <span className={`hidden shrink-0 rounded-full px-1.5 text-2xs tabular-nums sm:inline ${on ? 'bg-white/15 text-[hsl(var(--gold))]' : 'bg-muted text-muted-foreground'}`}>{n}</span> : null}
      </button>
    );
  };

  return <div className="space-y-5">
    <ResultsHeader t={t} search={search} data={data} onNewSearch={onNewSearch} onChangeCriteria={onChangeCriteria} headingRef={heading} />
    {/* HOMATCH members whose property fits these requirements, from the native matcher.
        Private messaging; a number only as the server allows. Renders nothing when empty. */}
    {view === 'all' ? <NativeMatchesPanel role="SEEKER" /> : null}

    {/* The primary navigation: always rendered, in every view, so one tap always leads back. */}
    <div className="sticky top-2 z-20 space-y-2">
      <div className="flex min-w-0 items-stretch gap-2">
        <nav role="tablist" aria-label={t('fpv_result_views')} className="flex min-w-0 flex-1 gap-1 rounded-2xl border border-border bg-card/95 p-1 shadow-sm backdrop-blur" data-result-views>
          {tab('all', t('fpv_tab_all'), counts?.all ?? (view === 'all' ? data?.totalCurrent ?? null : null), LayoutGrid)}
          {tab('best', t('fpv_tab_best'), counts?.best ?? (view === 'best' ? data?.total ?? null : null), Sparkles)}
          {tab('favorites', t('fpv_tab_favorites'), saved.ready ? favorites.items.length : null, Bookmark)}
          {/* The paid search's own results: only once a campaign has delivered some (or while open). */}
          {deepOffered && ((counts?.paid ?? 0) > 0 || view === 'paid') ? tab('paid', t('fpv_tab_paid'), counts?.paid ?? (view === 'paid' ? data?.total ?? null : null), Telescope) : null}
        </nav>
        <button type="button" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} aria-controls="fp-filters-panel" data-action="toggle-filters"
          aria-label={t('fpv_filters')} title={t('fpv_filters')}
          className={`relative grid min-h-[44px] w-12 shrink-0 place-items-center self-stretch rounded-2xl border shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] ${filtersOpen ? 'border-[#0C1119] bg-[#0C1119] text-white' : 'border-border bg-card/95 text-foreground hover:border-[hsl(var(--gold-border))]'}`}>
          {filtersOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />}
          {activeFilters && !filtersOpen ? <span className="absolute -end-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[hsl(var(--gold))] px-1 text-2xs font-bold text-[#0C1119]">{activeFilters}</span> : null}
        </button>
      </div>
    </div>

    {filtersOpen && data ? (
      <section id="fp-filters-panel" aria-label={t('fpv_filters')} className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5" data-filters>
        <SourceChips t={t} sources={data.facets.sources} total={data.totalCurrent} active={filters.source} onChange={(source) => update({ source }, 1)} />
        <ResultFiltersPanel t={t} filters={filters} facets={data.facets} onChange={update} />
        {dupCount > 0 ? (
          <button type="button" onClick={() => openView('duplicates')} data-action="open-duplicates"
            className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl border border-dashed border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.05)] px-4 text-start text-sm font-semibold transition hover:bg-[hsl(var(--gold)/0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
            <span className="inline-flex min-w-0 items-center gap-2"><Copy className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" /><span className="min-w-0">{t('fpv_dups_cta', { n: dupCount })}</span></span>
            <ChevronRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
          </button>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <button type="button" onClick={reset} className="min-h-[44px] rounded-xl px-4 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">{t('fpr_clear')}</button>
          <button type="button" onClick={() => setFiltersOpen(false)} data-action="apply-filters" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#0C1119] px-5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]"><Check className="h-4 w-4" aria-hidden="true" />{t('fpv_filters_apply', { n: data.total })}</button>
        </div>
      </section>
    ) : null}

    {view === 'duplicates' ? (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#0C1119] p-4 text-white" data-results-view="duplicates">
        <p className="inline-flex min-w-0 items-center gap-2 font-semibold"><Copy className="h-4 w-4 shrink-0 text-[hsl(var(--gold))]" aria-hidden="true" /><span className="min-w-0">{t('fpv_dups_title')}</span></p>
        <button type="button" onClick={() => openView('all')} data-action="all-results" className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white/20 px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]"><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t('fpv_all_results')}</button>
      </div>
    ) : null}

    {view === 'paid' ? (
      <div className="space-y-1 rounded-2xl bg-[linear-gradient(160deg,#121A26_0%,#0C1119_70%)] p-4 text-white" data-results-view="paid">
        <p className="inline-flex min-w-0 items-center gap-2 font-semibold"><Telescope className="h-4 w-4 shrink-0 text-[hsl(var(--gold))]" aria-hidden="true" /><span className="min-w-0">{t('fpv_paid_title')}</span></p>
        <p className="max-w-[75ch] text-sm leading-relaxed text-white/70">{t('fpv_paid_body')}</p>
      </div>
    ) : null}

    {changed ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4" role="status"><p className="text-sm">{t('fpr_results_changed')}</p><button type="button" onClick={refresh} className="min-h-[44px] rounded-xl border border-border px-4 text-sm font-semibold">{t('fpr_refresh')}</button></div> : null}
    {error && error !== 'RESULTS_CHANGED' && view !== 'favorites' ? <div role="alert" className="space-y-3 rounded-2xl border border-border bg-card p-4"><p>{t('mps_error_generic')}</p><button type="button" onClick={() => setRetry((n) => n + 1)} className="min-h-[44px] rounded-xl border px-4">{t('fpr_retry')}</button></div> : null}
    {loading || (view === 'favorites' && favorites.loading && !favorites.items.length) ? <div role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />{t('fpr_loading')}</div> : null}

    {view === 'favorites' && !(favorites.loading && !favorites.items.length) ? (
      favorites.items.length ? <section aria-labelledby="mps-g-FAV" className="space-y-3" data-results-group="favorites"><h2 id="mps-g-FAV" className="sr-only">{t('fpv_tab_favorites')}</h2><div className="grid gap-4">{favorites.items.map(card)}</div></section>
        : <section className="space-y-2 rounded-2xl border border-dashed border-[hsl(var(--gold-border))] bg-card p-6 text-center" data-favorites-empty><Bookmark className="mx-auto h-6 w-6 text-[hsl(var(--gold-ink))]" aria-hidden="true" /><p className="font-display text-lg font-semibold">{t('fpv_fav_empty_title')}</p><p className="mx-auto max-w-[48ch] text-sm text-muted-foreground">{t('fpv_fav_empty_body')}</p></section>
    ) : null}

    {showItems && data && data.total === 0 && (search.terminal || data.totalCurrent > 0) ? <section className="space-y-3 rounded-2xl border border-border bg-card p-5 sm:p-6" aria-labelledby="mps-empty"><h2 id="mps-empty" className="font-display text-xl font-semibold">{t(view === 'paid' ? 'fpv_paid_empty_title' : data.totalCurrent ? 'fpr_filtered_empty' : 'mps_empty_title')}</h2><p className="max-w-[70ch] text-sm text-muted-foreground">{t(view === 'paid' ? 'fpv_paid_empty_body' : data.totalCurrent ? 'fpr_filtered_empty_body' : 'fpr_empty_hard')}</p><div className="flex flex-wrap gap-2">{data.totalCurrent ? <button type="button" onClick={() => { reset(); openView('all'); }} className="min-h-[44px] rounded-xl border border-border px-4 text-sm">{t('fpr_clear')}</button> : <><button type="button" onClick={() => onChangeCriteria({ field: 'area', value: null })} className="min-h-[44px] rounded-xl border border-border px-4 text-sm">{t('mps_empty_area')}</button><button type="button" onClick={() => onChangeCriteria({ field: 'price', value: null })} className="min-h-[44px] rounded-xl border border-border px-4 text-sm">{t('mps_empty_budget')}</button></>}</div></section> : null}
    {showItems && data && flat && data.total > 0 ? <section aria-labelledby="mps-g-SORTED" className="space-y-3" data-results-group={view === 'all' ? 'SORTED' : view}><h2 id="mps-g-SORTED" className={view !== 'all' ? 'sr-only' : 'font-display text-lg font-semibold sm:text-xl'}>{view === 'best' ? t('fpv_best_title') : view === 'duplicates' ? t('fpv_dups_title') : view === 'paid' ? t('fpv_paid_title') : t(`fpr_sort_${filters.sort}`)}</h2>{view === 'best' ? <p className="max-w-[75ch] text-sm text-muted-foreground">{t('fpv_best_body')}</p> : null}<div className="grid gap-4">{data.items.map(viewCard)}</div></section> : null}
    {showItems && recommended.length ? <section aria-labelledby="mps-g-REC" className="space-y-3" data-results-group="RECOMMENDED"><div><h2 id="mps-g-REC" className="font-display text-lg font-semibold sm:text-xl">{t('fpv_rec_title')}</h2><p className="mt-1 max-w-[75ch] text-sm text-muted-foreground">{t('fpv_rec_body')}</p></div><div className="grid gap-4">{recommended.map(card)}</div></section> : null}
    {showItems && others.length ? <section aria-labelledby="mps-g-OTHER" className="space-y-3" data-results-group="OTHER"><div><h2 id="mps-g-OTHER" className="font-display text-lg font-semibold sm:text-xl">{t('fpv_other_title')}</h2><p className="mt-1 max-w-[75ch] text-sm text-muted-foreground">{t('fpv_other_body')}</p></div><div className="grid gap-4">{others.map(card)}</div></section> : null}
    {showItems && outside.length ? <section aria-labelledby="mps-g-OUTSIDE" className="space-y-3" data-results-group="OUTSIDE"><div><h2 id="mps-g-OUTSIDE" className="font-display text-lg font-semibold sm:text-xl">{t('fpv_outside_title')}</h2><p className="mt-1 max-w-[75ch] text-sm text-muted-foreground">{t('fpv_outside_body')}</p></div><div className="grid gap-4">{outside.map(card)}</div></section> : null}
    {showItems && data && data.total > 0 ? <div className="space-y-3 border-t border-border pt-5"><p className="text-center text-xs text-muted-foreground" role="status">{t('fpr_page_status', { from: (data.page - 1) * data.pageSize + 1, to: Math.min(data.page * data.pageSize, data.total), total: data.total })}</p><nav aria-label={t('fpr_pagination')} className="flex flex-wrap items-center justify-center gap-1.5" dir="ltr"><button type="button" disabled={data.page === 1} onClick={() => update({}, data.page - 1)} aria-label={t('fpr_previous')} className="grid h-11 w-11 place-items-center rounded-xl border border-border disabled:opacity-35"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>{pageNumbers(data.page, data.pages).map((p, i) => p === 'gap' ? <span key={`gap-${i}`} className="px-1 text-muted-foreground" aria-hidden="true">…</span> : <button type="button" key={p} aria-label={t('fpr_go_page', { n: p })} aria-current={p === data.page ? 'page' : undefined} onClick={() => update({}, p)} className={`h-11 min-w-11 rounded-xl border px-2 text-sm font-semibold ${p === data.page ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold)/0.12)]' : 'border-border hover:bg-muted'}`}>{p}</button>)}<button type="button" disabled={data.page === data.pages} onClick={() => update({}, data.page + 1)} aria-label={t('fpr_next')} className="grid h-11 w-11 place-items-center rounded-xl border border-border disabled:opacity-35"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button></nav></div> : null}
    {deepOffered && search.terminal && view === 'all' ? <DeepSearchPanel t={t} searchId={search.id} available={deepSearchAvailable} /> : null}
  </div>;
}

