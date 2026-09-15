import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  Box, Maximize2, X, MapPin, Home, Ruler, Compass, Eye, FileText,
  CalendarClock, Phone, Building2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { resolveShare, trackShare } from '@/services/developer/share';
import { isAllowedEmbedUrl } from '@/services/developer/inventory';
import { formatMoney, formatArea, formatDate } from '@/components/developer/primitives';
import type { SharedUnitPayload } from '@/services/developer/types';

/**
 * ONE LINK (§19, §21).
 *
 * This is the page that replaces a PDF, a row of a spreadsheet, a dump of
 * photographs and eleven WhatsApp messages. A buyer opens it on a phone, in a
 * browser, with no account and nothing to install, and sees the apartment.
 *
 * WHAT IT KNOWS AND HOW. Everything here arrives from ONE call to
 * dev_share_resolve, a SECURITY DEFINER function that returns named
 * publishable fields. The anon role has no grant on any dev_* table, so there
 * is no query on this page that could be widened by mistake.
 *
 * THE VIEWER IS NOT INSTRUMENTED. Activity is recorded for the things a
 * developer legitimately needs — the link was opened, the tour was launched,
 * the payment plan was looked at — and the identifier behind it is a
 * per-tab random string the server hashes with the link's own token and the
 * date before storing. It cannot be joined to another link, another day, or
 * anything outside this product (§22).
 *
 * THE TOUR IS AN IFRAME FROM AN ALLOWLIST, checked again here and not only
 * when it was saved, so a row written before the list changed cannot become
 * live by redeploying.
 */
export default function SharedUnitPage() {
  const { token } = useParams<{ token: string }>();
  useSurfaceTheme('light');
  const { t, lang: language } = useLanguage();

  const [payload, setPayload] = useState<SharedUnitPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [tourOpen, setTourOpen] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const tracked = useRef(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    resolveShare(token)
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        if (!data.error && !tracked.current) {
          tracked.current = true;
          trackShare(token, 'OPENED');
          if (data.unit) trackShare(token, 'UNIT_VIEWED', { unit: data.unit.unit_number });
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const unit = payload?.unit;
  const project = payload?.project;
  const developer = payload?.developer;
  const walkthrough = payload?.walkthrough;
  const plan = payload?.payment_plan;

  const photos = useMemo(
    () => (Array.isArray(unit?.photos) ? (unit!.photos as string[]).filter(Boolean) : []),
    [unit],
  );

  const tourUsable = Boolean(
    walkthrough && (walkthrough.provider === 'PANORAMA'
      ? walkthrough.scenes.length > 0
      : isAllowedEmbedUrl(walkthrough.embed_url)),
  );

  const openTour = useCallback(() => {
    setTourOpen(true);
    if (token) trackShare(token, 'WALKTHROUGH_OPENED');
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold border-t-transparent" role="status">
          <span className="sr-only">{t('dev_loading')}</span>
        </div>
      </div>
    );
  }

  if (!payload || payload.error || !unit || !project) {
    const key = payload?.error === 'EXPIRED' ? 'dev_share_gone_expired'
      : payload?.error === 'REVOKED' ? 'dev_share_gone_revoked'
        : 'dev_share_gone_missing';
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <Building2 className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
        <h1 className="text-xl font-semibold">{t('dev_share_gone_title')}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t(key)}</p>
      </div>
    );
  }

  const title = `${project.name} — ${unit.unit_number}`;
  const priceText = formatMoney(unit.price ?? null, unit.currency ?? 'USD', language);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Helmet>
        <title>{title}</title>
        {/* A private link must never be indexed (§170). */}
        <meta name="robots" content="noindex, nofollow" />
        <meta name="description" content={`${unit.unit_number} · ${formatArea(unit.area_total ?? null, language)}`} />
      </Helmet>

      {/* Developer brand bar. Their name at the top, Homatch at the bottom. */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          {developer?.logo_url ? (
            <img src={developer.logo_url} alt={developer.name} className="h-8 w-auto object-contain" />
          ) : (
            <span className="text-base font-semibold tracking-tight">{developer?.name}</span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-24 pt-6 sm:px-6">
        {/* ── Identity ─────────────────────────────────────────────── */}
        <div className="mb-5">
          <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-gold-ink">
            {project.name}
          </p>
          <div className="mt-2 h-px w-10 bg-gold/70" aria-hidden="true" />
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            {unit.unit_number}
          </h1>
          {(project.district || project.city) && (
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {[project.district, project.city].filter(Boolean).join(', ')}
            </p>
          )}
        </div>

        {/* ── Hero: photos or tour cover ───────────────────────────── */}
        <div className="relative mb-6 overflow-hidden rounded-xl border border-border bg-muted">
          {photos.length > 0 ? (
            <>
              <img
                src={photos[photoIndex]}
                alt={`${unit.unit_number} — ${photoIndex + 1}/${photos.length}`}
                className="aspect-[16/10] w-full object-cover"
              />
              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label={t('dev_previous')}
                    onClick={() => setPhotoIndex((i) => (i - 1 + photos.length) % photos.length)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-background/85 p-2 backdrop-blur transition-colors hover:bg-background"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('dev_next')}
                    onClick={() => {
                      setPhotoIndex((i) => (i + 1) % photos.length);
                      if (token) trackShare(token, 'PHOTOS_VIEWED');
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-background/85 p-2 backdrop-blur transition-colors hover:bg-background"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
                    {photos.map((_, i) => (
                      <span
                        key={i}
                        aria-hidden="true"
                        className={cn('h-1.5 w-1.5 rounded-full',
                          i === photoIndex ? 'bg-gold' : 'bg-background/70')}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : walkthrough?.cover_image_url ? (
            <img src={walkthrough.cover_image_url} alt="" className="aspect-[16/10] w-full object-cover" />
          ) : (
            /* No photographs and no tour cover. A 16:10 placeholder here is
               half a phone screen of empty grey above the price, which is the
               first thing a buyer should see — so the empty state is a band,
               not a hero. */
            <div className="flex h-28 w-full items-center justify-center sm:h-36">
              <Building2 className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
            </div>
          )}

          {tourUsable && (
            <button
              type="button"
              onClick={openTour}
              className="absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-full border border-gold-border bg-background/95 px-4 py-2 text-sm font-semibold text-gold-ink shadow-sm backdrop-blur transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Box className="h-4 w-4" aria-hidden="true" />
              {t('dev_share_open_tour')}
            </button>
          )}
        </div>

        {/* ── The numbers ──────────────────────────────────────────── */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
          <div>
            <p className="text-3xl font-semibold tracking-tight sm:text-4xl">{priceText}</p>
            {unit.price_per_sqm != null && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {formatMoney(unit.price_per_sqm, unit.currency ?? 'USD', language)} / m²
              </p>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <Spec icon={Ruler} label={t('dev_unit_area')} value={formatArea(unit.area_total ?? null, language)} />
            <Spec icon={Home} label={t('dev_unit_bedrooms')} value={unit.bedrooms ?? '—'} />
            <Spec icon={Building2} label={t('dev_unit_floor')} value={unit.floor_level ?? '—'} />
            <Spec icon={Compass} label={t('dev_unit_orientation')} value={unit.orientation ?? '—'} />
          </dl>
        </div>

        {/* ── Detail ───────────────────────────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-[1fr,20rem]">
          <div className="min-w-0 space-y-6">
            {project.description && (
              <section>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('dev_share_about')}
                </h2>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{project.description}</p>
              </section>
            )}

            {unit.floor_plan_url && (
              <section>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('dev_share_floor_plan')}
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    if (token) trackShare(token, 'FLOORPLAN_VIEWED');
                    window.open(unit.floor_plan_url!, '_blank', 'noopener,noreferrer');
                  }}
                  className="block w-full overflow-hidden rounded-lg border border-border bg-white p-3 transition-colors hover:border-gold-border/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <img src={unit.floor_plan_url} alt={t('dev_share_floor_plan')}
                    className="mx-auto max-h-[28rem] w-auto object-contain" />
                </button>
              </section>
            )}

            {Array.isArray(project.amenities) && project.amenities.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('dev_share_amenities')}
                </h2>
                <ul className="flex flex-wrap gap-1.5">
                  {(project.amenities as string[]).map((amenity) => (
                    <li key={amenity}
                      className="rounded-full border border-border px-2.5 py-1 text-xs">
                      {amenity}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {/* ── Sidebar ────────────────────────────────────────────── */}
          <aside className="space-y-4">
            {plan && plan.milestones.length > 0 && (
              <section
                className="rounded-lg border border-border p-4"
                onMouseEnter={() => { if (token) trackShare(token, 'PAYMENT_PLAN_VIEWED'); }}
              >
                <h2 className="mb-3 text-sm font-semibold">{plan.name}</h2>
                <ol className="space-y-2">
                  {plan.milestones.map((m, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-muted-foreground">{m.label}</span>
                      <span className="shrink-0 font-medium tabular">
                        {m.percent != null && `${m.percent}%`}
                        {m.amount != null && formatMoney(Number(m.amount), unit.currency ?? 'USD', language)}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {project.construction_status && (
              <section className="rounded-lg border border-border p-4">
                <h2 className="mb-2 text-sm font-semibold">{t('dev_share_construction')}</h2>
                <p className="text-sm text-muted-foreground">
                  {t(`dev_cs_${project.construction_status.toLowerCase()}`)}
                </p>
                {project.handover_date && (
                  <p className="mt-1 text-sm">
                    {t('dev_handover')}: {formatDate(project.handover_date, language)}
                  </p>
                )}
              </section>
            )}

            {project.brochure_url && (
              <Button
                variant="outline" className="w-full" asChild
                onClick={() => { if (token) trackShare(token, 'BROCHURE_OPENED'); }}
              >
                <a href={project.brochure_url} target="_blank" rel="noopener noreferrer">
                  <FileText className="mr-2 h-4 w-4" />
                  {t('dev_share_brochure')}
                </a>
              </Button>
            )}
          </aside>
        </div>
      </main>

      {/* ── Sticky action bar ──────────────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2.5 sm:px-6">
          <div className="hidden min-w-0 flex-1 sm:block">
            <p className="truncate text-sm font-semibold">{priceText}</p>
            <p className="truncate text-2xs text-muted-foreground">
              {unit.unit_number} · {formatArea(unit.area_total ?? null, language)}
            </p>
          </div>
          {tourUsable && (
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={openTour}>
              <Box className="mr-2 h-4 w-4" />
              {t('dev_share_open_tour')}
            </Button>
          )}
          <Button
            className="flex-1 sm:flex-none"
            onClick={() => { if (token) trackShare(token, 'VIEWING_REQUESTED'); }}
            asChild
          >
            <a href={developer?.website ?? '#'} target={developer?.website ? '_blank' : undefined}
              rel="noopener noreferrer">
              <CalendarClock className="mr-2 h-4 w-4" />
              {t('dev_share_request_viewing')}
            </a>
          </Button>
        </div>
        <p className="border-t border-border py-1.5 text-center text-2xs text-muted-foreground">
          {t('dev_powered_by')}
        </p>
      </div>

      {tourOpen && walkthrough && (
        <TourViewer
          walkthrough={walkthrough}
          title={title}
          onClose={() => setTourOpen(false)}
        />
      )}
    </div>
  );
}

function Spec({
  icon: Icon, label, value,
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-2xs uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm font-medium tabular">{value}</dd>
    </div>
  );
}

/**
 * The walkthrough itself. Loaded only when opened (§91) — a buyer scrolling
 * the page on a phone must not pay for a 3D asset they never asked for, and
 * a tour iframe on mount is the difference between a page that opens and a
 * page that stalls on a train.
 */
function TourViewer({
  walkthrough, title, onClose,
}: {
  walkthrough: NonNullable<SharedUnitPayload['walkthrough']>;
  title: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [scene, setScene] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const scenes = walkthrough.scenes ?? [];
  const embeddable = isAllowedEmbedUrl(walkthrough.embed_url);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-2.5 text-white">
        <p className="min-w-0 truncate text-sm font-medium">{walkthrough.title || title}</p>
        <button
          type="button" onClick={onClose} aria-label={t('dev_close')}
          className="rounded-full p-2 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {walkthrough.provider === 'PANORAMA' && scenes.length > 0 ? (
          <img
            src={scenes[scene]?.image_url}
            alt={scenes[scene]?.name ?? ''}
            className="h-full w-full object-contain"
          />
        ) : embeddable ? (
          <iframe
            src={walkthrough.embed_url!}
            title={walkthrough.title || title}
            className="h-full w-full border-0"
            allow="xr-spatial-tracking; gyroscope; accelerometer; fullscreen"
            allowFullScreen
            // The tour is a third party's page. It gets a sandbox, and it
            // does not get same-origin access to ours.
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-white/80">
            <p className="max-w-sm text-sm">{t('dev_tour_unavailable')}</p>
          </div>
        )}
      </div>

      {walkthrough.provider === 'PANORAMA' && scenes.length > 1 && (
        <div className="shrink-0 overflow-x-auto px-4 py-3">
          <ul className="flex min-w-max gap-2">
            {scenes.map((s, i) => (
              <li key={s.id ?? i}>
                <button
                  type="button"
                  onClick={() => setScene(i)}
                  aria-current={i === scene ? 'true' : undefined}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs text-white transition-colors',
                    i === scene ? 'border-gold bg-white/10 font-semibold' : 'border-white/25 hover:bg-white/5',
                  )}
                >
                  {s.name || `${t('dev_room')} ${i + 1}`}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
