// /publishing/new — choose which of your properties to publish.
//
// A listing is always built FROM an existing HOMATCH property (its six-digit
// reference, its photos, its facts), never as a second property record. A property
// that already has a listing opens that listing instead of starting another one.

import { ArrowRight, Plus } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PrivateImage } from '@/components/common/PrivateImage';
import { RouteGuard } from '@/components/common/RouteGuard';
import { EmptyState, OWNER_SURFACE, PageHero } from '@/components/customer/surface';
import { AppLayout } from '@/components/layouts/AppLayout';
import { NavGlyphIcon } from '@/components/layouts/NavGlyph';
import { MediaWell, OWNER_PRIMARY } from '@/components/owner/portfolio';
import { useErrorText } from '@/components/publishing/parts';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { placeName } from '@/lib/placeNames';
import { coverImage } from '@/property/gallery';
import { listPortfolio } from '@/services/propertyManagement';
import { PublishingError, loadWorkspace } from '@/services/publishing';
import type { Property } from '@/types/types';

function Picker() {
  const { homatchUser } = useAuth();
  const { t, lang } = useLanguage();
  const errorText = useErrorText();
  const locale = intlLocaleFor(lang);
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [listed, setListed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!homatchUser?.id) return;
    let live = true;
    Promise.all([listPortfolio({ userId: homatchUser.id, view: 'ACTIVE', limit: 200 }), loadWorkspace().catch(() => null)])
      .then(([props, ws]) => { if (!live) return; setProperties(props); setListed(new Set((ws?.listings ?? []).map((l) => l.id))); })
      .catch((e) => { if (live) setError(e instanceof PublishingError ? e.code : 'NETWORK_ERROR'); });
    return () => { live = false; };
  }, [homatchUser?.id]);

  const shown = useMemo(() => (properties ?? []).filter((p) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    const f = (p.facts ?? {}) as Record<string, unknown>;
    return [p.title, f.city, f.district, f.address, p.homatch_id != null ? String(p.homatch_id) : ''].some((v) => String(v ?? '').toLowerCase().includes(needle));
  }), [properties, q]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6">
      <nav aria-label={t('pubw_breadcrumb')} className="text-2xs text-muted-foreground">
        <Link to="/publishing" className="font-semibold hover:text-foreground">{t('nav_publishing')}</Link>
        <span className="mx-1.5" aria-hidden="true">/</span>
        <span>{t('pubw_choose_title')}</span>
      </nav>
      <PageHero compact title={t('pubw_choose_title')} subtitle={t('pubw_choose_subtitle')} />
      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{errorText(error)}</p> : null}
      {properties === null && !error ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
      ) : properties && properties.length === 0 ? (
        <EmptyState
          icon={(p) => <NavGlyphIcon name="publishing" className={p.className} />}
          title={t('pubw_empty_title')}
          body={t('pubw_empty_body_no_properties')}
          actions={<Link to="/property/add" className={OWNER_PRIMARY}><Plus className="h-4 w-4" aria-hidden="true" />{t('pubw_add_property')}</Link>}
        />
      ) : properties ? (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('pubw_search_ph')}
            aria-label={t('pubw_search_ph')}
            className="h-10 w-full rounded-lg border border-border bg-[hsl(var(--card))] px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-[hsl(var(--gold-border))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--gold))]/25"
          />
          <ul className="space-y-2">
            {shown.map((p) => {
              const f = (p.facts ?? {}) as Record<string, any>;
              const cover = coverImage({ coverPhotoUrl: p.cover_photo_url ?? null, photos: p.photos ?? null });
              const has = listed.has(String(p.id));
              return (
                <li key={p.id}>
                  <Link to={`/publishing/${p.id}`} className="group grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border bg-[hsl(var(--card))] p-2.5 shadow-card hover:border-[hsl(var(--gold-border))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">
                    <div className="overflow-hidden rounded-lg">
                      <MediaWell hasMedia={Boolean(cover)}>
                        {cover ? <PrivateImage src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" pending={<div className="absolute inset-0 animate-pulse bg-[hsl(var(--secondary))]" />} /> : null}
                      </MediaWell>
                    </div>
                    <div className="min-w-0">
                      <p className="font-display text-sm font-semibold text-foreground break-words">{p.title || t('pubw_untitled')}</p>
                      <p className="text-2xs text-muted-foreground break-words">
                        {[p.homatch_id != null ? `#${String(p.homatch_id).padStart(6, '0')}` : null, placeName(f.city, lang), f.total_price ? formatMoney(Number(f.total_price), String(f.currency || 'USD'), locale) : null].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 text-2xs font-semibold text-[hsl(var(--gold-ink))]">
                      <span className="hidden sm:inline">{t(has ? 'pubw_open_listing' : 'pubw_start_listing')}</span>
                      <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="text-2xs text-muted-foreground">
            {t('pubw_choose_missing')} <Link to="/property/add" className="font-semibold text-[hsl(var(--gold-ink))] underline-offset-2 hover:underline">{t('pubw_add_property')}</Link>
          </p>
        </>
      ) : null}
    </div>
  );
}

export default function PublishingNewPage() {
  return (
    <RouteGuard>
      <AppLayout noPadding surfaceClass={OWNER_SURFACE}>
        <Picker />
      </AppLayout>
    </RouteGuard>
  );
}
