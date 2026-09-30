import { supabase } from '@/db/supabase';

/*
 * WHAT A PERSON WANTS TO BE TOLD ABOUT.
 *
 * WHY AN ABSENT ROW IS A VALID ANSWER
 *
 * Most accounts will never open a notification settings screen. If defaults
 * lived in a row, every one of those accounts would need a backfill, a new
 * account would be silent until something wrote its row, and a failed write
 * would look exactly like "this person turned everything off".
 *
 * So absence means defaults: push on, marketing off, no quiet hours. Writing
 * happens only when somebody actually changes something, and the row that
 * appears then is a record of a decision rather than of a visit.
 *
 * WHY MARKETING IS NOT IN `categories`
 *
 * The category switches are conveniences — "stop telling me about campaigns"
 * — and a bug that lost them costs somebody a notification. Marketing consent
 * is a different kind of fact, it is opt-IN, and it must not be possible to
 * grant it by writing a key into a JSON bag. It has its own column and its
 * own default of false.
 */

/**
 * The switches a person actually thinks in. Not the 24 enum values.
 *
 * WHY `messages` AND `viewings` ARE THEIR OWN SWITCHES
 *
 * Both used to be neither. A direct message and a viewing request are stored
 * as MATCH_FOUND — the enum has no value of their own and adding one is a
 * migration — so the category a person saw them under was "Buyer and property
 * matches". Turning that off to stop hearing about automated matching also
 * stopped a human being from reaching you about your property, and nothing on
 * the screen said so.
 *
 * They are separated by what the event carries rather than by its type, so no
 * schema change was needed to tell them apart; see categoryOf in push-send.
 */
export const NOTIFICATION_CATEGORIES = [
  'messages', 'viewings', 'matches', 'ai_results', 'leads', 'campaigns', 'whatsapp', 'billing',
  /* FOR EXPATS task and deadline reminders. Its own switch rather than
     part of 'system', because the thing a person would be silencing is a
     residence-permit deadline and they should have to mean it. */
  'expat_plan',
  'system',
] as const;

export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number];

/*
 * META ADS SWITCHES.
 *
 * Kept apart from NOTIFICATION_CATEGORIES because their defaults are not all "on": a
 * daily brief nobody asked for is noise, so it is opt-in, while the weekly one is on.
 * The keys and defaults are the notifier's — recipientFor() in
 * supabase/functions/meta-ads-api/notifier.ts reads exactly these keys from
 * `categories` and falls back to DEFAULT_PREFERENCES in src/lib/metaAds/events.ts.
 *
 * There is deliberately no switch for integrity (Campaign Guard warnings, strikes,
 * suspensions, loss of access) or lifecycle: those are always delivered.
 */
export const META_NOTIFICATION_CATEGORIES = [
  'meta_performance', 'meta_leads', 'meta_billing', 'meta_daily_brief', 'meta_weekly_brief',
] as const;

export type MetaNotificationCategory = typeof META_NOTIFICATION_CATEGORIES[number];

export const META_CATEGORY_DEFAULTS: Record<MetaNotificationCategory, boolean> = {
  meta_performance: true,
  meta_leads: true,
  meta_billing: true,
  meta_daily_brief: false,
  meta_weekly_brief: true,
};

/** A Meta switch's effective value: what was stored, else the notifier's default. */
export function metaCategoryOn(
  categories: NotificationPreferences['categories'], key: MetaNotificationCategory,
): boolean {
  const stored = (categories as Record<string, unknown>)[key];
  return typeof stored === 'boolean' ? stored : META_CATEGORY_DEFAULTS[key];
}

export interface NotificationPreferences {
  categories: Partial<Record<NotificationCategory | MetaNotificationCategory, boolean>>;
  pushEnabled: boolean;
  /** Email channel (notification_preferences.email_enabled, default true). CRITICAL
      Meta events are emailed; integrity messages are emailed whatever this says. */
  emailEnabled: boolean;
  marketingOptIn: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string | null;
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  categories: {},
  pushEnabled: true,
  emailEnabled: true,
  marketingOptIn: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  timezone: null,
};

export async function getNotificationPreferences(
  userId: string,
): Promise<NotificationPreferences> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('categories, push_enabled, email_enabled, marketing_opt_in, quiet_hours_start, quiet_hours_end, timezone')
    .eq('user_id', userId)
    .maybeSingle();

  /* A read failure is not "everything off". Defaults, and the switches render
     as they would for a new account rather than as a silenced one. */
  if (error || !data) return DEFAULT_PREFERENCES;

  return {
    categories: (data.categories ?? {}) as NotificationPreferences['categories'],
    pushEnabled: data.push_enabled ?? true,
    emailEnabled: data.email_enabled ?? true,
    marketingOptIn: data.marketing_opt_in ?? false,
    quietHoursStart: data.quiet_hours_start,
    quietHoursEnd: data.quiet_hours_end,
    timezone: data.timezone,
  };
}

export async function saveNotificationPreferences(
  userId: string, prefs: NotificationPreferences,
): Promise<boolean> {
  /* The browser's own timezone, captured when a preference is saved rather
     than guessed at send time: quiet hours in a timezone the server had to
     infer are quiet hours in the wrong hours. */
  const timezone = prefs.timezone
    ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || null);

  const { error } = await supabase.from('notification_preferences').upsert({
    user_id: userId,
    categories: prefs.categories,
    push_enabled: prefs.pushEnabled,
    email_enabled: prefs.emailEnabled,
    marketing_opt_in: prefs.marketingOptIn,
    quiet_hours_start: prefs.quietHoursStart,
    quiet_hours_end: prefs.quietHoursEnd,
    timezone,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  return !error;
}
