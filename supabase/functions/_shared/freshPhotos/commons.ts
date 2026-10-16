// Fresh photos — Wikimedia Commons (free API, no key).
//
// ONE request: geosearch over File: pages (namespace 6) whose camera position
// lies within COMMONS_RADIUS_M of the building centre, with imageinfo
// (thumbnail URL ≤ 1600 px, size, mime, upload timestamp, extmetadata for
// licence / author / description / categories / DateTimeOriginal, and the
// file's own EXIF via commonmetadata) and coordinates (camera = primary,
// depicted place = secondary, when the file states one).
//
// Capture date: EXIF DateTimeOriginal when the file carries it (EXIF), else
// the description page's stated date (PROVIDER_CAPTURE). The upload
// timestamp is a publication date and is kept apart.

import { COMMONS_RADIUS_M, type FreshCandidate } from '../../../../src/verify/freshPhotos.ts';
import { politeJson, type FetchLike } from './http.ts';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const EXT_FIELDS = ['DateTimeOriginal', 'DateTime', 'LicenseShortName', 'LicenseUrl', 'UsageTerms', 'Artist', 'ImageDescription', 'ObjectName', 'Categories', 'Copyrighted'];

export function commonsUrl(center: { lat: number; lng: number }, radiusM = COMMONS_RADIUS_M): string {
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'geosearch',
    ggscoord: `${center.lat.toFixed(6)}|${center.lng.toFixed(6)}`,
    ggsradius: String(Math.round(radiusM)),
    ggsnamespace: '6',
    ggslimit: '50',
    prop: 'imageinfo|coordinates',
    iiprop: 'url|extmetadata|size|timestamp|mime|commonmetadata',
    iiurlwidth: '1600',
    iiextmetadatafilter: EXT_FIELDS.join('|'),
    coprimary: 'all',
    coprop: 'type|name',
    colimit: 'max',
  });
  return `${COMMONS_API}?${q.toString()}`;
}

const strip = (v: unknown): string => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const ext = (meta: any, k: string): string | null => {
  const v = meta?.[k]?.value;
  const s = strip(v);
  return s ? s : null;
};

function exif(common: unknown, name: string): unknown {
  for (const m of Array.isArray(common) ? common : []) if (m && m.name === name) return m.value;
  return null;
}

/** "123/1" or 123 → degrees. */
function rational(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v);
  const m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
  const n = m ? Number(m[1]) / Number(m[2]) : Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Commons API JSON → candidates. Pure. */
export function parseCommons(json: unknown): FreshCandidate[] {
  const pages = (json as any)?.query?.pages;
  const out: FreshCandidate[] = [];
  for (const p of Array.isArray(pages) ? pages : []) {
    const ii = Array.isArray(p?.imageinfo) ? p.imageinfo[0] : null;
    if (!ii) continue;
    const meta = ii.extmetadata ?? {};
    const coords = Array.isArray(p.coordinates) ? p.coordinates : [];
    const cam = coords.find((c: any) => c?.primary === true || c?.primary === '') ?? coords[0] ?? null;
    const obj = coords.find((c: any) => c !== cam && !(c?.primary === true || c?.primary === '')) ?? null;
    const exifDate = exif(ii.commonmetadata, 'DateTimeOriginal');
    const descDate = ext(meta, 'DateTimeOriginal');
    const title = String(p.title ?? '').replace(/^File:/i, '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ');
    out.push({
      source: 'WIKIMEDIA_COMMONS',
      sourceId: String(p.pageid ?? p.title ?? ''),
      sourceUrl: String(ii.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(p.title ?? '').replace(/ /g, '_'))}`),
      imageUrl: String(ii.thumburl ?? ii.url ?? ''),
      mime: ii.mime ?? null,
      title,
      description: [ext(meta, 'ObjectName'), ext(meta, 'ImageDescription')].filter(Boolean).join(' \n ') || null,
      categories: (ext(meta, 'Categories') ?? '').split('|').map((c) => c.trim()).filter(Boolean),
      author: ext(meta, 'Artist'),
      license: ext(meta, 'LicenseShortName') ?? ext(meta, 'UsageTerms'),
      licenseUrl: ext(meta, 'LicenseUrl'),
      capturedRaw: (exifDate as string | null) ?? descDate,
      captureDateSource: exifDate ? 'EXIF' : descDate ? 'PROVIDER_CAPTURE' : null,
      publishedRaw: ii.timestamp ?? null,
      lat: cam?.lat ?? null,
      lng: cam?.lon ?? null,
      objectLat: obj?.lat ?? null,
      objectLng: obj?.lon ?? null,
      heading: rational(exif(ii.commonmetadata, 'GPSImgDirection')),
      width: ii.width ?? null,
      height: ii.height ?? null,
    });
  }
  return out.filter((c) => c.sourceId && c.imageUrl);
}

export async function searchCommons(
  center: { lat: number; lng: number },
  opts: { fetchImpl?: FetchLike; deadline: number },
): Promise<{ ok: boolean; candidates: FreshCandidate[]; error?: string }> {
  try {
    const json = await politeJson(commonsUrl(center), opts);
    if ((json as any)?.error) throw new Error(`api_${String((json as any).error?.code ?? 'error')}`);
    return { ok: true, candidates: parseCommons(json) };
  } catch (e) {
    return { ok: false, candidates: [], error: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}
