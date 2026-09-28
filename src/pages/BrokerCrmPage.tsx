// BROKER CRM — the registered broker's own desk.
//
// Three panels, each owner-scoped server-side: the registration and its
// standing (RLS: owner reads own row), the commercial state (paid-until plus
// the catalogue's admin-controlled price, read through
// broker_discovery_pricing — no price is hardcoded here), and engagement.
//
// THE ANALYTICS SAY WHAT WAS MEASURED. "Call clicks" is a count of clicks on
// a phone link. It is never presented as completed calls, because Homatch has
// no call-completion telemetry for these links, and a label that promises
// more than the platform knows is a fake metric.

import {
  Building2, CalendarClock, Eye, Globe, Mail, MousePointerClick, Phone, Store,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CustomerSurface, PRODUCT_SURFACE, PageHero } from '@/components/customer/surface';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import {
  brokerDiscoveryPricing, brokerProfileEventStats,
  type BrokerDiscoveryPricing, type BrokerEventStats,
} from '@/services/brokers';
import type { TranslationKey } from '@/i18n/translations';
import { cn } from '@/lib/utils';

interface OwnListing {
  id: string;
  display_name: string;
  role: string;
  status: string;
  paid_until: string | null;
  review_note: string | null;
  cities: string[] | null;
  languages: string[] | null;
  about: string | null;
  created_at: string;
}

export default function BrokerCrmPage() {
  const { t } = useLanguage();
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;

  const [listing, setListing] = useState<OwnListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<BrokerEventStats | null>(null);
  const [pricing, setPricing] = useState<BrokerDiscoveryPricing | null>(null);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('broker_directory_listings')
        .select('id,display_name,role,status,paid_until,review_note,cities,languages,about,created_at')
        .eq('owner_user_id', uid)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const own = (data ?? null) as OwnListing | null;
      setListing(own);
      setLoading(false);
      if (own) {
        const [s, p] = await Promise.all([
          brokerProfileEventStats(own.id, 30),
          brokerDiscoveryPricing(),
        ]);
        if (!cancelled) { setStats(s); setPricing(p); }
      }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  const isPublic = listing?.status === 'ACTIVE'
    && Boolean(listing.paid_until)
    && Date.parse(listing!.paid_until as string) > Date.now();

  const totals = stats?.totals ?? {};
  const views = (totals.IMPRESSION ?? 0) + (totals.PROFILE_OPEN ?? 0);
  const contactClicks = (totals.PHONE_CLICK ?? 0) + (totals.EMAIL_CLICK ?? 0)
    + (totals.WHATSAPP_CLICK ?? 0) + (totals.WEBSITE_CLICK ?? 0) + (totals.MESSAGE_CLICK ?? 0);

  const metric = (icon: React.ReactNode, labelKey: TranslationKey, value: number) => (
    <div className="hm-customer-panel flex min-w-0 items-start gap-3 p-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[hsl(var(--gold))]/10 text-[hsl(var(--gold-ink))] ring-1 ring-inset ring-[hsl(var(--gold))]/25" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="font-display text-2xl font-semibold leading-none text-foreground tabular-nums">{value}</p>
        <p className="mt-1 text-2xs leading-snug text-muted-foreground">{t(labelKey)}</p>
      </div>
    </div>
  );

  return (
    <AppLayout noPadding surfaceClass="hm-customer hm-customer-canvas min-h-[calc(100dvh-4rem)]">
      <CustomerSurface className="max-w-5xl space-y-6 pt-6 sm:pt-8">
        <PageHero
          compact
          eyebrow={t('broker_crm_eyebrow')}
          title={t('broker_crm_title')}
          subtitle={t('broker_crm_sub')}
        />

        {loading && <Skeleton className="h-56 rounded-2xl" />}

        {!loading && !listing && (
          <div className="hm-customer-panel px-5 py-12 text-center">
            <Building2 className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="mx-auto mt-3 max-w-md font-display text-base font-semibold text-foreground">
              {t('broker_crm_none_title')}
            </p>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
              {t('broker_crm_none_body')}
            </p>
            <Link
              to="/brokers#apply"
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {t('broker_crm_none_cta')}
            </Link>
          </div>
        )}

        {!loading && listing && (
          <>
            {/* ── Standing ─────────────────────────────────────────────── */}
            <section className="hm-customer-panel p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words font-display text-lg font-semibold text-foreground">{listing.display_name}</h2>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    {listing.role === 'AGENCY' ? t('broker_role_agency') : t('broker_role_broker')}
                  </p>
                </div>
                <span className={cn(
                  'rounded-full border px-3 py-1 text-2xs font-semibold',
                  isPublic
                    ? 'border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]'
                    : 'border-border bg-secondary text-muted-foreground',
                )}
                >
                  {t(`broker_status_${listing.status}` as TranslationKey)}
                </span>
              </div>

              {listing.review_note && (listing.status === 'NEEDS_CHANGES' || listing.status === 'REJECTED') && (
                <p className="mt-3 rounded-lg border border-[hsl(var(--warning)/0.45)] bg-[hsl(var(--gold-soft))] px-4 py-3 text-sm leading-relaxed text-[hsl(var(--gold-ink))]">
                  {listing.review_note}
                </p>
              )}

              <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-border bg-card p-3">
                  <dt className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t('broker_crm_public_state')}</dt>
                  <dd className="mt-1 text-sm font-semibold text-foreground">
                    {isPublic ? t('broker_crm_public_yes') : t('broker_crm_public_no')}
                  </dd>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <dt className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t('broker_crm_paid_until')}</dt>
                  <dd className="mt-1 text-sm font-semibold text-foreground">
                    {listing.paid_until ? new Date(listing.paid_until).toLocaleDateString() : '—'}
                  </dd>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <dt className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t('broker_crm_listing_price')}</dt>
                  <dd className="mt-1 text-sm font-semibold text-foreground" dir="ltr">
                    {pricing?.listingPriceCredits != null
                      ? `${pricing.listingPriceCredits.toFixed(2)} CR / ${pricing.listingDurationDays ?? 30}${t('broker_crm_days_suffix')}`
                      : '—'}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2.5">
                {isPublic && (
                  <Link
                    to={`/brokers/${listing.id}`}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-2xs font-semibold text-foreground transition-colors hover:border-[hsl(var(--gold-border))] hover:text-[hsl(var(--gold-ink))]"
                  >
                    <Store className="h-4 w-4" aria-hidden="true" />
                    {t('broker_crm_view_public')}
                  </Link>
                )}
                <Link
                  to="/brokers#apply"
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-2xs font-semibold text-foreground transition-colors hover:border-[hsl(var(--gold-border))] hover:text-[hsl(var(--gold-ink))]"
                >
                  <CalendarClock className="h-4 w-4" aria-hidden="true" />
                  {t('broker_crm_edit_profile')}
                </Link>
              </div>
            </section>

            {/* ── Engagement, honestly labelled ─────────────────────────── */}
            <section className="space-y-3" aria-labelledby="broker-crm-analytics">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="broker-crm-analytics" className="font-display text-lg font-semibold text-foreground">
                  {t('broker_crm_analytics_heading')}
                </h2>
                <p className="text-2xs text-muted-foreground">{t('broker_crm_analytics_period')}</p>
              </div>

              {!isPublic && (
                <p className="text-sm leading-relaxed text-muted-foreground">{t('broker_crm_analytics_not_public')}</p>
              )}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {metric(<Eye className="h-[17px] w-[17px]" strokeWidth={1.7} />, 'broker_crm_metric_views' as TranslationKey, views)}
                {metric(<Phone className="h-[17px] w-[17px]" strokeWidth={1.7} />, 'broker_crm_metric_phone_clicks' as TranslationKey, totals.PHONE_CLICK ?? 0)}
                {metric(<Mail className="h-[17px] w-[17px]" strokeWidth={1.7} />, 'broker_crm_metric_email_clicks' as TranslationKey, totals.EMAIL_CLICK ?? 0)}
                {metric(<Globe className="h-[17px] w-[17px]" strokeWidth={1.7} />, 'broker_crm_metric_website_clicks' as TranslationKey, totals.WEBSITE_CLICK ?? 0)}
              </div>

              {/* The trend renders ONLY from real rows. No rows, no chart —
                  an empty period says so in words instead of drawing zeros. */}
              {stats && stats.daily.length > 0 ? (
                <div className="hm-customer-panel p-4">
                  <div className="flex items-end gap-1" aria-hidden="true">
                    {stats.daily.slice(-30).map((d) => {
                      const max = Math.max(...stats.daily.map((x) => x.views + x.contacts), 1);
                      const h = Math.max(3, Math.round(((d.views + d.contacts) / max) * 56));
                      return (
                        <span
                          key={d.day}
                          title={`${d.day}: ${d.views + d.contacts}`}
                          className="flex-1 rounded-t bg-[hsl(var(--gold))]/70"
                          style={{ height: `${h}px` }}
                        />
                      );
                    })}
                  </div>
                  <p className="mt-2 text-2xs text-muted-foreground">
                    <MousePointerClick className="me-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
                    {t('broker_crm_trend_note', { total: String(views + contactClicks) })}
                  </p>
                </div>
              ) : (
                isPublic && <p className="text-sm text-muted-foreground">{t('broker_crm_no_events')}</p>
              )}

              <p className="max-w-[70ch] text-2xs leading-relaxed text-muted-foreground">
                {t('broker_crm_metrics_honesty')}
              </p>
            </section>
          </>
        )}
      </CustomerSurface>
    </AppLayout>
  );
}
