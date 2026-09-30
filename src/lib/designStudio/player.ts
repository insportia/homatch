// THE PLAYER — a person occupying the apartment, not a floating camera.
//
// The walkthrough's visitor is a body with a place, a heading, an eye
// height, a velocity and a posture. It walks at a person's pace, speeds up
// and slows down like one (never the instant start/stop of a debug camera),
// walks a little faster while Shift is held, collides as navigation.ts
// says (walls, closed doors, furniture, the edge of the space), and sits
// or lies down only where a piece offers a seat.
//
//   STANDING ─sit→ SITTING_DOWN ─arrive→ SEATED ─stand→ STANDING_UP ─arrive→ STANDING
//                  (or LYING_DOWN → LYING for a bed)
//
// Pure: the renderer feeds it input and time and draws where it is.

import { move, type WalkModel } from './navigation.ts';
import type { Point } from './space.ts';

export const WALK_SPEED_M_S = 1.35;
export const BRISK_SPEED_M_S = 2.2;
/** How quickly a walk builds up and eases off (m/s²): a step, not a jolt. */
export const ACCEL_M_S2 = 6.5;
export const DECEL_M_S2 = 9.0;
export const PITCH_MIN = -1.2;
export const PITCH_MAX = 1.0;
/** How far a person reaches to open, switch or sit (metres from the eye). */
export const REACH_M = 2.4;

export type Posture = 'STANDING' | 'SITTING_DOWN' | 'SEATED' | 'LYING_DOWN' | 'LYING' | 'STANDING_UP';

export interface PlayerSettings {
  /** 0.5 … 2: how far the view turns for a given mouse or finger movement. */
  lookSensitivity: number;
  /** 0.8 … 1.25: walking pace, within what still reads as walking. */
  speed: number;
  invertY: boolean;
  /** Optional; off by default. Moving right always turns right unless the visitor asks otherwise. */
  invertX: boolean;
  reducedMotion: boolean;
}

export const DEFAULT_SETTINGS: PlayerSettings = { lookSensitivity: 1, speed: 1, invertY: false, invertX: false, reducedMotion: false };

/** Settings from storage or a form, bounded to what is safe and comfortable. */
export function normalizeSettings(raw: unknown): PlayerSettings {
  const x = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    lookSensitivity: num(x.lookSensitivity, 0.5, 2, 1),
    speed: num(x.speed, 0.8, 1.25, 1),
    invertY: x.invertY === true,
    invertX: x.invertX === true,
    reducedMotion: x.reducedMotion === true,
  };
}

export interface MoveInput {
  /** −1 … 1, forward positive. */
  forward: number;
  /** −1 … 1, right positive. */
  strafe: number;
  brisk: boolean;
}

/**
 * The velocity the body wants for this input and heading (plan m/s).
 * Diagonals are not faster than straight lines.
 */
export function wishVelocity(input: MoveInput, yaw: number, settings: PlayerSettings): Point {
  const f = { x: Math.cos(yaw), y: Math.sin(yaw) };
  const r = { x: Math.sin(yaw), y: -Math.cos(yaw) };
  let x = f.x * input.forward + r.x * input.strafe;
  let y = f.y * input.forward + r.y * input.strafe;
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  const speed = (input.brisk ? BRISK_SPEED_M_S : WALK_SPEED_M_S) * settings.speed;
  return { x: x * speed, y: y * speed };
}

/** Velocity eased toward the wish: accelerating and decelerating at a person's rate. */
export function approachVelocity(vel: Point, wish: Point, dt: number): Point {
  const dx = wish.x - vel.x;
  const dy = wish.y - vel.y;
  const gap = Math.hypot(dx, dy);
  if (gap < 1e-6) return { ...wish };
  const speeding = Math.hypot(wish.x, wish.y) >= Math.hypot(vel.x, vel.y);
  const step = (speeding ? ACCEL_M_S2 : DECEL_M_S2) * dt;
  if (step >= gap) return { ...wish };
  return { x: vel.x + (dx / gap) * step, y: vel.y + (dy / gap) * step };
}

/**
 * One step of walking. The body moves as far as the space allows, and its
 * velocity becomes what it actually achieved — walking into a wall does not
 * store up speed that bursts out when the wall ends.
 */
export function stepBody(model: WalkModel, pos: Point, vel: Point, wish: Point, dt: number): { pos: Point; vel: Point } {
  const v = approachVelocity(vel, wish, dt);
  if (Math.hypot(v.x, v.y) < 1e-4) return { pos, vel: { x: 0, y: 0 } };
  const next = move(model, pos, { x: v.x * dt, y: v.y * dt });
  const achieved = dt > 0 ? { x: (next.x - pos.x) / dt, y: (next.y - pos.y) / dt } : v;
  return { pos: next, vel: achieved };
}

/** Turn the head by a pointer movement (pixels), per the visitor's settings. */
export function look(yaw: number, pitch: number, dxPx: number, dyPx: number, settings: PlayerSettings, radPerPx = 0.0026): { yaw: number; pitch: number } {
  const k = radPerPx * settings.lookSensitivity;
  const dy = settings.invertY ? -dyPx : dyPx;
  const dx = settings.invertX ? -dxPx : dxPx;
  return { yaw: yaw - dx * k, pitch: Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch - dy * k)) };
}

/** The posture a transition leads to, and where it settles. */
export function postureTransition(posture: Posture, event: 'SIT' | 'LIE' | 'STAND' | 'ARRIVED'): Posture {
  switch (event) {
    case 'SIT': return posture === 'STANDING' || posture === 'SEATED' || posture === 'LYING' ? 'SITTING_DOWN' : posture;
    case 'LIE': return posture === 'STANDING' || posture === 'SEATED' || posture === 'LYING' ? 'LYING_DOWN' : posture;
    case 'STAND': return posture === 'STANDING' ? posture : 'STANDING_UP';
    case 'ARRIVED':
      if (posture === 'SITTING_DOWN') return 'SEATED';
      if (posture === 'LYING_DOWN') return 'LYING';
      if (posture === 'STANDING_UP') return 'STANDING';
      return posture;
  }
}

/** Whether the legs can walk in this posture (a seated visitor stands up first). */
export const canWalk = (p: Posture) => p === 'STANDING';
