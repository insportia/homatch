// HOMATCH DESIGN STUDIO — catalogue administration (admin only).
//
// Lists imported catalogue assets (server-side filtered and paged: a 2,000+
// catalogue never comes to the browser at once), and changes availability in
// bulk through the audited, admin-only database functions. Availability is not
// storage: disabling only stops new selection; physical deletion is a separate
// server step that refuses any asset a saved design or share still uses.

import { supabase } from '@/db/supabase';
import { signedUrls } from '@/services/designStudio/files';

export type Lifecycle = 'UNPUBLISHED' | 'ACTIVE' | 'DISABLED' | 'PENDING_DELETE' | 'DELETED';
export type LifecycleTarget = 'ACTIVE' | 'DISABLED' | 'PENDING_DELETE' | 'CANCEL_DELETE';

export interface CatalogFilters {
  search: string;
  provider: string | null;
  kind: string | null;
  category: string | null;
  subcategory: string | null;
  license: string | null;
  tier: string | null;
  batch: string | null;
  state: string | null;
  lifecycle: string | null;
  importedFrom: string | null;
  importedTo: string | null;
}

export const EMPTY_FILTERS: CatalogFilters = {
  search: '', provider: null, kind: null, category: null, subcategory: null, license: null, tier: null,
  batch: null, state: null, lifecycle: null, importedFrom: null, importedTo: null,
};

export interface CatalogRow {
  homatchAssetId: string;
  provider: string;
  sourceAssetId: string;
  kind: 'MODEL' | 'MATERIAL' | 'ENVIRONMENT';
  category: string;
  subcategory: string;
  name: string;
  license: string;
  tier: string | null;
  state: string;
  lifecycle: Lifecycle;
  batch: string | null;
  importedAt: string;
  storedBytes: number;
  sourceBytes: number;
  optimizedBytes: number;
  lastError: string | null;
}

/** The most rows one bulk action may name (matches the database function). */
export const MAX_BULK = 5000;
export const PAGE_SIZE = 50;

const COLUMNS = 'homatch_asset_id, source_provider, source_asset_id, kind, canonical_category, canonical_subcategory, display_name, license_class, quality_tier, state, lifecycle, import_batch_id, created_at, stored_bytes, source_bytes, optimized_bytes, last_error';

/** PostgREST `or`/`ilike` input: letters, digits, spaces and a few separators only. */
const safeSearch = (s: string) => s.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 60);

/** The filter methods used here (a narrow view of the PostgREST builder, to keep the types shallow). */
interface Filterable { eq(c: string, v: string): Filterable; gte(c: string, v: string): Filterable; lte(c: string, v: string): Filterable; or(f: string): Filterable }

function applyFilters<Q>(query: Q, f: CatalogFilters): Q {
  let r = query as unknown as Filterable;
  if (f.provider) r = r.eq('source_provider', f.provider);
  if (f.kind) r = r.eq('kind', f.kind);
  if (f.category) r = r.eq('canonical_category', f.category);
  if (f.subcategory) r = r.eq('canonical_subcategory', f.subcategory);
  if (f.license) r = r.eq('license_class', f.license);
  if (f.tier) r = r.eq('quality_tier', f.tier);
  if (f.batch) r = r.eq('import_batch_id', f.batch);
  if (f.state) r = r.eq('state', f.state);
  if (f.lifecycle) r = r.eq('lifecycle', f.lifecycle);
  if (f.importedFrom) r = r.gte('created_at', f.importedFrom);
  if (f.importedTo) r = r.lte('created_at', `${f.importedTo}T23:59:59.999Z`);
  const s = safeSearch(f.search);
  if (s) r = r.or(`display_name.ilike.%${s}%,source_asset_id.ilike.%${s}%,homatch_asset_id.ilike.%${s}%`);
  return r as unknown as Q;
}

const toRow = (r: Record<string, unknown>): CatalogRow => ({
  homatchAssetId: String(r.homatch_asset_id), provider: String(r.source_provider), sourceAssetId: String(r.source_asset_id),
  kind: r.kind as CatalogRow['kind'], category: String(r.canonical_category), subcategory: String(r.canonical_subcategory),
  name: String(r.display_name), license: String(r.license_class), tier: (r.quality_tier as string) ?? null, state: String(r.state),
  lifecycle: (r.lifecycle as Lifecycle) ?? 'UNPUBLISHED', batch: (r.import_batch_id as string) ?? null, importedAt: String(r.created_at),
  storedBytes: Number(r.stored_bytes ?? 0), sourceBytes: Number(r.source_bytes ?? 0), optimizedBytes: Number(r.optimized_bytes ?? 0),
  lastError: (r.last_error as string) ?? null,
});

/** One page of the filtered catalogue, newest first, with the exact total. */
export async function listCatalog(f: CatalogFilters, page: number): Promise<{ rows: CatalogRow[]; total: number }> {
  const from = Math.max(0, page) * PAGE_SIZE;
  const q = applyFilters(supabase.from('ds_catalog_imports').select(COLUMNS, { count: 'exact' }), f)
    .order('created_at', { ascending: false }).order('homatch_asset_id').range(from, from + PAGE_SIZE - 1);
  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { rows: (data ?? []).map((r) => toRow(r as Record<string, unknown>)), total: count ?? 0 };
}

/** Every id the current filter matches ("Select all N"), at most MAX_BULK. */
export async function idsMatching(f: CatalogFilters): Promise<{ ids: string[]; total: number }> {
  const { data, error, count } = await applyFilters(supabase.from('ds_catalog_imports').select('homatch_asset_id', { count: 'exact' }), f)
    .order('homatch_asset_id').range(0, MAX_BULK - 1);
  if (error) throw new Error(error.message);
  return { ids: (data ?? []).map((r) => String((r as { homatch_asset_id: string }).homatch_asset_id)), total: count ?? 0 };
}

/** Values for the filter menus (small: distinct per column, client-side). */
export async function filterOptions(): Promise<{ batches: string[]; categories: string[]; subcategories: string[]; providers: string[] }> {
  const { data, error } = await supabase.from('ds_catalog_imports')
    .select('import_batch_id, canonical_category, canonical_subcategory, source_provider').range(0, 9999);
  if (error) throw new Error(error.message);
  const uniq = (k: string) => [...new Set((data ?? []).map((r) => (r as Record<string, string | null>)[k]).filter((x): x is string => Boolean(x)))].sort();
  return { batches: uniq('import_batch_id').reverse(), categories: uniq('canonical_category'), subcategories: uniq('canonical_subcategory'), providers: uniq('source_provider') };
}

/** Signed thumbnail URLs for the rows on screen only (public catalogue keys). */
export async function thumbnailsFor(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from('ds_catalog_files').select('homatch_asset_id, object_key')
    .eq('role', 'THUMBNAIL').eq('delivery', 'public').in('homatch_asset_id', ids);
  if (error || !data?.length) return new Map();
  const keyOf = new Map(data.map((r) => [String((r as { homatch_asset_id: string }).homatch_asset_id), String((r as { object_key: string }).object_key)]));
  const urls = await signedUrls([...keyOf.values()]);
  const out = new Map<string, string>();
  for (const [id, key] of keyOf) { const u = urls.get(key); if (u) out.set(id, u); }
  return out;
}

export interface Dependency { homatchAssetId: string; versions: number; projects: number; published: number }

/** How many saved designs / projects / public shares use each asset. */
export async function dependencies(ids: string[]): Promise<Dependency[]> {
  const { data, error } = await supabase.rpc('ds_catalog_dependencies', { p_ids: ids });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { homatch_asset_id: string; versions: number; projects: number; published: number }) => ({
    homatchAssetId: r.homatch_asset_id, versions: r.versions, projects: r.projects, published: r.published,
  }));
}

export interface BulkResult { changed: number; blocked: Array<{ homatch_asset_id: string; versions: number; projects: number; published: number; reason: string }>; skipped: string[] }

/** Audited bulk availability change. `confirmCount` must equal ids.length (the number the admin confirmed). */
export async function setLifecycle(ids: string[], target: LifecycleTarget, confirmCount: number, reason: string): Promise<BulkResult> {
  const { data, error } = await supabase.rpc('ds_catalog_admin_set_lifecycle', { p_ids: ids, p_target: target, p_confirm_count: confirmCount, p_reason: reason || null });
  if (error) throw new Error(error.message);
  return data as BulkResult;
}

/** Audited bulk re-queue (re-validate and re-optimise on the next importer run). */
export async function requeue(ids: string[], confirmCount: number, reason: string): Promise<{ queued: number; skipped: string[] }> {
  const { data, error } = await supabase.rpc('ds_catalog_admin_requeue', { p_ids: ids, p_confirm_count: confirmCount, p_reason: reason || null });
  if (error) throw new Error(error.message);
  return data as { queued: number; skipped: string[] };
}

export interface PurgeResult { deleted: number; objects: number; bytes: number; blocked: Array<{ homatch_asset_id: string; reason: string }> }

/** Physically delete the files of PENDING_DELETE assets nothing uses (server re-checks every dependency first). */
export async function purge(ids: string[], confirmCount: number): Promise<PurgeResult> {
  const { data, error } = await supabase.functions.invoke('design-studio-model/catalog-purge', { body: { ids, confirmCount } });
  if (error) {
    let reason = error.message;
    try { const t = await (error as { context?: Response }).context?.text(); const j = t ? JSON.parse(t) : null; if (j?.error) reason = String(j.error); } catch { /* keep the message */ }
    throw new Error(reason);
  }
  return data as PurgeResult;
}

export interface AdminEvent { id: number; at: string; action: string; assetCount: number; batches: string[]; reason: string | null; detail: Record<string, unknown> }

export async function recentEvents(limit = 20): Promise<AdminEvent[]> {
  const { data, error } = await supabase.from('ds_catalog_admin_events')
    .select('id, at, action, asset_count, import_batch_ids, reason, detail').order('id', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const x = r as { id: number; at: string; action: string; asset_count: number; import_batch_ids: string[]; reason: string | null; detail: Record<string, unknown> };
    return { id: x.id, at: x.at, action: x.action, assetCount: x.asset_count, batches: x.import_batch_ids ?? [], reason: x.reason, detail: x.detail ?? {} };
  });
}
