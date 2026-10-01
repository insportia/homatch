// THE CATALOGUE, READ FOR BROWSING.
//
// Metadata only — names, sizes, tags, thumbnails. Nothing heavy is fetched
// here; a model is loaded when a piece is placed (procedural placeholders
// are drawn from their dimensions and need no file at all). Queries are
// filtered and paged server-side so the same code serves thirty rows today
// and thousands later.

import { supabase } from '@/db/supabase';
import {
  assetFromRow, materialFromRow, type CatalogAsset, type CatalogMaterial, type Palette,
} from '@/lib/designStudio/catalog';

const ASSET_COLUMNS =
  'id, code, name, category, subcategory, room_kinds, style_tags, color_tags, material_tags, width_m, depth_m, height_m, '
  + 'placement, anchor, clearance_m, procedural, model_key, lods, triangles, texture_bytes, thumbnail_key, material_slots, '
  + 'variants, dominant_colors, provenance, is_placeholder, active, capabilities, interactions';

/** The imported-catalogue columns (20261002210000). Read when they exist; a database without them answers without them. */
const CATALOG_COLUMNS = ', homatch_asset_id, source_provider, canonical_category, canonical_subcategory, search_aliases, quality_tier, web_suitability, color_families, license_class';

/**
 * Run an asset query with the imported-catalogue columns, and again without
 * them if this database has not got them yet (Postgres 42703, undefined
 * column): the editor never breaks on the order a release lands in.
 */
async function withCatalogColumns(run: (columns: string) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>) {
  const first = await run(ASSET_COLUMNS + CATALOG_COLUMNS);
  if (!first.error) return first;
  if (first.error.code !== '42703' && !/column .* does not exist/i.test(first.error.message)) return first;
  return run(ASSET_COLUMNS);
}

export interface AssetFilter {
  category?: string | null;
  roomKind?: string | null;
  styles?: string[];
  text?: string;
  limit?: number;
  offset?: number;
}

export async function listAssets(filter: AssetFilter = {}): Promise<CatalogAsset[]> {
  const { data, error } = await withCatalogColumns((columns) => {
    let q = supabase.from('ds_catalog_assets').select(columns).eq('active', true)
      .order('category').order('name')
      .range(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 120) - 1);
    if (filter.category) q = q.eq('category', filter.category);
    if (filter.roomKind) q = q.contains('room_kinds', [filter.roomKind]);
    if (filter.styles?.length) q = q.overlaps('style_tags', filter.styles);
    if (filter.text) {
      const safe = filter.text.replace(/[%,()*]/g, ' ').trim();
      if (safe) q = q.or(`name.ilike.%${safe}%,code.ilike.%${safe}%`);
    }
    return q;
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(assetFromRow);
}

/** The assets a design references, by code — the only ones the scene needs. */
export async function assetsByCode(codes: string[]): Promise<CatalogAsset[]> {
  const unique = [...new Set(codes)].filter(Boolean);
  if (unique.length === 0) return [];
  // Inactive assets are still resolved so an existing design keeps rendering
  // after Admin retires a piece; they just cannot be ADDED any more.
  const { data, error } = await withCatalogColumns((columns) => supabase.from('ds_catalog_assets').select(columns).in('code', unique));
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(assetFromRow);
}

export async function listMaterials(): Promise<CatalogMaterial[]> {
  const { data, error } = await supabase
    .from('ds_catalog_materials')
    .select('id, code, name, category, applies_to, style_tags, color_family, pbr, thumbnail_key, provenance, is_placeholder, active, search_aliases, color_families')
    .eq('active', true)
    .order('category').order('name')
    .limit(1000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(materialFromRow);
}

export async function listPalettes(): Promise<Palette[]> {
  const { data, error } = await supabase
    .from('ds_palettes').select('id, code, name, colors, tags').eq('active', true).order('sort').limit(200);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), code: String(r.code), name: String(r.name),
    colors: Array.isArray(r.colors) ? (r.colors as string[]) : [],
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
  }));
}
