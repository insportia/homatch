import type { WallMesh } from './geometry';

/**
 * A WALL WITH HOLES IN IT, WITHOUT A CSG LIBRARY.
 *
 * A door is a hole, and the obvious way to make one is boolean subtraction —
 * which needs a mesh-boolean library, is slow, produces geometry nobody can
 * predict, and fails on degenerate input in ways that are very hard to debug
 * inside a renderer.
 *
 * A wall is a straight run, so the holes can be cut by ARITHMETIC instead: the
 * solid parts are the gaps between the openings, plus the strips above and
 * below each one. Every piece is an axis-aligned box in the wall's own frame,
 * every number comes from the verified plan, and the whole thing is pure and
 * testable without a canvas.
 *
 * The boxes are returned in the WALL'S local frame: `u` runs along the wall
 * from its start, `v` is height from the floor. The renderer rotates the lot
 * into place once, which is also why this file has no three import.
 */

export interface WallSlab {
  /** Distance along the wall to the slab's near edge, metres. */
  u: number;
  /** Height above the floor to the slab's bottom, metres. */
  v: number;
  lengthM: number;
  heightM: number;
  /** What this piece is, so a viewer can tint reveals differently. */
  role: 'SOLID' | 'UNDER_OPENING' | 'OVER_OPENING';
}

/**
 * Cut a wall into the solid pieces that remain once its openings are removed.
 *
 * Openings are clamped into the wall and skipped when they would leave nothing
 * — a door wider than its wall produces no slabs at all rather than a negative
 * one, and the generator has already refused that case upstream.
 */
export function sliceWall(wall: WallMesh): WallSlab[] {
  const H = wall.heightM;
  const L = wall.lengthM;
  if (L <= 0 || H <= 0) return [];

  const openings = [...wall.openings]
    .map((o) => {
      const half = o.widthM / 2;
      return {
        from: Math.max(0, o.offsetM - half),
        to: Math.min(L, o.offsetM + half),
        sill: Math.max(0, o.sillM),
        head: Math.min(H, o.sillM + o.heightM),
      };
    })
    .filter((o) => o.to > o.from && o.head > o.sill)
    .sort((a, b) => a.from - b.from);

  const round = (n: number) => Math.round(n * 10000) / 10000;
  const slabs: WallSlab[] = [];
  let cursor = 0;

  for (const o of openings) {
    // Overlapping openings: the later one starts where the earlier one ended.
    const from = Math.max(cursor, o.from);
    if (from > cursor) {
      slabs.push({ u: round(cursor), v: 0, lengthM: round(from - cursor), heightM: round(H), role: 'SOLID' });
    }
    if (o.to > from) {
      if (o.sill > 0) {
        slabs.push({
          u: round(from), v: 0, lengthM: round(o.to - from), heightM: round(o.sill),
          role: 'UNDER_OPENING',
        });
      }
      if (o.head < H) {
        slabs.push({
          u: round(from), v: round(o.head), lengthM: round(o.to - from),
          heightM: round(H - o.head), role: 'OVER_OPENING',
        });
      }
      cursor = o.to;
    }
  }

  if (cursor < L) {
    slabs.push({ u: round(cursor), v: 0, lengthM: round(L - cursor), heightM: round(H), role: 'SOLID' });
  }
  return slabs;
}

/** Solid wall area actually built, for comparing a shell against its plan. */
export function wallSolidAreaM2(wall: WallMesh): number {
  return Math.round(sliceWall(wall).reduce((sum, s) => sum + s.lengthM * s.heightM, 0) * 100) / 100;
}
