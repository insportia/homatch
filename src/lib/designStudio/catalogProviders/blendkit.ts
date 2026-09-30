// HOMATCH DESIGN STUDIO — the Blendkit provider adapter (physical objects).
//
// PROVIDER POLICY (owner decision): Blendkit is the primary source of
// physical residential objects — furniture, appliances, fixtures, decor,
// plants, doors and windows. Poly Haven supplies materials and environments.
//
// WHAT IS VERIFIED (2026-09-30, from Blendkit's own documentation and its
// official client, BlenderKit/bk_client):
// - Search is a public JSON API (GET /api/v1/search/?query=asset_type:model+
//   category_subtree:<slug>&page_size=100, paged by `next`); every result
//   carries its licence, exact file sizes, dimensions, face count, texture
//   resolution and style — enough to classify without downloading anything.
// - A file is downloaded by GET <file.downloadUrl>?scene_uuid=<uuid> with
//   "Authorization: Bearer <API key>", which answers {filePath: <signed CDN
//   URL>}. The key lives only in Supabase (BLENDKIT_API_KEY): the importer asks
//   design-studio-model/catalog for the signed URL and never sees the key.
// - Models come as .blend and, where Blendkit generated them, as GLB
//   ("gltf" and "gltf_godot"). Only the GLB is taken: a .blend needs Blender to
//   convert and is never in the delivery path.
//
// LICENCES, per asset, from Blendkit's own terms:
// - CC0 ("cc_zero"): public domain — delivered like any CC0 asset.
// - Royalty Free ("royalty_free"): commercial use allowed, no resale in the
//   same form; its FAQ allows use in sold games "if these can't be extracted by
//   the users in an easy way". A browser renderer hands the model to the
//   visitor's browser, where it IS easily extractable, so the terms do not
//   clearly permit HOMATCH's runtime use. Until Blendkit confirms web runtime
//   delivery in writing, runtimeDelivery is NONE and no Royalty-Free asset is
//   imported (the licence class is stopped, not guessed).
// - Anything else is UNKNOWN and never imported.

import {
  type AssetKind, type AssetPlan, type Canonical, type Delivery, type License, type Naming, type PlannedFile, type ProviderAdapter,
  classifyLicense, cleanSourceName, colorFamily, deliveryFor, normalizeName, qualifiersFor, STYLE_WORDS, titleCase, words,
} from '../catalogSource.ts';

export const PROVIDER = 'blendkit';
export const POLICY = 'blendkit-objects-glb-v1';
const API = 'https://www.blendkit.com/api/v1';
/** A download URL is Blendkit's own, for one file: nothing else is ever sent the key. */
export const DOWNLOAD_URL = /^https:\/\/www\.blendkit\.com\/api\/v1\/downloads\/[0-9a-f-]{36}\/$/;

export const LICENSES: Record<string, License> = {
  cc_zero: {
    licenseClass: 'CC0', providerLicense: 'cc_zero', url: 'https://www.blendkit.com/docs/licenses/', redistribution: true,
    runtimeDelivery: 'PUBLIC', attributionRequired: false, credit: 'Blendkit (blendkit.com), CC0',
  },
  royalty_free: {
    licenseClass: 'ROYALTY_FREE', providerLicense: 'royalty_free', url: 'https://www.blendkit.com/docs/licenses/', redistribution: false,
    // STOPPED: "can't be extracted by the users in an easy way" vs. browser delivery. Needs Blendkit's written confirmation.
    runtimeDelivery: 'NONE', attributionRequired: false, credit: null,
  },
};

export function licenseOf(asset: { license?: string }): License {
  const cls = classifyLicense(asset.license);
  if (cls === 'CC0') return LICENSES.cc_zero;
  if (cls === 'ROYALTY_FREE') return LICENSES.royalty_free;
  return { licenseClass: 'UNKNOWN', providerLicense: asset.license ?? null, url: null, redistribution: false, runtimeDelivery: 'NONE', attributionRequired: false, credit: null };
}

// ── Taxonomy ────────────────────────────────────────────────────────────

type Map3 = [category: string, subcategory: string];
/** Blendkit category slug → HOMATCH canonical object category. Checked most specific first (asset.category is the leaf). */
export const SLUGS: Record<string, Map3> = {
  sofa: ['OBJECT.FURNITURE', 'SOFA'], pouf: ['OBJECT.FURNITURE', 'OTTOMAN'], 'regular-chair': ['OBJECT.FURNITURE', 'CHAIR'], chair: ['OBJECT.FURNITURE', 'CHAIR'],
  'bar-chair': ['OBJECT.FURNITURE', 'BAR_STOOL'], 'office-chair': ['OBJECT.FURNITURE', 'OFFICE_CHAIR'], seating: ['OBJECT.FURNITURE', 'CHAIR'],
  'chair-table-set': ['OBJECT.FURNITURE', 'DINING_SET'], 'sofa-table-set': ['OBJECT.FURNITURE', 'SOFA'], 'outdoor-furniture': ['OBJECT.OUTDOOR', 'OUTDOOR_FURNITURE'],
  bed: ['OBJECT.FURNITURE', 'BED'], 'kidsfurniture-bed': ['OBJECT.FURNITURE', 'BED'], bedroom: ['OBJECT.FURNITURE', 'BEDROOM_FURNITURE'],
  wardrobe: ['OBJECT.STORAGE', 'WARDROBE'], 'kidsfurniture-wardrobe': ['OBJECT.STORAGE', 'WARDROBE'], cabinets: ['OBJECT.STORAGE', 'CABINET'],
  bookcase: ['OBJECT.STORAGE', 'BOOKCASE'], commode: ['OBJECT.STORAGE', 'DRESSER'], shelving: ['OBJECT.STORAGE', 'SHELVING'], 'tv-cabinets': ['OBJECT.STORAGE', 'TV_UNIT'],
  hall: ['OBJECT.STORAGE', 'HALL_FURNITURE'], 'office-storage': ['OBJECT.STORAGE', 'CABINET'], 'living-room': ['OBJECT.FURNITURE', 'LIVING_FURNITURE'], furniture: ['OBJECT.FURNITURE', 'FURNITURE'],
  table: ['OBJECT.FURNITURE', 'TABLE'], desk: ['OBJECT.FURNITURE', 'DESK'], 'office-table': ['OBJECT.FURNITURE', 'DESK'], 'restaurant-bar': ['OBJECT.FURNITURE', 'BAR_UNIT'],
  'kitchen-set': ['OBJECT.KITCHEN', 'KITCHEN_SET'], kitchen: ['OBJECT.KITCHEN', 'KITCHEN_UNIT'], storage: ['OBJECT.KITCHEN', 'KITCHEN_STORAGE'], sink: ['OBJECT.KITCHEN', 'SINK'],
  faucet: ['OBJECT.KITCHEN', 'FAUCET'], 'kitchen-appliance': ['OBJECT.APPLIANCE', 'KITCHEN_APPLIANCE'], 'household-appliances': ['OBJECT.APPLIANCE', 'HOUSEHOLD_APPLIANCE'],
  video: ['OBJECT.APPLIANCE', 'TV'], monitor: ['OBJECT.APPLIANCE', 'MONITOR'], audio: ['OBJECT.APPLIANCE', 'AUDIO'], laundry: ['OBJECT.APPLIANCE', 'WASHING_MACHINE'],
  'toilet-bidet': ['OBJECT.BATHROOM', 'TOILET'], 'wash-basin': ['OBJECT.BATHROOM', 'SINK'], bathhub: ['OBJECT.BATHROOM', 'BATHTUB'], shower: ['OBJECT.BATHROOM', 'SHOWER'],
  'bathroomfurniture-furniture-set': ['OBJECT.BATHROOM', 'VANITY'], 'bathroomfurniture-faucet': ['OBJECT.BATHROOM', 'FAUCET'], 'towel-rail': ['OBJECT.BATHROOM', 'ACCESSORY'],
  utility: ['OBJECT.BATHROOM', 'ACCESSORY'], bathroom: ['OBJECT.BATHROOM', 'BATHROOM_FIXTURE'],
  'ceiling-light': ['OBJECT.LIGHTING', 'CEILING_LIGHT'], 'floor-lamp': ['OBJECT.LIGHTING', 'FLOOR_LAMP'], 'table-lamps': ['OBJECT.LIGHTING', 'TABLE_LAMP'],
  'wall-light': ['OBJECT.LIGHTING', 'WALL_LIGHT'], 'outdoor-light': ['OBJECT.LIGHTING', 'OUTDOOR_LIGHT'], 'industrial-light': ['OBJECT.LIGHTING', 'PENDANT'], lighting: ['OBJECT.LIGHTING', 'LIGHT'],
  carpet: ['OBJECT.SOFT_FURNISHING', 'RUG'], curtain: ['OBJECT.SOFT_FURNISHING', 'CURTAIN'], pillow: ['OBJECT.SOFT_FURNISHING', 'PILLOW'], blanket: ['OBJECT.SOFT_FURNISHING', 'THROW'],
  fabrics: ['OBJECT.SOFT_FURNISHING', 'THROW'], mirror: ['OBJECT.DECOR', 'MIRROR'], fireplace: ['OBJECT.FURNITURE', 'FIREPLACE'], design: ['OBJECT.DECOR', 'ORNAMENT'],
  painting: ['OBJECT.DECOR', 'WALL_ART'], photo: ['OBJECT.DECOR', 'FRAME'], drawing: ['OBJECT.DECOR', 'WALL_ART'], sculpture: ['OBJECT.DECOR', 'SCULPTURE'], art: ['OBJECT.DECOR', 'ORNAMENT'],
  literature: ['OBJECT.DECOR', 'BOOKS'], 'tableware-set': ['OBJECT.DECOR', 'TABLEWARE'], container: ['OBJECT.DECOR', 'VASE'],
  'nature-indoor': ['OBJECT.PLANT', 'PLANT'], bouquet: ['OBJECT.PLANT', 'PLANT'], fitowall: ['OBJECT.PLANT', 'PLANT_WALL'],
  door: ['OBJECT.ARCHITECTURAL', 'DOOR'], window: ['OBJECT.ARCHITECTURAL', 'WINDOW'], stairs: ['OBJECT.ARCHITECTURAL', 'STAIRS'],
  'floor-covering': ['OBJECT.SOFT_FURNISHING', 'RUG'], 'wall-panel': ['OBJECT.ARCHITECTURAL', 'WALL_PANEL'], 'molding-carving': ['OBJECT.ARCHITECTURAL', 'MOLDING'],
};

/** Name/tag words that refine a subtype the category alone cannot say. */
const REFINE: Array<[RegExp, string, string[]]> = [
  [/\b(sectional|corner sofa|l[- ]shaped|modular sofa|chaise)\b/i, 'SECTIONAL_SOFA', ['SOFA']],
  [/\barm ?chair|lounge chair|recliner\b/i, 'ARMCHAIR', ['CHAIR', 'SOFA']],
  [/\bdining chair\b/i, 'DINING_CHAIR', ['CHAIR']],
  [/\bbench\b/i, 'BENCH', ['CHAIR', 'OTTOMAN']],
  [/\b(night ?stand|bedside)\b/i, 'NIGHTSTAND', ['TABLE', 'DRESSER', 'BEDROOM_FURNITURE', 'CABINET']],
  [/\bcoffee table\b/i, 'COFFEE_TABLE', ['TABLE']], [/\bdining table\b/i, 'DINING_TABLE', ['TABLE']],
  [/\b(side table|end table)\b/i, 'SIDE_TABLE', ['TABLE']], [/\bconsole\b/i, 'CONSOLE_TABLE', ['TABLE']],
  [/\b(fridge|refrigerator|freezer)\b/i, 'REFRIGERATOR', ['KITCHEN_APPLIANCE', 'HOUSEHOLD_APPLIANCE']],
  [/\b(oven|range|stove|cooktop|hob)\b/i, 'OVEN', ['KITCHEN_APPLIANCE', 'HOUSEHOLD_APPLIANCE']], [/\bmicrowave\b/i, 'MICROWAVE', ['KITCHEN_APPLIANCE', 'HOUSEHOLD_APPLIANCE']],
  [/\bdishwasher\b/i, 'DISHWASHER', ['KITCHEN_APPLIANCE', 'HOUSEHOLD_APPLIANCE']], [/\b(washing machine|washer|dryer)\b/i, 'WASHING_MACHINE', ['HOUSEHOLD_APPLIANCE', 'WASHING_MACHINE']],
  [/\b(hood|extractor)\b/i, 'RANGE_HOOD', ['KITCHEN_APPLIANCE', 'HOUSEHOLD_APPLIANCE']], [/\b(tv|television)\b/i, 'TV', ['TV', 'HOUSEHOLD_APPLIANCE', 'TV_UNIT']],
  [/\bkitchen island\b/i, 'KITCHEN_ISLAND', ['KITCHEN_SET', 'KITCHEN_UNIT']], [/\bradiator\b/i, 'RADIATOR', ['HOUSEHOLD_APPLIANCE', 'ACCESSORY', 'WALL_PANEL']],
  [/\bchandelier\b/i, 'CHANDELIER', ['CEILING_LIGHT', 'LIGHT', 'PENDANT']], [/\bpendant\b/i, 'PENDANT', ['CEILING_LIGHT', 'LIGHT']],
  [/\bblinds?\b/i, 'BLIND', ['CURTAIN']], [/\bsliding door\b/i, 'SLIDING_DOOR', ['DOOR']], [/\bbidet\b/i, 'BIDET', ['TOILET']],
  [/\bvanity\b/i, 'VANITY', ['SINK', 'BATHROOM_FIXTURE']], [/\bheadboard\b/i, 'HEADBOARD', ['BED']], [/\bplanter|pot\b/i, 'PLANTER', ['PLANT']],
];

export interface BkAsset {
  id: string;
  assetBaseId?: string;
  name: string;
  displayName?: string;
  category: string;
  slugs?: string[];
  license?: string;
  isFree?: boolean;
  verificationStatus?: string;
  quality?: number | null;
  qualityCount?: number;
  bookmarks?: number;
  tags?: string[];
  author?: string | null;
  created?: string;
  modified?: string | null;
  versionNumber?: number;
  url?: string;
  thumbnail?: string | null;
  params?: Record<string, any>;
  files?: Array<{ type: string; size: number | null; uuid?: string; downloadUrl?: string }>;
}

export function classify(asset: BkAsset): Canonical | null {
  const slugs = [asset.category, ...(asset.slugs ?? [])];
  const hit = slugs.map((s) => SLUGS[s]).find(Boolean);
  if (!hit) return null;
  let [category, subcategory] = hit;
  const text = `${asset.name} ${(asset.tags ?? []).join(' ')}`;
  for (const [re, sub, from] of REFINE) if (from.includes(subcategory) && re.test(text)) { subcategory = sub; break; }
  if (subcategory === 'KITCHEN_APPLIANCE' || subcategory === 'HOUSEHOLD_APPLIANCE') category = 'OBJECT.APPLIANCE';
  return { canonicalCategory: category, canonicalSubcategory: subcategory };
}

// ── Quality from metadata (a visual QA pass follows at canary time) ─────

export type QualityTier = 'PREMIUM' | 'STANDARD' | 'FALLBACK' | 'REJECT';

export interface Assessment { tier: QualityTier; score: number; webSuitability: number; reasons: string[]; glb: { type: string; size: number | null; uuid?: string } | null }

/** The largest dimension a residential object can plausibly have (m) — larger is a scene, not an object. */
const MAX_DIM_M = 8;

export function assess(asset: BkAsset): Assessment {
  const p = asset.params ?? {};
  const reasons: string[] = [];
  const files = asset.files ?? [];
  // Blendkit's "gltf" is its web export; "gltf_godot" is the heavier engine export.
  const glb = files.find((f) => f.type === 'gltf') ?? files.find((f) => f.type === 'gltf_godot') ?? null;
  const dims = [p.dimensionX, p.dimensionY, p.dimensionZ].map(Number);
  const faces = Number(p.faceCount ?? 0);
  const glbMb = glb?.size ? glb.size / 1e6 : null;
  if (asset.verificationStatus !== 'validated') reasons.push(`not validated (${asset.verificationStatus ?? 'unknown'})`);
  if (p.modelStyle && p.modelStyle !== 'realistic') reasons.push(`style ${p.modelStyle}`);
  if (p.productionLevel && p.productionLevel !== 'finished') reasons.push(`production ${p.productionLevel}`);
  if (p.sexualizedContent) reasons.push('sexualised content');
  if (!glb) reasons.push('no GLB export (only .blend)');
  if (!dims.every((d) => Number.isFinite(d) && d > 0.01) || Math.max(...dims) > MAX_DIM_M) reasons.push(`dimensions ${dims.map((d) => d?.toFixed?.(2)).join('×')} m`);
  if (faces > 2_000_000) reasons.push(`${faces} faces: no practical web path`);
  if (glbMb !== null && glbMb > 150) reasons.push(`GLB ${glbMb.toFixed(0)} MB: no practical web path`);
  const q = Number(asset.quality ?? 0);
  const rated = (asset.qualityCount ?? 0) > 0;
  const texMax = Number(p.textureResolutionMax ?? 0);
  // Web suitability: light enough to stream and render (faces and GLB size), not "few polygons = good".
  const webSuitability = Math.max(0, Math.min(1, 1 - Math.max(0, faces - 150_000) / 1_350_000)) * (glbMb === null ? 0.7 : Math.max(0.2, Math.min(1, 1 - Math.max(0, glbMb - 20) / 130)));
  const score = Math.round(((rated ? q / 10 : 0.6) * 0.45 + (p.purePbr ? 0.15 : 0) + Math.min(1, texMax / 2048) * 0.15 + Math.min(1, (asset.bookmarks ?? 0) / 40) * 0.1 + webSuitability * 0.15) * 1000) / 1000;
  if (reasons.length) return { tier: 'REJECT', score, webSuitability, reasons, glb };
  const tier: QualityTier = rated && q >= 8 && p.purePbr && texMax >= 2048 && webSuitability >= 0.5 ? 'PREMIUM'
    : (rated ? q >= 6 : true) && texMax >= 1024 && webSuitability >= 0.3 ? 'STANDARD' : 'FALLBACK';
  return { tier, score, webSuitability, reasons, glb };
}

// ── Plan ────────────────────────────────────────────────────────────────

export function plan(kind: AssetKind, sourceAssetId: string, asset: BkAsset, _files: Record<string, unknown>, _canonical: Canonical): AssetPlan {
  const license = licenseOf(asset);
  const a = assess(asset);
  let refusal: string | null = null;
  if (kind !== 'MODEL') refusal = 'provider policy: Blendkit supplies physical objects';
  else if (license.runtimeDelivery === 'NONE') refusal = `licence ${license.licenseClass}: runtime delivery not permitted`;
  else if (a.tier === 'REJECT') refusal = `quality: ${a.reasons.join('; ')}`;
  const runtime: Delivery = deliveryFor(license, 'RUNTIME');
  const out: PlannedFile[] = [];
  if (a.glb?.uuid) {
    out.push({ role: 'GLB', resolution: null, relPath: `${sourceAssetId}.glb`, sourceUrl: `${API}/downloads/${a.glb.uuid}/`, bytes: a.glb.size ?? 0, md5: null, contentType: 'model/gltf-binary', delivery: runtime });
  }
  if (asset.thumbnail) out.push({ role: 'THUMBNAIL', resolution: null, relPath: 'thumbnail.webp', sourceUrl: asset.thumbnail, bytes: 0, md5: null, contentType: 'image/webp', delivery: deliveryFor(license, 'PREVIEW') });
  out.push({ role: 'METADATA', resolution: null, relPath: 'source.json', sourceUrl: null, bytes: 0, md5: null, contentType: 'application/json', delivery: deliveryFor(license, 'METADATA') });
  return { kind, sourceAssetId, resolutions: [], files: out, bytes: out.reduce((s, f) => s + f.bytes, 0), refusal };
}

// ── Names ───────────────────────────────────────────────────────────────

const NOUN: Record<string, string> = {
  SOFA: 'Sofa', SECTIONAL_SOFA: 'Sectional Sofa', ARMCHAIR: 'Armchair', CHAIR: 'Chair', DINING_CHAIR: 'Dining Chair', OFFICE_CHAIR: 'Office Chair',
  BAR_STOOL: 'Bar Stool', BENCH: 'Bench', OTTOMAN: 'Ottoman', BED: 'Bed', HEADBOARD: 'Headboard', NIGHTSTAND: 'Nightstand', WARDROBE: 'Wardrobe',
  DRESSER: 'Dresser', CABINET: 'Cabinet', SHELVING: 'Shelving', BOOKCASE: 'Bookcase', TV_UNIT: 'TV Unit', DESK: 'Desk', TABLE: 'Table',
  DINING_TABLE: 'Dining Table', COFFEE_TABLE: 'Coffee Table', SIDE_TABLE: 'Side Table', CONSOLE_TABLE: 'Console Table', REFRIGERATOR: 'Refrigerator',
  OVEN: 'Oven', MICROWAVE: 'Microwave', DISHWASHER: 'Dishwasher', WASHING_MACHINE: 'Washing Machine', RANGE_HOOD: 'Range Hood', TV: 'TV',
  TOILET: 'Toilet', BIDET: 'Bidet', SINK: 'Sink', VANITY: 'Vanity', BATHTUB: 'Bathtub', SHOWER: 'Shower', PENDANT: 'Pendant Light',
  CHANDELIER: 'Chandelier', CEILING_LIGHT: 'Ceiling Light', WALL_LIGHT: 'Wall Light', FLOOR_LAMP: 'Floor Lamp', TABLE_LAMP: 'Table Lamp',
  RUG: 'Rug', CURTAIN: 'Curtains', BLIND: 'Blinds', PILLOW: 'Pillow', THROW: 'Throw', MIRROR: 'Mirror', WALL_ART: 'Wall Art', FRAME: 'Picture Frame',
  PLANT: 'Plant', PLANTER: 'Planter', DOOR: 'Door', SLIDING_DOOR: 'Sliding Door', WINDOW: 'Window', RADIATOR: 'Radiator', STAIRS: 'Stairs',
};

export function name(_kind: AssetKind, asset: BkAsset, canonical: Canonical): Naming {
  const tags = words(asset.tags ?? []);
  const base = cleanSourceName(asset.displayName || asset.name);
  const styleTags = STYLE_WORDS.filter((w) => tags.includes(w) || base.toLowerCase().includes(w));
  const colorWords = tags.filter((t) => colorFamily(t));
  const noun = NOUN[canonical.canonicalSubcategory] ?? '';
  const hasNoun = noun && base.toLowerCase().includes(noun.toLowerCase().split(' ').pop()!.replace(/s$/, ''));
  const style = styleTags.find((w) => !base.toLowerCase().includes(w));
  const displayName = titleCase([style, base, hasNoun ? '' : noun].filter(Boolean).join(' ')).slice(0, 80);
  return {
    displayName, qualifiers: qualifiersFor(displayName, [...colorWords, ...styleTags, ...tags]), normalizedName: normalizeName(displayName),
    styleTags, colorTags: colorWords, materialTags: [], aliases: words([...tags, canonical.canonicalSubcategory.replace(/_/g, ' '), noun, base, asset.category.replace(/-/g, ' ')]).slice(0, 48),
  };
}

type Fetch = (url: string) => Promise<any>;

export const blendkit: ProviderAdapter<BkAsset> = {
  provider: PROVIDER,
  policy: POLICY,
  license: licenseOf,
  async discover(fetchJson: Fetch) {
    const out = new Map<string, { sourceAssetId: string; kind: AssetKind; canonical: Canonical; asset: BkAsset; naming: Naming }>();
    for (const slug of Object.keys(SLUGS)) {
      let url: string | null = `${API}/search/?query=asset_type:model+category_subtree:${slug}&page_size=100`;
      while (url) {
        const d = await fetchJson(url);
        for (const r of d.results ?? []) {
          // Identity is the ASSET (assetBaseId), not one upload of it (id): a new upload is a new version.
          const base = r.assetBaseId ?? r.id;
          if (out.has(base)) continue;
          const asset = fromSearch(r, slug);
          const c = classify(asset);
          if (c) out.set(base, { sourceAssetId: base, kind: 'MODEL', canonical: c, asset, naming: name('MODEL', asset, c) });
        }
        url = d.next ?? null;
      }
    }
    return [...out.values()];
  },
  async current(sourceAssetId: string, _kind: AssetKind, fetchJson: Fetch) {
    const d = await fetchJson(`${API}/search/?query=asset_base_id:${encodeURIComponent(sourceAssetId)}+asset_type:model&page_size=1`);
    const r = (d.results ?? []).find((x: any) => x.assetBaseId === sourceAssetId);
    if (!r) throw new Error('asset no longer listed');
    const asset = fromSearch(r, r.category);
    return { asset, files: {}, filesHash: `${r.id}:${r.versionNumber ?? 0}:${(r.files ?? []).map((f: any) => f.uuid).sort().join(',')}`, categoryId: null, categoryPath: r.category };
  },
  plan,
  name,
  sourcePage: (id: string) => `https://www.blendkit.com/asset-gallery-detail/${id}/`,
};

/** A search result → the fields HOMATCH keeps (never the author's personal data beyond the credit name). */
export function fromSearch(r: any, slug: string): BkAsset {
  const p = r.dictParameters ?? {};
  return {
    id: r.id, assetBaseId: r.assetBaseId, name: r.name, displayName: r.displayName, category: r.category, slugs: [slug], license: r.license,
    isFree: r.isFree, verificationStatus: r.verificationStatus, quality: r.ratingsAverage?.quality ?? null, qualityCount: r.ratingsCount?.quality ?? 0,
    bookmarks: r.ratingsCount?.bookmarks ?? 0, tags: r.tags ?? [], author: r.author?.fullName ?? null, created: r.created, modified: r.modified,
    versionNumber: r.versionNumber, url: r.url, thumbnail: r.thumbnailMiddleUrlWebp ?? r.thumbnailMiddleUrl ?? null,
    params: {
      faceCount: p.faceCount, textureResolutionMax: p.textureResolutionMax, textureCount: p.textureCount, modelStyle: p.modelStyle,
      productionLevel: p.productionLevel, purePbr: p.purePbr, pbrType: p.pbrType, animated: p.animated, sexualizedContent: p.sexualizedContent,
      dimensionX: p.dimensionX, dimensionY: p.dimensionY, dimensionZ: p.dimensionZ,
      boundBox: [p.boundBoxMinX, p.boundBoxMinY, p.boundBoxMinZ, p.boundBoxMaxX, p.boundBoxMaxY, p.boundBoxMaxZ], objectCount: p.objectCount,
    },
    files: (r.files ?? []).filter((f: any) => ['gltf', 'gltf_godot', 'thumbnail'].includes(f.fileType)).map((f: any) => ({ type: f.fileType, size: f.fileUploadSize ?? null, uuid: f.uuid })),
  };
}
