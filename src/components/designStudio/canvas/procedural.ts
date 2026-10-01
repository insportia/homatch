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
//
// LIVING PARTS. Everything a piece can do in the walkthrough is DECLARED
// here and performed by the living engine (livingRuntime.ts): each moving
// part is a group named `ix:<id>` whose origin is where it moves from (a
// hinge, a drawer's closed position, a curtain's outer end), and the
// builder returns the matching InteractionSpecs in
// `group.userData.interactions` — doors and drawers, switches with their
// light, screen, heat, water and steam, small state machines (a bed made or
// slept in, coffee brewed and drunk, a steak cooked and served) and seats.
// Cupboards are hollow, with shelves, so opening one shows an inside.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { applyFinish, patternOfSlot } from './finishTextures.ts';
import { curvedSofa, foliage, frameLounge, pot, roundTable, screenOnStand, shellChair, shellLounge } from './proceduralForms.ts';
import type { CatalogAsset, ProceduralKind } from '@/lib/designStudio/catalog';
import type { InteractionSpec } from '@/lib/designStudio/interactions';

export type SlotColors = Record<string, string>;

function material(color: string, roughness = 0.8, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

/** The texture budget of the current quality tier (set once by the scene). */
let FINISH_SIZE = 512;
let FINISH_ANISO = 1;
export function setFinishBudget(size: number, anisotropy = 1) {
  FINISH_SIZE = size;
  FINISH_ANISO = anisotropy;
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

/**
 * A box sitting on (x, y0, z) with its size — y0 is the bottom. Real things
 * have no razor edges: anything thicker than a centimetre gets a small bevel
 * (one segment, so a cabinet stays cheap).
 */
function box(w: number, h: number, d: number, x: number, y0: number, z: number, mat: THREE.Material) {
  const t = Math.min(w, h, d);
  const geometry = t >= 0.012 ? new RoundedBoxGeometry(w, h, d, 1, Math.min(0.008, t * 0.25)) : new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(x, y0 + h / 2, z);
  return mesh;
}

/** An upholstered volume: generously rounded, so cushions, arms and mattresses read as soft. */
function soft(w: number, h: number, d: number, x: number, y0: number, z: number, mat: THREE.Material, radius = 0.06) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, Math.min(w, h, d) * 0.45)), mat);
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

/** An open-fronted box: back, sides, top and bottom panels, with shelves. */
function carcass(g: THREE.Group, W: number, H: number, D: number, y0: number, mat: THREE.Material, shelves: number, t = 0.018) {
  g.add(box(W, H, t, 0, y0, D / 2 - t / 2, mat)); // back
  g.add(box(t, H, D, -W / 2 + t / 2, y0, 0, mat));
  g.add(box(t, H, D, W / 2 - t / 2, y0, 0, mat));
  g.add(box(W, t, D, 0, y0, 0, mat));
  g.add(box(W, t, D, 0, y0 + H - t, 0, mat));
  for (let i = 1; i <= shelves; i += 1) g.add(box(W - 2 * t, t, D - t, 0, y0 + (i * H) / (shelves + 1), t / 2, mat));
}

/**
 * A hinged front: a group at the hinge (front edge, one side), the panel
 * hanging off it. `side` -1 hinges on the left (opens +angle), +1 on the right.
 */
function hingedFront(
  g: THREE.Group, specs: InteractionSpec[], id: string, role: InteractionSpec['role'],
  x0: number, w: number, y0: number, h: number, frontZ: number, side: -1 | 1, mat: THREE.Material, handle: THREE.Material,
) {
  const pivot = new THREE.Group();
  pivot.name = `ix:${id}`;
  pivot.position.set(side < 0 ? x0 - w / 2 : x0 + w / 2, 0, frontZ);
  const panel = box(w - 0.004, h, 0.02, side < 0 ? w / 2 : -w / 2, y0, -0.01, mat);
  pivot.add(panel);
  pivot.add(box(0.015, Math.min(0.25, h * 0.3), 0.02, side < 0 ? w - 0.05 : -(w - 0.05), y0 + h * 0.45, -0.03, handle));
  g.add(pivot);
  specs.push({ id, kind: 'HINGED', role, axis: 'y', open: side < 0 ? 1.65 : -1.65, durationMs: 650 });
}


/** A named part: a group whose origin is where it moves from. */
function part(g: THREE.Object3D, id: string, x = 0, y = 0, z = 0): THREE.Group {
  const p = new THREE.Group();
  p.name = `ix:${id}`;
  p.position.set(x, y, z);
  g.add(p);
  return p;
}

const WATER = '#cfe6f5';

/** A thin falling stream (origin at the spout, hanging down `len`). */
function stream(parent: THREE.Object3D, id: string, x: number, y: number, z: number, len: number) {
  const p = part(parent, id, x, y, z);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, len, 10), new THREE.MeshStandardMaterial({ color: WATER, roughness: 0.1, transparent: true, opacity: 0.7 }));
  m.position.y = -len / 2;
  m.castShadow = false;
  p.add(m);
  return p;
}

/** A soft column of steam, rising from its origin. */
function steam(parent: THREE.Object3D, id: string, x: number, y: number, z: number, h = 0.18, r = 0.04) {
  const p = part(parent, id, x, y, z);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.6, r, h, 12, 1, true), new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 1, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  m.position.y = h / 2;
  m.castShadow = false;
  p.add(m);
  return p;
}

/** A tap over a basin: spout, and the machine that runs it (on, off, a hand wash). */
function faucet(g: THREE.Group, specs: InteractionSpec[], id: string, x: number, topY: number, backZ: number, reach: number, basinDepth: number, metal: THREE.Material) {
  g.add(cylinder(0.015, 0.26, x, topY, backZ, metal, 12));
  g.add(box(0.03, 0.025, reach, x, topY + 0.24, backZ - reach / 2, metal));
  stream(g, `${id}-water`, x, topY + 0.235, backZ - reach + 0.01, 0.235 + basinDepth);
  specs.push({
    id, kind: 'STATES', role: 'FAUCET', durationMs: 350, initial: 'OFF',
    effects: [{ id: 'water', type: 'WATER', part: `${id}-water`, color: WATER, intensity: 1 }],
    states: [
      { id: 'OFF', effects: { water: 0 } },
      { id: 'ON', effects: { water: 1 } },
      { id: 'WASHING', effects: { water: 1 }, auto: { to: 'OFF', afterMs: 3500 } },
    ],
    transitions: [
      { from: 'OFF', to: 'ON', action: 'TURN_ON' },
      { from: 'OFF', to: 'WASHING', action: 'WASH_HANDS' },
      { from: 'ON', to: 'OFF', action: 'TURN_OFF' },
      { from: 'WASHING', to: 'OFF', action: 'TURN_OFF' },
    ],
  } as InteractionSpec);
}

/** Seats along a piece's width: eye height and how far back from the front. */
function seatsAlong(W: number, perSeat: number, eye: number, z: number, pitch = -0.08): InteractionSpec {
  const n = Math.max(1, Math.round(W / perSeat));
  return {
    id: 'seat', kind: 'SEAT', role: 'SEAT', durationMs: 900,
    seats: Array.from({ length: n }, (_, i) => ({ posture: 'SIT' as const, x: n === 1 ? 0 : -W / 2 + (W / n) * (i + 0.5), y: eye, z, yaw: 0, pitch })),
  };
}

/**
 * The boxes of a piece that never move, merged into one mesh per material:
 * a sofa of eight boxes draws as one or two, not eight. Moving parts
 * (`ix:` groups) and the parts inside them are left exactly as built.
 */
function mergeStatic(g: THREE.Group) {
  const groups = new Map<string, THREE.Mesh[]>();
  for (const child of g.children) {
    const m = child as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) continue;
    const key = `${(m.material as THREE.Material).uuid}|${m.geometry.index ? 1 : 0}`;
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = list.map((m) => { m.updateMatrix(); return m.geometry.clone().applyMatrix4(m.matrix); });
    const merged = mergeGeometries(geos, false);
    geos.forEach((x) => x.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, list[0].material);
    for (const m of list) { g.remove(m); m.geometry.dispose(); }
    g.add(mesh);
  }
}

/** `form` is what a picture showed beyond the kind (objectShape.ts): a curved sofa, a shell chair, a round table. */
export function buildProcedural(kind: ProceduralKind, asset: CatalogAsset, colors: SlotColors, form: string | null = null): THREE.Group {
  const g = new THREE.Group();
  const specs: InteractionSpec[] = [];
  const handleMat = material('#8a8d92', 0.35, 0.6);
  const W = asset.widthM;
  const D = asset.depthM;
  const H = asset.heightM;
  const c = (slot: string, fallback: string) => colors[slot] ?? fallback;
  const slot = (id: string) => asset.materialSlots.find((s) => s.id === id);
  // One material per slot per piece: every box of the body shares it (fewer state changes, and mergeable).
  const slotMats = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (id: string, fallback: string) => {
    const key = `${id}|${fallback}`;
    let m = slotMats.get(key);
    if (!m) {
      const color = c(id, fallback);
      const metal = slot(id)?.metalness ?? 0;
      m = material(color, slot(id)?.roughness ?? 0.8, metal);
      // What the slot is made of (fabric, wood…), from the kind and slot — never a per-asset table.
      const pattern = patternOfSlot(kind, id, color, metal);
      if (pattern) applyFinish(m, pattern, FINISH_SIZE, false, FINISH_ANISO);
      slotMats.set(key, m);
    }
    return m;
  };
  const chrome = material('#c9ccd0', 0.2, 0.9);

  switch (kind) {
    case 'SOFA': {
      if (form === 'CURVED' || form === 'ROUNDED') {
        curvedSofa(g, W, D, H, mat('body', '#cfc6b8'), mat('cushion', '#c9c4bc'));
        specs.push(seatsAlong(W - 0.4, 0.7, 1.12, 0.05));
        break;
      }
      const body = mat('body', '#cfc6b8');
      const leg = mat('legs', '#3b3128');
      const seatH = 0.42;
      const arm = Math.min(0.18, W * 0.09);
      legs(g, W, D, 0.08, 0.08, leg);
      g.add(soft(W, 0.2, D, 0, 0.08, 0, body, 0.03)); // frame
      g.add(soft(W, H - 0.26, 0.16, 0, 0.26, D / 2 - 0.08, body, 0.05)); // back frame (rear = +z)
      g.add(soft(arm, seatH + 0.2 - 0.08, D, -W / 2 + arm / 2, 0.08, 0, body, 0.07)); // arms
      g.add(soft(arm, seatH + 0.2 - 0.08, D, W / 2 - arm / 2, 0.08, 0, body, 0.07));
      // Seat and back cushions, one per seat: separate soft forms, so it reads as a sofa.
      const n = W > 2 ? 3 : 2;
      const cw = (W - 2 * arm) / n;
      for (let i = 0; i < n; i += 1) {
        const x = -W / 2 + arm + cw * (i + 0.5);
        g.add(soft(cw - 0.012, seatH - 0.28, D - 0.2, x, 0.28, -0.04, body, 0.06));
        g.add(soft(cw - 0.02, Math.max(0.2, H - seatH - 0.04), 0.18, x, seatH, D / 2 - 0.24, body, 0.07));
      }
      specs.push(seatsAlong(W - 0.36, 0.7, 1.12, 0.05));
      break;
    }
    case 'ARMCHAIR': {
      if (form === 'SHELL' || form === 'ROUNDED' || form === 'CURVED') {
        shellLounge(g, W, D, H, mat('body', '#b9a58a'), mat('legs', '#5b4432'));
        specs.push(seatsAlong(W, 1, 1.05, 0.02));
        break;
      }
      if (form === 'STRAIGHT' && colors.legs && colors.legs !== slot('legs')?.defaultColor) {
        frameLounge(g, W, D, H, mat('body', '#b9a58a'), mat('legs', '#5b4432'));
        specs.push(seatsAlong(W, 1, 1.05, 0.02));
        break;
      }
      const body = mat('body', '#b9a58a');
      legs(g, W, D, 0.12, 0.08, mat('legs', '#5b4432'));
      g.add(soft(W - 0.02, 0.3, D, 0, 0.12, 0, body, 0.07));
      g.add(soft(W - 0.3, H - 0.42, 0.16, 0, 0.42, D / 2 - 0.08, body, 0.07));
      g.add(soft(0.14, 0.2, D, -W / 2 + 0.07, 0.42, 0, body, 0.06));
      g.add(soft(0.14, 0.2, D, W / 2 - 0.07, 0.42, 0, body, 0.06));
      specs.push(seatsAlong(W, 1, 1.12, 0.02));
      break;
    }
    case 'RECLINER': {
      const body = mat('body', '#8c7560');
      g.add(box(W, 0.3, D * 0.8, 0, 0.12, D * 0.1, body));
      g.add(box(W, 0.12, D * 0.8, 0, 0, D * 0.1, mat('legs', '#3b3128')));
      g.add(box(0.14, 0.24, D * 0.8, -W / 2 + 0.07, 0.42, D * 0.1, body));
      g.add(box(0.14, 0.24, D * 0.8, W / 2 - 0.07, 0.42, D * 0.1, body));
      // The back leans from the rear of the seat; the footrest unfolds from its front.
      const back = part(g, 'back', 0, 0.42, D / 2 - 0.06);
      back.add(box(W - 0.3, H - 0.42, 0.16, 0, 0, -0.02, body));
      const foot = part(g, 'footrest', 0, 0.38, -D * 0.3);
      foot.add(box(W - 0.32, 0.34, 0.08, 0, -0.34, -0.04, body));
      specs.push({
        id: 'recline', kind: 'STATES', role: 'RECLINER', durationMs: 1100, initial: 'UPRIGHT',
        states: [
          { id: 'UPRIGHT', parts: { back: { r: [0, 0, 0] }, footrest: { r: [0, 0, 0] } } },
          { id: 'RECLINED', parts: { back: { r: [0.45, 0, 0] }, footrest: { r: [1.45, 0, 0] } } },
        ],
        transitions: [{ from: 'UPRIGHT', to: 'RECLINED', action: 'RECLINE' }, { from: 'RECLINED', to: 'UPRIGHT', action: 'SIT_UP' }],
      } as InteractionSpec);
      specs.push(seatsAlong(W, 1, 1.08, 0.05));
      break;
    }
    case 'TABLE': {
      legs(g, W, D, H - 0.04, 0.06, mat('legs', '#6d5238'), 0.045);
      g.add(box(W, 0.04, D, 0, H - 0.04, 0, mat('top', '#9c7a55')));
      break;
    }
    case 'ROUND_TABLE': {
      if (form === 'ROUND' || form === 'OVAL') {
        roundTable(g, W, D, H, mat('top', '#e6e2dc'), mat('legs', H < 0.55 ? '#e6e2dc' : '#e6e2dc'));
        break;
      }
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
    case 'TV_UNIT': {
      if (H > 0.9) {
        // A screen on its own stand, not a console.
        const stand = screenOnStand(g, W, D, H, material('#111214', 0.4, 0.3));
        const screen = part(g, 'screen');
        screen.add(stand.panel);
        specs.push({ id: 'tv', kind: 'SWITCH', role: 'TV', durationMs: 450, effects: [{ id: 'picture', type: 'SCREEN', part: 'screen', color: '#ffffff', intensity: 1.1 }] });
        break;
      }
      // A low console on slim legs: separate fronts with shadow reveals, a top that overhangs.
      const body = mat('body', '#8e6f50');
      const legM = mat('legs', '#2a2a2a');
      const lift = 0.1;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.03, lift, 0.03, sx * (W / 2 - 0.06), 0, sz * (D / 2 - 0.06), legM));
      g.add(box(W - 0.02, H - lift - 0.025, D - 0.02, 0, lift, 0.005, body));
      g.add(box(W, 0.025, D, 0, H - 0.025, 0, body)); // top
      const reveal = material('#141414', 0.9);
      const fronts = Math.max(2, Math.round(W / 0.55));
      for (let i = 1; i < fronts; i += 1) g.add(box(0.006, H - lift - 0.05, 0.004, -W / 2 + (W * i) / fronts, lift + 0.012, -D / 2 + 0.008, reveal));
      g.add(box(W - 0.04, 0.006, 0.004, 0, lift + 0.012, -D / 2 + 0.008, reveal));
      // A screen standing on the unit, sized to it (never wider than 1.45 m).
      const sw = Math.min(1.45, W * 0.78);
      const sh = sw * 0.5625;
      const black = material('#111214', 0.4, 0.3);
      g.add(box(0.28, 0.02, 0.2, 0, H, 0, black)); // foot
      g.add(box(0.06, 0.1, 0.04, 0, H + 0.02, 0.02, black)); // neck
      g.add(box(sw + 0.02, sh + 0.02, 0.035, 0, H + 0.1, 0, black)); // bezel
      const screen = part(g, 'screen');
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshStandardMaterial({ color: '#0b0c0e', roughness: 0.25, metalness: 0.1 }));
      panel.position.set(0, H + 0.11 + sh / 2, -0.019);
      panel.rotation.y = Math.PI; // faces the room (local -z)
      screen.add(panel);
      specs.push({ id: 'tv', kind: 'SWITCH', role: 'TV', durationMs: 450, effects: [{ id: 'picture', type: 'SCREEN', part: 'screen', color: '#ffffff', intensity: 1.1 }] });
      break;
    }
    case 'WARDROBE': {
      const body = mat('body', '#ebe7e0');
      carcass(g, W, H, D - 0.02, 0, body, 3);
      g.add(cylinder(0.012, W - 0.04, 0, H * 0.78, 0.02, handleMat).rotateZ(Math.PI / 2)); // hanging rail
      const doors = Math.max(2, Math.round(W / 0.6));
      const w = W / doors;
      for (let i = 0; i < doors; i += 1) {
        const x0 = -W / 2 + w * (i + 0.5);
        hingedFront(g, specs, `door-${i + 1}`, 'WARDROBE', x0, w, 0.01, H - 0.02, -D / 2 + 0.01, i % 2 === 0 ? -1 : 1, body, handleMat);
      }
      break;
    }
    case 'DRESSER': {
      const body = mat('body', '#8e6f50');
      carcass(g, W, H, D - 0.02, 0, body, 0);
      const count = Math.max(2, Math.min(4, Math.round(H / 0.2)));
      const h = (H - 0.04) / count;
      for (let i = 0; i < count; i += 1) {
        const p = part(g, `drawer-${i + 1}`);
        const y0 = 0.02 + i * h;
        p.add(box(W - 0.04, h - 0.01, 0.02, 0, y0, -D / 2 + 0.01, body)); // front
        p.add(box(W - 0.08, 0.012, D - 0.1, 0, y0 + 0.02, 0, body)); // tray
        p.add(box(W - 0.08, h * 0.6, 0.012, 0, y0 + 0.02, D / 2 - 0.08, body)); // back of the drawer
        p.add(box(Math.min(0.2, W * 0.3), 0.015, 0.02, 0, y0 + h * 0.55, -D / 2 - 0.01, handleMat));
        specs.push({ id: `drawer-${i + 1}`, kind: 'SLIDING', role: 'DRAWER', axis: 'z', open: -Math.min(0.4, D * 0.7), durationMs: 500 });
      }
      // A bedside table carries a small lamp.
      if (asset.subcategory === 'BEDSIDE') {
        g.add(cylinder(0.06, 0.02, W * 0.22, H, D * 0.1, material('#2b2d31')));
        g.add(cylinder(0.008, 0.22, W * 0.22, H + 0.02, D * 0.1, material('#2b2d31'), 8));
        const shade = part(g, 'lamp', W * 0.22, H + 0.24, D * 0.1);
        shade.add(cylinder(0.1, 0.14, 0, 0, 0, material('#f1ebe0', 0.9)));
        specs.push({ id: 'lamp', kind: 'SWITCH', role: 'LAMP', durationMs: 300, effects: [{ id: 'light', type: 'LIGHT', part: 'lamp', color: '#ffd6a0', intensity: 1.6, distance: 3.5 }] });
      }
      break;
    }
    case 'FRIDGE': {
      const body = mat('body', '#e8e9ea');
      const inside = material('#f7f8f9', 0.9);
      inside.emissive = new THREE.Color(0xf2f6ff);
      inside.emissiveIntensity = 0.25;
      carcass(g, W, H, D - 0.04, 0, inside, 4, 0.03);
      g.add(box(W, H, 0.02, 0, 0, D / 2 - 0.01, body));
      // Refrigerator above, freezer below, each on its own hinge.
      const split = H * 0.36;
      hingedFront(g, specs, 'door', 'APPLIANCE', 0, W, split + 0.01, H - split - 0.03, -D / 2 + 0.02, 1, body, handleMat);
      hingedFront(g, specs, 'freezer', 'FREEZER', 0, W, 0.02, split - 0.02, -D / 2 + 0.02, 1, body, handleMat);
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
      // A made bed as a picture shows one: an oak frame, a white mattress, a
      // duvet in the bedding's colour draped over the sides, a folded sheet at
      // the head, a throw across the foot, sleep pillows and cushions, and an
      // upholstered headboard.
      const frame = mat('body', '#a88b6c');
      const linenColor = c('linen', '#efeae2');
      const linen = mat('linen', '#efeae2');
      const lin = new THREE.Color(linenColor);
      const white = material('#f4f3f0', 0.92);
      const lightLinen = lin.getHSL({ h: 0, s: 0, l: 0 }).l > 0.82;
      const throwMat = material(`#${lin.clone().lerp(new THREE.Color('#6d7176'), 0.38).getHexString()}`, 0.95);
      applyFinish(throwMat, 'FABRIC', FINISH_SIZE, false, FINISH_ANISO);
      const head = material(`#${lin.clone().lerp(new THREE.Color('#a3a6aa'), 0.3).getHexString()}`, 0.9);
      applyFinish(head, 'FABRIC', FINISH_SIZE, false, FINISH_ANISO);
      const top = 0.55; // mattress top
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.05, 0.08, 0.05, sx * (W / 2 - 0.06), 0, sz * (D / 2 - 0.12), frame));
      g.add(soft(W, 0.24, D - 0.08, 0, 0.08, -0.04, frame, 0.02)); // frame
      g.add(soft(W - 0.08, top - 0.33, D - 0.2, 0, 0.33, -0.06, white, 0.05)); // mattress
      g.add(soft(W + 0.02, Math.min(H - 0.1, 0.62), 0.09, 0, top - 0.12, D / 2 - 0.045, head, 0.04)); // upholstered headboard
      // The duvet and pillows are parts: a bed can be made, or slept in.
      const duvetD = (D - 0.2) * 0.74;
      const duvet = part(g, 'duvet', 0, top, -0.06 - (D - 0.2) * 0.13);
      duvet.add(soft(W + 0.04, 0.08, duvetD, 0, 0, 0, linen, 0.04));
      for (const sx of [-1, 1]) duvet.add(soft(0.04, 0.2, duvetD, sx * (W / 2 + 0.01), -0.17, 0, linen, 0.018)); // over the sides
      duvet.add(soft(W + 0.05, 0.1, 0.24, 0, 0.005, duvetD / 2 - 0.1, lightLinen ? linen : white, 0.04)); // folded sheet
      duvet.add(soft(W + 0.08, 0.04, Math.min(0.55, duvetD * 0.38), 0, 0.075, -duvetD / 2 + Math.min(0.55, duvetD * 0.38) / 2, throwMat, 0.02)); // throw
      const pillows = W > 1.2 ? 2 : 1;
      const pillowParts: string[] = [];
      const pw = Math.min(0.62, W / pillows - 0.08);
      for (let i = 0; i < pillows; i += 1) {
        const x = pillows === 1 ? 0 : (i === 0 ? -1 : 1) * (W / 4);
        const p = part(g, `pillow-${i + 1}`, x, top, D / 2 - 0.28);
        const pillow = soft(pw, 0.13, 0.38, 0, 0, 0, white, 0.06);
        pillow.rotation.x = -0.18;
        p.add(pillow);
        // A cushion in front of it, leaning back.
        const cushion = soft(pw * 0.62, 0.3, 0.1, 0, 0.06, -0.24, lightLinen ? throwMat : linen, 0.05);
        cushion.rotation.x = -0.42;
        p.add(cushion);
        pillowParts.push(`pillow-${i + 1}`);
      }
      const messy: Record<string, { p?: [number, number, number]; r?: [number, number, number]; s?: [number, number, number] }> = {
        duvet: { p: [W * 0.08, 0.03, -0.12], r: [0.05, 0.22, 0.06], s: [0.92, 1.9, 0.8] },
      };
      pillowParts.forEach((id, i) => { messy[id] = { p: [(i ? -1 : 1) * 0.06, 0.02, -0.08 - i * 0.05], r: [0.12, (i ? -1 : 1) * 0.35, 0.18] }; });
      const made: Record<string, { p: [number, number, number]; r: [number, number, number]; s: [number, number, number] }> = {};
      for (const id of ['duvet', ...pillowParts]) made[id] = { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };
      specs.push({
        id: 'bedding', kind: 'STATES', role: 'BED', durationMs: 900, initial: 'MADE',
        states: [{ id: 'MADE', parts: made }, { id: 'MESSY', parts: messy }],
        transitions: [{ from: 'MADE', to: 'MESSY', action: 'MESS_BED' }, { from: 'MESSY', to: 'MADE', action: 'MAKE_BED' }],
      } as InteractionSpec);
      specs.push({
        id: 'rest', kind: 'SEAT', role: 'BED', durationMs: 1200,
        seats: [
          // Sitting on the edge, looking out into the room; lying back, looking along the bed.
          { posture: 'SIT', x: W / 2 - 0.18, y: 1.08, z: -D * 0.1, yaw: -Math.PI / 2, pitch: -0.05 },
          { posture: 'LIE', x: pillows === 2 ? W / 4 : 0, y: 0.78, z: D / 2 - 0.5, yaw: 0, pitch: 0.42 },
        ],
      });
      break;
    }
    case 'RUG': {
      g.add(box(W, Math.max(0.008, H), D, 0, 0, 0, mat('body', '#d9cfbf')));
      break;
    }
    case 'LAMP': {
      g.add(cylinder(Math.min(W, D) * 0.35, 0.03, 0, 0, 0, mat('body', '#2b2d31')));
      g.add(cylinder(0.012, H - 0.3, 0, 0.03, 0, mat('body', '#2b2d31'), 10));
      const shade = part(g, 'shade', 0, H - 0.3, 0);
      shade.add(cylinder(Math.min(W, D) * 0.45, 0.28, 0, 0, 0, mat('shade', '#f1ebe0')));
      specs.push({ id: 'lamp', kind: 'SWITCH', role: 'LAMP', durationMs: 300, effects: [{ id: 'light', type: 'LIGHT', part: 'shade', color: '#ffd9a8', intensity: 2.6, distance: 5 }] });
      break;
    }
    case 'PLANT':
    case 'PLANTER': {
      // Leaves, not a blob: a crown of individual leaves on stems over the pot.
      const leafColor = c('leaves', '#56724a');
      if (kind === 'PLANTER' && W > D * 1.6) {
        const boxH = Math.min(0.5, H * 0.45);
        g.add(box(W, boxH, D, 0, 0, 0, mat('pot', '#b8735a')));
        g.add(foliage(W, H - boxH + 0.08, D * 1.2, boxH - 0.08, leafColor, { spread: 'ROW', leaf: Math.min(0.16, D * 0.35), count: Math.round(60 + W * 70) }));
        break;
      }
      const potH = kind === 'PLANTER' ? H * 0.5 : Math.min(0.42, H * 0.3);
      const r = Math.min(W, D) * (kind === 'PLANTER' ? 0.42 : 0.3);
      g.add(pot(r, potH, mat('pot', '#c8b8a2')));
      g.add(foliage(W, H - potH, D, potH - 0.04, leafColor));
      break;
    }
    case 'CHAIR': {
      if (form === 'SHELL') {
        shellChair(g, W, D, H, mat('body', '#a4845f'), mat('legs', '#c49a6c'));
        specs.push(seatsAlong(W, 1, 1.18, 0.02));
        break;
      }
      // A chair, not a box: slim tapered legs, a moulded seat and a rounded backrest.
      const body = mat('body', '#a4845f');
      const leg = mat('legs', '#3b3128');
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.019, 0.42, 10), leg);
        l.position.set(sx * (W / 2 - 0.05), 0.21, sz * (D / 2 - 0.05));
        l.rotation.set(sz * 0.05, 0, -sx * 0.05); // splayed a little, like a real chair
        g.add(l);
      }
      g.add(box(W - 0.04, 0.025, D - 0.04, 0, 0.405, 0, leg)); // seat frame
      g.add(soft(W, 0.06, D - 0.02, 0, 0.42, -0.01, body, 0.025)); // seat
      g.add(soft(W - 0.02, Math.max(0.18, H - 0.56), 0.05, 0, 0.56, D / 2 - 0.04, body, 0.022)); // backrest
      for (const sx of [-1, 1]) g.add(box(0.025, 0.14, 0.025, sx * (W / 2 - 0.06), 0.44, D / 2 - 0.05, leg)); // back posts
      specs.push(seatsAlong(W, 1, 1.18, 0.02));
      break;
    }
    case 'STOOL': {
      const body = mat('body', '#2b2d31');
      legs(g, W * 0.8, D * 0.8, H - 0.04, 0.04, body, 0.025);
      g.add(cylinder(Math.min(W, D) / 2, 0.04, 0, H - 0.04, 0, body));
      specs.push(seatsAlong(W, 1, H + 0.72, 0, -0.12));
      break;
    }
    case 'KITCHEN_RUN':
    case 'VANITY': {
      const body = mat('body', '#eeebe5');
      const top = mat('top', '#d7d2ca');
      g.add(box(W, 0.1, D - 0.06, 0, 0, 0.03, material('#2a2a2a', 0.9)));
      const carcassGroup = new THREE.Group();
      carcass(carcassGroup, W, H - 0.14, D - 0.04, 0.1, body, 1);
      g.add(carcassGroup);
      g.add(box(W, 0.04, D, 0, H - 0.04, 0, top));
      const fronts = Math.max(1, Math.round(W / 0.6));
      const w = W / fronts;
      const frontZ = -D / 2 + 0.02;
      const x0 = (i: number) => -W / 2 + w * (i + 0.5);
      if (kind === 'VANITY' || asset.subcategory === 'ISLAND') {
        if (kind !== 'VANITY') {
          // An island is cupboards under a worktop; the run beside it carries the appliances.
          for (let i = 0; i < fronts; i += 1) hingedFront(g, specs, `door-${i + 1}`, 'CABINET', x0(i), w, 0.11, H - 0.17, frontZ, i % 2 === 0 ? -1 : 1, body, handleMat);
          break;
        }
        for (let i = 0; i < fronts; i += 1) hingedFront(g, specs, `door-${i + 1}`, 'CABINET', x0(i), w, 0.11, H - 0.17, frontZ, i % 2 === 0 ? -1 : 1, body, handleMat);
        // Basin, tap, and a lit mirror above.
        g.add(box(Math.min(0.5, W * 0.7), 0.012, D * 0.55, 0, H - 0.005, -0.02, material('#f7f7f5', 0.3)));
        faucet(g, specs, 'tap', 0, H, D / 2 - 0.08, D * 0.35, 0.02, chrome);
        const mirror = part(g, 'mirror', 0, H + 0.35, D / 2 - 0.02);
        mirror.add(box(Math.min(0.9, W), 0.7, 0.025, 0, 0, 0, material('#dfe6ea', 0.05, 0.6)));
        specs.push({ id: 'mirror-light', kind: 'SWITCH', role: 'MIRROR', durationMs: 300, effects: [{ id: 'glow', type: 'LIGHT', part: 'mirror', color: '#fff4e6', intensity: 1.4, distance: 3 }] });
        break;
      }
      // A kitchen: sink by the window end, dishwasher beside it, hob and oven
      // toward the other end, a coffee machine on the last counter.
      const sinkAt = fronts >= 2 ? 1 : -1;
      const dishAt = fronts >= 4 ? 2 : -1;
      const ovenAt = fronts >= 3 ? fronts - 2 : -1;
      const coffeeAt = fronts >= 2 ? fronts - 1 : -1;
      let door = 0;
      for (let i = 0; i < fronts; i += 1) {
        if (i === ovenAt || i === dishAt) {
          // A door hinged at its foot, folding down toward the room.
          const id = i === ovenAt ? 'oven' : 'dishwasher';
          const pivot = part(g, id, x0(i), 0.12, frontZ);
          const face = i === ovenAt ? material('#2a2c30', 0.3, 0.4) : material('#c7cacd', 0.35, 0.7);
          pivot.add(box(w - 0.01, H - 0.2, 0.025, 0, 0, -0.012, face));
          pivot.add(box(w * 0.7, 0.02, 0.025, 0, H - 0.3, -0.04, handleMat));
          if (i === ovenAt) g.add(box(w - 0.08, H - 0.3, D - 0.12, x0(i), 0.16, 0.02, material('#18191b', 0.8))); // the oven's inside
          specs.push({ id, kind: 'HINGED', role: i === ovenAt ? 'OVEN' : 'DISHWASHER', axis: 'x', open: -1.45, durationMs: 800 });
          continue;
        }
        door += 1;
        hingedFront(g, specs, `door-${door}`, 'CABINET', x0(i), w, 0.11, H - 0.17, frontZ, i % 2 === 0 ? -1 : 1, body, handleMat);
      }
      if (sinkAt >= 0) {
        g.add(box(Math.min(0.5, w - 0.08), 0.012, D * 0.55, x0(sinkAt), H - 0.005, -0.02, material('#b8bcc0', 0.25, 0.8)));
        faucet(g, specs, 'tap', x0(sinkAt), H, D / 2 - 0.08, D * 0.35, 0.02, chrome);
      }
      if (ovenAt >= 0) {
        // The hob: two rings — one for the stove switch, one under the pan.
        const hx = x0(ovenAt);
        g.add(box(w - 0.06, 0.008, D * 0.7, hx, H, -0.02, material('#131416', 0.15, 0.3)));
        const ringMat = () => material('#3a3c40', 0.5);
        const left = part(g, 'burner-l', hx - w * 0.2, H + 0.009, -0.02);
        left.add(new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 6, 32), ringMat()).rotateX(Math.PI / 2));
        const right = part(g, 'burner-r', hx + w * 0.2, H + 0.009, -0.02);
        right.add(new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.008, 6, 32), ringMat()).rotateX(Math.PI / 2));
        specs.push({ id: 'stove', kind: 'SWITCH', role: 'STOVE', durationMs: 900, effects: [{ id: 'heat', type: 'HEAT', part: 'burner-l', color: '#ff4a1c', intensity: 2.2 }] });
        // A pan on the right ring; a steak appears in it when cooking starts.
        g.add(cylinder(0.11, 0.035, hx + w * 0.2, H + 0.012, -0.02, material('#2b2d31', 0.4, 0.6), 24));
        g.add(box(0.2, 0.012, 0.025, hx + w * 0.2 + 0.2, H + 0.035, -0.02, material('#2b2d31', 0.4, 0.6)));
        const plateX = coffeeAt >= 0 ? x0(coffeeAt) - w * 0.2 : hx - w * 0.2;
        g.add(cylinder(0.12, 0.012, plateX, H, D * 0.12, material('#f4f2ee', 0.3), 28));
        const steak = part(g, 'steak', hx + w * 0.2, H + 0.05, -0.02);
        const meat = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.025, 18), material('#b5524a', 0.7));
        meat.scale.set(1.25, 1, 0.85);
        steak.add(meat);
        steam(g, 'pan-steam', hx + w * 0.2, H + 0.07, -0.02, 0.22, 0.06);
        const toPlate: [number, number, number] = [plateX - (hx + w * 0.2), -0.03, D * 0.12 + 0.02];
        specs.push({
          id: 'cook', kind: 'STATES', role: 'STOVE', durationMs: 600, initial: 'IDLE',
          effects: [
            { id: 'heat', type: 'HEAT', part: 'burner-r', color: '#ff4a1c', intensity: 2.2 },
            { id: 'sizzle', type: 'STEAM', part: 'pan-steam', color: '#f4f6f8', intensity: 1 },
          ],
          states: [
            { id: 'IDLE', parts: { steak: { s: [0, 0, 0] } }, effects: { heat: 0, sizzle: 0 } },
            { id: 'SEARING', parts: { steak: { s: [1, 1, 1], tint: '#b5524a' } }, effects: { heat: 1, sizzle: 0.4 }, enterMs: 450, auto: { to: 'COOKING', afterMs: 0 } },
            { id: 'COOKING', parts: { steak: { s: [1, 1, 1], tint: '#6e3a20' } }, effects: { heat: 1, sizzle: 1 }, enterMs: 5200, auto: { to: 'DONE', afterMs: 0 } },
            { id: 'DONE', parts: { steak: { s: [1, 1, 1], tint: '#6e3a20' } }, effects: { heat: 0, sizzle: 0.2 }, enterMs: 800 },
            { id: 'SERVED', parts: { steak: { p: toPlate, s: [1, 1, 1], tint: '#6e3a20' } }, effects: { heat: 0, sizzle: 0 }, enterMs: 900 },
          ],
          transitions: [
            { from: 'IDLE', to: 'SEARING', action: 'COOK' },
            { from: 'DONE', to: 'SERVED', action: 'SERVE' },
            { from: 'SERVED', to: 'SEARING', action: 'COOK' },
          ],
        } as InteractionSpec);
      }
      if (coffeeAt >= 0) {
        // A coffee machine with a cup under its spout.
        const cx = x0(coffeeAt) + w * 0.18;
        const cz = D / 2 - 0.2;
        const dark = material('#26272a', 0.35, 0.4);
        g.add(box(0.22, 0.34, 0.26, cx, H, cz, dark));
        g.add(box(0.2, 0.03, 0.12, cx, H + 0.28, cz - 0.17, dark)); // the head over the cup
        const led = part(g, 'coffee-led', cx + 0.08, H + 0.3, cz - 0.131);
        led.add(box(0.02, 0.02, 0.004, 0, 0, 0, material('#5a5d62', 0.4)));
        const cup = part(g, 'cup', cx, H + 0.02, cz - 0.17);
        cup.add(cylinder(0.035, 0.07, 0, 0, 0, material('#f4f2ee', 0.35), 20));
        const liquid = part(cup, 'coffee', 0, 0.012, 0);
        liquid.add(cylinder(0.03, 0.05, 0, 0, 0, material('#4a2c1a', 0.3), 16));
        steam(cup, 'coffee-steam', 0, 0.075, 0, 0.14, 0.025);
        specs.push({
          id: 'coffee', kind: 'STATES', role: 'COFFEE', durationMs: 700, initial: 'IDLE',
          effects: [
            { id: 'led', type: 'GLOW', part: 'coffee-led', color: '#ffb347', intensity: 2.5 },
            { id: 'steam', type: 'STEAM', part: 'coffee-steam', color: '#f4f6f8', intensity: 1 },
          ],
          states: [
            { id: 'IDLE', parts: { cup: { p: [0, 0, 0], r: [0, 0, 0] }, coffee: { s: [1, 0.02, 1] } }, effects: { led: 0, steam: 0 } },
            { id: 'BREWING', parts: { coffee: { s: [1, 1, 1] } }, effects: { led: 1, steam: 0.7 }, enterMs: 2800, auto: { to: 'READY', afterMs: 0 } },
            { id: 'READY', parts: { coffee: { s: [1, 1, 1] } }, effects: { led: 0, steam: 0.5 }, enterMs: 500 },
            { id: 'SIPPING', parts: { cup: { p: [0, 0.3, -0.34], r: [-0.55, 0, 0] }, coffee: { s: [1, 0.45, 1] } }, effects: { led: 0, steam: 0.2 }, enterMs: 1000, auto: { to: 'IDLE', afterMs: 700 } },
          ],
          transitions: [
            { from: 'IDLE', to: 'BREWING', action: 'MAKE_COFFEE' },
            { from: 'READY', to: 'SIPPING', action: 'DRINK' },
          ],
        } as InteractionSpec);
      }
      break;
    }
    case 'WASHER': {
      const body = mat('body', '#eceef0');
      g.add(box(W, H, D - 0.02, 0, 0, 0.01, body));
      g.add(box(W * 0.9, 0.12, 0.01, 0, H - 0.14, -D / 2 + 0.005, material('#d5d8db', 0.4))); // control panel
      // The round door, hinged on its left, over a dark drum.
      g.add(cylinder(W * 0.3, 0.02, 0, H * 0.45, -D / 2 + 0.01, material('#26282b', 0.6), 32).rotateX(Math.PI / 2));
      const door = part(g, 'door', -W * 0.34, H * 0.45, -D / 2 - 0.005);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(W * 0.3, 0.03, 10, 36), material('#b9bdc2', 0.3, 0.7));
      ring.position.set(W * 0.34, 0, 0);
      door.add(ring);
      const glassMat = material('#9fb3c2', 0.05, 0.2);
      glassMat.transparent = true;
      glassMat.opacity = 0.45;
      const pane = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.27, W * 0.27, 0.015, 32), glassMat);
      pane.rotation.x = Math.PI / 2;
      pane.position.set(W * 0.34, 0, 0);
      door.add(pane);
      specs.push({ id: 'door', kind: 'HINGED', role: 'WASHER', axis: 'y', open: 1.6, durationMs: 700 });
      break;
    }
    case 'SHOWER': {
      const glass = material('#d6e4ea', 0.05, 0.1);
      glass.transparent = true;
      glass.opacity = 0.25;
      g.add(box(W, 0.06, D, 0, 0, 0, material('#f2f2f0', 0.4))); // tray
      g.add(box(0.01, H, D, W / 2 - 0.005, 0.06, 0, glass)); // side panel
      g.add(box(W - 0.5, H, 0.01, -0.25, 0.06, -D / 2 + 0.005, glass)); // fixed front
      // The door: glass on a hinge at the end of the fixed panel.
      const door = part(g, 'door', W / 2 - 0.5, 0.06, -D / 2 + 0.005);
      door.add(box(0.48, H, 0.01, 0.24, 0, 0, glass));
      door.add(box(0.02, 0.25, 0.03, 0.44, H * 0.5, -0.02, chrome));
      specs.push({ id: 'door', kind: 'HINGED', role: 'SHOWER', axis: 'y', open: -1.4, durationMs: 800 });
      // The head, and rain falling from it.
      g.add(cylinder(0.012, 0.3, 0, H - 0.2, D / 2 - 0.05, chrome, 10));
      g.add(cylinder(0.11, 0.02, 0, H - 0.05, D / 2 - 0.2, chrome, 24));
      const rain = part(g, 'rain', 0, H - 0.06, D / 2 - 0.2);
      const rainMat = new THREE.MeshStandardMaterial({ color: WATER, roughness: 0.1, transparent: true, opacity: 0.45 });
      for (let i = 0; i < 9; i += 1) {
        const a = (i / 9) * Math.PI * 2;
        const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, H - 0.12, 5), rainMat);
        drop.position.set(Math.cos(a) * 0.07, -(H - 0.12) / 2, Math.sin(a) * 0.07);
        rain.add(drop);
      }
      steam(g, 'shower-steam', 0, 0.4, 0, H - 0.6, 0.35);
      specs.push({
        id: 'water', kind: 'SWITCH', role: 'SHOWER', durationMs: 600,
        effects: [
          { id: 'rain', type: 'WATER', part: 'rain', color: WATER, intensity: 1 },
          { id: 'steam', type: 'STEAM', part: 'shower-steam', color: '#f4f6f8', intensity: 1 },
        ],
      });
      break;
    }
    case 'TOILET': {
      const white = mat('body', '#f7f7f5');
      g.add(box(0.36, 0.38, 0.5, 0, 0, -0.05, white)); // bowl
      g.add(box(W, 0.4, 0.18, 0, 0.38, D / 2 - 0.09, white)); // tank
      g.add(box(0.36, 0.02, 0.46, 0, 0.38, -0.06, white)); // seat
      g.add(box(0.05, 0.015, 0.02, 0.1, 0.78, D / 2 - 0.09, chrome)); // flush button
      // The lid lifts from its hinge at the back; the flush is water, briefly, nothing more.
      const lid = part(g, 'lid', 0, 0.4, D / 2 - 0.19);
      lid.add(box(0.36, 0.02, 0.44, 0, 0, -0.22, white));
      specs.push({ id: 'lid', kind: 'HINGED', role: 'TOILET', axis: 'x', open: 1.5, durationMs: 700 });
      const swirl = part(g, 'swirl', 0, 0.3, -0.07);
      swirl.add(cylinder(0.12, 0.02, 0, 0, 0, new THREE.MeshStandardMaterial({ color: '#bcd9ea', roughness: 0.1, transparent: true, opacity: 0.6 }), 24));
      specs.push({ id: 'flush', kind: 'SWITCH', role: 'TOILET', durationMs: 500, autoOffMs: 2200, actions: { on: 'FLUSH' }, effects: [{ id: 'water', type: 'WATER', part: 'swirl', color: WATER, intensity: 1 }] });
      break;
    }
    case 'BATH': {
      const white = mat('body', '#f7f7f5');
      const t = 0.07;
      g.add(box(W, 0.1, D, 0, 0, 0, white));
      g.add(box(W, H - 0.1, t, 0, 0.1, -D / 2 + t / 2, white));
      g.add(box(W, H - 0.1, t, 0, 0.1, D / 2 - t / 2, white));
      g.add(box(t, H - 0.1, D, -W / 2 + t / 2, 0.1, 0, white));
      g.add(box(t, H - 0.1, D, W / 2 - t / 2, 0.1, 0, white));
      const water = part(g, 'bathwater', 0, 0.1, 0);
      const wm = new THREE.MeshStandardMaterial({ color: '#bcd9ea', roughness: 0.05, transparent: true, opacity: 0.55 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(W - 2 * t, H - 0.25, D - 2 * t), wm);
      body.position.y = (H - 0.25) / 2;
      water.add(body);
      g.add(cylinder(0.015, 0.14, W / 2 - 0.18, H, 0, chrome, 10));
      g.add(box(0.025, 0.025, 0.12, W / 2 - 0.18, H + 0.13, -0.06, chrome));
      stream(g, 'bath-tap', W / 2 - 0.18, H + 0.125, -0.11, H - 0.05);
      specs.push({
        id: 'bath', kind: 'STATES', role: 'BATH', durationMs: 600, initial: 'EMPTY',
        effects: [{ id: 'tap', type: 'WATER', part: 'bath-tap', color: WATER, intensity: 1 }],
        states: [
          { id: 'EMPTY', parts: { bathwater: { s: [1, 0.001, 1] } }, effects: { tap: 0 } },
          { id: 'FILLING', parts: { bathwater: { s: [1, 1, 1] } }, effects: { tap: 1 }, enterMs: 4500, auto: { to: 'FULL', afterMs: 0 } },
          { id: 'FULL', parts: { bathwater: { s: [1, 1, 1] } }, effects: { tap: 0 }, enterMs: 400 },
          { id: 'DRAINING', parts: { bathwater: { s: [1, 0.001, 1] } }, effects: { tap: 0 }, enterMs: 2600, auto: { to: 'EMPTY', afterMs: 0 } },
        ],
        transitions: [
          { from: 'EMPTY', to: 'FILLING', action: 'RUN_BATH' },
          { from: 'FULL', to: 'DRAINING', action: 'DRAIN' },
        ],
      } as InteractionSpec);
      break;
    }
    case 'CURTAIN': {
      const cloth = mat('body', '#e7e0d4');
      g.add(cylinder(0.012, W, 0, H - 0.03, 0, handleMat, 10).rotateZ(Math.PI / 2));
      // Each panel hangs from its outer end, so drawing it gathers it there.
      for (const side of [-1, 1] as const) {
        const panel = part(g, side < 0 ? 'panel-l' : 'panel-r', side * W / 2, 0.02, 0);
        const pw = W / 2;
        const folds = Math.max(3, Math.round(pw / 0.14));
        for (let i = 0; i < folds; i += 1) {
          const fx = -side * (pw / folds) * (i + 0.5);
          panel.add(box(pw / folds + 0.004, H - 0.07, 0.02, fx, 0, (i % 2 ? 0.018 : -0.018), cloth));
        }
      }
      specs.push({
        id: 'curtains', kind: 'STATES', role: 'CURTAIN', durationMs: 1300, initial: 'OPEN',
        states: [
          { id: 'OPEN', parts: { 'panel-l': { s: [0.26, 1, 1] }, 'panel-r': { s: [0.26, 1, 1] } } },
          { id: 'CLOSED', parts: { 'panel-l': { s: [1, 1, 1] }, 'panel-r': { s: [1, 1, 1] } } },
        ],
        transitions: [{ from: 'OPEN', to: 'CLOSED', action: 'CLOSE' }, { from: 'CLOSED', to: 'OPEN', action: 'OPEN' }],
      } as InteractionSpec);
      break;
    }
    case 'BLIND': {
      const cloth = mat('body', '#ece8e1');
      g.add(box(W, 0.08, 0.08, 0, H - 0.08, 0, material('#dcd8d2', 0.5)));
      const blind = part(g, 'blind', 0, H - 0.08, 0);
      const sheet = box(W - 0.04, H - 0.1, 0.01, 0, -(H - 0.1), 0, cloth);
      blind.add(sheet);
      blind.add(box(W - 0.02, 0.025, 0.02, 0, -(H - 0.1), 0, material('#bdb8b0', 0.5)));
      specs.push({
        id: 'blind', kind: 'STATES', role: 'BLIND', durationMs: 1500, initial: 'RAISED',
        states: [
          { id: 'RAISED', parts: { blind: { s: [1, 0.06, 1] } } },
          { id: 'LOWERED', parts: { blind: { s: [1, 1, 1] } } },
        ],
        transitions: [{ from: 'RAISED', to: 'LOWERED', action: 'LOWER' }, { from: 'LOWERED', to: 'RAISED', action: 'RAISE' }],
      } as InteractionSpec);
      break;
    }
    default:
      g.add(box(W, H, D, 0, 0, 0, material('#cccccc')));
  }
  mergeStatic(g);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat0 = m.material as THREE.Material;
    // Water, steam and glass cast no shadows; everything solid does.
    const solid = !mat0.transparent;
    m.castShadow = solid;
    m.receiveShadow = solid;
  });
  g.userData.interactions = specs;
  return g;
}
