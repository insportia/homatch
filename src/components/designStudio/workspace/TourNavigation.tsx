// HOMATCH DESIGN STUDIO — FINDING ONE'S WAY THROUGH THE WHOLE HOME, FROM INSIDE IT.
//
// Two quiet aids over the walkthrough (WalkthroughOverlay), both fed by the
// plan's own tour (lib/designStudio/tour.ts):
//
//   DoorMarkers  at every real doorway of the room the visitor stands in, the
//                name of the room behind it, anchored to the doorway in the
//                3D view (projected each frame, never painted into the scene).
//                Only rooms a body can actually reach get one. A tap or click
//                walks the visitor through that doorway (SceneController.routeTo).
//   PlanSheet    the whole home from above, secondary: where you are, which
//                way you face, and any reachable room one tap away.
//
// Positions are written straight to the DOM in an animation frame; React
// renders only when the room or the doorways change.

import React, { useEffect, useMemo, useRef } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SceneController } from '@/components/designStudio/canvas/SceneController';
import { clearSight } from '@/lib/designStudio/cameraDirector';
import type { WalkModel } from '@/lib/designStudio/navigation';
import type { SpaceModel } from '@/lib/designStudio/space';
import type { DoorPoint, TourPlan } from '@/lib/designStudio/tour';
import type { Translate } from './WalkthroughOverlay';

const ring = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]';
/** The marker's height in the doorway (metres): about eye level, under the head of the door. */
const MARKER_HEIGHT_M = 1.35;
/** A marker this close to the captured mouse's centre takes its click (pixels). */
const CENTRE_PICK_PX = 56;

export interface MarkerHandle {
  /** The doorway whose marker is at a screen point, if one is shown there. */
  at: (x: number, y: number, radius?: number) => DoorPoint | null;
}

export function DoorMarkers({ c, walk, doors, names, tr, onGo, hidden, handle }: {
  c: SceneController | null;
  walk: WalkModel | null;
  doors: DoorPoint[];
  names: Map<string, string>;
  tr: Translate;
  onGo: (d: DoorPoint) => void;
  hidden: boolean;
  handle: React.MutableRefObject<MarkerHandle | null>;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const shown = useRef(new Map<string, { x: number; y: number }>());

  useEffect(() => {
    handle.current = {
      at: (x, y, radius = CENTRE_PICK_PX) => {
        let best: DoorPoint | null = null; let bestD = radius;
        for (const d of doors) {
          const el = refs.current.get(key(d));
          const p = shown.current.get(key(d));
          if (!el || !p) continue;
          const r = el.getBoundingClientRect();
          const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
          const dist = inside ? 0 : Math.hypot(x - p.x, y - p.y);
          if (dist < bestD) { best = d; bestD = dist; }
        }
        return best;
      },
    };
    return () => { handle.current = null; };
  }, [doors, handle]);

  useEffect(() => {
    if (!c) return undefined;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const box = boxRef.current?.getBoundingClientRect();
      const me = c.playerState();
      for (const d of doors) {
        const el = refs.current.get(key(d));
        if (!el) continue;
        let visible = !hidden && !c.routing && !!box && !!me;
        let s: { x: number; y: number } | null = null;
        if (visible) {
          s = c.screenOf(d.at, MARKER_HEIGHT_M);
          // A doorway behind a wall of this room (an L-shaped room) is not offered: only what can be seen.
          const toward = me ? { x: d.at.x + Math.sign(me.pos.x - d.at.x) * Math.min(0.3, Math.abs(me.pos.x - d.at.x)), y: d.at.y + Math.sign(me.pos.y - d.at.y) * Math.min(0.3, Math.abs(me.pos.y - d.at.y)) } : d.at;
          // Wholly on screen, or not at all (a name cut by the edge reads as a mistake).
          const hw = el.offsetWidth / 2 + 8; const hh = el.offsetHeight / 2 + 8;
          visible = !!s && !!box && s.x - hw > box.left && s.x + hw < box.right && s.y - hh > box.top && s.y + hh < box.bottom
            && (!walk || !me || clearSight(walk, me.pos, toward));
        }
        if (visible && s && box) {
          el.style.transform = `translate(${Math.round(s.x - box.left)}px, ${Math.round(s.y - box.top)}px) translate(-50%, -50%)`;
          el.style.visibility = 'visible';
          shown.current.set(key(d), s);
        } else {
          el.style.visibility = 'hidden';
          shown.current.delete(key(d));
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [c, walk, doors, hidden]);

  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0 z-[15] overflow-hidden" data-testid="walk-doors">
      {doors.map((d) => {
        const name = names.get(d.toRoom) ?? '';
        return (
          <button
            key={key(d)}
            ref={(el) => { if (el) refs.current.set(key(d), el); else refs.current.delete(key(d)); }}
            type="button"
            onClick={() => onGo(d)}
            style={{ visibility: 'hidden', transform: 'translate(-9999px, -9999px)' }}
            aria-label={tr('ds_walk_go_to', { room: name })}
            data-testid="walk-door" data-room={d.toRoom} data-door={d.doorId}
            className={cn('pointer-events-auto absolute left-0 top-0 inline-flex h-10 max-w-[11rem] items-center gap-1.5 rounded-full bg-[#0C1119]/80 pe-3.5 ps-3 text-[14px] font-semibold text-white shadow-lg ring-1 ring-white/30 backdrop-blur hover:bg-[#0C1119]/95', ring)}
          >
            <ArrowUpRight className="h-4 w-4 shrink-0 text-[hsl(38_92%_62%)] rtl:-scale-x-100" aria-hidden="true" />
            <span className="truncate">{name}</span>
          </button>
        );
      })}
    </div>
  );
}

const key = (d: DoorPoint) => `${d.doorId}>${d.toRoom}`;

export function PlanSheet({ c, space, plan, names, room, tr, onRoom, onClose }: {
  c: SceneController | null;
  space: SpaceModel;
  plan: TourPlan;
  names: Map<string, string>;
  room: string | null;
  tr: Translate;
  onRoom: (id: string) => void;
  onClose: () => void;
}) {
  const view = useMemo(() => {
    const xs = space.rooms.flatMap((r) => r.polygon.map((p) => p.x));
    const ys = space.rooms.flatMap((r) => r.polygon.map((p) => p.y));
    const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
    return { minX, maxY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }, [space]);
  // The drawing: plan y runs up, the picture's y runs down.
  const sx = (x: number) => x - view.minX;
  const sy = (y: number) => view.maxY - y;
  const meRef = useRef<SVGGElement | null>(null);
  useEffect(() => {
    if (!c) return undefined;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const me = c.playerState();
      const g = meRef.current;
      if (!g || !me) return;
      g.setAttribute('transform', `translate(${sx(me.pos.x)} ${sy(me.pos.y)}) rotate(${(-me.yaw * 180) / Math.PI})`);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, view]);

  return (
    <div role="dialog" aria-modal="false" aria-label={tr('ds_walk_plan_title')} data-testid="walk-plan"
      className="pointer-events-auto absolute inset-x-3 bottom-3 z-30 rounded-2xl bg-[#0C1119]/95 p-3 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur sm:inset-x-auto sm:end-3 sm:w-[22rem]">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold">{tr('ds_walk_plan_title')}</h2>
        <button type="button" onClick={onClose} aria-label={tr('ds_set_done')} className={cn('grid h-9 w-9 place-items-center rounded-full hover:bg-white/10', ring)}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <svg style={{ direction: 'ltr' }} viewBox={`-0.4 -0.4 ${view.w + 0.8} ${view.h + 0.8}`} className="mt-2 max-h-[38dvh] w-full" role="group" aria-label={tr('ds_walk_rooms')}>
        {space.rooms.map((r) => {
          const ok = plan.reachable.has(r.id);
          const here = r.id === room;
          const pts = r.polygon.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ');
          const label = names.get(r.id) ?? '';
          return (
            <g key={r.id}>
              <polygon points={pts} strokeWidth={0.06}
                fill={here ? 'hsla(38, 92%, 56%, 0.35)' : ok ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.03)'}
                stroke={here ? 'hsl(38, 92%, 62%)' : ok ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)'} />
              {ok ? (
                <a href="#" role="button" aria-label={tr('ds_walk_go_to', { room: label })} aria-current={here ? 'location' : undefined} data-testid="walk-plan-room" data-room={r.id}
                  onClick={(e) => { e.preventDefault(); onRoom(r.id); }}>
                  <polygon points={pts} fill="transparent" className="cursor-pointer" />
                  <text x={sx(r.centroid.x)} y={sy(r.centroid.y)} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(0.42, Math.max(0.26, Math.sqrt(r.areaM2) / 9))}
                    fill={here ? '#fff' : 'rgba(255,255,255,0.85)'} className="pointer-events-none select-none font-semibold">{label}</text>
                </a>
              ) : null}
            </g>
          );
        })}
        <g ref={meRef} aria-label={tr('ds_walk_you_are_here')}>
          <path d="M 0 0 L 0.9 -0.35 L 0.9 0.35 Z" fill="hsla(38, 92%, 62%, 0.4)" />
          <circle r={0.2} fill="hsl(38, 92%, 62%)" stroke="#0C1119" strokeWidth={0.06} />
        </g>
      </svg>
    </div>
  );
}
