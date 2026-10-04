// Bring in the listing photos the first import missed, from the still-live
// source page. Runs once by itself when an imported property holds a single
// photo (the 2026-10-04 MyHome case), and is offered as an action otherwise.
// Same property; nothing an owner added is removed.
import React, { useEffect, useRef, useState } from 'react';
import { Images, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { refreshPropertyMedia } from '@/services/propertyLifecycle';

const AUTO_DOMAINS = /(^|\.)myhome\.ge$|(^|\.)ss\.ge$/i;

export function MediaRefresh({ propertyId, storedCount, sourceDomain, onRefreshed }: {
  propertyId: string; storedCount: number; sourceDomain: string | null; onRefreshed: () => void;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const autoTried = useRef(false);

  const run = async (auto: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await refreshPropertyMedia(propertyId);
      if (r.refreshed && r.stored > storedCount) {
        toast.success(t('fbl_media_refreshed', { n: String(r.stored) }));
        onRefreshed();
      } else if (!auto) {
        toast.info(t(r.reason === 'RECENT' ? 'fbl_media_recent' : 'fbl_media_nothing_new'));
      }
    } catch {
      if (!auto) toast.error(t('fbl_media_failed'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (autoTried.current || storedCount > 1 || !sourceDomain || !AUTO_DOMAINS.test(sourceDomain)) return;
    autoTried.current = true;
    let key = '';
    try { key = `hm-media-refresh:${propertyId}`; if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* storage blocked: one try per mount */ }
    void run(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, storedCount, sourceDomain]);

  return (
    <button type="button" onClick={() => void run(false)} disabled={busy}
      className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-white px-3 text-2xs font-semibold text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(40_70%_80%)] hover:ring-[hsl(38_92%_50%)] disabled:opacity-70">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Images className="h-3.5 w-3.5 text-[hsl(34_90%_40%)]" aria-hidden="true" />}
      {t(busy ? 'fbl_media_refreshing' : 'fbl_media_refresh')}
    </button>
  );
}

export default MediaRefresh;
