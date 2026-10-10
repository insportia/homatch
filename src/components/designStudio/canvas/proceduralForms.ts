// FORMS — what makes a curved sofa curved, a shell chair a shell.
//
// procedural.ts draws each KIND of piece (and everything it can do in the
// walkthrough). A picture often shows more than the kind: the sofa is a long
// curved cloud, the armchairs are moulded shells, the dining chairs are
// one-piece plastic shells on wooden legs, the plants are leaves and not
// blobs. These builders draw those forms at the piece's own size, in its own
// colours. Pure geometry: no files, nothing fetched, nothing per customer.
//
// Convention (as procedural.ts): origin at the centre of the footprint on the
// floor, the piece's FRONT faces local -z.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

type Mat = THREE.Material;

/** A deterministic pseudo-random sequence (the same piece always looks the same). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedOf = (...n: number[]) => n.reduce((s, v) => (Math.imul(s ^ Math.round(v * 1000), 2654435761) >>> 0), 17);

function mesh(geometry: THREE.BufferGeometry, mat: Mat, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(geometry, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

/** A soft rounded block standing on y0. */
function pod(w: number, h: number, d: number, x: number, y0: number, z: number, mat: Mat, r = 0.08): THREE.Mesh {
  const m = mesh(new RoundedBoxGeometry(w, h, d, 4, Math.min(r, Math.min(w, h, d) * 0.48)), mat);
  m.position.set(x, y0 + h / 2, z);
  return m;
}

/** An ellipsoid with its bottom on y0. */
function blob(rx: number, ry: number, rz: number, x: number, y0: number, z: number, mat: Mat, seg = 24): THREE.Mesh {
  const m = mesh(new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7)), mat);
  m.scale.set(rx, ry, rz);
  m.position.set(x, y0 + ry, z);
  return m;
}

/** A horizontal slab whose outline is `shape` (x, z), extruded `h` up from y0, edges rounded by `bevel`. */
function slab(shape: THREE.Shape, h: number, y0: number, mat: Mat, bevel = 0.04): THREE.Mesh {
  const b = Math.min(bevel, h * 0.45);
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, h - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 4, curveSegments: 24 });
  // Shape (x, y) → world (x, z = y); extrusion along +y.
  g.rotateX(Math.PI / 2);
  g.translate(0, y0 + h - b, 0);
  return mesh(g, mat);
}

/** A rounded rectangle outline (x across, z front-to-back) with corner radius r. */
function roundedRect(w: number, d: number, r: number, cx = 0, cz = 0): THREE.Shape {
  const s = new THREE.Shape();
  const x0 = cx - w / 2; const z0 = cz - d / 2;
  const rr = Math.min(r, w / 2, d / 2);
  s.moveTo(x0 + rr, z0);
  s.lineTo(x0 + w - rr, z0); s.quadraticCurveTo(x0 + w, z0, x0 + w, z0 + rr);
  s.lineTo(x0 + w, z0 + d - rr); s.quadraticCurveTo(x0 + w, z0 + d, x0 + w - rr, z0 + d);
  s.lineTo(x0 + rr, z0 + d); s.quadraticCurveTo(x0, z0 + d, x0, z0 + d - rr);
  s.lineTo(x0, z0 + rr); s.quadraticCurveTo(x0, z0, x0 + rr, z0);
  return s;
}

/**
 * A curved "cloud" sofa: a continuous rounded seat whose back and arms are a
 * row of plump overlapping forms following a gentle curve, seat cushions, and
 * loose pillows in the second colour.
 */
export function curvedSofa(g: THREE.Group, W: number, D: number, H: number, body: Mat, cushion: Mat) {
  const seatH = Math.min(0.44, H * 0.58);
  const bow = Math.min(0.22, W * 0.07); // how far the middle of the back curves away
  const zBack = (x: number) => D / 2 - 0.16 + bow * (1 - (2 * x / W) ** 2) - bow;
  // Base and seat: one rounded outline, slightly bowed with the back.
  const base = new THREE.Shape();
  const n = 24;
  for (let i = 0; i <= n; i += 1) {
    const x = -W / 2 + (W * i) / n;
    const z = -D / 2 + 0.02 + bow * (1 - (2 * x / W) ** 2) - bow;
    if (i === 0) base.moveTo(x, z); else base.lineTo(x, z);
  }
  for (let i = n; i >= 0; i -= 1) { const x = -W / 2 + (W * i) / n; base.lineTo(x, zBack(x) + 0.12); }
  base.closePath();
  g.add(slab(base, seatH - 0.16, 0.04, body, 0.07));
  // Seat cushions.
  const seats = W > 2.2 ? 3 : 2;
  const armW = Math.min(0.26, W * 0.1);
  const cw = (W - 2 * armW) / seats;
  for (let i = 0; i < seats; i += 1) {
    const x = -W / 2 + armW + cw * (i + 0.5);
    g.add(pod(cw + 0.02, 0.17, D - 0.36, x, seatH - 0.13, (zBack(x) - D / 2) / 2 - 0.02, body, 0.08));
  }
  // The back: overlapping plump forms along the curve, and the arms at both ends.
  const backH = Math.max(0.24, H - seatH + 0.12);
  const pods = Math.max(4, Math.round(W / 0.55));
  for (let i = 0; i < pods; i += 1) {
    const x = -W / 2 + armW * 0.6 + ((W - armW * 1.2) * (i + 0.5)) / pods;
    g.add(blob((W - armW) / pods * 0.72, backH / 2, 0.17, x, seatH - 0.14, zBack(x), body));
  }
  for (const sx of [-1, 1]) g.add(blob(armW * 0.75, (seatH + 0.12) / 2, D * 0.42, sx * (W / 2 - armW * 0.7), 0.04, (zBack(sx * W / 2) - D / 2) / 2 + 0.06, body));
  // Loose pillows leaning on the back.
  const pillows = Math.max(2, Math.min(4, Math.round(W / 0.75)));
  for (let i = 0; i < pillows; i += 1) {
    const x = -W / 2 + armW + ((W - 2 * armW) * (i + 0.5)) / pillows;
    const p = pod(0.42, 0.4, 0.13, x, seatH + 0.02, zBack(x) - 0.17, cushion, 0.06);
    p.rotation.set(-0.32, (i - (pillows - 1) / 2) * 0.12, (i % 2 ? -1 : 1) * 0.06);
    g.add(p);
  }
}

/** A moulded lounge chair: a deep rounded bucket seat and a back that wraps round, on short feet. */
export function shellLounge(g: THREE.Group, W: number, D: number, H: number, body: Mat, feet: Mat) {
  const seatY = 0.16;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const f = mesh(new THREE.CylinderGeometry(0.018, 0.012, seatY, 10), feet);
    f.position.set(sx * W * 0.28, seatY / 2, sz * D * 0.26);
    g.add(f);
  }
  g.add(blob(W * 0.47, 0.13, D * 0.42, 0, seatY, -0.02, body)); // seat
  const back = blob(W * 0.5, (H - seatY) * 0.5, 0.2, 0, seatY + 0.06, D / 2 - 0.2, body);
  back.rotation.x = -0.28;
  g.add(back);
  for (const sx of [-1, 1]) {
    const arm = blob(0.11, 0.16, D * 0.36, sx * (W / 2 - 0.11), seatY + 0.04, 0.02, body);
    arm.rotation.z = sx * 0.12;
    g.add(arm);
  }
}

/** A lounge chair on a slim frame (the frame in the second colour) with a seat and a reclined back cushion. */
export function frameLounge(g: THREE.Group, W: number, D: number, H: number, cushion: Mat, frame: Mat) {
  const bar = 0.028;
  const seatY = 0.3;
  // Two side frames: a runner, the arm, front and back posts.
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - bar / 2);
    g.add(pod(bar, bar, D, x, 0.02, 0, frame, 0.01));
    g.add(pod(bar, bar, D * 0.9, x, seatY + 0.22, -0.02, frame, 0.01));
    g.add(pod(bar, seatY + 0.22, bar, x, 0.02, -D / 2 + 0.06, frame, 0.01));
    const post = pod(bar, H - 0.02, bar, x, 0.02, D / 2 - 0.12, frame, 0.01);
    post.rotation.x = -0.25;
    g.add(post);
  }
  g.add(pod(W - 0.06, 0.12, D * 0.72, 0, seatY - 0.04, -0.06, cushion, 0.05)); // seat
  const back = pod(W - 0.08, H - seatY - 0.06, 0.12, 0, seatY + 0.06, D / 2 - 0.2, cushion, 0.05);
  back.rotation.x = -0.32;
  g.add(back);
}

/** A one-piece moulded shell seat (dining) on four slim splayed legs. */
export function shellChair(g: THREE.Group, W: number, D: number, H: number, shell: Mat, legs: Mat) {
  const seatY = 0.44;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const l = mesh(new THREE.CylinderGeometry(0.012, 0.016, seatY, 8), legs);
    l.position.set(sx * (W / 2 - 0.09), seatY / 2, sz * (D / 2 - 0.1));
    l.rotation.set(sz * 0.1, 0, -sx * 0.1);
    g.add(l);
  }
  // The shell: a shallow bowl (part of a sphere) for the seat, rising into a curved back.
  const seat = mesh(new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), shell);
  seat.scale.set(W / 2, 0.1, D / 2 - 0.02);
  seat.position.set(0, seatY + 0.1, -0.02);
  (seat.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  g.add(seat);
  const back = mesh(new THREE.CylinderGeometry(W / 2 - 0.02, W / 2 - 0.05, Math.max(0.2, H - seatY - 0.05), 24, 1, true, Math.PI * 1.62, Math.PI * 0.76), shell);
  back.position.set(0, seatY + 0.06 + (H - seatY - 0.05) / 2, 0.02);
  back.rotation.set(-0.12, 0, 0);
  back.scale.set(1, 1, 0.55);
  g.add(back);
}

/**
 * A tub chair (a dining or occasional chair whose back curves round into its arms): a thick round seat cushion, a
 * low barrel back wrapping three quarters of the way round, on four short tapered legs. Front is −z, like every piece.
 */
export function tubChair(g: THREE.Group, W: number, D: number, H: number, body: Mat, legs: Mat) {
  const seatY = Math.min(0.46, Math.max(0.36, H * 0.52));
  const legH = seatY - 0.12;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const l = mesh(new THREE.CylinderGeometry(0.016, 0.011, legH, 10), legs);
    l.position.set(sx * (W / 2 - 0.08), legH / 2, sz * (D / 2 - 0.08));
    l.rotation.set(sz * 0.08, 0, -sx * 0.08);
    g.add(l);
  }
  const r = Math.min(W, D) / 2;
  // The base of the tub and the seat cushion on it.
  g.add(blob(r * 0.98, 0.07, r * 0.98, 0, legH, 0, body));
  g.add(blob(r * 0.86, 0.06, r * 0.86, 0, legH + 0.08, -0.01, body));
  // The barrel: an open cylinder round the back and sides, centred on the back (+z; theta 0 is +z), the gap at the
  // front; two walls, so it reads as padded.
  const backH = Math.max(0.18, H - legH);
  const arc = Math.PI * 1.45;
  for (const [rad, k] of [[r, 1], [r - 0.05, 0.96]] as const) {
    const shell = mesh(new THREE.CylinderGeometry(rad, rad, backH * k, 32, 1, true, -arc / 2, arc), body);
    (shell.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    shell.position.set(0, legH + (backH * k) / 2, 0);
    g.add(shell);
  }
  // A rounded top edge along the barrel.
  const rim = mesh(new THREE.TorusGeometry(r - 0.025, 0.028, 8, 32, arc), body);
  rim.rotation.set(Math.PI / 2, 0, Math.PI / 2 - arc / 2);
  rim.position.set(0, legH + backH, 0);
  g.add(rim);
}

/** A round pedestal table (a tulip base) or, low and round, a drum. */
export function roundTable(g: THREE.Group, W: number, D: number, H: number, top: Mat, base: Mat) {
  const r = Math.min(W, D) / 2;
  if (H < 0.55) {
    // A drum: one rounded cylinder.
    g.add(slab(circle(r), H, 0, top, 0.03));
    return;
  }
  g.add(slab(circle(r), 0.035, H - 0.035, top, 0.012));
  const profile = [new THREE.Vector2(r * 0.42, 0), new THREE.Vector2(r * 0.4, 0.015), new THREE.Vector2(r * 0.12, 0.09), new THREE.Vector2(0.045, 0.3), new THREE.Vector2(0.04, H - 0.06), new THREE.Vector2(0.09, H - 0.035), new THREE.Vector2(0, H - 0.035)];
  g.add(mesh(new THREE.LatheGeometry(profile, 32), base));
}

function circle(r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, 0, Math.PI * 2, false);
  return s;
}

/** A leaf: a pointed oval, bent along its length, as one small mesh (local +y up the leaf). */
function leafGeometry(len: number, wid: number, bend: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(wid * 0.6, len * 0.25, wid * 0.55, len * 0.7, 0, len);
  s.bezierCurveTo(-wid * 0.55, len * 0.7, -wid * 0.6, len * 0.25, 0, 0);
  const g = new THREE.ShapeGeometry(s, 6);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 1) {
    const y = p.getY(i);
    const x = p.getX(i);
    // Arched along its length, cupped across it.
    p.setZ(i, bend * (y / len) ** 2 * len + Math.abs(x) * 0.25);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Foliage: a few dozen leaves on stems rising from (0, y0, 0) and filling a
 * w × h × d crown — merged into one mesh, with a little colour variation
 * leaf to leaf so it reads as a plant, not a green ball.
 */
export function foliage(w: number, h: number, d: number, y0: number, color: string, opts: { count?: number; leaf?: number; spread?: 'DOME' | 'ROW' } = {}): THREE.Mesh {
  const rand = rng(seedOf(w, h, d, y0));
  const count = opts.count ?? Math.round(Math.min(140, 34 + w * d * 60 + h * 22));
  const leafLen = opts.leaf ?? Math.max(0.09, Math.min(0.32, Math.min(w, d) * 0.38));
  const base = new THREE.Color(color);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i += 1) {
    const len = leafLen * (0.65 + rand() * 0.6);
    const geo = leafGeometry(len, len * (0.42 + rand() * 0.22), 0.18 + rand() * 0.25);
    // Where on the crown: a dome round a stem, or a row along a planter.
    const a = rand() * Math.PI * 2;
    const t = Math.sqrt(rand());
    const up = 0.15 + rand() * 0.85;
    const cx = opts.spread === 'ROW' ? (rand() - 0.5) * w * 0.92 : Math.cos(a) * t * w * 0.42;
    const cz = opts.spread === 'ROW' ? (rand() - 0.5) * d * 0.8 : Math.sin(a) * t * d * 0.42;
    const cy = y0 + up * h * 0.86;
    const out = Math.atan2(cz, cx);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(cx, cy, cz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-(0.35 + rand() * 0.9) * (1 - up * 0.4), -out + Math.PI / 2 + (rand() - 0.5) * 0.8, (rand() - 0.5) * 0.6, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    geo.applyMatrix4(m);
    // Per-leaf colour: lighter toward the light, a touch of variation.
    const k = 0.78 + rand() * 0.38 + up * 0.12;
    const c = base.clone().multiplyScalar(k);
    const colors = new Float32Array(geo.attributes.position.count * 3);
    for (let v = 0; v < geo.attributes.position.count; v += 1) { colors[v * 3] = c.r; colors[v * 3 + 1] = c.g; colors[v * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(geo);
  }
  const merged = mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
  parts.forEach((p) => p.dispose());
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
  return mesh(merged, mat);
}

/** A tapered pot (lathe), its rim at `h`. */
export function pot(r: number, h: number, mat: Mat): THREE.Mesh {
  const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(r * 0.78, 0), new THREE.Vector2(r, h * 0.96), new THREE.Vector2(r * 1.02, h), new THREE.Vector2(r * 0.92, h), new THREE.Vector2(r * 0.9, h * 0.9), new THREE.Vector2(0, h * 0.9)];
  return mesh(new THREE.LatheGeometry(pts, 28), mat);
}

/** A screen on a slim stand (a television that stands on the floor). */
export function screenOnStand(g: THREE.Group, W: number, D: number, H: number, black: Mat): { panel: THREE.Mesh; top: number } {
  const sw = Math.min(W, 1.6);
  const sh = Math.min(H * 0.55, sw * 0.5625);
  g.add(pod(Math.min(0.5, W * 0.45), 0.02, Math.min(D, 0.35), 0, 0, 0, black, 0.008));
  g.add(pod(0.05, H - sh - 0.02, 0.05, 0, 0.02, 0.03, black, 0.01));
  g.add(pod(sw + 0.02, sh + 0.02, 0.035, 0, H - sh - 0.02, 0, black, 0.006));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshStandardMaterial({ color: '#0b0c0e', roughness: 0.18, metalness: 0.1 }));
  panel.position.set(0, H - sh / 2 - 0.01, -0.019);
  panel.rotation.y = Math.PI;
  return { panel, top: H };
}
