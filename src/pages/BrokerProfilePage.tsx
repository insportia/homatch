// PUBLIC BROKER PROFILE — one registered, reviewed, currently-paid firm.
//
// The page reads broker_directory_public and nothing else, so its reach is
// exactly the directory's: a pending, suspended or lapsed registration is a
// not-found here, and a discovered firm cannot appear at all. Every field on
// screen is a field the view intentionally publishes.
//
// Engagement is recorded as what it is: opening this page is a PROFILE_OPEN,
// pressing the phone action is a PHONE_CLICK. Nothing here claims a call
// happened, because the platform cannot know that.

import {
  ArrowLeft, Building2, ExternalLink, Globe, Languages, Mail, MapPin, Phone, Store,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CustomerSurface, PRODUCT_SURFACE } from '@/components/customer/surface';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { recordBrokerProfileEvent } from '@/services/brokers';
import type { TranslationKey } from '@/i18n/translations';
import { SUPPORTED_LANGUAGES } from '@/types/types';
import { cn } from '@/lib/utils';

interface PublicProfile {
  id: string;
  display_name: string;
  role: string;
  country_code: string;
  cities: string[] | null;
  languages: string[] | null;
  contact_phone: string | null;
  contact_email: string | null;
  website: string | null;
  about: string | null;
  contact_person: string | null;
  logo_url: string | null;
  property_types: string[] | null;
  deal_kinds: string[] | null;
  districts: string[] | null;
  experience_years: number | null;
}

const LANGUAGE_LABEL: Record<string, string> = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((l) => [l.code, l.nativeLabel]),
);

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? [words[0], words[1]] : [name.trim()])
    .map((w) => Array.from(w)[0] ?? '').join('').toUpperCase().slice(0, 2) || '·';
}

export default function BrokerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { t, isRTL } = useLanguage();
  const [row, setRow] = useState<PublicProfile | null>(null);
  const [state, setState] = useState<'LOADING' | 'READY' | 'NOT_FOUND'>('LOADING');

  useEffect(() => {
    if (!id) { setState('NOT_FOUND'); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('broker_directory_public')
        .select('id,display_name,role,country_code,cities,languages,contact_phone,contact_email,website,'
          + 'about,contact_person,logo_url,property_types,deal_kinds,districts,experience_years')
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (!data) { setState('NOT_FOUND'); return; }
      const profile = data as unknown as PublicProfile;
      setRow(profile);
      setState('READY');
      recordBrokerProfileEvent(profile.id, 'PROFILE_OPEN', 'profile');
    })();
    return () => { cancelled = true; };
  }, [id]);

  const action = 'inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 '
    + 'text-sm font-semibold text-foreground transition-colors hover:border-[hsl(var(--gold-border))] '
    + 'hover:text-[hsl(var(--gold-ink))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <AppLayout noPadding surfaceClass={PRODUCT_SURFACE}>
      <CustomerSurface className="max-w-4xl space-y-6 pt-6 sm:pt-10">
        <Link
          to="/brokers"
          className="inline-flex items-center gap-1.5 text-2xs font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className={cn('h-3.5 w-3.5', isRTL && 'rotate-180')} aria-hidden="true" />
          {t('broker_profile_back')}
        </Link>

        {state === 'LOADING' && <Skeleton className="h-72 rounded-2xl" />}

        {state === 'NOT_FOUND' && (
          <div className="hm-product-panel px-5 py-12 text-center">
            <Building2 className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="mx-auto mt-3 max-w-md font-display text-base font-semibold text-foreground">
              {t('broker_profile_not_found_title')}
            </p>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
              {t('broker_profile_not_found_body')}
            </p>
          </div>
        )}

        {state === 'READY' && row && (
          <>
            {/* Navy identity band — the profile's structural frame. */}
            <header className="overflow-hidden rounded-2xl bg-[#0C1119] px-5 py-6 text-white shadow-hover sm:px-8 sm:py-8">
              <div className="flex min-w-0 items-center gap-4">
                {row.logo_url ? (
                  <img
                    src={row.logo_url}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-2xl border border-white/20 object-cover"
                  />
                ) : (
                  <span
                    className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-[hsl(38_92%_56%)]/15 font-display text-xl font-bold text-[hsl(38_92%_60%)] ring-1 ring-inset ring-[hsl(38_92%_56%)]/40"
                    aria-hidden="true"
                  >
                    {initials(row.display_name)}
                  </span>
                )}
                <div className="min-w-0">
                  <h1 className="break-words font-display text-2xl font-bold leading-tight text-white sm:text-3xl">
                    {row.display_name}
                  </h1>
                  <p className="mt-1 text-sm text-white/75">
                    {row.role === 'AGENCY' ? t('broker_role_agency') : t('broker_role_broker')}
                    {row.experience_years ? ` · ${t('broker_profile_experience', { years: String(row.experience_years) })}` : ''}
                  </p>
                </div>
              </div>
              {/* The one badge, earned by the read path itself. */}
              <p className="mt-4 inline-flex max-w-full items-center gap-1.5 rounded-full border border-[hsl(38_92%_56%)]/40 bg-[hsl(38_92%_56%)]/10 px-3 py-1 text-2xs font-semibold text-[hsl(38_92%_60%)]">
                <Store className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="break-words">{t('broker_disclosure_directory')}</span>
              </p>
              <span className="mt-4 block h-[3px] w-14 rounded-full bg-[hsl(38_92%_56%)]" aria-hidden="true" />
            </header>

            {row.about && (
              <section className="hm-product-panel p-5 sm:p-7">
                <h2 className="font-display text-base font-semibold text-foreground">{t('broker_profile_about')}</h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground">{row.about}</p>
              </section>
            )}

            <section className="hm-product-panel p-5 sm:p-7">
              <h2 className="font-display text-base font-semibold text-foreground">{t('broker_profile_coverage')}</h2>
              <dl className="mt-3 space-y-3 text-sm">
                {(row.cities ?? []).length > 0 && (
                  <div className="flex min-w-0 items-start gap-2.5">
                    <dt className="mt-0.5 shrink-0 text-muted-foreground"><MapPin className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('broker_coverage_cities')}</span></dt>
                    <dd className="min-w-0 break-words text-foreground">
                      {(row.cities ?? []).join(' · ')}
                      {(row.districts ?? []).length > 0 ? ` — ${(row.districts ?? []).join(', ')}` : ''}
                    </dd>
                  </div>
                )}
                {(row.languages ?? []).length > 0 && (
                  <div className="flex min-w-0 items-start gap-2.5">
                    <dt className="mt-0.5 shrink-0 text-muted-foreground"><Languages className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('broker_coverage_languages')}</span></dt>
                    <dd className="min-w-0 break-words text-foreground">
                      {(row.languages ?? []).map((c) => LANGUAGE_LABEL[c.toLowerCase()] ?? c.toUpperCase()).join(' · ')}
                    </dd>
                  </div>
                )}
              </dl>
              {((row.deal_kinds ?? []).length > 0 || (row.property_types ?? []).length > 0) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {(row.deal_kinds ?? []).map((dk) => (
                    <span key={dk} className="rounded-full border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-2.5 py-1 text-2xs font-semibold text-[hsl(var(--gold-ink))]">
                      {dk === 'SALE' ? t('broker_deal_sale') : t('broker_deal_rent')}
                    </span>
                  ))}
                  {(row.property_types ?? []).map((pt) => (
                    <span key={pt} className="rounded-full border border-border bg-secondary px-2.5 py-1 text-2xs font-semibold text-muted-foreground">
                      {t(`broker_ptype_${pt.toLowerCase()}` as TranslationKey)}
                    </span>
                  ))}
                </div>
              )}
            </section>

            {(row.contact_phone || row.contact_email || row.website) && (
              <section className="hm-product-panel p-5 sm:p-7">
                <h2 className="font-display text-base font-semibold text-foreground">{t('broker_profile_contact')}</h2>
                {row.contact_person && (
                  <p className="mt-1 text-sm text-muted-foreground">{row.contact_person}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2.5">
                  {row.contact_phone && (
                    <a
                      href={`tel:${row.contact_phone.replace(/[^\d+]/g, '')}`}
                      onClick={() => recordBrokerProfileEvent(row.id, 'PHONE_CLICK', 'profile')}
                      className={action}
                    >
                      <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{t('broker_dir_call')}</span>
                      <span dir="ltr" className="font-normal text-muted-foreground">{row.contact_phone}</span>
                    </a>
                  )}
                  {row.contact_email && (
                    <a
                      href={`mailto:${row.contact_email}`}
                      onClick={() => recordBrokerProfileEvent(row.id, 'EMAIL_CLICK', 'profile')}
                      className={action}
                    >
                      <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{t('broker_dir_email')}</span>
                    </a>
                  )}
                  {row.website && (
                    <a
                      href={/^https?:\/\//i.test(row.website) ? row.website : `https://${row.website}`}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      onClick={() => recordBrokerProfileEvent(row.id, 'WEBSITE_CLICK', 'profile')}
                      className={action}
                    >
                      <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{t('broker_dir_website')}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </CustomerSurface>
    </AppLayout>
  );
}
