// FIND BUYERS — the compact dashboard for one property (/property/:id/matches).
// Find Buyers 3.0, 2026-10-15.
//
// What the owner needs at a glance and nothing more: the property, how to start or edit a
// search, the two campaign summaries (free HOMATCH Match, paid External Discovery) and the
// recent external searches. Every list lives on its own page:
//   internal → /property/:id/buyers/internal      external → /property/:id/buyers/external
// "New search" opens the paid budget step on the external page; "Edit search" opens the
// property's details — neither starts or charges anything on its own.

import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, History, PencilLine, Plus } from 'lucide-react';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { CustomerSurface, DISCOVERY_SURFACE } from '@/components/customer/surface';
import { useLanguage } from '@/contexts/LanguageContext';
import { intlLocaleFor } from '@/components/workspace/primitives';
import { FindBuyersDashboard, type InternalStart } from '@/components/findBuyers/FindBuyersDashboard';
import { useExternalResults } from '@/components/findBuyers/useExternalResults';
import { useInternalMatches } from '@/components/matching/internal/InternalMatchesSection';
import { useCampaignStatus } from '@/hooks/useCampaignStatus';
import { counterpartFor } from '@/matching/presentation';
import { requestLeadMatching } from '@/services/homatchLeads';
import { readProperty } from '@/services/propertyManagement';
import { ownerFactsOf } from '@/findBuyers/externalResults';
import type { Property, PropertyFacts } from '@/types/types';

const RECENT = 5;

function HomeContent() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const { id: propertyId = '' } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [internalStart, setInternalStart] = useState<InternalStart>('idle');
  React.useEffect(() => { if (propertyId) readProperty(propertyId).then(setProperty).catch(() => setProperty(null)); }, [propertyId]);

  const owner = useMemo(() => ownerFactsOf((property as { facts?: PropertyFacts | PropertyFacts[] } | null)?.facts, property?.transaction_type), [property]);
  const { status } = useCampaignStatus(propertyId);
  const internal = useInternalMatches(propertyId);
  const external = useExternalResults(propertyId, undefined, owner);
  const counterpart = counterpartFor(property?.transaction_type);
  const tenant = counterpart === 'TENANT';
  const running = Boolean(status?.campaign?.active);
  const internalCount = internal.people === null ? null : internal.people.length + (internal.demo ? 1 : 0);
  const base = `/property/${encodeURIComponent(propertyId)}`;
  const facts = (() => { const f = (property as { facts?: PropertyFacts | PropertyFacts[] } | null)?.facts; return Array.isArray(f) ? f[0] : f; })();
  const label = property?.title || facts?.address || facts?.city || '';
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(intlLocaleFor(lang), { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <AppLayout noPadding surfaceClass={DISCOVERY_SURFACE}>
      <CustomerSurface className="pb-32">
        {/* The property and the two search actions, on one compact block. */}
        <header className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-end sm:justify-between sm:pt-5" data-testid="fbh-header">
          <div className="min-w-0">
            <p className="truncate text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(34_90%_36%)]">{label || t('fbh_eyebrow')}</p>
            <h1 className="mt-0.5 font-display text-xl font-semibold text-[hsl(218_45%_14%)]">{t(tenant ? 'fbh_title_tenants' : 'fbh_title_buyers')}</h1>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2">
            <button type="button" data-testid="fbh-new-search" onClick={() => navigate(`${base}/buyers/external?start=1`)} disabled={running}
              className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[linear-gradient(135deg,hsl(40_94%_62%),hsl(34_90%_48%))] px-4 text-sm font-semibold text-[hsl(218_52%_11%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] focus-visible:ring-offset-2 disabled:opacity-60 sm:flex-none">
              <Plus className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">{t('fbh_new_search')}</span>
            </button>
            <Link to={`${base}/edit`} data-testid="fbh-edit-search"
              className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white px-4 text-sm font-semibold text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(40_60%_76%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] sm:flex-none">
              <PencilLine className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">{t('fbh_edit_search')}</span>
            </Link>
          </div>
        </header>
        {running && (
          <Link to={`${base}/buyers/external`} data-testid="fbh-running" role="status"
            className="mt-3 flex items-center gap-2 rounded-xl bg-[hsl(218_52%_11%)] px-3 py-2.5 text-sm font-semibold text-white">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[hsl(40_94%_60%)] motion-safe:animate-pulse" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{t('fbh_running')}</span><ChevronRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
          </Link>
        )}

        <div className="mt-4">
          <FindBuyersDashboard
            tenant={tenant}
            internalCount={internalCount}
            internalStart={internalStart}
            onStartInternal={() => {
              setInternalStart('starting');
              requestLeadMatching(propertyId).then(() => setInternalStart('requested')).catch(() => setInternalStart('failed'));
            }}
            internalHref={`${base}/buyers/internal`}
            counts={external.leads === null ? null : external.counts}
            externalRunning={running}
            onStartExternal={() => navigate(`${base}/buyers/external?start=1`)}
            externalHref={`${base}/buyers/external`}
          />
        </div>

        {/* Recent external searches: each opens its own results. */}
        {(external.campaigns?.length ?? 0) > 0 && (
          <section className="mt-5" aria-labelledby="fbh-recent" data-testid="fbh-recent">
            <h2 id="fbh-recent" className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[hsl(218_45%_14%)]">
              <History className="h-4 w-4 text-[hsl(34_90%_40%)]" aria-hidden="true" />{t('fbh_recent')}
            </h2>
            <ul className="divide-y divide-[hsl(40_30%_90%)] overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-[hsl(40_50%_86%)]">
              {external.campaigns!.slice(0, RECENT).map((c, i) => (
                <li key={c.jobId}>
                  <Link to={`${base}/buyers/external${i === 0 ? '' : `?job=${encodeURIComponent(c.jobId)}`}`} data-testid="fbh-recent-item"
                    className="flex min-h-12 items-center gap-3 px-4 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(38_92%_50%)]">
                    <span className="min-w-0 flex-1 truncate font-medium text-[hsl(218_45%_14%)]">{t(i === 0 ? 'fbx_campaign_latest' : 'fbx_campaign_earlier', { date: fmtDate(c.firstAt) })}</span>
                    <span className="shrink-0 text-2xs text-[hsl(218_28%_38%)]">{t('fbh_recent_people', { n: String(c.total) })}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[hsl(218_28%_50%)] rtl:rotate-180" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </CustomerSurface>
    </AppLayout>
  );
}

export default function FindBuyersHomePage() {
  return <RouteGuard><HomeContent /></RouteGuard>;
}
