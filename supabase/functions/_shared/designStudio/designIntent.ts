// HOMATCH DESIGN STUDIO — THE CUSTOMER'S LOOK, AS RULES HOMATCH CAN CHECK.
//
// The customer chooses a look (DesignPreferences: style, mood, floor, walls,
// accent, palette, how furnished, a short brief). The AI designer turns it
// into a plan; this file makes sure the plan IS that look, deterministically:
//
//   before the model   offerFor()      the model is shown only the floor and
//                                      wall materials of the chosen direction,
//                                      and only the pieces the level allows
//   after the model    applyIntent()   wall colours inside the chosen family,
//                                      the accent in the palette, lighting
//                                      from the mood when the model left it
//                                      out, room semantics (a bed in every
//                                      bedroom, nothing in a corridor, only
//                                      outdoor pieces outside), the core
//                                      pieces of each room programme topped
//                                      up from the catalogue, and the
//                                      furnishing cap (cut, never padded)
//
// The AI chooses WHAT (codes and colours it was shown); HOMATCH decides
// WHERE (the browser's placement engine). Pure: no I/O.
//
// The enum lists are kept in step with src/lib/designStudio/planToHome.ts
// (a matrix test and an identity test compare them).

import type { Brief, PlanAssetContext, PlanContext, PlanLighting, PlanMaterialContext, PlanRoom, PlanRoomContext } from './aiPlan.ts';

export const MOODS = ['WARM', 'BRIGHT', 'CALM', 'DRAMATIC', 'NATURAL', 'ELEGANT', 'COZY'] as const;
export type Mood = typeof MOODS[number];

export const FLOOR_DIRECTIONS = ['LIGHT_WOOD', 'DARK_WOOD', 'STONE', 'MARBLE', 'CONCRETE', 'TILE'] as const;
export type FloorDirection = typeof FLOOR_DIRECTIONS[number];

export const WALL_DIRECTIONS = ['WARM_WHITE', 'COOL_WHITE', 'GREIGE', 'PLASTER', 'DEEP'] as const;
export type WallDirection = typeof WALL_DIRECTIONS[number];

export const ACCENTS = ['BLACK_METAL', 'BRASS', 'CHROME', 'NATURAL_WOOD'] as const;
export type Accent = typeof ACCENTS[number];

export const PALETTES = ['WARM', 'NEUTRAL', 'COOL'] as const;
export type Palette = typeof PALETTES[number];

export const FURNISHING_LEVELS = ['UNFURNISHED', 'ESSENTIAL', 'FULL', 'STAGED'] as const;
export type FurnishingLevel = typeof FURNISHING_LEVELS[number];

/** How many pieces a room may receive at each level (the AI's list is cut to this, never padded). */
export const FURNISHING_CAP: Record<FurnishingLevel, number> = { UNFURNISHED: 0, ESSENTIAL: 3, FULL: 8, STAGED: 10 };

/** Server copy of the browser's DesignPreferences (style is a StyleCode or null = "describe your own"). */
export interface DesignPreferences {
  style: string | null;
  mood: Mood;
  floor: FloorDirection;
  walls: WallDirection;
  accent: Accent;
  palette: Palette;
  furnishing: FurnishingLevel;
  brief: string;
}

// ── Colour ───────────────────────────────────────────────────────────

const HEX = /^#[0-9a-f]{6}$/i;

/** CIE L*a*b* (D65) of a #rrggbb colour; null for anything else. */
export function hexToLab(hex: string): [number, number, number] | null {
  if (!HEX.test(hex)) return null;
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const hueOf = (a: number, b: number) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;

interface Family { hex: string; words: string; test: (L: number, a: number, b: number, C: number, h: number) => boolean }

/** Wall colour families: a default, the words the model is given, and the range a colour must fall in. */
export const WALL_FAMILIES: Record<WallDirection, Family> = {
  WARM_WHITE: { hex: '#f2eee6', words: 'warm whites and soft ivory (very light, a touch of yellow)', test: (L, a, b, C) => L >= 86 && C <= 16 && b >= 1.5 && a >= -4 },
  COOL_WHITE: { hex: '#f6f7f7', words: 'crisp cool whites (very light, neutral to slightly blue)', test: (L, _a, b, C) => L >= 88 && C <= 10 && b < 3.5 },
  GREIGE: { hex: '#d8d0c3', words: 'greige: grey-beige mid-light neutrals', test: (L, a, b, C) => L >= 62 && L < 90 && C <= 14 && b >= 0 && a >= -3 },
  PLASTER: { hex: '#e4d8c6', words: 'mineral plaster tones: chalky warm off-whites, sand and clay', test: (L, a, b, C) => L >= 68 && L <= 93 && C >= 3 && C <= 24 && b > 0 && a >= -2 },
  DEEP: { hex: '#3f4348', words: 'deep, saturated-but-muted dark walls (charcoal, ink, forest, oxblood)', test: (L, _a, _b, C) => L <= 50 && C <= 45 },
};

/** Hardware and metal colours the accent becomes (the "10%" of the palette). */
export const ACCENT_FAMILIES: Record<Accent, Family> = {
  BLACK_METAL: { hex: '#232323', words: 'matt black metal', test: (L, _a, _b, C) => L <= 25 && C <= 12 },
  BRASS: { hex: '#b08d57', words: 'brushed brass', test: (L, _a, _b, C, h) => L >= 45 && L <= 78 && C >= 18 && C <= 60 && h >= 55 && h <= 95 },
  CHROME: { hex: '#c9ccd0', words: 'polished chrome and steel', test: (L, _a, _b, C) => L >= 65 && L <= 92 && C <= 8 },
  NATURAL_WOOD: { hex: '#a47a52', words: 'natural mid-tone wood', test: (L, _a, _b, C, h) => L >= 35 && L <= 70 && C >= 15 && C <= 45 && h >= 45 && h <= 85 },
};

export function inFamily(fam: Family, hex: string): boolean {
  const lab = hexToLab(hex);
  if (!lab) return false;
  const [L, a, b] = lab;
  return fam.test(L, a, b, Math.hypot(a, b), hueOf(a, b));
}

/** What the mood means for the light, when the model does not say. */
export const MOOD_LIGHTING: Record<Mood, { timeOfDay: 'DAY' | 'EVENING' | 'NIGHT'; temperature: 'WARM' | 'NEUTRAL' | 'COOL'; interiorIntensity: number }> = {
  WARM: { timeOfDay: 'EVENING', temperature: 'WARM', interiorIntensity: 0.7 },
  BRIGHT: { timeOfDay: 'DAY', temperature: 'NEUTRAL', interiorIntensity: 0.9 },
  CALM: { timeOfDay: 'DAY', temperature: 'NEUTRAL', interiorIntensity: 0.55 },
  DRAMATIC: { timeOfDay: 'NIGHT', temperature: 'WARM', interiorIntensity: 0.45 },
  NATURAL: { timeOfDay: 'DAY', temperature: 'NEUTRAL', interiorIntensity: 0.6 },
  ELEGANT: { timeOfDay: 'EVENING', temperature: 'WARM', interiorIntensity: 0.6 },
  COZY: { timeOfDay: 'EVENING', temperature: 'WARM', interiorIntensity: 0.8 },
};

// ── Materials by direction ───────────────────────────────────────────

const text = (m: PlanMaterialContext) => `${m.code} ${m.name} ${m.category ?? ''}`.toLowerCase().replace(/[_/-]+/g, ' ');
const tags = (m: PlanMaterialContext) => [...(m.colorTags ?? []), m.colorFamily ?? ''].map((t) => t.toUpperCase().replace(/\s+/g, '_').replace('GREY', 'GRAY'));
const cat = (m: PlanMaterialContext) => (m.category ?? '').toUpperCase();
/** A colour that describes the material (a textured material's #ffffff tint does not). */
const knownColor = (m: PlanMaterialContext) => (m.color && HEX.test(m.color) && !m.textured ? m.color : null);

const WOOD = /\b(oak|ash|birch|maple|pine|beech|walnut|wenge|ebony|teak|cherry|mahogany|wood|wooden|parquet|plank|planks|timber|herringbone|laminate)\b/;
const DARK_WOOD = /\b(walnut|wenge|ebony|mahogany|espresso|smoked|dark|cherry|teak)\b/;
const LIGHT_WOOD = /\b(oak|ash|birch|maple|pine|beech|light|pale|blond|blonde|white|whitewashed|natural)\b/;
const GREY = /\b(grey|gray)\b/;
const MARBLE = /\b(marble|calacatta|carrara|statuario|onyx)\b/;
const STONE = /\b(stone|slate|limestone|travertine|granite|basalt|sandstone|quartzite|flagstone|cobble|cobblestone|pebble|rock)\b/;
const CONCRETE = /\b(concrete|cement|microcement|screed|terrazzo)\b/;
const TILE = /\b(tile|tiles|tiled|ceramic|porcelain|terracotta|mosaic|cotto)\b/;
const PLASTER = /\b(plaster|lime|stucco|tadelakt|venetian|limewash|clay|microcement|render)\b/;

function isWood(m: PlanMaterialContext): boolean {
  return cat(m) === 'WOOD' || tags(m).some((t) => t.startsWith('WOOD')) || WOOD.test(text(m));
}
function woodTone(m: PlanMaterialContext): 'LIGHT' | 'DARK' | 'OTHER' {
  const t = tags(m);
  if (t.includes('WOOD_DARK')) return 'DARK';
  if (t.includes('WOOD_LIGHT')) return 'LIGHT';
  const s = text(m);
  if (DARK_WOOD.test(s)) return 'DARK';
  if (GREY.test(s)) return 'OTHER';
  const hex = knownColor(m);
  const lab = hex ? hexToLab(hex) : null;
  if (lab) return lab[0] >= 55 ? 'LIGHT' : lab[0] < 48 ? 'DARK' : 'OTHER';
  return LIGHT_WOOD.test(s) ? 'LIGHT' : 'OTHER';
}

/** Does this floor material belong to the direction? (Name, category, colour tags and colour all count.) */
export function floorFits(m: PlanMaterialContext, dir: FloorDirection): boolean {
  if (!m.appliesTo.includes('FLOOR')) return false;
  const s = text(m);
  switch (dir) {
    case 'LIGHT_WOOD': return isWood(m) && woodTone(m) === 'LIGHT';
    case 'DARK_WOOD': return isWood(m) && woodTone(m) === 'DARK';
    case 'MARBLE': return MARBLE.test(s);
    case 'STONE': return !CONCRETE.test(s) && !TILE.test(s) && !isWood(m) && (cat(m) === 'STONE' || STONE.test(s) || MARBLE.test(s));
    case 'CONCRETE': return CONCRETE.test(s);
    case 'TILE': return !isWood(m) && (cat(m) === 'TILE' || TILE.test(s));
  }
}

/** What a direction falls back to when the catalogue has none of it (nearest first). */
const FLOOR_FALLBACK: Record<FloorDirection, FloorDirection[]> = {
  LIGHT_WOOD: ['DARK_WOOD'], DARK_WOOD: ['LIGHT_WOOD'], MARBLE: ['STONE', 'TILE'], STONE: ['MARBLE', 'TILE', 'CONCRETE'],
  CONCRETE: ['STONE', 'TILE'], TILE: ['STONE', 'MARBLE'],
};

/** Floors of a wet or outdoor room: water-safe whatever the customer's main direction. */
const WET_ROOMS = new Set(['BATHROOM', 'WC', 'BALCONY', 'TERRACE']);
export const isWetRoom = (kind: string) => WET_ROOMS.has(kind);
const wetSafe = (m: PlanMaterialContext) => m.appliesTo.includes('FLOOR') && (floorFits(m, 'TILE') || floorFits(m, 'STONE') || floorFits(m, 'MARBLE') || floorFits(m, 'CONCRETE'));

export function wallFits(m: PlanMaterialContext, dir: WallDirection): boolean {
  if (!m.appliesTo.includes('WALL')) return false;
  if (dir === 'PLASTER' && PLASTER.test(text(m))) return true;
  const hex = knownColor(m);
  if (hex) return inFamily(WALL_FAMILIES[dir], hex);
  const t = tags(m);
  switch (dir) {
    case 'WARM_WHITE': return t.some((x) => x === 'OFF_WHITE' || x === 'CREAM' || x === 'IVORY');
    case 'COOL_WHITE': return t.includes('WHITE');
    case 'GREIGE': return t.some((x) => x === 'BEIGE' || x === 'GRAY' || x === 'TAUPE');
    case 'PLASTER': return false;
    case 'DEEP': return t.includes('BLACK') || /\b(dark|charcoal|anthracite|navy|black|ink)\b/.test(text(m));
  }
}

// ── Pieces by role ───────────────────────────────────────────────────

export type Role =
  | 'BED' | 'SOFA' | 'ARMCHAIR' | 'COFFEE_TABLE' | 'SIDE_TABLE' | 'DINING_TABLE' | 'DINING_CHAIR' | 'CHAIR' | 'STOOL'
  | 'DESK' | 'DESK_CHAIR' | 'BEDSIDE' | 'WARDROBE' | 'MEDIA' | 'STORAGE'
  | 'KITCHEN_RUN' | 'KITCHEN_OTHER' | 'TOILET' | 'VANITY' | 'SHOWER' | 'BATH' | 'BATH_OTHER'
  | 'RUG' | 'LAMP' | 'TEXTILE' | 'PLANT' | 'DECOR'
  | 'OUTDOOR_CHAIR' | 'OUTDOOR_TABLE' | 'OUTDOOR_SOFA' | 'PLANTER' | 'OUTDOOR_OTHER' | 'OTHER';

/** What a catalogue piece is for, from its category and subcategory (dev and imported catalogues alike). */
export function roleOf(a: Pick<PlanAssetContext, 'category' | 'subcategory'>): Role {
  const c = (a.category ?? '').toUpperCase();
  const s = (a.subcategory ?? '').toUpperCase();
  if (c === 'OUTDOOR') {
    if (/CHAIR|STOOL|BENCH|LOUNGER/.test(s)) return 'OUTDOOR_CHAIR';
    if (/TABLE/.test(s)) return 'OUTDOOR_TABLE';
    if (/SOFA/.test(s)) return 'OUTDOOR_SOFA';
    if (/PLANTER|POT/.test(s)) return 'PLANTER';
    if (/PLANT/.test(s)) return 'PLANT';
    return 'OUTDOOR_OTHER';
  }
  if (/PLANTER/.test(s)) return 'PLANTER';
  if (/PLANT|TREE/.test(s)) return 'PLANT';
  if (c === 'BED') return s === 'HEADBOARD' ? 'DECOR' : 'BED';
  if (c === 'SOFA') return s === 'RECLINER' ? 'ARMCHAIR' : 'SOFA';
  if (c === 'ARMCHAIR' || s === 'ARMCHAIR') return 'ARMCHAIR';
  if (c === 'WARDROBE') return 'WARDROBE';
  if (c === 'RUG') return 'RUG';
  if (c === 'LIGHTING') return 'LAMP';
  if (c === 'TEXTILE') return 'TEXTILE';
  if (c === 'KITCHEN') return /ISLAND|APPLIANCE|FRIDGE|REFRIGERATOR|OVEN|DISHWASHER|HOOD/.test(s) ? 'KITCHEN_OTHER' : 'KITCHEN_RUN';
  if (c === 'BATHROOM') {
    if (/TOILET|WC/.test(s)) return 'TOILET';
    if (/VANITY|SINK|BASIN/.test(s)) return 'VANITY';
    if (/SHOWER/.test(s)) return 'SHOWER';
    if (/BATH/.test(s)) return 'BATH';
    return 'BATH_OTHER';
  }
  if (c === 'TABLE') {
    if (/DINING/.test(s)) return 'DINING_TABLE';
    if (/COFFEE/.test(s)) return 'COFFEE_TABLE';
    if (/DESK/.test(s)) return 'DESK';
    if (/NIGHT|BEDSIDE/.test(s)) return 'BEDSIDE';
    return 'SIDE_TABLE';
  }
  if (c === 'CHAIR') {
    if (/DINING/.test(s)) return 'DINING_CHAIR';
    if (/OFFICE|DESK/.test(s)) return 'DESK_CHAIR';
    if (/STOOL/.test(s)) return 'STOOL';
    return 'CHAIR';
  }
  if (c === 'STORAGE') {
    if (/BEDSIDE|NIGHT/.test(s)) return 'BEDSIDE';
    if (/MEDIA|TV/.test(s)) return 'MEDIA';
    return 'STORAGE';
  }
  if (c === 'DECOR') return 'DECOR';
  return 'OTHER';
}

const OUTDOOR_ROLES = new Set<Role>(['OUTDOOR_CHAIR', 'OUTDOOR_TABLE', 'OUTDOOR_SOFA', 'PLANTER', 'PLANT', 'OUTDOOR_OTHER']);
/** Pieces that dress a room rather than furnish it. */
const STAGING_ROLES = new Set<Role>(['PLANT', 'DECOR', 'TEXTILE', 'PLANTER']);
const SOFT_ROLES = new Set<Role>(['RUG', 'LAMP']);

/** Rooms that receive no furniture at all. */
const EMPTY_KINDS = new Set(['CORRIDOR', 'STAIRS', 'STAIRCASE', 'STORAGE']);
const OUTDOOR_KINDS = new Set(['BALCONY', 'TERRACE']);
export const isOutdoorRoom = (kind: string) => OUTDOOR_KINDS.has(kind);

/** May a piece of this role go in a room of this kind, at this level? */
export function roleAllowed(role: Role, kind: string, level: FurnishingLevel): boolean {
  if (level === 'UNFURNISHED' || EMPTY_KINDS.has(kind)) return false;
  if (OUTDOOR_KINDS.has(kind)) return OUTDOOR_ROLES.has(role);
  if (OUTDOOR_ROLES.has(role) && role !== 'PLANTER' && role !== 'PLANT') return false;
  if (STAGING_ROLES.has(role)) return level === 'STAGED';
  if (SOFT_ROLES.has(role)) return level !== 'ESSENTIAL';
  return true;
}

const fitsKind = (a: PlanAssetContext, kind: string) => !a.roomKinds.length || a.roomKinds.includes(kind);

// ── The slice of the catalogue the model is shown ────────────────────

export interface Offer {
  /** Floor materials of the direction (or its nearest fallback). */
  floorCodes: string[];
  /** Water-safe floors offered only for bathrooms, WCs and outdoor rooms. */
  wetFloorCodes: string[];
  wallCodes: string[];
  /** The direction actually offered, when the chosen one had nothing in the catalogue. */
  floorFallback: FloorDirection | 'ANY' | null;
}

/**
 * The model can only choose what fits the look: materials of the chosen
 * floor and wall direction, pieces the furnishing level allows somewhere in
 * this home. Deterministic (sorted by code).
 */
/** The floors of a direction, or of its nearest fallback when the catalogue has none (sorted by code). */
export function chooseFloors(materials: PlanMaterialContext[], dir: FloorDirection): { chosen: PlanMaterialContext[]; fallback: Offer['floorFallback'] } {
  const floors = materials.filter((m) => m.appliesTo.includes('FLOOR')).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const fits = floors.filter((m) => floorFits(m, dir));
  if (fits.length) return { chosen: fits, fallback: null };
  for (const alt of FLOOR_FALLBACK[dir]) {
    const f = floors.filter((m) => floorFits(m, alt));
    if (f.length) return { chosen: f, fallback: alt };
  }
  return { chosen: floors, fallback: floors.length ? 'ANY' : null };
}

export function offerFor(ctx: PlanContext, prefs: DesignPreferences): { ctx: PlanContext; offer: Offer } {
  const byCode = (a: { code: string }, b: { code: string }) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  const floors = ctx.materials.filter((m) => m.appliesTo.includes('FLOOR'));
  const { chosen, fallback: floorFallback } = chooseFloors(ctx.materials, prefs.floor);
  const chosenSet = new Set(chosen.map((m) => m.code));
  const wet = floors.filter((m) => !chosenSet.has(m.code) && wetSafe(m));
  const wallsAll = ctx.materials.filter((m) => m.appliesTo.includes('WALL') && !m.appliesTo.includes('FLOOR'));
  const walls = wallsAll.filter((m) => wallFits(m, prefs.walls));
  const keep = new Set([...chosen, ...wet, ...walls].map((m) => m.code));
  const materials = ctx.materials.filter((m) => keep.has(m.code)).sort(byCode);

  const kinds = [...new Set(ctx.rooms.map((r) => r.kind))];
  const assets = prefs.furnishing === 'UNFURNISHED' ? [] : ctx.assets.filter((a) => {
    const role = roleOf(a);
    return kinds.some((k) => fitsKind(a, k) && roleAllowed(role, k, prefs.furnishing));
  });
  return {
    ctx: { ...ctx, assets, materials },
    offer: {
      floorCodes: chosen.map((m) => m.code).sort(), wetFloorCodes: wet.map((m) => m.code).sort(),
      wallCodes: walls.map((m) => m.code).sort(), floorFallback,
    },
  };
}

/** The look, in words for the model (appended to the user message). */
export function describePreferences(prefs: DesignPreferences, ctx: PlanContext): string[] {
  const cap = FURNISHING_CAP[prefs.furnishing];
  const wetOnly = ctx.materials.filter((m) => m.appliesTo.includes('FLOOR') && !floorFits(m, prefs.floor) && wetSafe(m)).map((m) => m.code);
  const light = MOOD_LIGHTING[prefs.mood];
  return [
    'THE CUSTOMER\'S LOOK:',
    `- mood: ${prefs.mood.toLowerCase()} (lighting about ${light.timeOfDay.toLowerCase()}, ${light.temperature.toLowerCase()} light)`,
    `- floors: ${prefs.floor.toLowerCase().replace('_', ' ')} — use only the floor materials listed${wetOnly.length ? `; ${wetOnly.join(', ')} only in bathrooms, WCs, balconies and terraces` : ''}`,
    `- walls: ${WALL_FAMILIES[prefs.walls].words}; every wallColor must be one of these`,
    `- accent: ${ACCENT_FAMILIES[prefs.accent].words} (${ACCENT_FAMILIES[prefs.accent].hex}) as the 10% accent, in the palette`,
    `- palette temperature: ${prefs.palette.toLowerCase()}`,
    prefs.furnishing === 'UNFURNISHED'
      ? '- furnishing: none. furniture[] is empty in every room; propose finishes, colours and lighting only'
      : `- furnishing: ${prefs.furnishing.toLowerCase()} — at most ${cap} pieces per room, core pieces of the room programme first${prefs.furnishing === 'STAGED' ? '; include decor (plants, lamps, rugs) where it suits' : prefs.furnishing === 'ESSENTIAL' ? '; no decor' : ''}`,
    '- nothing in corridors, storage or on stairs; balconies and terraces take only outdoor pieces and planters',
    '- propose every room in scope',
  ];
}

// ── After the model ──────────────────────────────────────────────────

/** Which core pieces each room programme needs, in order (alternatives within a slot). */
function essentials(room: PlanRoomContext): Role[][] {
  const a = room.areaM2;
  switch (room.kind) {
    case 'LIVING': return [['SOFA'], ['COFFEE_TABLE']];
    case 'BEDROOM': return [['BED'], ['BEDSIDE'], ['WARDROBE']];
    case 'KITCHEN': return [['KITCHEN_RUN'], ...(a >= 9 ? [['DINING_TABLE'] as Role[]] : [])];
    case 'BATHROOM': return [['TOILET'], ['VANITY'], ...(a >= 3 ? [['SHOWER', 'BATH'] as Role[]] : [])];
    case 'WC': return [['TOILET'], ...(a > 2 ? [['VANITY'] as Role[]] : [])];
    case 'OFFICE': return [['DESK'], ['DESK_CHAIR']];
    case 'BALCONY': case 'TERRACE':
      return [['PLANTER', 'PLANT'], ...(a >= 2.5 ? [['OUTDOOR_CHAIR'] as Role[]] : []), ...(a >= 4 ? [['OUTDOOR_TABLE'] as Role[]] : [])];
    default: return [];
  }
}

const isDoubleBed = (a: PlanAssetContext) => (a.subcategory ?? '').toUpperCase() === 'DOUBLE' || (!/SINGLE/i.test(a.subcategory ?? '') && Math.min(a.widthM, a.depthM) >= 1.35);
const LARGE_SOFA = /CORNER|SECTIONAL|SOFA_3/i;

/** The catalogue piece HOMATCH adds for a slot: fits the room, matches the style, sized to the room. */
function pick(role: Role, room: PlanRoomContext, pool: PlanAssetContext[], style: string | null): PlanAssetContext | null {
  const cands = pool.filter((a) => roleOf(a) === role && fitsKind(a, room.kind));
  if (!cands.length) return null;
  const size = (a: PlanAssetContext) => a.widthM * a.depthM;
  const score = (a: PlanAssetContext): number => {
    let s = style && a.styleTags.includes(style) ? 10 : 0;
    if (role === 'BED') s += isDoubleBed(a) === room.areaM2 >= 10 ? 100 : 0;
    if (role === 'SOFA') s += LARGE_SOFA.test(a.subcategory ?? '') === room.areaM2 >= 18 ? 50 : 0;
    // Never a piece that takes more than half the room (a kitchen run lines a wall).
    if (role !== 'KITCHEN_RUN' && size(a) > room.areaM2 / 2) s -= 1000;
    return s;
  };
  const best = [...cands].sort((x, y) => score(y) - score(x) || size(x) - size(y) || (x.code < y.code ? -1 : 1))[0];
  return score(best) < -500 ? null : best;
}

export interface IntentResult {
  rooms: PlanRoom[];
  palette: string[];
  lighting: PlanLighting | null;
  /** What HOMATCH added to honour the look (for audit). */
  filled: Record<string, number>;
}

/**
 * Makes a validated alternative honour the customer's look. Runs after the
 * generic checks (known codes, real rooms, locks): everything here only
 * cuts, swaps for a catalogue piece of the same role, or adds a room
 * programme's core piece the model left out.
 */
export function applyIntent(
  alt: { rooms: PlanRoom[]; palette: string[]; lighting: PlanLighting | null },
  ctx: PlanContext,
  brief: Brief,
  prefs: DesignPreferences,
  drop: (reason: string, n?: number) => void,
): IntentResult {
  const filled: Record<string, number> = {};
  const fill = (reason: string, n = 1) => { if (n > 0) filled[reason] = (filled[reason] ?? 0) + n; };
  const L = ctx.locks;
  const assets = new Map(ctx.assets.map((a) => [a.code, a]));
  const materials = new Map(ctx.materials.map((m) => [m.code, m]));
  const cap = Math.min(FURNISHING_CAP[prefs.furnishing], 10);
  const furnitureKept = L.furniture || L.layout;
  const wallFam = WALL_FAMILIES[prefs.walls];
  const { chosen: mainFloors } = chooseFloors(ctx.materials, prefs.floor);
  const mainCodes = new Set(mainFloors.map((m) => m.code));
  const wetFloors = ctx.materials.filter(wetSafe).sort((a, b) => (a.code < b.code ? -1 : 1));

  // ── Palette and light ──
  let palette = alt.palette;
  if (!L.colors) {
    const accent = ACCENT_FAMILIES[prefs.accent];
    if (!palette.some((c) => inFamily(accent, c))) {
      palette = [...palette.slice(0, 5), accent.hex];
      fill('ACCENT');
    }
  }
  let lighting = alt.lighting;
  if (!L.lighting) {
    const d = MOOD_LIGHTING[prefs.mood];
    const next: PlanLighting = {
      timeOfDay: lighting?.timeOfDay ?? d.timeOfDay,
      temperature: lighting?.temperature ?? d.temperature,
      interiorIntensity: lighting?.interiorIntensity ?? d.interiorIntensity,
    };
    if (!lighting || !lighting.timeOfDay || !lighting.temperature || lighting.interiorIntensity == null) fill('MOOD_LIGHTING');
    lighting = next;
  }

  // ── Every room in scope, the model's first ──
  const scope = ctx.rooms.filter((r) => brief.roomIds.length === 0 || brief.roomIds.includes(r.id))
    .filter((r) => !(L.kitchen && r.kind === 'KITCHEN'));
  const proposed = new Map(alt.rooms.map((r) => [r.roomId, r]));
  const order = [...alt.rooms.map((r) => r.roomId), ...scope.map((r) => r.id).filter((id) => !proposed.has(id))];
  const roomCtx = new Map(ctx.rooms.map((r) => [r.id, r]));

  const out: PlanRoom[] = [];
  for (const id of order) {
    const room = roomCtx.get(id);
    if (!room) continue;
    const p: PlanRoom = proposed.get(id) ?? { roomId: id, wallColor: null, wallMaterial: null, floorMaterial: null, clearFurniture: false, furniture: [] };
    let { wallColor, wallMaterial, floorMaterial } = p;
    const wet = isWetRoom(room.kind);

    // Walls: inside the chosen family, or the family's own colour.
    if (wallMaterial) {
      const m = materials.get(wallMaterial);
      if (!m || !wallFits(m, prefs.walls)) { drop('OFF_DIRECTION_MATERIAL'); wallMaterial = null; }
    }
    if (wallColor && !inFamily(wallFam, wallColor)) { drop('OFF_DIRECTION_COLOR'); wallColor = null; }
    if (!wallColor && !wallMaterial && !L.walls && !L.colors) { wallColor = wallFam.hex; fill('WALL_COLOR'); }

    // Floors: the chosen direction; a wet or outdoor room may take a water-safe one instead.
    if (floorMaterial) {
      const m = materials.get(floorMaterial);
      const ok = !!m && (wet && wetFloors.length ? wetSafe(m) : mainCodes.has(m.code));
      if (!ok) { drop('OFF_DIRECTION_MATERIAL'); floorMaterial = null; }
    }
    if (!floorMaterial && !L.floor) {
      const pool = wet && wetFloors.length ? [...mainFloors.filter(wetSafe), ...wetFloors] : mainFloors;
      if (pool.length) { floorMaterial = pool[0].code; fill('FLOOR_MATERIAL'); }
    }

    // Furniture: room semantics, the core of the programme, then the cap.
    let furniture: string[] = [];
    if (!furnitureKept) {
      const kept: string[] = [];
      for (const code of p.furniture) {
        const a = assets.get(code);
        if (!a) { drop('UNKNOWN_ASSET'); continue; }
        if (!roleAllowed(roleOf(a), room.kind, prefs.furnishing)) { drop(prefs.furnishing === 'UNFURNISHED' ? 'UNFURNISHED' : 'ROOM_SEMANTICS'); continue; }
        kept.push(code);
      }
      const existingRoles = new Set(p.clearFurniture ? [] : (ctx.existing[id] ?? []).map((c) => assets.get(c)).filter((a): a is PlanAssetContext => !!a).map(roleOf));
      const core: string[] = [];
      const rest = [...kept];
      if (prefs.furnishing !== 'UNFURNISHED') {
        for (const slot of essentials(room)) {
          if (slot.some((r) => existingRoles.has(r))) continue;
          const at = rest.findIndex((c) => slot.includes(roleOf(assets.get(c)!)));
          if (at >= 0) {
            let code = rest.splice(at, 1)[0];
            // A bed sized to the room.
            if (slot[0] === 'BED') {
              const a = assets.get(code)!;
              if (isDoubleBed(a) !== room.areaM2 >= 10) {
                const better = pick('BED', room, ctx.assets, prefs.style);
                if (better && isDoubleBed(better) === room.areaM2 >= 10) { code = better.code; fill('BED_SIZED'); }
              }
            }
            core.push(code);
            continue;
          }
          for (const role of slot) {
            if (L.kitchen && (role === 'KITCHEN_RUN' || role === 'DINING_TABLE')) continue;
            const a = pick(role, room, ctx.assets, prefs.style);
            if (a && !(L.kitchen && a.category.toUpperCase() === 'KITCHEN')) { core.push(a.code); fill('ROOM_PROGRAMME'); break; }
          }
        }
      }
      // One bed per bedroom; a sofa in a bedroom only beside a bed, in a large room.
      const all = [...core, ...rest];
      const hasBed = all.some((c) => roleOf(assets.get(c)!) === 'BED') || existingRoles.has('BED');
      let beds = existingRoles.has('BED') ? 1 : 0;
      furniture = all.filter((c) => {
        const role = roleOf(assets.get(c)!);
        if (room.kind === 'BEDROOM' && role === 'BED') { beds += 1; if (beds > 1) { drop('ROOM_SEMANTICS'); return false; } }
        if (room.kind === 'BEDROOM' && role === 'SOFA' && (!hasBed || room.areaM2 < 14)) { drop('ROOM_SEMANTICS'); return false; }
        return true;
      });
      if (furniture.length > cap) { drop('FURNISHING_CAP', furniture.length - cap); furniture = furniture.slice(0, cap); }
    }

    if (!wallColor && !wallMaterial && !floorMaterial && !furniture.length && !p.clearFurniture) continue;
    out.push({ roomId: id, wallColor, wallMaterial, floorMaterial, clearFurniture: furnitureKept ? false : p.clearFurniture, furniture });
  }
  return { rooms: out, palette, lighting, filled };
}
