import React, { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import type {
  FloorPlanDocument, PixelPoint, VerificationState,
} from '@/services/developer/floorplan';
import type { ElementKind } from '@/services/developer/floorplanStore';

/**
 * WHAT THE MACHINE THINKS IT SAW, DRAWN ON TOP OF WHAT IT WAS LOOKING AT.
 *
 * This is the screen that makes the whole pipeline honest. An extraction is a
 * proposal; the only way a person can judge a proposal about a drawing is to
 * see it ON the drawing, in the drawing's own coordinates, category by
 * category. Reading a JSON document and imagining the building is not
 * verification, and a confidence score is not evidence.
 *
 * SO THE OVERLAY IS THE ORIGINAL IMAGE AT ITS OWN SIZE, with an SVG over it in
 * the same pixel space the model reported. Nothing is rescaled, smoothed or
 * cleaned up on the way through: if the model put a wall two metres into the
 * garden, the operator sees a wall two metres into the garden.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL. Every element is also in the list beside
 * the drawing with its confidence and its state in words, and the unverified
 * ones are dashed as well as tinted.
 */

export interface OverlayCategory {
  key: ElementKind;
  labelKey: string;
  /** Stroke colour. Chosen to stay legible over a black-and-white drawing. */
  colour: string;
  visible: boolean;
}

export const DEFAULT_CATEGORIES: OverlayCategory[] = [
  { key: 'wall', labelKey: 'dev_fp_cat_walls', colour: '#1d4ed8', visible: true },
  { key: 'door', labelKey: 'dev_fp_cat_doors', colour: '#b45309', visible: true },
  { key: 'window', labelKey: 'dev_fp_cat_windows', colour: '#0e7490', visible: true },
  { key: 'room', labelKey: 'dev_fp_cat_rooms', colour: '#15803d', visible: true },
  { key: 'balcony', labelKey: 'dev_fp_cat_balconies', colour: '#7c3aed', visible: true },
];

export interface Selection { kind: ElementKind; id: string }

const dash = (state: VerificationState) =>
  (state === 'VERIFIED' || state === 'CORRECTED' ? undefined : '6 4');

const opacity = (state: VerificationState) => (state === 'REJECTED' ? 0.18 : 1);

/** Where an opening sits, in image pixels, along its wall. */
function openingPoints(
  doc: FloorPlanDocument, wallId: string, position: number, widthPx: number,
): [PixelPoint, PixelPoint] | null {
  const wall = doc.walls.find((w) => w.id === wallId);
  if (!wall) return null;
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const ux = dx / length;
  const uy = dy / length;
  const cx = wall.start.x + ux * position * length;
  const cy = wall.start.y + uy * position * length;
  const half = widthPx / 2;
  return [
    { x: cx - ux * half, y: cy - uy * half },
    { x: cx + ux * half, y: cy + uy * half },
  ];
}

export function FloorPlanOverlay({
  doc, imageUrl, categories, selection, onSelect, className,
}: {
  doc: FloorPlanDocument;
  imageUrl: string;
  categories: OverlayCategory[];
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const [imageFailed, setImageFailed] = useState(false);
  const shown = useMemo(
    () => new Map(categories.map((c) => [c.key, c])),
    [categories],
  );

  const isSelected = (kind: ElementKind, id: string) =>
    selection?.kind === kind && selection.id === id;

  const strokeFor = (kind: ElementKind, id: string, base: string) =>
    (isSelected(kind, id) ? '#d97706' : base);
  const widthFor = (kind: ElementKind, id: string, base: number) =>
    (isSelected(kind, id) ? base + 2 : base);

  return (
    <div className={cn('relative overflow-auto rounded-lg border border-border bg-white', className)}>
      <div className="relative inline-block min-w-full">
        {imageFailed ? (
          <div
            style={{ width: doc.imageWidth, height: doc.imageHeight }}
            className="flex items-center justify-center bg-muted text-xs text-muted-foreground"
          >
            {t('dev_fp_image_missing')}
          </div>
        ) : (
          <img
            src={imageUrl}
            alt={t('dev_fp_source_plan')}
            width={doc.imageWidth}
            height={doc.imageHeight}
            onError={() => setImageFailed(true)}
            className="block max-w-none select-none"
            draggable={false}
          />
        )}

        <svg
          viewBox={`0 0 ${doc.imageWidth} ${doc.imageHeight}`}
          width={doc.imageWidth}
          height={doc.imageHeight}
          className="absolute left-0 top-0"
          role="img"
          aria-label={t('dev_fp_overlay_label')}
        >
          {/* Rooms first, under everything: they are areas, not lines. */}
          {shown.get('room')?.visible && doc.rooms.map((room) => (
            <polygon
              key={room.id}
              points={room.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
              fill={shown.get('room')!.colour}
              fillOpacity={isSelected('room', room.id) ? 0.28 : 0.12}
              stroke={strokeFor('room', room.id, shown.get('room')!.colour)}
              strokeWidth={widthFor('room', room.id, 2)}
              strokeDasharray={dash(room.state)}
              opacity={opacity(room.state)}
              className="cursor-pointer"
              onClick={() => onSelect({ kind: 'room', id: room.id })}
            />
          ))}

          {shown.get('balcony')?.visible && doc.balconies.map((balcony) => (
            <polygon
              key={balcony.id}
              points={balcony.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
              fill={shown.get('balcony')!.colour}
              fillOpacity={isSelected('balcony', balcony.id) ? 0.28 : 0.12}
              stroke={strokeFor('balcony', balcony.id, shown.get('balcony')!.colour)}
              strokeWidth={widthFor('balcony', balcony.id, 2)}
              strokeDasharray={dash(balcony.state)}
              opacity={opacity(balcony.state)}
              className="cursor-pointer"
              onClick={() => onSelect({ kind: 'balcony', id: balcony.id })}
            />
          ))}

          {shown.get('wall')?.visible && doc.walls.map((wall) => (
            <line
              key={wall.id}
              x1={wall.start.x} y1={wall.start.y}
              x2={wall.end.x} y2={wall.end.y}
              stroke={strokeFor('wall', wall.id, shown.get('wall')!.colour)}
              strokeWidth={widthFor('wall', wall.id, wall.kind === 'EXTERIOR' ? 5 : 3)}
              strokeLinecap="round"
              strokeDasharray={dash(wall.state)}
              opacity={opacity(wall.state)}
              className="cursor-pointer"
              onClick={() => onSelect({ kind: 'wall', id: wall.id })}
            />
          ))}

          {/* Openings sit ON their wall, which is also how a wrong wallId
              becomes obvious: the door appears somewhere absurd. */}
          {(['door', 'window'] as const).map((kind) => (
            shown.get(kind)?.visible && (kind === 'door' ? doc.doors : doc.windows).map((opening) => {
              const points = openingPoints(doc, opening.wallId, opening.position, opening.widthPx);
              if (!points) return null;
              return (
                <line
                  key={opening.id}
                  x1={points[0].x} y1={points[0].y}
                  x2={points[1].x} y2={points[1].y}
                  stroke={strokeFor(kind, opening.id, shown.get(kind)!.colour)}
                  strokeWidth={widthFor(kind, opening.id, 7)}
                  strokeLinecap="butt"
                  strokeDasharray={dash(opening.state)}
                  opacity={opacity(opening.state)}
                  className="cursor-pointer"
                  onClick={() => onSelect({ kind, id: opening.id })}
                />
              );
            })
          ))}

          {/* Labels last, so they are never covered by an area. */}
          {shown.get('room')?.visible && doc.rooms.map((room) => {
            if (room.polygon.length === 0) return null;
            const cx = room.polygon.reduce((s, p) => s + p.x, 0) / room.polygon.length;
            const cy = room.polygon.reduce((s, p) => s + p.y, 0) / room.polygon.length;
            return (
              <text
                key={`label-${room.id}`}
                x={cx} y={cy}
                textAnchor="middle"
                className="pointer-events-none select-none"
                style={{ fontSize: Math.max(11, doc.imageWidth / 70), fill: '#111', fontWeight: 600 }}
              >
                {room.label || t(`dev_room_${room.kind.toLowerCase()}`)}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
