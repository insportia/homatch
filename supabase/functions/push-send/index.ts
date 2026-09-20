// HOMATCH — WEB PUSH DELIVERY
//
// WHY THIS IS AN EDGE FUNCTION AND NOT SOMETHING NEW
//
// Web Push needs two things a browser cannot be given: the VAPID private key,
// which signs the request that proves Homatch is the sender, and the ability
// to read every subscription row, which is exactly what no customer may do.
// Homatch already runs sixty-odd Supabase Edge Functions with service_role
// access and a deployment pipeline that ships them on push to main, so this
// is one more of those rather than a new platform to operate.
//
// WHAT DECIDES WHETHER A PUSH IS SENT
//
// Not the call site. A notification is created wherever the product does its
// work — a verification finishing, a reply arriving — and those places should
// not each be re-deciding quiet hours, category preferences and priority. So
// this function takes a notification that ALREADY EXISTS and answers one
// question: does this earn an interruption, on this device, right now?
//
//   the row was pushed already        no (pushed_at is the guard)
//   the customer turned push off      no
//   the category is switched off      no
//   MARKETING without marketing opt-in  no
//   inside quiet hours, priority < HIGH  no
//   otherwise                          yes
//
// CRITICAL ignores quiet hours, and is why CRITICAL is documented as security
// and account integrity only.
//
// WHAT HAPPENS TO A DEAD ENDPOINT
//
// A push service answers 404 or 410 for a subscription that no longer exists
// — uninstalled, site data cleared, permission revoked. Those are permanent,
// and the row is marked revoked immediately rather than retried forever. Any
// other failure increments a counter, and a subscription that has failed ten
// times in a row is disabled: a sender that keeps hammering dead endpoints is
// how an origin gets rate-limited by a push service.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

/** Enough failures in a row that the endpoint is almost certainly gone. */
const GIVE_UP_AFTER = 10;

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failure_count: number;
}

interface Prefs {
  categories: Record<string, boolean> | null;
  push_enabled: boolean;
  marketing_opt_in: boolean;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  timezone: string | null;
}

/**
 * Which switch governs an event.
 *
 * Grouped by what a person would think of turning off. Nobody wants to
 * silence CAMPAIGN_PAUSED while keeping CAMPAIGN_COMPLETED; they want to stop
 * hearing about campaigns.
 *
 * WHY IT READS THE METADATA AND NOT ONLY THE TYPE
 *
 * Three different things are stored as MATCH_FOUND: an automated match, a
 * direct message from another person, and a viewing request. The enum has no
 * value for the last two and adding one is a migration, so the producers say
 * which is which in `metadata.kind` — and this used to ignore that and file
 * all three under "Buyer and property matches".
 *
 * The result was a switch that did something other than what it said.
 * Somebody who turned off automated matching also stopped hearing that a
 * human being had written to them about their property, or asked to come and
 * see it. Those are the two things on this platform most likely to be time
 * critical, and they were being silenced by a control that never mentioned
 * them.
 */
function categoryOf(eventType: string, metadata?: Record<string, unknown> | null): string {
  /* The kind first: it is more specific than the type, and it is the only
     thing that distinguishes the three meanings of MATCH_FOUND. */
  const kind = typeof metadata?.kind === 'string' ? metadata.kind : '';
  if (kind === 'NEW_MESSAGE') return 'messages';
  if (kind === 'VIEWING_REQUEST' || kind === 'VIEWING_UPDATE') return 'viewings';

  if (eventType.startsWith('CAMPAIGN_')) return 'campaigns';
  if (eventType.startsWith('WHATSAPP_')) return 'whatsapp';
  if (eventType.startsWith('MATCH_')) return 'matches';
  if (eventType.startsWith('SUBSCRIPTION_') || eventType.startsWith('CREDITS_')
    || eventType === 'LOW_CREDITS' || eventType === 'INCLUDED_USAGE_EXHAUSTED') return 'billing';
  if (eventType.startsWith('IMPORT_') || eventType.startsWith('PROVIDER_')) return 'system';
  if (eventType === 'VERIFY_COMPLETE' || eventType === 'DOCUMENT_ANALYZED') return 'ai_results';
  if (eventType === 'CALLBACK_REQUESTED' || eventType === 'QUALIFIED_LEAD') return 'leads';
  /* FOR EXPATS reminders are their own switch. Filed under "system" they
     would be turned off by somebody silencing import notices, and the
     thing silenced would be a residence-permit deadline. */
  if (eventType.startsWith('EXPAT_')) return 'expat_plan';
  /* A purchase is a billing event. It reached this line and was filed under
     "Account and system", so turning off system notices also turned off the
     confirmation that money had been spent. */
  if (eventType === 'RESEARCH_PRODUCT_PURCHASED') return 'billing';
  return 'system';
}

/**
 * Is it the middle of the night where this person is?
 *
 * The window wraps, because the interesting case always does: 22 to 7 is nine
 * hours across midnight, and a naive `h >= start && h < end` answers "never"
 * for exactly the hours somebody was trying to protect.
 */
function inQuietHours(prefs: Prefs): boolean {
  const { quiet_hours_start: start, quiet_hours_end: end } = prefs;
  if (start === null || end === null || start === end) return false;
  let hour: number;
  try {
    hour = Number(new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric', hour12: false, timeZone: prefs.timezone ?? 'UTC',
    }).format(new Date()));
  } catch {
    // An unknown timezone is not a reason to wake somebody at 3am; UTC is the
    // conservative reading rather than "no quiet hours".
    hour = new Date().getUTCHours();
  }
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  /* Read before the VAPID guard: one action is answerable without the
     private key, and a Request body can only be read once. */
  let rawBody: { action?: string; notificationId?: string } = {};
  let action0 = 'deliver';
  try { rawBody = await req.json(); action0 = rawBody.action ?? 'deliver'; } catch { /* probe */ }

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@homatch.live';

  /*
   * THE PUBLIC KEY IS SERVED, NOT SHIPPED.
   *
   * `applicationServerKey` needs the VAPID public key in the browser, and the
   * obvious way to get it there is a build-time env var on the frontend host.
   * That means one key configured in two places by two hands, and the failure
   * it produces is the worst kind: browsers subscribe against key A, the
   * sender signs with key B, and every push is rejected with a 403 that looks
   * like a delivery problem rather than a configuration one.
   *
   * One source instead. The function holding the private half serves the
   * public half, so they cannot disagree and rotating the pair is one action
   * rather than two. A public key is public: no auth, nothing secret.
   */
  if (action0 === 'public-key') {
    return publicKey
      ? json({ ok: true, key: publicKey })
      : json({ ok: false, error: 'VAPID_NOT_CONFIGURED' }, 503);
  }

  if (!publicKey || !privateKey) {
    /* A named, honest state. The product renders "notifications are not
       configured here" rather than a switch that fails when pressed. */
    return json({ ok: false, error: 'VAPID_NOT_CONFIGURED' }, 503);
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  /* Already parsed above: a Request body can only be read once. */
  const body = rawBody;
  const action = action0;

  /* ── A test send, to the caller's own devices ─────────────────────────
     The only way to prove the whole path end to end without sending anything
     to a customer. It requires a signed-in caller and can only ever reach
     that caller's own subscriptions. */
  if (action === 'test') {
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ ok: false, error: 'NOT_SIGNED_IN' }, 401);

    const { data: authUser } = await sb.auth.getUser(jwt);
    const authId = authUser?.user?.id;
    if (!authId) return json({ ok: false, error: 'NOT_SIGNED_IN' }, 401);

    const { data: profile } = await sb.from('users')
      .select('id').eq('auth_id', authId).maybeSingle();
    if (!profile?.id) return json({ ok: false, error: 'NO_PROFILE' }, 403);

    const { data: subs } = await sb.from('push_subscriptions')
      .select('id, endpoint, p256dh, auth, failure_count')
      .eq('user_id', profile.id).eq('enabled', true).is('revoked_at', null);

    const results = await deliver(sb, (subs ?? []) as SubRow[], {
      title: 'Homatch',
      body: 'Push notifications are working on this device.',
      deep_link: '/notifications',
      priority: 'NORMAL',
    });
    return json({ ok: true, ...results });
  }

  /* ── Deliver one existing notification ───────────────────────────────── */
  if (action !== 'deliver' || !body.notificationId) {
    return json({ ok: false, error: 'BAD_REQUEST' }, 400);
  }

  const { data: notif } = await sb.from('notifications')
    /* metadata, because the category is decided partly by metadata.kind:
       three different events share the MATCH_FOUND type. */
    .select('id, user_id, type, title, body, deep_link, priority, group_key, pushed_at, metadata')
    .eq('id', body.notificationId).maybeSingle();
  if (!notif) return json({ ok: false, error: 'NOT_FOUND' }, 404);
  if (notif.pushed_at) return json({ ok: true, skipped: 'ALREADY_PUSHED' });

  const { data: prefRow } = await sb.from('notification_preferences')
    .select('categories, push_enabled, marketing_opt_in, quiet_hours_start, quiet_hours_end, timezone')
    .eq('user_id', notif.user_id).maybeSingle();

  /* No row means defaults: push on, marketing off, no quiet hours. A person
     who has never opened the settings screen still gets told their
     verification finished, and still gets no marketing. */
  const prefs: Prefs = prefRow ?? {
    categories: null, push_enabled: true, marketing_opt_in: false,
    quiet_hours_start: null, quiet_hours_end: null, timezone: null,
  };

  if (!prefs.push_enabled) return json({ ok: true, skipped: 'PUSH_DISABLED' });

  const category = categoryOf(notif.type, notif.metadata as Record<string, unknown> | null);
  if (prefs.categories && prefs.categories[category] === false) {
    return json({ ok: true, skipped: 'CATEGORY_OFF' });
  }
  if (category === 'marketing' && !prefs.marketing_opt_in) {
    return json({ ok: true, skipped: 'NO_MARKETING_CONSENT' });
  }

  const priority = notif.priority ?? 'NORMAL';
  if (priority === 'LOW') return json({ ok: true, skipped: 'LOW_PRIORITY' });
  if (inQuietHours(prefs) && priority !== 'CRITICAL') {
    return json({ ok: true, skipped: 'QUIET_HOURS' });
  }

  const { data: subs } = await sb.from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, failure_count')
    .eq('user_id', notif.user_id).eq('enabled', true).is('revoked_at', null);

  const results = await deliver(sb, (subs ?? []) as SubRow[], {
    id: notif.id,
    title: notif.title,
    body: notif.body ?? '',
    deep_link: notif.deep_link ?? '/notifications',
    priority,
    group_key: notif.group_key ?? undefined,
  });

  /* Stamped whatever happened. A retry loop that re-sends on every failure is
     how one dead endpoint becomes four notifications for everybody else on
     the account. */
  await sb.from('notifications')
    .update({ pushed_at: new Date().toISOString() }).eq('id', notif.id);

  return json({ ok: true, ...results });
});

async function deliver(
  sb: ReturnType<typeof createClient>,
  subs: SubRow[],
  payload: Record<string, unknown>,
): Promise<{ sent: number; failed: number; revoked: number }> {
  let sent = 0;
  let failed = 0;
  let revoked = 0;

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 12 },
      );
      sent += 1;
      await sb.from('push_subscriptions').update({
        last_success_at: new Date().toISOString(), failure_count: 0,
      }).eq('id', sub.id);
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      /* 404 and 410 are the push service saying the subscription is gone.
         That is permanent and there is nothing to retry. */
      if (status === 404 || status === 410) {
        revoked += 1;
        await sb.from('push_subscriptions').update({
          enabled: false,
          revoked_at: new Date().toISOString(),
          last_failure_at: new Date().toISOString(),
          last_failure_reason: `GONE_${status}`,
        }).eq('id', sub.id);
        return;
      }
      failed += 1;
      const next = (sub.failure_count ?? 0) + 1;
      await sb.from('push_subscriptions').update({
        failure_count: next,
        last_failure_at: new Date().toISOString(),
        last_failure_reason: String(status ?? 'UNKNOWN').slice(0, 60),
        // Not revoked — it may come back — but no longer worth trying.
        enabled: next < GIVE_UP_AFTER,
      }).eq('id', sub.id);
    }
  }));

  return { sent, failed, revoked };
}
