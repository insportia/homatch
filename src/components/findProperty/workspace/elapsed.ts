/*
 * The search's running clock. It counts from the SERVER's start time
 * (search.createdAt), so it is right after a reload or on another device, and
 * it is a clock only: it never drives progress, which comes from server counts.
 */
import { useEffect, useState } from 'react';

/** Time since the search started, from the server's start time: it survives a reload and never resets. */
export function useElapsed(since: string, running: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), sec = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
