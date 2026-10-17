// FIND BUYERS — one Actor run for several known communities. Pure.
//
// Campaign 719a57ac (2026-10-17) read 16 Facebook groups with 16 runs of the same
// Actor and 4 Telegram channels with 4 runs: each run paid its own start fee and
// took one of the Actor's two concurrent slots, so the reads queued for ~7 minutes.
// Both Actors take a list of start URLs (verified input schemas: FB_GROUP_POSTS
// `startUrls` [required], TELEGRAM_CHANNEL `startUrls`). Reads of the same kind are
// therefore batched — at most MAX_URLS_PER_RUN per run and never above the Actor's
// own maximum result count — and every item is attributed back to the community it
// came from, so per-source statistics and early stopping stay per source.

import type { PlannedSocialJob } from './campaignPlan.ts';
import type { Stage } from './actorInputs.ts';

export interface BatchEntry { targetUrl: string; sourceId: string | null; arm: string; size: number }

/** Stages whose Actor reads a list of community URLs in one run. */
export const BATCHABLE_SOURCE_STAGES: ReadonlySet<Stage> = new Set<Stage>(['FB_GROUP_POSTS', 'TELEGRAM_CHANNEL']);
/** Communities per run: enough to remove most start fees and slot waits, small enough that
 *  one slow or blocked community cannot hold many others hostage. */
export const MAX_URLS_PER_RUN = 5;

export type BatchedJob = PlannedSocialJob & { batch?: BatchEntry[] };

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}

/**
 * Group single-URL reads of the same stage, Actor, reason and language into runs of at
 * most `maxPerRun` URLs whose summed size stays within the Actor's maximum results.
 * Everything else (searches, comments, one-off reads) passes through unchanged.
 */
export function batchSourceReads(jobs: readonly PlannedSocialJob[], opts: { maxPerRun?: number; maxResults?: Record<string, number> } = {}): BatchedJob[] {
  const maxPerRun = Math.max(1, opts.maxPerRun ?? MAX_URLS_PER_RUN);
  const out: BatchedJob[] = [];
  const groups = new Map<string, PlannedSocialJob[]>();
  for (const j of jobs) {
    if (!BATCHABLE_SOURCE_STAGES.has(j.stage) || !j.targetUrl || j.query) { out.push(j); continue; }
    const key = [j.stage, j.actorKey, j.reason, j.language].join('|');
    groups.set(key, [...(groups.get(key) ?? []), j]);
  }
  for (const list of groups.values()) {
    const cap = opts.maxResults?.[list[0].actorKey] ?? Infinity;
    let chunk: PlannedSocialJob[] = [];
    const flush = () => {
      if (!chunk.length) return;
      if (chunk.length === 1) out.push(chunk[0]);
      else {
        const urls = chunk.map((c) => c.targetUrl!);
        out.push({
          ...chunk[0],
          sourceId: null,
          size: chunk.reduce((n, c) => n + c.size, 0),
          arm: `batch:${chunk[0].stage}:${hash(urls.join('|'))}`,
          priority: Math.max(...chunk.map((c) => c.priority)),
          batch: chunk.map((c) => ({ targetUrl: c.targetUrl!, sourceId: c.sourceId, arm: c.arm, size: c.size })),
        });
      }
      chunk = [];
    };
    for (const j of list) {
      const size = chunk.reduce((n, c) => n + c.size, 0);
      if (chunk.length >= maxPerRun || (chunk.length && size + j.size > cap)) flush();
      chunk.push(j);
    }
    flush();
  }
  return out;
}

/** The community part of a URL: a Facebook group id/slug, a Telegram channel name. */
export function communityKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (/(^|\.)t\.me$/i.test(u.hostname)) return parts[0] === 's' ? parts[1]?.toLowerCase() ?? null : parts[0]?.toLowerCase() ?? null;
    const g = parts.indexOf('groups');
    if (g >= 0 && parts[g + 1]) return parts[g + 1].toLowerCase();
    return parts[0]?.toLowerCase() ?? null;
  } catch { return null; }
}

/**
 * Which batch entry each item came from, by its community (the item's group/channel URL,
 * its own URL, or its parent id). An item that matches no entry is null — still processed,
 * attributed to no source. With a single entry everything belongs to it.
 */
export function attributeBatchItems<T extends { url?: string | null; parentUrl?: string | null; parentExternalId?: string | null }>(
  items: readonly T[], entries: readonly BatchEntry[],
): Array<{ entry: BatchEntry | null; items: T[] }> {
  if (entries.length <= 1) return [{ entry: entries[0] ?? null, items: [...items] }];
  const keyed = entries.map((e) => ({ e, k: communityKey(e.targetUrl) }));
  const buckets = new Map<BatchEntry | null, T[]>(entries.map((e) => [e, []]));
  buckets.set(null, []);
  for (const it of items) {
    const cands = [communityKey(it.parentUrl ?? null), communityKey(it.url ?? null), String(it.parentExternalId ?? '').replace(/^group:/, '').toLowerCase() || null];
    const hit = keyed.find(({ k }) => k && cands.includes(k));
    buckets.get(hit ? hit.e : null)!.push(it);
  }
  return [...buckets.entries()].filter(([e, list]) => e !== null || list.length).map(([entry, list]) => ({ entry, items: list }));
}
