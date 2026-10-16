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

export const PLAN_ARCHITECT_VERSION = 'ds-plan-architect-2';

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

type Cell = { key: string; area: number; cx: number; cy: number; short: number; /** its centre within the home as read, 0–1 */ nx: number; ny: number; /** its outline as read */ read: Box; /** the area its use allows */ min: number; max: number };
type Laid = { rects: Map<string, Box>; score: number };

/** The rooms laid into a rectangle by recursive splits that keep their order along each axis; the best-shaped split wins. */
function lay(cells: Cell[], box: Box, home: Box = box): Laid {
  if (cells.length === 1) {
    const w = box.x1 - box.x0; const d = box.y1 - box.y0;
    const short = Math.min(w, d); const aspect = Math.max(w, d) / Math.max(short, 0.01);
    // Shaped like a room (not a corridor of a bedroom), wide enough for its use, and where it was in the home.
    const nx = ((box.x0 + box.x1) / 2 - home.x0) / Math.max(home.x1 - home.x0, 0.01);
    const ny = ((box.y0 + box.y1) / 2 - home.y0) / Math.max(home.y1 - home.y0, 0.01);
    const score = Math.max(0, aspect - 2) ** 2 + (short < cells[0].short - 0.01 ? 200 * (cells[0].short - short) ** 2 + 60 : 0)
      + 12 * ((nx - cells[0].nx) ** 2 + (ny - cells[0].ny) ** 2);
    return { rects: new Map([[cells[0].key, box]]), score };
  }
  const total = cells.reduce((s, c) => s + c.area, 0);
  let best: Laid | null = null;
  for (const axis of ['x', 'y'] as const) {
    const sorted = [...cells].sort((a, b) => (axis === 'x' ? a.cx - b.cx : a.cy - b.cy));
    for (let k = 1; k < sorted.length; k += 1) {
      const left = sorted.slice(0, k); const right = sorted.slice(k);
      // A split the reading itself has (a wall with these rooms on one side, those on the other) keeps the home's
      // arrangement; one that cuts across rooms as read rearranges the home (a hall moved beside the bathroom).
      const crossed = axis === 'x'
        ? Math.max(...left.map((c) => c.read.x1)) - Math.min(...right.map((c) => c.read.x0))
        : Math.max(...left.map((c) => c.read.y1)) - Math.min(...right.map((c) => c.read.y0));
      const across = crossed > 0.3 ? 25 + 10 * crossed : 0;
      // Where the wall goes: by the rooms' areas, or — when that leaves a side too shallow for its rooms (a band of
      // bedroom 2 m deep) — as far over as that side needs, as long as every room keeps an area its use allows.
      const span = axis === 'x' ? box.x1 - box.x0 : box.y1 - box.y0;
      const byArea = left.reduce((s, c) => s + c.area, 0) / total;
      // How deep a side must be along the split: the rooms it stacks along that axis (as read), each its narrowest.
      const need = (side: Cell[]) => Math.max(...side.map((c) => side.filter((o) => (axis === 'x'
        ? Math.min(o.read.y1, c.read.y1) - Math.max(o.read.y0, c.read.y0)
        : Math.min(o.read.x1, c.read.x1) - Math.max(o.read.x0, c.read.x0)) > 0.3).reduce((s, o) => s + o.short, 0))) / span;
      const needL = need(left); const needR = need(right);
      for (const f of new Set([byArea, Math.max(byArea, needL), Math.min(byArea, 1 - needR)])) {
        if (f <= 0.08 || f >= 0.92) continue;
        const [b1, b2]: [Box, Box] = axis === 'x'
          ? [{ ...box, x1: box.x0 + span * f }, { ...box, x0: box.x0 + span * f }]
          : [{ ...box, y1: box.y0 + span * f }, { ...box, y0: box.y0 + span * f }];
        const a = lay(left, b1, home); const b = lay(right, b2, home);
        const rects = new Map([...a.rects, ...b.rects]);
        if (f !== byArea && cells.some((c) => { const r = rects.get(c.key)!; const ar = (r.x1 - r.x0) * (r.y1 - r.y0); return ar < c.min - 0.05 || ar > c.max + 0.05; })) continue;
        const score = a.score + b.score + across;
        if (!best || score < best.score - 1e-9) best = { rects, score };
      }
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
      key: r.key, area: Math.min(range.max, Math.max(range.min, read)), cx, cy, short: range.short, read: b, min: range.min, max: range.max,
      nx: (cx - home.x0) / Math.max(home.x1 - home.x0, 0.01), ny: (cy - home.y0) / Math.max(home.y1 - home.y0, 0.01),
    };
  });
  const total = cells.reduce((s, c) => s + c.area, 0);
  // The footprint keeps the shape the home was read in (within reason), and its corner where the home was.
  const aspect = Math.min(1.8, Math.max(0.55, (home.x1 - home.x0) / Math.max(home.y1 - home.y0, 0.01)));
  // A footprint a little wider or deeper than read, or rooms a little larger (each within what its use allows), when
  // that is what lets every room be deep enough for its use (three bands of rooms each need their depth): the
  // best-scoring of a few, the read shape and sizes preferred.
  let frame: Box = { x0: 0, y0: 0, x1: 0, y1: 0 }; let laid: Laid | null = null;
  for (const k of [1, 1.06, 1.12, 1.19, 1.27]) {
    const grown = cells.map((c) => ({ ...c, area: Math.min(c.max, c.area * k) }));
    const sum = grown.reduce((s, c) => s + c.area, 0);
    for (const a of [aspect, aspect * 0.92, aspect / 0.92, aspect * 0.85, aspect / 0.85, aspect * 0.72, aspect / 0.72]) {
      const W = Math.sqrt(sum * a); const D = sum / W;
      const f: Box = { x0: home.x0, y0: home.y0, x1: home.x0 + W, y1: home.y0 + D };
      const l = lay(grown, f);
      const score = l.score + 6 * Math.log(a / aspect) ** 2 + 30 * (k - 1) ** 2;
      if (!laid || score < laid.score - 1e-9) { laid = { rects: l.rects, score }; frame = f; }
    }
  }
  const rects = new Map(laid!.rects);
  const W = frame.x1 - frame.x0; const D = frame.y1 - frame.y0;
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
  // An opening keeps the rooms it joins: a door between two rooms goes onto their new shared wall, where along it the
  // door was read (never all to the middles, which turns a room into a crossing); a door or window to the outside
  // stays on its room's outside wall, where along it it was. One no longer between its rooms is left out (the build
  // gives every room it cannot reach a door: inferredSpace.ts).
  const near = (b: Box, p: readonly [number, number]) => Math.hypot(Math.max(b.x0 - p[0], 0, p[0] - b.x1), Math.max(b.y0 - p[1], 0, p[1] - b.y1));
  /** Where two boxes share a wall (at least a metre of it): the point on it nearest `p`, `half` clear of its ends. */
  const shared = (a: Box, b: Box, p: readonly [number, number], half: number): [number, number] | null => {
    const e = 0.02;
    const along = (lo: number, hi: number, v: number) => { const m = Math.min(half + 0.15, (hi - lo) / 2); return Math.min(hi - m, Math.max(lo + m, v)); };
    if (Math.abs(a.x1 - b.x0) < e || Math.abs(b.x1 - a.x0) < e) {
      const x = Math.abs(a.x1 - b.x0) < e ? a.x1 : a.x0; const y0 = Math.max(a.y0, b.y0); const y1 = Math.min(a.y1, b.y1);
      return y1 - y0 >= 1 ? [x, along(y0, y1, p[1])] : null;
    }
    if (Math.abs(a.y1 - b.y0) < e || Math.abs(b.y1 - a.y0) < e) {
      const y = Math.abs(a.y1 - b.y0) < e ? a.y1 : a.y0; const x0 = Math.max(a.x0, b.x0); const x1 = Math.min(a.x1, b.x1);
      return x1 - x0 >= 1 ? [along(x0, x1, p[0]), y] : null;
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
  // The rooms a door's own name gives ("door-hall-living", "door-office-bathroom"): what the reader saw it join,
  // which survives a resized plan better than where it was drawn.
  const words = (s: string | null | undefined) => (s ?? '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && w !== 'room' && w !== 'door');
  const namedIn = (key: string) => {
    const said = new Set(words(key));
    const named = placed.filter((r) => { const own = words(r.key); return own.length > 0 && own.every((w) => said.has(w)); });
    return { named: named.length <= 2 ? named : [], entrance: ['entrance', 'entry', 'front'].some((w) => said.has(w)) };
  };
  const purposeOf = (r: ReconRoom) => roomUse(r, types.get(r.key) ?? new Set());
  const isWet = (r: ReconRoom) => purposeOf(r) === 'BATH' || purposeOf(r) === 'WC';
  const linked = new Set<string>();
  let entrances = 0;
  /** The door between `a` and `b` on their shared wall nearest the read point, unless the pair already has one or a
   *  bathroom would get a second door. */
  const join = (a: ReconRoom, b: ReconRoom, p: readonly [number, number], o: (typeof read.openings)[number]) => {
    const pair = [a.key, b.key].sort().join('|');
    if (linked.has(pair)) return null;
    const wetHere = [a, b].find(isWet);
    if (wetHere && [...linked].some((l) => l.split('|').includes(wetHere.key))) return null;
    const at = shared(rects.get(a.key)!, rects.get(b.key)!, place(boxes.get(a.key)!, rects.get(a.key)!, p), (o.widthM ?? 0.9) / 2);
    if (!at) return null;
    linked.add(pair);
    return { ...o, at: [r2(at[0]), r2(at[1])] as [number, number], px: null };
  };
  const openings = read.openings.flatMap((o) => {
    const p = o.at as [number, number];
    const by = placed.map((r) => ({ r, d: near(boxes.get(r.key)!, p) })).filter((x) => x.d <= 1.2).sort((m, n) => m.d - n.d);
    const { named, entrance } = o.kind === 'WINDOW' ? { named: [], entrance: false } : namedIn(o.key);
    if (!by.length && !named.length) return [];
    // Two rooms named that still share a wall: the door is theirs.
    if (named.length === 2) { const door = join(named[0], named[1], p, o); if (door) return [door]; }
    // The home's entrance, named so: on the outside wall of the room it opens (named, else nearest hall or living).
    if (entrance && o.kind === 'DOOR' && !entrances) {
      const room = named.find((r) => !r.outdoor) ?? by.map((x) => x.r).find((r) => ['HALL', 'LIVING', 'KITCHEN_LIVING'].includes(purposeOf(r)));
      const door = room ? outside(room, p, o) : [];
      if (door.length) { entrances += 1; return door; }
    }
    if (!by.length) return [];
    // The room the door belongs to: a named one (a bathroom first: it is the room a door is read for), else the
    // nearest; joined to the nearest room it still touches — a bathroom to the hall when it touches one.
    const first = named.find(isWet) ?? named[0] ?? by[0].r;
    if (o.kind === 'WINDOW') return first.outdoor ? [] : outside(first, p, o);
    const wet = isWet(first);
    const pool = [...by.filter((x) => x.r.key !== first.key), ...placed.filter((r) => r.key !== first.key && !by.some((x) => x.r.key === r.key)).map((r) => ({ r, d: near(boxes.get(r.key)!, p) }))];
    const others = pool.map((x) => ({ ...x, rank: x.d
      - (wet && purposeOf(x.r) === 'HALL' ? 100 : 0)
      - (named.some((r) => r.key === x.r.key) ? 80 : 0)
      - (/hall/.test(o.key) && purposeOf(x.r) === 'HALL' ? 50 : 0) }))
      .filter((x) => x.d <= 1.2 || x.rank < 0).sort((m, n) => m.rank - n.rank);
    for (const other of others) {
      if (o.kind === 'BALCONY_DOOR' && !first.outdoor && !other.r.outdoor) continue;
      const door = join(first, other.r, p, o);
      if (door) return [door];
    }
    const use = purposeOf(first);
    if (o.kind !== 'DOOR' || entrances || !(use === 'HALL' || use === 'LIVING' || use === 'KITCHEN_LIVING') || (by[0]?.d ?? Infinity) > 0.45) return [];
    const door = outside(first, p, o);
    entrances += door.length;
    return door;
  });
  return { recon: { ...read, rooms, objects, openings, fidelity: read.fidelity ? { ...read.fidelity } : read.fidelity } as Reconstruction, report };
}
