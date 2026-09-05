import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';

/**
 * Restrained perspective tilt + cursor-follow highlight for premium cards.
 * Desktop (fine pointer) only, capped rotation, transform/opacity only —
 * no layout-triggering properties. A no-op on touch and reduced-motion.
 */
export function useTiltHover<T extends HTMLElement>(maxDeg = 3.5) {
  const ref = useRef<T | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduce) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;

    let raf = 0;
    el.style.setProperty('--tilt-x', '50%');
    el.style.setProperty('--tilt-y', '50%');

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.transition = 'transform 0.1s ease-out';
        const rx = (py - 0.5) * -2 * maxDeg;
        const ry = (px - 0.5) * 2 * maxDeg;
        el.style.transform = `perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(0)`;
        el.style.setProperty('--tilt-x', `${px * 100}%`);
        el.style.setProperty('--tilt-y', `${py * 100}%`);
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(raf);
      el.style.transition = 'transform 0.4s cubic-bezier(0.22,1,0.36,1)';
      el.style.transform = 'perspective(700px) rotateX(0deg) rotateY(0deg) translateZ(0)';
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [maxDeg, reduce]);

  return ref;
}
