import React, {
  Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  Building2, Layers, Home, X, Share2, ExternalLink, MapPin, Ruler,
  Compass, Eye, ChevronLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import {
  loadManifest, loadBuildingFloors, loadFloorUnits, loadScene,
  TwinTracker, experienceUrl,
} from '@/services/developer/twin';
import { UnitStatusPill, formatMoney, formatArea, formatNumber } from '@/components/developer/primitives';
import type {
  ExperienceManifest, ManifestBuilding, FloorSummary, TwinUnit,
  TwinScene, TwinSchematicFloor,
} from '@/services/developer/twin';

/**
 * THE DIGITAL TWIN, AS A BUYER MEETS IT.
 *
 * PROGRESSIVE BY CONSTRUCTION, NOT BY OPTIMISATION. Opening this fetches the
 * manifest — the development, its buildings, and a COUNT of what is available
 * in each. About a kilobyte, and the same kilobyte whether the scheme has
 * forty apartments or two thousand. Picking a building fetches that
 * building's floors, still only counts. Picking a floor is the first request
 * in the whole session that returns apartment rows, and it returns one
 * floor's worth.
 *
 * That ordering is the cost model. A visitor who opens the page, looks at the
 * massing and leaves has cost us one small json response and whatever the CDN
 * charged for a cached model — not a database read per apartment, and not a
 * GPU-second.
 *
 * WHITE LABEL WITHOUT A SECOND APPLICATION. The developer's name, logo and
 * accent colour come from the experience row. There is no separate deployment
 * per customer, which is why a price corrected at four o'clock is correct on
 * every embed of it at four o'clock.
 *
 * EMBED IS THE SAME PAGE. /embed drops the outer chrome and nothing else, so
 * an iframe on a developer's own website is showing this exact canonical
 * project rather than a copy that can drift.
 */
const TwinCanvas = lazy(() => import('@/components/developer/TwinCanvas'));

export interface TwinViewerPageProps {
  /** /embed renders the same thing without the page chrome. */
  embedded?: boolean;
}

export default function TwinViewerPage({ embedded = false }: TwinViewerPageProps) {
  const { workspace: workspaceSlug, project: projectSlug } =
    useParams<{ workspace: string; project: string }>();
  const [params, setParams] = useSearchParams();
  useSurfaceTheme('light');
  const { t, lang: language } = useLanguage();

  const [manifest, setManifest] = useState<ExperienceManifest | null>(null);
  const [loading, setLoading] = useState(true);

  const [building, setBuilding] = useState<ManifestBuilding | null>(null);
  const [floors, setFloors] = useState<FloorSummary[]>([]);
  const [floorsLoading, setFloorsLoading] = useState(false);

  const [level, setLevel] = useState<number | null>(null);
  const [units, setUnits] = useState<TwinUnit[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);

  const [unit, setUnit] = useState<TwinUnit | null>(null);
  const [scene, setScene] = useState<TwinScene | null>(null);

  const tracker = useRef<TwinTracker | null>(null);

  // ── Phase 1: the shell ───────────────────────────────────────────────────
  useEffect(() => {
    if (!workspaceSlug || !projectSlug) return;
    let cancelled = false;
    setLoading(true);
    loadManifest(workspaceSlug, projectSlug)
      .then((data) => {
        if (cancelled) return;
        setManifest(data);
        if (!data.error) {
          tracker.current = new TwinTracker(
            workspaceSlug, projectSlug,
            embedded ? 'EMBED' : 'PUBLIC',
            data.experience?.slug ?? null,
          );
          tracker.current.track({ kind: embedded ? 'EMBED_OPEN' : 'PROJECT_OPEN' });
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      void tracker.current?.flush();
    };
  }, [workspaceSlug, projectSlug, embedded]);

  // ── Deep links: ?b=building&f=floor&u=unit ───────────────────────────────
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !manifest?.buildings) return;
    const b = params.get('b');
    if (b) {
      const found = manifest.buildings.find((x) => x.id === b);
      if (found) { deepLinked.current = true; void openBuilding(found, false); }
    } else if (manifest.buildings.length === 1) {
      // A single-building scheme should not make somebody click the only door.
      deepLinked.current = true;
      void openBuilding(manifest.buildings[0], false);
    }
    // openBuilding is stable for this purpose; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest]);

  // ── Phase 2: one building's floors, still only counts ────────────────────
  const openBuilding = useCallback(async (
    target: ManifestBuilding, replaceUrl = true,
  ) => {
    setBuilding(target);
    setLevel(null);
    setUnits([]);
    setUnit(null);
    setFloorsLoading(true);
    tracker.current?.track({ kind: 'BUILDING_VIEW', building_id: target.id });

    if (replaceUrl) {
      const next = new URLSearchParams(params);
      next.set('b', target.id);
      next.delete('f');
      next.delete('u');
      setParams(next, { replace: true });
    }

    // The scene and the floors are independent; asking for them together
    // saves a round trip on a connection where round trips are the cost.
    const [floorResult, sceneResult] = await Promise.all([
      loadBuildingFloors(target.id),
      target.scene_id ? loadScene(target.scene_id) : Promise.resolve(null),
    ]);
    setFloors(floorResult.floors);
    setScene(sceneResult);
    setFloorsLoading(false);

    const wanted = params.get('f');
    if (wanted !== null) {
      const n = Number(wanted);
      if (Number.isFinite(n) && floorResult.floors.some((f) => f.level === n)) {
        void openFloor(n, target.id, false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, setParams]);

  // ── Phase 3: the first request that returns apartments ───────────────────
  const openFloor = useCallback(async (
    floorLevel: number, buildingId?: string, replaceUrl = true,
  ) => {
    const id = buildingId ?? building?.id;
    if (!id) return;
    setLevel(floorLevel);
    setUnit(null);
    setUnitsLoading(true);
    tracker.current?.track({
      kind: 'FLOOR_VIEW', building_id: id, meta: { level: floorLevel },
    });

    if (replaceUrl) {
      const next = new URLSearchParams(params);
      next.set('f', String(floorLevel));
      next.delete('u');
      setParams(next, { replace: true });
    }

    const rows = await loadFloorUnits(id, floorLevel);
    setUnits(rows);
    setUnitsLoading(false);

    const wanted = params.get('u');
    if (wanted) {
      const found = rows.find((u) => u.id === wanted);
      if (found) openUnit(found, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building, params, setParams]);

  const openUnit = useCallback((target: TwinUnit, replaceUrl = true) => {
    setUnit(target);
    tracker.current?.track({
      kind: 'UNIT_VIEW', building_id: building?.id ?? null, unit_id: target.id,
    });
    if (replaceUrl) {
      const next = new URLSearchParams(params);
      next.set('u', target.id);
      setParams(next, { replace: true });
    }
  }, [building, params, setParams]);

  /**
   * What the canvas draws when no geometry has been authored: the real floors,
   * with real counts. Memoised by identity because the canvas rebuilds its
   * scene whenever this changes.
   */
  const schematic: TwinSchematicFloor[] = useMemo(
    () => floors.map((f) => ({ level: f.level, available: f.available, total: f.total })),
    [floors],
  );

  const accent = (manifest?.developer?.brand_color) || null;

  async function share() {
    if (!workspaceSlug || !projectSlug) return;
    const url = experienceUrl({
      workspaceSlug, projectSlug,
      buildingId: building?.id ?? null,
      floorLevel: level,
      unitId: unit?.id ?? null,
    });
    tracker.current?.track({ kind: 'SHARE', unit_id: unit?.id ?? null });
    try {
      if (navigator.share) {
        await navigator.share({ title: manifest?.project?.name ?? '', url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success(t('twin_link_copied'));
      }
    } catch {
      // A share sheet the person dismissed is not an error worth a toast.
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-2" role="status" aria-live="polite">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold border-t-transparent" />
          <span className="text-2xs text-muted-foreground">{t('twin_loading')}</span>
        </div>
      </div>
    );
  }

  if (!manifest || manifest.error || !manifest.project) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-sm text-center">
          <Building2 className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
          <h1 className="mt-4 text-lg font-semibold">{t('twin_not_found')}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t('twin_not_found_body')}</p>
        </div>
      </div>
    );
  }

  const project = manifest.project;
  const developer = manifest.developer;

  return (
    <div
      className={cn(
        'flex flex-col bg-background text-foreground',
        embedded ? 'h-screen' : 'min-h-screen',
      )}
      style={accent ? ({ ['--gold' as string]: accent }) : undefined}
    >
      {!embedded && (
        <Helmet>
          <title>{`${project.name} — ${developer?.name ?? 'Homatch'}`}</title>
          <meta
            name="description"
            content={project.description ?? `${project.name}, ${project.city ?? ''}`}
          />
        </Helmet>
      )}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className={cn(
        'shrink-0 border-b border-border bg-card',
        embedded && 'px-1',
      )}>
        <div className={cn(
          'flex items-center gap-3 px-4 py-3',
          !embedded && 'mx-auto max-w-7xl sm:px-6',
        )}>
          {building && !embedded && (
            <Button
              variant="ghost" size="icon"
              onClick={() => { setBuilding(null); setFloors([]); setLevel(null); setUnit(null); }}
              aria-label={t('twin_back_to_site')}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          {developer?.logo_url ? (
            <img
              src={developer.logo_url}
              alt={developer.name}
              className="h-7 w-auto max-w-[120px] shrink-0 object-contain"
            />
          ) : (
            <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold tracking-tight">{project.name}</h1>
            <p className="truncate text-2xs text-muted-foreground">
              {[building?.name, project.district, project.city].filter(Boolean).join(' · ')}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void share()} className="shrink-0">
            <Share2 className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">{t('twin_share')}</span>
          </Button>
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className={cn(
        'flex min-h-0 flex-1 flex-col lg:flex-row',
        !embedded && 'mx-auto w-full max-w-7xl',
      )}>
        {/* The canvas, or the building chooser before one is picked. */}
        <div className="relative min-h-[320px] flex-1 p-3 sm:p-4">
          {!building ? (
            <BuildingChooser
              buildings={manifest.buildings ?? []}
              currency={project.currency}
              onPick={(b) => void openBuilding(b)}
            />
          ) : (
            <Suspense fallback={
              <div className="flex h-full min-h-[320px] items-center justify-center rounded-lg bg-sand/40">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold border-t-transparent" />
              </div>
            }>
              <TwinCanvas
                scene={scene}
                floors={schematic}
                activeLevel={level}
                onSelectLevel={(n) => void openFloor(n)}
                className="min-h-[320px]"
              />
            </Suspense>
          )}
        </div>

        {/* The list beside it. This is the accessible path to everything the
            canvas can do, not a decoration — keyboard and screen-reader users
            never need the 3D at all. */}
        {building && (
          <aside className="flex w-full shrink-0 flex-col border-t border-border lg:w-80 lg:border-l lg:border-t-0">
            {unit ? (
              <UnitPanel
                unit={unit}
                currency={project.currency}
                onClose={() => {
                  setUnit(null);
                  const next = new URLSearchParams(params);
                  next.delete('u');
                  setParams(next, { replace: true });
                }}
                onFloorPlan={() => tracker.current?.track({
                  kind: 'FLOORPLAN_VIEW', unit_id: unit.id,
                })}
              />
            ) : (
              <FloorList
                floors={floors}
                loading={floorsLoading}
                activeLevel={level}
                units={units}
                unitsLoading={unitsLoading}
                currency={project.currency}
                onPickFloor={(n) => void openFloor(n)}
                onPickUnit={(u) => openUnit(u)}
              />
            )}
          </aside>
        )}
      </div>

      {/* Attribution is the developer's choice, stored on the experience. */}
      {manifest.experience?.show_homatch_attribution !== false && (
        <footer className="shrink-0 border-t border-border px-4 py-2 text-center">
          <a
            href="https://homatch.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
          >
            {t('twin_powered_by')}
            <span className="font-semibold tracking-tight">HOMATCH</span>
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </footer>
      )}
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function BuildingChooser({
  buildings, currency, onPick,
}: {
  buildings: ManifestBuilding[];
  currency: string;
  onPick: (b: ManifestBuilding) => void;
}) {
  const { t, lang: language } = useLanguage();

  if (buildings.length === 0) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center rounded-lg border border-dashed border-border px-6 text-center">
        <div>
          <Building2 className="mx-auto h-7 w-7 text-muted-foreground/60" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">{t('twin_no_buildings')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('twin_no_buildings_body')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {buildings.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onPick(b)}
          className="group overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-gold-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {b.facade_image_url ? (
            <img
              src={b.facade_image_url}
              alt=""
              className="h-32 w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-32 w-full items-center justify-center bg-sand/40">
              <Building2 className="h-7 w-7 text-muted-foreground/50" aria-hidden="true" />
            </div>
          )}
          <div className="p-3">
            <p className="truncate text-sm font-semibold">{b.name}</p>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              {t('twin_available_of')
                .replace('{available}', formatNumber(b.available, language))
                .replace('{total}', formatNumber(b.total, language))}
            </p>
            {b.price_from != null && (
              <p className="mt-1 text-xs font-medium">
                {t('twin_from')} {formatMoney(b.price_from, currency, language)}
              </p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

function FloorList({
  floors, loading, activeLevel, units, unitsLoading, currency, onPickFloor, onPickUnit,
}: {
  floors: FloorSummary[];
  loading: boolean;
  activeLevel: number | null;
  units: TwinUnit[];
  unitsLoading: boolean;
  currency: string;
  onPickFloor: (level: number) => void;
  onPickUnit: (unit: TwinUnit) => void;
}) {
  const { t, lang: language } = useLanguage();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-4 py-2.5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <Layers className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t('twin_floors')}
        </h2>
      </div>

      {loading && (
        <div className="space-y-2 p-3" role="status" aria-live="polite">
          <span className="sr-only">{t('twin_loading')}</span>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-muted/70" aria-hidden="true" />
          ))}
        </div>
      )}

      {!loading && floors.length === 0 && (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          {t('twin_no_floors')}
        </p>
      )}

      {!loading && floors.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul className="divide-y divide-border">
            {[...floors].sort((a, b) => b.level - a.level).map((floor) => {
              const active = floor.level === activeLevel;
              return (
                <li key={floor.level}>
                  <button
                    type="button"
                    onClick={() => onPickFloor(floor.level)}
                    aria-current={active ? 'true' : undefined}
                    aria-expanded={active}
                    className={cn(
                      'relative flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      active ? 'bg-muted font-semibold' : 'hover:bg-muted/50',
                    )}
                  >
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-gold"
                      />
                    )}
                    <span className="w-10 shrink-0 text-sm tabular">
                      {formatNumber(floor.level, language)}
                    </span>
                    <span className="min-w-0 flex-1 text-2xs text-muted-foreground">
                      {t('twin_available_of')
                        .replace('{available}', formatNumber(floor.available, language))
                        .replace('{total}', formatNumber(floor.total, language))}
                    </span>
                    {floor.price_from != null && (
                      <span className="shrink-0 text-2xs">
                        {formatMoney(floor.price_from, currency, language)}
                      </span>
                    )}
                  </button>

                  {active && (
                    <div className="border-t border-border bg-muted/20 px-2 py-2">
                      {unitsLoading && (
                        <div className="space-y-1.5" role="status" aria-live="polite">
                          <span className="sr-only">{t('twin_loading')}</span>
                          {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="h-8 animate-pulse rounded bg-muted/70" aria-hidden="true" />
                          ))}
                        </div>
                      )}
                      {!unitsLoading && units.length === 0 && (
                        <p className="px-2 py-3 text-center text-2xs text-muted-foreground">
                          {t('twin_no_units')}
                        </p>
                      )}
                      {!unitsLoading && units.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => onPickUnit(u)}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Home className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate text-sm">{u.unit_number}</span>
                          {u.area_total != null && (
                            <span className="shrink-0 text-2xs text-muted-foreground">
                              {formatArea(u.area_total, language)}
                            </span>
                          )}
                          <UnitStatusPill status={u.status} />
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function UnitPanel({
  unit, currency, onClose, onFloorPlan,
}: {
  unit: TwinUnit;
  currency: string;
  onClose: () => void;
  onFloorPlan: () => void;
}) {
  const { t, lang: language } = useLanguage();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
          {unit.unit_number}
        </h2>
        <UnitStatusPill status={unit.status} />
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('dev_close')}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {unit.photos.length > 0 && (
          <img
            src={unit.photos[0]}
            alt={unit.unit_number}
            className="mb-4 h-40 w-full rounded-md object-cover"
            loading="lazy"
          />
        )}

        {/* PRICE IS SHOWN ONLY FOR WHAT IS ACTUALLY FOR SALE. The server
            withholds it for anything reserved or sold, so there is nothing to
            hide here — the field simply is not populated. */}
        {unit.price != null ? (
          <p className="text-xl font-semibold tabular tracking-tight">
            {formatMoney(unit.price, unit.currency || currency, language)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('twin_price_on_request')}</p>
        )}
        {unit.price_per_sqm != null && unit.price != null && (
          <p className="mt-0.5 text-2xs text-muted-foreground">
            {formatMoney(unit.price_per_sqm, unit.currency || currency, language)} / m²
          </p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          {unit.area_total != null && (
            <Detail icon={Ruler} label={t('dev_unit_area')} value={formatArea(unit.area_total, language)} />
          )}
          {unit.bedrooms != null && (
            <Detail icon={Home} label={t('dev_unit_bedrooms')} value={formatNumber(unit.bedrooms, language)} />
          )}
          {unit.orientation && (
            <Detail icon={Compass} label={t('dev_unit_orientation')} value={unit.orientation} />
          )}
          {unit.view_text && (
            <Detail icon={Eye} label={t('dev_unit_view')} value={unit.view_text} />
          )}
          {unit.unit_type?.code && (
            <Detail icon={MapPin} label={t('dev_unit_type')} value={unit.unit_type.name || unit.unit_type.code} />
          )}
        </dl>

        {unit.floor_plan_url && (
          <a
            href={unit.floor_plan_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onFloorPlan}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-gold-ink underline underline-offset-4"
          >
            <Layers className="h-4 w-4" aria-hidden="true" />
            {t('twin_floor_plan')}
          </a>
        )}
      </div>
    </div>
  );
}

function Detail({
  icon: Icon, label, value,
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-2xs uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{value}</dd>
    </div>
  );
}
