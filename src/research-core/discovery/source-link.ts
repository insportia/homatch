// PHASE 2 — a source link HOMATCH may put in front of a customer.
//
// A discovery result is only as good as the one click that takes the customer
// from HOMATCH to the ORIGINAL post: the exact message, comment or listing,
// not a channel's front page. Those links come from outside (a board's markup,
// a channel's username), so every one is validated before it is stored or
// returned: absolute http(s) only, no credentials in it, nothing else.
// `javascript:` (forum.ge's own name links are `javascript:paste(...)`),
// `data:`, `signal:` and any other scheme are refused -- refused means "no
// link", never a guessed one.

/** An absolute http(s) URL with no embedded credentials, normalised; otherwise null. */
export function safeWebUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || !url.hostname) return null;
  return url.toString();
}

/**
 * The channel or group a Telegram permalink belongs to:
 * https://t.me/<name>/<id> -> https://t.me/<name>. The permalink is real, so
 * this is read from it, not invented. Anything else gives null.
 */
export function telegramChannelUrl(permalink: unknown): string | null {
  const safe = safeWebUrl(permalink);
  if (!safe) return null;
  const match = /^https:\/\/t\.me\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,31})(?:\/\d+)?\/?(?:[?#].*)?$/.exec(safe);
  return match ? `https://t.me/${match[1]}` : null;
}

/** forum.ge (IPB) profile: the member id is the identity; the reader's session id is not. */
export function forumProfileUrl(origin: string, memberId: string | null | undefined): string | null {
  if (!memberId || !/^\d{1,12}$/.test(memberId)) return null;
  const base = safeWebUrl(origin);
  if (!base) return null;
  const url = new URL(base);
  return `${url.origin}/?showuser=${memberId}`;
}
