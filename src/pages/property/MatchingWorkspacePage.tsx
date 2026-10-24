/*
 * THE MATCHING WORKSPACE — /property/:id/matches (owner, 2026-10-24).
 *
 * Two products, never mixed:
 *   HOMATCH Internal        real matches between THIS property and HOMATCH members' searches;
 *                           the existing feed, server prices (3 / 5 / 10, one per person) and
 *                           unlock (atomic-unlock kind internal_leads).
 *   External Leads Database a shared, curated international catalog of potentially interested
 *                           buyers, tenants and investors; one server price per lead
 *                           (atomic-unlock kind curated_leads); not tied to the property.
 *
 * Two views: Available (browse, select, quote, unlock) and Unlocked (what this account owns:
 * full details, multi-select, "Create Email Campaign" — never a charge). Everything chosen is
 * in the URL. What may be shown is the server's (matching_workspace_state), re-read on focus,
 * on visibility, every 60 s and after any SERVICE_DISABLED answer:
 *
 *   maintenance        → the coming-soon announcement replaces the matching interface only
 *   internal = false   → no Internal marketplace (its Unlocked list stays)
 *   curated = false    → no External catalog, filters, prices, purchases or promo (Unlocked stays)
 *   unlockedLibrary=false → no "Unlocked Leads" entry; a link to Email → Contacts instead
 *   nothing to show    → a calm "no matching marketplace" state with the same link
 *
 * Nothing here sends anything to anyone; the success panel only opens the existing campaign
 * screen on a contact list.
 */
import { BookUser, Database, Info, Sparkles, Users } from 'lucide-react';
import { type ComponentType, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { RouteGuard } from '@/components/common/RouteGuard';
import { CustomerSurface, EmptyState, OWNER_SURFACE, PageHero } from '@/components/customer/surface';
import { AppLayout } from '@/components/layouts/AppLayout';
import { BTN_SECONDARY } from '@/components/leads/kit';
import { CuratedRows } from '@/components/matching/workspace/CuratedRows';
import { FilterPanel } from '@/components/matching/workspace/FilterPanel';
import { creditsToUsd, formatCount, formatCredits, formatUsd } from '@/components/matching/workspace/format';
import { InternalRows } from '@/components/matching/workspace/InternalRows';
import { MaintenanceAnnouncement } from '@/components/matching/workspace/MaintenanceAnnouncement';
import { ListSkeleton, Pagination, RangeLine } from '@/components/matching/workspace/Pagination';
import { RowCheck } from '@/components/matching/workspace/RowCheck';
import { SelectionBar, UnlockConfirmDialog, UnlockSuccess, type WsQuote } from '@/components/matching/workspace/UnlockFlow';
import {
  activeFilters, CATALOG_SORTS, filtersKey, INTERNAL_SORTS, 
  type InternalCriteria, PAGE_SIZES, parseWsUrl, type WsProduct, type WsView,writeFilters,
} from '@/components/matching/workspace/urlState';
import { useWorkspaceState } from '@/components/matching/workspace/useWorkspaceState';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { cn } from '@/lib/utils';
import type { LeadSort } from '@/services/homatchLeads';
import {
  type CatalogPage, type CatalogSort, type CuratedSelection, 
  EMPTY_FILTERS, emailCampaignPath, getCatalog, getInternalPage, type InternalPage, type MatchingFilters, newCuratedUnlockKey, newInternalUnlockKey, quoteCurated, quoteInternal,
  saveCuratedToList, saveInternalToList, serverCode, UnlockError, unlockCurated, unlockInternal} from '@/services/matchingWorkspace';

/* ── small pieces ─────────────────────────────────────────────────────────── */

interface PropertyContext { title: string | null; address: string | null; homatchId: string | null }

function Segmented<T extends string>({ items, value, onChange, label, testId, size = 'lg' }: {
  items: Array<{ value: T; label: string; count: number | null; icon?: ComponentType<{ className?: string }> }>;
  value: T;
  onChange: (v: T) => void;
  label: string;
  testId: string;
  size?: 'lg' | 'md';
}) {
  const { lang } = useLanguage();
  return (
    <div role="tablist" aria-label={label} data-testid={testId}
      className={cn('grid w-full gap-1 rounded-2xl p-1', size === 'lg' ? 'bg-[#0C1119]' : 'bg-[hsl(218_30%_94%)]',
        items.length === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
      {items.map(({ value: v, label: l, count, icon: Icon }) => {
        const on = v === value;
        return (
          <button key={v} type="button" role="tab" aria-selected={on} onClick={() => onChange(v)} data-testid={`${testId}-${v}`}
            className={cn('flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl px-2 text-center text-sm font-semibold leading-tight transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]',
              size === 'lg'
                ? on ? 'bg-[hsl(38_92%_54%)] text-[#161309] shadow-card' : 'text-white/80 hover:bg-white/10'
                : on ? 'bg-white text-[hsl(218_45%_14%)] shadow-card' : 'text-[hsl(224_14%_30%)] hover:bg-white/60')}>
            {Icon ? <Icon className="hidden h-4 w-4 shrink-0 min-[400px]:block" aria-hidden="true" /> : null}
            <span className="min-w-0 break-words">{l}</span>
            {count != null ? (
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-2xs font-bold tabular-nums',
                on ? (size === 'lg' ? 'bg-[#161309]/15' : 'bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]') : size === 'lg' ? 'bg-white/10' : 'bg-white/70')}
                dir="ltr" data-count={count}>{formatCount(count, lang)}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function ContactsLink({ testId }: { testId: string }) {
  const { t } = useLanguage();
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[hsl(224_14%_30%)]" data-testid={testId}>
      <BookUser className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
      <span>{t('mw_contacts_alt')}</span>
      <Link to="/outreach/contacts?source=CURATED_LEAD" className="font-semibold text-[hsl(218_45%_18%)] underline underline-offset-4" data-testid={`${testId}-curated`}>{t('mw_contacts_alt_external')}</Link>
      <span aria-hidden="true">·</span>
      <Link to="/outreach/contacts?source=INTERNAL_MATCH" className="font-semibold text-[hsl(218_45%_18%)] underline underline-offset-4" data-testid={`${testId}-internal`}>{t('mw_contacts_alt_internal')}</Link>
    </p>
  );
}

/* ── the page ─────────────────────────────────────────────────────────────── */

type Listing = { product: 'external'; data: CatalogPage } | { product: 'internal'; data: InternalPage };
type Selection = { mode: 'ids'; ids: Set<string> } | { mode: 'all'; key: string; exclude: Set<string> };
interface Counts { available: number; unlocked: number }
interface Success { product: WsProduct; count: number; credits: number; listId: string | null; ids: string[] }

const NO_SELECTION: Selection = { mode: 'ids', ids: new Set() };

function WorkspaceContent() {
  const { id: propertyId = '' } = useParams<{ id: string }>();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const url = useMemo(() => parseWsUrl(params), [params]);
  const { state, loaded, failed: stateFailed, refresh: refreshState } = useWorkspaceState();
  const [property, setProperty] = useState<PropertyContext | null>(null);

  /* ── what may be shown ── */
  const availableProducts = useMemo(() => [
    ...(state.internal ? ['internal' as const] : []), ...(state.curated ? ['external' as const] : []),
  ], [state.internal, state.curated]);
  const views: WsView[] = [...(availableProducts.length ? ['available' as const] : []), ...(state.unlockedLibrary ? ['unlocked' as const] : [])];
  const view: WsView | null = views.includes(url.view) ? url.view : views[0] ?? null;
  const products: WsProduct[] = view === 'unlocked' ? ['internal', 'external'] : availableProducts;
  const product: WsProduct | null = url.product && products.includes(url.product) ? url.product : products[0] ?? null;
  const apiView = view === 'unlocked' ? 'UNLOCKED' : 'AVAILABLE';
  const fKey = product ? filtersKey(product, url.filters, url.internal) : '';
  const sortExternal: CatalogSort = (CATALOG_SORTS as string[]).includes(url.sort ?? '') && !(view === 'available' && url.sort === 'UNLOCKED')
    ? url.sort as CatalogSort : view === 'unlocked' ? 'UNLOCKED' : 'NEWEST';
  const sortInternal: LeadSort = (INTERNAL_SORTS as string[]).includes(url.sort ?? '') ? url.sort as LeadSort : 'CATEGORY';

  /* ── URL writers ── */
  const patchUrl = useCallback((patch: Record<string, string | null>, keepPage = false) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) { if (v == null) next.delete(k); else next.set(k, v); }
      if (!keepPage) next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);
  const setFilters = useCallback((f: MatchingFilters, internal: InternalCriteria) => {
    setParams((prev) => writeFilters(prev, f, internal), { replace: true });
  }, [setParams]);

  /* ── the property this workspace is about ── */
  useEffect(() => {
    if (!propertyId) return;
    let alive = true;
    supabase.from('properties').select('id,title,homatch_id,facts:property_facts(address,city,district)').eq('id', propertyId).maybeSingle()
      .then(({ data }) => {
        if (!alive || !data) return;
        const row = data as { title?: string | null; homatch_id?: string | number | null; facts?: unknown };
        const facts = (Array.isArray(row.facts) ? row.facts[0] : row.facts) as { address?: string | null; city?: string | null; district?: string | null } | null | undefined;
        const address = facts?.address || [facts?.district, facts?.city].filter(Boolean).join(', ') || null;
        setProperty({ title: row.title ?? null, address, homatchId: row.homatch_id != null ? String(row.homatch_id) : null });
      });
    return () => { alive = false; };
  }, [propertyId]);

  /* ── live counts for both switches ── */
  const [internalCounts, setInternalCounts] = useState<Counts | null>(null);
  const [externalCounts, setExternalCounts] = useState<Counts | null>(null);
  const loadCounts = useCallback(async () => {
    if (!propertyId) return;
    /* A page far past the end: the counts, no rows. Both reads work while a product is off. */
    await Promise.all([
      getInternalPage(propertyId, { view: 'UNLOCKED', filters: EMPTY_FILTERS, sort: 'BEST', page: 100000 })
        .then((p) => setInternalCounts({ available: Number(p.counts?.LOCKED ?? 0), unlocked: Number(p.counts?.UNLOCKED ?? 0) }))
        .catch(() => undefined),
      getCatalog({ view: 'UNLOCKED', filters: EMPTY_FILTERS, sort: 'UNLOCKED', page: 100000, pageSize: 100 })
        .then((p) => setExternalCounts(p.counts))
        .catch(() => undefined),
    ]);
  }, [propertyId]);
  useEffect(() => { if (loaded && !state.maintenance) void loadCounts(); }, [loaded, state.maintenance, loadCounts]);

  /* ── the list ── */
  const [listing, setListing] = useState<Listing | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const requestId = useRef(0);
  const loadList = useCallback(async () => {
    if (!loaded || state.maintenance || !view || !product || !propertyId) return;
    const mine = ++requestId.current;
    setListLoading(true); setListError(null);
    try {
      const next: Listing = product === 'external'
        ? { product, data: await getCatalog({ view: apiView, filters: url.filters, sort: sortExternal, page: url.page, pageSize: url.pageSize }) }
        : { product, data: await getInternalPage(propertyId, { view: apiView, filters: url.filters, sort: sortInternal, page: url.page, criteria: url.internal.criteria, district: url.internal.district, propertyType: url.internal.propertyType }) };
      if (mine !== requestId.current) return;
      setListing(next);
      if (next.product === 'external') setExternalCounts(next.data.counts);
      else setInternalCounts({ available: Number(next.data.counts?.LOCKED ?? 0), unlocked: Number(next.data.counts?.UNLOCKED ?? 0) });
    } catch (e) {
      if (mine !== requestId.current) return;
      const code = e instanceof UnlockError ? e.code : serverCode(e);
      setListError(code);
      if (code === 'SERVICE_DISABLED') void refreshState();
    } finally {
      if (mine === requestId.current) setListLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, state.maintenance, view, product, propertyId, apiView, fKey, sortExternal, sortInternal, url.page, url.pageSize, refreshState]);
  useEffect(() => { void loadList(); }, [loadList]);

  /* ── selection: survives paging; product / view changes clear it; a filter change clears an
        "all matching" selection (it was defined by the old filters) ── */
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const scope = `${view}:${product}`;
  const lastScope = useRef(scope);
  useEffect(() => {
    if (lastScope.current !== scope) { lastScope.current = scope; setSelection(NO_SELECTION); setSelectionNotice(null); }
  }, [scope]);
  useEffect(() => {
    if (selection.mode === 'all' && selection.key !== fKey) {
      setSelection(NO_SELECTION);
      setSelectionNotice(t('mw_all_cleared_notice'));
    }
  }, [fKey, selection, t]);

  const items = listing && listing.product === product ? listing.data.items : [];
  const total = listing && listing.product === product ? listing.data.total : 0;
  const pageSize = product === 'external' ? url.pageSize : 100;
  const pageIds = useMemo(() => (listing?.product === 'external' ? listing.data.items.map((x) => x.id) : listing?.product === 'internal' ? listing.data.items.map((x) => x.matchId) : []), [listing]);
  const isSelected = useCallback((id: string) => (selection.mode === 'ids' ? selection.ids.has(id) : !selection.exclude.has(id)), [selection]);
  const selectedCount = selection.mode === 'ids' ? selection.ids.size : Math.max(0, total - selection.exclude.size);
  const toggle = useCallback((id: string) => {
    setSelectionNotice(null);
    setSelection((cur) => {
      if (cur.mode === 'ids') { const ids = new Set(cur.ids); if (ids.has(id)) ids.delete(id); else ids.add(id); return { mode: 'ids', ids }; }
      const exclude = new Set(cur.exclude); if (exclude.has(id)) exclude.delete(id); else exclude.add(id); return { ...cur, exclude };
    });
  }, []);
  const pageAllSelected = pageIds.length > 0 && pageIds.every(isSelected);
  const pageSomeSelected = pageIds.some(isSelected);
  const togglePage = () => {
    setSelectionNotice(null);
    setSelection((cur) => {
      if (cur.mode === 'all') {
        const exclude = new Set(cur.exclude);
        for (const id of pageIds) { if (pageAllSelected) exclude.add(id); else exclude.delete(id); }
        return { ...cur, exclude };
      }
      const ids = new Set(cur.ids);
      for (const id of pageIds) { if (pageAllSelected) ids.delete(id); else ids.add(id); }
      return { mode: 'ids', ids };
    });
  };
  const [selectingAll, setSelectingAll] = useState(false);
  const selectAllMatching = async () => {
    setSelectionNotice(null);
    if (product === 'external') { setSelection({ mode: 'all', key: fKey, exclude: new Set() }); return; }
    setSelectingAll(true);
    try {
      const res = await getInternalPage(propertyId, { view: apiView, filters: url.filters, sort: sortInternal, page: 1, criteria: url.internal.criteria, district: url.internal.district, propertyType: url.internal.propertyType, withIds: true });
      const ids = res.ids ?? [];
      setSelection({ mode: 'ids', ids: new Set(ids) });
      if (res.total > ids.length) setSelectionNotice(t('mw_all_capped_notice', { n: formatCount(ids.length, lang) }));
    } catch {
      toast.error(t('mw_err_generic'));
    } finally { setSelectingAll(false); }
  };

  /* ── quote (Available only): the server's numbers for exactly this selection ── */
  const curatedSelection = useMemo<CuratedSelection>(() => (selection.mode === 'all'
    ? { mode: 'all', filters: url.filters, exclude: [...selection.exclude] }
    : { mode: 'ids', ids: [...selection.ids] }), [selection, url.filters]);
  const [quote, setQuote] = useState<WsQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState(false);
  const quoteSeq = useRef(0);
  const centsPerLead = (listing?.product === 'external' ? listing.data.price?.cents : null) ?? state.curatedPrice?.cents ?? null;
  const fetchQuote = useCallback(async (): Promise<WsQuote | null> => {
    const mine = ++quoteSeq.current;
    setQuoting(true); setQuoteError(false);
    try {
      let q: WsQuote;
      if (product === 'external') {
        const r = await quoteCurated(curatedSelection);
        q = { selected: r.selected, alreadyUnlocked: r.alreadyUnlocked, newCount: r.newCount, totalCredits: r.totalCredits, balance: r.balance, active: r.active,
          usd: centsPerLead ? Math.round(r.newCount * centsPerLead) / 100 : creditsToUsd(r.totalCredits) };
      } else {
        const ids = selection.mode === 'ids' ? [...selection.ids] : [];
        const r = await quoteInternal(ids);
        const newCount = r.standardCount + r.exactCount + r.premiumCount;
        q = { selected: r.requested, alreadyUnlocked: r.alreadyUnlocked, newCount, totalCredits: r.totalCredits, balance: r.balance, active: true, usd: null };
      }
      if (mine === quoteSeq.current) setQuote(q);
      return q;
    } catch (e) {
      if (mine === quoteSeq.current) { setQuoteError(true); setQuote(null); }
      if (serverCode(e) === 'SERVICE_DISABLED' || (e instanceof UnlockError && e.code === 'SERVICE_DISABLED')) void refreshState();
      return null;
    } finally {
      if (mine === quoteSeq.current) setQuoting(false);
    }
  }, [product, curatedSelection, selection, centsPerLead, refreshState]);
  useEffect(() => {
    if (view !== 'available' || selectedCount === 0) { quoteSeq.current += 1; setQuote(null); setQuoting(false); setQuoteError(false); return undefined; }
    const timer = window.setTimeout(() => { void fetchQuote(); }, 300);
    return () => window.clearTimeout(timer);
  }, [view, selectedCount, fetchQuote]);

  /* ── unlock ── */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const unlockKey = useRef<string>('');
  const [success, setSuccess] = useState<Success | null>(null);
  const [creatingList, setCreatingList] = useState(false);
  const openConfirm = () => {
    /* One key per confirmation; retrying the same confirmation reuses it. */
    unlockKey.current = product === 'external' ? newCuratedUnlockKey() : newInternalUnlockKey();
    setUnlockError(null); setConfirmOpen(true);
  };
  const requote = async () => {
    setUnlockError(null);
    unlockKey.current = product === 'external' ? newCuratedUnlockKey() : newInternalUnlockKey();
    await fetchQuote();
  };
  const confirmUnlock = async () => {
    if (!quote || unlocking || !product) return;
    setUnlocking(true); setUnlockError(null);
    try {
      let done: Success;
      if (product === 'external') {
        const r = await unlockCurated(curatedSelection, quote.totalCredits, unlockKey.current);
        done = { product, count: r.unlockedCount, credits: r.chargedCredits, listId: r.listId, ids: r.unlocked };
      } else {
        const ids = selection.mode === 'ids' ? [...selection.ids] : [];
        const r = await unlockInternal(ids, unlockKey.current);
        done = { product, count: r.unlocked.length, credits: r.chargedCredits, listId: null, ids: [...r.unlocked, ...r.alreadyUnlocked] };
      }
      setConfirmOpen(false);
      setSelection(NO_SELECTION);
      setSelectionNotice(null);
      setSuccess(done);
      void loadList();
      void loadCounts();
    } catch (e) {
      const code = e instanceof UnlockError ? e.code : 'INTERNAL';
      setUnlockError(code);
      if (code === 'SERVICE_DISABLED' || code === 'PRODUCT_DISABLED') void refreshState();
    } finally {
      setUnlocking(false);
    }
  };
  const openCampaign = async (p: WsProduct, ids: string[], listId: string | null) => {
    if (creatingList) return;
    setCreatingList(true);
    try {
      const id = listId ?? (p === 'external' ? await saveCuratedToList(ids) : await saveInternalToList(ids)).listId;
      navigate(emailCampaignPath(id, propertyId));
    } catch (e) {
      toast.error(t(e instanceof UnlockError && e.code === 'NOTHING_SELECTED' ? 'mw_err_nothing_unlocked' : 'mw_err_generic'));
    } finally {
      setCreatingList(false);
    }
  };

  /* ── render ── */
  const heading = (
    <div className="pt-4 sm:pt-5">
      <PageHero compact eyebrow={t('mw_eyebrow')} title={property?.title || t('mw_title_fallback')}
        subtitle={[property?.address, property?.homatchId ? `HOMATCH ${property.homatchId}` : null].filter(Boolean).join(' · ') || null} />
    </div>
  );

  let body: ReactNode;
  if (!loaded) {
    body = <div className="mt-5"><ListSkeleton rows={4} /></div>;
  } else if (stateFailed && !views.length) {
    body = <EmptyState className="mt-5" icon={Users} title={t('mw_err_generic')} actions={<button type="button" className={BTN_SECONDARY} onClick={() => void refreshState()}>{t('mw_retry')}</button>} />;
  } else if (state.maintenance) {
    body = <div className="mt-5"><MaintenanceAnnouncement /></div>;
  } else if (!view || !product) {
    body = (
      <div className="mt-5 space-y-4" data-testid="mw-empty-marketplace">
        <EmptyState icon={Database} title={t('mw_none_title')} body={t('mw_none_body')} />
        <ContactsLink testId="mw-library-alt" />
      </div>
    );
  } else {
    const viewCounts = {
      available: (state.internal ? internalCounts?.available ?? 0 : 0) + (state.curated ? externalCounts?.available ?? 0 : 0),
      unlocked: (internalCounts?.unlocked ?? 0) + (externalCounts?.unlocked ?? 0),
    };
    const productCount = (p: WsProduct) => {
      const c = p === 'internal' ? internalCounts : externalCounts;
      return c ? (view === 'unlocked' ? c.unlocked : c.available) : null;
    };
    const anyFilter = activeFilters(product, url.filters, url.internal) > 0;
    const facets = listing?.product === 'external' && product === 'external'
      ? { countries: listing.data.facets.countries, languages: listing.data.facets.languages, interests: listing.data.facets.interests }
      : listing?.product === 'internal' && product === 'internal'
        ? { ...listing.data.facets, criteriaCounts: listing.data.counts }
        : null;
    const price = listing?.product === 'external' ? listing.data.price ?? state.curatedPrice : state.curatedPrice;
    const internalPrices = listing?.product === 'internal' ? listing.data.prices : null;
    const sortControl = (
      <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[hsl(224_14%_30%)]">
        <span className="shrink-0">{t('mw_sort')}</span>
        <select className="min-h-11 min-w-0 rounded-xl border border-[hsl(var(--border))] bg-white px-2 text-sm font-semibold text-[hsl(224_14%_12%)]" data-testid="mw-sort"
          value={product === 'external' ? sortExternal : sortInternal} onChange={(e) => patchUrl({ sort: e.target.value })}>
          {product === 'external'
            ? CATALOG_SORTS.filter((s) => view === 'unlocked' || s !== 'UNLOCKED').map((s) => <option key={s} value={s}>{t(`mw_sort_${s}`)}</option>)
            : INTERNAL_SORTS.map((s) => <option key={s} value={s}>{t(`hl_sort_${s.toLowerCase()}`)}</option>)}
        </select>
      </label>
    );
    const sizeControl = product === 'external' ? (
      <label className="flex items-center gap-2 text-xs font-semibold text-[hsl(224_14%_30%)]">
        <span className="shrink-0">{t('mw_page_size')}</span>
        <select className="min-h-11 rounded-xl border border-[hsl(var(--border))] bg-white px-2 text-sm font-semibold text-[hsl(224_14%_12%)]" data-testid="mw-page-size"
          value={url.pageSize} onChange={(e) => patchUrl({ size: e.target.value === '100' ? null : e.target.value })}>
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
    ) : null;

    body = (
      <div className="mt-4 space-y-4">
        {views.length > 1 ? (
          <Segmented<WsView> testId="mw-view" label={t('mw_view_label')} value={view}
            onChange={(v) => patchUrl({ view: v === 'available' ? null : v })}
            items={[
              { value: 'available', label: t('mw_view_available'), count: viewCounts.available, icon: Sparkles },
              { value: 'unlocked', label: t('mw_view_unlocked'), count: viewCounts.unlocked, icon: BookUser },
            ]} />
        ) : (
          <h2 className="font-display text-lg font-semibold text-[hsl(218_45%_14%)]" data-testid="mw-view-single" data-view={view}>
            {t(view === 'available' ? 'mw_view_available' : 'mw_view_unlocked')}
          </h2>
        )}
        {!state.unlockedLibrary ? <ContactsLink testId="mw-library-alt" /> : null}

        <Segmented<WsProduct> testId="mw-product" size="md" label={t('mw_product_label')} value={product}
          onChange={(p) => patchUrl({ product: p })}
          items={products.map((p) => ({ value: p, label: t(p === 'internal' ? 'mw_product_internal' : 'mw_product_external'), count: productCount(p), icon: p === 'internal' ? Users : Database }))} />

        {success ? (
          <UnlockSuccess count={success.count} credits={success.credits} creating={creatingList}
            onCreateCampaign={success.ids.length || success.listId ? () => void openCampaign(success.product, success.ids, success.listId) : null}
            onViewUnlocked={state.unlockedLibrary ? () => { setSuccess(null); patchUrl({ view: 'unlocked', product: success.product }); } : null}
            onDismiss={() => setSuccess(null)} />
        ) : null}

        {/* What this product is — only for the marketplace (Available). */}
        {view === 'available' ? (
          product === 'external' ? (
            <section className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-card sm:p-5" data-testid="mw-promo" data-product="external">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h2 className="font-display text-base font-semibold text-[hsl(218_45%_14%)]">{t('mw_external_title')}</h2>
                  <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-[hsl(224_14%_28%)]">{t('mw_external_body')}</p>
                </div>
                {price ? (
                  <p className="shrink-0 rounded-xl bg-[#0C1119] px-3 py-2 text-sm font-bold text-white" data-testid="mw-external-price">
                    <span className="text-[hsl(38_92%_62%)]" dir="ltr">{t(price.credits === 1 ? 'mw_credit_one' : 'mw_credits_n', { n: formatCredits(price.credits, lang) })}</span>
                    <span className="ms-1.5 font-semibold text-white/80" dir="ltr">= {formatUsd(price.cents ? price.cents / 100 : creditsToUsd(price.credits), lang)}</span>
                    <span className="ms-1.5 font-normal text-white/70">{t('mw_per_lead')}</span>
                  </p>
                ) : null}
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground" data-testid="mw-consent-note">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{t('mw_consent_note')}
              </p>
            </section>
          ) : (
            <section className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-card sm:p-5" data-testid="mw-promo" data-product="internal">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <h2 className="font-display text-base font-semibold text-[hsl(218_45%_14%)]">{t('mw_internal_title')}</h2>
                  <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-[hsl(224_14%_28%)]">{t('mw_internal_body')}</p>
                </div>
                {internalPrices ? (
                  <dl className="grid shrink-0 grid-cols-3 gap-2 sm:w-80" data-testid="mw-internal-prices">
                    {([['EXACT', internalPrices.EXACT], ['NEARBY_SIMILAR', internalPrices.STANDARD], ['VIP', internalPrices.PREMIUM]] as const).map(([cat, n]) => (
                      <div key={cat} className={cn('min-w-0 rounded-xl px-2.5 py-2', cat === 'VIP' ? 'bg-[#0C1119] text-white' : 'border border-[hsl(var(--border))] bg-white')} data-price={cat}>
                        <dt className={cn('text-2xs font-semibold uppercase leading-tight tracking-[0.08em] [overflow-wrap:anywhere]', cat === 'VIP' ? 'text-[hsl(38_92%_62%)]' : 'text-[hsl(224_10%_40%)]')}>{t(`hl_cat_${cat}`)}</dt>
                        <dd className="mt-0.5 font-display text-base font-bold" dir="ltr">{t(n === 1 ? 'mw_credit_one' : 'mw_credits_n', { n: formatCredits(n, lang) })}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{t('mw_internal_prices_note')}</p>
            </section>
          )
        ) : (
          <p className="text-sm text-[hsl(224_14%_30%)]" data-testid="mw-library-intro">{t(product === 'external' ? 'mw_library_intro_external' : 'mw_library_intro_internal')}</p>
        )}

        <FilterPanel product={product} filters={url.filters} internal={url.internal} facets={facets} onChange={setFilters}
          extra={<>{sortControl}{sizeControl}</>} />

        {/* Selection tools + the range line. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {items.length ? (
              <span className="inline-flex items-center gap-1 rounded-xl border border-[hsl(var(--border))] bg-white pe-3 text-sm font-semibold">
                <RowCheck checked={pageAllSelected} indeterminate={pageSomeSelected} onChange={togglePage} label={t('mw_select_page')} testId="mw-select-page" />
                <span>{t('mw_select_page')}</span>
              </span>
            ) : null}
            {view === 'available' && total > items.length ? (
              <button type="button" onClick={() => void selectAllMatching()} disabled={selectingAll || (selection.mode === 'all' && selection.exclude.size === 0)}
                className="min-h-11 rounded-xl px-2 text-sm font-semibold text-[hsl(218_45%_18%)] underline underline-offset-4 disabled:no-underline disabled:opacity-60" data-testid="mw-select-all-matching">
                {t(product === 'internal' && total > 500 ? 'mw_select_all_capped' : 'mw_select_all_matching', { n: formatCount(product === 'internal' ? Math.min(total, 500) : total, lang) })}
              </button>
            ) : null}
            {selectedCount > 0 && view === 'unlocked' ? (
              <button type="button" className={BTN_SECONDARY} onClick={() => setSelection(NO_SELECTION)}>{t('mw_clear_selection')}</button>
            ) : null}
          </div>
          <RangeLine page={url.page} pageSize={pageSize} total={total} />
        </div>
        {selectionNotice && selectedCount === 0 ? (
          <p className="rounded-xl border border-[hsl(40_60%_80%)] bg-[hsl(42_100%_97%)] px-3 py-2 text-sm text-[hsl(34_70%_26%)]" role="status" data-testid="mw-selection-notice">{selectionNotice}</p>
        ) : null}

        {view === 'unlocked' ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-[#0C1119] p-3 text-white sm:flex-row sm:items-center sm:justify-between sm:p-4" data-testid="mw-library-actions">
            <p className="text-sm" aria-live="polite">{selectedCount ? t('mw_selected_n', { n: formatCount(selectedCount, lang) }) : t('mw_library_select_hint')}</p>
            <button type="button" disabled={!selectedCount || creatingList} data-testid="mw-library-campaign"
              onClick={() => void openCampaign(product, selection.mode === 'ids' ? [...selection.ids] : [], null)}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[hsl(38_92%_54%)] px-5 text-[15px] font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)] disabled:cursor-not-allowed disabled:opacity-50">
              {t('mw_create_campaign')}
            </button>
          </div>
        ) : null}

        <div aria-live="polite" aria-busy={listLoading}>
          {listLoading && (!listing || listing.product !== product) ? (
            <ListSkeleton />
          ) : listError ? (
            <EmptyState icon={Users} title={t(listError === 'SERVICE_DISABLED' ? 'mw_err_disabled' : 'mw_err_load')}
              actions={<button type="button" className={BTN_SECONDARY} onClick={() => void loadList()} data-testid="mw-retry">{t('mw_retry')}</button>} />
          ) : !items.length ? (
            <EmptyState icon={product === 'external' ? Database : Users}
              title={t(anyFilter ? 'mw_empty_filtered_title' : view === 'unlocked' ? 'mw_empty_unlocked_title' : 'mw_empty_title')}
              body={t(anyFilter ? 'mw_empty_filtered_body' : view === 'unlocked' ? 'mw_empty_unlocked_body' : product === 'external' ? 'mw_empty_external_body' : 'mw_empty_internal_body')}
              actions={anyFilter ? <button type="button" className={BTN_SECONDARY} onClick={() => setFilters({ ...EMPTY_FILTERS }, { criteria: [], district: null, propertyType: null })}>{t('mw_clear_all')}</button> : undefined} />
          ) : (
            <div className={cn(listLoading && 'opacity-60 transition-opacity')}>
              {listing?.product === 'external'
                ? <CuratedRows items={listing.data.items} view={apiView} price={price} isSelected={isSelected} onToggle={toggle} />
                : listing?.product === 'internal'
                  ? <InternalRows items={listing.data.items} view={apiView} isSelected={isSelected} onToggle={toggle} />
                  : null}
            </div>
          )}
        </div>

        <Pagination page={url.page} pageSize={pageSize} total={total} onPage={(p) => { patchUrl({ page: p > 1 ? String(p) : null }, true); window.scrollTo({ top: 0 }); }} />
      </div>
    );
  }

  const showBar = !state.maintenance && view === 'available' && selectedCount > 0 && !!product;
  return (
    <AppLayout noPadding surfaceClass={OWNER_SURFACE}>
      <CustomerSurface className={showBar ? 'pb-56 md:pb-40' : 'pb-24'}>
        <div data-testid="mw-page" data-view={view ?? ''} data-product={product ?? ''}>
          {heading}
          {body}
        </div>
      </CustomerSurface>
      {showBar && product ? (
        <SelectionBar product={product} count={selectedCount} quote={quote} quoting={quoting} quoteError={quoteError}
          notice={selectionNotice} onClear={() => { setSelection(NO_SELECTION); setSelectionNotice(null); }} onUnlock={openConfirm} />
      ) : null}
      {product ? (
        <UnlockConfirmDialog open={confirmOpen} product={product} quote={quote} busy={unlocking} error={unlockError}
          onConfirm={() => void confirmUnlock()} onClose={() => setConfirmOpen(false)} onRequote={() => void requote()} />
      ) : null}
    </AppLayout>
  );
}

export default function MatchingWorkspacePage() {
  return (
    <RouteGuard>
      <WorkspaceContent />
    </RouteGuard>
  );
}
