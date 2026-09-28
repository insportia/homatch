import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * The one line the customer sees when a new build is live: a quiet offer to
 * reload, never a forced reload — a swap under a half-written form would be
 * worse than one more session on the old build. Navigations are
 * network-first in the worker, so declining just means the NEXT open is the
 * new version anyway.
 */
export function SwUpdateToast() {
  const { t } = useLanguage();
  const shown = useRef(false);

  useEffect(() => {
    const onReady = () => {
      if (shown.current) return; // one offer per session, not a nag
      shown.current = true;
      toast(t('pwa_update_ready'), {
        duration: Infinity,
        action: {
          label: t('pwa_update_action'),
          onClick: () => window.location.reload(),
        },
      });
    };
    window.addEventListener('homatch:sw-update-ready', onReady);
    return () => window.removeEventListener('homatch:sw-update-ready', onReady);
  }, [t]);

  return null;
}
