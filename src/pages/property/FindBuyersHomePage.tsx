// FIND BUYERS — the dashboard for one property (/property/:id/matches). Recovery UX, 2026-10-17.
//
// One journey, top to bottom: which property → what the search looks for (SearchDna, one
// "Edit search") → ONE primary action (start / view live progress / continue, from the
// server's live status) → the latest search with ITS OWN counts and "Open results" → the
// internal matches → previous searches → "Clear old results". Every list lives on its own page:
//   internal → /property/:id/buyers/internal      external → /property/:id/buyers/external?job=<id>
//
// The searches come from find_buyers_campaigns ⨝ matching_jobs (useExternalResults), so a newer
// search with zero leads is still the latest one; when the live search reaches a final state
// the status poll's key changes and everything re-reads. Starting only opens the budget step.

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PencilLine } from 'lucide-react';
import { toast } from 'sonner';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { CustomerSurface, DISCOVERY_SURFACE } from '@/components/customer/surface';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { DASH_BTN, FindBuyersDashboard, type LatestCounts, type PrimaryMode } from '@/components/findBuyers/FindBuyersDashboard';
import { ClearResultsDialog } from '@/components/findBuyers/ClearResultsDialog';
import { SearchDna } from '@/components/findBuyers/SearchDna';
import { useExternalResults } from '@/components/findBuyers/useExternalResults';
import { useInternalMatches } from '@/components/matching/internal/InternalMatchesSection';
import { useCampaignStatus } from '@/hooks/useCampaignStatus';
import { counterpartFor } from '@/matching/presentation';
import { requestLeadMatching } from '@/services/homatchLeads';
import { readProperty } from '@/services/propertyManagement';
import { ownerFactsOf, placeLead } from '@/findBuyers/externalResults';
import { featuredCampaign } from '@/findBuyers/leadCampaigns';
import type { Property, PropertyFacts } from '@/types/types';

function HomeContent() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { id: propertyId = '' } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  React.useEffect(() => { if (propertyId) readProperty(propertyId).then(setProperty).catch(() => setProperty(null)); }, [propertyId]);

  const owner = useMemo(() => ownerFactsOf((property as { facts?: PropertyFacts | PropertyFacts[] } | null)?.facts, property?.transaction_type), [property]);
  const { status, refresh } = useCampaignStatus(propertyId);
  const internal = useInternalMatches(propertyId);
  const c = status?.campaign ?? null;
  const live = c?.active ? c : null;
  /* The dashboard shows the newest FINISHED search; a running one is the primary action. */
  const [featuredId, setFeaturedId] = useState<string | undefined>(undefined);
  const external = useExternalResults(propertyId, featuredId, owner, {
    liveJobId: live?.jobId ?? null, liveStartedAt: live?.startedAt ?? live?.createdAt ?? null, liveState: live?.state ?? null,
    refreshKey: c ? `${c.jobId}:${c.state}:${c.newResults}` : null,
    statusJob: c ? { jobId: c.jobId, state: c.state, createdAt: c.createdAt, startedAt: c.startedAt, completedAt: c.completedAt } : null,
  });
  const featured = featuredCampaign(external.campaigns);
  useEffect(() => { setFeaturedId(featured?.jobId); }, [featured?.jobId]);

  const counterpart = counterpartFor(property?.transaction_type);
  const tenant = counterpart === 'TENANT';
  const internalCount = internal.people === null ? null : internal.people.length + (internal.demo ? 1 : 0);
  const base = `/property/${encodeURIComponent(propertyId)}`;
  const facts = (() => { const f = (property as { facts?: PropertyFacts | PropertyFacts[] } | null)?.facts; return Array.isArray(f) ? f[0] : f; })();
  const label = property?.title || facts?.address || facts?.city || '';
  const dnaFacts = facts ? {
    transaction_type: property?.transaction_type ?? null, property_type: property?.property_type ?? null,
    city: facts.city ?? null, district: facts.district ?? null, bedrooms: facts.bedrooms ?? null, rooms: facts.rooms ?? null,
    area: facts.area ?? null, total_price: facts.total_price ?? null, currency: facts.currency ?? null,
  } : null;

  const readiness = status?.readiness ?? null;
  const primary: PrimaryMode = live ? (live.state === 'PAUSED' ? 'resume' : 'live')
    : readiness && !readiness.ready ? 'blocked'
      : (external.campaigns?.length ?? 0) > 0 ? 'start_new' : 'start';

  /* The featured search's own counts, from its listable leads (sellers, brokers, rejected never counted). */
  const latestCounts: LatestCounts | null = useMemo(() => {
    if (!featured || external.jobId !== featured.jobId || external.leads === null) return null;
    const people = external.leads.filter((l) => placeLead(l) !== null);
    const again = people.filter((l) => l.seen_before === true).length;
    return { people: people.length, opportunities: external.counts.opportunities, newPeople: people.length - again, foundAgain: again };
  }, [featured, external.jobId, external.leads, external.counts.opportunities]);

  return (
    <AppLayout noPadding surfaceClass={DISCOVERY_SURFACE}>
      <CustomerSurface className="pb-32">
        {/* Which property this is about. */}
        <header className="pt-4 sm:pt-5" data-testid="fbh-header">
          <p className="break-words text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(34_90%_36%)] line-clamp-2">{label || t('fbh_eyebrow')}</p>
          <h1 className="mt-0.5 break-words font-display text-xl font-semibold leading-snug text-[hsl(218_45%_14%)]">{t(tenant ? 'fbh_title_tenants' : 'fbh_title_buyers')}</h1>
        </header>

        {/* What the search looks for, from the property's own facts; one way to change it. */}
        <section aria-labelledby="fbh-criteria" data-testid="fbh-criteria"
          className="mt-3 flex min-w-0 flex-col gap-3 rounded-2xl bg-white p-4 ring-1 ring-inset ring-[hsl(40_60%_84%)] sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <h2 id="fbh-criteria" className="break-words text-2xs font-bold uppercase tracking-[0.12em] text-[hsl(34_90%_34%)]">{t('fbrx_criteria')}</h2>
            <SearchDna facts={dnaFacts} />
          </div>
            <Link to={`${base}/edit`} state={{ from: window.location.pathname + window.location.search }} data-testid="fbh-edit-search"
              className={cn(DASH_BTN, 'shrink-0 bg-white text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(40_60%_76%)]')}>
              <PencilLine className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{t('fbh_edit_search')}</span>
            </Link>
        </section>

        <div className="mt-3">
          <FindBuyersDashboard
            primary={primary}
            foundSoFar={live?.newResults ?? 0}
            onStart={() => navigate(`${base}/buyers/external?start=1`)}
            liveHref={`${base}/buyers/external`}
            campaigns={external.campaigns}
            featured={featured}
            latestCounts={latestCounts}
            campaignsFailed={external.failed}
            /* The search the results page opens by default (live, else newest) needs no ?job; any other opens by ?job. */
            resultsHref={(jobId) => (jobId === (live?.jobId ?? external.campaigns?.[0]?.jobId) ? `${base}/buyers/external` : `${base}/buyers/external?job=${encodeURIComponent(jobId)}`)}
            allPeople={external.allPeople?.total ?? null}
            internalCount={internalCount}
            internalHref={`${base}/buyers/internal`}
            /* Opening the internal matches also queues the property for the native matcher
               (internal_leads_request_matching): no credits, no Actor. */
            onOpenInternal={() => { requestLeadMatching(propertyId).catch(() => undefined); }}
            canClear={(external.campaigns?.length ?? 0) > 0}
            onClear={() => setClearOpen(true)}
          />
        </div>
        {propertyId ? (
          <ClearResultsDialog open={clearOpen} propertyId={propertyId} onClose={() => setClearOpen(false)}
            onCleared={(o) => {
              setClearOpen(false);
              toast.success(t('fbrx_clear_done', { n: String(o.leadsCleared + o.legacyMatchesCleared) }));
              /* No stale cache: every list re-reads from the server. */
              setFeaturedId(undefined);
              external.reset();
              void refresh();
            }} />
        ) : null}
      </CustomerSurface>
    </AppLayout>
  );
}

export default function FindBuyersHomePage() {
  return <RouteGuard><HomeContent /></RouteGuard>;
}
