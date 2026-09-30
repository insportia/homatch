// HOMATCH DESIGN STUDIO — the Poly Haven provider adapter (CC0).
//
// PROVIDER POLICY (owner decision): Poly Haven supplies the catalogue's
// PBR MATERIALS and HDRI ENVIRONMENTS. Physical residential objects —
// furniture, appliances, fixtures, decor — come from Blendkit, through its
// own adapter; Poly Haven models are therefore not selected at all.
//
// Everything Poly Haven publishes is CC0: redistributable, no attribution
// required, so its files may be delivered publicly (delivery class PUBLIC).
//
// This module only knows Poly Haven: how it categorises, what its /files
// entries look like, and how its names read. Identity, keys, naming rules,
// validation and indexing are the provider-neutral core (catalogSource.ts).

import {
  type AssetKind, type AssetPlan, type Canonical, type Delivery, type License, type Naming, type PlannedFile, type ProviderAdapter, type Role,
  cleanSourceName, COLORS, contentTypeOf, environmentName, normalizeName, qualifiersFor, STYLE_WORDS, titleCase, words,
} from '../catalogSource.ts';

export const PROVIDER = 'polyhaven';
/** Materials and environments; objects come from Blendkit. A different policy is a different version. */
export const POLICY = 'polyhaven-materials-environments-v1';
const API = 'https://api.polyhaven.com';
const DELIVERY: Delivery = 'public';

export const LICENSE: License = {
  licenseClass: 'CC0',
  providerLicense: 'CC0-1.0',
  url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  redistribution: true,
  runtimeDelivery: 'PUBLIC',
  attributionRequired: false,
  credit: 'Poly Haven (polyhaven.com), CC0',
};

/** Poly Haven's own words for its asset types, and what they are to HOMATCH. */
export const TYPES = { textures: 'MATERIAL', hdris: 'ENVIRONMENT' } as const satisfies Record<string, AssetKind>;
type PhType = keyof typeof TYPES;
const TYPE_OF: Record<AssetKind, PhType | null> = { MATERIAL: 'textures', ENVIRONMENT: 'hdris', MODEL: null };

type Rule = [prefix: string, category: string | null, subcategory?: string];

/** Category path prefix → HOMATCH canonical category. First match wins; null excludes. */
export const RULES: Record<PhType, Rule[]> = {
  textures: [
    ['Wood/Boards & Planks', 'MATERIAL.WOOD', 'FLOOR_BOARDS'],
    ['Wood/Veneer', 'MATERIAL.WOOD', 'VENEER'],
    ['Wood/Engineered Wood', 'MATERIAL.WOOD', 'ENGINEERED'],
    ['Wood/Bark', null],
    ['Stone/Slabs & Tiles', 'MATERIAL.STONE', 'SLAB_TILE'],
    ['Stone/Cobblestone & Paving', 'MATERIAL.STONE', 'PAVING'],
    ['Stone/Walls & Rubble', 'MATERIAL.STONE', 'WALL_CLADDING'],
    ['Stone/Rock & Cliffs', null],
    ['Brick & Block/Clay Brick', 'MATERIAL.MASONRY', 'BRICK'],
    ['Brick & Block/Concrete Block & Paver', 'MATERIAL.MASONRY', 'CONCRETE_BLOCK'],
    ['Brick & Block/Stone Block & Paver', 'MATERIAL.MASONRY', 'STONE_BLOCK'],
    ['Concrete/Cast Walls & Floors', 'MATERIAL.CONCRETE', 'CAST'],
    ['Concrete/Plaster & Stucco', 'MATERIAL.CONCRETE', 'PLASTER'],
    ['Ceramic/Glazed Tiles', 'MATERIAL.CERAMIC', 'GLAZED_TILE'],
    ['Ceramic/Quarry & Unglazed', 'MATERIAL.CERAMIC', 'UNGLAZED_TILE'],
    ['Ceramic/Terracotta', 'MATERIAL.CERAMIC', 'TERRACOTTA'],
    ['Ceramic/Terrazzo & Mosaic', 'MATERIAL.CERAMIC', 'TERRAZZO_MOSAIC'],
    ['Metal/Cladding & Shutters', 'MATERIAL.METAL', 'CLADDING'],
    ['Metal/Plate & Grating', 'MATERIAL.METAL', 'PLATE'],
    ['Metal/Sheet & Corrugated', 'MATERIAL.METAL', 'SHEET'],
    ['Glass', 'MATERIAL.GLASS', 'GLASS'],
    ['Textiles & Leather/Carpet & Matting', 'MATERIAL.TEXTILE', 'CARPET'],
    ['Textiles & Leather/Leather', 'MATERIAL.TEXTILE', 'LEATHER'],
    ['Textiles & Leather/Woven', 'MATERIAL.TEXTILE', 'WOVEN'],
    ['Textiles & Leather/Knit', 'MATERIAL.TEXTILE', 'KNIT'],
    ['Textiles & Leather/Pile & Velvet', 'MATERIAL.TEXTILE', 'PILE_VELVET'],
    ['Textiles & Leather/Patterned & Jacquard', 'MATERIAL.TEXTILE', 'PATTERNED'],
    ['Textiles & Leather/Denim', 'MATERIAL.TEXTILE', 'DENIM'],
    ['Textiles & Leather/Sackcloth', 'MATERIAL.TEXTILE', 'HESSIAN'],
    ['Textiles & Leather/Technical', 'MATERIAL.TEXTILE', 'TECHNICAL'],
    ['Plastic & Rubber/Vinyl & Linoleum', 'MATERIAL.RESILIENT', 'VINYL_LINOLEUM'],
    ['Plastic & Rubber/Rubber', 'MATERIAL.RESILIENT', 'RUBBER'],
    ['Plastic & Rubber/Plastic', 'MATERIAL.RESILIENT', 'PLASTIC'],
    ['Paper & Card/Wallpaper', 'MATERIAL.WALLCOVERING', 'WALLPAPER'],
    ['Ground & Terrain/Grass & Vegetation', 'MATERIAL.EXTERIOR_GROUND', 'GRASS'],
    ['Ground & Terrain/Gravel & Pebbles', 'MATERIAL.EXTERIOR_GROUND', 'GRAVEL'],
    ['Asphalt & Bitumen/Asphalt', 'MATERIAL.EXTERIOR_GROUND', 'ASPHALT'],
  ],
  hdris: [
    ['Pure Skies', 'ENVIRONMENT.SKY', 'PURE_SKY'],
    ['Interiors/Residential', 'ENVIRONMENT.INTERIOR', 'RESIDENTIAL'],
    ['Interiors/Dining & Hospitality', 'ENVIRONMENT.INTERIOR', 'HOSPITALITY'],
    ['Streets & Town/Rooftops & Balconies', 'ENVIRONMENT.URBAN', 'ROOFTOP_BALCONY'],
    ['Streets & Town/Streets & Alleys', 'ENVIRONMENT.URBAN', 'STREET'],
    ['Parks & Gardens/Gardens', 'ENVIRONMENT.GARDEN', 'GARDEN'],
    ['Parks & Gardens/Patios & Verandas', 'ENVIRONMENT.GARDEN', 'PATIO_VERANDA'],
    ['Parks & Gardens/Parks', 'ENVIRONMENT.GARDEN', 'PARK'],
    ['Studio/Photo Studios', 'ENVIRONMENT.STUDIO', 'PHOTO_STUDIO'],
  ],
};

/** HDRIs whose 4K is kept: the ones seen as a visible background. */
export const HDRI_4K_SUBCATEGORIES = new Set(['PURE_SKY', 'ROOFTOP_BALCONY', 'RESIDENTIAL']);

export interface PhAsset {
  name: string;
  type: number;
  category: string;
  category_id: string;
  categories?: string[];
  tags?: string[];
  attributes?: Record<string, unknown>;
  dimensions?: number[];
  files_hash: string;
  authors?: Record<string, string>;
  description?: string;
  thumbnail_url?: string;
}

export function classify(kind: AssetKind, category: string, _sourceAssetId: string): Canonical | null {
  const type = TYPE_OF[kind];
  if (!type) return null; // objects come from Blendkit
  for (const [prefix, c, sub] of RULES[type]) {
    if (category === prefix || category.startsWith(`${prefix}/`)) return c && sub ? { canonicalCategory: c, canonicalSubcategory: sub } : null;
  }
  return null;
}

interface FileEntry { url: string; size: number; md5?: string; include?: Record<string, unknown> }
const entry = (v: unknown): FileEntry | null => {
  const o = v as FileEntry | null;
  return o && typeof o.url === 'string' && Number.isFinite(o.size) ? o : null;
};

/**
 * A bundle map's role, from the MAP TOKEN at the end of its name
 * ("<asset>_<map>_<res>.jpg") — never from the asset part, which can itself
 * say "rough" or "metal" (rough_concrete_diff_1k.jpg is a colour map).
 */
export function roleOfMap(path: string): Role | null {
  const p = path.toLowerCase();
  if (p.endsWith('.bin')) return 'GEOMETRY';
  if (!/\.(jpe?g|png)$/.test(p)) return null;
  if (/_(nor_gl|normal_gl)_\d+k\.\w+$/.test(p)) return 'NORMAL';
  if (/_(arm|me_arm|rough_ao|rough|roughness|metal|metallic|ao)_\d+k\.\w+$/.test(p)) return 'ORM';
  return 'BASE_COLOR';
}

/**
 * The plan for one asset: a material's MAPS (colour, GL normal, packed
 * AO/roughness/metalness) from its glTF bundle at 1K and 2K — never the
 * bundle's preview plane mesh; an environment's .hdr at 1K and 2K, plus 4K
 * for the visible-background ones; the provider thumbnail; and a provenance
 * snapshot (written by the importer).
 */
export function plan(kind: AssetKind, sourceAssetId: string, asset: PhAsset, files: Record<string, unknown>, canonical: Canonical): AssetPlan {
  const out: PlannedFile[] = [];
  const seen = new Set<string>();
  const add = (f: Omit<PlannedFile, 'delivery'>) => { if (!seen.has(f.relPath)) { seen.add(f.relPath); out.push({ ...f, delivery: DELIVERY }); } };
  let resolutions: Array<'1k' | '2k' | '4k'> = ['1k', '2k'];
  let refusal: string | null = null;
  if (kind === 'MODEL') refusal = 'provider policy: physical objects come from Blendkit';
  else if (kind === 'ENVIRONMENT') {
    if (HDRI_4K_SUBCATEGORIES.has(canonical.canonicalSubcategory)) resolutions = ['1k', '2k', '4k'];
    const hdri = (files.hdri ?? {}) as Record<string, Record<string, unknown>>;
    for (const r of resolutions) {
      const e = entry(hdri[r]?.hdr);
      if (!e) { refusal = `no ${r} .hdr`; continue; }
      add({ role: 'HDRI', resolution: r, relPath: `${sourceAssetId}_${r}.hdr`, sourceUrl: e.url, bytes: e.size, md5: e.md5 ?? null, contentType: contentTypeOf('x.hdr') });
    }
  } else {
    const gltf = (files.gltf ?? {}) as Record<string, Record<string, unknown>>;
    for (const r of resolutions) {
      const g = entry(gltf[r]?.gltf);
      if (!g) { refusal = `no ${r} glTF bundle`; continue; }
      for (const [path, v] of Object.entries(g.include ?? {})) {
        const e = entry(v);
        const role = roleOfMap(path);
        if (!e || !role || role === 'GEOMETRY') continue; // the preview plane is not the material
        if (path.includes('..') || path.startsWith('/')) { refusal = 'unsafe path in bundle'; continue; }
        add({ role, resolution: r, relPath: path, sourceUrl: e.url, bytes: e.size, md5: e.md5 ?? null, contentType: contentTypeOf(path) });
      }
      if (!out.some((f) => f.role === 'BASE_COLOR' && f.resolution === r)) refusal = `no base colour at ${r}`;
    }
  }
  if (asset.thumbnail_url) {
    const ext = /\.(png|webp|jpe?g)(\?|$)/i.exec(asset.thumbnail_url)?.[1]?.toLowerCase() ?? 'png';
    add({ role: 'THUMBNAIL', resolution: null, relPath: `thumbnail.${ext}`, sourceUrl: asset.thumbnail_url, bytes: 0, md5: null, contentType: contentTypeOf(`x.${ext}`) });
  }
  add({ role: 'METADATA', resolution: null, relPath: 'source.json', sourceUrl: null, bytes: 0, md5: null, contentType: 'application/json' });
  return { kind, sourceAssetId, resolutions, files: out, bytes: out.reduce((s, f) => s + f.bytes, 0), refusal };
}

// ── Names ───────────────────────────────────────────────────────────────

const NOUN: Record<string, string> = {
  FLOOR_BOARDS: 'Wood Planks', VENEER: 'Wood Veneer', ENGINEERED: 'Engineered Wood', SLAB_TILE: 'Stone Tile', PAVING: 'Stone Paving',
  WALL_CLADDING: 'Stone Wall', BRICK: 'Brick', CONCRETE_BLOCK: 'Concrete Block', STONE_BLOCK: 'Stone Block', CAST: 'Concrete', PLASTER: 'Plaster',
  GLAZED_TILE: 'Glazed Tile', UNGLAZED_TILE: 'Quarry Tile', TERRACOTTA: 'Terracotta', TERRAZZO_MOSAIC: 'Terrazzo', CLADDING: 'Metal Cladding',
  PLATE: 'Metal Plate', SHEET: 'Sheet Metal', CARPET: 'Carpet', LEATHER: 'Leather', WOVEN: 'Woven Fabric', KNIT: 'Knit Fabric', PILE_VELVET: 'Velvet',
  PATTERNED: 'Patterned Fabric', DENIM: 'Denim', HESSIAN: 'Hessian', TECHNICAL: 'Technical Fabric', VINYL_LINOLEUM: 'Vinyl Flooring',
  RUBBER: 'Rubber Flooring', PLASTIC: 'Plastic', WALLPAPER: 'Wallpaper', GRASS: 'Grass', GRAVEL: 'Gravel', ASPHALT: 'Asphalt', GLASS: 'Glass',
};
/** The key word a name must already contain for the noun to be redundant. */
const NOUN_WORD: Record<string, RegExp> = {
  FLOOR_BOARDS: /\b(floor|flooring|plank|planks|parquet|deck|boards?)\b/i, VENEER: /\bveneer\b/i, ENGINEERED: /\b(plywood|mdf|osb|chipboard|engineered)\b/i,
  SLAB_TILE: /\b(tiles?|slabs?|marble|granite|travertine|slate)\b/i, PAVING: /\b(paving|pavement|cobble\w*|pavers?|flagstones?)\b/i,
  WALL_CLADDING: /\b(wall|walls|rubble|cladding)\b/i, BRICK: /\bbricks?\b/i, CONCRETE_BLOCK: /\b(block|blocks|pavers?|cinder)\b/i,
  STONE_BLOCK: /\b(block|blocks|stone|stones)\b/i, CAST: /\bconcrete\b/i, PLASTER: /\b(plaster|stucco|render)\b/i, GLAZED_TILE: /\btiles?\b/i,
  UNGLAZED_TILE: /\btiles?\b/i, TERRACOTTA: /\bterra ?cotta\b/i, TERRAZZO_MOSAIC: /\b(terrazzo|mosaic)\b/i, CLADDING: /\b(metal|cladding|shutter)\b/i,
  PLATE: /\b(plate|grating|metal)\b/i, SHEET: /\b(sheet|corrugated|metal)\b/i, CARPET: /\b(carpet|rug|mat|matting)\b/i, LEATHER: /\bleather\b/i,
  WOVEN: /\b(fabric|woven|weave|cloth|linen|cotton)\b/i, KNIT: /\b(knit|knitted|wool)\b/i, PILE_VELVET: /\b(velvet|velour|corduroy|plush)\b/i,
  PATTERNED: /\b(fabric|pattern|jacquard)\b/i, DENIM: /\bdenim\b/i, HESSIAN: /\b(hessian|burlap|sack)\b/i, TECHNICAL: /\b(fabric|suede)\b/i,
  VINYL_LINOLEUM: /\b(vinyl|linoleum|lino)\b/i, RUBBER: /\b(rubber|track)\b/i, PLASTIC: /\bplastic\b/i, WALLPAPER: /\bwallpaper\b/i,
  GRASS: /\b(grass|lawn|turf)\b/i, GRAVEL: /\b(gravel|pebbles?|shingle)\b/i, ASPHALT: /\b(asphalt|tarmac|bitumen)\b/i, GLASS: /\bglass\b/i,
};

/** DAY, CLOUDY, SUNSET, EVENING, NIGHT, STUDIO, INTERIOR_ARTIFICIAL — and where the light is. */
export function environmentClass(asset: PhAsset, canonical: Canonical): { lighting: string; context: string } {
  const a = asset.attributes ?? {};
  const time = String(a.time_of_day ?? ''); const weather = String(a.weather ?? ''); const light = String(a.light_type ?? '');
  let lighting: string;
  if (canonical.canonicalSubcategory === 'PHOTO_STUDIO') lighting = 'STUDIO';
  else if (time === 'night') lighting = 'NIGHT';
  else if (time === 'dusk') lighting = 'EVENING';
  else if (time === 'sunset' || time === 'sunrise') lighting = 'SUNSET';
  else if (weather === 'overcast' || weather === 'fog' || weather === 'rain') lighting = 'CLOUDY';
  else if (a.environment === 'indoor' && light === 'artificial') lighting = 'INTERIOR_ARTIFICIAL';
  else lighting = 'DAY';
  const context = ({
    PURE_SKY: 'SKY', RESIDENTIAL: 'RESIDENTIAL_INTERIOR', HOSPITALITY: 'HOSPITALITY_INTERIOR', ROOFTOP_BALCONY: 'BALCONY_ROOFTOP',
    STREET: 'URBAN', GARDEN: 'GARDEN', PATIO_VERANDA: 'GARDEN', PARK: 'PARK', PHOTO_STUDIO: 'STUDIO',
  } as Record<string, string>)[canonical.canonicalSubcategory] ?? 'OUTDOOR';
  return { lighting, context };
}

export function name(kind: AssetKind, asset: PhAsset, canonical: Canonical): Naming {
  const tags = words(asset.tags ?? []);
  const attr = asset.attributes ?? {};
  const base = cleanSourceName(asset.name);
  const colorTags = [...new Set(COLORS.filter((c) => tags.includes(c) || base.toLowerCase().split(' ').includes(c)).map((c) => (c === 'gray' ? 'grey' : c)))];
  const styleTags = STYLE_WORDS.filter((w) => tags.includes(w) || base.toLowerCase().includes(w));
  let displayName: string;
  let extra: string[] = [];
  if (kind === 'ENVIRONMENT') {
    const cls = environmentClass(asset, canonical);
    displayName = environmentName(cls.lighting, cls.context, base);
    extra = Object.values(cls).map((x) => x.replace(/_/g, ' '));
  } else {
    const hasNoun = NOUN_WORD[canonical.canonicalSubcategory]?.test(base) ?? true;
    const color = colorTags.find((c) => !base.toLowerCase().includes(c));
    displayName = titleCase([color, base, hasNoun ? '' : NOUN[canonical.canonicalSubcategory] ?? ''].filter(Boolean).join(' '));
  }
  const attrWords = Object.values(attr).flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => typeof v === 'string').map((v) => String(v).replace(/_/g, ' '));
  const aliases = words([
    ...tags, ...(asset.categories ?? []), canonical.canonicalSubcategory.replace(/_/g, ' '), canonical.canonicalCategory.split('.').pop()?.replace(/_/g, ' '),
    NOUN[canonical.canonicalSubcategory], base, ...extra, ...attrWords,
  ]).slice(0, 48);
  const condition = (Array.isArray(attr.condition) ? attr.condition : [attr.condition]).filter((x): x is string => typeof x === 'string');
  return {
    displayName, qualifiers: qualifiersFor(displayName, [...colorTags, ...styleTags, ...condition, ...tags]),
    normalizedName: normalizeName(displayName), styleTags, colorTags, materialTags: [], aliases,
  };
}

/** Which surfaces a material is meant for, from the provider's own surface_use. */
export function appliesTo(asset: PhAsset): Array<'WALL' | 'FLOOR' | 'CEILING' | 'OBJECT'> {
  const map: Record<string, Array<'WALL' | 'FLOOR' | 'CEILING' | 'OBJECT'>> = {
    wall: ['WALL'], floor: ['FLOOR'], paving: ['FLOOR'], ground: ['FLOOR'], ceiling: ['CEILING'], object: ['OBJECT'], roof: ['OBJECT'],
  };
  return map[String(asset.attributes?.surface_use ?? '')] ?? ['WALL', 'FLOOR', 'OBJECT'];
}

type Fetch = (path: string) => Promise<any>;

export const polyhaven: ProviderAdapter<PhAsset> = {
  provider: PROVIDER,
  policy: POLICY,
  license: () => ({ ...LICENSE }),
  async discover(fetchJson: Fetch) {
    const out = [];
    for (const [type, kind] of Object.entries(TYPES) as Array<[PhType, AssetKind]>) {
      const list = await fetchJson(`${API}/assets?type=${type}`) as Record<string, PhAsset>;
      for (const [id, a] of Object.entries(list)) {
        const c = classify(kind, a.category, id);
        if (c) out.push({ sourceAssetId: id, kind, canonical: c, asset: a, naming: name(kind, a, c) });
      }
    }
    return out;
  },
  async current(sourceAssetId: string, _kind: AssetKind, fetchJson: Fetch) {
    const asset = await fetchJson(`${API}/info/${encodeURIComponent(sourceAssetId)}`) as PhAsset;
    const files = await fetchJson(`${API}/files/${encodeURIComponent(sourceAssetId)}`) as Record<string, unknown>;
    return { asset, files, filesHash: asset.files_hash, categoryId: asset.category_id, categoryPath: asset.category };
  },
  plan,
  name,
  environmentClass,
  appliesTo,
  physicalSizeMm: (asset: PhAsset) => (Array.isArray(asset.dimensions) && asset.dimensions.length >= 2 ? [asset.dimensions[0], asset.dimensions[1]] : null),
  sourcePage: (id: string) => `https://polyhaven.com/a/${id}`,
};
