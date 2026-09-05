import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';

/**
 * Restrained "magnetic" pointer response for premium buttons — the element
 * drifts a few px toward the cursor while hovered. Desktop (fine pointer)
 * only; a no-op on touch devices and when the user prefers reduced motion.
 * Pure transform, no layout reads beyond one getBoundingClientRect per
 * pointermove (cheap for a single button-sized element).
 */
export function useMagneticHover<T extends HTMLElement>(strength = 0.25, max = 8) {
  const ref = useRef<T | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduce) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;

    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const relX = e.clientX - (rect.left + rect.width / 2);
      const relY = e.clientY - (rect.top + rect.height / 2);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.transition = 'transform 0.12s ease-out';
        const tx = Math.max(-max, Math.min(max, relX * strength));
        const ty = Math.max(-max, Math.min(max, relY * strength));
        el.style.transform = `translate(${tx}px, ${ty}px)`;
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(raf);
      el.style.transition = 'transform 0.35s cubic-bezier(0.22,1,0.36,1)';
      el.style.transform = 'translate(0px, 0px)';
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [strength, max, reduce]);

  return ref;
}
