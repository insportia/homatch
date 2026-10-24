import { useEffect, useRef } from 'react';
import { homiMotion, homiStillUrl, type HomiCrop, type HomiState } from './homiStates';

/*
 * HOMI at small sizes: a render of the 3D model in the requested pose.
 *
 * A gentle motion (breathing, a thinking sway, a happy bounce) runs through
 * the Web Animations API only while motion is allowed; with reduced motion
 * the pose alone carries the state. Images are tiny and cached, so switching
 * state is instant after the first time.
 */

function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export interface HomiAvatarProps {
  state?: HomiState;
  crop?: HomiCrop;
  /** CSS size of the box. */
  size?: number | string;
  className?: string;
  /** Accessible label. Omit when the avatar is decorative next to visible text. */
  label?: string;
  /** false = no motion (old messages in a long thread hold still). */
  animate?: boolean;
}

export function HomiAvatar({ state = 'idle', crop = 'head', size = 40, className, label, animate = true }: HomiAvatarProps) {
  const img = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const el = img.current;
    if (!el || !animate || prefersReducedMotion() || typeof el.animate !== 'function') return;
    const motion = homiMotion(state);
    if (!motion) return;
    const a = el.animate(motion.frames, { duration: motion.duration, iterations: Infinity, easing: 'ease-in-out' });
    return () => a.cancel();
  }, [state, animate]);

  const box = typeof size === 'number' ? `${size}px` : size;
  return (
    <div
      className={className}
      data-homi-state={state}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ width: box, height: box, flexShrink: 0 }}
    >
      <img
        ref={img}
        src={homiStillUrl(state, crop)}
        alt=""
        draggable={false}
        decoding="async"
        style={{ width: '100%', height: '100%', objectFit: 'contain', transformOrigin: '50% 90%' }}
      />
    </div>
  );
}

export default HomiAvatar;
