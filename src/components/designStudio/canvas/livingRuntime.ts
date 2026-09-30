// THE LIVING RUNTIME — the engine that performs what assets declare.
//
// interactions.ts says WHAT a piece can do (machines: states, poses,
// effects, actions; seats). This runs it inside the three.js scene:
//
//   · a PART is a node named `ix:<part>`; its authored transform is its base
//     and every state pose is an offset from it
//   · a TRANSITION captures where every part and effect is right now and
//     eases to the target state over that state's duration — time-based,
//     reversible half-way, never a jump (reduced motion: instant)
//   · EFFECTS are light, glow, screen, heat, water, steam. Light is a POOL:
//     a few real point lights (by quality tier), given each frame to the
//     switched-on sources nearest the visitor; every other source keeps its
//     glow. Every light costs every pixel in a forward renderer, so twelve
//     room lights would halve the frame rate; the pool never changes size,
//     so a switch never recompiles a shader
//   · automatic follow-ons (brewing → ready, flushing → idle) run on the
//     clock, not on frames
//
// Nothing here writes the design: every visit starts from the machines'
// initial states and `reset()` returns them there. High-frequency work stays
// in here, driven by the render loop; React hears about aim and state only
// when something a person would notice changes.

import * as THREE from 'three';
import {
  actionsFrom, compileMachine, easeInOut, effectIn, enterDuration, isActiveState, permittedInteractions, poseIn,
  type ActionCode, type AssetCapability, type EffectSpec, type InteractionRole, type InteractionSpec,
  type Machine, type SeatAnchor, type Vec3,
} from '../../../lib/designStudio/interactions.ts';

interface PoseValue { p: Vec3; r: Vec3; s: Vec3; tint: THREE.Color | null }

interface PartRig {
  node: THREE.Object3D;
  base: { p: THREE.Vector3; r: THREE.Euler; s: THREE.Vector3 };
  /** Materials of this part (cloned, so tinting one part never tints another) with their authored colours. */
  mats: Array<{ mat: THREE.MeshStandardMaterial; color: THREE.Color }>;
  cur: PoseValue;
}

interface EffectRig {
  spec: EffectSpec;
  node: THREE.Object3D;
  mats: Array<{ mat: THREE.MeshStandardMaterial; opacity: number; emissive: THREE.Color; emissiveIntensity: number }>;
  /** A light source (LIGHT effects): lit by a pooled point light when near enough. */
  source: boolean;
  baseScaleY: number;
  level: number;
}

export interface LiveEntry {
  key: string;
  machine: Machine;
  objectId: string | null;
  doorId: string | null;
  parts: Map<string, PartRig>;
  effects: Map<string, EffectRig>;
  state: string;
  target: string | null;
  from: { parts: Map<string, PoseValue>; effects: Map<string, number> } | null;
  start: number;
  duration: number;
  autoAt: number | null;
  /** A visitor changed it (room lights then stop following the time of day). */
  touched: boolean;
}

export interface SeatSet { objectId: string; root: THREE.Object3D; seats: SeatAnchor[] }

/** A seat as the walkthrough needs it: plan position, eye height, facing. */
export interface WorldSeat { posture: 'SIT' | 'LIE'; x: number; y: number; eye: number; yaw: number; pitch: number }

export interface ActionOption { key: string; action: ActionCode }

const SCREEN_TEXTURE = (() => {
  let tex: THREE.CanvasTexture | null = null;
  return () => {
    if (tex || typeof document === 'undefined') return tex;
    // A calm picture for a switched-on screen: a soft landscape gradient,
    // never a logo or a real programme.
    const c = document.createElement('canvas');
    c.width = 128; c.height = 72;
    const g = c.getContext('2d');
    if (!g) return null;
    const sky = g.createLinearGradient(0, 0, 0, 72);
    sky.addColorStop(0, '#7fa6d6'); sky.addColorStop(0.55, '#f2c79a'); sky.addColorStop(1, '#3b4c63');
    g.fillStyle = sky; g.fillRect(0, 0, 128, 72);
    g.fillStyle = 'rgba(40,55,70,0.85)';
    g.beginPath(); g.moveTo(0, 56); g.quadraticCurveTo(40, 38, 72, 50); g.quadraticCurveTo(100, 60, 128, 44); g.lineTo(128, 72); g.lineTo(0, 72); g.fill();
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
})();

const v3 = (v: Vec3) => new THREE.Vector3(v[0], v[1], v[2]);
const lerpN = (a: number, b: number, t: number) => a + (b - a) * t;

export interface LivingOptions {
  reducedMotion: boolean;
  /** Real point lights in the pool (quality tier). */
  maxLights: number;
  /** Where the pool's lights live (the scene). Without it, light sources only glow. */
  lightParent?: THREE.Object3D;
  onDoor: (doorId: string, blocks: boolean) => void;
  onChange: () => void;
}

export class LivingRuntime {
  private entries = new Map<string, LiveEntry>();
  private seatSets = new Map<string, SeatSet>();
  private pool: THREE.PointLight[] = [];
  private focus = new THREE.Vector3();
  private lightsDirty = true;

  private opts: LivingOptions;

  constructor(opts: LivingOptions) {
    this.opts = opts;
    if (opts.lightParent) {
      for (let i = 0; i < opts.maxLights; i += 1) {
        const l = new THREE.PointLight(0xffffff, 0, 6, 2);
        l.castShadow = false;
        opts.lightParent.add(l);
        this.pool.push(l);
      }
    }
  }

  /** Where the visitor is: the pool lights the switched-on sources nearest to here. */
  setFocus(p: THREE.Vector3) {
    if (p.distanceToSquared(this.focus) < 0.25) return;
    this.focus.copy(p);
    this.lightsDirty = true;
  }

  /** Give the pool's lights to the brightest-nearest sources that are on. */
  private assignLights() {
    if (!this.lightsDirty || !this.pool.length) return;
    this.lightsDirty = false;
    const lit: Array<{ fx: EffectRig; at: THREE.Vector3; d: number }> = [];
    for (const e of this.entries.values()) {
      for (const fx of e.effects.values()) {
        if (!fx.source || fx.level < 0.01) continue;
        const at = fx.node.getWorldPosition(new THREE.Vector3());
        lit.push({ fx, at, d: at.distanceToSquared(this.focus) });
      }
    }
    lit.sort((a, b) => a.d - b.d);
    this.pool.forEach((l, i) => {
      const x = lit[i];
      if (!x) { l.intensity = 0; return; }
      l.position.copy(x.at);
      l.color.set(x.fx.spec.color);
      l.distance = x.fx.spec.distance ?? 6;
      l.intensity = x.fx.spec.intensity * x.fx.level;
    });
  }

  /** Diagnostics and QA: how the pool is lit. */
  poolState(): Array<{ intensity: number; position: [number, number, number] }> {
    return this.pool.map((l) => ({ intensity: l.intensity, position: [l.position.x, l.position.y, l.position.z] }));
  }

  get size(): number { return this.entries.size; }

  // ── Registration ──────────────────────────────────────────────────

  /**
   * Register what a node can do. Specs are filtered by the piece's
   * capabilities first: declared AND permitted, or it does nothing.
   */
  register(prefix: string, root: THREE.Object3D, specs: InteractionSpec[], caps: readonly AssetCapability[] | null,
    meta: { objectId: string | null; doorId?: (specId: string) => string | null }) {
    const allowed = caps ? permittedInteractions(specs, caps) : specs;
    for (const spec of allowed) {
      if (spec.kind === 'SEAT') {
        if (!meta.objectId) continue;
        const set = this.seatSets.get(meta.objectId) ?? { objectId: meta.objectId, root, seats: [] };
        set.seats.push(...spec.seats);
        this.seatSets.set(meta.objectId, set);
        continue;
      }
      const machine = compileMachine(spec);
      if (!machine) continue;
      const parts = new Map<string, PartRig>();
      let missing = false;
      for (const id of machine.parts) {
        const node = root.name === `ix:${id}` ? root : root.getObjectByName(`ix:${id}`);
        if (!node) { missing = true; break; }
        if (!parts.has(id)) parts.set(id, this.rig(node));
      }
      // A declared part the model does not have: the interaction is not offered.
      if (missing) continue;
      const effects = new Map<string, EffectRig>();
      for (const e of machine.effects) effects.set(e.id, this.effectRig(e, parts.get(e.part)!.node));
      const entry: LiveEntry = {
        key: `${prefix}:${spec.id}`, machine, objectId: meta.objectId, doorId: meta.doorId?.(spec.id) ?? null,
        parts, effects, state: machine.initial, target: null, from: null, start: 0, duration: 0, autoAt: null, touched: false,
      };
      this.entries.set(entry.key, entry);
      this.settle(entry, machine.initial);
    }
  }

  private rig(node: THREE.Object3D): PartRig {
    const mats: PartRig['mats'] = [];
    node.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const own = (Array.isArray(m.material) ? m.material : [m.material]).map((mat) => {
        const c = (mat as THREE.MeshStandardMaterial).clone();
        mats.push({ mat: c, color: c.color.clone() });
        return c;
      });
      m.material = Array.isArray(m.material) ? own : own[0];
    });
    return {
      node,
      base: { p: node.position.clone(), r: node.rotation.clone(), s: node.scale.clone() },
      mats,
      cur: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1], tint: null },
    };
  }

  private effectRig(spec: EffectSpec, node: THREE.Object3D): EffectRig {
    const mats: EffectRig['mats'] = [];
    node.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const s = mat as THREE.MeshStandardMaterial;
        if (!s.isMeshStandardMaterial) continue;
        if (spec.type === 'SCREEN') { const tex = SCREEN_TEXTURE(); if (tex) { s.emissiveMap = tex; s.needsUpdate = true; } }
        if (spec.type === 'WATER' || spec.type === 'STEAM') { s.transparent = true; s.depthWrite = false; }
        mats.push({ mat: s, opacity: s.opacity, emissive: s.emissive.clone(), emissiveIntensity: s.emissiveIntensity });
      }
    });
    return { spec, node, mats, source: spec.type === 'LIGHT', baseScaleY: node.scale.y, level: 0 };
  }

  /** Forget everything registered for one object (or, with null, for the space itself). */
  clear(objectId: string | null) {
    for (const [key, e] of this.entries) {
      if (e.objectId !== objectId) continue;
      this.entries.delete(key);
    }
    if (objectId) this.seatSets.delete(objectId);
  }

  // ── Running ───────────────────────────────────────────────────────

  /** Actions a visitor may take on an entry right now (from where it is heading). */
  actions(entry: LiveEntry): ActionCode[] {
    return actionsFrom(entry.machine, entry.target ?? entry.state).map((t) => t.action);
  }

  /** Take an action. Returns false if the entry cannot do it from its current state. */
  act(key: string, action: ActionCode, now = performance.now()): boolean {
    const e = this.entries.get(key);
    if (!e) return false;
    const t = actionsFrom(e.machine, e.target ?? e.state).find((x) => x.action === action);
    if (!t) return false;
    e.touched = true;
    this.begin(e, t.to, now);
    return true;
  }

  /** Move to a state directly (the time of day turning room lights on). */
  force(key: string, state: string, now = performance.now()) {
    const e = this.entries.get(key);
    if (!e || !e.machine.states.has(state) || (e.target ?? e.state) === state) return;
    this.begin(e, state, now);
  }

  private begin(e: LiveEntry, to: string, now: number, scale = 1) {
    const parts = new Map<string, PoseValue>();
    for (const [id, rig] of e.parts) parts.set(id, { p: [...rig.cur.p], r: [...rig.cur.r], s: [...rig.cur.s], tint: rig.cur.tint?.clone() ?? null });
    const effects = new Map<string, number>();
    for (const [id, fx] of e.effects) effects.set(id, fx.level);
    e.from = { parts, effects };
    e.target = to;
    e.start = now;
    e.duration = enterDuration(e.machine, to, this.opts.reducedMotion) * Math.max(0, Math.min(1, scale));
    e.autoAt = null;
    const def = e.machine.states.get(to);
    // Closing a door blocks at once; opening frees the way as it starts to swing.
    if (e.doorId) this.opts.onDoor(e.doorId, !!def?.blocks);
    if (e.duration <= 0) this.finish(e, now);
    this.opts.onChange();
  }

  private finish(e: LiveEntry, now: number) {
    const to = e.target!;
    this.apply(e, to, 1);
    e.state = to;
    e.target = null;
    e.from = null;
    const auto = e.machine.states.get(to)?.auto;
    e.autoAt = auto ? now + (this.opts.reducedMotion ? 0 : auto.afterMs) : null;
    this.opts.onChange();
  }

  /** One frame. True while anything is moving or waiting to move on. */
  step(now: number): boolean {
    let busy = false;
    this.assignLights();
    for (const e of this.entries.values()) {
      if (e.target) {
        const raw = e.duration <= 0 ? 1 : Math.min(1, Math.max(0, (now - e.start) / e.duration));
        this.apply(e, e.target, easeInOut(raw));
        if (raw >= 1) this.finish(e, now);
        busy = true;
      } else if (e.autoAt !== null) {
        if (now >= e.autoAt) {
          const auto = e.machine.states.get(e.state)?.auto;
          e.autoAt = null;
          if (auto) this.begin(e, auto.to, now);
        }
        busy = true;
      }
    }
    this.assignLights();
    return busy;
  }

  /** Put an entry at `t` of the way from its captured pose to state `to`. */
  private apply(e: LiveEntry, to: string, t: number) {
    for (const [id, rig] of e.parts) {
      const target = poseIn(e.machine, to, id);
      const from = e.from?.parts.get(id) ?? { p: target.p, r: target.r, s: target.s, tint: null };
      const p: Vec3 = [lerpN(from.p[0], target.p[0], t), lerpN(from.p[1], target.p[1], t), lerpN(from.p[2], target.p[2], t)];
      const r: Vec3 = [lerpN(from.r[0], target.r[0], t), lerpN(from.r[1], target.r[1], t), lerpN(from.r[2], target.r[2], t)];
      const s: Vec3 = [lerpN(from.s[0], target.s[0], t), lerpN(from.s[1], target.s[1], t), lerpN(from.s[2], target.s[2], t)];
      rig.node.position.copy(rig.base.p).add(v3(p));
      rig.node.rotation.set(rig.base.r.x + r[0], rig.base.r.y + r[1], rig.base.r.z + r[2]);
      rig.node.scale.set(rig.base.s.x * s[0], rig.base.s.y * s[1], rig.base.s.z * s[2]);
      rig.node.visible = s[0] * s[1] * s[2] > 1e-4;
      let tint: THREE.Color | null = null;
      if (target.tint || from.tint) {
        const a = from.tint ?? null;
        const b = target.tint ? new THREE.Color(target.tint) : null;
        for (const m of rig.mats) {
          const c0 = a ?? m.color;
          const c1 = b ?? m.color;
          m.mat.color.copy(c0).lerp(c1, t);
        }
        tint = rig.mats[0]?.mat.color.clone() ?? null;
      }
      rig.cur = { p, r, s, tint };
      rig.node.updateMatrixWorld(true);
    }
    for (const [id, fx] of e.effects) {
      const from = e.from?.effects.get(id) ?? effectIn(e.machine, to, id);
      fx.level = lerpN(from, effectIn(e.machine, to, id), t);
      this.applyEffect(fx);
    }
  }

  private applyEffect(fx: EffectRig) {
    const { spec, level } = fx;
    switch (spec.type) {
      case 'LIGHT':
      case 'GLOW':
      case 'SCREEN':
      case 'HEAT': {
        const strength = spec.type === 'LIGHT' ? 1.4 : spec.intensity;
        for (const m of fx.mats) {
          if (level > 0.001) {
            m.mat.emissive.set(spec.color);
            m.mat.emissiveIntensity = strength * level;
            if (spec.type === 'SCREEN') m.mat.emissive.set('#ffffff');
          } else {
            m.mat.emissive.copy(m.emissive);
            m.mat.emissiveIntensity = m.emissiveIntensity;
          }
        }
        if (fx.source) this.lightsDirty = true;
        break;
      }
      case 'WATER':
      case 'STEAM': {
        fx.node.visible = level > 0.01;
        fx.node.scale.y = fx.baseScaleY * Math.max(0.001, level);
        for (const m of fx.mats) m.mat.opacity = m.opacity * level;
        break;
      }
    }
  }

  // ── Direct gestures: dragging a door, a drawer, a sliding door ─────
  //
  // A two-state part (CLOSED ↔ OPEN) can be moved by hand: while the visitor
  // drags, it follows the drag exactly (no easing — it is in their hand);
  // on release it finishes the way it was going, eased, taking only the
  // time the remaining distance needs.

  canScrub(e: LiveEntry): boolean {
    const m = e.machine;
    return m.states.has('CLOSED') && m.states.has('OPEN')
      && m.transitions.some((t) => t.from === 'CLOSED' && t.to === 'OPEN')
      && m.transitions.some((t) => t.from === 'OPEN' && t.to === 'CLOSED');
  }

  /** How open a two-state part is right now (0 closed … 1 open), read from its pose. */
  progress(e: LiveEntry): number {
    const first = [...e.parts.entries()][0];
    if (!first) return e.state === 'OPEN' ? 1 : 0;
    const [id, rig] = first;
    const a = poseIn(e.machine, 'CLOSED', id);
    const b = poseIn(e.machine, 'OPEN', id);
    const flat = (p: { p: Vec3; r: Vec3; s: Vec3 }) => [...p.p, ...p.r, ...p.s];
    const fa = flat(a); const fb = flat(b); const fc = flat(rig.cur);
    let num = 0; let den = 0;
    for (let i = 0; i < fa.length; i += 1) { num += (fc[i] - fa[i]) * (fb[i] - fa[i]); den += (fb[i] - fa[i]) ** 2; }
    return den > 0 ? Math.max(0, Math.min(1, num / den)) : 0;
  }

  /** Hold a two-state part at `t` of the way open (a drag in progress). */
  scrubTo(key: string, t: number) {
    const e = this.entries.get(key);
    if (!e || !this.canScrub(e)) return;
    const k = Math.max(0, Math.min(1, t));
    const parts = new Map<string, PoseValue>();
    for (const id of e.parts.keys()) { const p = poseIn(e.machine, 'CLOSED', id); parts.set(id, { p: p.p, r: p.r, s: p.s, tint: null }); }
    e.target = null;
    e.autoAt = null;
    e.from = { parts, effects: new Map() };
    this.apply(e, 'OPEN', k);
    e.from = null;
    e.state = k >= 0.5 ? 'OPEN' : 'CLOSED';
    e.touched = true;
    // A door lets a body through only once it is mostly open.
    if (e.doorId) this.opts.onDoor(e.doorId, k < 0.6 && !!e.machine.states.get('CLOSED')?.blocks);
    this.opts.onChange();
  }

  /** Let go: the part finishes the way it was going (a flick decides, else the nearer end). */
  scrubEnd(key: string, fling = 0, now = performance.now()) {
    const e = this.entries.get(key);
    if (!e || !this.canScrub(e)) return;
    const t = this.progress(e);
    const to = fling > 0.2 ? 'OPEN' : fling < -0.2 ? 'CLOSED' : t >= 0.5 ? 'OPEN' : 'CLOSED';
    this.begin(e, to, now, to === 'OPEN' ? 1 - t : t);
  }

  setReducedMotion(on: boolean) { this.opts.reducedMotion = on; }

  /** Put an entry into a state at once (registration, reset). */
  private settle(e: LiveEntry, state: string) {
    e.from = null;
    e.target = null;
    e.autoAt = null;
    this.apply(e, state, 1);
    e.state = state;
    if (e.doorId) this.opts.onDoor(e.doorId, !!e.machine.states.get(state)?.blocks);
  }

  /** Everything back to its initial state: nothing a visitor did survives. */
  reset() {
    for (const e of this.entries.values()) { this.settle(e, e.machine.initial); e.touched = false; }
    this.opts.onChange();
  }

  // ── Lookup ────────────────────────────────────────────────────────

  get(key: string): LiveEntry | undefined { return this.entries.get(key); }

  all(): IterableIterator<LiveEntry> { return this.entries.values(); }

  /** The entry a scene node belongs to: the nearest `ix:` ancestor that is a registered part. */
  entryForPart(node: THREE.Object3D): LiveEntry | null {
    for (let o: THREE.Object3D | null = node; o; o = o.parent) {
      if (!o.name.startsWith('ix:')) continue;
      for (const e of this.entries.values()) for (const rig of e.parts.values()) if (rig.node === o) return e;
    }
    return null;
  }

  entriesOf(objectId: string): LiveEntry[] {
    return [...this.entries.values()].filter((e) => e.objectId === objectId);
  }

  seatsOf(objectId: string): SeatSet | undefined { return this.seatSets.get(objectId); }

  /** A seat anchor in plan terms: where the eye goes and which way it faces. */
  worldSeat(set: SeatSet, anchor: SeatAnchor): WorldSeat {
    set.root.updateMatrixWorld(true);
    const p = set.root.localToWorld(new THREE.Vector3(anchor.x, 0, anchor.z));
    const q = set.root.getWorldQuaternion(new THREE.Quaternion());
    const dir = new THREE.Vector3(-Math.sin(anchor.yaw), 0, -Math.cos(anchor.yaw)).applyQuaternion(q);
    const floor = set.root.getWorldPosition(new THREE.Vector3()).y;
    return { posture: anchor.posture, x: p.x, y: -p.z, eye: floor + anchor.y, yaw: Math.atan2(-dir.z, dir.x), pitch: anchor.pitch ?? 0 };
  }

  /** Diagnostics and QA: every machine's key, role and state. */
  states(): Array<{ key: string; role: InteractionRole; state: string; open: boolean }> {
    return [...this.entries.values()].map((e) => {
      const s = e.target ?? e.state;
      return { key: e.key, role: e.machine.role, state: s, open: isActiveState(e.machine, s) };
    });
  }

  dispose() {
    for (const l of this.pool) { l.removeFromParent(); l.dispose(); }
    this.pool = [];
    this.entries.clear();
    this.seatSets.clear();
  }
}
