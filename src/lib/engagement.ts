import { supabase } from '@/db/supabase';
import { currentAnonymousToken } from '@/services/anonymousSession';
import { isIOS, isIOSSafari, isStandalone } from '@/lib/pwa';

/*
 * THE INSTALL AND PUSH FUNNEL.
 *
 * WHY A CONFIDENCE LEVEL IS PART OF EVERY EVENT
 *
 * The browser does not tell a web page that an install succeeded. Chromium
 * fires `appinstalled`; iOS fires nothing at all, because installing there is
 * a Share-menu gesture the page never observes. A funnel that reports "1,400
 * installs" without saying how it knows is a funnel that will be believed and
 * should not be.
 *
 *   CONFIRMED  the browser said so — `appinstalled`, or a userChoice of
 *              'accepted'.
 *   DETECTED   measured right now — `display-mode: standalone` currently
 *              matches, so this session IS running as the app.
 *   INFERRED   deduced — the first standalone launch implies an install that
 *              was never observed. True, and worth less.
 *
 * Nothing records an install because somebody clicked the button. That click
 * is its own event and stays its own event.
 *
 * WHAT IS NOT COLLECTED
 *
 * No user agent string, no screen metrics, no IP, no new identifier. Platform
 * and browser are five- and four-value buckets, wide enough to answer "is
 * Safari failing" and too coarse to single anybody out. The anonymous id is
 * the one the product already issues for signed-out visitors.
 *
 * WHY FAILURE IS SILENT
 *
 * This is telemetry about a button. A blocked request, an ad blocker, a
 * missing table on an environment that has not migrated — none of those are
 * worth an error in front of a customer, and none of them should stop the
 * install they were about to do.
 */

export type PwaEvent =
  | 'PWA_AFFORDANCE_VIEWED'
  | 'PWA_INSTALL_CLICKED'
  | 'PWA_NATIVE_PROMPT_AVAILABLE'
  | 'PWA_NATIVE_PROMPT_SHOWN'
  | 'PWA_NATIVE_PROMPT_ACCEPTED'
  | 'PWA_NATIVE_PROMPT_DISMISSED'
  | 'PWA_IOS_INSTRUCTIONS_SHOWN'
  | 'PWA_STANDALONE_DETECTED'
  | 'PWA_FIRST_STANDALONE_LAUNCH'
  | 'PWA_RETURNING_STANDALONE_SESSION'
  | 'PUSH_PERMISSION_REQUESTED'
  | 'PUSH_PERMISSION_GRANTED'
  | 'PUSH_PERMISSION_DENIED'
  | 'PUSH_PERMISSION_DISMISSED'
  | 'PUSH_SUBSCRIPTION_CREATED'
  | 'PUSH_SUBSCRIPTION_INVALIDATED';

export type Confidence = 'CONFIRMED' | 'DETECTED' | 'INFERRED';

/** Five buckets. Anything else is OTHER rather than a longer tail. */
export function platformBucket(): 'IOS' | 'ANDROID' | 'MAC' | 'WINDOWS' | 'OTHER' {
  if (typeof navigator === 'undefined') return 'OTHER';
  if (isIOS()) return 'IOS';
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'ANDROID';
  if (/Macintosh/i.test(ua)) return 'MAC';
  if (/Windows/i.test(ua)) return 'WINDOWS';
  return 'OTHER';
}

/** Four buckets, chosen because they are the four that behave differently. */
export function browserBucket(): 'SAFARI' | 'CHROMIUM' | 'FIREFOX' | 'OTHER' {
  if (typeof navigator === 'undefined') return 'OTHER';
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return 'FIREFOX';
  // Order matters: every Chromium browser also says "Safari".
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'CHROMIUM';
  if (/Safari\//.test(ua)) return 'SAFARI';
  return 'OTHER';
}

/** Events already sent this page view, so a re-render is not a second view. */
const sentThisView = new Set<string>();

export async function recordPwaEvent(
  event: PwaEvent,
  confidence: Confidence,
  opts: { source?: string; once?: boolean } = {},
): Promise<void> {
  if (typeof window === 'undefined') return;

  const key = `${event}:${opts.source ?? ''}`;
  if (opts.once !== false) {
    if (sentThisView.has(key)) return;
    sentThisView.add(key);
  }

  try {
    const { data } = await supabase.auth.getSession();
    const authId = data.session?.user?.id ?? null;
    /* The row references public.users.id, not the auth id, so an unresolved
       profile is recorded as an anonymous event rather than as a broken FK. */
    let userId: string | null = null;
    if (authId) {
      const { data: row } = await supabase
        .from('users').select('id').eq('auth_id', authId).maybeSingle();
      userId = row?.id ?? null;
    }

    await supabase.from('pwa_events').insert({
      event,
      confidence,
      user_id: userId,
      anon_id: userId ? null : (currentAnonymousToken() ?? null),
      platform: platformBucket(),
      browser: browserBucket(),
      locale: (localStorage.getItem('homatch_lang') ?? '').slice(0, 8) || null,
      standalone: isStandalone(),
      source: opts.source?.slice(0, 40) ?? null,
    });
  } catch {
    /* Telemetry about a button. Never worth an error in front of anybody. */
  }
}

/* ------------------------------------------------------------------ *
 * STANDALONE SESSIONS                                                 *
 * ------------------------------------------------------------------ */

const STANDALONE_SEEN = 'homatch_standalone_seen';

/**
 * Called once per app start.
 *
 * A first standalone launch is the closest thing to an install signal iOS
 * will ever give, and it is INFERRED: the install happened at some earlier
 * moment this page never saw. Every subsequent launch is a returning session,
 * which is a retention number rather than an acquisition one — conflating the
 * two is how a funnel reports more installs than it has devices.
 */
export function recordStandaloneSession(): void {
  if (typeof window === 'undefined' || !isStandalone()) return;
  void recordPwaEvent('PWA_STANDALONE_DETECTED', 'DETECTED', { source: 'boot' });
  try {
    if (localStorage.getItem(STANDALONE_SEEN)) {
      void recordPwaEvent('PWA_RETURNING_STANDALONE_SESSION', 'DETECTED', { source: 'boot' });
    } else {
      localStorage.setItem(STANDALONE_SEEN, String(Date.now()));
      void recordPwaEvent('PWA_FIRST_STANDALONE_LAUNCH', 'INFERRED', { source: 'boot' });
    }
  } catch {
    /* A browser with storage disabled still gets the DETECTED event above. */
  }
}

/** iOS has no install event of any kind, and the funnel has to say so. */
export function iosCannotConfirmInstall(): boolean {
  return isIOSSafari();
}
