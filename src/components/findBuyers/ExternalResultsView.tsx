// EXTERNAL DISCOVERY RESULTS — one search at a time, three kinds of result (Find Buyers 3.0).
//
//   Buyers / Tenants   people who stated their own intent (DIRECT);
//   Interest signals   people who asked about a comparable listing (INTEREST);
//   Post opportunities comparable posts whose audience shows interest (one card per post).
//
// The tab, the search, the filters and the page live in the URL, so Back and refresh keep
// them. Excluded readings (sellers, services, praise …) are never listed. A failed read
// says so; an empty tab says what is empty.

import React, { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, History, MessageCircle, RefreshCw, Sparkles, Target, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { intlLocaleFor } from '@/components/workspace/primitives';
import { PotentialBuyerCard } from '@/components/findBuyers/PotentialBuyerCard';
import { PageNav } from '@/components/findBuyers/PageNav';
import { NAVY_BAND, sourceStyle } from '@/components/findBuyers/brand';
import { useExternalResults } from '@/components/findBuyers/useExternalResults';
import { daysAgo, freshnessOf, sourceKindKey, type ClassifiedLead, type OwnerFacts, type PostOpportunity } from '@/findBuyers/externalResults';
import { groupLeads } from '@/findBuyers/campaignReport';
import type { PotentialLead } from '@/services/findBuyers';

export const RESULTS_PAGE_SIZE = 9;
type Tab = 'direct' | 'interest' | 'opportunities';
type Fresh = 'all' | 'week' | 'month';
const TABS: Tab[] = ['direct', 'interest', 'opportunities'];

const CHIP = 'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ring-1 ring-inset';
const CHIP_ON = cn(NAVY_BAND, 'text-white ring-transparent');
const CHIP_OFF = 'bg-white text-[hsl(218_45%_14%)] ring-[hsl(40_30%_84%)]';

function freshEnough(iso: string | null, f: Fresh): boolean {
  if (f === 'all') return true;
  const b = freshnessOf(iso);
  return f === 'week' ? b === 'TODAY' || b === 'WEEK' : b === 'TODAY' || b === 'WEEK' || b === 'MONTH';
}

export function OpportunityCard({ op, propertyId }: { op: PostOpportunity; propertyId: string }) {
  const { t } = useLanguage();
  const src = sourceStyle(op.platform);
  const latest = daysAgo(op.latestCommentAt);
  const top = Object.entries(op.breakdown).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 3);
  return (
    <Link to={`/property/${encodeURIComponent(propertyId)}/buyers/opportunity/${op.key}?job=${encodeURIComponent(op.jobId)}`}
      data-testid="fbo-card" data-key={op.key}
      className="flex min-w-0 flex-col gap-2.5 rounded-2xl bg-white p-4 shadow-[0_10px_28px_-22px_hsl(218_60%_15%/0.5)] ring-1 ring-inset ring-[hsl(40_60%_84%)] transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] motion-reduce:transition-none">
      <div className="flex items-center gap-2 text-2xs font-semibold text-[hsl(218_28%_38%)]">
        <span style={{ color: src.color }} aria-hidden="true"><src.Icon className="h-3.5 w-3.5" /></span>
        <span data-testid="fbo-card-source" data-kind={op.sourceKind ?? ''}>{sourceKindKey(op.sourceKind) ? t(sourceKindKey(op.sourceKind)!) : src.label}</span>
        <span aria-hidden="true">·</span>
        <span>{latest == null ? t('fbo_fresh_unknown') : t('fbo_latest_days', { n: String(latest) })}</span>
        <span className="ms-auto rounded-full bg-[hsl(42_100%_94%)] px-2 py-0.5 tabular-nums text-[hsl(34_90%_30%)]">{op.opportunityScore}</span>
      </div>
      {op.excerpt && <p className="line-clamp-2 break-words text-sm font-medium text-[hsl(218_45%_14%)]">{op.excerpt}</p>}
      <dl className="grid grid-cols-3 gap-1.5 text-center">
        {([['fbo_stat_comments', op.totalComments], ['fbo_stat_analyzed', op.analyzedComments], ['fbo_stat_signals', op.signalTotal]] as const).map(([k, v]) => (
          <div key={k} className="rounded-xl bg-[hsl(40_33%_98%)] px-1.5 py-1.5 ring-1 ring-inset ring-[hsl(40_30%_90%)]">
            <dd className="font-display text-base font-semibold tabular-nums text-[hsl(218_45%_14%)]">{v ?? '—'}</dd>
            <dt className="truncate text-2xs text-[hsl(218_28%_38%)]">{t(k)}</dt>
          </div>
        ))}
      </dl>
      {top.length > 0 && (
        <p className="flex flex-wrap gap-1.5">
          {top.map(([s, n]) => (
            <span key={s} className="rounded-full bg-[hsl(218_70%_97%)] px-2 py-0.5 text-2xs font-semibold text-[hsl(220_60%_30%)]">{t(`fbo_sig_${s}`)} · {n}</span>
          ))}
        </p>
      )}
    </Link>
  );
}

export function ExternalResultsView({ propertyId, owner, onTotal }: { propertyId: string; owner: OwnerFacts | null; onTotal?: (n: number) => void }) {
  const { t, lang } = useLanguage();
  const [params, setParams] = useSearchParams();
  const tabParam = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : null;
  const jobParam = params.get('job');
  const chosen: string | null | undefined = jobParam === 'all' ? null : jobParam ?? undefined;
  const platform = params.get('src');
  const fresh = (['week', 'month'].includes(params.get('fresh') ?? '') ? params.get('fresh') : 'all') as Fresh;
  const page = Math.max(1, Number(params.get('rp') ?? 1) || 1);
  const r = useExternalResults(propertyId, chosen, owner);
  /* No tab in the URL: open the first kind that has something, buyers first. */
  const tab: Tab = tabParam ?? (r.counts.direct > 0 ? 'direct' : r.counts.interest > 0 ? 'interest' : r.counts.opportunities > 0 ? 'opportunities' : 'direct');
  React.useEffect(() => { if (r.campaigns) onTotal?.(r.campaigns.reduce((n, c) => n + c.total, 0)); }, [r.campaigns, onTotal]);

  const set = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v == null) next.delete(k); else next.set(k, v); }
    if (resetPage) next.delete('rp');
    setParams(next);
  };

  const people = useMemo(() => {
    const want = tab === 'interest' ? 'INTEREST' : 'DIRECT';
    return (r.leads ?? []).filter((l) => l.resultType === want && (!platform || l.source === platform) && freshEnough(l.signal_at ?? l.evidence[0]?.publishedAt ?? null, fresh));
  }, [r.leads, tab, platform, fresh]);
  const ops = useMemo(() => r.opportunities.filter((o) => (!platform || o.platform === platform) && freshEnough(o.latestCommentAt, fresh)), [r.opportunities, platform, fresh]);
  const platforms = useMemo(() => [...new Set((r.leads ?? []).filter((l) => l.resultType !== 'EXCLUDED').map((l) => l.source))], [r.leads]);

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
    return <p data-testid="fbx-results-none" className="rounded-2xl bg-white p-4 text-sm text-[hsl(218_28%_38%)] ring-1 ring-inset ring-[hsl(40_30%_88%)]">{t('fbx_results_none')}</p>;
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(intlLocaleFor(lang), { day: 'numeric', month: 'short' });
  const list: Array<ClassifiedLead | PostOpportunity> = tab === 'opportunities' ? ops : people;
  const totalPages = Math.max(1, Math.ceil(list.length / RESULTS_PAGE_SIZE));
  const shown = list.slice((Math.min(page, totalPages) - 1) * RESULTS_PAGE_SIZE, Math.min(page, totalPages) * RESULTS_PAGE_SIZE);
  const count: Record<Tab, number> = { direct: r.counts.direct, interest: r.counts.interest, opportunities: r.counts.opportunities };
  const icon: Record<Tab, typeof Users> = { direct: Target, interest: MessageCircle, opportunities: Sparkles };

  return (
    <section aria-labelledby="fbx-results-title" className="space-y-3" data-testid="fbx-results">
      <h2 id="fbx-results-title" className="font-display text-base font-semibold text-[hsl(218_45%_14%)]">{t('fbx_results_title')}</h2>
      {/* Searches: latest first, then earlier ones, then all. */}
      <div role="tablist" aria-label={t('fbx_campaigns_label')} data-testid="fbx-campaigns" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {r.campaigns.map((c, i) => (
          <button key={c.jobId} type="button" role="tab" aria-selected={r.jobId === c.jobId} data-testid="fbx-campaign" data-job={c.jobId}
            onClick={() => set({ job: i === 0 ? null : c.jobId })} className={cn(CHIP, r.jobId === c.jobId ? CHIP_ON : CHIP_OFF)}>
            {i === 0 ? <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> : <History className="h-3.5 w-3.5" aria-hidden="true" />}
            {t(i === 0 ? 'fbx_campaign_latest' : 'fbx_campaign_earlier', { date: fmtDate(c.firstAt) })}
          </button>
        ))}
        {r.campaigns.length > 1 && (
          <button type="button" role="tab" aria-selected={r.jobId === null} data-testid="fbx-campaign-all" onClick={() => set({ job: 'all' })}
            className={cn(CHIP, r.jobId === null ? CHIP_ON : CHIP_OFF)}>{t('fbx_campaign_all')}</button>
        )}
      </div>

      {/* The three result types, each with its own count. */}
      <div role="tablist" aria-label={t('fbx_types_label')} className="grid grid-cols-3 gap-1.5 rounded-2xl bg-white p-1.5 ring-1 ring-inset ring-[hsl(40_30%_86%)]">
        {TABS.map((k) => {
          const Icon = icon[k];
          return (
            <button key={k} type="button" role="tab" aria-selected={tab === k} data-testid={`fbx-tab-${k}`} onClick={() => set({ tab: k })}
              className={cn('flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-center', tab === k ? cn(NAVY_BAND, 'text-white') : 'text-[hsl(218_45%_14%)]')}>
              <span className="flex items-center gap-1 font-display text-base font-semibold tabular-nums"><Icon className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />{count[k]}</span>
              <span className="w-full truncate text-2xs font-semibold opacity-90">{t(`fbx_tab_${k}`)}</span>
            </button>
          );
        })}
      </div>

      {/* Filters: platform and freshness (only what this search has). */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" data-testid="fbx-filters">
        <button type="button" onClick={() => set({ src: null })} className={cn(CHIP, !platform ? CHIP_ON : CHIP_OFF)}>{t('fbx_filter_all_sources')}</button>
        {platforms.map((p) => (
          <button key={p} type="button" data-testid="fbx-filter-src" onClick={() => set({ src: p })} className={cn(CHIP, platform === p ? CHIP_ON : CHIP_OFF)}>{sourceStyle(p).label}</button>
        ))}
        {(['all', 'week', 'month'] as Fresh[]).map((f) => (
          <button key={f} type="button" data-testid={`fbx-fresh-${f}`} onClick={() => set({ fresh: f === 'all' ? null : f })} className={cn(CHIP, fresh === f ? CHIP_ON : CHIP_OFF)}>{t(`fbx_fresh_${f}`)}</button>
        ))}
      </div>

      {tab === 'interest' && <p className="text-2xs text-[hsl(218_28%_38%)]">{t('fbx_interest_note')}</p>}
      {r.capped && <p className="text-2xs text-[hsl(218_28%_38%)]">{t('fbx_capped_note')}</p>}

      {shown.length === 0 ? (
        <p data-testid="fbx-tab-empty" className="rounded-2xl bg-white p-4 text-sm text-[hsl(218_28%_38%)] ring-1 ring-inset ring-[hsl(40_30%_88%)]">{t(`fbx_empty_${tab}`)}</p>
      ) : tab === 'opportunities' ? (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {(shown as PostOpportunity[]).map((op) => <OpportunityCard key={op.key} op={op} propertyId={propertyId} />)}
        </div>
      ) : (
        /* Within a tab: Strong → Potential → Weak, then leads stored before match review. */
        <div className="space-y-4">
          {groupLeads(shown as ClassifiedLead[]).map((g) => (
            <div key={g.category} className="space-y-2" data-testid="fbx-lead-group" data-category={g.category}>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-[hsl(218_45%_14%)]">
                <span>{t(`fbr_cat_${g.category}`)}</span>
                <span className="rounded-full bg-[hsl(218_70%_96%)] px-2 py-px text-2xs font-bold tabular-nums text-[hsl(220_60%_30%)]">{g.rows.length}</span>
              </h3>
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {g.rows.map((lead) => <PotentialBuyerCard key={lead.id} lead={lead as unknown as PotentialLead} propertyId={propertyId} interest={tab === 'interest'} />)}
              </div>
            </div>
          ))}
        </div>
      )}
      <PageNav page={Math.min(page, totalPages)} totalPages={totalPages} onPage={(p) => set({ rp: p === 1 ? null : String(p) }, false)} label={t('fbl_leads_pages')} />
      {tab !== 'opportunities' && r.counts.opportunities > 0 && (
        <button type="button" onClick={() => set({ tab: 'opportunities' })} className="inline-flex items-center gap-1 text-sm font-semibold text-[hsl(34_90%_32%)]">
          {t('fbx_see_opportunities', { n: String(r.counts.opportunities) })}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

export default ExternalResultsView;
