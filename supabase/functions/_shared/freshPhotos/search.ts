// Fresh photos — the whole search for one job, network included, store injected.
//
// Commons and (when keyed) Mapillary are asked in parallel inside one 25 s
// budget; every candidate is judged by src/verify/freshPhotos.ts; the newest
// accepted images are copied (at most FRESH_PHOTO_MAX) through `store`, which
// research-agent binds to the private bucket. Sources whose images carry no
// reuse permission (developer sites, social media, listing portals, Korter —
// the last BLOCKED_BY_TERMS in this repo) are recorded as SKIPPED_RIGHTS and
// never fetched. Free APIs: nothing is charged.

import {
  buildFreshPhotoSearch,
  freshPhotoId,
  freshPhotoPath,
  selectFreshPhotos,
  toFreshPhoto,
  FRESH_PHOTO_MAX,
  FRESH_PHOTO_TOTAL_BUDGET_MS,
  RIGHTS_SKIPPED_SOURCES,
  type FreshCandidate,
  type FreshPhoto,
  type FreshPhotoSearch,
  type FreshSourceOutcome,
  type FreshSubject,
} from '../../../../src/verify/freshPhotos.ts';
import { searchCommons } from './commons.ts';
import { searchMapillary } from './mapillary.ts';
import { fetchImage, type FetchLike } from './http.ts';

export interface FreshSearchInput {
  jobId: string;
  center: FreshPhotoSearch['center'];
  subject: FreshSubject;
  newestOfficialPhotoDate: string | null;
  mapillaryToken?: string | null;
  /** Persists one image; true when it is in the bucket. */
  store: (path: string, bytes: Uint8Array, mime: string) => Promise<boolean>;
  fetchImpl?: FetchLike;
  now?: () => Date;
  budgetMs?: number;
}

export async function runFreshPhotoSearch(input: FreshSearchInput): Promise<FreshPhotoSearch> {
  const now = input.now ?? (() => new Date());
  const startedAt = now();
  const searchedAt = startedAt.toISOString();
  const deadline = Date.now() + Math.min(input.budgetMs ?? FRESH_PHOTO_TOTAL_BUDGET_MS, FRESH_PHOTO_TOTAL_BUDGET_MS);
  const rightsSkipped: FreshSourceOutcome[] = RIGHTS_SKIPPED_SOURCES.map((source) => ({ source, status: 'SKIPPED_RIGHTS', candidates: 0, accepted: 0, rejected: {} }));
  if (!input.center) return buildFreshPhotoSearch({ center: null, sources: rightsSkipped, photos: [], searchedAt });
  const center = input.center;
  const opts = { fetchImpl: input.fetchImpl, deadline };

  const [commons, mapillary] = await Promise.all([
    searchCommons(center, opts),
    input.mapillaryToken ? searchMapillary(center, input.mapillaryToken, opts) : Promise.resolve(null),
  ]);

  const candidates: FreshCandidate[] = [...commons.candidates, ...(mapillary?.candidates ?? [])];
  const ctx = { center, subject: input.subject, newestOfficialPhotoDate: input.newestOfficialPhotoDate, now: startedAt };
  // Every acceptable image, newest first; copied until FRESH_PHOTO_MAX are in the bucket.
  const sel = selectFreshPhotos(candidates, ctx, Number.MAX_SAFE_INTEGER);
  for (const t of Object.values(sel.bySource)) t.accepted = 0;
  const reject = (src: string, r: string) => {
    const t = (sel.bySource[src] ??= { candidates: 0, accepted: 0, rejected: {} });
    t.rejected[r] = (t.rejected[r] ?? 0) + 1;
  };
  const photos: FreshPhoto[] = [];
  for (const { candidate, judgement } of sel.accepted) {
    if (photos.length >= FRESH_PHOTO_MAX) { reject(candidate.source, 'NOT_NEWEST'); continue; }
    const img = await fetchImage(candidate.imageUrl, opts);
    if (!img) { reject(candidate.source, 'COPY_FAILED'); continue; }
    const id = await freshPhotoId(candidate.source, candidate.sourceId);
    const path = freshPhotoPath(input.jobId, id, img.ext);
    const ok = await input.store(path, img.bytes, img.mime).catch(() => false);
    if (!ok) { reject(candidate.source, 'COPY_FAILED'); continue; }
    photos.push(toFreshPhoto(candidate, judgement, { id, path, retrievedAt: now().toISOString() }));
    sel.bySource[candidate.source].accepted++;
  }

  const outcome = (source: string, r: { ok: boolean } | null): FreshSourceOutcome => {
    const t = sel.bySource[source] ?? { candidates: 0, accepted: 0, rejected: {} };
    if (!r) return { source, status: 'SKIPPED_NO_KEY', candidates: 0, accepted: 0, rejected: {} };
    return { source, status: r.ok ? 'SEARCHED' : 'FAILED', candidates: t.candidates, accepted: t.accepted, rejected: t.rejected };
  };
  const sources = [outcome('WIKIMEDIA_COMMONS', commons), outcome('MAPILLARY', mapillary), ...rightsSkipped];
  const search = buildFreshPhotoSearch({ center, sources, photos, searchedAt });
  const errors = [commons.error, mapillary?.error].filter(Boolean);
  return errors.length ? { ...search, reason: errors.join('; ').slice(0, 200) } : search;
}
