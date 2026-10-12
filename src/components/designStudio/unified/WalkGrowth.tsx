// HOMATCH Design Studio — the home growing while its 3D tour is made: a living architectural model, never the same
// twice. Each home is born from one cell that divides into rooms (a random binary split of a random footprint), its
// floors bloom, its walls rise (a dollhouse cut, so the rooms show), its furniture settles in room by room, its lamps
// come on, the camera circles it slowly; then it sinks away and the next home grows. Warm motes drift through the light.
//
// Pure decoration (aria-hidden), lazy-loaded with three. Pauses while the tab is hidden; disposes everything on unmount.
// A browser with no WebGL calls onFail and the flat drawing stays (WalkWaiting.tsx).

import React from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const WALL_H = 1.15; // the dollhouse cut: low enough to see into every room
const WALL_T = 0.12;
const LIFE = 12; // seconds one home lives: grown by ~7 s, held, then it sinks away
const SINK_AT = 10.4;

const COLORS = {
  oak: '#c9a982', stone: '#d9d7d1', wall: '#f4f1ec', cap: '#2b2f36', sofa: '#c9c2b6', wood: '#9c7a55', walnut: '#8e6f50',
  rug: '#d9cfbf', white: '#f7f7f5', ink: '#202326', gold: '#E9B949', leaf: '#56724a', pot: '#b0896a', bed: '#a88b6c', glass: '#bcd7e6', run: '#ebe7e0',
};

/** A seeded random: the same seed draws the same home. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rect = { x: number; z: number; w: number; d: number; born: number };
type Seg = { a: [number, number]; b: [number, number]; born: number; door: boolean };
type Kind = 'LIVING' | 'BEDROOM' | 'BATH' | 'OFFICE';

/** One home: a footprint divided cell by cell into rooms; every division a wall with a door in it. */
function drawHome(rng: () => number) {
  const W = 8 + rng() * 4;
  const D = 6 + rng() * 3;
  const target = 4 + Math.floor(rng() * 3);
  let rooms: Rect[] = [{ x: -W / 2, z: -D / 2, w: W, d: D, born: 0 }];
  const parts: Seg[] = [];
  for (let n = 1; rooms.length < target && n < 12; n += 1) {
    const big = [...rooms].sort((p, q) => q.w * q.d - p.w * p.d).find((r) => Math.max(r.w, r.d) >= 5);
    if (!big) break;
    const t = 0.36 + rng() * 0.28;
    const born = 0.25 + n * 0.32;
    rooms = rooms.filter((r) => r !== big);
    if (big.w >= big.d) {
      const cut = big.w * t;
      rooms.push({ ...big, w: cut, born }, { ...big, x: big.x + cut, w: big.w - cut, born });
      parts.push({ a: [big.x + cut, big.z], b: [big.x + cut, big.z + big.d], born: born + 0.9, door: true });
    } else {
      const cut = big.d * t;
      rooms.push({ ...big, d: cut, born }, { ...big, z: big.z + cut, d: big.d - cut, born });
      parts.push({ a: [big.x, big.z + cut], b: [big.x + big.w, big.z + cut], born: born + 0.9, door: true });
    }
  }
  const byArea = [...rooms].sort((p, q) => q.w * q.d - p.w * p.d);
  const kinds = new Map<Rect, Kind>();
  byArea.forEach((r, i) => kinds.set(r, i === 0 ? 'LIVING' : i === byArea.length - 1 ? 'BATH' : i === byArea.length - 2 && byArea.length >= 5 ? 'OFFICE' : 'BEDROOM'));
  const outer: Seg[] = [
    { a: [-W / 2, -D / 2], b: [W / 2, -D / 2], born: 0.6, door: false }, { a: [W / 2, -D / 2], b: [W / 2, D / 2], born: 0.75, door: false },
    { a: [W / 2, D / 2], b: [-W / 2, D / 2], born: 0.9, door: false }, { a: [-W / 2, D / 2], b: [-W / 2, -D / 2], born: 1.05, door: false },
  ];
  return { W, D, rooms, kinds, walls: [...outer, ...parts] };
}

type Grower = { obj: THREE.Object3D; born: number; mode: 'RISE' | 'POP' | 'BLOOM'; dur: number };

const easeOut = (x: number) => 1 - (1 - x) ** 3;
const easeBack = (x: number) => { const c = 1.6; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };

/** The home as meshes, each with when it is born and how it grows. */
function buildHome(seed: number) {
  const rng = mulberry(seed);
  const plan = drawHome(rng);
  const group = new THREE.Group();
  const growers: Grower[] = [];
  const lights: Array<{ light: THREE.PointLight; born: number }> = [];
  const glows: Array<{ mat: THREE.MeshStandardMaterial; born: number }> = [];
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
    const key = color + JSON.stringify(extra);
    if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0, transparent: true, ...extra }));
    return mats.get(key)!;
  };
  const geos: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, round = 0.04) => {
    const g = round > 0 && Math.min(w, h, d) > round * 2.2 ? new RoundedBoxGeometry(w, h, d, 2, round) : new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0); // grows from the floor
    geos.push(g);
    return g;
  };
  const add = (mesh: THREE.Mesh, born: number, mode: Grower['mode'], dur = 0.7) => {
    mesh.castShadow = mode !== 'BLOOM';
    mesh.receiveShadow = true;
    mesh.scale.setScalar(0.0001);
    group.add(mesh);
    growers.push({ obj: mesh, born, mode, dur });
    return mesh;
  };

  // Floors: each room's slab blooms as its cell is born.
  for (const r of plan.rooms) {
    const kind = plan.kinds.get(r)!;
    const slab = new THREE.Mesh(box(r.w - 0.04, 0.06, r.d - 0.04, 0), mat(kind === 'BATH' ? COLORS.stone : COLORS.oak, { roughness: 0.62 }));
    slab.position.set(r.x + r.w / 2, 0, r.z + r.d / 2);
    add(slab, r.born, 'BLOOM', 0.9);
  }

  // Walls: rising from the floor, a door in every partition, a window or two in the outside walls.
  for (const s of plan.walls) {
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    const gaps: Array<[number, number, boolean]> = [];
    if (s.door && len > 1.6) { const at = 0.6 + rng() * (len - 1.8); gaps.push([at, at + 0.9, false]); }
    if (!s.door && len > 4 && rng() < 0.85) { const at = 0.8 + rng() * (len - 3); gaps.push([at, at + 1.3, true]); }
    let from = 0;
    const pieces: Array<[number, number, boolean]> = [];
    for (const [g0, g1, glass] of gaps) { pieces.push([from, g0, false]); if (glass) pieces.push([g0, g1, true]); from = g1; }
    pieces.push([from, len, false]);
    const ux = (s.b[0] - s.a[0]) / len; const uz = (s.b[1] - s.a[1]) / len;
    pieces.forEach(([p0, p1, glass], i) => {
      const l = p1 - p0;
      if (l < 0.05) return;
      const cx = s.a[0] + ux * (p0 + l / 2); const cz = s.a[1] + uz * (p0 + l / 2);
      const wall = new THREE.Mesh(box(l + (glass ? 0 : WALL_T), glass ? WALL_H - 0.35 : WALL_H, glass ? 0.03 : WALL_T, 0), glass ? mat(COLORS.glass, { opacity: 0.32, roughness: 0.1, metalness: 0.1 }) : mat(COLORS.wall, { roughness: 0.9 }));
      wall.position.set(cx, glass ? 0.35 : 0, cz);
      wall.rotation.y = -Math.atan2(uz, ux);
      add(wall, s.born + 0.12 * i, 'RISE', 1.1);
      if (!glass) {
        // The cut: a dark cap on top of the wall, as an architect's model shows it.
        const cap = new THREE.Mesh(box(l + WALL_T, 0.02, WALL_T + 0.005, 0), mat(COLORS.cap, { roughness: 0.5 }));
        cap.position.set(cx, WALL_H, cz);
        cap.rotation.y = wall.rotation.y;
        add(cap, s.born + 0.12 * i + 0.9, 'BLOOM', 0.5);
      }
    });
  }

  // Furniture, room by room, in each room's own frame (u along its long side, v across it).
  const furnishStart = 3 + plan.walls.length * 0.04;
  [...plan.rooms].sort((p, q) => p.born - q.born).forEach((r, ri) => {
    const kind = plan.kinds.get(r)!;
    const long = r.w >= r.d;
    const L = long ? r.w : r.d; const S = long ? r.d : r.w;
    let t = furnishStart + ri * 0.55;
    const at = (u: number, v: number) => (long ? [r.x + u, r.z + v] : [r.x + v, r.z + u]) as [number, number];
    const put = (u: number, v: number, su: number, sv: number, h: number, color: string, opts: { y?: number; round?: number; extra?: Partial<THREE.MeshStandardMaterialParameters> } = {}) => {
      if (su > L - 0.2 || sv > S - 0.2) return null;
      const [x, z] = at(u, v);
      const m = new THREE.Mesh(box(long ? su : sv, h, long ? sv : su, opts.round ?? 0.04), mat(color, opts.extra));
      m.position.set(x, opts.y ?? 0.03, z);
      t += 0.12;
      return add(m, t, 'POP', 0.65);
    };
    const plant = (u: number, v: number) => {
      const [x, z] = at(u, v);
      const pot = new THREE.Mesh(box(0.3, 0.32, 0.3, 0.06), mat(COLORS.pot));
      pot.position.set(x, 0.03, z);
      add(pot, (t += 0.1), 'POP');
      const g = new THREE.SphereGeometry(0.3, 18, 14); geos.push(g);
      const leaf = new THREE.Mesh(g, mat(COLORS.leaf, { roughness: 0.9 }));
      leaf.position.set(x, 0.62, z);
      add(leaf, (t += 0.1), 'POP');
    };
    const lamp = (u: number, v: number) => {
      const [x, z] = at(u, v);
      const pole = new THREE.Mesh(box(0.04, 1.35, 0.04, 0), mat(COLORS.ink));
      pole.position.set(x, 0.03, z);
      add(pole, (t += 0.1), 'POP');
      const shadeMat = new THREE.MeshStandardMaterial({ color: COLORS.white, emissive: new THREE.Color('#ffcf87'), emissiveIntensity: 0, roughness: 0.6, transparent: true });
      const g = new THREE.CylinderGeometry(0.14, 0.2, 0.26, 20, 1, true); geos.push(g);
      const shade = new THREE.Mesh(g, shadeMat);
      shade.position.set(x, 1.42, z);
      add(shade, (t += 0.1), 'POP');
      glows.push({ mat: shadeMat, born: t + 0.8 });
    };
    if (kind === 'LIVING') {
      const cx = Math.min(L * 0.42, L - 1.6);
      put(cx, S * 0.5, Math.min(2.6, L * 0.45), Math.min(1.8, S * 0.55), 0.015, COLORS.rug, { round: 0 });
      put(cx, 0.5, Math.min(2.3, L * 0.45), 0.92, 0.42, COLORS.sofa, { round: 0.08 });
      put(cx, 0.2, Math.min(2.3, L * 0.45), 0.28, 0.82, COLORS.sofa, { round: 0.08 });
      put(cx, S * 0.5, 1.0, 0.55, 0.38, COLORS.wood, { round: 0.03 });
      put(cx, S - 0.25, 1.7, 0.42, 0.5, COLORS.walnut);
      put(cx, S - 0.14, 1.25, 0.05, 0.72, COLORS.ink, { y: 0.62, round: 0 });
      // The kitchen at the far end: a run, its dark worktop, a dining table between.
      if (L > 5) {
        put(L - 0.36, S * 0.5, 0.62, Math.min(3.2, S - 0.5), 0.88, COLORS.run);
        put(L - 0.36, S * 0.5, 0.66, Math.min(3.2, S - 0.5), 0.04, COLORS.ink, { y: 0.91, round: 0 });
        put(L - 1.75, S * 0.5, 0.95, 1.45, 0.74, COLORS.wood, { round: 0.03 });
      }
      plant(0.35, S - 0.4);
      lamp(0.35, 0.35);
    } else if (kind === 'BEDROOM') {
      const double = S >= 2.7;
      const bw = double ? 1.6 : 0.95;
      put(L * 0.45, 1.05, bw, 2.05, 0.42, COLORS.bed, { round: 0.05 });
      put(L * 0.45, 1.1, bw - 0.1, 1.9, 0.16, COLORS.white, { y: 0.42, round: 0.06 });
      put(L * 0.45, 0.12, bw, 0.12, 0.95, COLORS.walnut, { round: 0.03 });
      put(L * 0.45 - bw / 2 - 0.3, 0.3, 0.42, 0.4, 0.5, COLORS.wood);
      put(L * 0.45 + bw / 2 + 0.3, 0.3, 0.42, 0.4, 0.5, COLORS.wood);
      put(L - 0.34, S * 0.5, 0.6, Math.min(2.0, S - 0.6), 1.95, COLORS.run);
      if (L > 4) plant(0.35, S - 0.35);
    } else if (kind === 'BATH') {
      put(0.55, 0.55, 0.9, 0.9, 0.05, COLORS.stone, { round: 0 });
      put(0.55, 1.02, 0.9, 0.03, 1.9, COLORS.glass, { round: 0, extra: { opacity: 0.35, roughness: 0.1 } });
      put(L - 0.55, 0.28, 0.85, 0.48, 0.85, COLORS.white);
      put(L - 0.55, 0.05, 0.7, 0.03, 0.6, COLORS.glass, { y: 1.05, round: 0, extra: { roughness: 0.05, metalness: 0.6 } });
      put(L * 0.5, 0.35, 0.4, 0.6, 0.4, COLORS.white, { round: 0.1 });
    } else {
      put(L * 0.4, 0.35, 1.3, 0.62, 0.75, COLORS.wood, { round: 0.02 });
      put(L * 0.4, 1.0, 0.52, 0.52, 0.48, COLORS.ink, { round: 0.06 });
      put(L - 0.25, S * 0.5, 0.36, Math.min(1.4, S - 0.6), 1.8, COLORS.walnut);
      lamp(0.35, S - 0.35);
    }
    // Every room's own warm light, once it is furnished.
    const light = new THREE.PointLight('#ffcf87', 0, Math.max(L, S) * 1.6, 1.6);
    light.position.set(r.x + r.w / 2, 1.7, r.z + r.d / 2);
    group.add(light);
    lights.push({ light, born: t + 0.6 });
  });

  const dispose = () => { for (const g of geos) g.dispose(); for (const m of mats.values()) m.dispose(); for (const gl of glows) gl.mat.dispose(); };
  const fading = [...mats.values(), ...glows.map((g) => g.mat)];
  const baseOpacity = new Map(fading.map((m) => [m, m.opacity]));
  return { plan, group, growers, lights, glows, dispose, fading, baseOpacity };
}

/** Soft round motes (a radial dot), drawn once. */
function moteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,214,140,1)'); grd.addColorStop(0.4, 'rgba(233,185,73,0.55)'); grd.addColorStop(1, 'rgba(233,185,73,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export default function WalkGrowth({ onFail }: { onFail: () => void }) {
  const host = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch { onFail(); return undefined; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 2, 0.1, 100);
    scene.add(new THREE.HemisphereLight('#fff6e8', '#b9a993', 1.1));
    const sun = new THREE.DirectionalLight('#fff1dc', 1.9);
    sun.position.set(6, 11, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -9; sun.shadow.camera.right = 9; sun.shadow.camera.top = 9; sun.shadow.camera.bottom = -9;
    sun.shadow.radius = 4;
    sun.shadow.bias = -0.0006;
    scene.add(sun);
    // The ground: only its shadow shows, so the home stands on the page itself.
    const groundGeo = new THREE.PlaneGeometry(40, 40);
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.14 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Warm motes rising through the light.
    const motes = 140;
    const pos = new Float32Array(motes * 3);
    const speed = new Float32Array(motes);
    for (let i = 0; i < motes; i += 1) { pos[i * 3] = (Math.random() - 0.5) * 16; pos[i * 3 + 1] = Math.random() * 4; pos[i * 3 + 2] = (Math.random() - 0.5) * 12; speed[i] = 0.08 + Math.random() * 0.22; }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const moteTex = moteTexture();
    const moteMat = new THREE.PointsMaterial({ size: 0.13, map: moteTex, transparent: true, depthWrite: false, opacity: 0.75, blending: THREE.AdditiveBlending });
    scene.add(new THREE.Points(moteGeo, moteMat));

    let seed = Math.floor(Math.random() * 1e9);
    let home = buildHome(seed);
    scene.add(home.group);
    let bornAt = performance.now();
    let angle = Math.random() * Math.PI * 2;
    let last = performance.now();
    let frame = 0;

    const resize = () => {
      const w = el.clientWidth || 1; const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (document.hidden) return;
      let t = (now - bornAt) / 1000;
      if (t > LIFE) {
        scene.remove(home.group);
        home.dispose();
        seed += 7919;
        home = buildHome(seed);
        scene.add(home.group);
        bornAt = now;
        t = 0;
      }
      for (const g of home.growers) {
        const k = Math.max(0, Math.min(1, (t - g.born) / g.dur));
        const v = Math.max(0.0001, g.mode === 'POP' ? easeBack(k) : easeOut(k));
        if (g.mode === 'RISE') g.obj.scale.set(1, v, 1);
        else if (g.mode === 'BLOOM') g.obj.scale.set(v, 1, v);
        else g.obj.scale.setScalar(v);
        g.obj.visible = k > 0;
      }
      const sink = Math.max(0, Math.min(1, (t - SINK_AT) / (LIFE - SINK_AT)));
      for (const l of home.lights) l.light.intensity = 2.4 * easeOut(Math.max(0, Math.min(1, (t - l.born) / 1.2))) * (1 - sink);
      for (const g of home.glows) g.mat.emissiveIntensity = 1.4 * easeOut(Math.max(0, Math.min(1, (t - g.born) / 1))) * (1 - sink);
      for (const m of home.fading) m.opacity = (home.baseOpacity.get(m) ?? 1) * (1 - easeOut(sink));
      home.group.position.y = -0.35 * easeOut(sink);
      groundMat.opacity = 0.14 * (1 - sink);
      // The camera: a slow orbit, breathing in and out, always on the home.
      angle += dt * 0.16;
      const reach = Math.max(home.plan.W, home.plan.D) * (1.42 + 0.06 * Math.sin(now / 2600));
      camera.position.set(Math.cos(angle) * reach, reach * 0.72, Math.sin(angle) * reach);
      camera.lookAt(0, 0.1, 0);
      for (let i = 0; i < motes; i += 1) {
        pos[i * 3 + 1] += speed[i] * dt;
        pos[i * 3] += Math.sin(now / 1500 + i) * 0.002;
        if (pos[i * 3 + 1] > 4) pos[i * 3 + 1] = 0;
      }
      moteGeo.attributes.position.needsUpdate = true;
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      home.dispose();
      groundGeo.dispose(); groundMat.dispose(); moteGeo.dispose(); moteMat.dispose(); moteTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [onFail]);
  return <div ref={host} className="absolute inset-0" aria-hidden="true" />;
}
