// THE PLAN AS HOMATCH UNDERSTOOD IT — a clean architectural drawing of the reading.
//
// Drawn in the source image's own pixel space, cropped to the building (the
// title block, logo and border are never part of it), so it can sit exactly
// over the customer's upload ("Overlay") or stand alone ("Clean"). Walls are
// solid, doors are gaps with their swing, windows are glazed gaps, stairs show
// their treads and direction, every room carries its name and its size.
// Elements HOMATCH is unsure of are outlined in amber; tapping anything
// selects it, which is how a non-architect corrects the reading.

import React, { useMemo } from 'react';
import type {
  FloorPlanDocument, Opening, PixelPoint, RoomKind, RoomPolygon, StairFlight, WallSegment,
} from '@/services/developer/floorplan';
import { cn } from '@/lib/utils';

export type PlanSelection = { kind: 'room' | 'wall' | 'door' | 'window' | 'stairs'; id: string };

/** How a room is shaded: calm, kind-coded, never louder than the walls. */
export const ROOM_FILL: Record<RoomKind, string> = {
  LIVING: '#F3E9DA', BEDROOM: '#E6ECF5', KITCHEN: '#F4EBD3', BATHROOM: '#DCEEF0', WC: '#DCEEF0', HALL: '#EEEDEA',
  CORRIDOR: '#EEEDEA', STORAGE: '#ECE8E2', BALCONY: '#E3EEDD', TERRACE: '#E3EEDD', UNKNOWN: '#EFEFEF',
};

const UNSURE = 0.75;
const SEL = 'hsl(38 92% 50%)';

const mid = (a: PixelPoint, b: PixelPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function centroid(poly: PixelPoint[]): PixelPoint {
  // Area-weighted: a label sits inside an L-shaped room, not in its notch.
  let a = 0; let cx = 0; let cy = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i]; const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-6) return poly.reduce((s, p) => ({ x: s.x + p.x / poly.length, y: s.y + p.y / poly.length }), { x: 0, y: 0 });
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** The opening's centre and direction on its wall, in pixels. */
export function openingFrame(o: Opening, wall: WallSegment) {
  const dx = wall.end.x - wall.start.x; const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy) || 1;
  const u = { x: dx / len, y: dy / len };
  const n = { x: -u.y, y: u.x };
  const t = Math.max(0, Math.min(1, o.position));
  const c = { x: wall.start.x + dx * t, y: wall.start.y + dy * t };
  const half = Math.min(o.widthPx, len) / 2;
  return { c, u, n, half, a: { x: c.x - u.x * half, y: c.y - u.y * half }, b: { x: c.x + u.x * half, y: c.y + u.y * half } };
}

function bboxOf(points: PixelPoint[]) {
  const xs = points.map((p) => p.x); const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** The building's own extent on the sheet: footprint, else everything architectural. */
export function buildingBox(doc: FloorPlanDocument, pad = 24) {
  const pts: PixelPoint[] = doc.footprint?.length
    ? doc.footprint
    : [
      ...doc.walls.flatMap((w) => [w.start, w.end]),
      ...doc.rooms.flatMap((r) => r.polygon), ...doc.balconies.flatMap((b) => b.polygon),
      ...(doc.stairs ?? []).flatMap((s) => s.polygon),
    ];
  if (!pts.length) return { x: 0, y: 0, w: doc.imageWidth, h: doc.imageHeight };
  const b = bboxOf(pts);
  const x = Math.max(0, b.minX - pad); const y = Math.max(0, b.minY - pad);
  return { x, y, w: Math.min(doc.imageWidth, b.maxX + pad) - x, h: Math.min(doc.imageHeight, b.maxY + pad) - y };
}

function Stairs({ s, selected, onSelect }: { s: StairFlight; selected: boolean; onSelect?: () => void }) {
  // Treads: lines parallel to the start edge, across the flight.
  const lines = useMemo(() => {
    if (s.polygon.length < 3) return [];
    const [a, b] = s.startEdge ?? [s.polygon[0], s.polygon[1]];
    const ex = b.x - a.x; const ey = b.y - a.y; const el = Math.hypot(ex, ey) || 1;
    const u = { x: ex / el, y: ey / el };
    let n = { x: -u.y, y: u.x };
    const c = centroid(s.polygon);
    if ((c.x - a.x) * n.x + (c.y - a.y) * n.y < 0) n = { x: -n.x, y: -n.y };
    const run = Math.max(...s.polygon.map((p) => (p.x - a.x) * n.x + (p.y - a.y) * n.y));
    const count = Math.max(3, Math.min(25, s.treads ?? Math.round(run / Math.max(8, el / 4))));
    const out: Array<[PixelPoint, PixelPoint]> = [];
    for (let i = 1; i < count; i += 1) {
      const k = (run * i) / count;
      out.push([{ x: a.x + n.x * k, y: a.y + n.y * k }, { x: b.x + n.x * k, y: b.y + n.y * k }]);
    }
    const from = mid(a, b);
    return { out, arrow: [{ x: from.x + n.x * run * 0.12, y: from.y + n.y * run * 0.12 }, { x: from.x + n.x * run * 0.85, y: from.y + n.y * run * 0.85 }], n };
  }, [s]);
  if (!lines || Array.isArray(lines)) return null;
  const pts = s.polygon.map((p) => `${p.x},${p.y}`).join(' ');
  const [p0, p1] = lines.arrow;
  const head = 6;
  const back = { x: p1.x - lines.n.x * head, y: p1.y - lines.n.y * head };
  const side = { x: -lines.n.y * head * 0.6, y: lines.n.x * head * 0.6 };
  return (
    <g onClick={onSelect} className={onSelect ? 'cursor-pointer' : undefined} data-plan="stairs">
      <polygon points={pts} fill="#F7F7F5" stroke={selected ? SEL : '#4A5263'} strokeWidth={selected ? 3 : 1.2} strokeDasharray={s.confidence < UNSURE ? '4 3' : undefined} />
      {lines.out.map(([a, b], i) => <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#8A92A0" strokeWidth={1} />)}
      {s.direction !== 'UNKNOWN' ? (
        <g stroke="#0C1119" strokeWidth={1.4} fill="none">
          <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} />
          <polyline points={`${back.x + side.x},${back.y + side.y} ${p1.x},${p1.y} ${back.x - side.x},${back.y - side.y}`} />
        </g>
      ) : null}
    </g>
  );
}

export function PlanDrawing({
  doc, imageUrl, mode, selection, onSelect, roomLabel, rejected, className, metresPerPx,
}: {
  doc: FloorPlanDocument;
  imageUrl?: string | null;
  /** CLEAN: HOMATCH's drawing only. OVERLAY: over the upload. ORIGINAL: the upload only. */
  mode: 'CLEAN' | 'OVERLAY' | 'ORIGINAL';
  selection?: PlanSelection | null;
  onSelect?: (s: PlanSelection) => void;
  /** The room's display name and size line (already localised). */
  roomLabel?: (room: RoomPolygon, metresPerPx: number | null) => { name: string; size: string | null };
  rejected?: ReadonlySet<string>;
  className?: string;
  metresPerPx?: number | null;
}) {
  const box = useMemo(() => buildingBox(doc), [doc]);
  const gone = rejected ?? new Set<string>();
  const walls = doc.walls.filter((w) => !gone.has(w.id));
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const rooms = [...doc.rooms, ...doc.balconies].filter((r) => !gone.has(r.id));
  const openings = [
    ...doc.doors.filter((o) => !gone.has(o.id)).map((o) => ({ o, kind: 'door' as const })),
    ...doc.windows.filter((o) => !gone.has(o.id)).map((o) => ({ o, kind: 'window' as const })),
  ];
  const isSel = (kind: PlanSelection['kind'], id: string) => selection?.kind === kind && selection.id === id;
  const pick = (s: PlanSelection) => (onSelect ? () => onSelect(s) : undefined);
  const font = Math.max(9, Math.min(16, box.w / 34));
  const showDrawing = mode !== 'ORIGINAL';
  const wallOpacity = mode === 'OVERLAY' ? 0.85 : 1;

  return (
    <svg
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      className={cn('block h-auto w-full select-none', className)}
      role="img"
      aria-hidden={onSelect ? undefined : true}
      style={{ touchAction: 'manipulation' }}
    >
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={mode === 'CLEAN' ? '#FFFFFF' : '#F4F5F7'} />
      {mode !== 'CLEAN' && imageUrl ? (
        <image href={imageUrl} x={0} y={0} width={doc.imageWidth} height={doc.imageHeight} opacity={mode === 'OVERLAY' ? 0.55 : 1} preserveAspectRatio="none" />
      ) : null}
      {showDrawing ? (
        <>
          {rooms.map((r) => {
            const pts = r.polygon.map((p) => `${p.x},${p.y}`).join(' ');
            const sel = isSel('room', r.id);
            return (
              <polygon
                key={r.id} points={pts} data-plan="room" data-id={r.id}
                fill={ROOM_FILL[r.kind] ?? ROOM_FILL.UNKNOWN} fillOpacity={mode === 'OVERLAY' ? 0.45 : 1}
                stroke={sel ? SEL : r.confidence < UNSURE ? 'hsl(38 92% 50%)' : 'transparent'}
                strokeWidth={sel ? 3 : 1.5} strokeDasharray={!sel && r.confidence < UNSURE ? '5 4' : undefined}
                onClick={pick({ kind: 'room', id: r.id })} className={onSelect ? 'cursor-pointer' : undefined}
              />
            );
          })}
          {(doc.stairs ?? []).filter((s) => !gone.has(s.id)).map((s) => (
            <Stairs key={s.id} s={s} selected={isSel('stairs', s.id)} onSelect={pick({ kind: 'stairs', id: s.id })} />
          ))}
          {walls.map((w) => {
            const sel = isSel('wall', w.id);
            const t = Math.max(3, Math.min(14, w.thicknessPx ?? (w.kind === 'EXTERIOR' ? 8 : 5)));
            return (
              <g key={w.id} onClick={pick({ kind: 'wall', id: w.id })} className={onSelect ? 'cursor-pointer' : undefined} data-plan="wall" data-id={w.id}>
                {/* A wider invisible stroke: a thin wall is still easy to tap on a phone. */}
                {onSelect ? <line x1={w.start.x} y1={w.start.y} x2={w.end.x} y2={w.end.y} stroke="transparent" strokeWidth={Math.max(16, t + 10)} /> : null}
                <line
                  x1={w.start.x} y1={w.start.y} x2={w.end.x} y2={w.end.y} strokeLinecap="square"
                  stroke={sel ? SEL : w.confidence < UNSURE ? '#7A5A1E' : '#1B2230'} strokeWidth={t} opacity={wallOpacity}
                />
              </g>
            );
          })}
          {openings.map(({ o, kind }) => {
            const wall = wallById.get(o.wallId);
            if (!wall) return null;
            const f = openingFrame(o, wall);
            const t = Math.max(3, Math.min(14, wall.thicknessPx ?? (wall.kind === 'EXTERIOR' ? 8 : 5)));
            const sel = isSel(kind, o.id);
            const unsure = o.confidence < UNSURE;
            const accent = sel ? SEL : unsure ? 'hsl(38 92% 45%)' : '#1B2230';
            const leaf = o.leaf ?? (kind === 'door' ? 'HINGED' : 'FIXED');
            // The swing: a quarter circle from the hinge, on the room side it opens into (left of the wall by default).
            const r = f.half * 2;
            const hinge = f.a;
            const open = { x: hinge.x + f.n.x * r, y: hinge.y + f.n.y * r };
            return (
              <g key={o.id} onClick={pick({ kind, id: o.id })} className={onSelect ? 'cursor-pointer' : undefined} data-plan={kind} data-id={o.id}>
                {/* The gap in the wall. */}
                <line x1={f.a.x} y1={f.a.y} x2={f.b.x} y2={f.b.y} stroke={mode === 'CLEAN' ? '#FFFFFF' : '#F4F5F7'} strokeWidth={t + 1.5} />
                {onSelect ? <line x1={f.a.x} y1={f.a.y} x2={f.b.x} y2={f.b.y} stroke="transparent" strokeWidth={Math.max(18, t + 12)} /> : null}
                {kind === 'window' ? (
                  <g stroke={accent} strokeWidth={sel ? 2.4 : 1.2}>
                    <line x1={f.a.x + f.n.x * t / 2} y1={f.a.y + f.n.y * t / 2} x2={f.b.x + f.n.x * t / 2} y2={f.b.y + f.n.y * t / 2} />
                    <line x1={f.a.x} y1={f.a.y} x2={f.b.x} y2={f.b.y} stroke="#6FA8C9" />
                    <line x1={f.a.x - f.n.x * t / 2} y1={f.a.y - f.n.y * t / 2} x2={f.b.x - f.n.x * t / 2} y2={f.b.y - f.n.y * t / 2} />
                  </g>
                ) : leaf === 'NONE' ? (
                  <g stroke={accent} strokeWidth={sel ? 2.4 : 1.2} strokeDasharray="3 3">
                    <line x1={f.a.x} y1={f.a.y} x2={f.b.x} y2={f.b.y} />
                  </g>
                ) : leaf === 'SLIDING' ? (
                  <g stroke={accent} strokeWidth={sel ? 2.4 : 1.4}>
                    <line x1={f.a.x + f.n.x * 2} y1={f.a.y + f.n.y * 2} x2={f.c.x + f.n.x * 2 + f.u.x * f.half * 0.2} y2={f.c.y + f.n.y * 2 + f.u.y * f.half * 0.2} />
                    <line x1={f.b.x - f.n.x * 2} y1={f.b.y - f.n.y * 2} x2={f.c.x - f.n.x * 2 - f.u.x * f.half * 0.2} y2={f.c.y - f.n.y * 2 - f.u.y * f.half * 0.2} />
                  </g>
                ) : (
                  <g stroke={accent} strokeWidth={sel ? 2.4 : 1.2} fill="none">
                    <line x1={hinge.x} y1={hinge.y} x2={open.x} y2={open.y} />
                    <path d={`M ${open.x} ${open.y} A ${r} ${r} 0 0 ${f.n.x * f.u.y - f.n.y * f.u.x > 0 ? 0 : 1} ${f.b.x} ${f.b.y}`} strokeDasharray="2 2" />
                  </g>
                )}
                {unsure && !sel ? <circle cx={f.c.x} cy={f.c.y} r={Math.max(5, t)} fill="none" stroke="hsl(38 92% 50%)" strokeWidth={1.5} /> : null}
              </g>
            );
          })}
          {roomLabel ? rooms.map((r) => {
            const c = centroid(r.polygon);
            const label = roomLabel(r, metresPerPx ?? null);
            const b = bboxOf(r.polygon);
            const fit = Math.min(font, (b.maxX - b.minX) / Math.max(4, label.name.length * 0.62));
            if (fit < 6) return null;
            return (
              <g key={`l-${r.id}`} pointerEvents="none" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif">
                <text x={c.x} y={c.y - (label.size ? fit * 0.2 : -fit * 0.35)} fontSize={fit} fontWeight={600} fill="#0C1119" paintOrder="stroke" stroke="#FFFFFF" strokeWidth={mode === 'CLEAN' ? 0 : 3}>{label.name}</text>
                {label.size ? <text x={c.x} y={c.y + fit * 1.05} fontSize={fit * 0.82} fill="#4A5263" paintOrder="stroke" stroke="#FFFFFF" strokeWidth={mode === 'CLEAN' ? 0 : 3}>{label.size}</text> : null}
              </g>
            );
          }) : null}
        </>
      ) : null}
    </svg>
  );
}
