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
  type AssetKind, type AssetPlan, type Canonical, type Delivery, type Discovered, type License, type Naming, type PlannedFile, type ProviderAdapter,
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

/**
 * What the asset IS, from its own NAME first. The name is the author's
 * statement; tags are search keywords ("oven" on a microwave, "sofa" on a
 * pillow) and the category slug is a shelf. Rules are ordered most specific
 * first: "microwave" before "oven", "range hood" before "range", "bedside"
 * before "bed", "sofa table" before "sofa", "pillow" before "sofa".
 */
export const NAME_RULES: Array<[RegExp, string]> = [
  // Small things named after the big thing they belong to (a fridge magnet is not a fridge)
  [/\b(magnets?|keychains?|miniatures?|toy|figurines?|candles?|candlesticks?|candle holders?)\b/i, 'ORNAMENT'],
  [/\b(mugs?|cups?|teacups?|glass(es)?|bottles?|jars?|kettles?|teapots?|pots?|pans?|knife|knives|forks?|spoons?|plates?|bowls?|grill|utensils?|cutting board|pour over)\b(?! (plant|lamp|light))/i, 'TABLEWARE'],
  [/\b(soap|lotion|shampoo|toothbrush|hair ?dryer|toilet (brush|seat|button|roll)|brush|toilet ?paper|paper holder|towel|hand dryer|bath mat|laundry basket|shower basket|toiletries)\b/i, 'BATH_ACCESSORY'],
  [/\b(handles?|knobs?|doorknobs?|hinges?|door stops?|locks?|latch(es)?)\b/i, 'HARDWARE'],
  [/\b(hangers?|coat hangers?|clothes hangers?)\b/i, 'ACCESSORY'],
  [/\b(dish dryer|dish rack|detergent|washing powder|coffee maker|whisk|spice|grater|toaster|blender|mixer bowl)\b/i, 'TABLEWARE'],
  [/\b(picture frames?|photo frames?)\b/i, 'FRAME'], [/\bplant stands?\b/i, 'SHELVING'],
  [/\btoilet (storage|cabinet|unit)\b/i, 'CABINET'], [/\b(mixer|single lever|thermostatic)\b/i, 'FAUCET'],
  // Accessories named after what they sit on or near
  [/\b(pillows?|cushions?)\b/i, 'PILLOW'], [/\b(throw|blanket|plaid)\b/i, 'THROW'],
  [/\b(rugs?|carpets?|runner)\b/i, 'RUG'], [/\b(curtains?|drapes?|drapery)\b/i, 'CURTAIN'], [/\b(blinds?|roller shade|venetian)\b/i, 'BLIND'],
  [/\b(towel rail|towel rack|towel holder|soap dispenser|toilet paper|toothbrush)\b/i, 'BATH_ACCESSORY'],
  [/\b(faucets?|taps?|mixer tap)\b/i, 'FAUCET'],
  // Appliances
  [/\bmicrowaves?\b/i, 'MICROWAVE'], [/\b(range hood|cooker hood|extractor hood|kitchen hood|exhaust hood)\b/i, 'RANGE_HOOD'],
  [/\bdish ?washers?\b/i, 'DISHWASHER'], [/\b(washing machines?|washer|tumble dryer|dryer|laundry machine)\b/i, 'WASHING_MACHINE'],
  [/\b(fridge|refrigerators?|freezer)\b/i, 'REFRIGERATOR'], [/\b(cooktop|hob|induction)\b/i, 'COOKTOP'],
  [/\b(oven|stove|range cooker|cooker)\b/i, 'OVEN'], [/\b(tv|television)\b(?! (stand|unit|cabinet|console|table))/i, 'TV'],
  [/\b(monitor|display)\b/i, 'MONITOR'], [/\bradiators?\b/i, 'RADIATOR'],
  // Bathroom
  [/\bbidets?\b/i, 'BIDET'], [/\b(toilets?|wc|water closet)\b/i, 'TOILET'], [/\b(bath ?tubs?|bath ?hub|freestanding bath)\b/i, 'BATHTUB'],
  [/\b(shower (cabin|enclosure|tray|screen|head|system)|showers?)\b/i, 'SHOWER'], [/\bvanit(y|ies)\b/i, 'VANITY'],
  [/\b(wash ?basin|basin|sink)\b/i, 'SINK'], [/\bmirrors?\b/i, 'MIRROR'],
  // Lighting (before furniture: "table lamp" is a lamp, not a table)
  [/\bchandeliers?\b/i, 'CHANDELIER'], [/\bpendants?( light| lamp)?\b/i, 'PENDANT'], [/\b(ceiling (light|lamp)|flush mount)\b/i, 'CEILING_LIGHT'],
  [/\bfloor lamps?\b/i, 'FLOOR_LAMP'], [/\b(table|desk|bedside) lamps?\b/i, 'TABLE_LAMP'], [/\b(wall (light|lamp)|sconces?)\b/i, 'WALL_LIGHT'],
  [/\blamps?\b/i, 'TABLE_LAMP'],
  // Beds before tables ("bedside table" is a nightstand)
  [/\b(night ?stands?|bedside (table|cabinet)?)\b/i, 'NIGHTSTAND'], [/\bheadboards?\b/i, 'HEADBOARD'],
  [/\b(bunk bed|day ?bed|bed ?frame|double bed|single bed|king bed|queen bed|beds?)\b/i, 'BED'],
  // Storage
  [/\b(wardrobes?|closets?|armoires?)\b/i, 'WARDROBE'], [/\b(tv (stand|unit|cabinet|console)|media (console|unit|cabinet))\b/i, 'TV_UNIT'],
  [/\b(book ?cases?|book ?shel(f|ves))\b/i, 'BOOKCASE'], [/\b(shelf|shelves|shelving|rack)\b/i, 'SHELVING'],
  [/\b(dressers?|chest of drawers|commodes?)\b/i, 'DRESSER'], [/\b(sideboards?|buffet|credenza)\b/i, 'CABINET'],
  [/\bkitchen island\b/i, 'KITCHEN_ISLAND'], [/\b(kitchen (set|cabinets?|units?)|base cabinet|upper cabinet|wall cabinet|tall cabinet)\b/i, 'KITCHEN_UNIT'],
  [/\b(cabinets?|cupboards?|lockers?)\b/i, 'CABINET'],
  // Seating
  [/\b(sofa table|sofa bed)\b/i, 'SOFA'], [/\b(sectional|corner sofa|l[- ]shaped sofa|modular sofa|chaise)\b/i, 'SECTIONAL_SOFA'],
  [/\b(sofas?|couch(es)?|settees?|loveseat)\b/i, 'SOFA'], [/\b(arm ?chairs?|lounge chairs?|recliners?|wing ?chair)\b/i, 'ARMCHAIR'],
  [/\b(office chairs?|desk chairs?|task chairs?)\b/i, 'OFFICE_CHAIR'], [/\b(bar stools?|counter stools?|stools?)\b/i, 'BAR_STOOL'],
  [/\bdining chairs?\b/i, 'DINING_CHAIR'], [/\b(ottomans?|poufs?|footstools?)\b/i, 'OTTOMAN'], [/\bbench(es)?\b/i, 'BENCH'],
  [/\bchairs?\b/i, 'CHAIR'],
  // Tables
  [/\b(coffee tables?|cocktail tables?)\b/i, 'COFFEE_TABLE'], [/\b(dining tables?|kitchen tables?)\b/i, 'DINING_TABLE'],
  [/\b(side tables?|end tables?|accent tables?)\b/i, 'SIDE_TABLE'], [/\bconsoles?( tables?)?\b/i, 'CONSOLE_TABLE'],
  [/\b(desks?|workstation|writing table)\b/i, 'DESK'], [/\btables?\b/i, 'TABLE'],
  // Architecture
  [/\bsliding doors?\b/i, 'SLIDING_DOOR'], [/\bdoors?\b/i, 'DOOR'], [/\bwindows?\b/i, 'WINDOW'], [/\b(stairs|staircase|stairway)\b/i, 'STAIRS'],
  // Plants
  [/\b(planters?|flower ?pots?|plant pots?)\b/i, 'PLANTER'],
  [/\b(plants?|monstera|ficus|succulents?|cactus|cacti|palm|fern|bonsai|orchid|snake plant|pothos|olive tree)\b/i, 'PLANT'],
  // Decor
  [/\b(vases?)\b/i, 'VASE'], [/\b(picture frames?|photo frames?)\b/i, 'FRAME'], [/\b(paintings?|canvas|poster|artwork|wall art)\b/i, 'WALL_ART'],
  [/\b(books?)\b/i, 'BOOKS'], [/\b(sculptures?|statues?|figurines?|bust)\b/i, 'SCULPTURE'],
];

/** Which family each subtype belongs to. */
export const FAMILY: Record<string, string> = {
  SOFA: 'OBJECT.FURNITURE', SECTIONAL_SOFA: 'OBJECT.FURNITURE', ARMCHAIR: 'OBJECT.FURNITURE', CHAIR: 'OBJECT.FURNITURE', DINING_CHAIR: 'OBJECT.FURNITURE',
  OFFICE_CHAIR: 'OBJECT.FURNITURE', BAR_STOOL: 'OBJECT.FURNITURE', BENCH: 'OBJECT.FURNITURE', OTTOMAN: 'OBJECT.FURNITURE', BED: 'OBJECT.FURNITURE',
  HEADBOARD: 'OBJECT.FURNITURE', NIGHTSTAND: 'OBJECT.FURNITURE', TABLE: 'OBJECT.FURNITURE', DINING_TABLE: 'OBJECT.FURNITURE', COFFEE_TABLE: 'OBJECT.FURNITURE',
  SIDE_TABLE: 'OBJECT.FURNITURE', CONSOLE_TABLE: 'OBJECT.FURNITURE', DESK: 'OBJECT.FURNITURE', FIREPLACE: 'OBJECT.FURNITURE', DINING_SET: 'OBJECT.FURNITURE',
  WARDROBE: 'OBJECT.STORAGE', DRESSER: 'OBJECT.STORAGE', CABINET: 'OBJECT.STORAGE', SHELVING: 'OBJECT.STORAGE', BOOKCASE: 'OBJECT.STORAGE', TV_UNIT: 'OBJECT.STORAGE',
  KITCHEN_UNIT: 'OBJECT.KITCHEN', KITCHEN_ISLAND: 'OBJECT.KITCHEN', KITCHEN_SET: 'OBJECT.KITCHEN', FAUCET: 'OBJECT.KITCHEN',
  REFRIGERATOR: 'OBJECT.APPLIANCE', OVEN: 'OBJECT.APPLIANCE', COOKTOP: 'OBJECT.APPLIANCE', MICROWAVE: 'OBJECT.APPLIANCE', DISHWASHER: 'OBJECT.APPLIANCE',
  WASHING_MACHINE: 'OBJECT.APPLIANCE', RANGE_HOOD: 'OBJECT.APPLIANCE', TV: 'OBJECT.APPLIANCE', MONITOR: 'OBJECT.APPLIANCE', RADIATOR: 'OBJECT.APPLIANCE',
  TOILET: 'OBJECT.BATHROOM', BIDET: 'OBJECT.BATHROOM', BATHTUB: 'OBJECT.BATHROOM', SHOWER: 'OBJECT.BATHROOM', VANITY: 'OBJECT.BATHROOM', SINK: 'OBJECT.BATHROOM',
  BATH_ACCESSORY: 'OBJECT.BATHROOM', MIRROR: 'OBJECT.DECOR',
  CHANDELIER: 'OBJECT.LIGHTING', PENDANT: 'OBJECT.LIGHTING', CEILING_LIGHT: 'OBJECT.LIGHTING', FLOOR_LAMP: 'OBJECT.LIGHTING', TABLE_LAMP: 'OBJECT.LIGHTING', WALL_LIGHT: 'OBJECT.LIGHTING',
  RUG: 'OBJECT.SOFT_FURNISHING', CURTAIN: 'OBJECT.SOFT_FURNISHING', BLIND: 'OBJECT.SOFT_FURNISHING', PILLOW: 'OBJECT.SOFT_FURNISHING', THROW: 'OBJECT.SOFT_FURNISHING',
  PLANT: 'OBJECT.PLANT', PLANTER: 'OBJECT.PLANT', PLANT_WALL: 'OBJECT.PLANT',
  DOOR: 'OBJECT.ARCHITECTURAL', SLIDING_DOOR: 'OBJECT.ARCHITECTURAL', WINDOW: 'OBJECT.ARCHITECTURAL', STAIRS: 'OBJECT.ARCHITECTURAL', WALL_PANEL: 'OBJECT.ARCHITECTURAL', MOLDING: 'OBJECT.ARCHITECTURAL',
  VASE: 'OBJECT.DECOR', FRAME: 'OBJECT.DECOR', WALL_ART: 'OBJECT.DECOR', BOOKS: 'OBJECT.DECOR', SCULPTURE: 'OBJECT.DECOR', ORNAMENT: 'OBJECT.DECOR', TABLEWARE: 'OBJECT.DECOR',
  ACCESSORY: 'OBJECT.DECOR', HARDWARE: 'OBJECT.ARCHITECTURAL',
};

/**
 * A name as words: camelCase and letter/digit joins split, separators spaced
 * ("Bookcase6" → "bookcase 6", "Flush-Mount" → "flush mount").
 */
export function words0(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2').replace(/[_\-./]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The SUBJECT of a name: what comes before "with" ("Sofa Corner with Carpet" is a sofa). */
export const subjectOf = (name: string) => words0(name).split(/\s+with\s+|,/i)[0];

/** The subtype the NAME states, if it states one. */
export function nameSubtype(name: string): string | null {
  const subject = subjectOf(name);
  for (const [re, sub] of NAME_RULES) if (re.test(subject)) return sub;
  return null;
}

/** Shelves too broad to say what an unnamed object is. */
export const GENERIC_SHELVES = new Set([
  'container', 'design', 'art', 'utility', 'storage', 'hall', 'bedroom', 'living-room', 'furniture', 'kitchen', 'bathroom', 'lighting',
  'seating', 'household-appliances', 'kids-room', 'restaurant-bar', 'cabinets', 'office-storage', 'fabrics', 'tableware-set', 'audio', 'video',
]);

/** Contexts that are not a home, and makes that are not photoreal. */
export const IRRELEVANT = /\b(hospital|medical|dental|clinic|prison|military|army|sci ?fi|spaceship|fantasy|medieval|castle|game ready|low ?poly|lowpoly|cartoon|toon|stylized|voxel|pixel|lego|smurf|toy)\b/i;
/** A scene or a set rather than one object ("Dining Set", "Sofa with Decor"). */
export const COMPOSITE = /\b(set with|with decor|with decoration|scene|interior scene|room set|living room set|bedroom set|furniture set|collection)\b|\b(chairs?|table) (and|&) (chairs?|table)\b/i;

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

/**
 * The slug decides WHETHER an asset is a residential object at all (it sits
 * on a residential shelf); what it IS comes from its name, then — only within
 * the slug's own family — from its tags, and only then from the slug.
 */
export function classify(asset: BkAsset): Canonical | null {
  const slugs = [asset.category, ...(asset.slugs ?? [])];
  const hit = slugs.map((s) => SLUGS[s]).find(Boolean);
  if (!hit) return null;
  const [slugCategory, slugSub] = hit;
  const byName = nameSubtype(`${asset.name} ${asset.displayName ?? ''}`);
  if (byName) return { canonicalCategory: FAMILY[byName] ?? slugCategory, canonicalSubcategory: byName };
  const byTags = nameSubtype((asset.tags ?? []).join(' , '));
  const family = FAMILY[slugSub] ?? slugCategory;
  if (byTags && (FAMILY[byTags] ?? '') === family) return { canonicalCategory: family, canonicalSubcategory: byTags };
  return { canonicalCategory: family, canonicalSubcategory: slugSub };
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
  const text = words0(`${asset.name} ${(asset.tags ?? []).join(' ')}`);
  const irrelevant = IRRELEVANT.exec(text);
  if (irrelevant) reasons.push(`not a residential photoreal object (${irrelevant[0].toLowerCase()})`);
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
  // What a generic shelf holds is only a guess unless the name says it: never better than a fallback.
  const shelf = [asset.category, ...(asset.slugs ?? [])].find((s) => SLUGS[s]) ?? '';
  if (GENERIC_SHELVES.has(shelf) && !nameSubtype(`${asset.name} ${asset.displayName ?? ''}`)) {
    return { tier: 'FALLBACK', score, webSuitability, reasons: [`type not stated by its name (shelf "${shelf}")`], glb };
  }
  // A set or a scene is kept only as a fallback: reconstruction places ONE object at a time.
  if (COMPOSITE.test(words0(asset.name))) return { tier: 'FALLBACK', score, webSuitability, reasons: ['composite set/scene'], glb };
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
  const out: PlannedFile[] = [];
  // The provider's GLB is the SOURCE: kept privately (restricted), never delivered.
  // The browser only ever receives the optimised runtime derivative made from it.
  if (a.glb?.uuid) {
    out.push({ role: 'GLB', resolution: null, relPath: `source/${sourceAssetId}.glb`, sourceUrl: `${API}/downloads/${a.glb.uuid}/`, bytes: a.glb.size ?? 0, md5: null, contentType: 'model/gltf-binary', delivery: 'restricted' });
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
  idPattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  async discoverIds(ids: string[], fetchJson: Fetch) {
    const found: Discovered<BkAsset>[] = [];
    const missing: Array<{ id: string; reason: string }> = [];
    for (const id of ids) {
      const d = await fetchJson(`${API}/search/?query=asset_base_id:${encodeURIComponent(id)}+asset_type:model&page_size=1`);
      const r = (d.results ?? []).find((x: any) => x.assetBaseId === id);
      if (!r) { missing.push({ id, reason: 'not listed by Blendkit as a model' }); continue; }
      // The listing's own category is the shelf, exactly as a full discovery would file it.
      const asset = fromSearch(r, r.category);
      const c = classify(asset);
      if (!c) { missing.push({ id, reason: 'no HOMATCH shelf for its category' }); continue; }
      found.push({ sourceAssetId: id, kind: 'MODEL', canonical: c, asset, naming: name('MODEL', asset, c) });
    }
    return { found, missing };
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
