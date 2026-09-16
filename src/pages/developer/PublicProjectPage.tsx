import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Building2, MapPin, Box, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { PublicHeader, HeaderSpacer, type HeaderLink } from '@/components/home/PublicHeader';
import { SiteFooter } from '@/components/home/sections/SiteFooter';
import { resolvePublicProject } from '@/services/developer/share';
import { formatMoney, formatArea, formatDate } from '@/components/developer/primitives';
import type { SharedUnitPayload, UnitStatus } from '@/services/developer/types';

/**
 * A PUBLISHED PROJECT (§58, §170).
 *
 * Reached at /projects/:developer/:project, and only ever showing a project
 * whose `is_published` is true, from a workspace whose status is ACTIVE, with
 * the units that are themselves published and not sold. That filtering
 * happens inside dev_public_project — a SECURITY DEFINER function naming its
 * columns — and not in this component, because a mistake here should not be
 * able to widen what a stranger can see.
 *
 * Indexable, unlike the private share page: a developer's live project page
 * is exactly the sort of thing that should be findable, and every fact on it
 * is one the developer chose to publish.
 */
export default function PublicProjectPage() {
  const { developer, project: projectSlug } = useParams<{ developer: string; project: string }>();
  useSurfaceTheme('light');
  const { t, lang: language } = useLanguage();

  const [payload, setPayload] = useState<SharedUnitPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [bedroomFilter, setBedroomFilter] = useState<number | 'ALL'>('ALL');

  useEffect(() => {
    if (!developer || !projectSlug) return;
    let cancelled = false;
    setLoading(true);
    resolvePublicProject(developer, projectSlug)
      .then((data) => { if (!cancelled) setPayload(data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [developer, projectSlug]);

  const project = payload?.project;
  const brand = payload?.developer;
  const units = useMemo(() => payload?.units ?? [], [payload]);

  const bedroomOptions = useMemo(() => {
    const set = new Set<number>();
    for (const unit of units) if (typeof unit.bedrooms === 'number') set.add(unit.bedrooms);
    return Array.from(set).sort((a, b) => a - b);
  }, [units]);

  const visible = useMemo(
    () => (bedroomFilter === 'ALL' ? units : units.filter((u) => u.bedrooms === bedroomFilter)),
    [units, bedroomFilter],
  );

  const priceRange = useMemo(() => {
    const prices = units.map((u) => u.price).filter((p): p is number => typeof p === 'number');
    if (prices.length === 0) return null;
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [units]);

  const headerLinks: HeaderLink[] = [
    { key: 'home', label: t('mp_nav_start'), target: '/' },
    { key: 'developers', label: t('mp_nav_developers'), target: '/developers' },
    { key: 'verify', label: t('nav_verify'), target: '/verify' },
  ];

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold border-t-transparent" role="status">
          <span className="sr-only">{t('dev_loading')}</span>
        </div>
      </div>
    );
  }

  if (!payload || payload.error || !project) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PublicHeader links={headerLinks} solid />
        <HeaderSpacer />
        <main className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center">
          <Building2 className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
          <h1 className="text-2xl font-semibold">{t('dev_public_not_found_title')}</h1>
          <p className="text-sm text-muted-foreground">{t('dev_public_not_found_body')}</p>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const currency = project.currency ?? 'USD';

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <Helmet>
        <title>{`${project.name} — ${brand?.name ?? ''}`.trim()}</title>
        <meta
          name="description"
          content={(project.description ?? '').slice(0, 155)
            || `${project.name}, ${[project.district, project.city].filter(Boolean).join(', ')}`}
        />
        <link rel="canonical" href={`${typeof window !== 'undefined' ? window.location.origin : ''}/projects/${developer}/${projectSlug}`} />
      </Helmet>

      <PublicHeader links={headerLinks} solid />
      <HeaderSpacer />

      <main>
        {/* ── Hero ─────────────────────────────────────────────────── */}
        <section className="relative">
          <div className="aspect-[21/9] max-h-[28rem] w-full overflow-hidden bg-muted">
            {project.cover_image_url ? (
              <img src={project.cover_image_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Building2 className="h-12 w-12 text-muted-foreground/30" aria-hidden="true" />
              </div>
            )}
          </div>

          <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-gold-ink">
              {brand?.name}
            </p>
            <div className="mt-2 h-px w-10 bg-gold/70" aria-hidden="true" />
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">{project.name}</h1>
            {(project.district || project.city) && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                {[project.address, project.district, project.city].filter(Boolean).join(', ')}
              </p>
            )}

            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-6 sm:grid-cols-4">
              <div>
                <dt className="text-2xs uppercase tracking-wider text-muted-foreground">
                  {t('dev_public_available')}
                </dt>
                <dd className="mt-0.5 text-lg font-semibold tabular">{units.length}</dd>
              </div>
              {priceRange && (
                <div>
                  <dt className="text-2xs uppercase tracking-wider text-muted-foreground">
                    {t('dev_public_from')}
                  </dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular">
                    {formatMoney(priceRange.min, currency, language)}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-2xs uppercase tracking-wider text-muted-foreground">
                  {t('dev_share_construction')}
                </dt>
                <dd className="mt-0.5 text-sm font-medium">
                  {project.construction_status
                    ? t(`dev_cs_${String(project.construction_status).toLowerCase()}`)
                    : '—'}
                </dd>
              </div>
              {project.handover_date && (
                <div>
                  <dt className="text-2xs uppercase tracking-wider text-muted-foreground">
                    {t('dev_handover')}
                  </dt>
                  <dd className="mt-0.5 text-sm font-medium">
                    {formatDate(project.handover_date, language)}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </section>

        {project.description && (
          <section className="mx-auto max-w-3xl px-4 pb-10 sm:px-6">
            <p className="whitespace-pre-wrap text-base leading-relaxed">{project.description}</p>
          </section>
        )}

        {/* ── Available units ──────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6" aria-labelledby="dev-pub-units">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="dev-pub-units" className="text-xl font-semibold tracking-tight">
              {t('dev_public_units_title')}
            </h2>
            {bedroomOptions.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('dev_unit_bedrooms')}>
                <FilterChip
                  active={bedroomFilter === 'ALL'}
                  onClick={() => setBedroomFilter('ALL')}
                  label={t('dev_filter_all')}
                />
                {bedroomOptions.map((n) => (
                  <FilterChip
                    key={n}
                    active={bedroomFilter === n}
                    onClick={() => setBedroomFilter(n)}
                    label={t('dev_n_bed').replace('{n}', String(n))}
                  />
                ))}
              </div>
            )}
          </div>

          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
              {units.length === 0 ? t('dev_public_no_units') : t('dev_public_no_matching')}
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((unit) => (
                <li key={unit.id}>
                  <article className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card">
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                      {Array.isArray(unit.photos) && unit.photos.length > 0 ? (
                        <img src={(unit.photos as string[])[0]} alt="" loading="lazy"
                          className="h-full w-full object-cover" />
                      ) : unit.floor_plan_url ? (
                        <img src={unit.floor_plan_url} alt="" loading="lazy"
                          className="h-full w-full bg-white object-contain p-3" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Building2 className="h-7 w-7 text-muted-foreground/30" aria-hidden="true" />
                        </div>
                      )}
                      {(unit as { has_walkthrough?: boolean }).has_walkthrough && (
                        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-gold-border bg-background/90 px-2 py-0.5 text-2xs font-medium text-gold-ink backdrop-blur">
                          <Box className="h-3 w-3" aria-hidden="true" />
                          {t('dev_public_has_tour')}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-1 flex-col gap-1.5 p-4">
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="truncate text-base font-semibold">{unit.unit_number}</h3>
                        <UnitAvailability status={unit.status as UnitStatus} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {[
                          unit.bedrooms != null ? t('dev_n_bed').replace('{n}', String(unit.bedrooms)) : null,
                          unit.area_total != null ? formatArea(unit.area_total, language) : null,
                          unit.floor_level != null ? `${t('dev_unit_floor')} ${unit.floor_level}` : null,
                        ].filter(Boolean).join(' · ')}
                      </p>
                      <p className="mt-auto pt-2 text-lg font-semibold tabular">
                        {formatMoney(unit.price ?? null, unit.currency ?? currency, language)}
                      </p>
                      {unit.price_per_sqm != null && (
                        <p className="text-2xs text-muted-foreground tabular">
                          {formatMoney(unit.price_per_sqm, unit.currency ?? currency, language)} / m²
                        </p>
                      )}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}

          {/* A published project page shows what is for sale. Arranging a
              viewing goes through the developer, whose details they chose to
              publish — Homatch does not insert itself into that. */}
          {brand?.website && (
            <p className="mt-8 text-center">
              <a
                href={brand.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium text-gold-ink underline-offset-4 hover:underline"
              >
                {t('dev_public_contact_developer').replace('{name}', brand.name)}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </p>
          )}
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function FilterChip({
  active, onClick, label,
}: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-gold-border bg-gold/10 font-semibold text-gold-ink'
          : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function UnitAvailability({ status }: { status: UnitStatus }) {
  const { t } = useLanguage();
  // A public page says available or not available. The internal vocabulary —
  // on hold, under negotiation, contract pending — is the developer's own
  // business and is not a buyer's.
  const available = status === 'AVAILABLE';
  return (
    <span className={cn(
      'shrink-0 rounded-full border px-2 py-0.5 text-2xs font-medium',
      available
        ? 'border-emerald-600/40 bg-emerald-500/[0.07] text-emerald-700'
        : 'border-border bg-muted/60 text-muted-foreground',
    )}>
      {t(available ? 'dev_public_available_now' : 'dev_public_reserved')}
    </span>
  );
}
