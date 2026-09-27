// THE NOTIFICATION FEED'S RULES, WITHOUT A SINGLE IMPORT.
//
// Everything here is pure and dependency-free on purpose: the bell, the centre, the
// live toast and the chat all ask these questions, and node's test runner can load this
// file directly (no path aliases, no JSX) and check the answers.
//
//   ORDER         newest first by (created_at, id). created_at alone is not an order:
//                 an aggregated row has its created_at rewritten, and two rows written
//                 in one statement share one.
//   PAGING        a keyset cursor on the same pair. An offset shifts under anything
//                 arriving while somebody reads; a created_at-only cursor skips or
//                 repeats every row that shares a timestamp with the page boundary.
//   MERGING       a page, a realtime frame and a reconnect refetch all land in one list,
//                 keyed by id, so the same notification can never appear twice.
//   CATEGORY      what a person thinks a notification is ABOUT, which is not the enum:
//                 three different events were stored as MATCH_FOUND before the enum
//                 grew, and the old rows still are.
//   DESTINATION   a path on this site, and the chat's real parameter.
//   ANNOUNCEMENT  the reader's current language, not the one stored at publish time.

export interface FeedRow {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  read: boolean;
  created_at: string;
  deep_link?: string | null;
  property_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface FeedCursor {
  created_at: string;
  id: string;
}

/* ────────────────────────────────────────────────────────────────────────
 * Order
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * A timestamp as microseconds since the epoch.
 *
 * Postgres keeps microseconds and `Date.parse` keeps milliseconds, so two rows 300µs
 * apart would compare equal and fall back to their ids — the wrong order for exactly
 * the rows a burst produces. The fractional part is read by hand. Formats differ
 * between PostgREST ("…T08:00:44.74538+00:00") and realtime ("… 08:00:44.74538+00"),
 * so both are accepted.
 */
export function timeKey(iso: string): number {
  if (typeof iso !== 'string' || !iso) return Number.NEGATIVE_INFINITY;
  let s = iso.trim().replace(' ', 'T');
  /* "+00" is not an offset Date.parse accepts; "+00:00" is. */
  s = s.replace(/([+-]\d{2})$/, '$1:00');
  const frac = /\.(\d+)/.exec(s);
  const micros = frac ? Number((frac[1] + '000000').slice(0, 6)) : 0;
  const whole = Date.parse(frac ? s.replace(frac[0], '') : s);
  if (!Number.isFinite(whole)) return Number.NEGATIVE_INFINITY;
  return whole * 1000 + micros;
}

/** Newest first; the id breaks every tie, descending, exactly as the SQL does. */
export function compareFeed(a: FeedRow | FeedCursor, b: FeedRow | FeedCursor): number {
  const ta = timeKey(a.created_at);
  const tb = timeKey(b.created_at);
  if (ta !== tb) return tb - ta;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/**
 * One list out of several sources, each notification once.
 *
 * The incoming copy wins: it is newer information about the same row (a read flag, an
 * aggregate's bumped count and timestamp). Then the whole list is re-sorted, which is
 * what moves an aggregated row back to the top when its created_at was rewritten.
 */
export function mergeFeed<T extends FeedRow>(existing: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of existing) if (row?.id) byId.set(row.id, row);
  for (const row of incoming) if (row?.id) byId.set(row.id, { ...(byId.get(row.id) ?? {}), ...row } as T);
  return [...byId.values()].sort(compareFeed);
}

/* ────────────────────────────────────────────────────────────────────────
 * Paging
 * ──────────────────────────────────────────────────────────────────────── */

/** The cursor after a page: its oldest row. Null for an empty page. */
export function cursorAfter(rows: readonly FeedRow[]): FeedCursor | null {
  const last = rows[rows.length - 1];
  return last ? { created_at: last.created_at, id: last.id } : null;
}

const UUIDISH = /^[0-9a-fA-F-]{8,64}$/;

/**
 * The PostgREST `or` filter for "strictly older than the cursor":
 *
 *   created_at < c  OR  (created_at = c AND id < i)
 *
 * The timestamp is double-quoted because it contains characters PostgREST reserves in a
 * logic tree ('.', ':', '+'). The id is checked rather than trusted: it goes into a
 * filter string, and anything that is not an id has no business being there.
 */
export function keysetOrFilter(cursor: FeedCursor): string {
  if (!cursor || !UUIDISH.test(cursor.id)) throw new Error('invalid notification cursor');
  const at = String(cursor.created_at).replace(/"/g, '');
  return `created_at.lt."${at}",and(created_at.eq."${at}",id.lt.${cursor.id})`;
}

/** Whether a row is strictly after (older than) the cursor, in feed order. */
export function isAfterCursor(row: FeedRow, cursor: FeedCursor | null): boolean {
  if (!cursor) return true;
  return compareFeed(row, cursor) > 0;
}

/* ────────────────────────────────────────────────────────────────────────
 * Category
 * ──────────────────────────────────────────────────────────────────────── */

export type NotificationCategory =
  | 'MESSAGE'
  | 'MATCH'
  | 'PROPERTY'
  | 'DISCOVERY'
  | 'SERVICE'
  | 'BILLING'
  | 'ACCOUNT'
  | 'NEWS';

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  'MESSAGE', 'MATCH', 'PROPERTY', 'DISCOVERY', 'SERVICE', 'BILLING', 'ACCOUNT', 'NEWS',
];

function metaOf(row: FeedRow): Record<string, unknown> {
  return (row.metadata ?? {}) as Record<string, unknown>;
}

function metaString(row: FeedRow, key: string): string {
  const v = metaOf(row)[key];
  return typeof v === 'string' ? v : '';
}

export function kindOf(row: FeedRow): string {
  return metaString(row, 'kind');
}

/**
 * What a notification is about, as a reader would file it.
 *
 * The kind first, because it is more specific than the type and is the only thing that
 * tells the three historical meanings of MATCH_FOUND apart.
 */
export function categoryOf(row: FeedRow): NotificationCategory {
  const kind = kindOf(row);
  const type = String(row.type ?? '');

  if (kind === 'NEW_MESSAGE' || type === 'NEW_MESSAGE') return 'MESSAGE';
  if (kind === 'ANNOUNCEMENT' || type === 'ANNOUNCEMENT') return 'NEWS';
  if (kind.startsWith('VIEWING_')) return 'PROPERTY';

  /* The searcher's side: a property turned up for what they are looking for. */
  if (kind === 'NATIVE_MATCH_DEMAND' || kind === 'NEW_PROPERTY_MATCH' || type === 'SEARCH_COMPLETE') {
    return 'DISCOVERY';
  }
  if (type === 'MATCH_FOUND' || type === 'MATCH_AVAILABLE'
    || type === 'QUALIFIED_LEAD' || type === 'CALLBACK_REQUESTED') return 'MATCH';

  if (type === 'PROPERTY_ACTION_REQUIRED' || type.startsWith('IMPORT_')
    || type.startsWith('MATCHING_')) return 'PROPERTY';

  if (type === 'LOW_CREDITS' || type.startsWith('CREDITS_') || type.startsWith('SUBSCRIPTION_')
    || type === 'RESEARCH_PRODUCT_PURCHASED' || type === 'INCLUDED_USAGE_EXHAUSTED') return 'BILLING';

  if (type === 'VERIFY_COMPLETE' || type === 'DOCUMENT_ANALYZED' || type.startsWith('EXPAT_')
    || type.startsWith('CAMPAIGN_') || type.startsWith('WHATSAPP_')) return 'SERVICE';

  return 'ACCOUNT';
}

/* ────────────────────────────────────────────────────────────────────────
 * Destination
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * A stored deep link, made safe and current — or null.
 *
 * Only a single-slash path is followed: "//host" is a protocol-relative URL and an
 * absolute URL is an open redirect out of the most trusted list on the site.
 *
 * `/chat?c=<id>` is what send-message wrote until the parameter was corrected; the chat
 * reads `conversation`. Rows written before the fix still carry the old form, so it is
 * rewritten here rather than left to open the inbox instead of the conversation.
 */
export function safeDeepLink(link: unknown): string | null {
  if (typeof link !== 'string') return null;
  if (!link.startsWith('/') || link.startsWith('//')) return null;
  const q = link.indexOf('?');
  if (q !== -1 && link.slice(0, q) === '/chat') {
    const params = new URLSearchParams(link.slice(q + 1));
    const legacy = params.get('c');
    if (legacy && !params.get('conversation')) {
      params.delete('c');
      params.set('conversation', legacy);
      return `/chat?${params.toString()}`;
    }
  }
  return link;
}

/** The conversation a message notification is about, or ''. */
export function conversationOf(row: FeedRow): string {
  const fromMeta = metaString(row, 'conversation_id');
  if (fromMeta) return fromMeta;
  const link = safeDeepLink(row.deep_link);
  if (link?.startsWith('/chat?')) {
    return new URLSearchParams(link.slice('/chat?'.length)).get('conversation') ?? '';
  }
  return '';
}

/** Whether this is a message notification for exactly this conversation. */
export function isMessageFor(row: FeedRow, conversationId: string | null | undefined): boolean {
  if (!conversationId) return false;
  if (categoryOf(row) !== 'MESSAGE') return false;
  return conversationOf(row) === conversationId;
}

/* ────────────────────────────────────────────────────────────────────────
 * Announcement text
 * ──────────────────────────────────────────────────────────────────────── */

function pick(map: unknown, lang: string): string {
  if (!map || typeof map !== 'object') return '';
  const m = map as Record<string, unknown>;
  const own = m[lang];
  if (typeof own === 'string' && own.trim()) return own;
  const en = m.en;
  return typeof en === 'string' && en.trim() ? en : '';
}

/**
 * An announcement in the reader's CURRENT language.
 *
 * The fan-out stores every language the operator wrote in metadata (title_i18n,
 * body_i18n). The reader's language first, then English, then whatever was stored on
 * the row — which is also what a row written before the maps existed falls back to.
 */
export function announcementText(row: FeedRow, lang: string): { title: string; body: string } {
  const meta = metaOf(row);
  const code = String(lang || 'en').toLowerCase().slice(0, 2);
  return {
    title: pick(meta.title_i18n, code) || row.title || '',
    body: pick(meta.body_i18n, code) || (row.body ?? ''),
  };
}
