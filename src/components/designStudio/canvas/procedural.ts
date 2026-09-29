// CONCEPT BLOCKS — HOMATCH's development furniture, drawn from dimensions.
//
// Each piece is a few boxes and cylinders at its catalogue size, in the
// colours of its material slots. They are honest stand-ins: massing and
// proportion, no brand, no invented detail. They exist so placement,
// collision, replacement, colour, versions and walkthrough can be proven
// before the licensed catalogue exists.
//
// Convention: origin at the centre of the footprint on the floor; the
// piece's FRONT faces local -z (plan +y), matching placement.ts.

import * as THREE from 'three';
import type { CatalogAsset, ProceduralKind } from '@/lib/designStudio/catalog';

export type SlotColors = Record<string, string>;

function material(color: string, roughness = 0.8, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

export function slotColors(asset: CatalogAsset, variant: string | null, override: string | null): SlotColors {
  const colors: SlotColors = {};
  for (const s of asset.materialSlots) colors[s.id] = s.defaultColor;
  const v = variant ? asset.variants.find((x) => x.id === variant) : null;
  if (v) Object.assign(colors, v.colors);
  // A colour override dresses the main slot (body / top / pot).
  if (override) {
    const main = asset.materialSlots.find((s) => s.id === 'body' || s.id === 'top' || s.id === 'pot')?.id ?? 'body';
    colors[main] = override;
  }
  return colors;
}

/** A box sitting on (x, y0, z) with its size — y0 is the bottom. */
function box(w: number, h: number, d: number, x: number, y0: number, z: number, mat: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y0 + h / 2, z);
  return mesh;
}

function cylinder(r: number, h: number, x: number, y0: number, z: number, mat: THREE.Material, segments = 20) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), mat);
  mesh.position.set(x, y0 + h / 2, z);
  return mesh;
}

function legs(g: THREE.Group, w: number, d: number, h: number, inset: number, mat: THREE.Material, t = 0.04) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(box(t, h, t, sx * (w / 2 - inset), 0, sz * (d / 2 - inset), mat));
  }
}

export function buildProcedural(kind: ProceduralKind, asset: CatalogAsset, colors: SlotColors): THREE.Group {
  const g = new THREE.Group();
  const W = asset.widthM;
  const D = asset.depthM;
  const H = asset.heightM;
  const c = (slot: string, fallback: string) => colors[slot] ?? fallback;
  const slot = (id: string) => asset.materialSlots.find((s) => s.id === id);
  const mat = (id: string, fallback: string) => material(c(id, fallback), slot(id)?.roughness ?? 0.8, slot(id)?.metalness ?? 0);

  switch (kind) {
    case 'SOFA': {
      const body = mat('body', '#cfc6b8');
      const leg = mat('legs', '#3b3128');
      const seatH = 0.42;
      legs(g, W, D, 0.08, 0.08, leg);
      g.add(box(W, seatH - 0.08, D, 0, 0.08, 0, body)); // base + seat
      g.add(box(W, H - seatH + 0.02, 0.2, 0, seatH - 0.02, D / 2 - 0.1, body)); // back (rear = +z)
      g.add(box(0.18, 0.2, D, -W / 2 + 0.09, seatH, 0, body)); // arms
      g.add(box(0.18, 0.2, D, W / 2 - 0.09, seatH, 0, body));
      // Seat cushion seams: three quiet lines.
      const seamMat = material(c('body', '#cfc6b8'), 1);
      seamMat.color.multiplyScalar(0.86);
      const n = W > 2 ? 3 : 2;
      for (let i = 1; i < n; i += 1) g.add(box(0.012, 0.02, D - 0.25, -W / 2 + 0.18 + ((W - 0.36) * i) / n, seatH, -0.1, seamMat));
      break;
    }
    case 'ARMCHAIR': {
      const body = mat('body', '#b9a58a');
      legs(g, W, D, 0.12, 0.08, mat('legs', '#5b4432'));
      g.add(box(W, 0.3, D, 0, 0.12, 0, body));
      g.add(box(W, H - 0.42, 0.16, 0, 0.42, D / 2 - 0.08, body));
      g.add(box(0.14, 0.2, D, -W / 2 + 0.07, 0.42, 0, body));
      g.add(box(0.14, 0.2, D, W / 2 - 0.07, 0.42, 0, body));
      break;
    }
    case 'TABLE': {
      legs(g, W, D, H - 0.04, 0.06, mat('legs', '#6d5238'), 0.045);
      g.add(box(W, 0.04, D, 0, H - 0.04, 0, mat('top', '#9c7a55')));
      break;
    }
    case 'ROUND_TABLE': {
      const r = Math.min(W, D) / 2;
      g.add(cylinder(0.05, H - 0.04, 0, 0, 0, mat('legs', '#6d5238')));
      g.add(cylinder(r * 0.45, 0.02, 0, 0, 0, mat('legs', '#6d5238')));
      g.add(cylinder(r, 0.04, 0, H - 0.04, 0, mat('top', '#e6e2dc'), 36));
      break;
    }
    case 'CABINET': {
      g.add(box(W, 0.06, D - 0.04, 0, 0, 0.0, mat('legs', '#2a2a2a')));
      g.add(box(W, H - 0.06, D, 0, 0.06, 0, mat('body', '#8e6f50')));
      break;
    }
    case 'WARDROBE': {
      const body = mat('body', '#ebe7e0');
      g.add(box(W, H, D, 0, 0, 0, body));
      const line = material(c('body', '#ebe7e0'), 1);
      line.color.multiplyScalar(0.8);
      const doors = Math.max(2, Math.round(W / 0.6));
      for (let i = 1; i < doors; i += 1) g.add(box(0.008, H - 0.1, 0.01, -W / 2 + (W * i) / doors, 0.05, -D / 2 - 0.004, line));
      break;
    }
    case 'SHELF': {
      const body = mat('body', '#a4845f');
      g.add(box(0.03, H, D, -W / 2 + 0.015, 0, 0, body));
      g.add(box(0.03, H, D, W / 2 - 0.015, 0, 0, body));
      g.add(box(W, H, 0.02, 0, 0, D / 2 - 0.01, body));
      const shelves = Math.max(3, Math.round(H / 0.38));
      for (let i = 0; i <= shelves; i += 1) g.add(box(W, 0.025, D, 0, (i * (H - 0.025)) / shelves, 0, body));
      break;
    }
    case 'BED': {
      const frame = mat('body', '#a88b6c');
      const linen = mat('linen', '#efeae2');
      g.add(box(W, 0.3, D - 0.08, 0, 0.05, -0.04, frame));
      g.add(box(W - 0.06, 0.22, D - 0.2, 0, 0.35, -0.08, linen)); // mattress
      g.add(box(W - 0.08, 0.05, (D - 0.2) * 0.62, 0, 0.57, -0.08 - (D - 0.2) * 0.19, linen)); // duvet fold
      g.add(box(W, H, 0.08, 0, 0, D / 2 - 0.04, frame)); // headboard at the rear
      const pillows = W > 1.2 ? 2 : 1;
      for (let i = 0; i < pillows; i += 1) {
        const x = pillows === 1 ? 0 : (i === 0 ? -1 : 1) * (W / 4);
        g.add(box(Math.min(0.6, W / pillows - 0.1), 0.1, 0.36, x, 0.57, D / 2 - 0.3, linen));
      }
      break;
    }
    case 'RUG': {
      g.add(box(W, Math.max(0.008, H), D, 0, 0, 0, mat('body', '#d9cfbf')));
      break;
    }
    case 'LAMP': {
      g.add(cylinder(Math.min(W, D) * 0.35, 0.03, 0, 0, 0, mat('body', '#2b2d31')));
      g.add(cylinder(0.012, H - 0.3, 0, 0.03, 0, mat('body', '#2b2d31'), 10));
      const shade = mat('shade', '#f1ebe0');
      shade.emissive = new THREE.Color(0xfff0d8);
      shade.emissiveIntensity = 0.15;
      g.add(cylinder(Math.min(W, D) * 0.45, 0.28, 0, H - 0.3, 0, shade));
      break;
    }
    case 'PLANT':
    case 'PLANTER': {
      const potH = kind === 'PLANTER' ? H * 0.55 : H * 0.28;
      g.add(cylinder(Math.min(W, D) * 0.38, potH, 0, 0, 0, mat('pot', '#c8b8a2')));
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.min(W, D) * 0.5, 1), mat('leaves', '#56724a'));
      leaves.scale.set(1, (H - potH) / Math.min(W, D), 1);
      leaves.position.set(0, potH + (H - potH) / 2, 0);
      g.add(leaves);
      break;
    }
    case 'CHAIR': {
      const body = mat('body', '#a4845f');
      legs(g, W, D, 0.44, 0.04, body, 0.035);
      g.add(box(W, 0.04, D, 0, 0.44, 0, body));
      g.add(box(W, H - 0.48, 0.04, 0, 0.48, D / 2 - 0.02, body));
      break;
    }
    case 'STOOL': {
      const body = mat('body', '#2b2d31');
      legs(g, W * 0.8, D * 0.8, H - 0.04, 0.04, body, 0.025);
      g.add(cylinder(Math.min(W, D) / 2, 0.04, 0, H - 0.04, 0, body));
      break;
    }
    case 'KITCHEN_RUN':
    case 'VANITY': {
      const body = mat('body', '#eeebe5');
      g.add(box(W, 0.1, D - 0.06, 0, 0, 0.03, material('#2a2a2a', 0.9)));
      g.add(box(W, H - 0.14, D - 0.02, 0, 0.1, 0.01, body));
      g.add(box(W, 0.04, D, 0, H - 0.04, 0, mat('top', '#d7d2ca')));
      const line = material(c('body', '#eeebe5'), 1);
      line.color.multiplyScalar(0.82);
      const fronts = Math.max(1, Math.round(W / 0.6));
      for (let i = 1; i < fronts; i += 1) g.add(box(0.006, H - 0.2, 0.01, -W / 2 + (W * i) / fronts, 0.12, -D / 2 - 0.004, line));
      break;
    }
    default:
      g.add(box(W, H, D, 0, 0, 0, material('#cccccc')));
  }
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
  });
  return g;
}
