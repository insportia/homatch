/*
 * A link to an outside source that the customer may open.
 *
 * Source and profile links are written by discovery from other people's pages,
 * so the browser checks them again before anything is opened: an absolute
 * http(s) URL with no embedded credentials, or nothing. `javascript:`, `data:`,
 * `signal:` and every other scheme are refused -- refused means no link, never a
 * guessed one. (Server twin: src/research-core/discovery/source-link.ts.)
 */
export function safeExternalUrl(value: unknown): string | null {
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

/** Open a validated source link in a new tab that cannot reach back into HOMATCH. */
export function openExternal(value: unknown): boolean {
  const url = safeExternalUrl(value);
  if (!url) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
