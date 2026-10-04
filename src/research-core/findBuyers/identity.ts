// PERSON IDENTITY — who wrote this, on which network, by public identifier.
//
// Two observations are the same person only when they share a deterministic
// public identifier on the same network (numeric id, profile URL path,
// handle). A display name is never enough. Without any identifier the
// observation gets a content-scoped key, which by construction never merges.

export interface PublicAuthor { id?: string | null; url?: string | null; name?: string | null; handle?: string | null }

const HOSTS: Record<string, RegExp> = {
  FACEBOOK: /(^|\.)facebook\.com$|(^|\.)fb\.com$/i,
  INSTAGRAM: /(^|\.)instagram\.com$/i,
  TIKTOK: /(^|\.)tiktok\.com$/i,
  VK: /(^|\.)vk\.com$|(^|\.)vkontakte\.ru$/i,
  TELEGRAM: /(^|\.)t\.me$|(^|\.)telegram\.me$/i,
  LINKEDIN: /(^|\.)linkedin\.com$/i,
};

/** Canonical identifier from a profile URL, or null when it is not one. */
export function profileKeyFromUrl(network: string, url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(String(url)); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\.|^m\.|^mobile\./, '');
  if (HOSTS[network] && !HOSTS[network].test(host)) return null;
  if (network === 'FACEBOOK') {
    const id = u.searchParams.get('id');
    if (u.pathname.startsWith('/profile.php') && id && /^\d+$/.test(id)) return `id:${id}`;
    const m = u.pathname.match(/^\/(?:people\/[^/]+\/)?(\d{5,})\/?$/);
    if (m) return `id:${m[1]}`;
    const g = u.pathname.match(/^\/groups\/[^/]+\/user\/(\d+)/);
    if (g) return `id:${g[1]}`;
    const h = u.pathname.match(/^\/([A-Za-z0-9.]{3,})\/?$/);
    if (h && !['groups', 'pages', 'watch', 'events', 'photo', 'permalink.php', 'share'].includes(h[1].toLowerCase())) return `u:${h[1].toLowerCase()}`;
    return null;
  }
  if (network === 'LINKEDIN') {
    const m = u.pathname.match(/^\/in\/([^/]+)/);
    return m ? `u:${decodeURIComponent(m[1]).toLowerCase()}` : null;
  }
  if (network === 'TIKTOK') {
    const m = u.pathname.match(/^\/@([^/]+)/);
    return m ? `u:${m[1].toLowerCase()}` : null;
  }
  if (network === 'VK') {
    const m = u.pathname.match(/^\/(id\d+|[A-Za-z0-9_.]{3,})\/?$/);
    return m ? `u:${m[1].toLowerCase()}` : null;
  }
  const m = u.pathname.match(/^\/([A-Za-z0-9_.]{2,})\/?$/);
  return m ? `u:${m[1].toLowerCase()}` : null;
}

export function personKey(network: string, author: PublicAuthor | null | undefined, contentExternalId: string): string {
  const id = author?.id != null ? String(author.id).trim() : '';
  if (id && /^[A-Za-z0-9_.:-]{2,80}$/.test(id)) return `id:${id.replace(/^id:/, '')}`;
  const fromUrl = profileKeyFromUrl(network, author?.url ?? null);
  if (fromUrl) return fromUrl;
  const handle = author?.handle ? String(author.handle).replace(/^@/, '').trim().toLowerCase() : '';
  if (handle && /^[a-z0-9_.]{2,60}$/.test(handle)) return `u:${handle}`;
  return `content:${contentExternalId}`;
}

export const isMergeableKey = (key: string) => !key.startsWith('content:');

/** Normalized text fingerprint: reposts of the same words fold together. */
export function contentFingerprint(text: string | null | undefined): string {
  const norm = String(text ?? '').normalize('NFKC').toLowerCase()
    .replace(/https?:\/\/\S+/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  let h1 = 0x811c9dc5; let h2 = 0x01000193;
  for (const ch of norm) {
    const c = ch.codePointAt(0)!;
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}
