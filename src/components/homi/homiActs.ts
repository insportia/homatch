/*
 * HOMI'S PERFORMANCE — what the live 3D model does in each state.
 *
 * Each state has several ACTS (different ways of being "thinking", "happy",
 * "surprised"...). One is picked at random when the state starts and, for
 * states that last, another is picked every few seconds, so HOMI never loops
 * the same movement. Every act drives the body AND the face: brows, eyes and
 * the LED mouth are separate parts of the model and move with the mood.
 *
 * An act is a pure function of seconds since it started → target pose. The
 * renderer eases toward it, so switching acts never snaps.
 *
 * Sign conventions (model space, camera in front):
 *   armL > 0 / armR < 0  raise the arm out to the side (L = HOMI's left = screen right)
 *   foreL > 0 / foreR < 0 bend the forearm the same way (hand up when the arm is out)
 *   fwdL / fwdR > 0      swing the arm toward the viewer; foreFwd* bends the forearm forward
 *   headX > 0 looks down, headY > 0 turns to screen right, headZ tilts
 *   lean > 0 leans toward the viewer, lift raises the whole body, turn spins it
 *   eyeScale 1 = normal (1.3 wide), squint 0..1 closes the eyes, browUp raises brows,
 *   browTilt > 0 = worried (inner ends up), < 0 = determined; mouthW/mouthH scale the mouth.
 */

import type { HomiState } from './homiStates';

export interface HomiPose {
  headX: number; headY: number; headZ: number;
  eyeX: number; eyeY: number; eyeScale: number; squint: number;
  browUp: number; browTilt: number; browAsym: number;
  mouthW: number; mouthH: number;
  armL: number; armR: number; foreL: number; foreR: number;
  fwdL: number; fwdR: number; foreFwdL: number; foreFwdR: number;
  /** Forearm twist about its own axis; ±π/2 turns the palm to face the viewer (a real wave). */
  twistL: number; twistR: number;
  lean: number; lift: number; turn: number;
}

export const REST: HomiPose = {
  headX: 0, headY: 0, headZ: 0, eyeX: 0, eyeY: 0, eyeScale: 1, squint: 0,
  browUp: 0, browTilt: 0, browAsym: 0, mouthW: 1, mouthH: 1,
  armL: 0.08, armR: -0.08, foreL: 0, foreR: 0, fwdL: 0, fwdR: 0, foreFwdL: 0, foreFwdR: 0, twistL: 0, twistR: 0,
  lean: 0, lift: 0, turn: 0,
};

type Act = (s: number) => Partial<HomiPose>;
const sin = Math.sin, PI = Math.PI;
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const pulse = (s: number, at: number, len: number) => Math.max(0, sin(Math.min(1, Math.max(0, (s - at) / len)) * PI));

/* A smile is a wider, slightly taller mouth; "O" is narrow and tall; small is both down. */
const SMILE = { mouthW: 1.25, mouthH: 1.25 };
const BIG_SMILE = { mouthW: 1.4, mouthH: 1.5 };
const O_MOUTH = { mouthW: 0.5, mouthH: 0.55 };
/* The LED mouth is a smile arc: flipping it vertically makes it a frown. */
const FROWN = { mouthW: 0.8, mouthH: -0.7 };
const SMALL = { mouthW: 0.75, mouthH: 0.7 };
/* Palm toward the viewer: the right forearm turns one way, the left the other. */
const PALM_R = { twistR: -PI / 2 };
const PALM_L = { twistL: PI / 2 };

const ACTS: Record<HomiState, Act[]> = {
  idle: [
    (s) => ({ headY: sin(s * 0.45) * 0.18, eyeX: sin(s * 0.9) * 0.6, headZ: sin(s * 0.3) * 0.04 }),
    (s) => ({ headY: 0.25, headX: -0.06, eyeX: 0.8, eyeY: -0.3, armL: 0.15 + sin(s * 1.2) * 0.04, ...SMILE }),
    (s) => ({ headZ: 0.12 * sin(s * 0.8), lean: 0.02 * sin(s * 0.8), eyeX: -0.5 + sin(s * 2.1) * 0.3 }),
  ],
  greeting: [
    (s) => ({ armR: -1.75, foreR: -1.13 + sin(s * 9) * 0.3, ...PALM_R, headZ: 0.08, headX: -0.05, ...BIG_SMILE, browUp: 0.6 }),
    (s) => ({ armL: 2.3, armR: -2.3, foreL: 0.4 + sin(s * 8) * 0.25, foreR: -0.4 - sin(s * 8) * 0.25, ...PALM_L, ...PALM_R, lift: Math.abs(sin(s * 5)) * 0.03, ...BIG_SMILE, browUp: 0.8 }),
    (s) => ({ headX: 0.25 * pulse(s, 0, 0.9), lean: 0.08 * pulse(s, 0, 0.9), armR: -1.6 * ease(s - 0.8), foreR: (-1.1 + sin(s * 9) * 0.3) * ease(s - 0.8), twistR: -PI / 2 * ease(s - 0.8), ...SMILE }),
  ],
  listening: [
    (s) => ({ headZ: 0.16, headX: 0.04 * sin(s * 2.2), eyeY: -0.2, browUp: 0.3, ...SMALL }),
    (s) => ({ armR: -1.05, foreR: -2.1, fwdR: 0.2, headZ: -0.1, headY: -0.15, browUp: 0.4 }),
    (s) => ({ lean: 0.06, headX: 0.06 + 0.05 * sin(s * 2.8), eyeScale: 1.08, browUp: 0.2 }),
  ],
  thinking: [
    // tapping the chin
    (s) => ({ fwdR: 0.95, foreFwdR: 1.75, armR: -0.2, foreR: -0.25 + sin(s * 7) * 0.08, headX: -0.12, headY: -0.12, eyeX: -0.6, eyeY: -0.8, browAsym: 0.7, ...SMALL }),
    // looking up and around
    (s) => ({ headX: -0.28, headY: sin(s * 0.9) * 0.3, eyeY: -1, eyeX: sin(s * 0.9) * 0.8, browUp: 0.7, ...SMALL }),
    // scratching the head
    (s) => ({ armL: 2.5, foreL: 1.5 + sin(s * 10) * 0.12, headZ: -0.12, eyeY: -0.5, eyeX: 0.4, browTilt: 0.5, mouthW: 0.85, mouthH: 0.8 }),
    // arms folded, weighing it up
    (s) => ({ fwdL: 0.5, fwdR: 0.5, foreFwdL: 1.6, foreFwdR: 1.6, foreL: -0.6, foreR: 0.6, headY: 0.18 * sin(s * 0.7), headX: 0.05, squint: 0.25, browTilt: -0.4 }),
  ],
  searching: [
    // scanning left and right
    (s) => ({ headY: sin(s * 1.7) * 0.55, eyeX: sin(s * 1.7 + 0.3), lean: 0.03, browTilt: -0.3, squint: 0.15 }),
    // hand shading the eyes, looking far
    (s) => ({ armR: -2.25, foreR: -2.25, fwdR: 0.25, headY: sin(s * 0.8) * 0.4, headX: -0.1, eyeX: sin(s * 0.8), squint: 0.35, lean: 0.05 }),
    // leaning in, focused
    (s) => ({ lean: 0.09, headX: 0.12, squint: 0.4, eyeX: sin(s * 3) * 0.6, eyeY: 0.3, browTilt: -0.5, fwdL: 0.3, fwdR: 0.3, foreFwdL: 0.6, foreFwdR: 0.6 }),
  ],
  surprised: [
    // jumps back, hands up
    (s) => ({ lift: 0.07 * pulse(s, 0, 0.45), lean: -0.1 * ease(s / 0.3), armL: 1.5, armR: -1.5, foreL: 1.4, foreR: -1.4, eyeScale: 1.35, browUp: 1.2, ...O_MOUTH, headX: -0.1 }),
    // hands to the face
    (s) => ({ fwdL: 1.0, fwdR: 1.0, foreFwdL: 1.9, foreFwdR: 1.9, foreL: -0.5, foreR: 0.5, eyeScale: 1.3, browUp: 1.1, ...O_MOUTH, headZ: 0.06 * sin(s * 6) }),
    // double take
    (s) => ({ headY: s < 0.35 ? 0.35 : s < 0.6 ? -0.05 : 0.1, eyeScale: s < 0.5 ? 1 : 1.32, browUp: s < 0.5 ? 0 : 1.1, ...(s < 0.5 ? {} : O_MOUTH), lean: -0.05 * ease((s - 0.5) * 3) }),
  ],
  happy: [
    // arms up, bouncing
    (s) => ({ armL: 2.5, armR: -2.5, foreL: 0.3, foreR: -0.3, lift: Math.abs(sin(s * 6)) * 0.04, ...BIG_SMILE, squint: 0.45, browUp: 0.5 }),
    // a little spin
    (s) => ({ turn: s < 1.1 ? ease(s / 1.1) * PI * 2 : 0, armL: 1.2, armR: -1.2, ...BIG_SMILE, squint: 0.4, lift: 0.02 * sin(s * 6) }),
    // clapping
    (s) => ({ fwdL: 0.75, fwdR: 0.75, foreFwdL: 1.1, foreFwdR: 1.1, foreL: -0.5 - 0.35 * Math.abs(sin(s * 8)), foreR: 0.5 + 0.35 * Math.abs(sin(s * 8)), ...BIG_SMILE, squint: 0.35, headZ: 0.08 * sin(s * 4) }),
  ],
  encouraging: [
    // thumbs-up and a nod
    (s) => ({ fwdL: 0.7, foreFwdL: 1.3, armL: 0.3, foreL: 0.4, headX: 0.12 * Math.abs(sin(s * 3)), ...SMILE, squint: 0.3, browUp: 0.3 }),
    // open, welcoming arms
    (s) => ({ armL: 0.75, armR: -0.75, foreL: 0.5, foreR: -0.5, fwdL: 0.25, fwdR: 0.25, headZ: 0.1, ...SMILE, browTilt: 0.25 }),
    // hand on heart
    (s) => ({ fwdR: 0.6, foreFwdR: 1.7, foreR: 0.8, headZ: -0.12, headX: 0.06 * sin(s * 2), ...SMILE, squint: 0.35, browTilt: 0.45 }),
  ],
  writing: [
    // typing
    (s) => ({ fwdL: 0.55, fwdR: 0.55, foreFwdL: 1.05 + 0.12 * sin(s * 18), foreFwdR: 1.05 + 0.12 * sin(s * 18 + 1.7), foreL: -0.35, foreR: 0.35, headX: 0.2, eyeY: 0.8, mouthH: 0.9 + 0.3 * Math.abs(sin(s * 7)) }),
    // typing, glancing up to check
    (s) => ({ fwdL: 0.55, fwdR: 0.55, foreFwdL: 1.05 + 0.1 * sin(s * 17), foreFwdR: 1.05 + 0.1 * sin(s * 17 + 2), foreL: -0.35, foreR: 0.35, headX: sin(s * 0.9) > 0.6 ? -0.05 : 0.2, eyeY: sin(s * 0.9) > 0.6 ? -0.2 : 0.8, ...SMILE }),
    // writing with one hand, nodding along
    (s) => ({ fwdR: 0.7, foreFwdR: 1.2, foreR: 0.3 + 0.1 * sin(s * 12), headX: 0.15 + 0.06 * sin(s * 3), eyeY: 0.7, eyeX: -0.3, mouthH: 0.9 + 0.25 * Math.abs(sin(s * 6)) }),
  ],
  explaining: [
    (s) => ({ armL: 0.5 + 0.15 * sin(s * 2.2), foreL: 0.9, fwdL: 0.35, mouthH: 1 + 0.5 * Math.abs(sin(s * 7)), browUp: 0.2 * sin(s * 1.3) }),
    (s) => ({ armL: 0.45, armR: -0.45, foreL: 0.8 + 0.2 * sin(s * 2.4), foreR: -0.8 - 0.2 * sin(s * 2.4 + 1), fwdL: 0.3, fwdR: 0.3, mouthH: 1 + 0.45 * Math.abs(sin(s * 6)), headY: 0.12 * sin(s) }),
    (s) => ({ fwdR: 0.8, foreFwdR: 0.6, armR: -0.4, headZ: 0.08, mouthW: 1.2, mouthH: 1.1 + 0.4 * Math.abs(sin(s * 8)) }),
  ],
  error: [
    // shrug
    (s) => ({ armL: 0.55, armR: -0.55, foreL: 1.3, foreR: -1.3, lift: 0.015 * pulse(s, 0.2, 0.8), headZ: -0.12, browTilt: 0.7, ...FROWN }),
    // a slow, sorry head shake
    (s) => ({ headY: 0.22 * sin(s * 3) * Math.max(0, 1 - s / 2.5), headX: 0.1, browTilt: 0.8, eyeY: 0.4, ...FROWN }),
  ],
  success: [
    (s) => ({ armL: 2.6, armR: -2.6, foreL: 0.2, foreR: -0.2, lift: 0.06 * pulse(s, 0, 0.5) + Math.abs(sin(s * 5)) * 0.015, ...BIG_SMILE, squint: 0.5, browUp: 0.6 }),
    (s) => ({ fwdL: 0.7, foreFwdL: 1.3, armL: 0.3, foreL: 0.4, armR: -2.3, foreR: -0.5, ...BIG_SMILE, squint: 0.45 }),
  ],
  goodbye: [
    (s) => ({ armR: -1.75, foreR: -1.13 + sin(s * 8) * 0.3, ...PALM_R, headZ: 0.1, ...SMILE, squint: 0.3 }),
  ],
  pointing: [() => ({ ...SMILE })],
};

/** States that last: a new act every few seconds keeps them alive. */
const ROTATES = new Set<HomiState>(['idle', 'thinking', 'searching', 'writing', 'listening', 'explaining', 'encouraging']);

export interface ActClock { state: HomiState; index: number; startedAt: number; nextSwitchAt: number }

export function startAct(state: HomiState, now: number, previous?: ActClock): ActClock {
  const acts = ACTS[state] ?? ACTS.idle;
  let index = Math.floor(Math.random() * acts.length);
  if (previous && previous.state === state && acts.length > 1 && index === previous.index) index = (index + 1) % acts.length;
  return { state, index, startedAt: now, nextSwitchAt: ROTATES.has(state) ? now + 3200 + Math.random() * 1800 : Number.POSITIVE_INFINITY };
}

export function actPose(clock: ActClock, now: number, still: boolean): HomiPose {
  const acts = ACTS[clock.state] ?? ACTS.idle;
  const s = still ? 0.9 : (now - clock.startedAt) / 1000;
  return { ...REST, ...acts[clock.index % acts.length](s) };
}
