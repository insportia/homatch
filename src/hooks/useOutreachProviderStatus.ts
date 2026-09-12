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
 * Accept the payload only if it is actually the payload.
 *
 * This used to be a cast. A cast is a claim, and the claim was wrong for
 * anything the function might return that is not this shape — an empty
 * object, a partial rollout, an error body with a 200. Callers then read
 * `status.email.real`, and `status.email` was undefined, and the whole
 * Outreach page died into the error boundary: no campaigns, no
 * navigation, just "an application error has occurred".
 *
 * The hook already documented what to do when it cannot tell — return
 * null, and let callers fall back to the conservative assume-mock
 * messaging. This makes an unrecognised payload one of those cases
 * instead of a crash. It does not change what any channel is allowed to
 * do: an unknown status renders exactly as a disabled one already did.
 */
function asProviderStatus(data: unknown): OutreachProviderStatus | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const channel = (v: unknown) => Boolean(v) && typeof v === 'object' && 'real' in (v as object);
  if (!channel(d.email) || !channel(d.sms) || !channel(d.calling)) return null;
  return data as OutreachProviderStatus;
}

/**
 * Fetches the TRUE resolved sending status for each outreach channel from
 * outreach-provider-status (Task #62/#64) — not just the admin_settings
 * on/off flag, but whether the flag is on AND the provider's credentials are
 * actually configured server-side. Used to replace static "sending is
 * disabled" banners (which were always shown, even when an admin had truly
 * enabled real sending) with an honest, live status per page.
 *
 * Returns null while loading, on error, OR when the payload does not carry
 * all three channels — callers should treat null as
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
        if (!cancelled && !error) setStatus(asProviderStatus(data));
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
