import { useEffect, useId, useMemo, useRef } from 'react';
import { bindHomiRig, homiPose, homiSvg, type HomiCrop, type HomiState } from './homiRig';

/*
 * HOMI, 2D — the chat and panel character.
 *
 * Cheap on purpose: one inline SVG, transforms set on a few groups, at most
 * 30 frames a second, and only while it is on screen and the tab is visible.
 * With reduced motion the state is still shown (a thinking face is still a
 * thinking face) but nothing moves.
 */

function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export interface HomiAvatarProps {
  state?: HomiState;
  crop?: HomiCrop;
  /** CSS size of the box; the SVG fills it. */
  size?: number | string;
  className?: string;
  /** Accessible label. Omit when the avatar is decorative next to visible text. */
  label?: string;
  /** false = hold the state's resting pose (old messages in a long thread need not move). */
  animate?: boolean;
}

export function HomiAvatar({ state = 'idle', crop = 'head', size = 40, className, label, animate = true }: HomiAvatarProps) {
  const host = useRef<HTMLDivElement>(null);
  const stateRef = useRef<HomiState>(state);
  const startedAt = useRef<number>(0);
  const rawId = useId();
  const prefix = useMemo(() => `homi${rawId.replace(/[^a-zA-Z0-9]/g, '')}_`, [rawId]);
  const px = typeof size === 'number' ? size : 0;
  /* Under ~72px the glow filters cannot be seen but still cost a repaint. */
  const lite = px > 0 && px < 72;
  const markup = useMemo(() => homiSvg(prefix, crop, !lite), [prefix, crop, lite]);

  useEffect(() => {
    if (stateRef.current !== state) startedAt.current = performance.now();
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const rig = bindHomiRig(el);
    const still = !animate || prefersReducedMotion();
    startedAt.current = performance.now();
    rig.set(homiPose(stateRef.current, 0, still));
    if (still) {
      /* Reduced motion: re-pose only when the state changes. */
      let last = stateRef.current;
      const id = window.setInterval(() => {
        if (stateRef.current !== last) { last = stateRef.current; rig.set(homiPose(last, 0, true)); }
      }, 200);
      return () => window.clearInterval(id);
    }
    let raf = 0;
    let lastFrame = 0;
    let visible = true;
    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); })
      : null;
    io?.observe(el);
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!visible || document.hidden || now - lastFrame < 33) return;
      lastFrame = now;
      rig.set(homiPose(stateRef.current, (now - startedAt.current) / 1000));
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); io?.disconnect(); };
  }, [markup, animate]);

  const box = typeof size === 'number' ? `${size}px` : size;
  return (
    <div
      ref={host}
      className={className}
      data-homi-state={state}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ width: box, height: box, flexShrink: 0 }}
      // Markup is generated locally from constants; no user or model text reaches it.
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

export default HomiAvatar;
