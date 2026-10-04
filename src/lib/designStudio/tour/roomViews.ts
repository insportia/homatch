// THE 360° TOUR OF ONE HOME — four eye-level pictures per room, joined by its doors.
//
// Every room is photographed four times from its centre, at eye level, turned
// a quarter each time: heading 0 looks up the drawing (+y), 1 to its right
// (+x), 2 down it (−y), 3 to its left (−x). Side by side the four make the
// whole room around the visitor. The plan says, for each heading, which doors
// (and to which room) and which windows the picture must show; the same plan
// puts the tour's points on those doors, so a tap walks through the door into
// the room behind it — one home, not a gallery of pictures.
//
// Pure (no DOM, no network): the server writes the pictures' instructions
// from it and the browser places the doors with it — the same numbers both
// sides.

import { pointInPolygon, type Point, type SpaceModel, type SpaceRoom } from '../space.ts';
import type { GeneratedScene } from '../../floorplan/geometry.ts';

export const HEADINGS = [0, 1, 2, 3] as const;
export type Heading = typeof HEADINGS[number];
/** Each picture's horizontal field of view: four of them close the circle. */
export const VIEW_HFOV_DEG = 90;

export const isHeading = (v: unknown): v is Heading => v === 0 || v === 1 || v === 2 || v === 3;

/** Clockwise degrees from heading 0 (up the drawing) of the direction from `from` to `to`, in [0, 360). */
export function bearingDeg(from: Point, to: Point): number {
  const d = (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI;
  return (d + 360) % 360;
}

/** Where a bearing is seen from a heading: degrees in (−180, 180], negative to the left. */
export function relativeDeg(bearing: number, heading: Heading): number {
  let r = bearing - heading * 90;
  while (r > 180) r -= 360;
  while (r <= -180) r += 360;
  return r;
}

/** One door of a room, and the room on its other side. */
export interface RoomLink { doorId: string; toRoomId: string; centre: Point; bearingDeg: number }

/** One window of a room. */
export interface RoomWindow { id: string; centre: Point; bearingDeg: number }

const ACROSS_M = 0.35;

function roomAtPoint(p: Point, rooms: SpaceRoom[]): SpaceRoom | null {
  let best: SpaceRoom | null = null;
  for (const r of rooms) if (pointInPolygon(p, r.polygon) && (!best || r.areaM2 < best.areaM2)) best = r;
  return best;
}

/** The openings of every wall, each with the rooms on its two faces. */
function openings(scene: Pick<GeneratedScene, 'walls'>, rooms: SpaceRoom[]) {
  const out: Array<{ id: string; kind: 'DOOR' | 'WINDOW'; centre: Point; sides: [string | null, string | null] }> = [];
  for (const w of scene.walls ?? []) {
    const dx = w.end.x - w.start.x; const dy = w.end.y - w.start.y;
    const len = Math.hypot(dx, dy) || 1;
    const dir = { x: dx / len, y: dy / len };
    const n = { x: -dir.y, y: dir.x };
    const off = Math.max(ACROSS_M, (w.thicknessM ?? 0.2) / 2 + 0.15);
    for (const o of w.openings ?? []) {
      const centre = { x: w.start.x + dir.x * o.offsetM, y: w.start.y + dir.y * o.offsetM };
      const a = roomAtPoint({ x: centre.x + n.x * off, y: centre.y + n.y * off }, rooms);
      const b = roomAtPoint({ x: centre.x - n.x * off, y: centre.y - n.y * off }, rooms);
      out.push({ id: o.id, kind: o.kind, centre, sides: [a?.id ?? null, b?.id ?? null] });
    }
  }
  return out;
}

/** The doors out of a room (each to the room behind it) and its windows, by bearing from the room's centre. */
export function roomOpenings(space: Pick<SpaceModel, 'rooms'>, scene: Pick<GeneratedScene, 'walls'>, roomId: string): { links: RoomLink[]; windows: RoomWindow[] } {
  const room = space.rooms.find((r) => r.id === roomId);
  if (!room) return { links: [], windows: [] };
  const links: RoomLink[] = [];
  const windows: RoomWindow[] = [];
  const seen = new Set<string>();
  for (const o of openings(scene, space.rooms)) {
    const [a, b] = o.sides;
    if (a !== roomId && b !== roomId) continue;
    const other = a === roomId ? b : a;
    const bearing = Math.round(bearingDeg(room.centroid, o.centre));
    if (o.kind === 'WINDOW') { windows.push({ id: o.id, centre: o.centre, bearingDeg: bearing }); continue; }
    if (!other || other === roomId || seen.has(`${other}:${o.id}`)) continue;
    seen.add(`${other}:${o.id}`);
    links.push({ doorId: o.id, toRoomId: other, centre: o.centre, bearingDeg: bearing });
  }
  return { links, windows };
}

const side = (rel: number) => (rel < -15 ? 'on the left' : rel > 15 ? 'on the right' : 'straight ahead');

/**
 * What the picture facing `heading` must show of the room's openings, in words the image model reads. The names of
 * the rooms come from the plan (`label`), never from a customer's free text.
 */
export function facingWords(input: {
  space: Pick<SpaceModel, 'rooms'>; scene: Pick<GeneratedScene, 'walls'>; roomId: string; heading: Heading; label: (roomId: string) => string;
}): string {
  const { links, windows } = roomOpenings(input.space, input.scene, input.roomId);
  const inView = (b: number) => Math.abs(relativeDeg(b, input.heading)) <= VIEW_HFOV_DEG / 2 + 5;
  const doors = links.filter((l) => inView(l.bearingDeg)).map((l) => `the doorway to the ${input.label(l.toRoomId)} ${side(relativeDeg(l.bearingDeg, input.heading))}`);
  const wins = windows.filter((w) => inView(w.bearingDeg)).map((w) => `a window ${side(relativeDeg(w.bearingDeg, input.heading))}`);
  const seen = [...doors, ...wins];
  return seen.length ? `In this direction the picture shows ${seen.join(', ')}.` : 'In this direction there is no door or window: a wall of the room with its furniture.';
}

/** The four pictures' words for the image model, beyond what it is told of the room itself. */
export function headingFrame(heading: Heading, facing: string, hasFirst: boolean): string {
  const turn = ['facing the first direction', 'turned 90 degrees to the right of the first picture', 'turned 180 degrees, facing the opposite side of the first picture', 'turned 90 degrees to the left of the first picture'][heading];
  return [
    `This is picture ${heading + 1} of 4 taken from the same spot at the centre of the room, at eye level (1.5 m), the camera level and ${turn}.`,
    `Lens: exactly ${VIEW_HFOV_DEG} degrees horizontal field of view, rectilinear (straight verticals, no fisheye, no wide-angle bending), so that the four pictures side by side close the whole room around the viewer.`,
    facing,
    hasFirst && heading !== 0 ? 'One of the images is picture 1 of this same room: the same room, furniture, materials, colours and light — show what is on THIS side of it, never a copy of picture 1.' : '',
  ].filter(Boolean).join(' ');
}
