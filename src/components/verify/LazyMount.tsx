// HOMATCH Verify — mount a heavy report section only when the reader nears it.
//
// A finished report opens with its summary; sections far below the fold (the
// official document library of a large project: 19 cases, 373 files for job
// 8ba97da9) are built when they come within `margin` of the viewport, not on
// first paint. The placeholder keeps a stable height so the page does not
// jump, and the chapter heading (with its anchor) is always rendered by the
// caller, so in-page navigation still lands and mounts it. Without
// IntersectionObserver (old browsers, print, tests) the content mounts at once.

import React from 'react';

export function LazyMount({ children, minHeight = '16rem', margin = '1200px 0px' }: { children: React.ReactNode; minHeight?: string; margin?: string }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = React.useState(() => typeof window === 'undefined' || typeof window.IntersectionObserver !== 'function');
  React.useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    let io: IntersectionObserver | null = null;
    try {
      io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io?.disconnect();
        }
      }, { rootMargin: margin });
      io.observe(el);
    } catch {
      setShown(true);
    }
    const onPrint = () => setShown(true);
    window.addEventListener('beforeprint', onPrint);
    return () => {
      io?.disconnect();
      window.removeEventListener('beforeprint', onPrint);
    };
  }, [shown, margin]);
  if (shown) return <>{children}</>;
  return <div ref={ref} aria-hidden="true" style={{ minHeight }} data-lazy-section="" />;
}
