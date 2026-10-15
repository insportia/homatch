// HOMATCH MATCH — internal results for one property (/property/:id/buyers/internal).
// Find Buyers 3.0, 2026-10-15. Free: matching and browsing cost nothing; contacts are
// opened through the existing priced unlock. People here are HOMATCH members only —
// external leads live on the External Discovery page and are never mixed in.

import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { CustomerSurface, DISCOVERY_SURFACE } from '@/components/customer/surface';
import { useLanguage } from '@/contexts/LanguageContext';
import { InternalMatchesSection } from '@/components/matching/internal/InternalMatchesSection';
import { readProperty } from '@/services/propertyManagement';
import { counterpartFor } from '@/matching/presentation';
import type { Property } from '@/types/types';

function InternalContent() {
  const { t } = useLanguage();
  const { id: propertyId = '' } = useParams<{ id: string }>();
  const [property, setProperty] = React.useState<Property | null>(null);
  React.useEffect(() => { if (propertyId) readProperty(propertyId).then(setProperty).catch(() => setProperty(null)); }, [propertyId]);
  const counterpart = counterpartFor(property?.transaction_type);
  return (
    <AppLayout noPadding surfaceClass={DISCOVERY_SURFACE}>
      <CustomerSurface className="pb-32">
        <div className="flex flex-wrap items-end justify-between gap-2 pt-4 sm:pt-5">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(34_90%_36%)]">{t('fbd_internal_title')}</p>
            <h1 className="mt-0.5 font-display text-xl font-semibold text-[hsl(218_45%_14%)]">{t(counterpart === 'TENANT' ? 'fbi_title_tenants' : 'fbi_title_buyers')}</h1>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(42_100%_95%)] px-2.5 py-0.5 text-2xs font-semibold text-[hsl(34_90%_30%)] ring-1 ring-inset ring-[hsl(40_80%_80%)]">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{t('fbd_internal_pricing')}
          </span>
        </div>
        {propertyId ? (
          <InternalMatchesSection className="mt-4" propertyId={propertyId}
            counterpart={counterpart === 'TENANT' ? 'TENANT' : counterpart === 'BUYER' ? 'BUYER' : null} />
        ) : null}
        <Link to={`/property/${encodeURIComponent(propertyId)}/leads`} data-testid="fbi-open-workspace"
          className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(40_60%_80%)]">
          <span className="min-w-0">{t('fbi_open_workspace')}</span><ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
        </Link>
      </CustomerSurface>
    </AppLayout>
  );
}

export default function InternalResultsPage() {
  return <RouteGuard><InternalContent /></RouteGuard>;
}
