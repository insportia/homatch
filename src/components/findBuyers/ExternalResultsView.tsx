// EXTERNAL DISCOVERY RESULTS — one search at a time, three tabs (owner, 2026-10-16).
//
// Two customer categories (owner, 2026-10-17): POTENTIALLY INTERESTED PEOPLE, split into
//   Strong evidence         stated their own intent and match review rated them STRONG or
//                           POTENTIAL (placeLead; the `direct` tab — never called "buyers");
//   Needs more qualification asked about a comparable listing, or stated intent that review
//                           rated WEAK / has not reviewed ("needs verification");
// and
//   Research opportunities  comparable posts worth reading: lead-derived (their comments were
//                           read) merged with find_buyers_research_opportunities, one per post.
//
// Sellers, brokers, developers, services and rejected readings are never listed, and each
// tab's count is the number of cards it lists. Tab, search, filters and page live in the
// URL so refresh and shared links keep them; tab / filter / search changes REPLACE the
// history entry (Back leaves the page instead of replaying filters); page changes replace it too.

import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, ExternalLink, History, MessageCircle, RefreshCw, SlidersHorizontal, Sparkles, Target, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { intlLocaleFor } from '@/components/workspace/primitives';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PotentialBuyerCard } from '@/components/findBuyers/PotentialBuyerCard';
import { PageNav } from '@/components/findBuyers/PageNav';
import { NAVY_BAND, sourceStyle } from '@/components/findBuyers/brand';
import { LEAD_LANGS, ageLabel } from '@/components/findBuyers/leadText';
import { useExternalResults } from '@/components/findBuyers/useExternalResults';
import { safeExternalUrl } from '@/lib/safeExternalUrl';
import {
  freshnessOf, placeLead, sourceKindKey, type ClassifiedLead, type OpportunityItem, type OwnerFacts, type ResultTab,
} from '@/findBuyers/externalResults';
import { groupLeads } from '@/findBuyers/campaignReport';
import type { LiveCampaign } from '@/findBuyers/leadCampaigns';
import type { PotentialLead } from '@/services/findBuyers';

export const RESULTS_PAGE_SIZE = 9;
type Fresh = 'all' | 'week' | 'month';
const TABS: ResultTab[] = ['direct', 'interest', 'opportunities'];

const CHIP = 'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ring-1 ring-inset';
const CHIP_ON = cn(NAVY_BAND, 'text-white ring-transparent');
const CHIP_OFF = 'bg-white text-[hsl(218_45%_14%)] ring-[hsl(40_30%_84%)]';
const SOFT = 'text-[hsl(218_28%_38%)]';

function freshEnough(iso: string | null, f: Fresh): boolean {
  if (f === 'all') return true;
  const b = freshnessOf(iso);
  return f === 'week' ? b === 'TODAY' || b === 'WEEK' : b === 'TODAY' || b === 'WEEK' || b === 'MONTH';
}

const leadLanguage = (l: ClassifiedLead) => l.language ?? l.evidence[0]?.language ?? null;

/** What the card says about the post's comments: a real count only when they were read. */
function opportunityNote(op: OpportunityItem, t: (k: string, v?: Record<string, string>) => string): string {
  if (op.commentsState === 'INSPECTED' && op.interestedCount != null) return t('fbx_opp_interested_found', { n: String(op.interestedCount) });
  /* A competitor's ad (Meta Ad Library): its comments are never reachable from the ad. */
  if (op.sourceKind === 'AD') return `${t('fbx_opp_competitor_note')} ${t('fbx_opp_ad_comments')}`;
  return t(op.competitor ? 'fbx_opp_competitor_note' : 'fbx_opp_comments_note');
}

/** One research opportunity: lead-derived posts open their HOMATCH page; research-only posts open the original. */
export function OpportunityCard({ op, propertyId, jobId }: { op: OpportunityItem; propertyId: string; jobId: string | null }) {
  const { t } = useLanguage();
  const src = sourceStyle(op.platform);
  const age = ageLabel(op.at, t);
  const srcLang = op.language && LEAD_LANGS.has(op.language) ? op.language : null;
  const kindKey = sourceKindKey(op.sourceKind);
  const body = (
    <>
      <div className={cn('flex min-w-0 items-center gap-1.5 text-2xs font-semibold', SOFT)}>
        <span style={{ color: src.color }} aria-hidden="true"><src.Icon className="h-3.5 w-3.5" /></span>
        <span data-testid="fbo-card-source" data-kind={op.sourceKind ?? ''} className="min-w-0 truncate">{kindKey ? t(kindKey) : src.label}</span>
        {age ? <><span aria-hidden="true">·</span><span className="shrink-0 whitespace-nowrap">{age}</span></> : null}
        {op.competitor ? (
          <span data-testid="fbo-card-competitor" className="ms-auto shrink-0 rounded-full bg-[hsl(42_100%_94%)] px-2 py-0.5 text-[hsl(34_90%_30%)]">{t('fbx_opp_competitor_badge')}</span>
        ) : null}
      </div>
      {op.excerpt ? (
        <p dir="auto" lang={srcLang ?? undefined} className="line-clamp-2 min-w-0 break-words text-start text-sm font-medium text-[hsl(218_45%_14%)] [unicode-bidi:plaintext]"><bdi>{op.excerpt}</bdi></p>
      ) : null}
      <p data-testid="fbo-card-note" data-state={op.commentsState} className="min-w-0 break-words text-2xs leading-relaxed text-[hsl(218_45%_20%)]">
        {opportunityNote(op, t)}
      </p>
    </>
  );
  const CARD = 'flex min-w-0 flex-col gap-2 rounded-2xl bg-white p-3.5 shadow-[0_10px_28px_-22px_hsl(218_60%_15%/0.5)] ring-1 ring-inset ring-[hsl(40_60%_84%)]';
  if (op.post) {
    return (
      <Link to={`/property/${encodeURIComponent(propertyId)}/buyers/opportunity/${op.post.key}?job=${encodeURIComponent(op.post.jobId ?? jobId ?? '')}`}
        data-testid="fbo-card" data-key={op.key} data-source="leads"
        className={cn(CARD, 'transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] motion-reduce:transition-none')}>
        {body}
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[hsl(34_90%_30%)]">
          {t('fbx_card_details')}<ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
        </span>
      </Link>
    );
  }
  const safe = safeExternalUrl(op.url);
  return (
    <article data-testid="fbo-card" data-key={op.key} data-source="research" className={CARD}>
      {body}
      {safe ? (
        <a href={safe} target="_blank" rel="noopener noreferrer nofollow" data-testid="fbo-card-open"
          className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-xl px-3 text-xs font-semibold text-[hsl(34_90%_30%)] ring-1 ring-inset ring-[hsl(40_80%_62%)] hover:bg-[hsl(42_100%_96%)]">
          {op.sourceKind === 'AD' ? t('fbx_opp_open_ad') : t('fbx_opp_open_post', { platform: src.label })}<ExternalLink className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
        </a>
      ) : null}
      <p className={cn('text-2xs', SOFT)}>{t('fbx_opp_external_explain')}</p>
    </article>
  );
}

export function ExternalResultsView({ propertyId, owner, onTotal, liveJobId = null, liveStartedAt = null, liveState = null, statusJob = null, refreshKey = null }: {
  propertyId: string;
  owner: OwnerFacts | null;
  onTotal?: (n: number) => void;
  /** The search running now (server status): the default search, even before its first lead. */
  liveJobId?: string | null;
  liveStartedAt?: string | null;
  /** The live search's lifecycle state (server status), so its listed state is current. */
  liveState?: string | null;
  /** The server's latest search, live or finished (its state outranks a lagging stored status). */
  statusJob?: LiveCampaign | null;
  /** Changes when the live status reports activity: the results re-read in place. */
  refreshKey?: string | number | null;
}) {
  const { t, lang } = useLanguage();
  const [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const tabParam = TABS.includes(params.get('tab') as ResultTab) ? (params.get('tab') as ResultTab) : null;
  const jobParam = params.get('job');
  const chosen: string | null | undefined = jobParam === 'all' ? null : jobParam ?? undefined;
  const platform = params.get('src');
  const language = params.get('sl');
  const fresh = (['week', 'month'].includes(params.get('fresh') ?? '') ? params.get('fresh') : 'all') as Fresh;
  const page = Math.max(1, Number(params.get('rp') ?? 1) || 1);
  const r = useExternalResults(propertyId, chosen, owner, { liveJobId, liveStartedAt, liveState, statusJob, refreshKey });
  const tenant = owner?.market === 'RENT';
  /* No tab in the URL: open the first kind that has something, buyers first. */
  const tab: ResultTab = tabParam ?? (r.counts.direct > 0 ? 'direct' : r.counts.interest > 0 ? 'interest' : r.counts.opportunities > 0 ? 'opportunities' : 'direct');
  React.useEffect(() => { if (r.campaigns) onTotal?.(r.campaigns.reduce((n, c) => n + c.total, 0)); }, [r.campaigns, onTotal]);

  /** Tab, search, filters and page numbers replace the entry (Back leaves the page); `push` is opt-in. */
  const set = (patch: Record<string, string | null>, opts: { resetPage?: boolean; push?: boolean } = {}) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v == null) next.delete(k); else next.set(k, v); }
    if (opts.resetPage !== false) next.delete('rp');
    setParams(next, { replace: !opts.push });
  };

  const placed = useMemo(() => (r.leads ?? []).flatMap((lead) => { const placement = placeLead(lead); return placement ? [{ lead, placement }] : []; }), [r.leads]);
  const people = useMemo(() => placed.filter(({ lead: l, placement }) => placement.tab === tab
    && (!platform || l.source === platform) && (!language || leadLanguage(l) === language)
    && freshEnough(l.signal_at ?? l.evidence[0]?.publishedAt ?? null, fresh)), [placed, tab, platform, language, fresh]);
  const ops = useMemo(() => r.items.filter((o) => (!platform || o.platform === platform) && (!language || o.language === language) && freshEnough(o.at, fresh)), [r.items, platform, language, fresh]);
  const platforms = useMemo(() => [...new Set([...placed.map((x) => x.lead.source), ...r.items.map((o) => o.platform)])], [placed, r.items]);
  const languages = useMemo(() => [...new Set([...placed.map((x) => leadLanguage(x.lead)), ...r.items.map((o) => o.language)]
    .filter((x): x is string => Boolean(x)))].sort(), [placed, r.items]);

  if (r.failed) {
    return (
      <section role="alert" data-testid="fbx-results-error"
        className="flex flex-col gap-3 rounded-2xl bg-white p-4 ring-1 ring-inset ring-[hsl(0_70%_85%)] sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-sm text-[hsl(218_45%_14%)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(0_65%_45%)]" aria-hidden="true" />{t('fbx_results_failed')}
        </p>
        <button type="button" onClick={r.reload} className={cn('min-h-11 justify-center', CHIP, CHIP_OFF)}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />{t('fbx_results_retry')}
        </button>
      </section>
    );
  }
  if (r.campaigns === null || r.leads === null) {
    return <div data-testid="fbx-results-loading" className="h-40 rounded-2xl bg-white/70 ring-1 ring-inset ring-[hsl(40_30%_90%)] motion-safe:animate-pulse" />;
  }
  if (r.campaigns.length === 0) {
    return <p data-testid="fbx-results-none" className={cn('rounded-2xl bg-white p-4 text-sm ring-1 ring-inset ring-[hsl(40_30%_88%)]', SOFT)}>{t('fbx_results_none')}</p>;
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(intlLocaleFor(lang), { day: 'numeric', month: 'short' });
  const fmtStamp = (iso: string) => new Date(iso).toLocaleString(intlLocaleFor(lang), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  /* The search on screen, named with its own date and state (a search with zero results is still shown). */
  const shown = r.jobId ? r.campaigns.find((c) => c.jobId === r.jobId) ?? null : null;
  const listLength = tab === 'opportunities' ? ops.length : people.length;
  const totalPages = Math.max(1, Math.ceil(listLength / RESULTS_PAGE_SIZE));
  const at = Math.min(page, totalPages);
  const shownPeople = people.slice((at - 1) * RESULTS_PAGE_SIZE, at * RESULTS_PAGE_SIZE);
  const shownOps = ops.slice((at - 1) * RESULTS_PAGE_SIZE, at * RESULTS_PAGE_SIZE);
  const icon = { direct: Target, interest: MessageCircle, opportunities: Sparkles } as const;
  const tabLabel = (k: ResultTab) => t(k === 'direct' ? (tenant ? 'fbx_tab3_direct_tenants' : 'fbx_tab3_direct_buyers') : `fbx_tab3_${k}`);
  const activeFilters = [platform, language, fresh !== 'all' ? fresh : null, jobParam].filter(Boolean).length;
  const langLabel = (code: string) => (LEAD_LANGS.has(code) ? t(`fbx_lang_${code}`) : code.toUpperCase());
  const anyVerify = tab === 'interest' && shownPeople.some((x) => x.placement.needsVerification);

  const group = (label: string, testid: string, children: React.ReactNode) => (
    <div className="min-w-0 space-y-1.5" data-testid={testid}>
      <p className="text-2xs font-bold uppercase tracking-[0.1em] text-[hsl(34_90%_32%)]">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
  const choice = (key: string, on: boolean, label: React.ReactNode, onClick: () => void, extra: Record<string, string> = {}) => (
    <button key={key} type="button" role="radio" aria-checked={on} onClick={onClick} className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)} {...extra}>{label}</button>
  );

  return (
    <section aria-labelledby="fbx-results-title" className="space-y-3" data-testid="fbx-results" data-job={r.jobId ?? 'all'}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id="fbx-results-title" className="min-w-0 break-words font-display text-base font-semibold leading-snug text-[hsl(218_45%_14%)]">{t('fbx_results_title')}</h2>
          {shown ? (
            <p data-testid="fbx-selected-search" data-job={shown.jobId} data-state={shown.state} className={cn('break-words text-2xs', SOFT)}>
              <span dir="auto">{t('fbrx_selected_search', { date: fmtStamp(shown.createdAt), state: t(`fbrx_state_${shown.state}`) })}</span>
            </p>
          ) : r.jobId === null ? (
            <p data-testid="fbx-selected-search" data-job="all" className={cn('break-words text-2xs', SOFT)}>{t('fbx_campaign_all')}</p>
          ) : null}
        </div>
        {/* ONE filter control: search, source, language, freshness. */}
        <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
          <PopoverTrigger asChild>
            <button type="button" data-testid="fbx-filters-open" className={cn(CHIP, 'min-h-11', activeFilters ? CHIP_ON : CHIP_OFF)}>
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />{t('fbx_filters')}
              {activeFilters ? <span className="rounded-full bg-white/20 px-1.5 tabular-nums" dir="ltr" data-testid="fbx-filters-count">{activeFilters}</span> : null}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" data-testid="fbx-filters" aria-label={t('fbx_filters')}
            className="max-h-[min(32rem,calc(100dvh-8rem))] w-[min(22rem,calc(100vw-2rem))] space-y-3 overflow-y-auto rounded-2xl border-[hsl(40_60%_84%)] bg-white p-3.5 text-[hsl(218_45%_14%)]">
            {group(t('fbx_filter_search'), 'fbx-campaigns', (
              <>
                {r.campaigns.map((c, i) => choice(c.jobId, r.jobId === c.jobId, (
                  <>{i === 0 ? <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> : <History className="h-3.5 w-3.5" aria-hidden="true" />}
                    {t(i === 0 ? 'fbx_campaign_latest' : 'fbx_campaign_earlier', { date: fmtDate(c.firstAt) })}</>
                ), () => set({ job: i === 0 ? null : c.jobId }), { 'data-testid': 'fbx-campaign', 'data-job': c.jobId }))}
                {r.campaigns.length > 1 && choice('all', r.jobId === null, t('fbx_campaign_all'), () => set({ job: 'all' }), { 'data-testid': 'fbx-campaign-all' })}
              </>
            ))}
            {platforms.length > 0 && group(t('fbx_filter_source'), 'fbx-filter-sources', (
              <>
                {choice('all', !platform, t('fbx_filter_all_sources'), () => set({ src: null }))}
                {platforms.map((p) => choice(p, platform === p, sourceStyle(p).label, () => set({ src: p }), { 'data-testid': 'fbx-filter-src' }))}
              </>
            ))}
            {languages.length > 0 && group(t('fbx_filter_language'), 'fbx-filter-languages', (
              <>
                {choice('all', !language, t('fbx_filter_all_languages'), () => set({ sl: null }))}
                {languages.map((l) => choice(l, language === l, langLabel(l), () => set({ sl: l }), { 'data-testid': 'fbx-filter-lang', 'data-lang': l }))}
              </>
            ))}
            {group(t('fbx_filter_freshness'), 'fbx-filter-fresh', (
              <>{(['all', 'week', 'month'] as Fresh[]).map((f) => choice(f, fresh === f, t(`fbx_fresh_${f}`), () => set({ fresh: f === 'all' ? null : f }), { 'data-testid': `fbx-fresh-${f}` }))}</>
            ))}
            <div className="flex justify-between gap-2 border-t border-[hsl(40_40%_90%)] pt-3">
              <button type="button" data-testid="fbx-filters-clear" disabled={!activeFilters}
                onClick={() => set({ src: null, sl: null, fresh: null, job: null })} className={cn(CHIP, CHIP_OFF, 'min-h-11 disabled:opacity-50')}>
                <X className="h-4 w-4" aria-hidden="true" />{t('fbx_filters_clear')}
              </button>
              <button type="button" data-testid="fbx-filters-done" onClick={() => setFiltersOpen(false)} className={cn(CHIP, CHIP_ON, 'min-h-11')}>{t('fbx_filters_done')}</button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Two categories — potentially interested people (strong evidence / needs more
          qualification) and research opportunities — as three tabs, each with its real count. */}
      <div className="grid grid-cols-3 gap-1.5 px-1.5">
        <p className="col-span-2 break-words text-center text-2xs font-bold uppercase tracking-[0.08em] text-[hsl(34_90%_32%)]" data-testid="fbx-group-people">
          {t('fbrx_stat_people')}
        </p>
      </div>
      <div role="tablist" aria-label={t('fbx_types_label')} className="grid grid-cols-3 gap-1.5 rounded-2xl bg-white p-1.5 ring-1 ring-inset ring-[hsl(40_30%_86%)]">
        {TABS.map((k) => {
          const Icon = icon[k];
          return (
            <button key={k} type="button" role="tab" aria-selected={tab === k} data-testid={`fbx-tab-${k}`} onClick={() => set({ tab: k })}
              className={cn('flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-center', tab === k ? cn(NAVY_BAND, 'text-white') : 'text-[hsl(218_45%_14%)]')}>
              <span className="flex items-center gap-1 font-display text-base font-semibold tabular-nums"><Icon className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />{r.counts[k]}</span>
              <span className="line-clamp-2 w-full break-words text-2xs font-semibold leading-tight opacity-90">{tabLabel(k)}</span>
            </button>
          );
        })}
      </div>

      {tab === 'interest' && <p className={cn('text-2xs', SOFT)}>{t('fbx_interest_note')}</p>}
      {anyVerify && <p className={cn('text-2xs', SOFT)} data-testid="fbx-verify-note">{t('fbx_verify_note')}</p>}
      {r.capped && <p className={cn('text-2xs', SOFT)}>{t('fbx_capped_note')}</p>}

      {listLength === 0 ? (
        <p data-testid="fbx-tab-empty" className={cn('rounded-2xl bg-white p-4 text-sm ring-1 ring-inset ring-[hsl(40_30%_88%)]', SOFT)}>
          {activeFilters ? t('fbx_empty_filtered') : t(`fbx_empty_${tab}`)}
        </p>
      ) : tab === 'opportunities' ? (
        <div className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
          {shownOps.map((op) => <OpportunityCard key={op.key} op={op} propertyId={propertyId} jobId={r.jobId} />)}
        </div>
      ) : (
        /* Within a tab: Strong → Potential → Weak → not yet reviewed. */
        <div className="space-y-3">
          {groupLeads(shownPeople.map((x) => x.lead)).map((g) => (
            <div key={g.category} className="space-y-2" data-testid="fbx-lead-group" data-category={g.category}>
              <h3 className="flex items-center gap-2 text-xs font-semibold text-[hsl(218_45%_14%)]">
                <span>{t(`fbr_cat_${g.category}`)}</span>
                <span className="rounded-full bg-[hsl(218_70%_96%)] px-2 py-px text-2xs font-bold tabular-nums text-[hsl(220_60%_30%)]">{g.rows.length}</span>
              </h3>
              <div className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
                {g.rows.map((lead) => (
                  <PotentialBuyerCard key={lead.id} lead={lead as unknown as PotentialLead} propertyId={propertyId}
                    placement={placeLead(lead) ?? { tab: 'interest', needsVerification: true }} tenant={tenant || lead.counterpart === 'TENANT'} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <PageNav page={at} totalPages={totalPages} onPage={(p) => set({ rp: p === 1 ? null : String(p) }, { resetPage: false })} label={t('fbl_leads_pages')} />
      {tab !== 'opportunities' && r.counts.opportunities > 0 && (
        <button type="button" onClick={() => set({ tab: 'opportunities' })} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-[hsl(34_90%_32%)]">
          {t('fbx_see_opportunities', { n: String(r.counts.opportunities) })}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

export default ExternalResultsView;
