// HOMATCH DESIGN STUDIO — the camera a picture was taken with.
//
// The reader traces what it sees in PIXELS (room corners, openings, pieces,
// at floor level) next to its own metric plan estimate for the same points.
// From those correspondences this module fits the picture's camera,
// deterministically:
//
//   ORTHO        an isometric / dollhouse / aerial visualisation: a scaled
//                orthographic view (6 degrees of freedom). The floor plane's
//                image is an affine map, and every non-degenerate affine map of
//                a plane is exactly one scaled orthographic view of it.
//   PERSPECTIVE  a photograph or an eye-level render: a pinhole camera with
//                its principal point at the image centre; the floor's image is
//                a homography, from which focal length and pose follow.
//
// With the camera known, pixels become plan geometry by UNPROJECTING onto the
// floor, so outlines, angles and proportions come from what the picture shows
// rather than from a model's guess in metres (which only sets the scale).
// The same camera then puts the 3D view exactly where the picture looks from.
//
// Conventions. Plan (x, y) metres, y north. World (three.js) = (x, height, −y).
// Image coordinates are in IMAGE-HEIGHT units: X = u·aspect, Y = v, origin
// top-left, Y down; u, v are the reader's fractions of width and height.
// R's rows are the camera's right, down and forward axes in world coordinates.
//
// Pure and dependency-free: the edge function (Deno) and the browser and the
// tests (Node) run the same code.

export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface CameraFit {
  model: 'ORTHO' | 'PERSPECTIVE';
  /** Image width / height. */
  aspect: number;
  /** Rows: right, down, forward (world coordinates). */
  R: Mat3;
  /** ORTHO: image-height units per metre, and the image translation. */
  s?: number;
  t?: [number, number];
  /** PERSPECTIVE: focal length (image-height units) and the translation in camera coordinates. */
  f?: number;
  T?: Vec3;
  /** Root-mean-square reprojection error, as a fraction of the image height. */
  rms: number;
  /** Correspondences the fit kept. */
  points: number;
}

export interface Correspondence { plan: [number, number]; uv: [number, number] }

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const scale3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const row = (m: Mat3, i: number): Vec3 => [m[i * 3], m[i * 3 + 1], m[i * 3 + 2]];
const mulMV = (m: Mat3, v: Vec3): Vec3 => [dot(row(m, 0), v), dot(row(m, 1), v), dot(row(m, 2), v)];
const fromRows = (a: Vec3, b: Vec3, c: Vec3): Mat3 => [a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]];
/** mᵀ·v */
const mulMtV = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];

export const worldOf = (plan: [number, number], height = 0): Vec3 => [plan[0], height, -plan[1]];

/** Where a plan point (at a height) lands in the picture, as [u, v] fractions. Null when behind a perspective camera. */
export function projectPlan(fit: CameraFit, plan: [number, number], height = 0): [number, number] | null {
  const P = worldOf(plan, height);
  const c = mulMV(fit.R, P);
  if (fit.model === 'ORTHO') {
    const X = (fit.s ?? 1) * c[0] + (fit.t?.[0] ?? 0);
    const Y = (fit.s ?? 1) * c[1] + (fit.t?.[1] ?? 0);
    return [X / fit.aspect, Y];
  }
  const T = fit.T ?? [0, 0, 1];
  const z = c[2] + T[2];
  if (z <= 1e-6) return null;
  const f = fit.f ?? 1;
  return [((f * (c[0] + T[0])) / z + fit.aspect / 2) / fit.aspect, (f * (c[1] + T[1])) / z + 0.5];
}

/** Where a picture point [u, v] meets the floor, in plan metres. */
export function unprojectFloor(fit: CameraFit, uv: [number, number]): [number, number] | null {
  const X = uv[0] * fit.aspect;
  const Y = uv[1];
  if (fit.model === 'ORTHO') {
    const s = fit.s ?? 1;
    const a = s * fit.R[0]; const b = s * fit.R[2];
    const d = s * fit.R[3]; const e = s * fit.R[5];
    const det = a * e - b * d;
    if (Math.abs(det) < 1e-12) return null;
    const rx = X - (fit.t?.[0] ?? 0);
    const ry = Y - (fit.t?.[1] ?? 0);
    const wx = (e * rx - b * ry) / det;
    const wz = (-d * rx + a * ry) / det;
    return [wx, -wz];
  }
  const f = fit.f ?? 1;
  const T = fit.T ?? [0, 0, 1];
  const C = scale3(mulMtV(fit.R, T), -1);
  const dir = mulMtV(fit.R, [(X - fit.aspect / 2) / f, (Y - 0.5) / f, 1]);
  if (Math.abs(dir[1]) < 1e-9) return null;
  const k = -C[1] / dir[1];
  if (k <= 0) return null;
  return [C[0] + dir[0] * k, -(C[2] + dir[2] * k)];
}

function rmsOf(fit: CameraFit, pairs: Correspondence[]): number {
  if (!pairs.length) return Infinity;
  let sum = 0;
  for (const p of pairs) {
    const q = projectPlan(fit, p.plan);
    if (!q) return Infinity;
    sum += ((q[0] - p.uv[0]) * fit.aspect) ** 2 + (q[1] - p.uv[1]) ** 2;
  }
  return Math.sqrt(sum / pairs.length);
}

/** Solve the normal equations of a small least-squares problem (Gaussian elimination, partial pivoting). */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j += 1) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** x̂ = a·X + b·Z + t1, ŷ = d·X + e·Z + t2, by least squares over the floor points. */
export function fitOrtho(pairs: Correspondence[], aspect: number): CameraFit | null {
  if (pairs.length < 3) return null;
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const bx = [0, 0, 0];
  const by = [0, 0, 0];
  for (const p of pairs) {
    const r = [p.plan[0], -p.plan[1], 1];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) A[i][j] += r[i] * r[j];
      bx[i] += r[i] * p.uv[0] * aspect;
      by[i] += r[i] * p.uv[1];
    }
  }
  const px = solve(A, bx);
  const py = solve(A, by);
  if (!px || !py) return null;
  const [a, b, t1] = px;
  const [d, e, t2] = py;
  // An affine map of the floor is one scaled orthographic view: recover the
  // world-up components of the first two camera rows from orthonormality.
  const Aa = a * a + b * b;
  const Dd = d * d + e * e;
  const Cc = a * d + b * e;
  const s2 = (Aa + Dd + Math.sqrt((Aa - Dd) ** 2 + 4 * Cc * Cc)) / 2;
  if (!(s2 > 1e-12)) return null;
  const s = Math.sqrt(s2);
  const y1 = Math.sqrt(Math.max(0, s2 - Aa));
  // Orthogonal rows need y1·y2 = −C.
  const y2 = Math.sqrt(Math.max(0, s2 - Dd)) * (Cc > 0 ? -1 : 1);
  // Floor points alone allow two mirror solutions (the Necker reversal): they
  // draw the floor identically and disagree about which way is up. In a
  // picture of a home, vertical edges point UP the image, so world-up must
  // map to a negative image-Y; that picks the one that is true.
  const [u1, u2] = y2 <= 0 ? [y1, y2] : [-y1, -y2];
  const r1: Vec3 = [a / s, u1 / s, b / s];
  const r2: Vec3 = [d / s, u2 / s, e / s];
  const r3 = cross(r1, r2);
  const n3 = norm(r3);
  if (n3 < 1e-9) return null;
  const fit: CameraFit = { model: 'ORTHO', aspect, R: fromRows(r1, r2, scale3(r3, 1 / n3)), s, t: [t1, t2], rms: 0, points: pairs.length };
  fit.rms = rmsOf(fit, pairs);
  return fit;
}

/** The floor's homography (normalised DLT), then focal length and pose. */
export function fitPerspective(pairs: Correspondence[], aspect: number): CameraFit | null {
  if (pairs.length < 5) return null;
  const pts = pairs.map((p) => ({ X: p.plan[0], Z: -p.plan[1], x: p.uv[0] * aspect - aspect / 2, y: p.uv[1] - 0.5 }));
  const mean = (k: 'X' | 'Z') => pts.reduce((s, p) => s + p[k], 0) / pts.length;
  const mX = mean('X'); const mZ = mean('Z');
  const sc = Math.sqrt(2) / (pts.reduce((s, p) => s + Math.hypot(p.X - mX, p.Z - mZ), 0) / pts.length || 1);
  // Solve H (8 unknowns, h33 = 1) by least squares on normalised plane coordinates.
  const A: number[][] = Array.from({ length: 8 }, () => Array(8).fill(0));
  const bvec = Array(8).fill(0);
  const add = (r: number[], v: number) => { for (let i = 0; i < 8; i += 1) { for (let j = 0; j < 8; j += 1) A[i][j] += r[i] * r[j]; bvec[i] += r[i] * v; } };
  for (const p of pts) {
    const X = (p.X - mX) * sc; const Z = (p.Z - mZ) * sc;
    add([X, Z, 1, 0, 0, 0, -p.x * X, -p.x * Z], p.x);
    add([0, 0, 0, X, Z, 1, -p.y * X, -p.y * Z], p.y);
  }
  const h = solve(A, bvec);
  if (!h) return null;
  // Undo the normalisation: H = Hn · N, N maps (X, Z, 1) to normalised coordinates.
  const Hn = [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  const N = [[sc, 0, -sc * mX], [0, sc, -sc * mZ], [0, 0, 1]];
  const H = Hn.map((r) => [0, 1, 2].map((j) => r[0] * N[0][j] + r[1] * N[1][j] + r[2] * N[2][j]));
  const col = (j: number): Vec3 => [H[0][j], H[1][j], H[2][j]];
  const h1 = col(0); const h2 = col(1); const h3 = col(2);
  // Orthogonality and equal length of the two floor axes give the focal length.
  const estimates: number[] = [];
  if (Math.abs(h1[2] * h2[2]) > 1e-12) estimates.push(-(h1[0] * h2[0] + h1[1] * h2[1]) / (h1[2] * h2[2]));
  const den = h1[2] ** 2 - h2[2] ** 2;
  if (Math.abs(den) > 1e-12) estimates.push((h2[0] ** 2 + h2[1] ** 2 - h1[0] ** 2 - h1[1] ** 2) / den);
  const f2 = estimates.filter((v) => v > 0);
  if (!f2.length) return null;
  const f = Math.sqrt(f2.reduce((s, v) => s + v, 0) / f2.length);
  // A camera wider than 120° or narrower than 5° is not what took a home photo.
  const fovDeg = (2 * Math.atan(0.5 / f) * 180) / Math.PI;
  if (fovDeg < 5 || fovDeg > 120) return null;
  const kinv = (v: Vec3): Vec3 => [v[0] / f, v[1] / f, v[2]];
  let cX = kinv(h1); let cZ = kinv(h2);
  let lambda = 2 / (norm(cX) + norm(cZ));
  let T = scale3(kinv(h3), lambda);
  if (T[2] < 0) { lambda = -lambda; T = scale3(T, -1); }
  cX = scale3(cX, lambda); cZ = scale3(cZ, lambda);
  // Orthonormalise the world X and Z axes as seen by the camera; Y = Z × X.
  const ex = scale3(cX, 1 / norm(cX));
  let ez: Vec3 = [cZ[0] - dot(cZ, ex) * ex[0], cZ[1] - dot(cZ, ex) * ex[1], cZ[2] - dot(cZ, ex) * ex[2]];
  ez = scale3(ez, 1 / norm(ez));
  const ey = cross(ez, ex);
  // Columns are the world axes in camera coordinates; R's rows are then read off.
  const R: Mat3 = [ex[0], ey[0], ez[0], ex[1], ey[1], ez[1], ex[2], ey[2], ez[2]];
  const fit: CameraFit = { model: 'PERSPECTIVE', aspect, R, f, T, rms: 0, points: pairs.length };
  fit.rms = rmsOf(fit, pairs);
  // The camera must be above the floor, looking at it.
  const C = scale3(mulMtV(R, T), -1);
  if (C[1] <= 0.2) return null;
  return fit;
}

/**
 * The picture's camera from its correspondences: both models, each fitted
 * robustly (the worst outliers dropped and refitted), the better one kept.
 * An orthographic view wins ties, because an aerial visualisation is one.
 */
export function fitCamera(pairs: Correspondence[], aspect: number, hint: 'AERIAL' | 'EYE' | null = null): CameraFit | null {
  if (pairs.length < 4 || !(aspect > 0)) return null;
  const robust = (fit: (p: Correspondence[], a: number) => CameraFit | null): CameraFit | null => {
    let current = pairs;
    let f = fit(current, aspect);
    for (let pass = 0; f && pass < 2; pass += 1) {
      const res = current.map((p) => {
        const q = projectPlan(f!, p.plan);
        return q ? Math.hypot((q[0] - p.uv[0]) * aspect, q[1] - p.uv[1]) : Infinity;
      });
      const med = [...res].sort((a, b) => a - b)[Math.floor(res.length / 2)];
      const keep = current.filter((_, i) => res[i] <= Math.max(3 * med, 0.01));
      if (keep.length === current.length || keep.length < 5) break;
      current = keep;
      f = fit(current, aspect);
    }
    return f;
  };
  const ortho = robust(fitOrtho);
  const persp = pairs.length >= 6 ? robust(fitPerspective) : null;
  if (!persp) return ortho;
  if (!ortho) return persp;
  const bias = hint === 'EYE' ? 0.9 : 0.6;
  return persp.rms < ortho.rms * bias ? persp : ortho;
}

/**
 * The same camera after the plan is rotated by `angle` (radians,
 * counter-clockwise, about the origin) and then moved by (dx, dy).
 */
export function transformFit(fit: CameraFit, angle: number, dx: number, dy: number): CameraFit {
  const c = Math.cos(angle); const s = Math.sin(angle);
  // P' = W·P + D in world coordinates, so a camera row r becomes r·Wᵀ.
  const W: Mat3 = [c, 0, s, 0, 1, 0, -s, 0, c];
  const rot = (r: Vec3): Vec3 => mulMV(W, r);
  const R = fromRows(rot(row(fit.R, 0)), rot(row(fit.R, 1)), rot(row(fit.R, 2)));
  const D: Vec3 = [dx, 0, -dy];
  const RD = mulMV(R, D);
  if (fit.model === 'ORTHO') {
    const k = fit.s ?? 1;
    return { ...fit, R, t: [(fit.t?.[0] ?? 0) - k * RD[0], (fit.t?.[1] ?? 0) - k * RD[1]] };
  }
  const T = fit.T ?? [0, 0, 1];
  return { ...fit, R, T: [T[0] - RD[0], T[1] - RD[1], T[2] - RD[2]] };
}

/** The same camera over a plan whose every coordinate is multiplied by `k` (a calibrated space). */
export function scaleFit(fit: CameraFit, k: number): CameraFit {
  if (!(k > 0) || k === 1) return fit;
  if (fit.model === 'ORTHO') return { ...fit, s: (fit.s ?? 1) / k };
  const T = fit.T ?? [0, 0, 1];
  return { ...fit, T: [T[0] * k, T[1] * k, T[2] * k] };
}

/**
 * A three.js perspective pose that shows the scene exactly as the picture
 * does when the picture is drawn `object-fit: contain` over a canvas of this
 * size. An orthographic fit is shown by a far camera with a narrow lens
 * (`distance` metres away), which is orthographic to within a few percent.
 */
export function viewForCanvas(fit: CameraFit, canvasW: number, canvasH: number, centre: [number, number], distance = 250):
  { position: Vec3; target: Vec3; fov: number; near: number; far: number } | null {
  if (!(canvasW > 0) || !(canvasH > 0)) return null;
  // The picture's height in canvas pixels when it is contained in the canvas.
  const imgH = Math.min(canvasH, canvasW / fit.aspect);
  const halfH = canvasH / imgH / 2; // canvas half-height, in image-height units
  const right = row(fit.R, 0);
  const down = row(fit.R, 1);
  const forward = row(fit.R, 2);
  if (fit.model === 'ORTHO') {
    const k = fit.s ?? 1;
    const alpha = (fit.aspect / 2 - (fit.t?.[0] ?? 0)) / k;
    const beta = (0.5 - (fit.t?.[1] ?? 0)) / k;
    const gamma = dot(forward, worldOf(centre));
    const target: Vec3 = [
      alpha * right[0] + beta * down[0] + gamma * forward[0],
      alpha * right[1] + beta * down[1] + gamma * forward[1],
      alpha * right[2] + beta * down[2] + gamma * forward[2],
    ];
    const position: Vec3 = [target[0] - forward[0] * distance, target[1] - forward[1] * distance, target[2] - forward[2] * distance];
    const fov = (2 * Math.atan(halfH / k / distance) * 180) / Math.PI;
    return { position, target, fov, near: Math.max(0.05, distance * 0.6), far: distance * 1.6 };
  }
  const f = fit.f ?? 1;
  const T = fit.T ?? [0, 0, 1];
  const C = scale3(mulMtV(fit.R, T), -1);
  const reach = forward[1] < -0.05 ? Math.min(60, C[1] / -forward[1]) : 8;
  const target: Vec3 = [C[0] + forward[0] * reach, C[1] + forward[1] * reach, C[2] + forward[2] * reach];
  const fov = (2 * Math.atan(halfH / f) * 180) / Math.PI;
  return { position: C, target, fov, near: 0.05, far: 500 };
}
