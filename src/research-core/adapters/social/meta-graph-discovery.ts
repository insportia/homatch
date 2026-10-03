// PHASE 2 — Facebook and Instagram DISCOVERY through Meta's official Graph API.
//
// SEPARATE FROM META ADS. This module imports nothing from
// supabase/functions/_shared/metaAds.ts, never reads META_APP_ID /
// META_APP_SECRET / META_TOKEN_ENCRYPTION_KEY, and is called by no Meta Ads
// code. It takes an access token from its caller (a discovery-only credential,
// DISCOVERY_META_ACCESS_TOKEN, that does not exist today) and an injected
// fetch, and returns raw-signal rows the existing pipeline already understands.
//
// WHAT META ACTUALLY PERMITS (social/meta-capabilities.ts has the evidence):
//   Facebook GROUPS     removed 2024-04-22. Not implemented: nothing to call.
//   Facebook PAGES      public Pages' posts need Page Public Content Access
//                       (App Review + Business Verification). Comment authors
//                       on Pages we do not manage are NOT returned, so a
//                       comment's author stays null -- never inferred.
//   Instagram           Business Discovery reads OTHER professional accounts
//                       by username (username, caption, permalink, timestamp);
//                       hashtag search returns caption, permalink, timestamp
//                       but NO username (30 unique hashtags / 7 days).
//                       Personal accounts are unreachable. Both need a linked
//                       Professional account + App Review.
//
// So the adapters below are ACCESS_GATED (source-capabilities.ts): correct
// against Meta's documented response shapes (tests use DOC_SHAPED fixtures),
// never claimed LIVE_TESTED until a real token returns a real post. No login
// wall, private group or private account is ever worked around.

import { safeWebUrl } from '../../discovery/source-link.ts';

export const GRAPH_VERSION = 'v21.0';
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type GraphFetch = (url: string) => Promise<{ status: number; json: unknown }>;

export interface GraphAccess {
  token: string | null;
  /** The Instagram professional account id the token belongs to (Instagram only). */
  igUserId?: string | null;
}

export type GraphFailure =
  | 'ACCESS_NOT_GRANTED'   // no token configured
  | 'PERMISSION_DENIED'    // Graph error 10 / 200 / 190: permission or review missing, token invalid
  | 'NOT_FOUND'
  | 'RATE_LIMITED'         // Graph error 4 / 17 / 32 / 613
  | 'BAD_RESPONSE';

export interface RawSignalRow {
  platform: 'FACEBOOK' | 'INSTAGRAM';
  external_id: string;
  source_url: string | null;
  parent_url: string | null;
  author_public_name: string | null;
  author_public_url: string | null;
  original_text: string;
  published_at: string | null;
  content_type: 'POST' | 'COMMENT';
  access_class: 'AUTHENTICATED';
  acquisition_mode: 'OFFICIAL_API';
}

export type GraphOutcome<T> = { ok: true; value: T; requests: number } | { ok: false; reason: GraphFailure; detail: string; requests: number };

function graphError(json: unknown): { code: number; message: string } | null {
  const err = (json as { error?: { code?: number; message?: string } } | null)?.error;
  return err ? { code: Number(err.code) || 0, message: String(err.message ?? '').slice(0, 160) } : null;
}

function failureFor(status: number, json: unknown): GraphFailure {
  const code = graphError(json)?.code ?? 0;
  if ([4, 17, 32, 613].includes(code) || status === 429) return 'RATE_LIMITED';
  if ([10, 190, 200, 3, 102].includes(code) || status === 401 || status === 403) return 'PERMISSION_DENIED';
  if (code === 100 || status === 404) return 'NOT_FOUND';
  return 'BAD_RESPONSE';
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
const iso = (v: unknown) => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** A token never appears in a returned detail or a thrown message. */
function redactToken(message: string, token: string | null): string {
  return token ? message.split(token).join('[token]') : message;
}

async function call(fetchGraph: GraphFetch, path: string, params: Record<string, string>, access: GraphAccess) {
  const q = new URLSearchParams({ ...params, access_token: String(access.token) });
  return fetchGraph(`${GRAPH_BASE}/${path}?${q.toString()}`);
}

/* ── Facebook: posts (and optionally comments) of public Pages ─────────── */

export interface FacebookPageScan {
  /** Operator-curated public Page ids or usernames (never a group). */
  pageId: string;
  limit?: number;
  includeComments?: boolean;
}

export async function scanFacebookPage(
  scan: FacebookPageScan,
  access: GraphAccess,
  fetchGraph: GraphFetch,
): Promise<GraphOutcome<RawSignalRow[]>> {
  if (!access.token) return { ok: false, reason: 'ACCESS_NOT_GRANTED', detail: 'no discovery Graph token (Page Public Content Access) is configured', requests: 0 };
  if (!/^[A-Za-z0-9.]{1,100}$/.test(scan.pageId)) return { ok: false, reason: 'NOT_FOUND', detail: 'not a Page id or username', requests: 0 };
  let requests = 0;
  const page = await call(fetchGraph, encodeURIComponent(scan.pageId), { fields: 'id,name,link,username' }, access);
  requests += 1;
  if (page.status >= 400 || graphError(page.json)) {
    return { ok: false, reason: failureFor(page.status, page.json), detail: redactToken(graphError(page.json)?.message ?? `HTTP ${page.status}`, access.token), requests };
  }
  const p = page.json as { id?: string; name?: string; link?: string; username?: string };
  const pageUrl = safeWebUrl(p.link) ?? (p.username ? safeWebUrl(`https://www.facebook.com/${p.username}`) : null);
  const limit = String(Math.max(1, Math.min(50, scan.limit ?? 25)));
  const posts = await call(fetchGraph, `${encodeURIComponent(scan.pageId)}/posts`, { fields: 'id,message,permalink_url,created_time', limit }, access);
  requests += 1;
  if (posts.status >= 400 || graphError(posts.json)) {
    return { ok: false, reason: failureFor(posts.status, posts.json), detail: redactToken(graphError(posts.json)?.message ?? `HTTP ${posts.status}`, access.token), requests };
  }
  const rows: RawSignalRow[] = [];
  for (const post of ((posts.json as { data?: unknown[] })?.data ?? []) as Array<Record<string, unknown>>) {
    const message = text(post.message);
    const permalink = safeWebUrl(post.permalink_url);
    if (!message || !text(post.id)) continue;
    rows.push({
      platform: 'FACEBOOK', external_id: `fb:${post.id}`,
      /* The exact post. Without a permalink the Page itself is the source -- never the reverse. */
      source_url: permalink ?? pageUrl, parent_url: permalink ? pageUrl : null,
      /* A Page post's author is the Page. */
      author_public_name: text(p.name), author_public_url: pageUrl,
      original_text: message, published_at: iso(post.created_time), content_type: 'POST',
      access_class: 'AUTHENTICATED', acquisition_mode: 'OFFICIAL_API',
    });
    if (scan.includeComments && permalink) {
      const comments = await call(fetchGraph, `${encodeURIComponent(String(post.id))}/comments`, { fields: 'id,message,permalink_url,created_time,from', limit: '25' }, access);
      requests += 1;
      if (comments.status >= 400 || graphError(comments.json)) continue;
      for (const c of ((comments.json as { data?: unknown[] })?.data ?? []) as Array<Record<string, unknown>>) {
        const body = text(c.message);
        if (!body || !text(c.id)) continue;
        const from = c.from as { name?: string; id?: string } | undefined;
        rows.push({
          platform: 'FACEBOOK', external_id: `fb:${c.id}`,
          source_url: safeWebUrl(c.permalink_url) ?? permalink, parent_url: permalink,
          /* Returned only for Pages the token manages; otherwise null, never guessed. */
          author_public_name: text(from?.name), author_public_url: null,
          original_text: body, published_at: iso(c.created_time), content_type: 'COMMENT',
          access_class: 'AUTHENTICATED', acquisition_mode: 'OFFICIAL_API',
        });
      }
    }
  }
  return { ok: true, value: rows, requests };
}

/* ── Instagram: Business Discovery (by username) and hashtag media ─────── */

export async function scanInstagramAccount(
  username: string,
  access: GraphAccess,
  fetchGraph: GraphFetch,
  limit = 25,
): Promise<GraphOutcome<RawSignalRow[]>> {
  if (!access.token || !access.igUserId) return { ok: false, reason: 'ACCESS_NOT_GRANTED', detail: 'no linked Instagram professional account / reviewed token', requests: 0 };
  if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) return { ok: false, reason: 'NOT_FOUND', detail: 'not an Instagram username', requests: 0 };
  const n = Math.max(1, Math.min(50, limit));
  const r = await call(fetchGraph, encodeURIComponent(access.igUserId), {
    fields: `business_discovery.username(${username}){username,name,media.limit(${n}){id,caption,permalink,timestamp,media_type}}`,
  }, access);
  if (r.status >= 400 || graphError(r.json)) {
    return { ok: false, reason: failureFor(r.status, r.json), detail: redactToken(graphError(r.json)?.message ?? `HTTP ${r.status}`, access.token), requests: 1 };
  }
  const bd = (r.json as { business_discovery?: { username?: string; name?: string; media?: { data?: unknown[] } } })?.business_discovery;
  if (!bd?.username) return { ok: false, reason: 'BAD_RESPONSE', detail: 'no business_discovery in the answer', requests: 1 };
  const profileUrl = safeWebUrl(`https://www.instagram.com/${bd.username}/`);
  const rows: RawSignalRow[] = [];
  for (const m of (bd.media?.data ?? []) as Array<Record<string, unknown>>) {
    const caption = text(m.caption);
    if (!caption || !text(m.id)) continue;
    rows.push({
      platform: 'INSTAGRAM', external_id: `ig:${m.id}`,
      source_url: safeWebUrl(m.permalink) ?? profileUrl, parent_url: safeWebUrl(m.permalink) ? profileUrl : null,
      author_public_name: `@${bd.username}`, author_public_url: profileUrl,
      original_text: caption, published_at: iso(m.timestamp), content_type: 'POST',
      access_class: 'AUTHENTICATED', acquisition_mode: 'OFFICIAL_API',
    });
  }
  return { ok: true, value: rows, requests: 1 };
}

export async function scanInstagramHashtag(
  hashtag: string,
  access: GraphAccess,
  fetchGraph: GraphFetch,
): Promise<GraphOutcome<RawSignalRow[]>> {
  if (!access.token || !access.igUserId) return { ok: false, reason: 'ACCESS_NOT_GRANTED', detail: 'no linked Instagram professional account / reviewed token', requests: 0 };
  const tag = hashtag.replace(/^#/, '');
  if (!/^[\p{L}\p{N}_]{1,100}$/u.test(tag)) return { ok: false, reason: 'NOT_FOUND', detail: 'not a hashtag', requests: 0 };
  const search = await call(fetchGraph, 'ig_hashtag_search', { user_id: access.igUserId, q: tag }, access);
  if (search.status >= 400 || graphError(search.json)) {
    return { ok: false, reason: failureFor(search.status, search.json), detail: redactToken(graphError(search.json)?.message ?? `HTTP ${search.status}`, access.token), requests: 1 };
  }
  const id = ((search.json as { data?: Array<{ id?: string }> })?.data ?? [])[0]?.id;
  if (!id) return { ok: true, value: [], requests: 1 };
  const media = await call(fetchGraph, `${encodeURIComponent(id)}/recent_media`, { user_id: access.igUserId, fields: 'id,caption,permalink,timestamp,media_type' }, access);
  if (media.status >= 400 || graphError(media.json)) {
    return { ok: false, reason: failureFor(media.status, media.json), detail: redactToken(graphError(media.json)?.message ?? `HTTP ${media.status}`, access.token), requests: 2 };
  }
  const rows: RawSignalRow[] = [];
  for (const m of ((media.json as { data?: unknown[] })?.data ?? []) as Array<Record<string, unknown>>) {
    const caption = text(m.caption);
    const permalink = safeWebUrl(m.permalink);
    if (!caption || !text(m.id) || !permalink) continue;
    rows.push({
      platform: 'INSTAGRAM', external_id: `ig:${m.id}`, source_url: permalink, parent_url: null,
      /* Hashtag media carries no owner: the author is unknown and stays null. */
      author_public_name: null, author_public_url: null,
      original_text: caption, published_at: iso(m.timestamp), content_type: 'POST',
      access_class: 'AUTHENTICATED', acquisition_mode: 'OFFICIAL_API',
    });
  }
  return { ok: true, value: rows, requests: 2 };
}
