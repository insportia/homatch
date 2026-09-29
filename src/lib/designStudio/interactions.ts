// THE LIVING ENGINE — what a thing in the home can do, and exactly how.
//
// One reusable model for every interaction in the walkthrough. An asset
// DECLARES what it can do; this engine PERFORMS it. Adding a refrigerator,
// a lamp or a recliner means declaring its parts and states — never writing
// refrigerator code.
//
// AUTHORING FORMS (what a catalogue asset or a concept block declares)
//
//   HINGED   a part rotating about one axis: closed (0) ↔ open (`open` rad)
//   SLIDING  a part translating along one axis: closed ↔ open (`open` m)
//   SWITCH   effects (light, glow, screen, water, steam, heat) off ↔ on,
//            optionally switching itself off again (a flush, a wash)
//   STATES   a small state machine: named states, each a pose for some
//            parts plus effect levels, joined by named actions, with
//            optional automatic follow-ons (brewing → ready)
//   SEAT     places a visitor can sit or lie: an anchor in the piece's own
//            frame; the visitor's view glides there, nothing moves
//
// Every form except SEAT compiles to one MACHINE (states + transitions), and
// the renderer runs only machines: a transition captures where every part
// is now and eases to the target pose over the target state's duration —
// time-based, never tied to frame rate, reversible half-way.
//
// Walkthrough interaction is TEMPORARY: it lives in the 3D runtime, is never
// written to the design, and every visit starts from the canonical state.
// A part is found by its node name `ix:<part>`; HOMATCH's concept blocks
// generate theirs, a licensed or uploaded model declares them in metadata.
//
// Pure: no three.js.

export type InteractionKind = 'HINGED' | 'SLIDING' | 'SWITCH' | 'STATES' | 'SEAT';

export const INTERACTION_ROLES = [
  'DOOR', 'WINDOW', 'BALCONY_DOOR', 'WARDROBE', 'CABINET', 'DRAWER', 'APPLIANCE', 'FREEZER', 'OVEN', 'DISHWASHER',
  'STOVE', 'FAUCET', 'SHOWER', 'TOILET', 'BATH', 'BED', 'SEAT', 'TV', 'LIGHT', 'LAMP', 'CURTAIN', 'BLIND', 'COFFEE',
  'RECLINER', 'MIRROR', 'WASHER',
] as const;
export type InteractionRole = typeof INTERACTION_ROLES[number];

/** What a visitor can do. Each has a label in every locale (`ds_act_<code>`). */
export const ACTION_CODES = [
  'OPEN', 'CLOSE', 'TURN_ON', 'TURN_OFF', 'SIT', 'LIE_DOWN', 'STAND_UP', 'MAKE_BED', 'MESS_BED', 'FLUSH',
  'WASH_HANDS', 'MAKE_COFFEE', 'DRINK', 'COOK', 'SERVE', 'RECLINE', 'SIT_UP', 'RUN_BATH', 'DRAIN', 'RAISE',
  'LOWER', 'START',
] as const;
export type ActionCode = typeof ACTION_CODES[number];

export const EFFECT_TYPES = ['LIGHT', 'GLOW', 'SCREEN', 'WATER', 'STEAM', 'HEAT'] as const;
export type EffectType = typeof EFFECT_TYPES[number];

export type Axis = 'x' | 'y' | 'z';
export type Vec3 = [number, number, number];

/** A part's pose in one state, relative to how it was authored. */
export interface PartPose {
  /** Metres added to the authored position. */
  p?: Vec3;
  /** Radians added to the authored rotation. */
  r?: Vec3;
  /** Multiplies the authored scale (0 hides the part). */
  s?: Vec3;
  /** The part's colour in this state (a steak browning, a cup filling). */
  tint?: string;
}

export interface EffectSpec {
  id: string;
  type: EffectType;
  /** The part the effect belongs to (`ix:<part>`). */
  part: string;
  color: string;
  /** Full-on strength: candela-ish for LIGHT, emissive intensity otherwise. */
  intensity: number;
  /** LIGHT only: how far it reaches (m). */
  distance?: number;
}

export interface StateDef {
  id: string;
  parts?: Record<string, PartPose>;
  /** Effect id → level 0..1. Effects not named are off. */
  effects?: Record<string, number>;
  /** How long the move INTO this state takes (defaults to the spec's). */
  enterMs?: number;
  /** Moves on by itself: brewing → ready, flushing → idle. */
  auto?: { to: string; afterMs: number };
  /** Blocks walking (a closed door). */
  blocks?: boolean;
}

export interface Transition { from: string; to: string; action: ActionCode }

export interface SeatAnchor {
  posture: 'SIT' | 'LIE';
  /** Metres in the piece's own frame (front = local -z); y is eye height. */
  x: number;
  y: number;
  z: number;
  /** Radians the visitor faces, in the piece's frame (0 = the piece's front). */
  yaw: number;
  /** Radians the visitor looks up (+) or down (−). */
  pitch?: number;
}

interface SpecBase { id: string; role: InteractionRole; durationMs: number }
export interface HingedSpec extends SpecBase { kind: 'HINGED'; axis: Axis; open: number; initiallyOpen?: boolean }
export interface SlidingSpec extends SpecBase { kind: 'SLIDING'; axis: Axis; open: number; initiallyOpen?: boolean }
export interface SwitchSpec extends SpecBase {
  kind: 'SWITCH';
  effects: EffectSpec[];
  initiallyOn?: boolean;
  /** Switches itself off after this long (a flush). */
  autoOffMs?: number;
  /** The words for on/off (FLUSH instead of TURN_ON…). */
  actions?: { on: ActionCode; off?: ActionCode };
}
export interface StatesSpec extends SpecBase {
  kind: 'STATES';
  states: StateDef[];
  transitions: Transition[];
  initial: string;
  effects?: EffectSpec[];
}
export interface SeatSpec extends SpecBase { kind: 'SEAT'; seats: SeatAnchor[] }

export type InteractionSpec = HingedSpec | SlidingSpec | SwitchSpec | StatesSpec | SeatSpec;

/** What the renderer runs. */
export interface Machine {
  id: string;
  role: InteractionRole;
  durationMs: number;
  states: Map<string, StateDef>;
  transitions: Transition[];
  initial: string;
  effects: EffectSpec[];
  /** Every part any state poses. */
  parts: string[];
}

// ── Capabilities: what the DESIGN may do with a piece, and what it offers ──

export const ASSET_CAPABILITIES = [
  'MOVABLE', 'ROTATABLE', 'REPLACEABLE', 'DUPLICATABLE', 'HIDEABLE',
  'OPENABLE', 'SLIDABLE', 'SITTABLE', 'LIEABLE', 'SWITCHABLE', 'DIMMABLE',
  'PICKABLE', 'PLACEABLE', 'POURABLE', 'DRINKABLE', 'COOKABLE', 'WASHABLE', 'INTERACTIVE',
] as const;
export type AssetCapability = typeof ASSET_CAPABILITIES[number];
export const DEFAULT_CAPABILITIES: AssetCapability[] = ['MOVABLE', 'ROTATABLE', 'REPLACEABLE', 'DUPLICATABLE'];

/** The capability an interaction needs before the engine will run it. */
export function capabilityFor(spec: InteractionSpec): AssetCapability {
  switch (spec.kind) {
    case 'HINGED': return 'OPENABLE';
    case 'SLIDING': return 'SLIDABLE';
    case 'SWITCH': return 'SWITCHABLE';
    case 'SEAT': return spec.seats.some((s) => s.posture === 'SIT') ? 'SITTABLE' : 'LIEABLE';
    default: return 'INTERACTIVE';
  }
}

/**
 * The interactions a piece may actually perform: declared AND permitted.
 * A catalogue row that declares a hinge but not OPENABLE does not open.
 * SLIDING is also permitted by OPENABLE (a drawer is opened, not slid).
 */
export function permittedInteractions(specs: InteractionSpec[], caps: readonly AssetCapability[]): InteractionSpec[] {
  const has = new Set(caps);
  return specs.filter((s) => {
    const need = capabilityFor(s);
    if (need === 'SLIDABLE') return has.has('SLIDABLE') || has.has('OPENABLE');
    if (s.kind === 'SEAT') return s.seats.some((a) => has.has(a.posture === 'SIT' ? 'SITTABLE' : 'LIEABLE'));
    return has.has(need) || (need !== 'INTERACTIVE' && has.has('INTERACTIVE') && need === 'OPENABLE');
  });
}

// ── Validation ─────────────────────────────────────────────────────────

const ROLES = new Set<string>(INTERACTION_ROLES);
const ACTIONS = new Set<string>(ACTION_CODES);
const EFFECTS = new Set<string>(EFFECT_TYPES);
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HEXC = /^#[0-9a-f]{6}$/i;
const MAX_ANGLE = 2.2; // a little over 120°
const MAX_SLIDE_M = 1.0;
const MAX_OFFSET_M = 2.0;
const MAX_STATES = 8;
const MAX_TRANSITIONS = 16;
const MAX_EFFECTS = 6;
const MAX_AUTO_MS = 20000;
export const MAX_PARTS = 24;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampMs = (v: unknown, dflt: number) => Math.min(8000, Math.max(0, finite(v) ? v : dflt));

function vec(v: unknown, limit: number, min = -limit): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(finite)) return null;
  if (v.some((n) => n > limit || n < min)) return null;
  return [v[0], v[1], v[2]];
}

function validPose(raw: unknown): PartPose | null {
  if (!raw || typeof raw !== 'object') return null;
  const x = raw as Record<string, unknown>;
  const out: PartPose = {};
  if (x.p !== undefined) { const p = vec(x.p, MAX_OFFSET_M); if (!p) return null; out.p = p; }
  if (x.r !== undefined) { const r = vec(x.r, Math.PI * 4); if (!r) return null; out.r = r; }
  if (x.s !== undefined) { const s = vec(x.s, 3, 0); if (!s) return null; out.s = s; }
  if (x.tint !== undefined) { if (typeof x.tint !== 'string' || !HEXC.test(x.tint)) return null; out.tint = x.tint; }
  return out;
}

function validEffects(raw: unknown): EffectSpec[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_EFFECTS) return null;
  const out: EffectSpec[] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    const x = (e ?? {}) as Record<string, unknown>;
    if (typeof x.id !== 'string' || !ID.test(x.id) || seen.has(x.id)) return null;
    if (typeof x.type !== 'string' || !EFFECTS.has(x.type)) return null;
    if (typeof x.part !== 'string' || !ID.test(x.part)) return null;
    if (typeof x.color !== 'string' || !HEXC.test(x.color)) return null;
    if (!finite(x.intensity) || x.intensity < 0 || x.intensity > 50) return null;
    if (x.distance !== undefined && (!finite(x.distance) || x.distance <= 0 || x.distance > 30)) return null;
    seen.add(x.id);
    out.push({ id: x.id, type: x.type as EffectType, part: x.part, color: x.color, intensity: x.intensity, ...(x.distance !== undefined ? { distance: x.distance as number } : {}) });
  }
  return out;
}

function validSeat(raw: unknown): SeatAnchor | null {
  const x = (raw ?? {}) as Record<string, unknown>;
  if (x.posture !== 'SIT' && x.posture !== 'LIE') return null;
  if (![x.x, x.y, x.z, x.yaw].every(finite)) return null;
  const [px, py, pz] = [x.x, x.y, x.z] as number[];
  if (Math.abs(px) > 3 || Math.abs(pz) > 3 || py < 0.2 || py > 2) return null;
  const pitch = x.pitch === undefined ? 0 : finite(x.pitch) && Math.abs(x.pitch) <= 1.4 ? x.pitch : null;
  if (pitch === null) return null;
  return { posture: x.posture, x: px, y: py, z: pz, yaw: x.yaw as number, pitch };
}

function validStates(x: Record<string, unknown>, effects: EffectSpec[]): Pick<StatesSpec, 'states' | 'transitions' | 'initial'> | null {
  if (!Array.isArray(x.states) || x.states.length < 2 || x.states.length > MAX_STATES) return null;
  const states: StateDef[] = [];
  const ids = new Set<string>();
  const effectIds = new Set(effects.map((e) => e.id));
  const parts = new Set<string>();
  for (const s of x.states) {
    const r = (s ?? {}) as Record<string, unknown>;
    if (typeof r.id !== 'string' || !/^[A-Z][A-Z0-9_]{0,23}$/.test(r.id) || ids.has(r.id)) return null;
    const def: StateDef = { id: r.id };
    if (r.parts !== undefined) {
      if (!r.parts || typeof r.parts !== 'object') return null;
      def.parts = {};
      for (const [part, pose] of Object.entries(r.parts as Record<string, unknown>)) {
        const ok = ID.test(part) ? validPose(pose) : null;
        if (!ok) return null;
        parts.add(part);
        def.parts[part] = ok;
      }
    }
    if (r.effects !== undefined) {
      if (!r.effects || typeof r.effects !== 'object') return null;
      def.effects = {};
      for (const [id, level] of Object.entries(r.effects as Record<string, unknown>)) {
        if (!effectIds.has(id) || !finite(level) || level < 0 || level > 1) return null;
        def.effects[id] = level;
      }
    }
    if (r.enterMs !== undefined) def.enterMs = clampMs(r.enterMs, 0);
    if (r.blocks === true) def.blocks = true;
    if (r.auto !== undefined) {
      const a = (r.auto ?? {}) as Record<string, unknown>;
      if (typeof a.to !== 'string' || !finite(a.afterMs) || a.afterMs < 0 || a.afterMs > MAX_AUTO_MS) return null;
      def.auto = { to: a.to, afterMs: a.afterMs };
    }
    ids.add(r.id);
    states.push(def);
  }
  if (parts.size > MAX_PARTS) return null;
  for (const s of states) if (s.auto && (!ids.has(s.auto.to) || s.auto.to === s.id)) return null;
  if (!Array.isArray(x.transitions) || x.transitions.length < 1 || x.transitions.length > MAX_TRANSITIONS) return null;
  const transitions: Transition[] = [];
  for (const t of x.transitions) {
    const r = (t ?? {}) as Record<string, unknown>;
    if (typeof r.from !== 'string' || typeof r.to !== 'string' || !ids.has(r.from) || !ids.has(r.to) || r.from === r.to) return null;
    if (typeof r.action !== 'string' || !ACTIONS.has(r.action)) return null;
    transitions.push({ from: r.from, to: r.to, action: r.action as ActionCode });
  }
  const initial = typeof x.initial === 'string' && ids.has(x.initial) ? x.initial : null;
  if (!initial) return null;
  return { states, transitions, initial };
}

/**
 * Declared interactions, bounded. Anything outside the model's limits is
 * DROPPED, never clamped silently into some other motion.
 */
export function validateInteractions(raw: unknown): InteractionSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: InteractionSpec[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, MAX_PARTS)) {
    const x = (r ?? {}) as Record<string, unknown>;
    const id = typeof x.id === 'string' && ID.test(x.id) ? x.id : null;
    const role = typeof x.role === 'string' && ROLES.has(x.role) ? x.role as InteractionRole : null;
    if (!id || !role || seen.has(id)) continue;
    const durationMs = Math.min(2000, Math.max(150, finite(x.durationMs) ? x.durationMs : 700));
    let spec: InteractionSpec | null = null;
    if (x.kind === 'HINGED' || x.kind === 'SLIDING') {
      const axis = x.axis === 'x' || x.axis === 'y' || x.axis === 'z' ? x.axis : null;
      const open = finite(x.open) ? x.open : null;
      if (!axis || open === null || open === 0) continue;
      if (x.kind === 'HINGED' && Math.abs(open) > MAX_ANGLE) continue;
      if (x.kind === 'SLIDING' && Math.abs(open) > MAX_SLIDE_M) continue;
      spec = { id, kind: x.kind, role, axis, open, durationMs, initiallyOpen: x.initiallyOpen === true };
    } else if (x.kind === 'SWITCH') {
      const effects = validEffects(x.effects);
      if (!effects || effects.length === 0) continue;
      const a = (x.actions ?? {}) as Record<string, unknown>;
      const on = typeof a.on === 'string' && ACTIONS.has(a.on) ? a.on as ActionCode : 'TURN_ON';
      const off = typeof a.off === 'string' && ACTIONS.has(a.off) ? a.off as ActionCode : undefined;
      const autoOff = x.autoOffMs === undefined ? undefined : finite(x.autoOffMs) && x.autoOffMs > 0 && x.autoOffMs <= MAX_AUTO_MS ? x.autoOffMs : null;
      if (autoOff === null) continue;
      spec = { id, kind: 'SWITCH', role, durationMs, effects, initiallyOn: x.initiallyOn === true, ...(autoOff ? { autoOffMs: autoOff } : {}), actions: { on, ...(off ? { off } : {}) } };
    } else if (x.kind === 'STATES') {
      const effects = validEffects(x.effects);
      if (!effects) continue;
      const m = validStates(x, effects);
      if (!m) continue;
      spec = { id, kind: 'STATES', role, durationMs, ...m, effects };
    } else if (x.kind === 'SEAT') {
      if (!Array.isArray(x.seats) || x.seats.length < 1 || x.seats.length > 8) continue;
      const seats = x.seats.map(validSeat);
      if (seats.some((s) => !s)) continue;
      spec = { id, kind: 'SEAT', role, durationMs, seats: seats as SeatAnchor[] };
    }
    if (!spec) continue;
    seen.add(id);
    out.push(spec);
  }
  return out;
}

export function validateCapabilities(raw: unknown): AssetCapability[] {
  if (!Array.isArray(raw)) return [...DEFAULT_CAPABILITIES];
  return raw.filter((c): c is AssetCapability => typeof c === 'string' && (ASSET_CAPABILITIES as readonly string[]).includes(c));
}

// ── Compiling to machines ───────────────────────────────────────────────

const axisVec = (axis: Axis, v: number): Vec3 => (axis === 'x' ? [v, 0, 0] : axis === 'y' ? [0, v, 0] : [0, 0, v]);

/** Every authoring form except SEAT, as the one thing the renderer runs. */
export function compileMachine(spec: InteractionSpec): Machine | null {
  const base = { id: spec.id, role: spec.role, durationMs: spec.durationMs };
  const door = spec.role === 'DOOR' || spec.role === 'BALCONY_DOOR';
  switch (spec.kind) {
    case 'HINGED':
    case 'SLIDING': {
      const key = spec.kind === 'HINGED' ? 'r' : 'p';
      const closed: StateDef = { id: 'CLOSED', parts: { [spec.id]: { [key]: [0, 0, 0] } }, ...(door ? { blocks: true } : {}) };
      const open: StateDef = { id: 'OPEN', parts: { [spec.id]: { [key]: axisVec(spec.axis, spec.open) } } };
      const raiseLower = spec.role === 'BLIND';
      return {
        ...base,
        states: new Map([['CLOSED', closed], ['OPEN', open]]),
        transitions: [
          { from: 'CLOSED', to: 'OPEN', action: raiseLower ? 'RAISE' : 'OPEN' },
          { from: 'OPEN', to: 'CLOSED', action: raiseLower ? 'LOWER' : 'CLOSE' },
        ],
        initial: spec.initiallyOpen ? 'OPEN' : 'CLOSED',
        effects: [],
        parts: [spec.id],
      };
    }
    case 'SWITCH': {
      const on: StateDef = { id: 'ON', effects: Object.fromEntries(spec.effects.map((e) => [e.id, 1])) };
      if (spec.autoOffMs) on.auto = { to: 'OFF', afterMs: spec.autoOffMs };
      const off: StateDef = { id: 'OFF', effects: {} };
      const transitions: Transition[] = [{ from: 'OFF', to: 'ON', action: spec.actions?.on ?? 'TURN_ON' }];
      if (!spec.autoOffMs) transitions.push({ from: 'ON', to: 'OFF', action: spec.actions?.off ?? 'TURN_OFF' });
      return {
        ...base,
        states: new Map([['OFF', off], ['ON', on]]),
        transitions,
        initial: spec.initiallyOn ? 'ON' : 'OFF',
        effects: spec.effects,
        parts: [...new Set(spec.effects.map((e) => e.part))],
      };
    }
    case 'STATES': {
      const parts = new Set<string>();
      for (const s of spec.states) for (const p of Object.keys(s.parts ?? {})) parts.add(p);
      for (const e of spec.effects ?? []) parts.add(e.part);
      return {
        ...base,
        states: new Map(spec.states.map((s) => [s.id, s])),
        transitions: spec.transitions,
        initial: spec.initial,
        effects: spec.effects ?? [],
        parts: [...parts],
      };
    }
    default:
      return null;
  }
}

/** The actions a visitor may take from a state, in declared order. */
export function actionsFrom(m: Machine, state: string): Transition[] {
  return m.transitions.filter((t) => t.from === state);
}

/** Whether a state reads as "open/on" (for hints and diagnostics). */
export function isActiveState(m: Machine, state: string): boolean {
  if (state === 'OPEN' || state === 'ON') return true;
  if (state === 'CLOSED' || state === 'OFF') return false;
  return state !== m.initial;
}

/** How long the move into `state` takes. */
export function enterDuration(m: Machine, state: string, reducedMotion = false): number {
  if (reducedMotion) return 0;
  const s = m.states.get(state);
  return s?.enterMs ?? m.durationMs;
}

/**
 * A part's full pose in a state. A part a state does not mention keeps the
 * pose it has in the machine's initial state (so a lid stays where the
 * state machine left it only when the state says so).
 */
export function poseIn(m: Machine, state: string, part: string): Required<Pick<PartPose, 'p' | 'r' | 's'>> & { tint?: string } {
  const own = m.states.get(state)?.parts?.[part];
  const fallback = m.states.get(m.initial)?.parts?.[part];
  const pose = own ?? fallback ?? {};
  return { p: pose.p ?? [0, 0, 0], r: pose.r ?? [0, 0, 0], s: pose.s ?? [1, 1, 1], ...(pose.tint ? { tint: pose.tint } : {}) };
}

export function effectIn(m: Machine, state: string, effect: string): number {
  return m.states.get(state)?.effects?.[effect] ?? 0;
}

// ── Motion ─────────────────────────────────────────────────────────────

/** Ease in and out: parts start and stop gently. */
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface Motion { from: number; to: number; start: number; duration: number }

/**
 * Where a scalar is (from … to) at `now`, and whether it has arrived.
 * Time-based: the same wall-clock duration at 30 or 144 fps.
 */
export function motionAt(m: Motion, now: number): { value: number; done: boolean } {
  const t = m.duration <= 0 ? 1 : Math.min(1, Math.max(0, (now - m.start) / m.duration));
  return { value: m.from + (m.to - m.from) * easeInOut(t), done: t >= 1 };
}

/**
 * Start moving toward the other end, from wherever the value is now; a
 * move reversed half-way takes only the time the remaining distance needs.
 */
export function toggleMotion(current: number, target: 0 | 1, durationMs: number, now: number, reducedMotion = false): Motion {
  const distance = Math.abs(target - current);
  return { from: current, to: target, start: now, duration: reducedMotion ? 0 : durationMs * distance };
}

/** Linear interpolation of vectors, for the renderer's pose blending. */
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
