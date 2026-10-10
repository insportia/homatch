// HOMATCH LEADS — "Your Matching Buyers" for one property.
//
// Every eligible HOMATCH member whose stated search fits this listing, ranked by the
// engine's match score, anonymised and free to browse. The owner unlocks only the
// contacts they want to approach (Standard 2.5 / Premium 6 credits, once per member).
// Paged on the server; filters and sort live in the URL so Back/refresh keep them.
// Opening the page also asks the matcher to evaluate this listing against every
// active search now, and marks what the owner has seen (for "Fresh Matches").

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Lock, Sparkles, Users } from 'lucide-react';
import { toast } from 'sonner';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { CustomerSurface, DISCOVERY_SURFACE, EmptyState, PageHero } from '@/components/customer/surface';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { cn } from '@/lib/utils';
import {
  getLeadFeed, LEAD_PAGE_SIZE, markLeadsSeen, openLeadConversation, requestLeadMatching, toggleLeadSaved, UnlockError,
  type LeadFeed, type LeadFilter, type LeadItem, type LeadSort,
} from '@/services/homatchLeads';
import { selectionTotals } from '@/leads/leadSummary';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TERTIARY, chipClass, EYEBROW, SURFACE } from '@/components/leads/kit';
import { formatCreditsLabel, LeadCard } from '@/components/leads/LeadCard';
import { LeadDetailsDrawer } from '@/components/leads/LeadDetailsDrawer';
import { UnlockDialog } from '@/components/leads/UnlockDialog';

const FILTERS: Array<[LeadFilter, string]> = [
  ['ALL', 'hl_filter_all'], ['STRONG', 'hl_filter_strong'], ['POTENTIAL', 'hl_filter_potential'],
  ['STANDARD', 'hl_filter_standard'], ['PREMIUM', 'hl_filter_premium'], ['FRESH', 'hl_filter_fresh'],
  ['UNLOCKED', 'hl_filter_unlocked'], ['CONTACTED', 'hl_filter_contacted'], ['SAVED', 'hl_filter_saved'],
];
const SORTS: Array<[LeadSort, string]> = [
  ['BEST', 'hl_sort_best'], ['NEWEST', 'hl_sort_newest'], ['UPDATED', 'hl_sort_updated'],
  ['BUDGET_DESC', 'hl_sort_budget_desc'], ['BUDGET_ASC', 'hl_sort_budget_asc'],
];
const isFilter = (v: string | null): v is LeadFilter => FILTERS.some(([f]) => f === v);
const isSort = (v: string | null): v is LeadSort => SORTS.some(([s]) => s === v);

function HomatchLeadsContent() {
  const { id: propertyId = '' } = useParams<{ id: string }>();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter: LeadFilter = isFilter(params.get('filter')) ? params.get('filter') as LeadFilter : 'ALL';
  const sort: LeadSort = isSort(params.get('sort')) ? params.get('sort') as LeadSort : 'BEST';
  const page = Math.max(0, (Number.parseInt(params.get('page') ?? '1', 10) || 1) - 1);

  const [feed, setFeed] = useState<LeadFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [propertyLabel, setPropertyLabel] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [unlockIds, setUnlockIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<LeadItem | null>(null);

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
      setFeed(await getLeadFeed(propertyId, filter, sort, page));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [propertyId, filter, sort, page]);

  useEffect(() => { void load(); }, [load]);

  /* Once per visit: re-evaluate this listing against every active search, and remember
     the visit after the first paint so this visit's fresh matches still show as fresh. */
  useEffect(() => {
    if (!propertyId) return;
    requestLeadMatching(propertyId).catch(() => undefined);
    const timer = window.setTimeout(() => { markLeadsSeen(propertyId).catch(() => undefined); }, 4000);
    supabase.from('properties').select('title,homatch_id').eq('id', propertyId).maybeSingle()
      .then(({ data }) => {
        if (data) setPropertyLabel([data.homatch_id ? `HOMATCH ${data.homatch_id}` : null, data.title].filter(Boolean).join(' · '));
      });
    return () => window.clearTimeout(timer);
  }, [propertyId]);

  const items = feed?.items ?? [];
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
      <CustomerSurface className="pb-32">
        <div className="pt-4 sm:pt-5">
          <button type="button" className={cn(BTN_TERTIARY, '-ms-2 mb-2')} onClick={() => navigate(`/property/${propertyId}/matches`)}>
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t('hl_back_to_find_buyers')}
          </button>
          <PageHero compact eyebrow={t('hl_eyebrow')} title={t('hl_headline')} subtitle={t('hl_description')} />
          {propertyLabel ? <p className="mt-2 truncate text-xs font-medium text-[hsl(224_14%_30%)]">{propertyLabel}</p> : null}
        </div>

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

        {counts && counts.FRESH > 0 && filter !== 'FRESH' ? (
          <button type="button" onClick={() => setParam('filter', 'FRESH')}
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

        {/* Filters and sort. */}
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:min-w-0 lg:flex-1 lg:flex-wrap lg:overflow-visible lg:px-0" role="group" aria-label={t('hl_filters_label')}>
            {FILTERS.map(([f, key]) => (
              <button key={f} type="button" className={chipClass(filter === f)} aria-pressed={filter === f} onClick={() => setParam('filter', f === 'ALL' ? null : f)}>
                {t(key)}{counts ? <span className="tabular-nums opacity-70" dir="ltr">{counts[f] ?? 0}</span> : null}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm font-medium lg:shrink-0">
            <span className="shrink-0 text-[hsl(224_14%_30%)]">{t('hl_sort_label')}</span>
            <select value={sort} onChange={(e) => setParam('sort', e.target.value === 'BEST' ? null : e.target.value)}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-[hsl(var(--border))] bg-white px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] lg:w-52 lg:flex-none">
              {SORTS.map(([s, key]) => <option key={s} value={s}>{t(key)}</option>)}
            </select>
          </label>
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
            <EmptyState icon={Users} title={t(filter === 'ALL' ? 'hl_empty_title' : 'hl_empty_filter_title')} body={t(filter === 'ALL' ? 'hl_empty_body' : 'hl_empty_filter_body')} />
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
      </CustomerSurface>

      {/* Bulk Unlock: a summary bar above the mobile navigation, never behind it. */}
      {selected.size > 0 ? (
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
