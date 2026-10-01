import { useCallback, useEffect, useRef, useState } from 'react';
import { LIST_PAGE, nextShown, shownCount } from '@/lib/designStudio/incrementalList';

/**
 * Draw a long list a page at a time. `resetKey` (the query, the category…)
 * starts again from one page. The returned `sentinelRef` goes on an element
 * after the last row: when it scrolls into view the next page is drawn.
 */
export function useIncrementalList(total: number, resetKey: string, page = LIST_PAGE) {
  const [requested, setRequested] = useState(page);
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  const totalRef = useRef(total);
  totalRef.current = total;

  useEffect(() => { setRequested(page); }, [resetKey, page]);

  const more = useCallback(() => setRequested((r) => nextShown(r, totalRef.current, page)), [page]);

  const shown = shownCount(total, requested, page);
  const hasMore = shown < total;

  useEffect(() => {
    if (!sentinel || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) more();
    }, { rootMargin: '200px 0px' });
    io.observe(sentinel);
    return () => io.disconnect();
  }, [sentinel, hasMore, more, shown]);

  return { shown, hasMore, more, sentinelRef: setSentinel };
}
