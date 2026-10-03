// Design Studio — a project's status in the library, from the server's own rows (pure).
//
//   WORKING   a reading, a design or a picture is under way
//   QUESTION  the photos were understood and one detail is waiting for the customer
//   READY     a design picture exists
//   FAILED    the latest work did not finish (and nothing is ready)

import { isPhotoUnderstanding, openQuestions, type PhotoFlowRecord } from './photoProject.ts';

export type ProjectStatus = 'WORKING' | 'QUESTION' | 'READY' | 'FAILED';

const ACTIVE = new Set(['QUOTED', 'QUEUED', 'RENDERING', 'FINISHING']);
export const RECENT_MS = 30 * 60_000;
/**
 * Work whose row has not moved for this long was abandoned (its server instance was lost): it is no longer "in
 * progress". Every step touches its row far more often than this (the server's own lease is 8 minutes).
 */
export const STALE_MS = 15 * 60_000;

/** Combine what one project's rows say (pure; tested). Work in progress wins, then a waiting question, then a result. */
export function statusOf(rows: {
  renders: Array<{ status: string; updated_at?: string | null }>;
  readings: Array<{ status: string; updated_at?: string | null }>;
  photos: Array<{ status: string; updated_at?: string | null; analysis?: unknown; corrections?: { flow?: PhotoFlowRecord } | null }>;
  designs: Array<{ status: string; created_at: string }>;
}, now = Date.now()): ProjectStatus | null {
  // A row with no time is taken as live (older callers); one that has not moved for STALE_MS was abandoned.
  const live = (at: string | null | undefined) => !at || Date.parse(at) > now - STALE_MS;
  const designing = rows.designs.some((d) => d.status === 'RUNNING' && Date.parse(d.created_at) > now - RECENT_MS);
  if (designing || rows.renders.some((r) => ACTIVE.has(r.status) && live(r.updated_at)) || rows.readings.some((r) => r.status === 'INTERPRETING' && live(r.updated_at))
    || rows.photos.some((p) => p.status === 'READING' && live(p.updated_at))) return 'WORKING';
  const waiting = rows.photos.some((p) => isPhotoUnderstanding(p.analysis)
    && openQuestions(p.analysis, p.corrections?.flow?.answers ?? []).length > 0 && (p.corrections?.flow?.step ?? 'QUESTION') === 'QUESTION');
  if (waiting) return 'QUESTION';
  if (rows.renders.some((r) => r.status === 'READY')) return 'READY';
  if (rows.photos.some((p) => p.status === 'FAILED') || rows.readings.some((r) => r.status === 'FAILED') || rows.renders.some((r) => r.status === 'FAILED')) return 'FAILED';
  return null;
}

