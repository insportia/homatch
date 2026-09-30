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
import { brokerDeskSummary, type BrokerProfile } from '@/services/brokerDesk';
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

/*
 * ONE LINE FOR THE PROFESSIONAL SIDE. A broker or agency with a profile goes
 * to their workspace (/broker); anyone else is offered the canonical
 * onboarding (/broker/onboarding → broker_profile_save → submit for review).
 * The old inline application form is gone: one way in, not two.
 */
function ProfessionalBar() {
  const { t, isRTL } = useLanguage();
  const { status, homatchUser } = useAuth();
  const navigate = useNavigate();
  const signedIn = status === 'AUTHENTICATED';
  const professional = homatchUser?.account_type === 'BROKER' || homatchUser?.account_type === 'AGENCY';
  const [mine, setMine] = useState<BrokerProfile | null | undefined>(undefined);

  useEffect(() => {
    if (!signedIn) { setMine(null); return; }
    let live = true;
    brokerDeskSummary().then((d) => { if (live) setMine(d.profile); }).catch(() => { if (live) setMine(null); });
    return () => { live = false; };
  }, [signedIn]);

  if (mine === undefined) return <Skeleton className="h-20 rounded-2xl" />;
  const arrow = <ArrowRight className={cn('h-4 w-4', isRTL && 'rotate-180')} aria-hidden="true" />;
  const primary = 'inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

  if (mine || professional) {
    return (
      <section className="hm-product-panel flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5" data-broker-bar="workspace" aria-label={t('broker_bar_workspace_title')}>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{mine ? mine.display_name : t('broker_bar_workspace_title')}</p>
          <p className="mt-0.5 flex flex-wrap gap-1.5 text-2xs text-muted-foreground">
            {mine ? (
              <>
                <span className="rounded-full border border-border bg-secondary px-2 py-0.5 font-semibold">{t(`broker_status_${mine.status}` as TranslationKey)}</span>
                <span className="rounded-full border border-border bg-secondary px-2 py-0.5 font-semibold">{t(`broker_verif_${mine.verification_state}` as TranslationKey)}</span>
              </>
            ) : t('broker_bar_finish_profile')}
          </p>
        </div>
        <Link to={mine ? '/broker' : '/broker/onboarding'} className={primary}>
          <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
          {mine ? t('broker_bar_open_workspace') : t('broker_crm_none_cta')}
          {arrow}
        </Link>
      </section>
    );
  }

  return (
    <section className="hm-product-panel flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5" data-broker-bar="become" aria-label={t('broker_bar_become_title')}>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{t('broker_bar_become_title')}</p>
        <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">{t('broker_bar_become_body')}</p>
      </div>
      <button type="button" className={primary}
        onClick={() => (signedIn
          ? navigate('/broker/onboarding')
          : navigate('/auth/login', { state: { from: { pathname: '/broker/onboarding' } } }))}>
        {signedIn ? t('broker_bar_become_cta') : t('broker_apply_signin')}
        {arrow}
      </button>
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

/* The contact the customer paid for, as a safe link. Only http(s), t.me and
   tel: targets are ever produced; anything else renders as plain text. */
function contactHref(kind: string, key: string): string | null {
  const k = key.trim();
  if (kind === 'TELEGRAM' && /^[A-Za-z0-9_]{4,64}$/.test(k)) return `https://t.me/${k}`;
  if (kind === 'PHONE' && /^\+?[0-9 ()-]{6,24}$/.test(k)) return `tel:${k.replace(/[^0-9+]/g, '')}`;
  if (kind === 'DOMAIN' && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(k)) return `https://${k}`;
  if (kind === 'PROFILE_URL' && /^https?:\/\//i.test(k)) return k;
  return null;
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
        {row.natural_key && (
          <div className="flex min-w-0 items-start gap-2">
            <dt className="mt-0.5 shrink-0 text-muted-foreground">
              <Globe className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">{t('broker_dir_website')}</span>
            </dt>
            <dd className="min-w-0 break-all text-foreground" dir="ltr">
              {(() => {
                const href = contactHref(row.key_kind, row.natural_key);
                return href
                  ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-[hsl(var(--gold-ink))] underline-offset-2 hover:underline">{row.natural_key}</a>
                  : row.natural_key;
              })()}
            </dd>
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

        <ProfessionalBar />

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
              <Link
                to="/broker/onboarding"
                className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-4 text-sm font-semibold text-[hsl(var(--gold-ink))] transition-colors hover:bg-[hsl(var(--gold-soft))]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('broker_dir_empty_cta')}
              </Link>
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
        <details className="hm-product-panel group p-4 sm:p-5" data-broker-distinction>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-foreground">
            <span id="broker-distinction-heading">{t('broker_distinction_heading')}</span>
            <span className="text-2xs font-semibold text-[hsl(var(--gold-ink))] group-open:hidden">{t('broker_bar_learn_more')}</span>
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="flex min-w-0 items-start gap-3">
              <Store className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-foreground">{t('broker_disclosure_directory')}</p>
                <p className="text-2xs leading-relaxed text-muted-foreground">{t('broker_distinction_directory')}</p>
              </div>
            </div>
            <div className="flex min-w-0 items-start gap-3">
              <Radar className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-foreground">{t('broker_disclosure_observed')}</p>
                <p className="text-2xs leading-relaxed text-muted-foreground">{t('broker_distinction_observed')}</p>
              </div>
            </div>
          </div>
        </details>
      </CustomerSurface>
    </AppLayout>
  );
}
