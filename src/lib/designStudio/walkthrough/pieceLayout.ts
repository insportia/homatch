// WHEN THE ROOMS AND THE PIECES OF A READING DISAGREE, THE PIECES DECIDE WHERE THE ROOMS ARE.
//
// A reading of photos (reconstructRead.ts) holds two kinds of evidence. The pieces — beds, toilets, the kitchen,
// the sofa — are where the measured picture shows them. The room outlines are often the reader's guess: a tidy grid
// of rectangles in a frame that is not the pieces' frame, or a slanted outline traced across a cut-away render. When
// the two disagree (a bedroom's bed outside the bedroom, rooms that are diamonds, rooms no door joins), the geometry
// check (geometryCheck.ts) rightly refuses the space, and the walkthrough could never be built for that home.
//
// This file lays the same rooms out again from the evidence that was measured:
//
//   region     the home's measured outline (its bounding rectangle), else the extent of the pieces
//   indoor     the region is cut, wall by straight wall, into one rectangle per indoor room, each holding that
//              room's own pieces (a guillotine partition: every cut runs between two groups of rooms, where it puts
//              the fewest pieces on the wrong side, as near as it can to the split the rooms' read areas ask for);
//              a room the reader saw without a piece stands where the reader put it
//   outdoor    each balcony or terrace is a strip outside the home, on the side the reader put it
//   openings   doors read in the old outlines join the wrong rooms now: they are dropped, and the walk infers one
//              between neighbours (inferredSpace.ts completeForWalk); windows move onto the exterior wall nearest them
//   pieces     never move; a piece read in a balcony that stands inside the home belongs to the room it stands in
//
// Every room keeps its key, kind and label; nothing is invented and nothing is dropped. The result is recorded as
// a repair and stays ESTIMATED. Pure and deterministic (Deno + Node).

import type { ReconObject, ReconOpening, ReconRoom, Reconstruction } from '../reconstructRead.ts';

type P = [number, number];
interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface LayoutRepair {
  code: 'LAYOUT_FROM_PIECES' | 'PIECE_REASSIGNED' | 'OPENING_DROPPED' | 'WINDOW_MOVED' | 'OUTDOOR_ATTACHED';
  element: string;
  detail: string;
}

/** Pieces that hang on a wall or in a window: where they are says little about which room they belong to. */
const WALL_BORNE = new Set(['CURTAIN', 'BLIND', 'ARTWORK', 'TV']);
/** The pieces that make a room what it is. */
const ANCHORS = new Set(['BED_DOUBLE', 'BED_SINGLE', 'TOILET', 'SHOWER', 'BATH', 'VANITY', 'KITCHEN_RUN', 'KITCHEN_ISLAND', 'FRIDGE', 'SOFA', 'DINING_TABLE', 'WARDROBE']);
/** The narrowest a room is cut (m): a bathroom, a hall. */
const MIN_SIDE_M = 1.5;
/** A cut keeps this far off the pieces it separates (m), when it can. */
const CUT_MARGIN_M = 0.35;
/** Longer than this many times its width, a room reads as a corridor. */
const MAX_ASPECT = 2.2;
/** How many of the most promising cuts are followed to the end: at the first two levels, then the next two. */
const BEAM: [number, number] = [5, 2];
const OUTDOOR_DEPTH = { min: 1.2, max: 2.2 };

const r2 = (n: number) => Math.round(n * 100) / 100;
const area = (poly: P[]) => Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const centroid = (pts: P[]): P => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
const rectPoly = (r: Rect): P[] => [[r2(r.x0), r2(r.y0)], [r2(r.x1), r2(r.y0)], [r2(r.x1), r2(r.y1)], [r2(r.x0), r2(r.y1)]];
const inRect = (p: P, r: Rect, pad = 0) => p[0] >= r.x0 - pad && p[0] <= r.x1 + pad && p[1] >= r.y0 - pad && p[1] <= r.y1 + pad;
function boundsOf(pts: P[]): Rect {
  return { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) };
}

interface Seeded { key: string; seeds: P[]; weight: number; /** Seeds that define the room (a bed, a toilet): never on the wrong side of a wall. */ anchors: P[] }

/** How wrong one room's rectangle is: its pieces outside it, its defining pieces near or past its walls, its shape, its size. */
function roomScore(r: Seeded, rect: Rect, areaPerWeight: number): number {
  const outside = r.seeds.filter((p) => !inRect(p, rect)).length / r.seeds.length;
  const anchorsOut = r.anchors.filter((p) => !inRect(p, { x0: rect.x0 + 0.2, y0: rect.y0 + 0.2, x1: rect.x1 - 0.2, y1: rect.y1 - 0.2 })).length;
  const w = rect.x1 - rect.x0; const h = rect.y1 - rect.y0;
  const ratio = Math.max(w, h) / Math.max(0.1, Math.min(w, h));
  const size = Math.abs(Math.log((w * h) / Math.max(1, r.weight * areaPerWeight)));
  return outside * 10 + anchorsOut * 4 + Math.max(0, ratio - MAX_ASPECT) * 1.5 + size * 1.5 + Math.max(0, MIN_SIDE_M - Math.min(w, h)) * 10;
}

interface Cut { axis: 0 | 1; cut: number; a: Seeded[]; b: Seeded[]; quick: number }

/** The ways one rectangle can be cut between two groups of rooms, the most promising first. */
function cutsOf(rect: Rect, rooms: Seeded[]): Cut[] {
  const cuts: Cut[] = [];
  for (const axis of [0, 1] as const) {
    const lo = axis === 0 ? rect.x0 : rect.y0; const hi = axis === 0 ? rect.x1 : rect.y1; const span = hi - lo;
    const order = [...rooms].sort((p, q) => centroid(p.seeds)[axis] - centroid(q.seeds)[axis] || p.key.localeCompare(q.key));
    for (let k = 1; k < order.length; k += 1) {
      const a = order.slice(0, k); const b = order.slice(k);
      const wa = a.reduce((s, r) => s + r.weight, 0); const wb = b.reduce((s, r) => s + r.weight, 0);
      const ideal = lo + span * (wa / (wa + wb));
      const aMax = Math.max(...a.flatMap((r) => r.seeds.map((p) => p[axis])));
      const bMin = Math.min(...b.flatMap((r) => r.seeds.map((p) => p[axis])));
      // Where the cut may go: between the two groups when they are apart, else between two of their pieces.
      const between = [...a, ...b].flatMap((r) => r.seeds.map((p) => p[axis])).sort((x, y) => x - y).flatMap((v, i, all) => (i ? [(v + all[i - 1]) / 2] : []));
      const options = aMax + CUT_MARGIN_M <= bMin - CUT_MARGIN_M
        ? [Math.max(aMax + CUT_MARGIN_M, Math.min(bMin - CUT_MARGIN_M, ideal))]
        : aMax < bMin ? [(aMax + bMin) / 2] : [ideal, ...between];
      for (const raw of options) {
        const cut = Math.max(lo + MIN_SIDE_M, Math.min(hi - MIN_SIDE_M, raw));
        if (!(cut > lo && cut < hi)) continue;
        const wrong = a.reduce((s, r) => s + r.seeds.filter((p) => p[axis] > cut).length / r.seeds.length + r.anchors.filter((p) => p[axis] > cut).length * 0.4, 0)
          + b.reduce((s, r) => s + r.seeds.filter((p) => p[axis] < cut).length / r.seeds.length + r.anchors.filter((p) => p[axis] < cut).length * 0.4, 0);
        cuts.push({ axis, cut, a, b, quick: wrong * 10 + (Math.abs(cut - ideal) / span) * 3 });
      }
    }
  }
  return cuts.sort((x, y) => x.quick - y.quick || x.axis - y.axis || x.cut - y.cut);
}

/**
 * The guillotine partition: each room gets one rectangle of `rect`, together tiling it. The few most promising cuts
 * at each of the first levels are all followed to the end, and the layout whose rooms are least wrong (roomScore,
 * summed) is kept — a greedy first cut would not see that it forces a bathroom into a corridor three cuts later.
 */
function partition(rect: Rect, rooms: Seeded[], areaPerWeight: number, depth = 0): { rects: Map<string, Rect>; score: number } {
  if (rooms.length === 1) return { rects: new Map([[rooms[0].key, rect]]), score: roomScore(rooms[0], rect, areaPerWeight) };
  const cuts = cutsOf(rect, rooms);
  const seen = new Set<string>();
  const tried = cuts.filter((c) => { const k = `${c.axis}:${c.a.map((r) => r.key).join(',')}:${c.cut.toFixed(1)}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, depth < 2 ? BEAM[0] : depth < 4 ? BEAM[1] : 1);
  let best: { rects: Map<string, Rect>; score: number } | null = null;
  for (const c of tried) {
    const [ra, rb]: [Rect, Rect] = c.axis === 0 ? [{ ...rect, x1: c.cut }, { ...rect, x0: c.cut }] : [{ ...rect, y1: c.cut }, { ...rect, y0: c.cut }];
    const pa = partition(ra, c.a, areaPerWeight, depth + 1); const pb = partition(rb, c.b, areaPerWeight, depth + 1);
    const score = pa.score + pb.score;
    if (!best || score < best.score - 1e-9) best = { rects: new Map([...pa.rects, ...pb.rects]), score };
  }
  return best ?? { rects: new Map(rooms.map((r) => [r.key, rect])), score: Infinity };
}

/**
 * The reading with its rooms laid out again from its pieces (see the header), or null when there is nothing to lay
 * out (no indoor room). The caller decides whether to use it: only when the read outlines fail the geometry check.
 */
export function layoutFromPieces(recon: Reconstruction): { recon: Reconstruction; repairs: LayoutRepair[] } | null {
  const repairs: LayoutRepair[] = [];
  const indoor = recon.rooms.filter((r) => !r.outdoor && r.polygon.length >= 3);
  if (!indoor.length) return null;
  const outdoor = recon.rooms.filter((r) => r.outdoor && r.polygon.length >= 3);
  const placed = (o: ReconObject) => Array.isArray(o.at) && Number.isFinite(o.at[0]) && Number.isFinite(o.at[1]);

  // Each indoor room's seeds: its own standing pieces, else where the reader put it.
  const seeded: Seeded[] = indoor.map((r) => {
    const pieces = recon.objects.filter((o) => o.room === r.key && placed(o) && !WALL_BORNE.has(o.type));
    const own = pieces.map((o) => o.at);
    const anchors = pieces.filter((o) => ANCHORS.has(o.type)).map((o) => o.at);
    return { key: r.key, seeds: own.length ? own : [centroid(r.polygon)], anchors, weight: Math.max(2, area(r.polygon)) };
  });
  const allSeeds = seeded.flatMap((s) => s.seeds);

  // The region: the measured outline when the pieces stand in it, else the pieces' own extent.
  const outline = (recon.fidelity?.outline ?? []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) as P[];
  const seedBox = boundsOf(allSeeds);
  const pad = 0.8;
  let region: Rect = { x0: seedBox.x0 - pad, y0: seedBox.y0 - pad, x1: seedBox.x1 + pad, y1: seedBox.y1 + pad };
  if (outline.length >= 4) {
    const box = boundsOf(outline);
    const inside = allSeeds.filter((p) => inRect(p, box, 0.5)).length / allSeeds.length;
    if (inside >= 0.8) region = { x0: Math.min(box.x0, region.x0 + pad), y0: Math.min(box.y0, region.y0 + pad), x1: Math.max(box.x1, region.x1 - pad), y1: Math.max(box.y1, region.y1 - pad) };
  }
  // At least the floor the reader gave the indoor rooms (a home is not smaller than its rooms' read areas allow).
  const readArea = indoor.reduce((s, r) => s + area(r.polygon), 0);
  const w = region.x1 - region.x0; const h = region.y1 - region.y0;
  if (w * h < 0.6 * readArea) {
    const k = Math.sqrt((0.6 * readArea) / (w * h));
    const cx = (region.x0 + region.x1) / 2; const cy = (region.y0 + region.y1) / 2;
    region = { x0: cx - (w * k) / 2, x1: cx + (w * k) / 2, y0: cy - (h * k) / 2, y1: cy + (h * k) / 2 };
  }
  // Seeds the reader put outside it are brought to its edge.
  for (const s of seeded) s.seeds = s.seeds.map((p) => [Math.max(region.x0 + 0.3, Math.min(region.x1 - 0.3, p[0])), Math.max(region.y0 + 0.3, Math.min(region.y1 - 0.3, p[1]))] as P);

  const totalWeight = seeded.reduce((s, r) => s + r.weight, 0);
  const { rects } = partition(region, seeded, ((region.x1 - region.x0) * (region.y1 - region.y0)) / totalWeight);
  const rooms: ReconRoom[] = recon.rooms.map((r) => {
    const rect = rects.get(r.key);
    return rect ? { ...r, polygon: rectPoly(rect), px: null, geometry: 'ESTIMATE' as const } : r;
  });
  repairs.push({ code: 'LAYOUT_FROM_PIECES', element: 'rooms', detail: `${indoor.length} rooms laid out on ${r2(region.x1 - region.x0)} × ${r2(region.y1 - region.y0)} m from their pieces` });

  // Balconies and terraces: strips outside the home, on the side the reader put each.
  const used: Array<{ side: number; a: number; b: number }> = [];
  for (const r of outdoor) {
    const c = centroid(r.polygon); const b = boundsOf(r.polygon);
    const depth = Math.max(OUTDOOR_DEPTH.min, Math.min(OUTDOOR_DEPTH.max, Math.min(b.x1 - b.x0, b.y1 - b.y0)));
    const want = Math.max(2, Math.max(b.x1 - b.x0, b.y1 - b.y0));
    // 0 north (y0), 1 east (x1), 2 south (y1), 3 west (x0): the side nearest its read centre.
    const dist = [c[1] - region.y0, region.x1 - c[0], region.y1 - c[1], c[0] - region.x0].map(Math.abs);
    const sides = [0, 1, 2, 3].sort((p, q) => dist[p] - dist[q]);
    let done = false;
    for (const side of sides) {
      const along = side % 2 === 0 ? [region.x0, region.x1] : [region.y0, region.y1];
      const len = Math.min(want, along[1] - along[0]);
      const centre = side % 2 === 0 ? c[0] : c[1];
      let a = Math.max(along[0], Math.min(along[1] - len, centre - len / 2));
      // Clear of a strip already on this side: beside it, else the next side.
      const clash = () => used.find((u) => u.side === side && u.b > a + 1e-6 && u.a < a + len - 1e-6);
      for (let tries = 0; clash() && tries < 2; tries += 1) {
        const u = clash()!;
        a = centre < (u.a + u.b) / 2 ? u.a - len : u.b;
        if (a < along[0] - 1e-6 || a + len > along[1] + 1e-6) break;
      }
      if (clash() || a < along[0] - 1e-6 || a + len > along[1] + 1e-6) continue;
      const rect: Rect = side === 0 ? { x0: a, x1: a + len, y0: region.y0 - depth, y1: region.y0 }
        : side === 1 ? { x0: region.x1, x1: region.x1 + depth, y0: a, y1: a + len }
          : side === 2 ? { x0: a, x1: a + len, y0: region.y1, y1: region.y1 + depth }
            : { x0: region.x0 - depth, x1: region.x0, y0: a, y1: a + len };
      used.push({ side, a, b: a + len });
      const i = rooms.findIndex((x) => x.key === r.key);
      rooms[i] = { ...rooms[i], polygon: rectPoly(rect), px: null, geometry: 'ESTIMATE' };
      repairs.push({ code: 'OUTDOOR_ATTACHED', element: r.key, detail: `${r2(len)} × ${r2(depth)} m on the ${['north', 'east', 'south', 'west'][side]} side` });
      done = true; break;
    }
    if (!done) repairs.push({ code: 'OUTDOOR_ATTACHED', element: r.key, detail: 'kept as read (no free side)' });
  }

  // Pieces never move; one read in a balcony that stands inside the home is in the room it stands in.
  const indoorRects = [...rects.entries()];
  const outdoorKeys = new Set(outdoor.map((r) => r.key));
  const objects = recon.objects.map((o) => {
    if (!placed(o) || !o.room || !outdoorKeys.has(o.room)) return o;
    const host = indoorRects.find(([, rc]) => inRect(o.at, rc));
    if (!host) return o;
    repairs.push({ code: 'PIECE_REASSIGNED', element: o.key, detail: `${o.room} → ${host[0]} (it stands inside the home)` });
    return { ...o, room: host[0] };
  });

  // Openings: doors are re-inferred between the new neighbours; windows go onto the nearest exterior wall.
  const openings: ReconOpening[] = [];
  for (const o of recon.openings) {
    if (o.kind !== 'WINDOW') { repairs.push({ code: 'OPENING_DROPPED', element: o.key, detail: 'its rooms were laid out again; the walk infers the doors' }); continue; }
    const p = o.at;
    const onEdge: Array<{ at: P; d: number; len: number }> = [];
    const edges: Array<[P, P]> = [
      [[region.x0, region.y0], [region.x1, region.y0]], [[region.x1, region.y0], [region.x1, region.y1]],
      [[region.x0, region.y1], [region.x1, region.y1]], [[region.x0, region.y0], [region.x0, region.y1]],
    ];
    for (const [a, b] of edges) {
      const horizontal = a[1] === b[1];
      const t = horizontal ? Math.max(a[0] + o.widthM / 2 + 0.2, Math.min(b[0] - o.widthM / 2 - 0.2, p[0])) : Math.max(a[1] + o.widthM / 2 + 0.2, Math.min(b[1] - o.widthM / 2 - 0.2, p[1]));
      const at: P = horizontal ? [t, a[1]] : [a[0], t];
      onEdge.push({ at, d: Math.hypot(at[0] - p[0], at[1] - p[1]), len: horizontal ? b[0] - a[0] : b[1] - a[1] });
    }
    const best = onEdge.filter((e) => e.len >= o.widthM + 0.4).sort((x, y) => x.d - y.d)[0];
    if (!best) { repairs.push({ code: 'OPENING_DROPPED', element: o.key, detail: 'no exterior wall long enough' }); continue; }
    openings.push({ ...o, at: [r2(best.at[0]), r2(best.at[1])], px: null, geometry: 'ESTIMATE' });
    if (best.d > 0.05) repairs.push({ code: 'WINDOW_MOVED', element: o.key, detail: `${r2(best.d)} m onto the exterior wall` });
  }

  return { recon: { ...recon, rooms, openings, objects }, repairs };
}
