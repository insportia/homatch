import { useEffect, useState } from 'react';
import { supabase } from '@/db/supabase';

export interface ChannelStatus {
  flag_enabled: boolean;
  real: boolean;
  provider: string;
}

export interface OutreachProviderStatus {
  kill_switch: boolean;
  email: ChannelStatus;
  sms: ChannelStatus;
  calling: ChannelStatus;
}

/**
 * Fetches the TRUE resolved sending status for each outreach channel from
 * outreach-provider-status (Task #62/#64) — not just the admin_settings
 * on/off flag, but whether the flag is on AND the provider's credentials are
 * actually configured server-side. Used to replace static "sending is
 * disabled" banners (which were always shown, even when an admin had truly
 * enabled real sending) with an honest, live status per page.
 *
 * Returns null while loading or on error — callers should treat null as
 * "unknown" and fall back to the conservative (assume-mock) messaging rather
 * than claiming a state that hasn't been confirmed.
 */
export function useOutreachProviderStatus() {
  const [status, setStatus] = useState<OutreachProviderStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('outreach-provider-status', { body: {} });
        if (!cancelled && !error && data) setStatus(data as OutreachProviderStatus);
      } catch {
        // Leave status null — callers fall back to conservative messaging.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { status, loading };
}
