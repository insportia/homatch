import React, { useMemo, useState } from 'react';
import { Layers, Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { UnitStatusPill, EmptyState, Money, formatArea, UNIT_STATUS_KEYS } from './primitives';
import type { DevUnit, DevBuilding, UnitStatus } from '@/services/developer/types';

/**
 * THE INTERACTIVE INVENTORY MAP (§17).
 *
 * WHAT IT DRAWS, AND WHAT IT REFUSES TO DRAW
 *
 * Two modes, and which one you get depends entirely on what the developer has
 * actually given us:
 *
 *   FACADE  the building has a render AND units have been mapped onto it.
 *           Polygons are drawn over the image at the percentages stored on
 *           each unit, so the same mapping survives a re-exported render at a
 *           different resolution.
 *
 *   PLATE   no render, or no mapping yet. Floors are drawn as a stack of
 *           plates with one cell per unit, ordered by floor and unit number.
 *
 * The plate view is not a placeholder for the facade view. It is a schematic
 * and it looks like one — evenly sized cells, no perspective, no invented
 * massing. §17 says do not fake geometry: an apartment drawn in a position
 * that is not where it is in the building is worse than no picture, because
 * a salesperson will point at it in front of a buyer.
 *
 * COLOUR IS NEVER THE ONLY CHANNEL (§16). Every cell carries its unit number,
 * every cell's accessible name states its status in words, and the legend is
 * text. The fill is a second, faster read for people who can use it.
 */

const STATUS_FILL: Record<UnitStatus, string> = {
  AVAILABLE: 'bg-emerald-500/15 border-emerald-600/45 text-emerald-900 dark:text-emerald-100 hover:bg-emerald-500/25',
  ON_HOLD: 'bg-amber-500/15 border-amber-600/45 text-amber-900 dark:text-amber-100 hover:bg-amber-500/25',
  NEGOTIATION: 'bg-sky-500/15 border-sky-600/45 text-sky-900 dark:text-sky-100 hover:bg-sky-500/25',
  RESERVED: 'bg-gold/15 border-gold-border text-foreground hover:bg-gold/25',
  CONTRACT_PENDING: 'bg-violet-500/15 border-violet-600/45 text-violet-900 dark:text-violet-100 hover:bg-violet-500/25',
  SOLD: 'bg-muted border-border text-muted-foreground hover:bg-muted',
  HIDDEN: 'bg-transparent border-dashed border-border text-muted-foreground hover:bg-muted/40',
};

/** The same statuses as a fill for an SVG polygon on a photograph. */
const STATUS_SVG: Record<UnitStatus, { fill: string; stroke: string }> = {
  AVAILABLE: { fill: 'rgba(16,185,129,0.30)', stroke: 'rgba(5,150,105,0.95)' },
  ON_HOLD: { fill: 'rgba(245,158,11,0.32)', stroke: 'rgba(217,119,6,0.95)' },
  NEGOTIATION: { fill: 'rgba(14,165,233,0.30)', stroke: 'rgba(2,132,199,0.95)' },
  RESERVED: { fill: 'rgba(212,160,60,0.34)', stroke: 'rgba(180,130,40,0.95)' },
  CONTRACT_PENDING: { fill: 'rgba(139,92,246,0.30)', stroke: 'rgba(124,58,237,0.95)' },
  SOLD: { fill: 'rgba(120,120,120,0.34)', stroke: 'rgba(90,90,90,0.9)' },
  HIDDEN: { fill: 'rgba(120,120,120,0.12)', stroke: 'rgba(120,120,120,0.6)' },
};

export interface VisualBuildingProps {
  units: DevUnit[];
  buildings: DevBuilding[];
  onSelectUnit: (unit: DevUnit) => void;
  selectedUnitId?: string | null;
}

export function VisualBuilding({
  units, buildings, onSelectUnit, selectedUnitId,
}: VisualBuildingProps) {
  const { t, lang: language } = useLanguage();
  const [buildingId, setBuildingId] = useState<string | null>(buildings[0]?.id ?? null);

  const building = buildings.find((b) => b.id === buildingId) ?? null;

  const scoped = useMemo(
    () => units.filter((u) => (buildingId ? u.building_id === buildingId : !u.building_id)),
    [units, buildingId],
  );

  const mapped = useMemo(
    () => scoped.filter((u) => Array.isArray(u.hotspot) && u.hotspot.length >= 3),
    [scoped],
  );

  const useFacade = Boolean(building?.facade_image_url) && mapped.length > 0;

  /** Floors, highest first — a building is read from the top down. */
  const floors = useMemo(() => {
    const map = new Map<number | null, DevUnit[]>();
    for (const unit of scoped) {
      const key = unit.floor_level ?? null;
      const list = map.get(key) ?? [];
      list.push(unit);
      map.set(key, list);
    }
    return Array.from(map.entries())
      .map(([level, list]) => ({
        level,
        units: [...list].sort((a, b) =>
          a.sort_order - b.sort_order || a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true })),
      }))
      .sort((a, b) => (b.level ?? -Infinity) - (a.level ?? -Infinity));
  }, [scoped]);

  const counts = useMemo(() => {
    const out = new Map<UnitStatus, number>();
    for (const unit of scoped) out.set(unit.status, (out.get(unit.status) ?? 0) + 1);
    return out;
  }, [scoped]);

  if (units.length === 0) {
    return (
      <EmptyState
        icon={<Layers className="h-7 w-7" />}
        title={t('dev_visual_empty_title')}
        description={t('dev_visual_empty_body')}
      />
    );
  }

  return (
    <div className="space-y-4">
      {buildings.length > 1 && (
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {buildings.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBuildingId(b.id)}
              aria-pressed={b.id === buildingId}
              className={cn(
                'whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                b.id === buildingId
                  ? 'border-gold-border bg-gold/10 font-semibold text-gold-ink'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {b.name}
            </button>
          ))}
        </div>
      )}

      {/* Legend. Text first; the swatch is the redundant channel. */}
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs">
        {(Object.keys(STATUS_FILL) as UnitStatus[])
          .filter((status) => (counts.get(status) ?? 0) > 0)
          .map((status) => (
            <li key={status} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn('h-2.5 w-2.5 rounded-sm border', STATUS_FILL[status])}
              />
              <span className="text-muted-foreground">
                {t(UNIT_STATUS_KEYS[status])}
                <span className="tabular"> · {counts.get(status)}</span>
              </span>
            </li>
          ))}
      </ul>

      {useFacade ? (
        <FacadeView
          building={building!}
          units={scoped}
          mapped={mapped}
          onSelectUnit={onSelectUnit}
          selectedUnitId={selectedUnitId}
        />
      ) : (
        <>
          {building?.facade_image_url && mapped.length === 0 && (
            <p className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-2xs text-muted-foreground">
              <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t('dev_visual_unmapped_note')}
            </p>
          )}
          <PlateView
            floors={floors}
            onSelectUnit={onSelectUnit}
            selectedUnitId={selectedUnitId}
            language={language}
          />
        </>
      )}
    </div>
  );
}

function FacadeView({
  building, units, mapped, onSelectUnit, selectedUnitId,
}: {
  building: DevBuilding;
  units: DevUnit[];
  mapped: DevUnit[];
  onSelectUnit: (unit: DevUnit) => void;
  selectedUnitId?: string | null;
}) {
  const { t, lang: language } = useLanguage();
  const [hovered, setHovered] = useState<DevUnit | null>(null);
  const unmapped = units.length - mapped.length;

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg border border-border bg-muted">
        <img
          src={building.facade_image_url!}
          alt={t('dev_visual_facade_alt').replace('{building}', building.name)}
          className="block w-full"
        />
        {/* viewBox 0..100 in both axes: the polygons are stored as
            percentages, so this scales with the image at any size. */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          role="group"
          aria-label={t('dev_visual_facade_alt').replace('{building}', building.name)}
        >
          {mapped.map((unit) => {
            const points = (unit.hotspot ?? []).map((p) => `${p.x},${p.y}`).join(' ');
            const tone = STATUS_SVG[unit.status];
            const selected = unit.id === selectedUnitId;
            return (
              <polygon
                key={unit.id}
                points={points}
                fill={tone.fill}
                stroke={selected ? 'hsl(var(--gold))' : tone.stroke}
                strokeWidth={selected ? 1.1 : 0.45}
                vectorEffect="non-scaling-stroke"
                tabIndex={0}
                role="button"
                aria-label={`${unit.unit_number} — ${t(UNIT_STATUS_KEYS[unit.status])}`}
                className="cursor-pointer outline-none transition-opacity hover:opacity-80 focus-visible:opacity-70"
                onMouseEnter={() => setHovered(unit)}
                onMouseLeave={() => setHovered((h) => (h?.id === unit.id ? null : h))}
                onFocus={() => setHovered(unit)}
                onBlur={() => setHovered((h) => (h?.id === unit.id ? null : h))}
                onClick={() => onSelectUnit(unit)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectUnit(unit);
                  }
                }}
              />
            );
          })}
        </svg>

        {hovered && (
          <div className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-md border border-border bg-background/95 px-3 py-2 text-sm shadow-sm backdrop-blur sm:right-auto sm:max-w-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">{hovered.unit_number}</span>
              <UnitStatusPill status={hovered.status} />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[
                hovered.bedrooms != null ? t('dev_n_bed').replace('{n}', String(hovered.bedrooms)) : null,
                hovered.area_total != null ? formatArea(hovered.area_total, language) : null,
              ].filter(Boolean).join(' · ')}
            </p>
            {hovered.price != null && (
              <p className="mt-0.5 text-sm font-semibold">
                <Money amount={hovered.price} currency={hovered.currency} />
              </p>
            )}
          </div>
        )}
      </div>

      {unmapped > 0 && (
        <p className="text-2xs text-muted-foreground">
          {t('dev_visual_partial_note').replace('{n}', String(unmapped))}
        </p>
      )}
    </div>
  );
}

function PlateView({
  floors, onSelectUnit, selectedUnitId, language,
}: {
  floors: Array<{ level: number | null; units: DevUnit[] }>;
  onSelectUnit: (unit: DevUnit) => void;
  selectedUnitId?: string | null;
  language: string;
}) {
  const { t } = useLanguage();

  return (
    <div className="space-y-1.5">
      {floors.map((floor) => (
        <div
          key={String(floor.level)}
          className="flex items-stretch gap-2 rounded-md border border-border bg-card p-1.5"
        >
          <div className="flex w-12 shrink-0 items-center justify-center rounded-sm bg-muted/70 text-xs font-semibold tabular">
            {floor.level === null ? '—' : floor.level}
          </div>
          <ul className="flex flex-1 flex-wrap gap-1.5">
            {floor.units.map((unit) => (
              <li key={unit.id}>
                <button
                  type="button"
                  onClick={() => onSelectUnit(unit)}
                  aria-label={`${unit.unit_number} — ${t(UNIT_STATUS_KEYS[unit.status])}${
                    unit.area_total ? `, ${formatArea(unit.area_total, language)}` : ''}`}
                  className={cn(
                    'flex h-14 w-[4.5rem] flex-col items-center justify-center rounded-sm border px-1 text-center transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    STATUS_FILL[unit.status],
                    unit.id === selectedUnitId && 'ring-2 ring-gold ring-offset-1 ring-offset-card',
                  )}
                >
                  <span className="w-full truncate text-xs font-semibold tabular">{unit.unit_number}</span>
                  {unit.area_total != null && (
                    <span className="w-full truncate text-2xs opacity-80 tabular">
                      {formatArea(unit.area_total, language)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
