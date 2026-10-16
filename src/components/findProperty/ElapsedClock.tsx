/*
 * Find Property — how long this search has run, from the server's timestamps.
 * Ticks once a second only while the search is running; a finished search
 * shows its final duration when the server supplies one, otherwise nothing.
 */
import { useEffect, useState } from 'react';
import { elapsedMs, type ElapsedInput, formatElapsed } from '@/findProperty/elapsed';
import type { T } from './format';

export function ElapsedClock({ t, search, className = '' }: { t: T; search: ElapsedInput; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (search.terminal) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [search.terminal]);
  const ms = elapsedMs(search, now);
  if (ms === null) return null;
  return <p className={`inline-flex items-baseline gap-1.5 text-xs ${className}`} data-elapsed>
    <span>{t(search.terminal ? 'fpp_elapsed_total' : 'fpp_elapsed_label')}</span>
    <time dir="ltr" className="font-semibold tabular-nums" dateTime={`PT${Math.floor(ms / 1000)}S`}>{formatElapsed(ms)}</time>
  </p>;
}
