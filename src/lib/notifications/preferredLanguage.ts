/*
 * WHICH LANGUAGE THE SERVER SHOULD WRITE TO THIS PERSON IN.
 *
 * Transactional email and the stored text of a notification are written in
 * users.preferred_language (Georgian when it is empty). It used to be written only
 * when somebody pressed the language switcher, so 23 of 25 accounts had none and
 * every one of them was mailed in Georgian whatever they read the site in.
 *
 * The rule, pure so it is tested once (usePersistPreferredLanguage applies it):
 *   - nothing stored yet (a new signup, an old account): store the language the
 *     interface settled on;
 *   - the person changed the language while signed in: store the new one;
 *   - otherwise leave it: a device that opened in another language does not get to
 *     overwrite what the account chose on another device.
 */
export const SERVER_LANGUAGES = ['ka', 'en', 'ru', 'tr', 'ar', 'he'] as const;
export type ServerLanguage = typeof SERVER_LANGUAGES[number];

export function isServerLanguage(v: unknown): v is ServerLanguage {
  return typeof v === 'string' && (SERVER_LANGUAGES as readonly string[]).includes(v);
}

export function languageToPersist(input: {
  userId: string | null | undefined;
  stored: string | null | undefined;
  current: string | null | undefined;
  /** The language the interface had settled on when this account was first seen in this session. */
  baseline: string | null | undefined;
  /** The last value this session already wrote, so a stale profile does not cause a second write. */
  lastWritten?: string | null;
}): ServerLanguage | null {
  const { userId, stored, current, baseline, lastWritten } = input;
  if (!userId || !isServerLanguage(current)) return null;
  if (current === stored || current === lastWritten) return null;
  if (!isServerLanguage(stored)) return current;
  if (baseline && current !== baseline) return current;
  return null;
}
