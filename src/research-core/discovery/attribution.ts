// PHASE 2 — where a Find Property result came from, as the customer sees it.
//
// A discovery result must take the customer from HOMATCH to the ORIGINAL
// source in one click, and say who posted it and where. Everything here is
// read from what the source provided -- the raw signal a community post was
// stored as, the registry entry of its channel or board, the listing's own
// URL -- and nothing is invented: a field the source did not give stays null.
//
// Public contact information in the original text (a phone, an @handle, a
// link) is part of the source and is returned as written. Every LINK is
// validated (source-link.ts): only real http(s) URLs are clickable, and the
// exact post permalink always wins over a channel or board front page.

import { safeWebUrl, telegramChannelUrl } from './source-link.ts';

export const ORIGINAL_TEXT_LIMIT = 4000;

export interface SourceAttribution {
  /** TELEGRAM, FORUM, ... for a community post; PORTAL for a listing site. */
  platform: string;
  /** The channel, group, board or site, by its registry name. */
  sourceName: string | null;
  /** The channel / group / board / site itself. */
  sourceUrl: string | null;
  /** The thread a forum post belongs to, when it is not the post itself. */
  threadUrl: string | null;
  /** THE EXACT post, message or listing. */
  permalink: string | null;
  /** The author's public name or @username, as the source shows it. */
  authorName: string | null;
  /** The author's public profile. */
  authorUrl: string | null;
  /** The post as written, public contacts included. */
  originalText: string | null;
}

export interface AttributionInput {
  observation: { canonical_url?: string | null; adapter_id?: string | null };
  signal?: {
    platform?: string | null;
    source_url?: string | null;
    parent_url?: string | null;
    author_public_name?: string | null;
    author_public_url?: string | null;
    profile_url?: string | null;
    original_text?: string | null;
  } | null;
  source?: { name?: string | null; url?: string | null } | null;
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function attributionFor({ observation, signal, source }: AttributionInput): SourceAttribution {
  const adapter = String(observation.adapter_id ?? '');
  const platform = String(signal?.platform ?? (adapter.endsWith('-community') ? adapter.replace(/-community$/, '') : 'PORTAL')).toUpperCase();
  const permalink = safeWebUrl(signal?.source_url) ?? safeWebUrl(observation.canonical_url);
  const registryUrl = safeWebUrl(source?.url);
  /* A Telegram post names its channel in its own permalink; that is the
     channel link, and a registry row that only says "t.me" is not. */
  const sourceUrl = platform === 'TELEGRAM' ? (telegramChannelUrl(permalink) ?? registryUrl) : registryUrl;
  const thread = safeWebUrl(signal?.parent_url);
  const original = text(signal?.original_text);
  return {
    platform,
    sourceName: text(source?.name),
    sourceUrl,
    threadUrl: thread && thread !== permalink ? thread : null,
    permalink,
    authorName: text(signal?.author_public_name),
    authorUrl: safeWebUrl(signal?.author_public_url) ?? safeWebUrl(signal?.profile_url),
    originalText: original ? original.slice(0, ORIGINAL_TEXT_LIMIT) : null,
  };
}

/** The raw-signal id a community observation points back to, when it is a real uuid. */
export function rawSignalIdOf(fieldOrigins: unknown): string | null {
  const id = (fieldOrigins as Record<string, unknown> | null)?.rawSignalId;
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}
