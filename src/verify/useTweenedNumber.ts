import { useEffect, useRef, useState } from 'react';

/**
 * A number that glides from its previous value to a new one.
 *
 * Presentation only: it never invents a value. It moves between two numbers
 * the server actually reported, so the credits panel reads as live motion
 * rather than a jump on every poll. Reduced motion (or a first render) shows
 * the target immediately.
 */
export function useTweenedNumber(target: number | null | undefined, durationMs = 1100): number | null {
  const goal = typeof target === 'number' && Number.isFinite(target) ? target : null;
  const [value, setValue] = useState<number | null>(goal);
  const from = useRef<number | null>(goal);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (goal === null) {
      from.current = null;
      setValue(null);
      return;
    }
    const start = from.current;
    const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (start === null || start === goal || reduced || typeof requestAnimationFrame === 'undefined') {
      from.current = goal;
      setValue(goal);
      return;
    }
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / durationMs);
      // easeOutCubic: quick to start, settles softly.
      const eased = 1 - Math.pow(1 - k, 3);
      const next = start + (goal - start) * eased;
      from.current = next;
      setValue(next);
      if (k < 1) frame.current = requestAnimationFrame(step);
      else from.current = goal;
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [goal, durationMs]);

  return value;
}
