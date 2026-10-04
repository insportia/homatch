// STEP INSIDE THE PICTURE — the selected picture itself, made 3D.
//
// Not a reconstruction: no catalogue furniture, no plan, no re-design. Every
// pixel of the 3D view is a pixel of the picture. A depth map estimated from
// the picture (photo3d/estimateDepth.ts, in the browser) lifts each pixel to
// the distance it is seen at, along the ray of the camera that took the
// picture; the picture is the mesh's texture. From where the picture was
// taken the view IS the picture; a few steps in, the room opens around you.
//
// What a single picture cannot show (behind a sofa, round a corner) it does
// not invent: surfaces are not stretched across a jump in depth (the gap stays
// open), and the walk is bounded to where the picture still holds.
//
// Pure (no DOM, no three.js): numbers in, buffers out. Same input, same mesh.

/** The camera a picture of this kind was taken with (vertical field of view, how near and far its room is). */
export interface PhotoCamera {
  /** Vertical field of view, degrees. */
  fovDeg: number;
  /** Distance of the nearest and farthest things in the picture, metres. */
  nearM: number;
  farM: number;
}

/** An eye-level room picture, and a dollhouse picture of the whole home seen from above. */
export const PHOTO_CAMERAS: Record<'ROOM' | 'MASTER', PhotoCamera> = {
  ROOM: { fovDeg: 55, nearM: 1.1, farM: 7.5 },
  MASTER: { fovDeg: 40, nearM: 6, farM: 13 },
};

/** A depth estimate: relative disparity per pixel (larger = nearer), row-major. */
export interface DepthMap { data: ArrayLike<number>; width: number; height: number }

export interface PhotoMesh {
  /** xyz per vertex, camera at the origin looking down −z, y up (three.js). */
  positions: Float32Array;
  /** uv per vertex: the picture itself. */
  uvs: Float32Array;
  indices: Uint32Array;
  cols: number;
  rows: number;
  /** Metric depth of the median pixel and of the nearest (2nd percentile) — the walk is bounded by them. */
  medianM: number;
  nearestM: number;
  /** Triangles left open at a jump in depth (never stretched across it). */
  openTriangles: number;
}

/** How large a jump in depth across one triangle leaves it open (far / near). */
export const EDGE_RATIO = 1.3;

const quantile = (sorted: Float32Array, q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

/** The depth map at fraction (u, v) of the picture, bilinear. */
function sample(depth: DepthMap, u: number, v: number): number {
  const x = Math.min(depth.width - 1, Math.max(0, u * (depth.width - 1)));
  const y = Math.min(depth.height - 1, Math.max(0, v * (depth.height - 1)));
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const x1 = Math.min(depth.width - 1, x0 + 1); const y1 = Math.min(depth.height - 1, y0 + 1);
  const fx = x - x0; const fy = y - y0;
  const at = (i: number, j: number) => Number(depth.data[j * depth.width + i]);
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
}

/**
 * The picture as a mesh. `aspect` is the picture's width / height; `cols` the grid's columns (rows follow the
 * aspect). Disparity is normalised on robust percentiles (2nd, 98th) and mapped to metres between the camera's
 * near and far so that equal steps of disparity are equal steps of 1 / depth (how a picture shows distance).
 */
export function photoMesh(depth: DepthMap, aspect: number, camera: PhotoCamera, cols = 192): PhotoMesh {
  const rows = Math.max(8, Math.round(cols / Math.max(0.2, aspect)));
  const n = depth.width * depth.height;
  const sorted = Float32Array.from({ length: n }, (_, i) => Number(depth.data[i]));
  sorted.sort();
  const lo = quantile(sorted, 0.02); const hi = quantile(sorted, 0.98);
  const span = Math.max(1e-6, hi - lo);
  const invNear = 1 / camera.nearM; const invFar = 1 / camera.farM;
  const metres = (d: number) => {
    const t = Math.min(1, Math.max(0, (d - lo) / span));
    return 1 / (invFar + t * (invNear - invFar));
  };
  const tanV = Math.tan((camera.fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  const vc = cols + 1; const vr = rows + 1;
  const positions = new Float32Array(vc * vr * 3);
  const uvs = new Float32Array(vc * vr * 2);
  const z = new Float32Array(vc * vr);
  for (let j = 0; j < vr; j += 1) {
    const v = j / rows;
    for (let i = 0; i < vc; i += 1) {
      const u = i / cols;
      const k = j * vc + i;
      const m = metres(sample(depth, u, v));
      z[k] = m;
      // Along the ray through (u, v): depth is the distance along the view axis.
      positions[k * 3] = (u - 0.5) * 2 * tanH * m;
      positions[k * 3 + 1] = (0.5 - v) * 2 * tanV * m;
      positions[k * 3 + 2] = -m;
      uvs[k * 2] = u;
      uvs[k * 2 + 1] = 1 - v;
    }
  }
  const tri: number[] = [];
  let openTriangles = 0;
  const open = (a: number, b: number, c: number) => Math.max(z[a], z[b], z[c]) / Math.min(z[a], z[b], z[c]) > EDGE_RATIO;
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const a = j * vc + i; const b = a + 1; const c = a + vc; const d = c + 1;
      if (open(a, c, b)) openTriangles += 1; else tri.push(a, c, b);
      if (open(b, c, d)) openTriangles += 1; else tri.push(b, c, d);
    }
  }
  const zs = Float32Array.from(z).sort();
  return { positions, uvs, indices: Uint32Array.from(tri), cols, rows, medianM: quantile(zs, 0.5), nearestM: quantile(zs, 0.02), openTriangles };
}

/**
 * Where a visitor may stand: from the picture's own viewpoint, forward up to most of the way to the nearest
 * surface the picture shows ahead (never through it), a little to either side and never out of the picture's
 * view — beyond that a single picture has nothing to show.
 */
export function walkBounds(mesh: Pick<PhotoMesh, 'medianM' | 'nearestM'>): { forwardM: number; sideM: number; upM: number } {
  const forwardM = Math.max(0.3, Math.min(0.6 * mesh.medianM, 0.85 * mesh.nearestM + 0.6, 3));
  return { forwardM: round2(forwardM), sideM: round2(Math.min(0.45 * mesh.nearestM, 1)), upM: 0.25 };
}

/** A position clamped into the walk (x side, y up, z forward is negative). */
export function clampWalk(p: { x: number; y: number; z: number }, b: { forwardM: number; sideM: number; upM: number }) {
  // The side room narrows as one walks in: a picture's view is a cone, not a box.
  const along = Math.min(1, Math.max(0, -p.z / Math.max(0.01, b.forwardM)));
  const side = b.sideM * (1 - 0.5 * along);
  return {
    x: Math.min(side, Math.max(-side, p.x)),
    y: Math.min(b.upM, Math.max(-b.upM, p.y)),
    z: Math.min(0.15, Math.max(-b.forwardM, p.z)),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * When the device cannot estimate the picture's depth: the shape of a room seen from inside it — the floor and
 * the ceiling coming nearer towards the picture's edges, the far wall at its centre. Approximate (the viewer says
 * so); the picture is still the picture.
 */
export function roomShapedDepth(width = 64, height = 48): DepthMap {
  const data = new Float32Array(width * height);
  for (let j = 0; j < height; j += 1) {
    const v = j / (height - 1);
    for (let i = 0; i < width; i += 1) {
      const u = i / (width - 1);
      const floor = Math.max(0, (v - 0.55) / 0.45);
      const ceiling = Math.max(0, (0.25 - v) / 0.25) * 0.6;
      const sides = Math.max(0, Math.abs(u - 0.5) - 0.3) / 0.2 * 0.5;
      data[j * width + i] = Math.min(1, Math.max(floor, ceiling, sides));
    }
  }
  return { data, width, height };
}
