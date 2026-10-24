import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { HomiAvatar } from './HomiAvatar';
import type { HomiGesture } from './HomiStage3D';
import type { HomiState } from './homiRig';

/*
 * The homepage's HOMI, in a box whose size never changes.
 *
 * The 2D HOMI shows immediately (it is a few kilobytes of SVG). The 3D stage
 * — three.js plus the 324 KB model — is fetched only when the section comes
 * within reach of the viewport, and fades in over the 2D one once it has
 * actually rendered. No WebGL, a failed load, or Save-Data: the 2D HOMI simply
 * stays. Nothing here is in the initial bundle.
 */

const HomiStage3D = lazy(() => import('./HomiStage3D'));

function canUse3D(): boolean {
  try {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
    if (nav.connection?.saveData) return false;
    if (typeof nav.deviceMemory === 'number' && nav.deviceMemory < 2) return false;
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

const AVATAR_STATE: Record<HomiGesture, HomiState> = {
  idle: 'idle', greeting: 'greeting', pointing: 'pointing', explaining: 'explaining', happy: 'happy',
};

export function HomiHomeStage({ gesture, pointTo = 1, className }: { gesture: HomiGesture; pointTo?: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || !canUse3D()) return;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={box} className={`relative ${className ?? ''}`} data-homi-stage={failed ? '2d' : ready ? '3d' : 'pending'}>
      <div className={`absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none ${ready && !failed ? 'opacity-0' : 'opacity-100'}`}>
        <HomiAvatar state={AVATAR_STATE[gesture]} crop="full" size="100%" label="HOMI" />
      </div>
      {near && !failed && (
        <Suspense fallback={null}>
          <HomiStage3D
            gesture={gesture}
            pointTo={pointTo}
            onFail={() => setFailed(true)}
            onReady={() => setReady(true)}
            className={`absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none ${ready ? 'opacity-100' : 'opacity-0'}`}
          />
        </Suspense>
      )}
    </div>
  );
}

export default HomiHomeStage;
