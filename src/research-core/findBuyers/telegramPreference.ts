// FIND BUYERS — which Telegram path a search uses first.
//
// NATIVE_FIRST (default, today's behaviour): the free HOMATCH Telegram reader
// collects; the memo23 Telegram Actor is planned only when native Telegram is
// not collecting.
// PAID_FIRST (owner preference, 2026-10-04; activated only by setting
// admin_settings.find_buyers_telegram_preference = 'PAID_FIRST'): the memo23
// Telegram Actor reads the known public channels first, and the free reader is
// the fallback — it is skipped for that search only when paid Telegram jobs
// were actually queued (Actor enabled, priced, Apify on, channel seeds known).
// The free community discovery (TELEGRAM_SOURCES) always runs: it is what
// finds the channels both paths read. Never pay twice for the same channels.

export type TelegramPreference = 'PAID_FIRST' | 'NATIVE_FIRST';

export function parseTelegramPreference(value: unknown): TelegramPreference {
  const v = typeof value === 'string' ? value.replace(/^"|"$/g, '').trim().toUpperCase() : '';
  return v === 'PAID_FIRST' ? 'PAID_FIRST' : 'NATIVE_FIRST';
}

/** Plan the memo23 Telegram Actor for this search? */
export function planPaidTelegram(pref: TelegramPreference, nativeTelegramActive: boolean): boolean {
  return pref === 'PAID_FIRST' || !nativeTelegramActive;
}

/** The native plan without the free Telegram READER (community discovery stays). */
export function withoutNativeTelegramReader<P extends { tranches: Array<{ providers: string[] }> }>(plan: P): P {
  return { ...plan, tranches: plan.tranches.map((t) => ({ ...t, providers: t.providers.filter((p) => p !== 'TELEGRAM') })) };
}
