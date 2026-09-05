import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';

/**
 * Counts a number up from 0 to `value` once the returned ref scrolls into
 * view. Respects prefers-reduced-motion by snapping straight to the final
 * value. Cheap: a single rAF loop, no layout reads per frame.
 */
export function useCountUp(value: number, durationMs = 900) {
  const ref = useRef<HTMLElement | null>(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(eased * value));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, durationMs, reduce]);

  return { ref, value: display };
}
