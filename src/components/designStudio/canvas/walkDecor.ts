// HOMATCH Design Studio — the walked home, dressed.
//
// A furnished plan with only its furniture reads as a showroom: nothing on the
// walls, nothing on the tables, bare windows. While the home is walked, this
// layer adds what lived-in rooms have — art above the sofa, the bed and the
// sideboard, books and a vase on the coffee table, a centrepiece on the dining
// table, a candle on the nightstand, curtains at the living rooms' and
// bedrooms' windows — in the design's own colours, varied home to home and
// room to room (seeded by each piece's id, so a home always looks the same).
//
// It is dressing, not furniture: never in the design, never a collision or a
// target (no raycast), never counted by the walk's checks. Built on entering
// the walk and disposed on leaving it.

import * as THREE from 'three';
import type { CatalogAsset } from '@/lib/designStudio/catalog';
import type { ObjectInstance } from '@/lib/designStudio/designState';
import { pieceRole } from '@/lib/designStudio/placementSearch';
import { pointInPolygon, type Point, type SpaceModel } from '@/lib/designStudio/space';

export interface DecorInput {
  space: SpaceModel;
  pieces: Array<{ obj: ObjectInstance; asset: CatalogAsset }>;
  /** The design's colours (project palette, then the pieces' own): the art and textiles are drawn from them. */
  palette: string[];
}

/** Rooms where windows get curtains (not kitchens, baths or halls). */
const CURTAINED = new Set(['LIVING', 'BEDROOM', 'KIDS_ROOM', 'GUEST_ROOM', 'STUDIO', 'KITCHEN_LIVING', 'DINING', 'STUDY', 'OFFICE']);
/** Accents a palette of neutrals is lifted with (terracotta, olive, ink, ochre, sage, dusty rose). */
const ACCENTS = ['#b5653f', '#6b7046', '#2f3a4f', '#c49a3a', '#8fa08a', '#b98b86'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed: number): () => number {
  let a = seed || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length];

const frontOf = (rotation: number): Point => ({ x: -Math.sin(rotation), y: Math.cos(rotation) });
const words = (a: CatalogAsset) => [a.category, a.subcategory, a.code].filter(Boolean).join(' ').toUpperCase();

/** Distance from `from` along `dir` to the nearest wall face (m), or null within `max`. */
function wallAlong(space: SpaceModel, from: Point, dir: Point, max = 1.2): number | null {
  let best: number | null = null;
  for (const w of space.walls) {
    const a = w.mesh.start; const b = w.mesh.end;
    const ex = b.x - a.x; const ey = b.y - a.y;
    const den = dir.x * ey - dir.y * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - from.x) * ey - (a.y - from.y) * ex) / den;
    const s = ((a.x - from.x) * dir.y - (a.y - from.y) * dir.x) / den;
    if (t <= 0 || s < 0 || s > 1) continue;
    // The face, not the centre line: back off by half the wall, more on a slant.
    const len = Math.hypot(ex, ey) || 1;
    const cos = Math.abs((dir.x * -ey + dir.y * ex) / len);
    const face = t - w.mesh.thicknessM / 2 / Math.max(0.3, cos);
    if (face > 0 && face <= max && (best === null || face < best)) best = face;
  }
  return best;
}

export function buildDecor(input: DecorInput): THREE.Group {
  const group = new THREE.Group();
  group.name = 'walk-decor';
  const ceiling = input.space.ceilingHeightM || 2.7;
  const colours = [...new Set([...input.palette, ...input.pieces.map((p) => p.obj.colorOverride).filter((c): c is string => !!c)])].slice(0, 8);
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (hex: string, roughness = 0.7, metalness = 0) => {
    const k = `${hex}|${roughness}|${metalness}`;
    let m = mats.get(k);
    if (!m) { m = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness, metalness }); mats.set(k, m); }
    return m;
  };
  const add = (mesh: THREE.Mesh, at: Point, y: number, yaw = 0) => {
    mesh.position.set(at.x, y, -at.y);
    mesh.rotation.y = yaw;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.raycast = () => {};
    mesh.userData.decor = true;
    group.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const cyl = (rTop: number, rBot: number, h: number, m: THREE.Material, seg = 20) => new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), m);
  // Yaw that turns a mesh's +z toward a plan direction (plan y is world −z).
  const yawFacing = (d: Point) => Math.atan2(d.x, -d.y);

  // ── Art: an abstract painting in the design's colours, framed ──
  const painting = (r: () => number, wPx: number, hPx: number): THREE.Texture => {
    const c = document.createElement('canvas');
    c.width = wPx; c.height = hPx;
    const g = c.getContext('2d')!;
    const pal = [...colours, ...ACCENTS];
    const ground = pick(r, ['#efe9df', '#e7e2d8', '#f3efe8', '#d9d4cb', '#2b2b2e']);
    g.fillStyle = ground; g.fillRect(0, 0, wPx, hPx);
    const style = Math.floor(r() * 4);
    if (style === 0) {
      // Colour fields.
      for (let i = 0; i < 3 + Math.floor(r() * 3); i += 1) {
        g.fillStyle = pick(r, pal); g.globalAlpha = 0.75 + r() * 0.25;
        g.fillRect(r() * wPx * 0.6, r() * hPx * 0.6, wPx * (0.25 + r() * 0.45), hPx * (0.2 + r() * 0.4));
      }
    } else if (style === 1) {
      // Arcs and suns.
      for (let i = 0; i < 3; i += 1) {
        g.fillStyle = pick(r, pal); g.globalAlpha = 0.85;
        g.beginPath(); g.arc(wPx * (0.2 + r() * 0.6), hPx * (0.3 + r() * 0.5), Math.min(wPx, hPx) * (0.12 + r() * 0.25), Math.PI, 0); g.fill();
      }
    } else if (style === 2) {
      // A soft landscape: bands of hills under a sky.
      const sky = g.createLinearGradient(0, 0, 0, hPx);
      sky.addColorStop(0, pick(r, ['#c9d6dc', '#e9d9c2', '#d8c7c0'])); sky.addColorStop(1, ground);
      g.fillStyle = sky; g.fillRect(0, 0, wPx, hPx);
      for (let k = 0; k < 3; k += 1) {
        g.fillStyle = pick(r, pal); g.globalAlpha = 0.6 + k * 0.15;
        g.beginPath(); g.moveTo(0, hPx);
        const base = hPx * (0.55 + k * 0.13);
        for (let x = 0; x <= wPx; x += wPx / 8) g.lineTo(x, base - Math.sin(x / wPx * Math.PI * (1 + r()) + k) * hPx * 0.08);
        g.lineTo(wPx, hPx); g.fill();
      }
    } else {
      // Line drawing: a few confident strokes.
      g.strokeStyle = pick(r, ['#2b2b2e', pick(r, pal)]); g.lineWidth = Math.max(2, wPx / 90); g.globalAlpha = 0.9;
      g.beginPath(); g.moveTo(wPx * 0.15, hPx * (0.3 + r() * 0.4));
      for (let i = 0; i < 4; i += 1) g.bezierCurveTo(wPx * r(), hPx * r(), wPx * r(), hPx * r(), wPx * (0.2 + r() * 0.6), hPx * (0.2 + r() * 0.6));
      g.stroke();
      g.fillStyle = pick(r, pal); g.globalAlpha = 0.8;
      g.beginPath(); g.arc(wPx * (0.3 + r() * 0.4), hPx * (0.3 + r() * 0.4), Math.min(wPx, hPx) * 0.1, 0, Math.PI * 2); g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  const frameMats = [mat('#1f1d1b', 0.5), mat('#b08a4e', 0.35, 0.6), mat('#efebe4', 0.5), mat('#6b4a32', 0.55)];
  /** Art on the wall face at `wall`, facing into the room, its bottom edge at `bottom` (above what stands below). */
  const hangArt = (r: () => number, wall: Point, facing: Point, along: Point, bottom: number, span: number) => {
    const at = { x: wall.x + facing.x * 0.016, y: wall.y + facing.y * 0.016 };
    const yaw = yawFacing(facing);
    const frameMat = pick(r, frameMats);
    const layout = span >= 1.5 && r() < 0.45 ? (r() < 0.5 ? 2 : 3) : 1;
    const each = layout === 1 ? Math.min(1.1, span * 0.62) : Math.min(0.6, (span * 0.8) / layout - 0.08);
    const h = layout === 1 ? each * (r() < 0.5 ? 0.7 : 0.8) : each * 1.3;
    const y = Math.min(ceiling - 0.2 - h / 2, bottom + h / 2);
    for (let i = 0; i < layout; i += 1) {
      const off = (i - (layout - 1) / 2) * (each + 0.08);
      const p = { x: at.x + along.x * off, y: at.y + along.y * off };
      add(box(each + 0.05, h + 0.05, 0.03, frameMat), p, y, yaw);
      const canvas = new THREE.Mesh(new THREE.PlaneGeometry(each - 0.03, h - 0.03), new THREE.MeshStandardMaterial({ map: painting(r, 256, Math.round(256 * h / each)), roughness: 0.85 }));
      add(canvas, { x: p.x + facing.x * 0.016, y: p.y + facing.y * 0.016 }, y, yaw);
    }
  };

  for (const { obj, asset } of input.pieces) {
    const r = rng(hash(obj.instanceId));
    const c = { x: obj.position.x, y: obj.position.z };
    const f = frontOf(obj.rotationY);
    const u = { x: Math.cos(obj.rotationY), y: Math.sin(obj.rotationY) };
    const role = pieceRole(asset);
    const w = words(asset);
    const top = asset.heightM;
    // Art above what stands against a wall: the sofa, the bed, a sideboard or dresser, a desk.
    if (role === 'SOFA' || role === 'BED' || /DRESSER|SIDEBOARD|CONSOLE|DESK/.test(w)) {
      const back = { x: c.x - f.x * (asset.depthM / 2), y: c.y - f.y * (asset.depthM / 2) };
      const gap = wallAlong(input.space, back, { x: -f.x, y: -f.y }, 0.35);
      if (gap !== null) {
        // Clear of what stands below: a sofa's back, a bed's headboard (its tall form), a sideboard's top.
        const bottom = role === 'BED' ? Math.max(top, 1.3) + 0.12 : role === 'SOFA' ? Math.max(top, 0.9) + 0.2 : top + 0.3;
        hangArt(r, { x: back.x - f.x * gap, y: back.y - f.y * gap }, f, u, bottom, asset.widthM);
      }
    }
    // A coffee table: a stack of books and a vase or a bowl.
    if (role === 'COFFEE_TABLE') {
      const books = { x: c.x + u.x * asset.widthM * 0.2, y: c.y + u.y * asset.widthM * 0.2 };
      let y = top;
      for (let i = 0; i < 2 + Math.floor(r() * 2); i += 1) {
        const t = 0.03 + r() * 0.02;
        add(box(0.24 - i * 0.02, t, 0.17 - i * 0.015, mat(pick(r, [...colours, ...ACCENTS, '#e8e2d6']), 0.8)), books, y + t / 2, obj.rotationY + (r() - 0.5) * 0.3);
        y += t;
      }
      const v = { x: c.x - u.x * asset.widthM * 0.22, y: c.y - u.y * asset.widthM * 0.22 };
      if (r() < 0.5) add(cyl(0.05, 0.035, 0.2, mat(pick(r, ['#e9e4da', '#2b2b2e', '#a7745a', '#7f8a7a']), 0.35)), v, top + 0.1);
      else add(cyl(0.12, 0.06, 0.06, mat(pick(r, ['#d9cfc0', '#3a3530', '#b08a4e']), 0.4, 0.2), 28), v, top + 0.03);
    }
    // A dining table: a runner and a centrepiece (a vase of branches, or a fruit bowl).
    if (role === 'TABLE' && !/DESK|SIDE|BEDSIDE|NIGHT/.test(w)) {
      add(box(Math.max(0.3, asset.widthM * 0.7), 0.004, 0.3, mat(pick(r, ['#d8cfc2', '#8a7a68', ...colours]), 0.95)), c, top + 0.002, obj.rotationY);
      if (r() < 0.5) {
        add(cyl(0.06, 0.045, 0.24, mat(pick(r, ['#e9e4da', '#3c4a3e', '#a7745a']), 0.3)), c, top + 0.12);
        for (let i = 0; i < 4; i += 1) {
          const stem = add(cyl(0.004, 0.004, 0.32, mat('#5b6b48', 0.8), 5), c, top + 0.34);
          stem.rotation.z = (r() - 0.5) * 0.6; stem.rotation.x = (r() - 0.5) * 0.6;
          const leaf = add(new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), mat(pick(r, ['#6f8a58', '#c9b37a', '#b98b86']), 0.8)), { x: c.x + (r() - 0.5) * 0.14, y: c.y + (r() - 0.5) * 0.14 }, top + 0.46 + r() * 0.08);
          leaf.scale.set(1, 0.7, 1.3);
        }
      } else {
        add(cyl(0.15, 0.08, 0.07, mat(pick(r, ['#e9e4da', '#3a3530']), 0.4), 28), c, top + 0.035);
        for (let i = 0; i < 5; i += 1) {
          add(new THREE.Mesh(new THREE.SphereGeometry(0.035 + r() * 0.01, 10, 8), mat(pick(r, ['#d8a33a', '#b5432f', '#8aa04a', '#e0b54a']), 0.55)),
            { x: c.x + (r() - 0.5) * 0.14, y: c.y + (r() - 0.5) * 0.14 }, top + 0.08 + r() * 0.03);
        }
      }
    }
    // A nightstand: a candle or a small vase, and a book.
    if (role === 'NIGHTSTAND') {
      add(box(0.15, 0.025, 0.21, mat(pick(r, [...colours, ...ACCENTS]), 0.8)), { x: c.x + u.x * 0.06, y: c.y + u.y * 0.06 }, top + 0.0125, obj.rotationY + 0.2);
      add(cyl(0.035, 0.035, 0.09, mat(pick(r, ['#efe9df', '#c9b79e']), 0.6)), { x: c.x - u.x * 0.1, y: c.y - u.y * 0.1 }, top + 0.045);
    }
  }

  // ── Curtains at the windows of the rooms that are lived in ──
  const linen = pick(rng(hash(input.space.rooms.map((x) => x.id).join())), ['#e9e3d8', '#d8cfc2', '#cfc6b8', '#e2ddd3']);
  const curtainMat = mat(linen, 0.95);
  const rodMat = mat('#2b2b2e', 0.4, 0.5);
  for (const wall of input.space.walls) {
    const m = wall.mesh;
    const len = Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y) || 1;
    const dir = { x: (m.end.x - m.start.x) / len, y: (m.end.y - m.start.y) / len };
    const nrm = { x: -dir.y, y: dir.x };
    for (const o of m.openings) {
      if (o.kind !== 'WINDOW') continue;
      const mid = { x: m.start.x + dir.x * o.offsetM, y: m.start.y + dir.y * o.offsetM };
      for (const side of [1, -1]) {
        const n = { x: nrm.x * side, y: nrm.y * side };
        const probe = { x: mid.x + n.x * (m.thicknessM / 2 + 0.3), y: mid.y + n.y * (m.thicknessM / 2 + 0.3) };
        const room = input.space.rooms.find((x) => pointInPolygon(probe, x.polygon));
        if (!room || !CURTAINED.has(room.kind)) continue;
        const off = m.thicknessM / 2 + 0.09;
        const top = Math.min(ceiling - 0.06, o.sillM + o.heightM + 0.25);
        const yaw = yawFacing(n);
        for (const s of [-1, 1]) {
          const along = s * (o.widthM / 2 + 0.16);
          const at = { x: mid.x + dir.x * along + n.x * off, y: mid.y + dir.y * along + n.y * off };
          // A panel in soft pleats: a few slim folds side by side.
          for (let k = 0; k < 4; k += 1) {
            const fold = add(box(0.09, top - 0.02, 0.035, curtainMat), { x: at.x + dir.x * (k - 1.5) * 0.085 + n.x * (k % 2 ? 0.02 : 0), y: at.y + dir.y * (k - 1.5) * 0.085 + n.y * (k % 2 ? 0.02 : 0) }, (top - 0.02) / 2 + 0.01, yaw);
            fold.castShadow = false;
          }
        }
        const rod = add(cyl(0.012, 0.012, o.widthM + 0.8, rodMat, 10), { x: mid.x + n.x * off, y: mid.y + n.y * off }, top + 0.03);
        // Along the wall: turned to face the room (Y), then laid on its side (local Z).
        rod.rotation.order = 'YXZ';
        rod.rotation.set(0, yaw, Math.PI / 2);
      }
    }
  }
  return group;
}

export function disposeDecor(group: THREE.Group) {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const m = mesh.material as THREE.MeshStandardMaterial | undefined;
    if (m) { m.map?.dispose(); m.dispose(); }
  });
  group.removeFromParent();
}
