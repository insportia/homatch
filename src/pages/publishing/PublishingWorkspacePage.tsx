// /publishing — PUBLISH TO PORTALS: the standalone publishing workspace.
//
// WHY THIS IS ITS OWN PRODUCT AREA. The first implementation lived at
// /property/publish as an <iframe> of a static HTML page, reached from a button in
// the TOP BAR and another in the My Properties header, and never from the sidebar.
// It shipped to production exactly as written — the deploy was fine — so owners kept
// seeing the old interface in the old places. This page replaces it: a sidebar
// destination between Broker and Find Property, rendered by the app itself, reading
// one server (publishing-engine) for every status it shows.
//
// Overview numbers count real rows only. A publication is PUBLISHED only after the
// server checked the public portal page; this page never upgrades a status itself.

import { AlertTriangle, ExternalLink, Plus, Search } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PrivateImage } from '@/components/common/PrivateImage';
import { RouteGuard } from '@/components/common/RouteGuard';
import { EmptyState, OWNER_SURFACE, PageHero } from '@/components/customer/surface';
import { AppLayout } from '@/components/layouts/AppLayout';
import { NavGlyphIcon } from '@/components/layouts/NavGlyph';
import { MediaWell, OWNER_PRIMARY, OWNER_SECONDARY } from '@/components/owner/portfolio';
import { Kpi, ListingMark, PortalCapabilities, PortalLogo, PublicationMark, dateTime, useErrorText } from '@/components/publishing/parts';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { placeName } from '@/lib/placeNames';
import { cn } from '@/lib/utils';
import { coverImage } from '@/property/gallery';
import {
  type ListingFilter, type ListingRow, type PortalInfo, type PublicationRow,
  groupPublications, isOutdated, matchesFilter, overview,
} from '@/publishing/model';
import { listPortfolio } from '@/services/propertyManagement';
import { PublishingError, loadWorkspace } from '@/services/publishing';
import type { Property } from '@/types/types';

const FILTERS: ListingFilter[] = ['ALL', 'DRAFT', 'PENDING', 'PUBLISHED', 'ATTENTION', 'ARCHIVED'];

function Workspace() {
  const { homatchUser } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const locale = intlLocaleFor(lang);
  const [params, setParams] = useSearchParams();
  const filter = (FILTERS.includes(params.get('view') as ListingFilter) ? params.get('view') : 'ALL') as ListingFilter;
  const [query, setQuery] = useState('');
  const [state, setState] = useState<{ loading: boolean; error: string | null; portals: PortalInfo[]; listings: ListingRow[]; publications: PublicationRow[]; properties: Property[] }>(
    { loading: true, error: null, portals: [], listings: [], publications: [], properties: [] },
  );

  const load = useCallback(async () => {
    if (!homatchUser?.id) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [ws, properties] = await Promise.all([loadWorkspace(), listPortfolio({ userId: homatchUser.id, view: 'ALL', limit: 200 })]);
      setState({ loading: false, error: null, portals: ws.portals, listings: ws.listings, publications: ws.publications, properties });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof PublishingError ? e.code : 'NETWORK_ERROR' }));
    }
  }, [homatchUser?.id]);
  useEffect(() => { void load(); }, [load]);

  const byListing = useMemo(() => groupPublications(state.publications), [state.publications]);
  const props = useMemo(() => new Map(state.properties.map((p) => [String(p.id), p])), [state.properties]);
  const stats = useMemo(() => overview(state.listings, state.publications), [state.listings, state.publications]);
  const unlisted = state.properties.filter((p) => !(p as { archived_at?: string | null }).archived_at && !state.listings.some((l) => l.id === p.id)).length;

  const rows = state.listings.filter((l) => {
    if (!matchesFilter(filter, l, byListing.get(l.id) ?? [])) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const p = props.get(l.id);
    return [l.payload.title, l.payload.city, l.payload.district, l.payload.street, p?.title, p?.homatch_id != null ? String(p.homatch_id) : '']
      .some((v) => String(v ?? '').toLowerCase().includes(q));
  });
  const setFilter = (f: ListingFilter) => { const next = new URLSearchParams(params); if (f === 'ALL') next.delete('view'); else next.set('view', f); setParams(next, { replace: true }); };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
      <PageHero
        compact
        eyebrow={t('pubw_eyebrow')}
        title={t('pubw_title')}
        subtitle={t('pubw_subtitle')}
        actions={
          <>
            <Link to="/property/add" className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-white/40 bg-white px-3.5 py-1.5 text-2xs font-semibold text-[#0C1119] hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="break-words text-start">{t('pubw_add_property')}</span>
            </Link>
            <Link to="/publishing/new" className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-[hsl(38_92%_54%)] px-3.5 py-1.5 text-2xs font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
              <NavGlyphIcon name="publishing" className="h-4 w-4 shrink-0" />
              <span className="break-words text-start">{t('pubw_publish_property')}</span>
            </Link>
          </>
        }
      />

      {state.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 break-words">{errorText(state.error)}</span>
          <button type="button" onClick={() => void load()} className={OWNER_SECONDARY}>{t('pubw_retry')}</button>
        </div>
      ) : null}

      {/* HOW PUBLISHING WORKS — stated up front, because the question owners asked
          was "where do I connect my portal account?". The honest answer is that none
          of the eight portals offers account linking, so there is no Connect button:
          the owner signs in on the portal itself and HOMATCH verifies the result.
          The eight portals show as a logo strip; their capabilities open on request. */}
      <section aria-labelledby="pubw-how" className="min-w-0 space-y-3 rounded-2xl border border-border bg-[hsl(var(--card))] p-4 shadow-card sm:p-5">
        <div className="space-y-1">
          <h2 id="pubw-how" className="font-display text-lg font-semibold text-foreground">{t('pubw_how_title')}</h2>
          <p className="max-w-[70ch] text-sm text-muted-foreground">{t('pubw_how_body')}</p>
        </div>
        <ol className="grid gap-2 sm:grid-cols-4">
          {(['prepare', 'post', 'link', 'verify'] as const).map((k, i) => (
            <li key={k} className="flex min-w-0 items-start gap-2 rounded-lg bg-[hsl(var(--secondary))]/60 p-2.5">
              <span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#0C1119] text-[11px] font-bold text-white">{i + 1}</span>
              <span className="min-w-0 text-2xs leading-snug text-foreground break-words">{t(`pubw_how_step_${k}`)}</span>
            </li>
          ))}
        </ol>
        {state.portals.length ? (
          <details className="group rounded-xl border border-border" data-testid="pubw-portal-strip">
            <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
              <span className="flex -space-x-1.5 rtl:space-x-reverse">
                {state.portals.map((portal) => <PortalLogo key={portal.id} portal={portal} size="sm" className="ring-2 ring-[hsl(var(--card))]" />)}
              </span>
              <span className="min-w-0 flex-1 text-2xs font-semibold text-foreground">{t('pubw_portals_strip', { n: state.portals.length })}</span>
              <span className="text-2xs font-semibold text-[hsl(var(--gold-ink))] group-open:hidden">{t('pubw_show_capabilities')}</span>
            </summary>
            <div className="grid gap-2 border-t border-border p-3 md:grid-cols-2">
              {state.portals.map((portal) => <PortalCapabilities key={portal.id} portal={portal} />)}
            </div>
          </details>
        ) : null}
      </section>

      <section aria-label={t('pubw_overview')} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label={t('pubw_kpi_total')} value={stats.total} onClick={() => setFilter('ALL')} active={filter === 'ALL'} />
        <Kpi label={t('pubw_kpi_drafts')} value={stats.drafts} tone="quiet" onClick={() => setFilter('DRAFT')} active={filter === 'DRAFT'} />
        <Kpi label={t('pubw_kpi_active')} value={stats.active} tone="live" onClick={() => setFilter('PUBLISHED')} active={filter === 'PUBLISHED'} />
        <Kpi label={t('pubw_kpi_pending')} value={stats.pending} tone="pending" onClick={() => setFilter('PENDING')} active={filter === 'PENDING'} />
        <Kpi label={t('pubw_kpi_failed')} value={stats.failed} tone="problem" onClick={() => setFilter('ATTENTION')} active={false} />
        <Kpi label={t('pubw_kpi_attention')} value={stats.attention} tone="problem" onClick={() => setFilter('ATTENTION')} active={filter === 'ATTENTION'} />
      </section>

      <section aria-labelledby="pubw-listings" className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="pubw-listings" className="font-display text-lg font-semibold text-foreground">{t('pubw_my_listings')}</h2>
          <label className="relative flex w-full min-w-0 items-center sm:w-72">
            <Search className="pointer-events-none absolute start-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('pubw_search_ph')}
              aria-label={t('pubw_search_ph')}
              className="h-10 w-full min-w-0 rounded-lg border border-border bg-[hsl(var(--card))] ps-9 pe-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-[hsl(var(--gold-border))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--gold))]/25"
            />
          </label>
        </div>
        <div role="tablist" aria-label={t('pubw_my_listings')} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn('shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-2xs font-semibold transition-colors',
                filter === f ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]' : 'border-border bg-[hsl(var(--card))] text-muted-foreground hover:text-foreground')}
            >
              {t(`pubw_filter_${f.toLowerCase()}`)}
            </button>
          ))}
        </div>

        {state.loading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={(p) => <NavGlyphIcon name="publishing" className={p.className} />}
            title={state.listings.length === 0 ? t('pubw_empty_title') : t('pubw_empty_filtered')}
            body={state.listings.length === 0 ? t(unlisted > 0 ? 'pubw_empty_body_has_properties' : 'pubw_empty_body_no_properties', { n: unlisted }) : null}
            actions={state.listings.length === 0 ? (
              unlisted > 0
                ? <button type="button" onClick={() => navigate('/publishing/new')} className={OWNER_PRIMARY}>{t('pubw_publish_property')}</button>
                : <Link to="/property/add" className={OWNER_PRIMARY}>{t('pubw_add_property')}</Link>
            ) : null}
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((l) => (
              <ListingRowView key={l.id} listing={l} property={props.get(l.id)} pubs={byListing.get(l.id) ?? []} portals={state.portals} locale={locale} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ListingRowView({ listing, property, pubs, portals, locale }: {
  listing: ListingRow; property?: Property; pubs: PublicationRow[]; portals: PortalInfo[]; locale: string;
}) {
  const { t, lang } = useLanguage();
  const d = listing.payload;
  const cover = property ? coverImage({ coverPhotoUrl: property.cover_photo_url, photos: property.photos }) : null;
  const where = [d.district, placeName(d.city, lang)].filter(Boolean).join(', ');
  const ref = property?.homatch_id != null ? String(property.homatch_id).padStart(6, '0') : null;
  return (
    <li>
      <Link
        to={`/publishing/${listing.id}`}
        className="group grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-3 rounded-xl border border-border bg-[hsl(var(--card))] p-2.5 shadow-card transition-colors hover:border-[hsl(var(--gold-border))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] sm:grid-cols-[7.5rem_minmax(0,1fr)_auto] sm:p-3"
      >
        <div className="overflow-hidden rounded-lg">
          <MediaWell hasMedia={Boolean(cover)}>
            {cover ? <PrivateImage src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" pending={<div className="absolute inset-0 animate-pulse bg-[hsl(var(--secondary))]" />} /> : null}
          </MediaWell>
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <ListingMark ready={listing.validation.ready} archived={!!listing.archived_at} />
            {ref ? <span className="text-2xs tabular-nums text-muted-foreground">#{ref}</span> : null}
          </div>
          <p className="font-display text-sm font-semibold leading-snug text-foreground break-words group-hover:text-[hsl(var(--gold-ink))] sm:text-base">
            {d.title || property?.title || t('pubw_untitled')}
          </p>
          <p className="text-2xs text-muted-foreground break-words">
            {[where, d.price ? formatMoney(d.price, d.currency, locale) : null].filter(Boolean).join(' · ') || '—'}
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
            {portals.filter((portal) => d.portalTargets?.includes(portal.id) || pubs.some((p) => p.portal_id === portal.id)).map((portal) => {
              const pub = pubs.find((p) => p.portal_id === portal.id);
              return (
                <span key={portal.id} className="inline-flex min-w-0 items-center gap-1.5">
                  <PortalLogo portal={portal} size="sm" className="h-6 w-6 rounded-md" />
                  <span className="text-2xs font-semibold text-foreground">{portal.name}</span>
                  <PublicationMark status={pub?.status ?? null} />
                  {pub && isOutdated(pub, listing) ? <span className="text-2xs font-semibold text-amber-700">· {t('pubw_outdated_short')}</span> : null}
                </span>
              );
            })}
          </div>
        </div>
        <div className="col-span-2 flex items-center justify-between gap-2 border-t border-border pt-2 sm:col-span-1 sm:flex-col sm:items-end sm:justify-center sm:border-0 sm:pt-0">
          <span className="text-2xs text-muted-foreground">{t('pubw_updated', { when: dateTime(listing.updated_at, locale) })}</span>
          <span className="inline-flex items-center gap-1 text-2xs font-semibold text-[hsl(var(--gold-ink))]">
            {t('pubw_manage')}<ExternalLink className="h-3 w-3 rtl:-scale-x-100" aria-hidden="true" />
          </span>
        </div>
      </Link>
    </li>
  );
}

export default function PublishingWorkspacePage() {
  return (
    <RouteGuard>
      <AppLayout noPadding surfaceClass={OWNER_SURFACE}>
        <Workspace />
      </AppLayout>
    </RouteGuard>
  );
}
