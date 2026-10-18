// HOMATCH LEADS — "Your Matching Buyers" for one property.
//
// Every eligible HOMATCH member whose stated search fits this listing, ranked by the
// engine's match score, anonymised and free to browse. The owner unlocks only the
// contacts they want to approach (Standard 3 / VIP 10 credits at 10 credits = $1, once
// per member; the server prices every unlock).
// Paged on the server; filters and sort live in the URL so Back/refresh keep them.
// Opening the page also asks the matcher to evaluate this listing against every
// active search now, and marks what the owner has seen (for "Fresh Matches").
//
// DEMO MODE (?demo=1): for the owner of the listing who is in the demo audience (the
// server decides — owner_demo_lead_available), an entry card opens a simulated journey
// with one fictional buyer in place of the feed. See components/leads/demo.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, FlaskConical, Loader2, Lock, RefreshCw, Sparkles, Users } from 'lucide-react';
import { toast } from 'sonner';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { CustomerSurface, DISCOVERY_SURFACE, EmptyState, PageHero } from '@/components/customer/surface';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { cn } from '@/lib/utils';
import {
  getLeadFeedV2, LEAD_PAGE_SIZE, markLeadsSeen, openLeadConversation, requestLeadMatching, toggleLeadSaved, UnlockError,
  type LeadFeed, type LeadFilter, type LeadItem, type LeadSort,
} from '@/services/homatchLeads';
import { propertyTypeLabel, selectionTotals } from '@/leads/leadSummary';
import { BTN_PRIMARY, BTN_SECONDARY, chipClass, EYEBROW, SURFACE } from '@/components/leads/kit';
import { formatCreditsLabel, LeadCard } from '@/components/leads/LeadCard';
import { LeadDetailsDrawer } from '@/components/leads/LeadDetailsDrawer';
import { UnlockDialog } from '@/components/leads/UnlockDialog';
import { OwnerDemoJourney } from '@/components/leads/demo/OwnerDemoJourney';
import { ownerDemoAvailable } from '@/services/ownerDemoLead';

/* Filter chips in groups: one choice per group, every group combinable (server-side, v2 feed). */
const FILTER_GROUPS: Array<Array<[LeadFilter, string]>> = [
  [['STRONG', 'hl_filter_strong'], ['POTENTIAL', 'hl_filter_potential']],
  [['STANDARD', 'hl_filter_standard'], ['PREMIUM', 'hl_filter_premium']],
  [['DIRECT', 'hl_filter_direct'], ['BROKER', 'hl_filter_broker']],
  [['LOCKED', 'hl_filter_locked'], ['UNLOCKED', 'hl_filter_unlocked']],
  [['FRESH', 'hl_filter_fresh'], ['ACTIVE', 'hl_filter_active'], ['STALE', 'hl_filter_stale']],
  [['SAVED', 'hl_filter_saved'], ['CONTACTED', 'hl_filter_contacted']],
];
const ALL_FILTERS = FILTER_GROUPS.flat().map(([f]) => f);
const SORTS: Array<[LeadSort, string]> = [
  ['BEST', 'hl_sort_best'], ['ACTIVE', 'hl_sort_active'], ['NEWEST', 'hl_sort_newest'], ['UPDATED', 'hl_sort_updated'],
  ['BUDGET_DESC', 'hl_sort_budget_desc'], ['BUDGET_ASC', 'hl_sort_budget_asc'],
];
const isFilter = (v: string | null): v is LeadFilter => ALL_FILTERS.includes(v as LeadFilter);
const isSort = (v: string | null): v is LeadSort => SORTS.some(([s]) => s === v);
/** ?f=STRONG,DIRECT (and the older ?filter=STRONG links). */
const filtersOf = (params: URLSearchParams): LeadFilter[] => {
  const raw = [...(params.get('f') ?? '').split(','), params.get('filter') ?? ''].map((x) => x.trim().toUpperCase());
  return [...new Set(raw.filter(isFilter))];
};

function HomatchLeadsContent() {
  const { id: propertyId = '' } = useParams<{ id: string }>();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters = filtersOf(params);
  const filterKey = filters.join(',');
  const district = params.get('district') || null;
  const propertyType = params.get('type') || null;
  const anyFilter = filters.length > 0 || !!district || !!propertyType;
  const sort: LeadSort = isSort(params.get('sort')) ? params.get('sort') as LeadSort : 'BEST';
  const page = Math.max(0, (Number.parseInt(params.get('page') ?? '1', 10) || 1) - 1);
  const demoRequested = params.get('demo') === '1';
  const [demoAvailable, setDemoAvailable] = useState(false);
  const demoMode = demoRequested && demoAvailable;
  const openedInDemo = useRef(demoRequested);

  const [feed, setFeed] = useState<LeadFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [propertyLabel, setPropertyLabel] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [unlockIds, setUnlockIds] = useState<string[]>([]);
  const [detail, setDetailState] = useState<LeadItem | null>(null);
  /* Every lead has its own address (?lead=<matchId>): shareable with yourself, kept on refresh and Back. */
  const leadParam = params.get('lead');
  const setDetail = useCallback((next: LeadItem | null | ((d: LeadItem | null) => LeadItem | null)) => {
    setDetailState((cur) => {
      const value = typeof next === 'function' ? (next as (d: LeadItem | null) => LeadItem | null)(cur) : next;
      if ((value?.matchId ?? null) !== (cur?.matchId ?? null)) {
        setParams((prev) => {
          const q = new URLSearchParams(prev);
          if (value) q.set('lead', value.matchId); else q.delete('lead');
          return q;
        }, { replace: cur != null && value != null });
      }
      return value;
    });
  }, [setParams]);

  const setParam = useCallback((key: string, value: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value == null) next.delete(key); else next.set(key, value);
      if (key !== 'page') next.delete('page');
      return next;
    });
  }, [setParams]);

  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    try {
      setFeed(await getLeadFeedV2(propertyId, { filters: filterKey ? filterKey.split(',') as LeadFilter[] : [], sort, district, propertyType, page }));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [propertyId, filterKey, sort, district, propertyType, page]);

  /* One chip per group: choosing another in the same group replaces it; choosing it again clears it. */
  const toggleFilter = (f: LeadFilter) => {
    const group = FILTER_GROUPS.find((g) => g.some(([x]) => x === f)) ?? [];
    const others = filters.filter((x) => !group.some(([g]) => g === x));
    const next = filters.includes(f) ? others : [...others, f];
    setParams((prev) => {
      const q = new URLSearchParams(prev);
      q.delete('filter'); q.delete('page');
      if (next.length) q.set('f', next.join(',')); else q.delete('f');
      return q;
    });
  };
  const clearFilters = () => setParams((prev) => {
    const q = new URLSearchParams(prev);
    for (const k of ['f', 'filter', 'district', 'type', 'page']) q.delete(k);
    return q;
  });

  useEffect(() => { void load(); }, [load]);

  /* Demo Mode is offered only when the server says this caller may see it. */
  useEffect(() => {
    if (!propertyId) return;
    let alive = true;
    ownerDemoAvailable(propertyId).then((ok) => { if (alive) setDemoAvailable(ok); });
    return () => { alive = false; };
  }, [propertyId]);

  const setDemo = useCallback((on: boolean) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (on) next.set('demo', '1'); else next.delete('demo');
      return next;
    });
    window.scrollTo({ top: 0 });
  }, [setParams]);

  /* Once per visit: re-evaluate this listing against every active search, and remember
     the visit after the first paint so this visit's fresh matches still show as fresh. */
  useEffect(() => {
    if (!propertyId) return;
    /* The real matcher is not asked to run for a visit that opens straight into Demo Mode. */
    if (!openedInDemo.current) requestLeadMatching(propertyId).catch(() => undefined);
    const timer = window.setTimeout(() => { markLeadsSeen(propertyId).catch(() => undefined); }, 4000);
    supabase.from('properties').select('title,homatch_id').eq('id', propertyId).maybeSingle()
      .then(({ data }) => {
        if (data) setPropertyLabel([data.homatch_id ? `HOMATCH ${data.homatch_id}` : null, data.title].filter(Boolean).join(' · '));
      });
    return () => window.clearTimeout(timer);
  }, [propertyId]);

  const items = feed?.items ?? [];
  useEffect(() => {
    if (!leadParam) { setDetailState(null); return; }
    const found = items.find((x) => x.matchId === leadParam);
    if (found) setDetailState(found);
  }, [leadParam, items]);
  const totals = useMemo(() => selectionTotals(items, selected), [items, selected]);
  const pages = Math.max(1, Math.ceil((feed?.total ?? 0) / LEAD_PAGE_SIZE));
  const toggle = (id: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function openConversation(lead: LeadItem) {
    try {
      const id = await openLeadConversation(lead.matchId);
      navigate(`/chat?conversation=${id}`);
    } catch (e) {
      toast.error(t(e instanceof UnlockError && e.code === 'RATE_LIMITED' ? 'hl_error_rate_limited' : 'hl_error_conversation'));
    }
  }

  async function toggleSave(lead: LeadItem) {
    try {
      const saved = await toggleLeadSaved(lead.matchId);
      setFeed((f) => f && ({ ...f, items: f.items.map((x) => (x.matchId === lead.matchId ? { ...x, saved } : x)) }));
    } catch {
      toast.error(t('hl_error_generic'));
    }
  }

  const counts = feed?.counts;
  const prices = feed?.prices;

  return (
    <AppLayout noPadding surfaceClass={DISCOVERY_SURFACE}>
      <CustomerSurface className={demoMode ? 'pb-72' : 'pb-32'}>
        <div className="pt-4 sm:pt-5">
          {/* Back is the shell's one control, top left (parent: the matches page). */}
          <PageHero compact eyebrow={t('hl_eyebrow')} title={t('hl_headline')} subtitle={t('hl_description')} />
          {propertyLabel ? <p className="mt-2 truncate text-xs font-medium text-[hsl(224_14%_30%)]">{propertyLabel}</p> : null}
        </div>

        {demoAvailable && !demoMode ? (
          <section className={cn(SURFACE, 'mt-4 flex flex-col gap-3 border-[hsl(328_60%_85%)] p-4 sm:flex-row sm:items-center sm:p-5')} data-testid="demo-entry" aria-labelledby="demo-entry-title">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[hsl(328_70%_95%)]">
              <FlaskConical className="h-5 w-5 text-[hsl(328_70%_34%)]" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-2xs font-bold uppercase tracking-[0.16em] text-[hsl(328_70%_30%)]">{t('demo_entry_eyebrow')} · {t('demo_badge')}</p>
              <h2 id="demo-entry-title" className="mt-0.5 font-display text-base font-semibold leading-snug">{t('demo_entry_title')}</h2>
              <p className="mt-1 text-sm leading-relaxed text-[hsl(224_14%_26%)]">{t('demo_entry_body')}</p>
              <p className="mt-1 text-xs text-[hsl(224_14%_32%)]">{t('demo_entry_only_you')}</p>
            </div>
            <button type="button" className={cn(BTN_PRIMARY, 'sm:shrink-0')} onClick={() => setDemo(true)} data-testid="demo-start">
              <FlaskConical className="h-4 w-4" aria-hidden="true" />{t('demo_entry_cta')}
            </button>
          </section>
        ) : null}

        {demoMode ? (
          <OwnerDemoJourney propertyId={propertyId} propertyLabel={propertyLabel} onExit={() => setDemo(false)} />
        ) : (<>
        {/* The introductory sales section — approved copy, both segments, one ranking. */}
        <section className={cn(SURFACE, 'mt-4 grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6')} aria-labelledby="hl-intro">
          <div className="min-w-0">
            <h2 id="hl-intro" className="font-display text-lg font-semibold leading-snug text-[hsl(224_14%_10%)]">{t('hl_intro_headline')}</h2>
            <p className="mt-1.5 max-w-[68ch] text-sm leading-relaxed text-[hsl(224_14%_26%)]">{t('hl_intro_description')}</p>
            <p className="mt-2 text-sm font-semibold text-[hsl(var(--gold-ink))]">{t('hl_intro_closing')}</p>
          </div>
          {prices ? (
            <dl className="grid grid-cols-2 gap-2 sm:w-64">
              <div className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5">
                <dt className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(224_10%_40%)]">{t('hl_segment_standard')}</dt>
                <dd className="mt-0.5 font-display text-base font-bold" dir="ltr">{t('hl_credits_n', { n: formatCreditsLabel(prices.STANDARD, lang) })}</dd>
              </div>
              <div className="rounded-xl bg-[#0C1119] px-3 py-2.5 text-white">
                <dt className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(38_92%_62%)]">{t('hl_segment_premium')}</dt>
                <dd className="mt-0.5 font-display text-base font-bold" dir="ltr">{t('hl_credits_n', { n: formatCreditsLabel(prices.PREMIUM, lang) })}</dd>
              </div>
            </dl>
          ) : null}
        </section>

        {counts && counts.FRESH > 0 && !filters.includes('FRESH') ? (
          <button type="button" onClick={() => toggleFilter('FRESH')}
            className={cn(SURFACE, 'mt-3 flex w-full items-center gap-3 p-4 text-start motion-safe:transition-shadow hover:shadow-hover')}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(210_80%_96%)]">
              <Sparkles className="h-5 w-5 text-[hsl(212_70%_40%)]" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{t(counts.FRESH === 1 ? 'hl_fresh_title_one' : 'hl_fresh_title', { n: counts.FRESH })}</span>
              <span className="block text-xs text-[hsl(224_14%_30%)]">{t('hl_fresh_body')}</span>
            </span>
          </button>
        ) : null}

        {/* Filters (combinable, server-side), location, property type and sort. */}
        <div className="mt-4 space-y-3" data-testid="hl-filters">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0" role="group" aria-label={t('hl_filters_label')}>
            <button type="button" className={chipClass(!anyFilter)} aria-pressed={!anyFilter} onClick={clearFilters}>
              {t('hl_filter_all')}{counts ? <span className="tabular-nums opacity-70" dir="ltr">{counts.ALL ?? 0}</span> : null}
            </button>
            {FILTER_GROUPS.map((group, gi) => (
              <React.Fragment key={gi}>
                <span aria-hidden="true" className="my-2 w-px shrink-0 bg-[hsl(var(--border))]" />
                {group.map(([f, key]) => (
                  <button key={f} type="button" className={chipClass(filters.includes(f))} aria-pressed={filters.includes(f)}
                    data-filter={f} onClick={() => toggleFilter(f)}>
                    {t(key)}{counts ? <span className="tabular-nums opacity-70" dir="ltr">{counts[f] ?? 0}</span> : null}
                  </button>
                ))}
              </React.Fragment>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {([
              ['district', 'hl_filter_location', feed?.facets.districts ?? [], district, (v: string) => v],
              ['type', 'hl_filter_type', feed?.facets.propertyTypes ?? [], propertyType, (v: string) => propertyTypeLabel([v], t) ?? v],
            ] as const).map(([param, label, values, current, show]) => (
              <label key={param} className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-[hsl(224_14%_30%)]">
                <span>{t(label)}</span>
                <select value={current ?? ''} onChange={(e) => setParam(param, e.target.value || null)} data-testid={`hl-select-${param}`}
                  className="min-h-11 min-w-0 rounded-xl border border-[hsl(var(--border))] bg-white px-3 text-sm font-semibold text-[hsl(224_14%_12%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]">
                  <option value="">{t('hl_filter_any')}</option>
                  {values.map((v) => <option key={v} value={v}>{show(v)}</option>)}
                </select>
              </label>
            ))}
            <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-[hsl(224_14%_30%)]">
              <span>{t('hl_sort_label')}</span>
              <select value={sort} onChange={(e) => setParam('sort', e.target.value === 'BEST' ? null : e.target.value)}
                className="min-h-11 min-w-0 rounded-xl border border-[hsl(var(--border))] bg-white px-3 text-sm font-semibold text-[hsl(224_14%_12%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]">
                {SORTS.map(([s0, key]) => <option key={s0} value={s0}>{t(key)}</option>)}
              </select>
            </label>
          </div>
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-[hsl(224_14%_32%)]" data-testid="hl-refresh-tip">
            <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{t('hl_refresh_tip')}
          </p>
        </div>

        <div className="mt-4" aria-live="polite" aria-busy={loading}>
          {loading && !feed ? (
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className={cn(SURFACE, 'h-72 motion-safe:animate-pulse bg-[hsl(42_30%_97%)]')} />
              ))}
            </div>
          ) : failed ? (
            <EmptyState icon={Users} title={t('hl_error_generic')} actions={<button type="button" className={BTN_SECONDARY} onClick={() => void load()}>{t('hl_retry')}</button>} />
          ) : !items.length ? (
            <EmptyState icon={Users} title={t(!anyFilter ? 'hl_empty_title' : 'hl_empty_filter_title')} body={t(!anyFilter ? 'hl_empty_body' : 'hl_empty_filter_body')} />
          ) : (
            <div className={cn('grid gap-4 md:grid-cols-2', loading && 'opacity-60')}>
              {items.map((lead) => (
                <LeadCard key={lead.matchId} lead={lead} selected={selected.has(lead.matchId)}
                  onToggleSelect={() => toggle(lead.matchId)}
                  onUnlock={() => setUnlockIds([lead.matchId])}
                  onOpenDetails={() => setDetail(lead)}
                  onOpenContact={() => setDetail(lead)}
                  onOpenConversation={() => void openConversation(lead)}
                  onToggleSave={() => void toggleSave(lead)}
                  onCreateEmail={() => navigate(`/email-studio?property=${propertyId}&leads=${lead.matchId}`)} />
              ))}
            </div>
          )}
        </div>

        {pages > 1 ? (
          <nav className="mt-6 flex items-center justify-center gap-2" aria-label={t('hl_pages_label')}>
            <button type="button" className={BTN_SECONDARY} disabled={page === 0} onClick={() => setParam('page', String(page))}
              aria-label={t('hl_page_previous')}><ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /></button>
            <span className="min-w-[6rem] text-center text-sm font-semibold tabular-nums" dir="ltr">{page + 1} / {pages}</span>
            <button type="button" className={BTN_SECONDARY} disabled={page + 1 >= pages} onClick={() => setParam('page', String(page + 2))}
              aria-label={t('hl_page_next')}><ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /></button>
          </nav>
        ) : null}
        </>)}
      </CustomerSurface>

      {/* Bulk Unlock: a summary bar above the mobile navigation, never behind it. */}
      {selected.size > 0 && !demoMode ? (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 px-3 md:bottom-4" data-testid="bulk-bar">
          <div className={cn(SURFACE, 'mx-auto flex max-w-3xl flex-col gap-3 p-3 shadow-hover sm:flex-row sm:items-center sm:justify-between sm:p-4')}>
            <div className="min-w-0 text-sm">
              <p className={EYEBROW}>{t('hl_bulk_selected', { n: selected.size })}</p>
              <p className="mt-0.5 text-[hsl(224_14%_22%)]">
                {t('hl_bulk_summary', { standard: totals.standard, premium: totals.premium, credits: formatCreditsLabel(totals.credits, lang) })}
                {totals.already ? ` · ${t('hl_bulk_already', { n: totals.already })}` : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" className={BTN_SECONDARY} onClick={() => setSelected(new Set())}>{t('hl_clear_selection')}</button>
              <button type="button" className={cn(BTN_PRIMARY, 'flex-1 sm:flex-none')} onClick={() => setUnlockIds([...selected])} data-testid="bulk-unlock">
                <Lock className="h-4 w-4" aria-hidden="true" />{t('hl_cta_bulk')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <UnlockDialog open={unlockIds.length > 0} matchIds={unlockIds} onClose={() => setUnlockIds([])}
        contactOptions={unlockIds.length === 1 ? items.find((x) => x.matchId === unlockIds[0])?.contactOptions ?? null : null}
        onUnlocked={(result) => {
          setUnlockIds([]);
          setSelected(new Set());
          toast.success(result.chargedCredits > 0
            ? t(result.unlocked.length === 1 ? 'hl_unlocked_toast_one' : 'hl_unlocked_toast', { n: result.unlocked.length, credits: formatCreditsLabel(result.chargedCredits, lang) })
            : t('hl_unlocked_toast_free'));
          void load().then(() => {
            setDetail((d) => (d ? { ...d, unlocked: true } : d));
          });
        }} />
      <LeadDetailsDrawer lead={detail} propertyId={propertyId} open={detail != null} onClose={() => setDetail(null)}
        onUnlock={(id) => setUnlockIds([id])} />
      {loading && feed ? <Loader2 className="fixed end-4 top-20 h-5 w-5 animate-spin text-[hsl(var(--gold-ink))]" aria-hidden="true" /> : null}
    </AppLayout>
  );
}

export default function HomatchLeadsPage() {
  return (
    <RouteGuard>
      <HomatchLeadsContent />
    </RouteGuard>
  );
}
