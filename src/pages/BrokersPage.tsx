// src/pages/BrokersPage.tsx — THE HOMATCH BROKER DIRECTORY.
//
// THIS PAGE EXISTS TO MAKE ONE DISTINCTION IMPOSSIBLE TO MISS.
//
//   A LISTED BROKER applied to Homatch, was reviewed, and has a paid listing that is
//   currently running. We know who they are because they told us.
//
//   AN OBSERVED FIRM is one whose name we read off a public listing while
//   discovering property. They have no relationship with Homatch, never asked to
//   be here, and are never presented as registered.
//
// Both are real and useful. Confusing them is not a cosmetic problem: telling
// somebody that a company we scraped is a Homatch partner is a claim about a
// commercial relationship that does not exist, and it is the kind of claim a
// customer would act on.
//
// SO THE DIRECTORY IS READ FROM A VIEW, NOT A TABLE.
//
// `broker_directory_public` emits only registrations that are ACTIVE with a
// paid_until still in the future. The discovered firms live in
// `broker_intelligence`, which this page does not query at all — it has no
// paid, verified or plan column to misread, and there is no route from it to
// this list. A firm reaches this page by applying, being approved and paying,
// or not at all.
//
// WHAT CHANGED, AND WHY
//
// The first version was generic shadcn cards on the root palette in a narrow
// column, with no way to search, and it ended in "get in touch" — a dead end,
// because there was nothing to get in touch through. It is now on the light
// product ground (PRODUCT_SURFACE, `.hm-product`) -- its own product, not the
// shell's `.hm-customer` block and not the root palette -- and it filters by
// market, language and type over the columns the view actually exposes, and it
// ends in a real application: `broker_directory_apply`, a SECURITY DEFINER
// function whose signature has no status, no paid_until and no broker_id, so an
// application is PENDING_REVIEW by construction and cannot link itself to a firm
// discovery observed. Admin review and a stated paid period are what make it
// public (/admin/brokers).
//
// WHY THE EMPTY STATE SAYS SOMETHING RATHER THAN NOTHING
//
// Production had no listings when this was written. An empty directory is exactly
// where the temptation to "helpfully" fill it with the agencies we already know
// about would bite. The empty state says why it is empty and offers the one honest
// way in, which is applying.

import {
  ArrowRight, Building2, CalendarClock, CheckCircle2, ClipboardCheck, ExternalLink,
  Globe, Languages, LayoutDashboard, Loader2, Mail, MapPin, Phone, Radar, Search, Store, X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listMyDiscoveredBrokers, recordBrokerProfileEvent, type DiscoveredBroker } from '@/services/brokers';
import { CustomerSurface, PRODUCT_SURFACE } from '@/components/customer/surface';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import type { TranslationKey } from '@/i18n/translations';
import { cn } from '@/lib/utils';
import { SUPPORTED_LANGUAGES } from '@/types/types';

interface DirectoryRow {
  id: string;
  display_name: string;
  role: string;
  cities: string[] | null;
  languages: string[] | null;
  contact_phone: string | null;
  contact_email: string | null;
  website: string | null;
  paid_until: string | null;
}

interface OwnListing {
  id: string;
  display_name: string;
  status: 'PENDING_REVIEW' | 'APPROVED' | 'NEEDS_CHANGES' | 'REJECTED' | 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
  paid_until: string | null;
  review_note: string | null;
  created_at: string;
}

type RoleFilter = 'ALL' | 'AGENCY' | 'BROKER';

const LANGUAGE_LABEL: Record<string, string> = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((l) => [l.code, l.nativeLabel]),
);
const languageLabel = (code: string) => LANGUAGE_LABEL[code.toLowerCase()] ?? code.toUpperCase();

/** Two letters for the monogram. A logo would be a claim we have not checked. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = (words.length > 1 ? [words[0], words[1]] : [name.trim()])
    .map((w) => Array.from(w)[0] ?? '')
    .join('');
  return letters.toUpperCase().slice(0, 2) || '·';
}

function websiteHref(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/* Native selects, not Radix: a Radix list renders in a portal outside this page's
   token block, and at 320px a native picker is also the one that fits. */
const FIELD = 'h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const EYEBROW = 'text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--gold-ink))]';

/* ─────────────────────────────────────────────────────────────────────────
 * One listing
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * The badge here says "listed with Homatch" and it is the only badge on the page,
 * because a row in this list is the only thing that earns it. Contact actions are
 * exactly the ones the listing supplied — none are inferred, and none are proxied.
 */
function DirectoryCard({ row }: { row: DirectoryRow }) {
  const { t } = useLanguage();
  const roleLabel = row.role === 'AGENCY' ? t('broker_role_agency') : t('broker_role_broker');
  const cities = (row.cities ?? []).filter(Boolean);
  const languages = (row.languages ?? []).filter(Boolean);
  const action = 'inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border bg-card px-3 '
    + 'text-2xs font-semibold text-foreground transition-colors hover:border-[hsl(var(--gold-border))] '
    + 'hover:text-[hsl(var(--gold-ink))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <article className="hm-product-panel flex min-w-0 flex-col p-5">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[hsl(var(--gold-soft))] font-display text-sm font-semibold text-[hsl(var(--gold-ink))] ring-1 ring-inset ring-[hsl(var(--gold-border))]"
          aria-hidden="true"
        >
          {initials(row.display_name)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-display text-base font-semibold leading-snug text-foreground">
            <Link
              to={`/brokers/${row.id}`}
              className="rounded-sm hover:text-[hsl(var(--gold-ink))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {row.display_name}
            </Link>
          </h3>
          <p className="mt-0.5 text-2xs text-muted-foreground">{roleLabel}</p>
        </div>
      </div>

      <p className="mt-3 inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-2.5 py-1 text-2xs font-semibold text-[hsl(var(--gold-ink))]">
        <Store className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="break-words">{t('broker_disclosure_directory')}</span>
      </p>

      <dl className="mt-4 space-y-2.5 text-sm">
        {cities.length > 0 && (
          <div className="flex min-w-0 items-start gap-2">
            <dt className="mt-0.5 shrink-0 text-muted-foreground">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">{t('broker_coverage_cities')}</span>
            </dt>
            <dd className="min-w-0 break-words text-foreground">{cities.join(' · ')}</dd>
          </div>
        )}
        {languages.length > 0 && (
          <div className="flex min-w-0 items-start gap-2">
            <dt className="mt-0.5 shrink-0 text-muted-foreground">
              <Languages className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">{t('broker_coverage_languages')}</span>
            </dt>
            <dd className="min-w-0 break-words text-foreground">{languages.map(languageLabel).join(' · ')}</dd>
          </div>
        )}
      </dl>

      {(row.contact_phone || row.contact_email || row.website) && (
        <div className="mt-auto pt-4">
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {row.contact_phone && (
            <a
              href={`tel:${row.contact_phone.replace(/[^\d+]/g, '')}`}
              onClick={() => recordBrokerProfileEvent(row.id, 'PHONE_CLICK', 'directory')}
              className={action}
            >
              <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{t('broker_dir_call')}</span>
              <span className="sr-only" dir="ltr">{row.contact_phone}</span>
            </a>
          )}
          {row.contact_email && (
            <a
              href={`mailto:${row.contact_email}`}
              onClick={() => recordBrokerProfileEvent(row.id, 'EMAIL_CLICK', 'directory')}
              className={action}
            >
              <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{t('broker_dir_email')}</span>
            </a>
          )}
          {row.website && (
            <a
              href={websiteHref(row.website)}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={() => recordBrokerProfileEvent(row.id, 'WEBSITE_CLICK', 'directory')}
              className={action}
            >
              <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{t('broker_dir_website')}</span>
              <ExternalLink className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
            </a>
          )}
        </div>
        </div>
      )}
    </article>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Applying
 * ───────────────────────────────────────────────────────────────────────── */

const APPLY_LANGS = SUPPORTED_LANGUAGES.map((l) => l.code);

function ApplySection() {
  const { t, isRTL } = useLanguage();
  const { status, session } = useAuth();
  const navigate = useNavigate();
  const uid = session?.user?.id ?? null;

  const [mine, setMine] = useState<OwnListing[] | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState<'AGENCY' | 'BROKER'>('AGENCY');
  const [markets, setMarkets] = useState('');
  const [langs, setLangs] = useState<string[]>([]);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [about, setAbout] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [dealKinds, setDealKinds] = useState<string[]>([]);
  const [propertyTypes, setPropertyTypes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);

  const loadMine = useCallback(async () => {
    if (!uid) { setMine(null); return; }
    /*
     * The owner's own rows, through the owner-reads policy. Filtered by owner
     * explicitly because the table ALSO has a public policy for current listings,
     * and without the filter somebody else's active listing would appear under
     * "Your applications".
     */
    const { data } = await supabase
      .from('broker_directory_listings')
      .select('id,display_name,status,paid_until,review_note,created_at')
      .eq('owner_user_id', uid)
      .order('created_at', { ascending: false });
    setMine((data ?? []) as OwnListing[]);
  }, [uid]);

  useEffect(() => { void loadMine(); }, [loadMine]);

  const pending = (mine ?? []).some((l) => l.status === 'PENDING_REVIEW');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) { setError(t('broker_apply_err_name')); return; }
    if (!phone.trim() && !email.trim() && !website.trim()) { setError(t('broker_apply_err_contact')); return; }
    setSaving(true);
    const { error: rpcError } = await supabase.rpc('broker_directory_apply', {
      p_display_name: name.trim(),
      p_role: role,
      p_cities: markets.split(/[,،\n]/).map((c) => c.trim()).filter(Boolean).slice(0, 20),
      p_languages: langs,
      p_contact_phone: phone.trim() || null,
      p_contact_email: email.trim() || null,
      p_website: website.trim() || null,
      p_about: about.trim() || null,
      p_contact_person: contactPerson.trim() || null,
      p_deal_kinds: dealKinds,
      p_property_types: propertyTypes,
    });
    setSaving(false);
    if (rpcError) {
      const code = rpcError.message ?? '';
      setError(
        code.includes('ALREADY_PENDING') ? t('broker_apply_err_pending')
          : code.includes('CONTACT_REQUIRED') ? t('broker_apply_err_contact')
            : code.includes('INVALID_NAME') ? t('broker_apply_err_name')
              : t('broker_apply_err_generic'),
      );
      return;
    }
    setSent(true);
    void loadMine();
  };

  const toggleLang = (code: string) =>
    setLangs((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));

  const label = 'mb-1.5 block text-2xs font-semibold text-foreground';

  return (
    <section id="apply" className="hm-product-panel scroll-mt-24 p-5 sm:p-7" aria-labelledby="broker-apply-heading">
      <div className="max-w-2xl">
        <p className={EYEBROW}>{t('broker_dir_empty_cta')}</p>
        <h2 id="broker-apply-heading" className="mt-1 font-display text-lg font-semibold leading-tight text-foreground sm:text-xl">
          {t('broker_apply_heading')}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('broker_apply_intro')}</p>
      </div>

      {status !== 'AUTHENTICATED' ? (
        <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => navigate('/auth/login', { state: { from: { pathname: '/brokers' } } })}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {t('broker_apply_signin')}
            <ArrowRight className={cn('h-4 w-4', isRTL && 'rotate-180')} aria-hidden="true" />
          </button>
          <p className="text-2xs text-muted-foreground">{t('broker_apply_signin_hint')}</p>
        </div>
      ) : (
        <>
          {mine && mine.length > 0 && (
            <div className="mt-5">
              <h3 className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t('broker_mine_heading')}
              </h3>
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                {mine.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span className="min-w-0 break-words text-sm font-medium text-foreground">{l.display_name}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cn(
                        'rounded-full border px-2.5 py-0.5 text-2xs font-semibold',
                        l.status === 'ACTIVE'
                          ? 'border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]'
                          : 'border-border bg-secondary text-muted-foreground',
                      )}
                      >
                        {t(`broker_status_${l.status}` as TranslationKey)}
                      </span>
                      {l.status === 'ACTIVE' && l.paid_until && (
                        <span className="text-2xs text-muted-foreground">
                          {t('broker_mine_paid_until', { date: new Date(l.paid_until).toLocaleDateString() })}
                        </span>
                      )}
                      <Link
                        to="/broker"
                        className="inline-flex items-center gap-1 text-2xs font-semibold text-[hsl(var(--gold-ink))] hover:underline"
                      >
                        <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('broker_mine_open_crm')}
                      </Link>
                    </span>
                    {/* The reviewer's words, when there are any: the applicant
                        edits and resubmits with them in view. */}
                    {(l.status === 'NEEDS_CHANGES' || l.status === 'REJECTED') && l.review_note && (
                      <p className="w-full text-2xs leading-relaxed text-muted-foreground">{l.review_note}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sent ? (
            <div className="mt-5 flex items-start gap-3 rounded-lg border border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/5 p-4" role="status">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--success))]" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{t('broker_apply_success_title')}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t('broker_apply_success_body')}</p>
              </div>
            </div>
          ) : pending ? (
            <p className="mt-5 text-sm text-muted-foreground">{t('broker_apply_err_pending')}</p>
          ) : (
            <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2" noValidate>
              <div className="sm:col-span-2">
                <label htmlFor="broker-name" className={label}>{t('broker_apply_name')}</label>
                <Input id="broker-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="h-11 bg-card" autoComplete="organization" />
              </div>

              <fieldset className="sm:col-span-2">
                <legend className={label}>{t('broker_apply_role')}</legend>
                <div className="inline-flex rounded-lg border border-border bg-secondary p-1">
                  {(['AGENCY', 'BROKER'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={role === r}
                      onClick={() => setRole(r)}
                      className={cn(
                        'min-h-9 rounded-md px-4 text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        role === r ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {r === 'AGENCY' ? t('broker_role_agency') : t('broker_role_broker')}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="sm:col-span-2">
                <label htmlFor="broker-markets" className={label}>{t('broker_apply_markets')}</label>
                <Input id="broker-markets" value={markets} onChange={(e) => setMarkets(e.target.value)} maxLength={400} className="h-11 bg-card" aria-describedby="broker-markets-hint" />
                <p id="broker-markets-hint" className="mt-1.5 text-2xs text-muted-foreground">{t('broker_apply_markets_hint')}</p>
              </div>

              <fieldset className="sm:col-span-2">
                <legend className={label}>{t('broker_apply_languages')}</legend>
                <div className="flex flex-wrap gap-2">
                  {APPLY_LANGS.map((code) => {
                    const on = langs.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleLang(code)}
                        className={cn(
                          'min-h-9 rounded-full border px-3 text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          on
                            ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                            : 'border-border bg-card text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {languageLabel(code)}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div>
                <label htmlFor="broker-phone" className={label}>{t('broker_apply_phone')}</label>
                <Input id="broker-phone" type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} className="h-11 bg-card" autoComplete="tel" />
              </div>
              <div>
                <label htmlFor="broker-email" className={label}>{t('broker_apply_email')}</label>
                <Input id="broker-email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} className="h-11 bg-card" autoComplete="email" />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="broker-website" className={label}>{t('broker_apply_website')}</label>
                <Input id="broker-website" type="url" dir="ltr" value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={300} className="h-11 bg-card" autoComplete="url" />
                <p className="mt-1.5 text-2xs text-muted-foreground">{t('broker_apply_contact_hint')}</p>
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="broker-person" className={label}>{t('broker_apply_contact_person')}</label>
                <Input id="broker-person" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} maxLength={120} className="h-11 bg-card" autoComplete="name" />
              </div>

              {/* SALE / RENT focus and property types: the profile's
                  specialization, as chips so an empty choice stays honest. */}
              <fieldset>
                <legend className={label}>{t('broker_apply_deal_kinds')}</legend>
                <div className="flex flex-wrap gap-2">
                  {(['SALE', 'RENT'] as const).map((dk) => {
                    const on = dealKinds.includes(dk);
                    return (
                      <button
                        key={dk}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setDealKinds((prev) => (on ? prev.filter((v) => v !== dk) : [...prev, dk]))}
                        className={cn(
                          'min-h-9 rounded-full border px-3 text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          on
                            ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                            : 'border-border bg-card text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {dk === 'SALE' ? t('broker_deal_sale') : t('broker_deal_rent')}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <fieldset>
                <legend className={label}>{t('broker_apply_property_types')}</legend>
                <div className="flex flex-wrap gap-2">
                  {(['APARTMENT', 'HOUSE', 'LAND', 'COMMERCIAL'] as const).map((pt) => {
                    const on = propertyTypes.includes(pt);
                    return (
                      <button
                        key={pt}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPropertyTypes((prev) => (on ? prev.filter((v) => v !== pt) : [...prev, pt]))}
                        className={cn(
                          'min-h-9 rounded-full border px-3 text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          on
                            ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                            : 'border-border bg-card text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {t(`broker_ptype_${pt.toLowerCase()}` as TranslationKey)}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="sm:col-span-2">
                <label htmlFor="broker-about" className={label}>{t('broker_apply_about')}</label>
                <textarea
                  id="broker-about"
                  value={about}
                  onChange={(e) => setAbout(e.target.value)}
                  maxLength={4000}
                  rows={4}
                  className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <p className="mt-1.5 text-2xs text-muted-foreground">{t('broker_apply_about_hint')}</p>
              </div>

              {error && (
                <p className="text-sm font-medium text-destructive sm:col-span-2" role="alert">{error}</p>
              )}

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {saving ? t('broker_apply_submitting') : t('broker_apply_submit')}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Found for you — the private, persistent discovery library
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Everything here is USER-SPECIFIC: list_my_discovered_brokers scopes to the
 * authenticated account server-side. These firms are market intelligence with
 * provenance and freshness — the card says broker_disclosure_observed and
 * nothing that could read as registration, verification or partnership.
 * The library outlives the campaign that built it: rows never disappear when
 * a campaign ends, and a broker rediscovered later stays one row.
 */

type IntentFilter = 'ALL' | 'SELL' | 'RENT_OUT' | 'BUY' | 'RENT';

const INTENT_KEY: Record<Exclude<IntentFilter, 'ALL'>, TranslationKey> = {
  SELL: 'broker_found_intent_sell' as TranslationKey,
  RENT_OUT: 'broker_found_intent_rent_out' as TranslationKey,
  BUY: 'broker_found_intent_buy' as TranslationKey,
  RENT: 'broker_found_intent_rent' as TranslationKey,
};

function FoundForYouSection() {
  const { t } = useLanguage();
  const { status } = useAuth();
  const [rows, setRows] = useState<DiscoveredBroker[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [intent, setIntent] = useState<IntentFilter>('ALL');
  const [city, setCity] = useState('');

  useEffect(() => {
    if (status !== 'AUTHENTICATED') { setRows(null); return; }
    let cancelled = false;
    listMyDiscoveredBrokers()
      .then((data) => { if (!cancelled) setRows(data); })
      .catch(() => { if (!cancelled) { setRows([]); setFailed(true); } });
    return () => { cancelled = true; };
  }, [status]);

  /* Signed out: the section simply is not there. A public visitor must never
     see a scraped-firm roster. */
  if (status !== 'AUTHENTICATED' || rows === null) return null;

  const cities = [...new Set(rows.flatMap((r) => r.cities ?? []))].sort((a, b) => a.localeCompare(b));
  const filtered = rows.filter((r) => {
    if (intent !== 'ALL' && r.first_intent !== intent) return false;
    if (city && !(r.cities ?? []).includes(city)) return false;
    return true;
  });

  return (
    <section aria-labelledby="broker-found-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 id="broker-found-heading" className="font-display text-lg font-semibold text-foreground sm:text-xl">
            {t('broker_found_heading')}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {t('broker_found_lead')}
          </p>
        </div>
        {rows.length > 0 && (
          <p className="text-2xs font-medium text-muted-foreground">
            {t('broker_dir_count', { count: String(filtered.length) })}
          </p>
        )}
      </div>

      {failed && <p className="text-sm text-muted-foreground">{t('broker_found_error')}</p>}

      {!failed && rows.length === 0 && (
        <div className="hm-product-panel flex min-w-0 items-start gap-3 p-5">
          <Radar className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
          <p className="text-sm leading-relaxed text-muted-foreground">{t('broker_found_empty')}</p>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="hm-product-panel flex flex-wrap items-center gap-2 p-3">
            {(['ALL', 'SELL', 'RENT_OUT', 'BUY', 'RENT'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={intent === value}
                onClick={() => setIntent(value)}
                className={cn(
                  'min-h-9 rounded-full border px-3 text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  intent === value
                    ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                {value === 'ALL' ? t('broker_found_intent_all') : t(INTENT_KEY[value])}
              </button>
            ))}
            {cities.length > 1 && (
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className={cn(FIELD, 'ms-auto h-9 w-auto min-w-[9rem]')}
                aria-label={t('broker_dir_filter_market')}
              >
                <option value="">{t('broker_dir_filter_all_markets')}</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('broker_dir_no_results')}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((row) => <DiscoveredCard key={row.id} row={row} />)}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function DiscoveredCard({ row }: { row: DiscoveredBroker }) {
  const { t } = useLanguage();
  const name = row.display_name?.trim() || t('broker_found_unnamed');
  const cities = (row.cities ?? []).filter(Boolean);
  const languages = (row.languages ?? []).filter(Boolean);

  return (
    <article className="hm-product-panel flex min-w-0 flex-col p-5">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-secondary font-display text-sm font-semibold text-muted-foreground ring-1 ring-inset ring-border"
          aria-hidden="true"
        >
          {initials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-display text-base font-semibold leading-snug text-foreground">{name}</h3>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            {row.role === 'AGENCY' ? t('broker_role_agency') : t('broker_role_broker')}
          </p>
        </div>
      </div>

      {/* The identity boundary, on every card: observed, not registered. */}
      <p className="mt-3 inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-2xs font-semibold text-muted-foreground">
        <Radar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="break-words">{t('broker_disclosure_observed')}</span>
      </p>

      <dl className="mt-4 space-y-2 text-sm">
        {cities.length > 0 && (
          <div className="flex min-w-0 items-start gap-2">
            <dt className="mt-0.5 shrink-0 text-muted-foreground">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">{t('broker_coverage_cities')}</span>
            </dt>
            <dd className="min-w-0 break-words text-foreground">{cities.join(' · ')}</dd>
          </div>
        )}
        {languages.length > 0 && (
          <div className="flex min-w-0 items-start gap-2">
            <dt className="mt-0.5 shrink-0 text-muted-foreground">
              <Languages className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">{t('broker_coverage_languages')}</span>
            </dt>
            <dd className="min-w-0 break-words text-foreground">{languages.map(languageLabel).join(' · ')}</dd>
          </div>
        )}
      </dl>

      {/* Provenance: why it is in THIS library, and how alive the evidence is. */}
      <div className="mt-auto space-y-1 border-t border-border pt-3 text-2xs text-muted-foreground">
        {row.first_intent && (
          <p>{t('broker_found_via', { context: t(INTENT_KEY[row.first_intent]) })}</p>
        )}
        <p>
          {t('broker_found_first_seen', { date: new Date(row.discovered_at).toLocaleDateString() })}
          {row.source_count > 0 ? ` · ${t('broker_found_sources', { count: String(row.source_count) })}` : ''}
        </p>
      </div>
    </article>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * The page
 * ───────────────────────────────────────────────────────────────────────── */

export default function BrokersPage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<DirectoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [market, setMarket] = useState('');
  const [language, setLanguage] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      /*
       * THE VIEW, NOT THE TABLE. broker_directory_public applies the
       * ACTIVE-and-currently-paid test in one place so this screen cannot forget
       * it, and it cannot reach a discovered firm at all.
       */
      const { data } = await supabase
        .from('broker_directory_public')
        .select('id,display_name,role,cities,languages,contact_phone,contact_email,website,paid_until')
        .order('display_name', { ascending: true })
        .limit(500);
      setRows((data ?? []) as unknown as DirectoryRow[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* Filter options come from the listings themselves, so no option leads nowhere. */
  const markets = useMemo(
    () => [...new Set(rows.flatMap((r) => (r.cities ?? []).map((c) => c.trim()).filter(Boolean)))]
      .sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const languages = useMemo(
    () => [...new Set(rows.flatMap((r) => (r.languages ?? []).map((l) => l.toLowerCase())))].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return rows.filter((r) => {
      if (q && !r.display_name.toLocaleLowerCase().includes(q)) return false;
      if (market && !(r.cities ?? []).some((c) => c.trim() === market)) return false;
      if (language && !(r.languages ?? []).some((l) => l.toLowerCase() === language)) return false;
      if (roleFilter !== 'ALL' && r.role !== roleFilter) return false;
      return true;
    });
  }, [rows, query, market, language, roleFilter]);

  const filtering = Boolean(query.trim() || market || language || roleFilter !== 'ALL');
  const clear = () => { setQuery(''); setMarket(''); setLanguage(''); setRoleFilter('ALL'); };
  const empty = !loading && rows.length === 0;

  const scrollToApply = () => {
    document.getElementById('apply')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const points = [
    { icon: CalendarClock, title: t('broker_dir_point_paid_title'), body: t('broker_dir_point_paid_body') },
    { icon: ClipboardCheck, title: t('broker_dir_point_review_title'), body: t('broker_dir_point_review_body') },
    { icon: Radar, title: t('broker_dir_point_found_title'), body: t('broker_dir_point_found_body') },
  ];

  return (
    <AppLayout noPadding surfaceClass={PRODUCT_SURFACE}>
      <CustomerSurface className="max-w-6xl space-y-8 pt-6 sm:space-y-10 sm:pt-10">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        {/* The navy structural header — the directory's dark frame. */}
        <header className="overflow-hidden rounded-2xl bg-[#0C1119] px-5 py-6 text-white shadow-hover sm:px-9 sm:py-8">
          <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[hsl(38_92%_60%)]">{t('broker_dir_eyebrow')}</p>
          <h1 className="mt-2 font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-white sm:text-4xl">
            {t('broker_page_title')}
          </h1>
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-white/80 sm:text-base">
            {t('broker_dir_lead')}
          </p>
          <span className="mt-5 block h-[3px] w-16 rounded-full bg-[hsl(38_92%_56%)]" aria-hidden="true" />
        </header>

        <ul className="grid gap-3 sm:grid-cols-3">
          {points.map(({ icon: Icon, title, body }) => (
            <li key={title} className="hm-product-panel flex min-w-0 items-start gap-3 p-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[hsl(var(--gold))]/10 text-[hsl(var(--gold-ink))] ring-1 ring-inset ring-[hsl(var(--gold))]/25" aria-hidden="true">
                <Icon className="h-[17px] w-[17px]" strokeWidth={1.7} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ul>

        {/* ── The directory ──────────────────────────────────────────────── */}
        <section aria-labelledby="broker-directory-heading" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="broker-directory-heading" className="font-display text-lg font-semibold text-foreground sm:text-xl">
              {t('broker_directory_heading')}
            </h2>
            {!loading && rows.length > 0 && (
              <p className="text-2xs font-medium text-muted-foreground">
                {t('broker_dir_count', { count: String(filtered.length) })}
              </p>
            )}
          </div>

          {/* Filters only when there is something to filter: a search box over an
              empty directory is a control that pretends there is a roster. */}
          {!loading && rows.length > 0 && (
            <div className="hm-product-panel grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))_auto] lg:items-end">
              <div className="relative sm:col-span-2 lg:col-span-1">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('broker_dir_search_placeholder')}
                  aria-label={t('broker_dir_search_placeholder')}
                  className="h-11 bg-card ps-9"
                />
              </div>
              <label className="min-w-0">
                <span className="sr-only">{t('broker_dir_filter_market')}</span>
                <select value={market} onChange={(e) => setMarket(e.target.value)} className={FIELD} aria-label={t('broker_dir_filter_market')}>
                  <option value="">{t('broker_dir_filter_all_markets')}</option>
                  {markets.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="min-w-0">
                <span className="sr-only">{t('broker_dir_filter_language')}</span>
                <select value={language} onChange={(e) => setLanguage(e.target.value)} className={FIELD} aria-label={t('broker_dir_filter_language')}>
                  <option value="">{t('broker_dir_filter_all_languages')}</option>
                  {languages.map((l) => <option key={l} value={l}>{languageLabel(l)}</option>)}
                </select>
              </label>
              <label className="min-w-0">
                <span className="sr-only">{t('broker_dir_filter_role')}</span>
                <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as RoleFilter)} className={FIELD} aria-label={t('broker_dir_filter_role')}>
                  <option value="ALL">{t('broker_dir_filter_all_roles')}</option>
                  <option value="AGENCY">{t('broker_role_agency')}</option>
                  <option value="BROKER">{t('broker_role_broker')}</option>
                </select>
              </label>
              {filtering && (
                <button
                  type="button"
                  onClick={clear}
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-2xs font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('broker_dir_clear_filters')}
                </button>
              )}
            </div>
          )}

          {loading && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-52 rounded-[0.875rem]" />)}
            </div>
          )}

          {empty && (
            <div className="hm-product-panel px-5 py-10 text-center sm:px-10 sm:py-14">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))] ring-1 ring-inset ring-[hsl(var(--gold-border))]" aria-hidden="true">
                <Building2 className="h-5 w-5" strokeWidth={1.7} />
              </span>
              <p className="mx-auto mt-4 max-w-md font-display text-base font-semibold text-foreground">
                {t('broker_directory_empty_title')}
              </p>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                {t('broker_directory_empty_body')}
              </p>
              <button
                type="button"
                onClick={scrollToApply}
                className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-4 text-sm font-semibold text-[hsl(var(--gold-ink))] transition-colors hover:bg-[hsl(var(--gold-soft))]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('broker_dir_empty_cta')}
              </button>
            </div>
          )}

          {!loading && rows.length > 0 && filtered.length === 0 && (
            <div className="hm-product-panel flex flex-wrap items-center justify-between gap-3 p-5">
              <p className="text-sm text-muted-foreground">{t('broker_dir_no_results')}</p>
              <button type="button" onClick={clear} className="text-2xs font-semibold text-[hsl(var(--gold-ink))] hover:underline">
                {t('broker_dir_clear_filters')}
              </button>
            </div>
          )}

          {filtered.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((row) => <DirectoryCard key={row.id} row={row} />)}
            </div>
          )}
        </section>

        {/* ── Found for you: the signed-in user's PRIVATE discovery library.
               External firms, never partners, never public. ─────────────── */}
        <FoundForYouSection />

        {/*
          * THE DISTINCTION, STATED IN WORDS AND NOT ONLY IMPLIED BY LAYOUT.
          *
          * A customer who sees an observed agency on their results needs to already
          * know what that label means, and a tooltip on the results screen is not
          * where somebody learns it. So it is written out here, once, in all six
          * languages.
          */}
        <section aria-labelledby="broker-distinction-heading" className="space-y-4">
          <h2 id="broker-distinction-heading" className="font-display text-lg font-semibold text-foreground sm:text-xl">
            {t('broker_distinction_heading')}
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="hm-product-panel border-[hsl(var(--gold-border))] flex min-w-0 items-start gap-3 p-5">
              <Store className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-foreground">{t('broker_disclosure_directory')}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{t('broker_distinction_directory')}</p>
              </div>
            </div>
            <div className="hm-product-panel flex min-w-0 items-start gap-3 p-5">
              <Radar className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-foreground">{t('broker_disclosure_observed')}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{t('broker_distinction_observed')}</p>
              </div>
            </div>
          </div>
        </section>

        <ApplySection />
      </CustomerSurface>
    </AppLayout>
  );
}
