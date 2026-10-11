// HOMATCH Verify — FRESH PHOTOGRAPHS OF THE EXACT BUILDING. Pure.
//
// When a report's official photographs are old, undated, or only carry a
// document (submission) date, research-agent's `fresh_photos` action looks
// for one or two AUTHENTIC, RECENT photographs of the same building in public
// sources whose reuse is permitted, and stores them as
// synthesis_json.freshPhotos (FreshPhotoSearch).
//
// This file is the judgement, with no network: where the building is, what
// the subject is called, whether a candidate image shows THIS building, is
// recent, is dated by its capture (not its upload), and may be reused. The
// network lives in supabase/functions/_shared/freshPhotos/.
//
// Rules that never bend:
//   - never an AI image, never an image that merely sits nearby;
//   - a capture date is only one the provider or EXIF states; an upload date
//     is a publication date and is kept apart, never presented as capture;
//   - no capture date → rejected (NO_CAPTURE_DATE): it cannot be "recent";
//   - only CC0 / public domain / CC BY / CC BY-SA images are kept;
//   - several blocks in one development → scope DEVELOPMENT unless the image
//     itself names the subject's block. We never claim a specific block.
//
// It also holds reconcileConstructionStatus(): three separate, dated
// statuses (physical, occupancy, commissioning) from the evidence the report
// already has. An old unfinished-construction photo never overrides newer
// evidence, and absence of newer evidence never means "still unfinished".

import {
  centerFromBrowserOfficial,
  centerFromCadastralPlan,
  haversineM,
  inGeorgia,
  parentParcel,
  type GeoPoint,
} from './intelligence/neighborhood.ts';
import { transliterate } from '../lib/metaAds/geoQuery.ts';

/* ── contract (V7_SHARED.md) ─────────────────────────────────────────── */

export type FreshPhotoSource = 'WIKIMEDIA_COMMONS' | 'MAPILLARY' | 'DEVELOPER_SITE' | 'OTHER';

export interface FreshPhoto {
  id: string;
  path: string;
  url?: string;
  source: FreshPhotoSource;
  sourceUrl: string;
  author: string | null;
  license: string | null;
  licenseUrl: string | null;
  capturedAt: string | null;
  captureDateSource: 'EXIF' | 'PROVIDER_CAPTURE' | null;
  publishedAt: string | null;
  retrievedAt: string;
  distanceM: number | null;
  scope: 'BUILDING' | 'DEVELOPMENT';
  width?: number;
  height?: number;
}

export type FreshSourceStatus = 'SEARCHED' | 'SKIPPED_NO_KEY' | 'SKIPPED_RIGHTS' | 'FAILED';

export interface FreshSourceOutcome {
  source: string;
  status: FreshSourceStatus;
  candidates: number;
  accepted: number;
  rejected: Record<string, number>;
}

export interface FreshPhotoSearch {
  version: 1;
  status: 'FOUND' | 'NONE_FOUND' | 'NOT_RUN' | 'FAILED' | 'NO_LOCATION';
  searchedAt: string | null;
  center: { lat: number; lng: number; basis: string } | null;
  sources: FreshSourceOutcome[];
  photos: FreshPhoto[];
  /** Additive: when the action last ran (any outcome), for the 24 h rule. */
  checkedAt?: string;
  /** Additive: why a search did not run (NOT_RUN) or failed. */
  reason?: string;
}

export const FRESH_PHOTOS_VERSION = 1 as const;
export const FRESH_PHOTO_MAX = 2;
export const FRESH_PHOTO_USER_AGENT = 'HOMATCH-Verify/1.0 (https://homatch.live)';
export const FRESH_PHOTO_FETCH_TIMEOUT_MS = 8_000;
export const FRESH_PHOTO_TOTAL_BUDGET_MS = 25_000;
export const FRESH_PHOTO_RERUN_MS = 24 * 3600 * 1000;
/** Camera-to-centre radius searched on Commons (geosearch). */
export const COMMONS_RADIUS_M = 150;
/** Street-level imagery must be taken this close, facing the building. */
export const MAPILLARY_MAX_DISTANCE_M = 80;
export const HEADING_TOLERANCE_DEG = 40;
/** An object location (the depicted place) this close counts as the building. */
export const OBJECT_LOCATION_MAX_M = 50;
/** "Recent": a capture older than this is never presented as the building's current look. */
export const FRESH_MAX_AGE_DAYS = 3 * 365;
/** Official photographs this old (or undated) make a fresh search worthwhile. */
export const OFFICIAL_PHOTO_STALE_DAYS = 365;
/** Where fresh images are copied, inside bucket verify-official-visuals. */
export function freshPhotoPath(jobId: string, id: string, ext: string): string {
  return `${jobId}/fresh/${id}.${ext}`;
}

/** Sources we deliberately do not take images from, and why (recorded, never fetched). */
export const RIGHTS_SKIPPED_SOURCES: readonly string[] = ['DEVELOPER_SITE', 'SOCIAL_MEDIA', 'LISTING_PORTALS', 'KORTER'];

export type RejectReason =
  | 'NO_COORDINATES'
  | 'TOO_FAR'
  | 'HEADING_MISMATCH'
  | 'NOT_IDENTIFIED'
  | 'OTHER_DEVELOPMENT'
  | 'OTHER_STREET'
  | 'OTHER_ADDRESS'
  | 'OTHER_BLOCK'
  | 'LICENCE_NOT_REUSABLE'
  | 'AI_GENERATED'
  | 'UNSUPPORTED_MEDIA'
  | 'NO_CAPTURE_DATE'
  | 'INVALID_CAPTURE_DATE'
  | 'TOO_OLD'
  | 'OLDER_THAN_OFFICIAL'
  | 'DUPLICATE';

/** One image a provider returned, normalised by the fetcher, before judgement. */
export interface FreshCandidate {
  source: FreshPhotoSource;
  sourceId: string;
  sourceUrl: string;
  /** The image bytes to copy (a provider thumbnail of bounded size). */
  imageUrl: string;
  mime?: string | null;
  title?: string | null;
  description?: string | null;
  categories?: string[];
  author?: string | null;
  license?: string | null;
  licenseUrl?: string | null;
  /** Raw provider/EXIF capture value; parsed here. */
  capturedRaw?: string | number | null;
  captureDateSource?: 'EXIF' | 'PROVIDER_CAPTURE' | null;
  /** Upload / publication time (raw). Never used as capture. */
  publishedRaw?: string | number | null;
  /** Camera position. */
  lat?: number | null;
  lng?: number | null;
  /** Depicted-object position, when the provider states it separately. */
  objectLat?: number | null;
  objectLng?: number | null;
  /** Camera heading, degrees from north. */
  heading?: number | null;
  width?: number | null;
  height?: number | null;
}

/** What the report already knows about the subject's names. */
export interface FreshSubject {
  developmentNames: string[];
  streets: Array<{ name: string; number: string | null }>;
  /** Normalised block/building label of the subject, when known ("1", "ts"). */
  block: string | null;
  /** True unless the records show exactly one building on the parcel. */
  multipleBlocks: boolean;
}

export interface FreshContext {
  center: GeoPoint;
  subject: FreshSubject;
  /** Newest official photo date (YYYY-MM-DD; capture or document date), or null. */
  newestOfficialPhotoDate: string | null;
  now: Date;
}

export interface Judgement {
  accepted: boolean;
  reason: RejectReason | null;
  distanceM: number | null;
  capturedAt: string | null;
  publishedAt: string | null;
  scope: 'BUILDING' | 'DEVELOPMENT';
  /** Why the image is believed to show the building. */
  identity: 'NAME_MATCH' | 'OBJECT_LOCATION' | 'HEADING' | null;
}

/* ── dates ───────────────────────────────────────────────────────────── */

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function validYmd(y: string, m: string, d: string): string | null {
  const yy = Number(y), mm = Number(m), dd = Number(d);
  if (!(yy >= 1990 && yy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return null;
  const dt = new Date(Date.UTC(yy, mm - 1, dd));
  if (dt.getUTCMonth() !== mm - 1) return null;
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * A day-precise date (YYYY-MM-DD) from a provider value, or null.
 * Accepts epoch milliseconds, ISO / EXIF ("2024:05:14 10:00:00") forms,
 * "14 May 2024", and Commons' HTML-wrapped values. A year or month alone is
 * NOT a date: it cannot place a photo before or after a dated document.
 */
export function parseDayDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(raw).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();
  let m = s.match(/(?<!\d)(\d{4})[\-/.:](\d{1,2})[\-/.:](\d{1,2})(?!\d)/);
  if (m) return validYmd(m[1], m[2], m[3]);
  m = s.match(/(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)/);
  if (m) return validYmd(m[3], m[2], m[1]);
  m = s.match(/(?<!\d)(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return validYmd(m[3], MONTHS[m[2].toLowerCase()], m[1]);
  m = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return validYmd(m[3], MONTHS[m[1].toLowerCase()], m[2]);
  return null;
}

function daysBetween(a: string, b: Date): number {
  return (b.getTime() - Date.parse(`${a}T00:00:00Z`)) / 86400000;
}

/* ── licences ────────────────────────────────────────────────────────── */

/**
 * Reuse permitted for a commercial report: CC0, public domain, CC BY, CC BY-SA.
 * NC (non-commercial), ND (no derivatives), GFDL-only, fair use, "all rights
 * reserved" or an unknown licence are refused.
 */
export function licenceReusable(license: string | null | undefined, licenseUrl?: string | null): boolean {
  const l = `${license ?? ''} ${licenseUrl ?? ''}`.toLowerCase();
  if (!l.trim()) return false;
  if (/\bnc\b|non-?commercial|\bnd\b|no-?deriv|fair use|all rights reserved|copyright(ed)?\b(?!.*(cc|creative))/i.test(l)) return false;
  if (/-nc|-nd|by-nc|by-nd/.test(l)) return false;
  if (/\bcc0\b|cc-zero|publicdomain|public domain|\bpd\b|\bpd-/.test(l)) return true;
  if (/cc[ -]by(-sa)?([ -]\d|\b)|creativecommons\.org\/licenses\/by(-sa)?\//.test(l)) return true;
  return false;
}

const AI_MARKERS = /\b(ai[- ]generated|generated by ai|artificial intelligence|midjourney|stable diffusion|dall[- ·]?e|text-to-image|neural network art|image generator|rendering|render|visuali[sz]ation|3d model|computer[- ]generated)\b/i;

/* ── names ───────────────────────────────────────────────────────────── */

function fold(s: unknown): string {
  return transliterate(String(s ?? ''))
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set([
  'street', 'str', 'avenue', 'kucha', 'gamziri', 'ulitsa', 'prospekt', 'tbilisi', 'georgia', 'sakartvelo', 'the', 'and',
  'building', 'residential', 'complex', 'house', 'block', 'bloki', 'korpusi', 'tower', 'towers', 'residence', 'residences',
  'project', 'proekti', 'new', 'city', 'shps', 'llc', 'ltd',
]);

function tokens(s: unknown): string[] {
  return fold(s).replace(/\./g, ' ').split(' ').filter((t) => t.length >= 4 && !STOP.has(t) && !/^\d+$/.test(t));
}

function sameToken(a: string, b: string): boolean {
  if (a === b) return true;
  const n = Math.min(a.length, b.length, 6);
  return n >= 4 && a.slice(0, n) === b.slice(0, n);
}

/** Two names refer to the same thing: every significant token of the shorter is in the longer. */
export function namesMatch(a: unknown, b: unknown): boolean {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((t) => long.some((u) => sameToken(t, u)));
}

/** Every significant token of `name` appears in `text`. */
export function containsName(text: unknown, name: unknown): boolean {
  const tn = tokens(name), tt = tokens(text);
  return tn.length > 0 && tn.every((t) => tt.some((u) => sameToken(t, u)));
}

const STREET_AFTER = /([a-z][a-z'-]+(?: [a-z][a-z'-]+)?) (?:street|str\.?|st\.|st|avenue|ave\.?|kucha|k\.|gamziri|ulitsa)(?: n?(\d+[a-z]?))?(?![a-z])/g;
const STREET_BEFORE = /(?<![a-z])(?:ulitsa|ul\.|prospekt|pr\.)\s*([a-z][a-z'-]+(?: [a-z][a-z'-]+)?)(?: n?(\d+[a-z]?))?/g;
const NUMBER_FIRST = /(?<![\d.])(\d+[a-z]?) ([a-z][a-z'-]+(?: [a-z][a-z'-]+)?) (?:street|str\.?|st\.|st|avenue|ave\.?)(?![a-z])/g;

/** Street names (and house numbers) a text mentions. */
export function streetMentions(text: unknown): Array<{ name: string; number: string | null }> {
  const s = fold(text);
  const out: Array<{ name: string; number: string | null }> = [];
  for (const m of s.matchAll(NUMBER_FIRST)) out.push({ name: m[2], number: m[1] });
  for (const m of s.matchAll(STREET_AFTER)) if (!out.some((o) => o.name === m[1])) out.push({ name: m[1], number: m[2] ?? null });
  for (const m of s.matchAll(STREET_BEFORE)) out.push({ name: m[1], number: m[2] ?? null });
  return out.filter((o) => tokens(o.name).length > 0);
}

const DEV_SUFFIX = /([a-z][a-z'-]+(?: [a-z][a-z'-]+){0,2}) (?:residence|residences|towers?|plaza|complex|park|city|garden|gardens|hills|village)(?![a-z])/g;
const DEV_PREFIX = /(?<![a-z])(?:residential complex|zhk|zhilo[a-z]* kompleks|kompleksi|sakhlebi)\s+([a-z][a-z'-]+(?: [a-z][a-z'-]+){0,2})/g;
const QUOTED = /[«„“"]([^«»„“”"]{3,40})[»“”"]/g;

/** Development names a text mentions (quoted names, "X Residence", "ЖК X", …). */
export function developmentMentions(text: unknown): string[] {
  const raw = String(text ?? '');
  const out: string[] = [];
  for (const m of raw.matchAll(QUOTED)) out.push(fold(m[1]));
  const s = fold(raw);
  for (const m of s.matchAll(DEV_SUFFIX)) out.push(m[1]);
  for (const m of s.matchAll(DEV_PREFIX)) out.push(m[1]);
  return [...new Set(out)].filter((n) => tokens(n).length > 0);
}

const BLOCK = /(?<![a-z])(?:bloki|block|blok|korpusi|korpus)\s+(?:n|no\.?|#)?\s*([a-z]{1,2}|\d{1,3})(?![a-z\d])/g;
const NOT_A_BLOCK = new Set(['of', 'in', 'on', 'at', 'is', 'to', 'by', 'an']);

/** Normalised block label: "01" → "1", Georgian "ც" → "ts". */
export function normBlock(b: unknown): string | null {
  const s = fold(b).replace(/^n\s*/, '').replace(/^0+(?=\d)/, '').trim();
  return s ? s : null;
}

export function blockMentions(text: unknown): string[] {
  const s = fold(text);
  return [...new Set([...s.matchAll(BLOCK)].filter((m) => !NOT_A_BLOCK.has(m[1])).map((m) => normBlock(m[1])).filter((x): x is string => !!x))];
}

/* ── geometry ────────────────────────────────────────────────────────── */

/** Initial bearing from a to b, degrees from north. */
export function bearingDeg(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function headingDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/* ── the judgement ───────────────────────────────────────────────────── */

const IMAGE_MIME = /^image\/(jpeg|png|webp)$/i;

/** Is this image a recent, reusable photograph of the subject building? */
export function judgeCandidate(c: FreshCandidate, ctx: FreshContext): Judgement {
  const capturedAt = parseDayDate(c.capturedRaw);
  const publishedAt = parseDayDate(c.publishedRaw);
  const out = (reason: RejectReason | null, extra: Partial<Judgement> = {}): Judgement => ({
    accepted: reason == null, reason, distanceM: null, capturedAt, publishedAt, scope: 'DEVELOPMENT', identity: null, ...extra,
  });
  const text = [c.title, c.description, ...(c.categories ?? [])].filter(Boolean).join(' \n ');

  if (c.mime && !IMAGE_MIME.test(c.mime)) return out('UNSUPPORTED_MEDIA');
  if (AI_MARKERS.test(text)) return out('AI_GENERATED');
  if (!licenceReusable(c.license, c.licenseUrl)) return out('LICENCE_NOT_REUSABLE');

  const lat = num(c.lat), lng = num(c.lng);
  if (lat == null || lng == null) return out('NO_COORDINATES');
  const cam = { lat, lng };
  const distanceM = Math.round(haversineM(cam, ctx.center));
  const maxD = c.source === 'MAPILLARY' ? MAPILLARY_MAX_DISTANCE_M : COMMONS_RADIUS_M;
  if (distanceM > maxD) return out('TOO_FAR', { distanceM });

  const heading = num(c.heading);
  let headingOk = false;
  if (heading != null && distanceM > 5) {
    if (headingDiff(heading, bearingDeg(cam, ctx.center)) > HEADING_TOLERANCE_DEG) return out('HEADING_MISMATCH', { distanceM });
    headingOk = distanceM <= MAPILLARY_MAX_DISTANCE_M;
  } else if (heading != null) {
    headingOk = true; // standing at the centre: any direction shows the building
  }

  // Names: a text that names something else is another building.
  const subj = ctx.subject;
  const devs = developmentMentions(text);
  if (subj.developmentNames.length && devs.length && !devs.some((d) => subj.developmentNames.some((n) => namesMatch(d, n)))) {
    return out('OTHER_DEVELOPMENT', { distanceM });
  }
  const streets = streetMentions(text);
  let streetMatch = false;
  if (subj.streets.length && streets.length) {
    const same = streets.filter((s) => subj.streets.some((t) => namesMatch(s.name, t.name)));
    if (!same.length) return out('OTHER_STREET', { distanceM });
    const numbered = same.filter((s) => s.number);
    const subjNums = subj.streets.map((t) => t.number).filter(Boolean) as string[];
    if (numbered.length && subjNums.length && !numbered.some((s) => subjNums.includes(String(s.number)))) return out('OTHER_ADDRESS', { distanceM });
    streetMatch = true;
  }
  if (!streetMatch && subj.streets.some((t) => containsName(text, t.name))) streetMatch = true;
  const devMatch = devs.some((d) => subj.developmentNames.some((n) => namesMatch(d, n)))
    || subj.developmentNames.some((n) => containsName(text, n));
  const blocks = blockMentions(text);
  let blockNamed = false;
  if (subj.multipleBlocks && blocks.length && subj.block) {
    if (!blocks.includes(subj.block)) return out('OTHER_BLOCK', { distanceM });
    blockNamed = true;
  }

  // Positive identity: a name, the depicted place, or a camera facing the building.
  const oLat = num(c.objectLat), oLng = num(c.objectLng);
  const objectOk = oLat != null && oLng != null && haversineM({ lat: oLat, lng: oLng }, ctx.center) <= OBJECT_LOCATION_MAX_M;
  const identity: Judgement['identity'] = streetMatch || devMatch ? 'NAME_MATCH' : objectOk ? 'OBJECT_LOCATION' : headingOk ? 'HEADING' : null;
  if (!identity) return out('NOT_IDENTIFIED', { distanceM });

  // An upload date is not a capture date; a year or month alone cannot order it.
  if (!capturedAt) return out('NO_CAPTURE_DATE', { distanceM, identity });
  const age = daysBetween(capturedAt, ctx.now);
  if (age < -1) return out('INVALID_CAPTURE_DATE', { distanceM, identity });
  if (age > FRESH_MAX_AGE_DAYS) return out('TOO_OLD', { distanceM, identity });
  if (ctx.newestOfficialPhotoDate && capturedAt < ctx.newestOfficialPhotoDate) return out('OLDER_THAN_OFFICIAL', { distanceM, identity });

  const scope: 'BUILDING' | 'DEVELOPMENT' = !subj.multipleBlocks || blockNamed ? 'BUILDING' : 'DEVELOPMENT';
  return out(null, { distanceM, identity, scope });
}

export interface Selection {
  accepted: Array<{ candidate: FreshCandidate; judgement: Judgement }>;
  bySource: Record<string, { candidates: number; accepted: number; rejected: Record<string, number> }>;
}

/** Judge every candidate, drop duplicates, keep the newest FRESH_PHOTO_MAX. */
export function selectFreshPhotos(candidates: FreshCandidate[], ctx: FreshContext, max = FRESH_PHOTO_MAX): Selection {
  const bySource: Selection['bySource'] = {};
  const tally = (src: string) => (bySource[src] ??= { candidates: 0, accepted: 0, rejected: {} });
  const reject = (src: string, r: string) => { const t = tally(src); t.rejected[r] = (t.rejected[r] ?? 0) + 1; };
  const kept: Selection['accepted'] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    tally(c.source).candidates++;
    const key = `${c.source}:${c.sourceId}`;
    if (seen.has(key)) { reject(c.source, 'DUPLICATE'); continue; }
    seen.add(key);
    const j = judgeCandidate(c, ctx);
    if (!j.accepted) { reject(c.source, j.reason as string); continue; }
    // A burst of the same scene (same author, same day, a few metres apart) is one photo.
    const twin = kept.find((k) => k.candidate.source === c.source
      && (k.candidate.author ?? '') === (c.author ?? '')
      && k.judgement.capturedAt === j.capturedAt
      && Math.abs((k.judgement.distanceM ?? 0) - (j.distanceM ?? 0)) <= 15);
    if (twin) { reject(c.source, 'DUPLICATE'); continue; }
    kept.push({ candidate: c, judgement: j });
  }
  kept.sort((a, b) => String(b.judgement.capturedAt).localeCompare(String(a.judgement.capturedAt))
    || (a.judgement.distanceM ?? 1e9) - (b.judgement.distanceM ?? 1e9));
  const accepted = kept.slice(0, max);
  for (const extra of kept.slice(max)) reject(extra.candidate.source, 'NOT_NEWEST');
  for (const a of accepted) tally(a.candidate.source).accepted++;
  return { accepted, bySource };
}

/** Stable id: sha256 of source + sourceId (hex). */
export async function freshPhotoId(source: string, sourceId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${source}:${sourceId}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The stored record for one accepted, copied image. */
export function toFreshPhoto(c: FreshCandidate, j: Judgement, at: { id: string; path: string; retrievedAt: string }): FreshPhoto {
  const w = num(c.width), h = num(c.height);
  return {
    id: at.id,
    path: at.path,
    source: c.source,
    sourceUrl: c.sourceUrl,
    author: c.author ? String(c.author).slice(0, 200) : null,
    license: c.license ? String(c.license).slice(0, 80) : null,
    licenseUrl: c.licenseUrl ? String(c.licenseUrl).slice(0, 300) : null,
    capturedAt: j.capturedAt,
    captureDateSource: j.capturedAt ? (c.captureDateSource ?? 'PROVIDER_CAPTURE') : null,
    publishedAt: j.publishedAt,
    retrievedAt: at.retrievedAt,
    distanceM: j.distanceM,
    scope: j.scope,
    ...(w ? { width: w } : {}),
    ...(h ? { height: h } : {}),
  };
}

/** The final record: FOUND only when at least one photo was copied. */
export function buildFreshPhotoSearch(input: {
  center: FreshPhotoSearch['center'];
  sources: FreshSourceOutcome[];
  photos: FreshPhoto[];
  searchedAt: string;
}): FreshPhotoSearch {
  const photos = [...input.photos]
    .sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)))
    .slice(0, FRESH_PHOTO_MAX);
  if (!input.center) return { version: 1, status: 'NO_LOCATION', searchedAt: input.searchedAt, center: null, sources: input.sources, photos: [], checkedAt: input.searchedAt };
  const searched = input.sources.filter((s) => s.status === 'SEARCHED');
  const failed = input.sources.filter((s) => s.status === 'FAILED');
  const status: FreshPhotoSearch['status'] = photos.length ? 'FOUND' : !searched.length && failed.length ? 'FAILED' : 'NONE_FOUND';
  return { version: 1, status, searchedAt: input.searchedAt, center: input.center, sources: input.sources, photos, checkedAt: input.searchedAt };
}

export function notRunSearch(reason: string, checkedAt: string, center: FreshPhotoSearch['center'] = null): FreshPhotoSearch {
  return { version: 1, status: 'NOT_RUN', searchedAt: null, center, sources: [], photos: [], checkedAt, reason };
}

/* ── what the report already knows ───────────────────────────────────── */

type Obj = Record<string, any>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/**
 * The building centre the report already resolved, in order: the stored
 * neighbourhood centre (synthesis_json.location.neighborhood.center), then
 * the official map traversal and cadastral plan (neighborhood.ts). The edge
 * falls back to geocodeAddress (neighborhoodFetch.ts) with freshPhotoAddress().
 */
export function freshPhotoCenter(synthesisJson: unknown, resultJson: unknown): FreshPhotoSearch['center'] {
  const stored = obj(obj(obj(synthesisJson).location).neighborhood).center;
  if (stored && inGeorgia(stored as GeoPoint)) return { lat: Number(stored.lat), lng: Number(stored.lng), basis: String(stored.basis ?? 'STORED') };
  const rj = obj(resultJson);
  const exact = obj(rj.exactUnit);
  const parcel = parentParcel(exact.code ?? exact.cadastralCode ?? obj(rj.building).parcel);
  const own = centerFromBrowserOfficial(rj.browserOfficial, parcel);
  if (own) return { ...own, basis: 'MS_MAP_PARCEL' };
  const plan = centerFromCadastralPlan(rj.browserOfficial, parcel);
  if (plan) return { ...plan, basis: 'CADASTRAL_PLAN' };
  return null;
}

/** The address to geocode when no official centre exists. */
export function freshPhotoAddress(synthesisJson: unknown, resultJson: unknown): string | null {
  const pp = obj(obj(resultJson).projectProfile);
  const loc = obj(obj(synthesisJson).location);
  const a = loc.address ?? pp.address ?? (loc.street ? `${loc.street}, ${loc.city ?? 'თბილისი'}` : null);
  return a ? String(a) : null;
}

const STREETISH = /(street|str\.|\bst\b|avenue|ქუჩა|ქ\.|გამზირი|улица|ул\.|проспект)/i;

function streetOf(s: unknown): { name: string; number: string | null } | null {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const n = t.match(/(?:N|№|#)?\s*(\d+[a-zA-Zა-ჰ]?)\b(?!.*\d)/);
  const name = t.replace(/,.*$/, '').replace(/(?:N|№|#)?\s*\d+[a-zA-Zა-ჰ]?\s*$/, '').replace(/^\d+[a-z]?\s+/i, '').trim();
  const lead = t.match(/^(\d+[a-z]?)\s+/i);
  return name ? { name, number: n ? n[1] : lead ? lead[1] : null } : null;
}

/** Names the subject is known by: development, street(s) with house number, block. */
export function freshPhotoSubject(synthesisJson: unknown, resultJson: unknown): FreshSubject {
  const sj = obj(synthesisJson), rj = obj(resultJson);
  const pp = obj(rj.projectProfile);
  const loc = obj(sj.location);
  const devs: string[] = [];
  const streets: Array<{ name: string; number: string | null }> = [];
  for (const n of [pp.brandName, pp.name, ...arr(pp.aliases)]) {
    if (!n || typeof n !== 'string') continue;
    if (STREETISH.test(n)) { const s = streetOf(n); if (s) streets.push(s); continue; }
    devs.push(n);
  }
  for (const a of [loc.street, pp.address]) {
    const s = STREETISH.test(String(a ?? '')) ? streetOf(a) : null;
    if (s) streets.push(s);
  }
  const ident = obj(sj.identity);
  const docs = arr(ident.documentedBuildings).map(normBlock).filter(Boolean);
  const buildingsCount = num(pp.buildings) ?? (Array.isArray(pp.buildings) ? pp.buildings.length : null);
  const multipleBlocks = !(new Set(docs).size === 1 && (buildingsCount == null || buildingsCount <= 1));
  const uniq = <T>(xs: T[], k: (x: T) => string) => xs.filter((x, i) => xs.findIndex((y) => k(y) === k(x)) === i);
  return {
    developmentNames: uniq<string>(devs, (s) => fold(s)),
    streets: uniq(streets, (s) => `${fold(s.name)}|${s.number ?? ''}`),
    block: normBlock(ident.building ?? obj(rj.building).building),
    multipleBlocks,
  };
}

/**
 * Official photographs' dates (YYYY-MM-DD), newest first: a capture date when
 * one is recorded, else the document/submission date (visual.dates.document,
 * or the case filing date joined through officialDocuments by documentId).
 * Each carries which kind of date it is.
 */
export function officialPhotoDates(synthesisJson: unknown): Array<{ date: string; kind: 'CAPTURE' | 'DOCUMENT'; caseRef: string | null }> {
  const sj = obj(synthesisJson);
  const docs = new Map<string, Obj>(arr(sj.officialDocuments).map((d) => [String(obj(d).documentId ?? ''), obj(d)]));
  const out: Array<{ date: string; kind: 'CAPTURE' | 'DOCUMENT'; caseRef: string | null }> = [];
  for (const v of arr(sj.officialVisuals)) {
    const o = obj(v);
    if (String(o.kind ?? '').toUpperCase() !== 'PHOTO') continue;
    const dates = obj(o.dates);
    const cap = parseDayDate(obj(dates.capture).date ?? o.exifDate);
    const doc = docs.get(String(o.documentId ?? ''));
    if (cap) { out.push({ date: cap, kind: 'CAPTURE', caseRef: o.caseRef ?? doc?.caseRef ?? null }); continue; }
    const dd = parseDayDate(obj(dates.document).date ?? o.caseDate ?? doc?.caseDate);
    if (dd) out.push({ date: dd, kind: 'DOCUMENT', caseRef: obj(dates.document).caseRef ?? o.caseRef ?? doc?.caseRef ?? null });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Old, undated, or only document-dated official photos → a fresh search is worthwhile. */
export function freshPhotosNeeded(synthesisJson: unknown, now: Date): boolean {
  const dates = officialPhotoDates(synthesisJson);
  const newestCapture = dates.find((d) => d.kind === 'CAPTURE');
  if (!newestCapture) return true;
  return daysBetween(newestCapture.date, now) > OFFICIAL_PHOTO_STALE_DAYS;
}

/** Run at most once per 24 h per job, unless the service role forces it. */
export function freshPhotosDue(previous: unknown, nowMs: number, force = false): boolean {
  if (force) return true;
  const p = obj(previous);
  const at = Date.parse(String(p.checkedAt ?? p.searchedAt ?? ''));
  return !Number.isFinite(at) || nowMs - at >= FRESH_PHOTO_RERUN_MS;
}

/* ── construction status, reconciled ─────────────────────────────────── */

export type Depicts = 'UNFINISHED' | 'COMPLETE' | null;

export interface ConstructionEvidence {
  /** Official photos: date = capture when known, else the document (submission) date. */
  officialPhotos?: Array<{ date: string | null; dateKind: 'CAPTURE' | 'DOCUMENT'; depicts?: Depicts; caseRef?: string | null }>;
  /** Accepted fresh photos (capture date only). */
  freshPhotos?: Array<{ capturedAt: string | null; depicts?: Depicts; scope?: 'BUILDING' | 'DEVELOPMENT' }>;
  /** Public-register "მშენებარე" marks with the extract's date. */
  register?: Array<{ extractDate: string | null; underConstruction: boolean }>;
  /** Commissioning (exploitation acceptance) records with their date. */
  commissioning?: Array<{ date: string | null; basis: string; ref?: string | null }>;
  /** Documented occupancy, never inferred. */
  occupancy?: Array<{ date: string | null; state: 'OCCUPIED' | 'UNOCCUPIED'; basis: string }>;
  now: Date;
}

export type StatusBasis =
  | 'FRESH_PHOTO_CAPTURE'
  | 'OFFICIAL_PHOTO_CAPTURE'
  | 'OFFICIAL_PHOTO_DOCUMENT_DATE'
  | 'COMMISSIONING_RECORD'
  | 'REGISTER_EXTRACT'
  | string;

export interface StatusAxis {
  /**
   * physical:      UNFINISHED_AS_OF | COMPLETE_AS_OF | PHOTO_DOCUMENTED_AS_OF | NOT_DOCUMENTED
   * occupancy:     OCCUPIED_AS_OF | UNOCCUPIED_AS_OF | NOT_DOCUMENTED
   * commissioning: COMMISSIONED | REGISTERED_UNDER_CONSTRUCTION_AS_OF | NOT_DOCUMENTED
   */
  state: string;
  basis: StatusBasis | null;
  date: string | null;
  /** The evidence date is more than a year old: say "as of {date}", never "currently". */
  stale: boolean;
  /** Older evidence that newer evidence outranks (kept, never shown as current). */
  superseded: Array<{ state: string; basis: StatusBasis; date: string }>;
  /** Evidence that disagrees with the chosen state and is not older than it. */
  conflicts: Array<{ state: string; basis: StatusBasis; date: string }>;
}

export interface ConstructionStatus {
  physical: StatusAxis;
  occupancy: StatusAxis;
  commissioning: StatusAxis;
}

const NOT_DOCUMENTED = (): StatusAxis => ({ state: 'NOT_DOCUMENTED', basis: null, date: null, stale: false, superseded: [], conflicts: [] });

/**
 * Three separate statuses, each dated and with its basis, or NOT_DOCUMENTED.
 *
 * - The newest dated evidence wins; older evidence is listed as superseded.
 *   An old photo of unfinished construction therefore never overrides a
 *   newer completion photo or commissioning record.
 * - With no newer evidence, an unfinished photo yields UNFINISHED_AS_OF its
 *   date (stale when over a year old) — never "still unfinished".
 * - A register "მშენებარე" mark is a legal-registration fact: it feeds
 *   commissioning ("registered as under construction as of the extract
 *   date"), not the physical state.
 * - Occupancy is only what is documented; it is never inferred.
 * - Undated evidence cannot be ordered and is ignored.
 */
export function reconcileConstructionStatus(ev: ConstructionEvidence): ConstructionStatus {
  const nowD = ev.now;
  const stale = (d: string) => daysBetween(d, nowD) > OFFICIAL_PHOTO_STALE_DAYS;
  type Item = { state: string; basis: StatusBasis; date: string; known: boolean };

  // Physical.
  const phys: Item[] = [];
  for (const p of ev.freshPhotos ?? []) {
    const d = parseDayDate(p.capturedAt);
    if (!d) continue;
    phys.push({ date: d, basis: 'FRESH_PHOTO_CAPTURE', state: p.depicts === 'UNFINISHED' ? 'UNFINISHED_AS_OF' : p.depicts === 'COMPLETE' ? 'COMPLETE_AS_OF' : 'PHOTO_DOCUMENTED_AS_OF', known: !!p.depicts });
  }
  for (const p of ev.officialPhotos ?? []) {
    const d = parseDayDate(p.date);
    if (!d) continue;
    phys.push({ date: d, basis: p.dateKind === 'CAPTURE' ? 'OFFICIAL_PHOTO_CAPTURE' : 'OFFICIAL_PHOTO_DOCUMENT_DATE', state: p.depicts === 'UNFINISHED' ? 'UNFINISHED_AS_OF' : p.depicts === 'COMPLETE' ? 'COMPLETE_AS_OF' : 'PHOTO_DOCUMENTED_AS_OF', known: !!p.depicts });
  }
  for (const c of ev.commissioning ?? []) {
    const d = parseDayDate(c.date);
    if (d) phys.push({ date: d, basis: 'COMMISSIONING_RECORD', state: 'COMPLETE_AS_OF', known: true });
  }
  const pick = (items: Item[]): StatusAxis => {
    if (!items.length) return NOT_DOCUMENTED();
    const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date) || Number(b.known) - Number(a.known));
    const known = sorted.filter((i) => i.known);
    // A described state outranks an undescribed photo; the newest described one wins.
    const top = known[0] ?? sorted[0];
    const others = sorted.filter((i) => i !== top);
    return {
      state: top.state,
      basis: top.basis,
      date: top.date,
      stale: stale(top.date),
      superseded: others.filter((i) => i.date <= top.date && i.known && i.state !== top.state).map(({ state, basis, date }) => ({ state, basis, date })),
      conflicts: others.filter((i) => i.date > top.date && i.known && i.state !== top.state).map(({ state, basis, date }) => ({ state, basis, date })),
    };
  };
  const physical = pick(phys);

  // Occupancy: documented only.
  const occ: Item[] = [];
  for (const o of ev.occupancy ?? []) {
    const d = parseDayDate(o.date);
    if (d) occ.push({ date: d, basis: o.basis, state: o.state === 'OCCUPIED' ? 'OCCUPIED_AS_OF' : 'UNOCCUPIED_AS_OF', known: true });
  }
  const occupancy = pick(occ);

  // Commissioning: a record of acceptance is an event; a register mark is a dated snapshot.
  const acts = (ev.commissioning ?? []).map((c) => ({ ...c, d: parseDayDate(c.date) })).filter((c) => c.d).sort((a, b) => String(b.d).localeCompare(String(a.d)));
  const marks = (ev.register ?? []).map((r) => ({ ...r, d: parseDayDate(r.extractDate) })).filter((r) => r.d && r.underConstruction).sort((a, b) => String(b.d).localeCompare(String(a.d)));
  let commissioning = NOT_DOCUMENTED();
  if (acts.length) {
    const a = acts[0];
    commissioning = {
      state: 'COMMISSIONED', basis: 'COMMISSIONING_RECORD', date: a.d as string, stale: false,
      superseded: marks.filter((m) => (m.d as string) <= (a.d as string)).map((m) => ({ state: 'REGISTERED_UNDER_CONSTRUCTION_AS_OF', basis: 'REGISTER_EXTRACT', date: m.d as string })),
      // A later extract still marking "მშენებარე" is a register that was not updated: shown, not hidden.
      conflicts: marks.filter((m) => (m.d as string) > (a.d as string)).map((m) => ({ state: 'REGISTERED_UNDER_CONSTRUCTION_AS_OF', basis: 'REGISTER_EXTRACT', date: m.d as string })),
    };
  } else if (marks.length) {
    const m = marks[0];
    commissioning = { state: 'REGISTERED_UNDER_CONSTRUCTION_AS_OF', basis: 'REGISTER_EXTRACT', date: m.d as string, stale: stale(m.d as string), superseded: [], conflicts: [] };
  }
  return { physical, occupancy, commissioning };
}

/**
 * The evidence reconcileConstructionStatus() needs, read from a stored report:
 * official photo dates, accepted fresh photos, and the register's
 * "მშენებარე" marks (propertyRegister.latest). Commissioning, occupancy and
 * photo content (`depicts`) are not in the stored report; pass them when a
 * source documents them.
 */
export function constructionEvidenceFromReport(synthesisJson: unknown, now: Date, extra: Partial<ConstructionEvidence> = {}): ConstructionEvidence {
  const sj = obj(synthesisJson);
  const latest = obj(obj(sj.propertyRegister).latest);
  const issued = parseDayDate(latest.issuedAt);
  const marked = latest.unitUnderConstruction === true || latest.buildingsUnderConstruction === true;
  return {
    officialPhotos: officialPhotoDates(sj).map((p) => ({ date: p.date, dateKind: p.kind, caseRef: p.caseRef, depicts: null })),
    freshPhotos: arr(obj(sj.freshPhotos).photos).map((p) => ({ capturedAt: obj(p).capturedAt ?? null, scope: obj(p).scope, depicts: null })),
    register: issued ? [{ extractDate: issued, underConstruction: marked }] : [],
    commissioning: [],
    occupancy: [],
    now,
    ...extra,
  };
}
