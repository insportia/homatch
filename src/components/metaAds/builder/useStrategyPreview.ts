// The server's smart-strategy preview for the draft: structure, reasons,
// funding and creative advice. Refreshed after the fields that shape the
// plan settle, and only after the pending draft edits are saved — the
// server reads the draft row, never the browser's copy.
import { useEffect, useRef, useState } from 'react';
import { strategyPreview, type StrategyPreview } from '@/services/metaAds';

export function useStrategyPreview(campaignId: string | null, signature: string, flush: () => Promise<void>) {
  const [preview, setPreview] = useState<StrategyPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const req = useRef(0);

  useEffect(() => {
    if (!campaignId) return;
    const id = ++req.current;
    setLoading(true);
    const h = setTimeout(async () => {
      try {
        await flush();
        const r = await strategyPreview(campaignId);
        if (id !== req.current) return;
        setPreview(r); setFailed(false);
      } catch {
        if (id === req.current) setFailed(true);
      } finally {
        if (id === req.current) setLoading(false);
      }
    }, 900);
    return () => clearTimeout(h);
  }, [campaignId, signature]); // eslint-disable-line react-hooks/exhaustive-deps

  return { preview, loading, failed };
}
