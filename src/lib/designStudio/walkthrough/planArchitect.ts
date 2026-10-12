// THE ARCHITECT — ONE DETERMINISTIC PLAN FOR EVERY HOME, WHATEVER IT WAS READ FROM.
//
// A reading (or the AI's draft of it) keeps what the pictures show best — which rooms there are, what each one is,
// where each lies relative to the others, which pieces stand in which room — and is unreliable in what pictures show
// worst: sizes and exact walls (a bathroom read as 17 m², a hall as 19 m², a study 1.5 m deep, outlines slanted by
// perspective). The architect keeps the first and redraws the second: every indoor room sized within what a room of
// its kind is (sizeRange), the rooms tiling one rectangular footprint (a recursive split that keeps their arrangement:
// rooms west of others stay west, north stay north), each room a rectangle no narrower than its use needs; a balcony
// along the side it was read on. Pieces keep their room and their place in it (their position relative to the room);
// openings keep their place relative to the home. The result is a plan the build squares, walks and furnishes as read.
//
// Pure (Deno + Node). Used when the reading and the draft are no plausible home (planDraft.ts draftProblems), and
// before laying a home out again from its pieces (photoSpace.ts) — so every walkthrough stands on a plausible plan.

import type { Reconstruction, ReconRoom } from '../reconstructRead.ts';

export const PLAN_ARCHITECT_VERSION = 'ds-plan-architect-1';

type Box = { x0: number; y0: number; x1: number; y1: number };
const bbox = (poly: Array<[number, number]> | Array<readonly [number, number]>): Box => {
  const xs = poly.map((p) => p[0]); const ys = poly.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** What a room is for, from its kind, its label and what stands in it. */
export function roomUse(room: Pick<ReconRoom, 'kind' | 'label'>, types: Set<string>): 'BATH' | 'WC' | 'HALL' | 'KITCHEN_LIVING' | 'LIVING' | 'KITCHEN' | 'BEDROOM' | 'STUDY' | 'STORAGE' | 'OTHER' {
  const label = (room.label ?? '').toLowerCase();
  const has = (...xs: string[]) => xs.some((x) => types.has(x));
  if (room.kind === 'WC') return 'WC';
  if (room.kind === 'BATHROOM' || (has('TOILET', 'SHOWER', 'BATH') && !has('BED_DOUBLE', 'BED_SINGLE', 'SOFA'))) return 'BATH';
  if (has('BED_DOUBLE', 'BED_SINGLE') || room.kind === 'BEDROOM') return 'BEDROOM';
  const kitchen = room.kind === 'KITCHEN' || /kitchen/.test(label) || has('KITCHEN_RUN', 'KITCHEN_ISLAND', 'FRIDGE');
  const living = room.kind === 'LIVING' || has('SOFA') || /living|lounge/.test(label);
  if (kitchen && living) return 'KITCHEN_LIVING';
  if (living) return 'LIVING';
  if (kitchen) return 'KITCHEN';
  if (has('DESK', 'OFFICE_CHAIR') || /office|study|work/.test(label)) return 'STUDY';
  if (room.kind === 'HALL' || room.kind === 'CORRIDOR' || /hall|corridor|entr/.test(label)) return 'HALL';
  if (room.kind === 'STORAGE' || /storage|closet|pantry|laundry/.test(label)) return 'STORAGE';
  return 'OTHER';
}

/** The area (m²) a room of each use has in an ordinary home, and the narrowest it can be and still be used. */
export const SIZE_RANGE: Record<ReturnType<typeof roomUse>, { min: number; max: number; short: number }> = {
  BATH: { min: 3.5, max: 7, short: 1.6 }, WC: { min: 1.4, max: 3, short: 0.9 }, HALL: { min: 3, max: 9, short: 1.2 },
  KITCHEN_LIVING: { min: 22, max: 40, short: 3.4 }, LIVING: { min: 15, max: 32, short: 3.2 }, KITCHEN: { min: 6, max: 14, short: 2.0 },
  BEDROOM: { min: 9, max: 18, short: 2.7 }, STUDY: { min: 6, max: 12, short: 2.2 }, STORAGE: { min: 1.5, max: 5, short: 1.0 }, OTHER: { min: 5, max: 16, short: 2.0 },
};

type Cell = { key: string; area: number; cx: number; cy: number; short: number; /** its centre within the home as read, 0–1 */ nx: number; ny: number };
type Laid = { rects: Map<string, Box>; score: number };

/** The rooms laid into a rectangle by recursive splits that keep their order along each axis; the best-shaped split wins. */
function lay(cells: Cell[], box: Box, home: Box = box): Laid {
  if (cells.length === 1) {
    const w = box.x1 - box.x0; const d = box.y1 - box.y0;
    const short = Math.min(w, d); const aspect = Math.max(w, d) / Math.max(short, 0.01);
    // Shaped like a room (not a corridor of a bedroom), wide enough for its use, and where it was in the home.
    const nx = ((box.x0 + box.x1) / 2 - home.x0) / Math.max(home.x1 - home.x0, 0.01);
    const ny = ((box.y0 + box.y1) / 2 - home.y0) / Math.max(home.y1 - home.y0, 0.01);
    const score = Math.max(0, aspect - 2) ** 2 + (short < cells[0].short ? 40 * (cells[0].short - short) ** 2 + 10 : 0)
      + 12 * ((nx - cells[0].nx) ** 2 + (ny - cells[0].ny) ** 2);
    return { rects: new Map([[cells[0].key, box]]), score };
  }
  const total = cells.reduce((s, c) => s + c.area, 0);
  let best: Laid | null = null;
  for (const axis of ['x', 'y'] as const) {
    const sorted = [...cells].sort((a, b) => (axis === 'x' ? a.cx - b.cx : a.cy - b.cy));
    for (let k = 1; k < sorted.length; k += 1) {
      const left = sorted.slice(0, k); const right = sorted.slice(k);
      const f = left.reduce((s, c) => s + c.area, 0) / total;
      const [b1, b2]: [Box, Box] = axis === 'x'
        ? [{ ...box, x1: box.x0 + (box.x1 - box.x0) * f }, { ...box, x0: box.x0 + (box.x1 - box.x0) * f }]
        : [{ ...box, y1: box.y0 + (box.y1 - box.y0) * f }, { ...box, y0: box.y0 + (box.y1 - box.y0) * f }];
      const a = lay(left, b1, home); const b = lay(right, b2, home);
      const score = a.score + b.score;
      if (!best || score < best.score - 1e-9) best = { rects: new Map([...a.rects, ...b.rects]), score };
    }
  }
  return best!;
}

/**
 * The reading redrawn by the architect, or null when there is nothing to draw (fewer than one indoor room). The
 * report says, room by room, how its area changed.
 */
export function architectPlan(read: Reconstruction): { recon: Reconstruction; report: Array<{ key: string; use: string; readM2: number; areaM2: number }> } | null {
  const indoor = read.rooms.filter((r) => !r.outdoor && r.polygon.length >= 3);
  if (!indoor.length) return null;
  const types = new Map<string, Set<string>>();
  for (const o of read.objects) if (o.room) { if (!types.has(o.room)) types.set(o.room, new Set()); types.get(o.room)!.add(o.type); }
  const boxes = new Map(read.rooms.map((r) => [r.key, bbox(r.polygon as Array<[number, number]>)]));
  const home = indoor.reduce((b, r) => { const x = boxes.get(r.key)!; return { x0: Math.min(b.x0, x.x0), y0: Math.min(b.y0, x.y0), x1: Math.max(b.x1, x.x1), y1: Math.max(b.y1, x.y1) }; },
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const cells: Cell[] = indoor.map((r) => {
    const b = boxes.get(r.key)!;
    const use = roomUse(r, types.get(r.key) ?? new Set());
    const range = SIZE_RANGE[use];
    const read = (b.x1 - b.x0) * (b.y1 - b.y0);
    const cx = (b.x0 + b.x1) / 2; const cy = (b.y0 + b.y1) / 2;
    return {
      key: r.key, area: Math.min(range.max, Math.max(range.min, read)), cx, cy, short: range.short,
      nx: (cx - home.x0) / Math.max(home.x1 - home.x0, 0.01), ny: (cy - home.y0) / Math.max(home.y1 - home.y0, 0.01),
    };
  });
  const total = cells.reduce((s, c) => s + c.area, 0);
  // The footprint keeps the shape the home was read in (within reason), and its corner where the home was.
  const aspect = Math.min(1.8, Math.max(0.55, (home.x1 - home.x0) / Math.max(home.y1 - home.y0, 0.01)));
  const W = Math.sqrt(total * aspect); const D = total / W;
  const frame: Box = { x0: home.x0, y0: home.y0, x1: home.x0 + W, y1: home.y0 + D };
  const laid = lay(cells, frame);
  const rects = new Map(laid.rects);
  const report = cells.map((c) => {
    const b = boxes.get(c.key)!; const n = rects.get(c.key)!;
    return { key: c.key, use: roomUse(indoor.find((r) => r.key === c.key)!, types.get(c.key) ?? new Set()), readM2: r2((b.x1 - b.x0) * (b.y1 - b.y0)), areaM2: r2((n.x1 - n.x0) * (n.y1 - n.y0)) };
  });
  // Outdoor rooms: along the side of the home they were read on, as deep as read (1.2–2.4 m).
  for (const r of read.rooms.filter((x) => x.outdoor && x.polygon.length >= 3)) {
    const b = boxes.get(r.key)!;
    const cx = (b.x0 + b.x1) / 2; const cy = (b.y0 + b.y1) / 2;
    const dist = { W: cx - home.x0, E: home.x1 - cx, N: cy - home.y0, S: home.y1 - cy };
    const side = (Object.entries(dist) as Array<[keyof typeof dist, number]>).sort((p, q) => p[1] - q[1])[0][0];
    const along = side === 'W' || side === 'E';
    const depth = Math.min(2.4, Math.max(1.2, along ? b.x1 - b.x0 : b.y1 - b.y0));
    const span = along ? D : W;
    const len = Math.min(span, Math.max(2, along ? b.y1 - b.y0 : b.x1 - b.x0));
    const rel = along ? (cy - home.y0) / Math.max(home.y1 - home.y0, 0.01) : (cx - home.x0) / Math.max(home.x1 - home.x0, 0.01);
    const start = Math.min(span - len, Math.max(0, rel * span - len / 2));
    rects.set(r.key, side === 'W' ? { x0: frame.x0 - depth, x1: frame.x0, y0: frame.y0 + start, y1: frame.y0 + start + len }
      : side === 'E' ? { x0: frame.x1, x1: frame.x1 + depth, y0: frame.y0 + start, y1: frame.y0 + start + len }
        : side === 'N' ? { y0: frame.y0 - depth, y1: frame.y0, x0: frame.x0 + start, x1: frame.x0 + start + len }
          : { y0: frame.y1, y1: frame.y1 + depth, x0: frame.x0 + start, x1: frame.x0 + start + len });
  }
  const poly = (b: Box): Array<[number, number]> => [[r2(b.x0), r2(b.y0)], [r2(b.x1), r2(b.y0)], [r2(b.x1), r2(b.y1)], [r2(b.x0), r2(b.y1)]];
  const rooms = read.rooms.filter((r) => rects.has(r.key)).map((r) => ({ ...r, polygon: poly(rects.get(r.key)!), px: null }));
  // A piece keeps its room and its place in it; a piece of no room keeps its place in the home.
  const place = (from: Box, to: Box, p: readonly [number, number], margin = 0): [number, number] => {
    const u = (p[0] - from.x0) / Math.max(from.x1 - from.x0, 0.01); const v = (p[1] - from.y0) / Math.max(from.y1 - from.y0, 0.01);
    const x = to.x0 + Math.min(1, Math.max(0, u)) * (to.x1 - to.x0); const y = to.y0 + Math.min(1, Math.max(0, v)) * (to.y1 - to.y0);
    const mx = Math.min(margin, (to.x1 - to.x0) / 2); const my = Math.min(margin, (to.y1 - to.y0) / 2);
    return [r2(Math.min(to.x1 - mx, Math.max(to.x0 + mx, x))), r2(Math.min(to.y1 - my, Math.max(to.y0 + my, y)))];
  };
  const homeTo: Box = frame;
  const objects = read.objects.map((o) => {
    const from = o.room ? boxes.get(o.room) : null; const to = o.room ? rects.get(o.room) : null;
    const at = from && to ? place(from, to, o.at as [number, number], Math.min(o.widthM, o.depthM) / 2) : place(home, homeTo, o.at as [number, number]);
    return { ...o, at };
  });
  // An opening keeps the rooms it joins: a door between two rooms goes to the middle of their new shared wall; a door
  // or window to the outside stays on its room's outside wall, where along it it was. One no longer between its rooms
  // is left out (the build gives every room it cannot reach a door: inferredSpace.ts).
  const near = (b: Box, p: readonly [number, number]) => Math.hypot(Math.max(b.x0 - p[0], 0, p[0] - b.x1), Math.max(b.y0 - p[1], 0, p[1] - b.y1));
  const shared = (a: Box, b: Box): [number, number] | null => {
    const e = 0.02;
    if (Math.abs(a.x1 - b.x0) < e || Math.abs(b.x1 - a.x0) < e) {
      const x = Math.abs(a.x1 - b.x0) < e ? a.x1 : a.x0; const y0 = Math.max(a.y0, b.y0); const y1 = Math.min(a.y1, b.y1);
      return y1 - y0 >= 1 ? [x, (y0 + y1) / 2] : null;
    }
    if (Math.abs(a.y1 - b.y0) < e || Math.abs(b.y1 - a.y0) < e) {
      const y = Math.abs(a.y1 - b.y0) < e ? a.y1 : a.y0; const x0 = Math.max(a.x0, b.x0); const x1 = Math.min(a.x1, b.x1);
      return x1 - x0 >= 1 ? [(x0 + x1) / 2, y] : null;
    }
    return null;
  };
  const placed = read.rooms.filter((r) => rects.has(r.key));
  const outside = (room: ReconRoom, p: readonly [number, number], o: (typeof read.openings)[number]) => {
    const b = rects.get(room.key)!;
    const [x, y] = place(boxes.get(room.key)!, b, p);
    const outer = room.outdoor ? b : frame;
    const sides: Array<[number, [number, number]]> = [
      [Math.abs(b.x0 - outer.x0) < 0.02 ? Math.abs(x - b.x0) : Infinity, [b.x0, y]], [Math.abs(b.x1 - outer.x1) < 0.02 ? Math.abs(b.x1 - x) : Infinity, [b.x1, y]],
      [Math.abs(b.y0 - outer.y0) < 0.02 ? Math.abs(y - b.y0) : Infinity, [x, b.y0]], [Math.abs(b.y1 - outer.y1) < 0.02 ? Math.abs(b.y1 - y) : Infinity, [x, b.y1]],
    ];
    const best = sides.sort((m, n) => m[0] - n[0])[0];
    return Number.isFinite(best[0]) ? [{ ...o, at: [r2(best[1][0]), r2(best[1][1])] as [number, number], px: null }] : [];
  };
  const linked = new Set<string>();
  let entrances = 0;
  const openings = read.openings.flatMap((o) => {
    const p = o.at as [number, number];
    const by = placed.map((r) => ({ r, d: near(boxes.get(r.key)!, p) })).filter((x) => x.d <= 1.2).sort((m, n) => m.d - n.d);
    if (!by.length) return [];
    const first = by[0].r;
    if (o.kind === 'WINDOW') return first.outdoor ? [] : outside(first, p, o);
    // A door joins its room to the nearest room it still touches; a door of a hall or a living room with none is the
    // home's entrance; any other is left out (the build gives an unreached room a door).
    // A bathroom opens onto the hall when it touches one; two rooms get one door between them.
    const useOf = (r: ReconRoom) => roomUse(r, types.get(r.key) ?? new Set());
    const wet = useOf(first) === 'BATH' || useOf(first) === 'WC';
    const halls = wet ? placed.filter((r) => r.key !== first.key && useOf(r) === 'HALL' && !by.some((x) => x.r.key === r.key)).map((r) => ({ r, d: near(boxes.get(r.key)!, p) })) : [];
    const others = [...by.slice(1), ...halls].map((x, i) => ({ ...x, rank: i - (wet && useOf(x.r) === 'HALL' ? 100 : 0) - (/hall/.test(o.key) && useOf(x.r) === 'HALL' ? 50 : 0) })).sort((m, n) => m.rank - n.rank);
    for (const other of others) {
      if (o.kind === 'BALCONY_DOOR' && !first.outdoor && !other.r.outdoor) continue;
      const pair = [first.key, other.r.key].sort().join('|');
      if (linked.has(pair)) continue;
      // A bathroom has one door.
      const wetHere = [first, other.r].find((r) => useOf(r) === 'BATH' || useOf(r) === 'WC');
      if (wetHere && [...linked].some((l) => l.split('|').includes(wetHere.key))) continue;
      const at = shared(rects.get(first.key)!, rects.get(other.r.key)!);
      if (at) { linked.add(pair); return [{ ...o, at: [r2(at[0]), r2(at[1])] as [number, number], px: null }]; }
    }
    const use = roomUse(first, types.get(first.key) ?? new Set());
    if (o.kind !== 'DOOR' || entrances || !(use === 'HALL' || use === 'LIVING' || use === 'KITCHEN_LIVING') || by[0].d > 0.45) return [];
    const door = outside(first, p, o);
    entrances += door.length;
    return door;
  });
  return { recon: { ...read, rooms, objects, openings, fidelity: read.fidelity ? { ...read.fidelity } : read.fidelity } as Reconstruction, report };
}
