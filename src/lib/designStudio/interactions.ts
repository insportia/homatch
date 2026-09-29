// WHAT CAN BE OPENED, AND EXACTLY HOW IT MOVES.
//
// A reusable, declarative interaction model for the walkthrough. An object
// (a floor-plan door or window, a catalogue wardrobe, a drawer, a fridge)
// exposes named PARTS; each part says how it may move:
//
//   HINGED   rotates about one axis through its pivot, from closed (0) to
//            `open` radians
//   SLIDING  translates along one axis, from closed (0) to `open` metres
//
// with a duration. The renderer never invents motion: a part moves only as
// its spec allows, time-based (never tied to frame rate) and eased.
//
// Walkthrough interaction is TEMPORARY: it lives in the 3D runtime, is never
// written to the design, and every visit starts from the canonical state.
// A model part is found by its node name `ix:<id>`; HOMATCH's concept blocks
// generate theirs, a licensed model declares them in its catalogue metadata.

export type InteractionKind = 'HINGED' | 'SLIDING';
export type InteractionRole = 'DOOR' | 'WINDOW' | 'WARDROBE' | 'CABINET' | 'DRAWER' | 'APPLIANCE';
export type Axis = 'x' | 'y' | 'z';

export interface InteractionSpec {
  id: string;
  kind: InteractionKind;
  role: InteractionRole;
  axis: Axis;
  /** Radians (HINGED) or metres (SLIDING) from closed to fully open. */
  open: number;
  durationMs: number;
  /** Starts open (a floor-plan door stands open by default). */
  initiallyOpen?: boolean;
}

export const ASSET_CAPABILITIES = ['MOVABLE', 'ROTATABLE', 'REPLACEABLE', 'HIDEABLE', 'OPENABLE', 'SLIDABLE', 'INTERACTIVE'] as const;
export type AssetCapability = typeof ASSET_CAPABILITIES[number];
export const DEFAULT_CAPABILITIES: AssetCapability[] = ['MOVABLE', 'ROTATABLE', 'REPLACEABLE'];

const ROLES = new Set<InteractionRole>(['DOOR', 'WINDOW', 'WARDROBE', 'CABINET', 'DRAWER', 'APPLIANCE']);
const MAX_ANGLE = 2.2; // a little over 120°
const MAX_SLIDE_M = 1.0;
export const MAX_PARTS = 24;

/** Declared interactions, bounded; anything outside the model's limits is dropped, never clamped silently into something else. */
export function validateInteractions(raw: unknown): InteractionSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: InteractionSpec[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, MAX_PARTS)) {
    const x = (r ?? {}) as Record<string, unknown>;
    const id = typeof x.id === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(x.id) ? x.id : null;
    const kind = x.kind === 'HINGED' || x.kind === 'SLIDING' ? x.kind : null;
    const role = typeof x.role === 'string' && ROLES.has(x.role as InteractionRole) ? x.role as InteractionRole : null;
    const axis = x.axis === 'x' || x.axis === 'y' || x.axis === 'z' ? x.axis : null;
    const open = typeof x.open === 'number' && Number.isFinite(x.open) ? x.open : null;
    const duration = typeof x.durationMs === 'number' && Number.isFinite(x.durationMs) ? x.durationMs : 700;
    if (!id || !kind || !role || !axis || open === null || open === 0 || seen.has(id)) continue;
    if (kind === 'HINGED' && Math.abs(open) > MAX_ANGLE) continue;
    if (kind === 'SLIDING' && Math.abs(open) > MAX_SLIDE_M) continue;
    seen.add(id);
    out.push({ id, kind, role, axis, open, durationMs: Math.min(2000, Math.max(150, duration)), initiallyOpen: x.initiallyOpen === true });
  }
  return out;
}

export function validateCapabilities(raw: unknown): AssetCapability[] {
  if (!Array.isArray(raw)) return [...DEFAULT_CAPABILITIES];
  return raw.filter((c): c is AssetCapability => typeof c === 'string' && (ASSET_CAPABILITIES as readonly string[]).includes(c));
}

/** Ease in and out: parts start and stop gently. */
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface Motion { from: number; to: number; start: number; duration: number }

/**
 * Where a part is (0 closed … 1 open) at `now`, and whether it is still
 * moving. Time-based: the same wall-clock duration at 30 or 144 fps.
 */
export function motionAt(m: Motion, now: number): { value: number; done: boolean } {
  const t = m.duration <= 0 ? 1 : Math.min(1, Math.max(0, (now - m.start) / m.duration));
  return { value: m.from + (m.to - m.from) * easeInOut(t), done: t >= 1 };
}

/**
 * Start moving toward the other state, from wherever the part is now; a
 * part reversed half-way takes only the time the remaining distance needs.
 */
export function toggleMotion(current: number, target: 0 | 1, durationMs: number, now: number, reducedMotion = false): Motion {
  const distance = Math.abs(target - current);
  return { from: current, to: target, start: now, duration: reducedMotion ? 0 : durationMs * distance };
}
