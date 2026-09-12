/**
 * THE MOTION SYSTEM.
 *
 * One place that decides how much this product is allowed to move, so that
 * every animation in it answers the same question the same way instead of
 * each component inventing a duration and hoping.
 *
 * THREE LEVELS, NOT TWO
 *
 * "Respects prefers-reduced-motion" usually means a switch: animation, or no
 * animation. That is the right answer for somebody who asked the operating
 * system to stop moving things, and the wrong answer for a phone. A 24px
 * rise that reads as poised on a desktop reads as a jolt on a 390px screen,
 * where the same distance is a much larger share of what you can see, and
 * where the device has less to spend rendering it. So a phone gets shorter,
 * smaller, unstaggered motion rather than either extreme.
 *
 * WHY THIS FILE HAS NO REACT IN IT
 *
 * The rules are the part worth being sure about, and a .ts module runs
 * directly under node --test. The hook that reads the media queries is in
 * useMotion.ts; it does nothing but feed this.
 */

export type MotionLevel = 'full' | 'simplified' | 'none';

export interface MotionInputs {
  /** The OS-level request to stop moving things. Always decisive. */
  reducedMotion: boolean;
  /** A touch screen — no hover, imprecise pointer. */
  coarsePointer: boolean;
  /** Below the tablet breakpoint. */
  narrow: boolean;
  /** The browser's data-saver flag, where it exists. */
  saveData: boolean;
}

/**
 * How much movement this visit gets.
 *
 * `reducedMotion` wins over everything: it is an explicit request from the
 * person using the product, and nothing here is important enough to override
 * it. Data-saver is treated the same way — somebody on a metered or failing
 * connection is not asking for decorative work.
 */
export function motionLevel(i: MotionInputs): MotionLevel {
  if (i.reducedMotion || i.saveData) return 'none';
  if (i.narrow || i.coarsePointer) return 'simplified';
  return 'full';
}

export interface RevealShape {
  /** How far the element travels, in pixels. */
  distance: number;
  /** How long it takes, in milliseconds. */
  duration: number;
  /** Added per sibling, so a group arrives in order rather than at once. */
  stagger: number;
}

/**
 * The shape of a scroll reveal at a given level.
 *
 * At 'none' every number is zero, which is what makes the reveal component
 * safe to render unconditionally: the element is simply there, with no
 * transition to interrupt and no observer to wait for.
 */
export function revealShape(level: MotionLevel): RevealShape {
  if (level === 'none') return { distance: 0, duration: 0, stagger: 0 };
  if (level === 'simplified') return { distance: 10, duration: 340, stagger: 0 };
  return { distance: 22, duration: 520, stagger: 70 };
}

/**
 * Durations for everything that is not a scroll reveal, in milliseconds.
 *
 * Named for what they are for rather than how long they are, so a component
 * asks for "the duration of a thing appearing" and gets the same answer as
 * every other component that asks.
 */
export const DURATION = {
  /** Hover, focus, a button depressing. Must feel instant. */
  instant: 120,
  /** A control changing state: a switch, a tab underline. */
  control: 180,
  /** A panel, sheet or dialog arriving. */
  surface: 260,
  /** Something crossing the screen, or a long list reflowing. */
  page: 380,
} as const;

/**
 * Easings, as CSS timing functions.
 *
 * `exit` is faster out than in on purpose: leaving should not make somebody
 * wait for a thing they have already dismissed.
 */
export const EASING = {
  /** Arriving: decelerates into place. */
  enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** Leaving: gets out of the way. */
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  /** Moving between two on-screen states. */
  move: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

export type DurationName = keyof typeof DURATION;

/**
 * A duration, scaled to the level.
 *
 * Never returns 0 for anything but 'none': a 1ms transition and no
 * transition are different in one way that matters, which is that the first
 * still fires transitionend and the second does not. At 'none' the caller
 * wants nothing to happen at all, so 0 is correct there and only there.
 */
export function durationFor(name: DurationName, level: MotionLevel): number {
  if (level === 'none') return 0;
  const base = DURATION[name];
  return level === 'simplified' ? Math.round(base * 0.75) : base;
}

/** A ready-made `transition` value, or 'none' when nothing should move. */
export function transitionFor(
  properties: string, name: DurationName, level: MotionLevel, easing: keyof typeof EASING = 'move',
): string {
  const ms = durationFor(name, level);
  return ms === 0 ? 'none' : `${properties} ${ms}ms ${EASING[easing]}`;
}
