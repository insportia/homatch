// Fresh photos — Mapillary Graph API (street-level imagery, CC BY-SA 4.0).
//
// Runs only when MAPILLARY_ACCESS_TOKEN is configured; otherwise the source
// is recorded as SKIPPED_NO_KEY. The token travels in the Authorization
// header, never in a logged URL. One request: images whose position lies in
// a box of ±MAPILLARY_MAX_DISTANCE_M around the centre; the judgement then
// keeps only a camera within that distance whose heading points at the
// building (±HEADING_TOLERANCE_DEG). captured_at (epoch ms) is the provider's
// capture time.

import { MAPILLARY_MAX_DISTANCE_M, type FreshCandidate } from '../../../../src/verify/freshPhotos.ts';
import { politeJson, type FetchLike } from './http.ts';

const GRAPH = 'https://graph.mapillary.com/images';
export const MAPILLARY_LICENSE = 'CC BY-SA 4.0';
export const MAPILLARY_LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';

export function mapillaryUrl(center: { lat: number; lng: number }, radiusM = MAPILLARY_MAX_DISTANCE_M): string {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  const bbox = [center.lng - dLng, center.lat - dLat, center.lng + dLng, center.lat + dLat].map((n) => n.toFixed(6)).join(',');
  const q = new URLSearchParams({
    fields: 'id,captured_at,compass_angle,computed_compass_angle,geometry,computed_geometry,thumb_1024_url,width,height,creator',
    bbox,
    limit: '100',
  });
  return `${GRAPH}?${q.toString()}`;
}

/** Graph API JSON → candidates. Pure. */
export function parseMapillary(json: unknown): FreshCandidate[] {
  const rows = (json as any)?.data;
  const out: FreshCandidate[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const g = r?.computed_geometry?.coordinates ?? r?.geometry?.coordinates;
    if (!r?.id || !r?.thumb_1024_url) continue;
    const heading = Number.isFinite(Number(r.computed_compass_angle)) ? Number(r.computed_compass_angle) : Number.isFinite(Number(r.compass_angle)) ? Number(r.compass_angle) : null;
    out.push({
      source: 'MAPILLARY',
      sourceId: String(r.id),
      sourceUrl: `https://www.mapillary.com/app/?pKey=${encodeURIComponent(String(r.id))}`,
      imageUrl: String(r.thumb_1024_url),
      mime: 'image/jpeg',
      title: null,
      description: null,
      categories: [],
      author: r?.creator?.username ? String(r.creator.username) : null,
      license: MAPILLARY_LICENSE,
      licenseUrl: MAPILLARY_LICENSE_URL,
      capturedRaw: typeof r.captured_at === 'number' ? r.captured_at : r.captured_at ?? null,
      captureDateSource: r.captured_at != null ? 'PROVIDER_CAPTURE' : null,
      publishedRaw: null,
      lat: Array.isArray(g) ? Number(g[1]) : null,
      lng: Array.isArray(g) ? Number(g[0]) : null,
      heading,
      width: r.width ?? null,
      height: r.height ?? null,
    });
  }
  return out;
}

export async function searchMapillary(
  center: { lat: number; lng: number },
  token: string,
  opts: { fetchImpl?: FetchLike; deadline: number },
): Promise<{ ok: boolean; candidates: FreshCandidate[]; error?: string }> {
  try {
    const json = await politeJson(mapillaryUrl(center), { ...opts, headers: { Authorization: `OAuth ${token}` } });
    return { ok: true, candidates: parseMapillary(json) };
  } catch (e) {
    return { ok: false, candidates: [], error: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}
