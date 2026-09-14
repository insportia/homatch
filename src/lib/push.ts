import { supabase } from '@/db/supabase';
import { recordPwaEvent, platformBucket, browserBucket } from '@/lib/engagement';
import { isStandalone } from '@/lib/pwa';

/*
 * WEB PUSH, FROM THE BROWSER'S SIDE.
 *
 * THE TWO-STEP PERMISSION, AND WHY IT IS NOT OPTIONAL
 *
 * `Notification.requestPermission()` can only be asked once per origin, ever.
 * A visitor who says no cannot be asked again by any means the page has — the
 * browser remembers, and the only way back is through site settings most
 * people will never open. So firing it on first load is not merely rude; it
 * spends the single chance the product gets, on somebody who has not yet seen
 * a reason to say yes.
 *
 * Hence the soft prompt. Homatch asks, in its own words, in a context where
 * the answer is obvious ("tell me when my verification is ready"). Only an
 * explicit yes reaches the browser dialog. A no costs nothing and can be
 * asked again another day, which the native dialog cannot.
 *
 * WHAT THE SERVER NEEDS, AND WHAT IT MUST NEVER HAVE
 *
 * A subscription is an endpoint plus two keys the browser generates. Together
 * they are the ability to send that device a notification, which is why the
 * table they land in is readable by nobody but its owner and service_role.
 *
 * The VAPID PRIVATE key is never in this file, this bundle, or any bundle. It
 * lives in the sending function's environment. The PUBLIC key is here, by
 * design: it is what `applicationServerKey` takes, and a public key is public.
 */

export type PushPermission =
  | 'NOT_ASKED'
  | 'SOFT_PROMPT_SHOWN'
  | 'GRANTED'
  | 'DENIED'
  | 'DISMISSED'
  | 'UNSUPPORTED';

const SOFT_STATE = 'homatch_push_soft_state';

/** Does this browser have the three things web push needs? */
export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/**
 * Where this visitor stands, from the browser plus our own record.
 *
 * The browser knows granted/denied/default. It does not know whether WE have
 * asked softly, and "default" covers both "never seen an offer" and "saw the
 * offer and said not now" — which need different behaviour, so the second is
 * stored on our side.
 */
export function pushPermission(): PushPermission {
  if (!pushSupported()) return 'UNSUPPORTED';
  const native = Notification.permission;
  if (native === 'granted') return 'GRANTED';
  if (native === 'denied') return 'DENIED';
  try {
    const soft = localStorage.getItem(SOFT_STATE);
    if (soft === 'dismissed') return 'DISMISSED';
    if (soft === 'shown') return 'SOFT_PROMPT_SHOWN';
  } catch { /* storage off: treat as never asked */ }
  return 'NOT_ASKED';
}

export function markSoftPromptShown(): void {
  try { localStorage.setItem(SOFT_STATE, 'shown'); } catch { /* ignore */ }
}

/**
 * "Not now."
 *
 * Deliberately not permanent and deliberately not a native denial: the point
 * of the soft prompt is that saying no here is cheap. The date is kept so the
 * offer can wait a sensible while rather than reappearing on the next screen.
 */
export function dismissSoftPrompt(): void {
  try { localStorage.setItem(SOFT_STATE, 'dismissed'); } catch { /* ignore */ }
  void recordPwaEvent('PUSH_PERMISSION_DISMISSED', 'CONFIRMED', { source: 'soft-prompt' });
}

/**
 * base64url → the bytes `applicationServerKey` actually wants.
 *
 * Typed as ArrayBuffer rather than Uint8Array on purpose: with
 * `lib.dom` current, `Uint8Array`'s buffer is `ArrayBufferLike`, which
 * includes SharedArrayBuffer and therefore does not satisfy the BufferSource
 * the API declares. Handing over the buffer itself is both correct and what
 * the browser reads anyway.
 */
function urlBase64ToBytes(base64: string): ArrayBuffer {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
    .replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out.buffer as ArrayBuffer;
}

/**
 * The public half of the VAPID pair.
 *
 * Absent on an environment that has not been configured, and that is a
 * FIRST-CLASS state rather than a crash: the subscribe call returns a reason
 * and the UI says notifications are not available here, which is true.
 */
export function vapidPublicKey(): string | null {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  return typeof key === 'string' && key.length > 20 ? key : null;
}

export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'denied' | 'no-key' | 'no-worker' | 'failed' };

/**
 * Ask the browser, then store what it gives back.
 *
 * Called only from an explicit opt-in. Everything before this point is
 * Homatch's own UI, which is the whole design.
 */
export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  const key = vapidPublicKey();
  if (!key) return { ok: false, reason: 'no-key' };

  void recordPwaEvent('PUSH_PERMISSION_REQUESTED', 'CONFIRMED', { source: 'opt-in' });
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    void recordPwaEvent('PUSH_PERMISSION_DENIED', 'CONFIRMED', { source: 'native' });
    return { ok: false, reason: 'denied' };
  }
  void recordPwaEvent('PUSH_PERMISSION_GRANTED', 'CONFIRMED', { source: 'native' });

  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration) return { ok: false, reason: 'no-worker' };

  try {
    /* An existing subscription is reused rather than replaced: re-subscribing
       the same browser returns the same endpoint anyway, and unsubscribing
       first would briefly make the device unreachable for no reason. */
    const existing = await registration.pushManager.getSubscription();
    const sub = existing ?? await registration.pushManager.subscribe({
      // Required by every browser that implements push: a payload the push
      // service itself cannot read is the only kind Homatch will send.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(key),
    });

    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, reason: 'failed' };
    }

    const { data } = await supabase.auth.getSession();
    const authId = data.session?.user?.id;
    if (!authId) return { ok: false, reason: 'failed' };
    const { data: profile } = await supabase
      .from('users').select('id').eq('auth_id', authId).maybeSingle();
    if (!profile?.id) return { ok: false, reason: 'failed' };

    /* Upsert on the endpoint. The endpoint IS the device: without this, every
       sign-in on the same browser adds a row and the same person gets the
       same notification four times. */
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: profile.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      platform: platformBucket(),
      browser: browserBucket(),
      locale: (localStorage.getItem('homatch_lang') ?? '').slice(0, 8) || null,
      standalone: isStandalone(),
      enabled: true,
      revoked_at: null,
      failure_count: 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    if (error) return { ok: false, reason: 'failed' };

    void recordPwaEvent('PUSH_SUBSCRIPTION_CREATED', 'CONFIRMED', { source: 'opt-in' });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Turn it off on this device.
 *
 * Both halves matter. Unsubscribing without telling the server leaves a dead
 * endpoint that the sender keeps trying until the push service returns 410;
 * marking it revoked without unsubscribing leaves the browser willing to
 * receive from a sender we no longer use.
 */
export async function unsubscribeFromPush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await supabase.from('push_subscriptions')
      .update({ enabled: false, revoked_at: new Date().toISOString() })
      .eq('endpoint', endpoint);
    void recordPwaEvent('PUSH_SUBSCRIPTION_INVALIDATED', 'CONFIRMED', { source: 'opt-out' });
  } catch {
    /* Nothing here is worth an error: the worst case is a dead endpoint the
       sender retires on its next 410. */
  }
}

/** Is this browser currently subscribed? Used to render the switch honestly. */
export async function hasPushSubscription(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    return (await registration.pushManager.getSubscription()) !== null;
  } catch {
    return false;
  }
}
