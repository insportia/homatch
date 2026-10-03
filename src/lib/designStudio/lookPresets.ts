// "HOW SHOULD IT FEEL?" — two choices a homeowner can make, turned into the
// full DesignPreferences HOMATCH's designer works from.
//
// The customer picks a STYLE (the feeling) and a QUALITY (how far the
// renovation goes). HOMATCH decides the rest — mood, floor, walls, accents,
// palette, how fully each room is furnished, and the words the AI designer is
// briefed with — coherently, the same way every time. The detailed fields stay
// in the contract: "Customise details" starts from what this produced.
//
// Those words are HOMATCH's own: the server reads them for the chosen look
// (lookWords). They never go in the customer's brief, which holds only what the
// customer wrote themselves.
//
// Pure, deterministic, no I/O.

import { normalizePreferences, type DesignPreferences } from './planToHome.ts';

export const LOOK_STYLES = ['MODERN', 'MINIMAL', 'CLASSIC', 'LUXURY', 'WARM_COZY', 'CONTEMPORARY'] as const;
export type LookStyle = typeof LOOK_STYLES[number];

export const LOOK_QUALITIES = ['SMART_BUDGET', 'HIGH_QUALITY', 'PREMIUM'] as const;
export type LookQuality = typeof LOOK_QUALITIES[number];

export interface LookChoice { style: LookStyle; quality: LookQuality }

type Direction = Omit<DesignPreferences, 'furnishing' | 'brief'>;

/**
 * Each style's coherent direction at "High quality". A style is a whole look,
 * not a single field: the designer's style code plus the surfaces that belong
 * with it.
 */
const STYLE: Record<LookStyle, Direction & { words: string }> = {
  MODERN: {
    style: 'contemporary', mood: 'BRIGHT', floor: 'LIGHT_WOOD', walls: 'COOL_WHITE', accent: 'BLACK_METAL', palette: 'NEUTRAL',
    words: 'Modern: clean lines, open and bright, crisp white walls, light wood, slim black metal details.',
  },
  MINIMAL: {
    style: 'warm-minimal', mood: 'CALM', floor: 'LIGHT_WOOD', walls: 'WARM_WHITE', accent: 'NATURAL_WOOD', palette: 'NEUTRAL',
    words: 'Minimal: few, well-chosen pieces, calm and uncluttered, soft natural tones, generous empty space.',
  },
  CLASSIC: {
    style: 'classic', mood: 'ELEGANT', floor: 'DARK_WOOD', walls: 'PLASTER', accent: 'BRASS', palette: 'WARM',
    words: 'Classic: timeless proportions, rich wood, mouldings, soft plaster walls, brass details.',
  },
  LUXURY: {
    style: 'luxury', mood: 'DRAMATIC', floor: 'MARBLE', walls: 'GREIGE', accent: 'BRASS', palette: 'NEUTRAL',
    words: 'Luxury: refined and generous, marble and fine materials, statement lighting, tailored furniture.',
  },
  WARM_COZY: {
    style: 'scandinavian', mood: 'COZY', floor: 'LIGHT_WOOD', walls: 'WARM_WHITE', accent: 'NATURAL_WOOD', palette: 'WARM',
    words: 'Warm and cosy: soft textiles, warm light, natural wood, inviting places to sit.',
  },
  CONTEMPORARY: {
    style: 'japandi', mood: 'NATURAL', floor: 'STONE', walls: 'GREIGE', accent: 'BLACK_METAL', palette: 'WARM',
    words: 'Contemporary: current and understated, natural stone and wood, muted warm tones, quiet black accents.',
  },
};

/**
 * What each quality level changes. Smart Budget keeps durable, affordable
 * finishes and the essentials; Premium raises the materials and furnishes a
 * room fully, with decor. A floor that does not exist at a level is swapped
 * for its nearest equivalent there.
 */
const QUALITY: Record<LookQuality, { furnishing: DesignPreferences['furnishing']; floorSwap: Partial<Record<DesignPreferences['floor'], DesignPreferences['floor']>>; words: string }> = {
  SMART_BUDGET: {
    furnishing: 'ESSENTIAL',
    floorSwap: { MARBLE: 'TILE', STONE: 'TILE', DARK_WOOD: 'LIGHT_WOOD' },
    words: 'Smart budget: durable, affordable finishes, essential furniture only, practical and clean.',
  },
  HIGH_QUALITY: {
    furnishing: 'FULL',
    floorSwap: {},
    words: 'High quality: solid materials, every room completely furnished, balanced lighting.',
  },
  PREMIUM: {
    furnishing: 'STAGED',
    floorSwap: { TILE: 'STONE', CONCRETE: 'STONE' },
    words: 'Premium: top-tier natural materials, curated decor and art, layered warm lighting, statement pieces.',
  },
};

export const isLookStyle = (v: unknown): v is LookStyle => LOOK_STYLES.includes(v as LookStyle);
export const isLookQuality = (v: unknown): v is LookQuality => LOOK_QUALITIES.includes(v as LookQuality);

/** The full, normalised DesignPreferences for a style and a quality level. */
export function lookPreferences(style: LookStyle, quality: LookQuality): DesignPreferences {
  const s = STYLE[style];
  const q = QUALITY[quality];
  return normalizePreferences({
    style: s.style, mood: s.mood, walls: s.walls, accent: s.accent, palette: s.palette,
    floor: q.floorSwap[s.floor] ?? s.floor,
    furnishing: q.furnishing,
    brief: '',
  });
}

/** HOMATCH's own words for a look, for the designer (the server reads them; the customer never sees them). */
export function lookWords(style: string, quality: string): string | null {
  const s = STYLE[style as LookStyle]; const q = QUALITY[quality as LookQuality];
  return s && q ? `${s.words} ${q.words}` : null;
}

/** A brief that is HOMATCH's preset words (saved by an older page), not anything the customer wrote. */
export function isPresetBrief(brief: string | null | undefined): boolean {
  const b = (brief ?? '').trim();
  if (!b) return false;
  return LOOK_STYLES.some((st) => LOOK_QUALITIES.some((ql) => lookWords(st, ql) === b));
}

/** A saved choice, checked; null when either half is missing or unknown. */
export function readLook(raw: unknown): LookChoice | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return isLookStyle(r.style) && isLookQuality(r.quality) ? { style: r.style, quality: r.quality } : null;
}
