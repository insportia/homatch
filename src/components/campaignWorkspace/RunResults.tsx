// ONE EXTERNAL RUN'S RESULTS — what this campaign found, and nothing else.
//
// Two kinds of result, both from this run only (matching_job_id / job_id):
//   · potential buyers/tenants from public conversations (find_buyers_leads):
//     already visible to the owner, with the public profile the person posted
//     from. No unlock exists for them and none is invented here.
//   · signal matches (matches): their contact details are opened through the
//     existing paid/included unlock on the property's matches page, which keeps
//     the price confirmation, the ledger and the 30-day rule exactly as they are.
//
// Filtering, sorting and search run on the server for leads (getRunLeadsPage).
// Selection is per lead and survives paging; it hands real rows to the message
// assistant and never pretends a profile link is an email address.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpDown, CheckSquare, ExternalLink, Lock, MessageSquareText, Search, Square, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { FRAMED_ACTION, GOLD_TEXT, NAVY_BAND, PRIMARY_ACTION, SourceBadge, sourceStyle } from '@/components/findBuyers/brand';
import { PotentialBuyerCard } from '@/components/findBuyers/PotentialBuyerCard';
import { PageNav } from '@/components/findBuyers/PageNav';
import { ServiceHeader } from '@/components/matching/ServiceIdentity';
import { fitTier } from '@/matching/presentation';
import { placeName } from '@/lib/placeNames';
import { getRunMatches } from '@/services/api';
import {
  type LeadSort, type PotentialLead, getRunLeadSources, getRunLeadsPage,
} from '@/services/findBuyers';
import type { LibraryContact } from '@/services/contactLibrary';
import type { Match } from '@/types/types';

const PAGE_SIZE = 9;
type Strength = PotentialLead['strength'] | 'ALL';

export function leadToContact(lead: PotentialLead, propertyId: string, propertyTitle: string | null): LibraryContact {
  return {
    key: `lead:${lead.id}`, kind: 'CAMPAIGN_LEAD', name: lead.author_name, email: null, phone: null,
    profileUrl: lead.author_profile_url, sourceUrl: lead.evidence[0]?.url ?? null, source: lead.source,
    language: lead.language, propertyId, propertyTitle, campaignJobId: lead.matching_job_id,
    acquiredAt: lead.created_at, emailSendable: false, outreachContactId: null,
  };
}

export function RunResults({ jobId, propertyId, propertyTitle, counterpart, refreshSignal, onPrepareMessage }: {
  jobId: string;
  propertyId: string;
  propertyTitle: string | null;
  counterpart: 'BUYER' | 'TENANT' | null;
  /** Grows while the run reports new results; a change reloads page 1's totals. */
  refreshSignal: number;
  onPrepareMessage: (contacts: LibraryContact[]) => void;
}) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [rows, setRows] = useState<PotentialLead[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<string>('ALL');
  const [strength, setStrength] = useState<Strength>('ALL');
  const [sort, setSort] = useState<LeadSort>('score');
  const [sources, setSources] = useState<string[]>([]);
  const [selected, setSelected] = useState<Map<string, LibraryContact>>(new Map());
  const [matches, setMatches] = useState<Match[]>([]);

  /* Debounced search: one server read per pause in typing, not per keystroke. */
  useEffect(() => {
    const id = window.setTimeout(() => { setQuery(q); setPage(1); }, 300);
    return () => window.clearTimeout(id);
  }, [q]);

  const load = useCallback(async () => {
    const res = await getRunLeadsPage(jobId, page, PAGE_SIZE, {
      q: query, sort, source: source === 'ALL' ? null : source, strength: strength === 'ALL' ? null : strength,
    });
    setRows(res.rows);
    setTotal(res.total);
  }, [jobId, page, query, sort, source, strength]);

  useEffect(() => { void load(); }, [load, refreshSignal]);
  useEffect(() => {
    void getRunLeadSources(jobId).then(setSources);
    void getRunMatches(jobId).then(setMatches);
  }, [jobId, refreshSignal]);

  const tenant = counterpart === 'TENANT';
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageAllSelected = Boolean(rows?.length) && rows!.every((r) => selected.has(r.id));
  const toggle = (lead: PotentialLead) => setSelected((prev) => {
    const next = new Map(prev);
    if (next.has(lead.id)) next.delete(lead.id); else next.set(lead.id, leadToContact(lead, propertyId, propertyTitle));
    return next;
  });
  const togglePage = () => setSelected((prev) => {
    const next = new Map(prev);
    if (pageAllSelected) rows!.forEach((r) => next.delete(r.id));
    else rows!.forEach((r) => next.set(r.id, leadToContact(r, propertyId, propertyTitle)));
    return next;
  });
  const filtersOn = source !== 'ALL' || strength !== 'ALL' || query.trim() !== '';
  const strengths: Strength[] = ['ALL', 'STRONG', 'GOOD', 'POSSIBLE'];
  const selectedList = useMemo(() => [...selected.values()], [selected]);

  return (
    <div className="space-y-6">
      <section aria-labelledby="cw-leads-title" className="space-y-3">
        <ServiceHeader service="external" id="cw-leads-title" count={total}
          title={t(tenant ? 'fbx_results_title_tenants' : 'fbx_results_title_buyers')} />

        {/* ── toolbar: search, source, strength, sort ── */}
        <div className="grid gap-2 rounded-2xl bg-white p-2.5 ring-1 ring-inset ring-[hsl(40_70%_82%)] sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="relative min-w-0">
            <span className="sr-only">{t('cw_search_results')}</span>
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(218_28%_45%)]" aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('cw_search_results')} dir="auto"
              className="h-11 w-full min-w-0 rounded-xl bg-[hsl(42_100%_98%)] pe-9 ps-9 text-sm text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(40_70%_84%)] placeholder:text-[hsl(218_20%_50%)] focus:outline-none focus:ring-2 focus:ring-[hsl(38_92%_56%)]" />
            {q && (
              <button type="button" onClick={() => setQ('')} aria-label={t('cw_clear_search')}
                className="absolute end-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg hover:bg-[hsl(42_100%_94%)]">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </label>
          <select value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }} aria-label={t('cw_filter_source')}
            className="h-11 min-w-0 rounded-xl bg-white px-3 text-sm font-semibold text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(40_70%_80%)] focus:outline-none focus:ring-2 focus:ring-[hsl(38_92%_56%)]">
            <option value="ALL">{t('cw_all_sources')}</option>
            {sources.map((s) => <option key={s} value={s}>{sourceStyle(s).label}</option>)}
          </select>
          <button type="button" onClick={() => { setSort(sort === 'score' ? 'recent' : 'score'); setPage(1); }}
            className={cn(FRAMED_ACTION, 'justify-center text-sm')} aria-label={t('cw_sort_label')}>
            <ArrowUpDown className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{t(sort === 'score' ? 'cw_sort_relevance' : 'cw_sort_recent')}</span>
          </button>
          <div className="flex flex-wrap gap-1.5 sm:col-span-3" role="group" aria-label={t('cw_filter_strength')}>
            {strengths.map((s) => (
              <button key={s} type="button" aria-pressed={strength === s} onClick={() => { setStrength(s); setPage(1); }}
                className={cn('min-h-9 rounded-full px-3 text-2xs font-semibold ring-1 ring-inset transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]',
                  strength === s ? cn(NAVY_BAND, GOLD_TEXT, 'ring-[hsl(40_80%_55%/0.6)]') : 'bg-white text-[hsl(218_45%_14%)] ring-[hsl(40_70%_80%)] hover:bg-[hsl(42_100%_97%)]')}>
                {t(s === 'ALL' ? 'cw_strength_all' : `cw_strength_${s.toLowerCase()}`)}
              </button>
            ))}
          </div>
        </div>

        {rows === null ? (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {[1, 2, 3].map((i) => <div key={i} className="hm-discovery-panel h-56 animate-pulse" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-inset ring-[hsl(40_70%_84%)]">
            <p className="font-semibold text-[hsl(218_45%_14%)]">{t(filtersOn ? 'cw_no_filtered_results' : 'cw_no_leads_yet')}</p>
            {filtersOn && (
              <button type="button" className={cn(FRAMED_ACTION, 'mx-auto mt-3')}
                onClick={() => { setQ(''); setSource('ALL'); setStrength('ALL'); setPage(1); }}>{t('cw_clear_filters')}</button>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={togglePage} className={cn(FRAMED_ACTION, 'text-sm')} aria-pressed={pageAllSelected}>
                {pageAllSelected ? <CheckSquare className="h-4 w-4" aria-hidden="true" /> : <Square className="h-4 w-4" aria-hidden="true" />}
                {t(pageAllSelected ? 'cw_unselect_page' : 'cw_select_page')}
              </button>
              {selected.size > 0 && (
                <button type="button" onClick={() => setSelected(new Map())} className="text-2xs font-semibold text-[hsl(218_28%_38%)] underline-offset-4 hover:underline">
                  {t('cw_clear_selection')}
                </button>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {rows.map((lead) => {
                const on = selected.has(lead.id);
                return (
                  <div key={lead.id} className={cn('min-w-0 space-y-1.5 rounded-2xl transition-shadow', on && 'ring-2 ring-[hsl(38_92%_56%)] ring-offset-2')}>
                    <button type="button" onClick={() => toggle(lead)} aria-pressed={on}
                      aria-label={t(on ? 'cw_unselect_one' : 'cw_select_one', { name: lead.author_name ?? t(tenant ? 'fbx_card_tenant' : 'fbx_card_buyer') })}
                      className={cn('flex min-h-9 w-full items-center gap-2 rounded-xl px-3 text-2xs font-semibold ring-1 ring-inset transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]',
                        on ? 'bg-[hsl(40_94%_64%)] text-[hsl(218_52%_11%)] ring-transparent' : 'bg-white text-[hsl(218_45%_14%)] ring-[hsl(40_70%_82%)] hover:bg-[hsl(42_100%_97%)]')}>
                      {on ? <CheckSquare className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Square className="h-4 w-4 shrink-0" aria-hidden="true" />}
                      <span className="min-w-0 truncate">{t(on ? 'cw_selected_one' : 'cw_select_short')}</span>
                    </button>
                    <PotentialBuyerCard lead={lead} propertyId={propertyId} />
                  </div>
                );
              })}
            </div>
            <PageNav page={Math.min(page, totalPages)} totalPages={totalPages} onPage={setPage} label={t('fbl_leads_pages')} />
          </>
        )}
      </section>

      {/* ── signal matches from this run: opened through the existing unlock ── */}
      {matches.length > 0 && (
        <section aria-labelledby="cw-signal-title" className="space-y-3">
          <ServiceHeader service="external" id="cw-signal-title" count={matches.length} title={t('cw_signal_matches_title')} />
          <ul className="grid gap-2.5 md:grid-cols-2">
            {matches.map((m) => {
              const tier = fitTier(m.signal_strength);
              const opened = m.status === 'UNLOCKED';
              return (
                <li key={m.id} className="flex min-w-0 flex-col gap-2 rounded-2xl bg-white p-3.5 ring-1 ring-inset ring-[hsl(40_70%_84%)]">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {m.preview_platform ? <SourceBadge source={m.preview_platform} /> : null}
                    <span className="rounded-full bg-[hsl(42_100%_94%)] px-2 py-0.5 text-2xs font-semibold text-[hsl(34_90%_30%)]">{t(`match_fit_${tier.toLowerCase()}`)}</span>
                    {m.preview_city ? <span className="min-w-0 truncate text-2xs text-[hsl(218_28%_38%)]">{placeName(m.preview_city, lang)}</span> : null}
                  </div>
                  {m.preview_excerpt && (
                    <p dir="auto" className={cn('line-clamp-3 break-words text-sm text-[hsl(218_45%_14%)]', !opened && 'select-none blur-[1.5px]')}>{m.preview_excerpt}</p>
                  )}
                  <button type="button" onClick={() => navigate(`/property/${propertyId}/matches?open=${encodeURIComponent(m.id)}`)}
                    className={cn(opened ? FRAMED_ACTION : PRIMARY_ACTION, 'mt-auto self-start text-sm')}>
                    {opened ? <ExternalLink className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
                    {t(opened ? 'cw_open_contact' : 'cw_view_and_unlock')}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── selection bar ── */}
      {selected.size > 0 && (
        <div role="region" aria-label={t('cw_selection_bar')}
          className={cn('sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex w-full max-w-xl flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3 text-white shadow-[0_18px_40px_-18px_hsl(218_60%_8%/0.9)] ring-1 ring-inset ring-[hsl(40_80%_55%/0.45)] md:bottom-4', NAVY_BAND)}>
          <span className="text-sm font-semibold">{t('cw_selected_n', { n: String(selected.size) })}</span>
          <button type="button" onClick={() => onPrepareMessage(selectedList)}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[hsl(40_94%_60%)] px-4 text-sm font-semibold text-[hsl(218_52%_11%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <MessageSquareText className="h-4 w-4" aria-hidden="true" />{t('cw_prepare_message')}
          </button>
        </div>
      )}
    </div>
  );
}

export default RunResults;
