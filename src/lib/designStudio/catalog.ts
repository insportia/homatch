// THE CATALOGUE, AS DATA.
//
// Assets and materials are shared, canonical and referenced by code: a
// design stores `assetId: 'dev/sofa-3'`, never a copy of a model. Browsing
// reads metadata and thumbnails; a model is fetched only when it is placed.
//
// `isPlaceholder` marks HOMATCH's development concept blocks — procedural
// stand-ins that prove placement, collision and versioning. They are shown
// as concept blocks, never as products, and carry no brand and no price.

export type AssetPlacement = 'FLOOR' | 'WALL' | 'CEILING' | 'SURFACE';
export type AssetAnchor = 'WALL' | 'CENTRE' | 'CORNER' | 'FREE';
export type Provenance = 'HOMATCH_DEV_PLACEHOLDER' | 'HOMATCH_OWNED' | 'LICENSED' | 'PARTNER';

/** The procedural shapes the development set is built from. */
export type ProceduralKind =
  | 'SOFA' | 'ARMCHAIR' | 'TABLE' | 'ROUND_TABLE' | 'CABINET' | 'SHELF' | 'BED' | 'RUG'
  | 'LAMP' | 'PLANT' | 'CHAIR' | 'STOOL' | 'KITCHEN_RUN' | 'VANITY' | 'PLANTER' | 'WARDROBE';

export interface MaterialSlot {
  /** 'body', 'legs', 'cushion', 'top'… */
  id: string;
  defaultColor: string;
  roughness?: number;
  metalness?: number;
}

export interface CatalogAsset {
  id: string;
  code: string;
  name: string;
  category: string;
  subcategory: string | null;
  roomKinds: string[];
  styleTags: string[];
  colorTags: string[];
  materialTags: string[];
  widthM: number;
  depthM: number;
  heightM: number;
  placement: AssetPlacement;
  anchor: AssetAnchor;
  clearanceM: number;
  procedural: { kind: ProceduralKind } | null;
  modelKey: string | null;
  lods: Array<{ key: string; triangles: number }>;
  triangles: number | null;
  textureBytes: number | null;
  thumbnailKey: string | null;
  materialSlots: MaterialSlot[];
  variants: Array<{ id: string; name: string; colors: Record<string, string> }>;
  dominantColors: string[];
  provenance: Provenance;
  isPlaceholder: boolean;
  active: boolean;
}

export interface Pbr {
  baseColor: string;
  roughness: number;
  metalness: number;
  maps?: { albedo?: string; normal?: string; roughness?: string };
  repeatM?: number;
  rotationDeg?: number;
}

export interface CatalogMaterial {
  id: string;
  code: string;
  name: string;
  category: string;
  appliesTo: Array<'WALL' | 'FLOOR' | 'CEILING' | 'OBJECT'>;
  styleTags: string[];
  colorFamily: string | null;
  pbr: Pbr;
  thumbnailKey: string | null;
  provenance: Provenance;
  isPlaceholder: boolean;
  active: boolean;
}

export interface Palette {
  id: string;
  code: string;
  name: string;
  colors: string[];
  tags: string[];
}

/** Anything flat enough to walk over (a rug) never collides with furniture. */
export const isFlat = (a: Pick<CatalogAsset, 'heightM'>) => a.heightM <= 0.05;

export const HEX = /^#[0-9a-f]{6}$/i;

/** Row → domain object. Tolerant of numeric strings from PostgREST numerics. */
export function assetFromRow(r: Record<string, unknown>): CatalogAsset {
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    category: String(r.category),
    subcategory: (r.subcategory as string | null) ?? null,
    roomKinds: arr<string>(r.room_kinds),
    styleTags: arr<string>(r.style_tags),
    colorTags: arr<string>(r.color_tags),
    materialTags: arr<string>(r.material_tags),
    widthM: num(r.width_m),
    depthM: num(r.depth_m),
    heightM: num(r.height_m),
    placement: (r.placement as AssetPlacement) ?? 'FLOOR',
    anchor: (r.anchor as AssetAnchor) ?? 'WALL',
    clearanceM: num(r.clearance_m ?? 0),
    procedural: (r.procedural as { kind: ProceduralKind } | null) ?? null,
    modelKey: (r.model_key as string | null) ?? null,
    lods: arr(r.lods),
    triangles: r.triangles == null ? null : num(r.triangles),
    textureBytes: r.texture_bytes == null ? null : num(r.texture_bytes),
    thumbnailKey: (r.thumbnail_key as string | null) ?? null,
    materialSlots: arr<MaterialSlot>(r.material_slots),
    variants: arr(r.variants),
    dominantColors: arr<string>(r.dominant_colors),
    provenance: r.provenance as Provenance,
    isPlaceholder: !!r.is_placeholder,
    active: !!r.active,
  };
}

export function materialFromRow(r: Record<string, unknown>): CatalogMaterial {
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    category: String(r.category),
    appliesTo: arr(r.applies_to),
    styleTags: arr<string>(r.style_tags),
    colorFamily: (r.color_family as string | null) ?? null,
    pbr: r.pbr as Pbr,
    thumbnailKey: (r.thumbnail_key as string | null) ?? null,
    provenance: r.provenance as Provenance,
    isPlaceholder: !!r.is_placeholder,
    active: !!r.active,
  };
}
