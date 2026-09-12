import { useEffect, useState } from 'react';
import { type MotionLevel, motionLevel } from '@/lib/motion';

/**
 * How much this visit is allowed to move.
 *
 * Reads the three media queries and the data-saver hint, and subscribes to
 * all of them — a preference can change while the app is open, and on a
 * tablet the orientation change that crosses the width breakpoint is a
 * routine thing rather than an edge case.
 *
 * The rules themselves are in lib/motion.ts, which has no React in it and is
 * tested directly. This only gathers the inputs.
 */
export function useMotion(): MotionLevel {
  const [level, setLevel] = useState<MotionLevel>(() => read());
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const queries = QUERIES.map(q => window.matchMedia(q));
    const update = () => setLevel(read());
    // Re-read on mount as well: the first paint may have happened before
    // hydration, and a stale level would leave elements hidden.
    update();
    for (const q of queries) q.addEventListener('change', update);
    return () => { for (const q of queries) q.removeEventListener('change', update); };
  }, []);
  return level;
}

const QUERIES = [
  '(prefers-reduced-motion: reduce)',
  '(pointer: coarse)',
  '(max-width: 767px)',
];

function read(): MotionLevel {
  // Server, or a browser old enough to lack matchMedia: assume the most
  // restrained option rather than animating at something we cannot measure.
  if (typeof window === 'undefined' || !window.matchMedia) return 'none';
  const [reduced, coarse, narrow] = QUERIES.map(q => window.matchMedia(q).matches);
  // Non-standard and absent in Safari and Firefox, which is why it is read
  // defensively rather than typed onto Navigator.
  const saveData = Boolean(
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData,
  );
  return motionLevel({
    reducedMotion: reduced, coarsePointer: coarse, narrow, saveData,
  });
}
