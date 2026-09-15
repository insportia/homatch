// HOMATCH DIGITAL TWIN — the client contract.
//
// THE COST MODEL, IN CODE
//
// Opening a development fetches ONE small manifest: the project, its branding
// and a count per building. It contains no unit rows and no geometry, so its
// size does not grow with the number of apartments — a 500-unit scheme and a
// 12-unit scheme cost the same to open.
//
// Everything below that is fetched on intent:
//   loadManifest()      → the shell
//   loadBuildingFloors()→ after a building is chosen
//   loadFloorUnits()    → after a floor is chosen
//   assetUrl()          → only for the template a chosen unit actually uses
//
// A buyer who looks at one apartment never downloads the other 499, and the
// apartment they do look at is a SHARED type-level asset that the browser
// then has cached for every other unit of the same layout.
//
// WHAT THIS FILE DOES NOT CONTAIN
//
// A renderer. There is no Three.js here and no scene graph interpreter; those
// are the next phase. This is the data contract they will consume, and it is
// shaped so that the expensive parts (bytes) are immutable and cacheable while
// the parts that change every day (status, price) are tiny and never cached.

import { supabase } from '@/db/supabase';
import { reportError } from '@/lib/errorReporting';
import type { UnitStatus } from './types';

// ── Types ──────────────────────────────────────────────────────────────────

export type SceneKind = 'MASTERPLAN' | 'BUILDING' | 'FLOOR' | 'UNIT_TYPE';
export type TwinStatus = 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';

export type AssetKind =
  | 'GEOMETRY' | 'TEXTURE' | 'MATERIAL' | 'PANORAMA' | 'IMAGE'
  | 'FLOOR_PLAN' | 'MASTERPLAN' | 'HDRI' | 'AUDIO' | 'SOURCE';

export type StorageProvider = 'SUPABASE' | 'R2' | 'CDN' | 'EXTERNAL';

export interface TwinAsset {
  id: string;
  scope: 'GLOBAL' | 'PROJECT';
  workspace_id: string | null;
  project_id: string | null;
  kind: AssetKind;
  name: string;
  storage_provider: StorageProvider;
  storage_key: string;
  content_hash: string | null;
  version: number;
  bytes: number | null;
  mime: string | null;
  meta: Record<string, unknown>;
  is_deliverable: boolean;
}

export interface TwinTemplate {
  id: string;
  kind: 'APARTMENT' | 'BUILDING' | 'INTERIOR' | 'LANDSCAPE' | 'MATERIAL';
  scope: 'GLOBAL' | 'PROJECT';
  workspace_id: string | null;
  name: string;
  slug: string | null;
  description: string | null;
  config: Record<string, unknown>;
  primary_asset_id: string | null;
  preview_image_url: string | null;
  status: TwinStatus;
  version: number;
}

export interface DevUnitType {
  id: string;
  workspace_id: string;
  project_id: string;
  code: string;
  name: string | null;
  bedrooms: number | null;
  rooms: number | null;
  area_total: number | null;
  area_internal: number | null;
  area_balcony: number | null;
  description: string | null;
  floor_plan_url: string | null;
  /** The shared 3D template. Set by Homatch studio staff only. */
  template_id: string | null;
  created_at: string;
}

export interface ManifestBuilding {
  id: string;
  name: string;
  code: string | null;
  floors_count: number | null;
  facade_image_url: string | null;
  sort_order: number;
  available: number;
  reserved: number;
  sold: number;
  total: number;
  price_from: number | null;
  scene_id: string | null;
}

export interface ExperienceManifest {
  error?: 'NOT_FOUND';
  project?: {
    id: string; name: string; slug: string;
    city: string | null; district: string | null; address: string | null;
    description: string | null; construction_status: string;
    handover_date: string | null; currency: string;
    cover_image_url: string | null; master_plan_url: string | null;
    brochure_url: string | null;
    latitude: number | null; longitude: number | null;
    amenities: string[];
  };
  developer?: {
    name: string; slug: string | null; logo_url: string | null;
    brand_color: string | null; website: string | null;
  };
  experience?: {
    id: string; slug: string;
    branding: Record<string, unknown>;
    embed_enabled: boolean;
    show_homatch_attribution: boolean;
  } | null;
  buildings?: ManifestBuilding[];
  totals?: { available: number; total: number; price_from: number | null; price_to: number | null };
  masterplan_scene_id?: string | null;
}

export interface FloorSummary {
  level: number;
  available: number;
  total: number;
  price_from: number | null;
  plan_image_url: string | null;
}

export interface TwinUnit {
  id: string;
  unit_number: string;
  status: UnitStatus;
  bedrooms: number | null;
  rooms: number | null;
  area_total: number | null;
  area_balcony: number | null;
  orientation: string | null;
  view_text: string | null;
  /** Withheld by the server for anything not AVAILABLE. */
  price: number | null;
  currency: string;
  price_per_sqm: number | null;
  floor_plan_url: string | null;
  photos: string[];
  hotspot: Array<{ x: number; y: number }> | null;
  unit_type: { id: string; code: string; name: string | null; template_id: string | null } | null;
  has_walkthrough: boolean;
}

// ── Reading the twin ───────────────────────────────────────────────────────

/** The shell. One request, a few kilobytes, regardless of unit count. */
export async function loadManifest(
  workspaceSlug: string, projectSlug: string,
): Promise<ExperienceManifest> {
  const { data, error } = await supabase.rpc('dt_experience_manifest', {
    p_workspace_slug: workspaceSlug, p_project_slug: projectSlug,
  });
  if (error) {
    reportError(error, { route: '/p', stage: 'loadManifest', boundary: 'digital-twin' });
    return { error: 'NOT_FOUND' };
  }
  return (data ?? { error: 'NOT_FOUND' }) as ExperienceManifest;
}

/** Floors for one building. Counts only — still no unit rows. */
export async function loadBuildingFloors(
  buildingId: string,
): Promise<{ building?: { id: string; name: string; facade_image_url: string | null }; floors: FloorSummary[] }> {
  const { data, error } = await supabase.rpc('dt_building_floors', { p_building_id: buildingId });
  if (error) {
    reportError(error, { route: '/p', stage: 'loadBuildingFloors', boundary: 'digital-twin' });
    return { floors: [] };
  }
  const payload = (data ?? {}) as { building?: never; floors?: FloorSummary[] };
  return { building: payload.building, floors: payload.floors ?? [] };
}

/** The first call that returns units, for the one floor somebody asked for. */
export async function loadFloorUnits(
  buildingId: string, floorLevel: number,
): Promise<TwinUnit[]> {
  const { data, error } = await supabase.rpc('dt_floor_units', {
    p_building_id: buildingId, p_floor_level: floorLevel,
  });
  if (error) {
    reportError(error, { route: '/p', stage: 'loadFloorUnits', boundary: 'digital-twin' });
    return [];
  }
  return (data ?? []) as TwinUnit[];
}

/**
 * A PUBLISHED SCENE, as an anonymous visitor may read it.
 *
 * `graph` and `camera_presets` are the studio's own authored structure and are
 * passed through untouched; the viewer reads what it understands and ignores
 * the rest, so a studio format change does not break a deployed page.
 *
 * Assets arrive as addressing fields rather than URLs. Building the URL is
 * assetUrl()'s job, because that is the one place that knows whether the bytes
 * live in Supabase Storage, R2 or a CDN.
 */
export interface TwinScene {
  error?: 'NO_SCENE';
  id: string;
  kind: SceneKind;
  name: string | null;
  building_id: string | null;
  unit_type_id: string | null;
  version: number;
  graph: Record<string, unknown>;
  camera_presets: Array<{ name: string; position: number[]; target: number[] }>;
  hotspots: Array<{
    id: string; label: string; position: number[];
    kind?: string; unit_id?: string | null;
  }>;
  /** What the studio measured this scene to weigh. See docs/digital-twin-budgets.md. */
  budget: { bytes?: number; draw_calls?: number; triangles?: number } | null;
  assets: TwinAsset[];
}

/** One floor, as the schematic draws it. Derived from real inventory counts. */
export interface TwinSchematicFloor {
  level: number;
  available: number;
  total: number;
}

export async function loadScene(sceneId: string): Promise<TwinScene | null> {
  const { data, error } = await supabase.rpc('dt_scene', { p_scene_id: sceneId });
  if (error) {
    reportError(error, { route: '/p', stage: 'loadScene', boundary: 'digital-twin' });
    return null;
  }
  const payload = data as TwinScene | null;
  if (!payload || payload.error) return null;
  return payload;
}

/**
 * The scene for an apartment's TYPE, which is where the economics live.
 *
 * 500 apartments across 20 layouts means 20 interiors. A visitor opening 1408
 * asks for its type's scene, and the browser has very probably already cached
 * it from 1108 — the asset URL is immutable and content-addressed, so the
 * second open costs a cache hit rather than a download.
 */
export async function loadUnitScene(unitId: string): Promise<TwinScene | null> {
  const { data, error } = await supabase.rpc('dt_unit_scene', { p_unit_id: unitId });
  if (error) {
    reportError(error, { route: '/p', stage: 'loadUnitScene', boundary: 'digital-twin' });
    return null;
  }
  const payload = data as TwinScene | null;
  if (!payload || payload.error) return null;
  return payload;
}

// ── Where the heavy bytes come from ────────────────────────────────────────

/**
 * THE ONE PLACE AN ASSET BECOMES A URL.
 *
 * Every heavy object is addressed through here, so moving a project's
 * geometry from Supabase Storage to R2 or a CDN is a change of one column in
 * the database plus one branch in this function — not a rewrite of the
 * viewer, the studio or the domain model.
 *
 * The version is in the path, which is what makes the object IMMUTABLE: a
 * cache may hold it forever, and marking an apartment sold invalidates none
 * of it because availability never travels this way.
 */
export function assetUrl(asset: Pick<TwinAsset,
  'storage_provider' | 'storage_key' | 'version' | 'content_hash'>): string {
  const cacheKey = asset.content_hash ?? String(asset.version);

  switch (asset.storage_provider) {
    case 'R2':
    case 'CDN': {
      // Configured per environment; absent today, and absent deliberately —
      // no paid CDN has been added. When one is, only this line changes.
      const base = import.meta.env.VITE_TWIN_ASSET_CDN as string | undefined;
      if (!base) break;
      return `${base.replace(/\/$/, '')}/${asset.storage_key}?v=${cacheKey}`;
    }
    case 'EXTERNAL':
      return asset.storage_key;
    default:
      break;
  }

  // Supabase Storage, and the fallback for a provider with no base configured.
  const { data } = supabase.storage.from(TWIN_ASSET_BUCKET).getPublicUrl(asset.storage_key);
  return `${data.publicUrl}?v=${cacheKey}`;
}

export const TWIN_ASSET_BUCKET = 'developer-media';

// ── Links, embeds and QR ───────────────────────────────────────────────────

export type ShareTarget = 'PROJECT' | 'BUILDING' | 'FLOOR' | 'UNIT' | 'TOUR';

/**
 * Homatch generates its own links. No third-party shortener, and no deployed
 * site per link: every one of these is a route into the same canonical
 * project, so a price change is live on all of them at once.
 */
export function experienceUrl(input: {
  workspaceSlug: string;
  projectSlug: string;
  buildingId?: string | null;
  floorLevel?: number | null;
  unitId?: string | null;
  origin?: string;
}): string {
  const origin = input.origin
    ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const path = `/p/${input.workspaceSlug}/${input.projectSlug}`;
  const params = new URLSearchParams();
  if (input.buildingId) params.set('b', input.buildingId);
  if (input.floorLevel != null) params.set('f', String(input.floorLevel));
  if (input.unitId) params.set('u', input.unitId);
  const query = params.toString();
  return `${origin}${path}${query ? `?${query}` : ''}`;
}

export function embedUrl(input: {
  workspaceSlug: string; projectSlug: string; buildingId?: string | null;
  unitId?: string | null; origin?: string;
}): string {
  const origin = input.origin
    ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const params = new URLSearchParams();
  if (input.buildingId) params.set('b', input.buildingId);
  if (input.unitId) params.set('u', input.unitId);
  const query = params.toString();
  return `${origin}/embed/${input.workspaceSlug}/${input.projectSlug}${query ? `?${query}` : ''}`;
}

/**
 * A responsive iframe with no script tag.
 *
 * The aspect-ratio wrapper is what makes it behave on a phone without the
 * developer's web team doing anything. `loading="lazy"` means putting it far
 * down a landing page costs that page nothing until somebody scrolls to it.
 */
export function embedSnippet(src: string, title: string): string {
  const safeTitle = title.replace(/"/g, '&quot;');
  return `<div style="position:relative;width:100%;aspect-ratio:16/10;min-height:420px">
  <iframe
    src="${src}"
    title="${safeTitle}"
    loading="lazy"
    allow="fullscreen; xr-spatial-tracking; gyroscope; accelerometer"
    referrerpolicy="strict-origin-when-cross-origin"
    style="position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:12px"
  ></iframe>
</div>`;
}

/**
 * QR generated in the browser with the `qrcode` package already in this
 * project. No QR SaaS, no per-code cost, and the image never leaves the
 * device it was made on.
 */
export async function qrDataUrl(url: string): Promise<string> {
  const QRCode = (await import('qrcode')).default;
  return QRCode.toDataURL(url, {
    margin: 1,
    width: 512,
    errorCorrectionLevel: 'M',
    color: { dark: '#1A1A1A', light: '#FFFFFF' },
  });
}

// ── Analytics that cost less than the viewer ───────────────────────────────

export type TwinEventKind =
  | 'PROJECT_OPEN' | 'BUILDING_VIEW' | 'FLOOR_VIEW' | 'UNIT_VIEW'
  | 'FLOORPLAN_VIEW' | 'WALKTHROUGH_START' | 'WALKTHROUGH_COMPLETE'
  | 'HOTSPOT' | 'CONTACT_REQUEST' | 'SHARE' | 'EMBED_OPEN';

interface QueuedEvent {
  kind: TwinEventKind;
  building_id?: string | null;
  unit_id?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * A BATCHING TRACKER, AND THE REASON IT EXISTS.
 *
 * Per-event requests are how analytics ends up costing more than the product
 * it measures. A visitor browsing four floors and six apartments would send
 * eleven requests; this sends one.
 *
 * Nothing frame-based is accepted by design — there is no camera-position
 * method here and there will not be one. What is recorded is the handful of
 * acts a salesperson can act on: they opened it, they looked at this
 * building, they opened this apartment, they asked to be contacted.
 */
export class TwinTracker {
  private queue: QueuedEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly visitor: string | null;

  constructor(
    private readonly workspaceSlug: string,
    private readonly projectSlug: string,
    private readonly origin: 'PUBLIC' | 'SHARE' | 'EMBED' | 'STUDIO_PREVIEW' = 'PUBLIC',
    private readonly experienceSlug: string | null = null,
    private readonly flushMs = 4000,
  ) {
    this.visitor = readVisitorKey();
    if (typeof window !== 'undefined') {
      // A visitor who closes the tab mid-session still counts. pagehide fires
      // where beforeunload does not on mobile Safari, which is most of them.
      window.addEventListener('pagehide', () => void this.flush());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void this.flush();
      });
    }
  }

  track(event: QueuedEvent): void {
    this.queue.push(event);
    // 25 is half the server's per-call ceiling, so a burst never loses events.
    if (this.queue.length >= 25) { void this.flush(); return; }
    if (this.timer) return;
    this.timer = setTimeout(() => void this.flush(), this.flushMs);
  }

  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.queue.length === 0) return;

    const events = this.queue.splice(0, this.queue.length);
    const { error } = await supabase.rpc('dt_track', {
      p_experience_slug: this.experienceSlug,
      p_workspace_slug: this.workspaceSlug,
      p_project_slug: this.projectSlug,
      p_events: events,
      p_origin: this.origin,
      p_origin_host: typeof document !== 'undefined' && document.referrer
        ? safeHost(document.referrer) : null,
      p_visitor: this.visitor,
    });
    if (error) {
      // Reported, never surfaced: a buyer reading an apartment page must not
      // see an error because a counter failed, and must never wait for one.
      reportError(error, { route: '/p', stage: 'twin.track', boundary: 'digital-twin' });
    }
  }
}

function safeHost(url: string): string | null {
  try { return new URL(url).host; } catch { return null; }
}

/**
 * Per-tab, per-session random string. The server hashes it with the project
 * id and today's date before storing, so it cannot be joined to another
 * project, another day, or anything outside this product. It exists to tell
 * one visit from ten and for nothing else.
 */
function readVisitorKey(): string | null {
  try {
    const existing = sessionStorage.getItem('homatch-twin-visit');
    if (existing) return existing;
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const value = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem('homatch-twin-visit', value);
    return value;
  } catch {
    return null;
  }
}

// ── Unit types (the reuse spine) ───────────────────────────────────────────

export async function listUnitTypes(projectId: string): Promise<DevUnitType[]> {
  const { data, error } = await supabase
    .from('dev_unit_types').select('*').eq('project_id', projectId).order('code');
  if (error) {
    const { toDevError } = await import('./client');
    throw toDevError(error, { op: 'listUnitTypes', subjectId: projectId });
  }
  return (data ?? []) as DevUnitType[];
}

/**
 * Derive the distinct layouts a project's units already describe.
 *
 * This is how a 500-unit import becomes 20 types without anybody typing them:
 * units that agree on bedrooms, rooms and area to the square metre are the
 * same layout, and the caller confirms the grouping before it is saved.
 * Nothing is written here.
 */
export function suggestUnitTypes(units: Array<{
  bedrooms: number | null; rooms: number | null; area_total: number | null; unit_type: string | null;
}>): Array<{ code: string; bedrooms: number | null; rooms: number | null; area_total: number | null; count: number }> {
  const groups = new Map<string, {
    code: string; bedrooms: number | null; rooms: number | null; area_total: number | null; count: number;
  }>();

  for (const unit of units) {
    if (unit.area_total == null && unit.bedrooms == null) continue;
    const area = unit.area_total == null ? 'x' : unit.area_total.toFixed(1);
    const key = `${unit.bedrooms ?? 'x'}|${unit.rooms ?? 'x'}|${area}`;
    const existing = groups.get(key);
    if (existing) { existing.count += 1; continue; }
    groups.set(key, {
      // Prefer the developer's own label when their sheet had one.
      code: unit.unit_type?.trim()
        || `${unit.bedrooms ?? '?'}B-${unit.area_total?.toFixed(0) ?? '?'}`,
      bedrooms: unit.bedrooms, rooms: unit.rooms, area_total: unit.area_total, count: 1,
    });
  }

  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}
