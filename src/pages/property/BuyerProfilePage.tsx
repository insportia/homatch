// BUYER PROFILE — one HOMATCH match, on a page of its own (/property/:id/buyer/:key).
//
// It used to open as a right-hand drawer over the matches page with ?profile= in the
// URL, so Back re-opened the drawer instead of leaving it. As a page, the shell's one
// Back control (top left; parent rule in lib/backNavigation) returns to the matches page. Same people, same data and the same
// actions as the matches preview (useInternalMatches); key "demo" is the demo buyer.

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { UserRound } from 'lucide-react';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { CustomerSurface, DISCOVERY_SURFACE, EmptyState } from '@/components/customer/surface';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import {
  DEMO_PARAM, DemoProfileBody, lowestUnlockPrice, NativeProfileBody, useInternalMatches,
} from '@/components/matching/internal/InternalMatchesSection';

function BuyerProfileContent() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { id: propertyId = '', key = '' } = useParams<{ id: string; key: string }>();
  const { people, demo, demoScore, prices, load } = useInternalMatches(propertyId);
  const [tenant, setTenant] = useState(false);

  useEffect(() => {
    if (!propertyId) return;
    supabase.from('properties').select('transaction_type').eq('id', propertyId).maybeSingle()
      .then(({ data }) => setTenant(/rent|lease/i.test(String(data?.transaction_type ?? ''))));
  }, [propertyId]);

  const leadsPath = `/property/${encodeURIComponent(propertyId)}/leads`;
  const isDemo = key === DEMO_PARAM;
  const person = !isDemo ? people?.find((p) => p.key === key) ?? null : null;
  const loading = people === null;

  return (
    <AppLayout noPadding surfaceClass={DISCOVERY_SURFACE}>
      <CustomerSurface className="pb-32">
        <div className="pt-4 sm:pt-5">
          <h1 className="font-display text-xl font-semibold text-[hsl(218_45%_14%)]">
            {t(tenant ? 'im_profile_title_tenant' : 'im_profile_title')}
          </h1>
          <p className="mt-0.5 text-sm text-[hsl(218_28%_38%)]">{t('im_profile_subtitle')}</p>
        </div>

        <article data-testid="buyer-profile" className="mt-4 rounded-2xl bg-[hsl(40_33%_98%)] px-4 pt-4 shadow-[0_10px_28px_-18px_hsl(218_60%_15%/0.45)] ring-1 ring-inset ring-[hsl(40_70%_80%)] sm:px-5">
          {loading ? (
            <div className="h-48 motion-safe:animate-pulse" />
          ) : isDemo && demo && demoScore ? (
            <DemoProfileBody payload={demo} scored={demoScore} price={prices.STANDARD} onUnlocked={load} />
          ) : person ? (
            <NativeProfileBody person={person} price={lowestUnlockPrice(prices)} onUnlock={() => navigate(leadsPath)} />
          ) : (
            <div className="pb-4">
              <EmptyState icon={UserRound} title={t('im_profile_gone')} />
            </div>
          )}
        </article>
      </CustomerSurface>
    </AppLayout>
  );
}

export default function BuyerProfilePage() {
  return (
    <RouteGuard>
      <BuyerProfileContent />
    </RouteGuard>
  );
}
