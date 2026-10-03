// PROPERTY DESIGN DNA — the look, decided once and then kept.
//
// The customer's preferences were sent to the AI designer once; HOMATCH
// placed what it proposed. This reads that APPLIED design (the version's own
// surfaces, palette and lighting) back into one structured record: which
// floor, which walls, which wet-room floor, which cabinetry colour, which
// metal, how warm the light is, and the words a photoreal finish may use.
// Every render, room view and edit of this home reads the same DNA, so the
// kitchen and the bedroom are obviously the same home.
//
// Pure: no model call. Re-deriving from the same design gives the same DNA.

import type { CatalogMaterial } from '../catalog.ts';
import type { DesignState } from '../designState.ts';
import type { SpaceModel } from '../space.ts';
import { floorSurfaceId } from '../space.ts';
import type { DesignPreferences } from '../planToHome.ts';
import type { PropertyDesignDNA } from './contract.ts';

const WET = new Set(['BATHROOM', 'WC']);
const OUTDOOR = new Set(['BALCONY', 'TERRACE']);
const lower = (c: string | null | undefined) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null);

const ACCENT_METAL: Record<DesignPreferences['accent'], string> = { BLACK_METAL: '#1d1f22', BRASS: '#b08d57', COPPER: '#b06f45', BRONZE: '#6f5235', CHROME: '#c7ccd1', MATTE_WHITE: '#efefec', NATURAL_WOOD: '#a77b52' };
const WALL_DEFAULT: Record<DesignPreferences['walls'], string> = { WARM_WHITE: '#f3eee4', COOL_WHITE: '#f1f3f5', GREIGE: '#d9d2c7', PLASTER: '#e6dccd', SAGE: '#c9d1c0', SKY: '#d6e0e8', BLUSH: '#ead7d0', TERRACOTTA: '#c27a5a', DEEP: '#4b5a5c' };
const MOOD_LIGHT: Record<DesignPreferences['mood'], PropertyDesignDNA['lighting']> = {
  WARM: { timeOfDay: 'DAY', temperature: 'WARM', interior: 0.65 },
  BRIGHT: { timeOfDay: 'DAY', temperature: 'NEUTRAL', interior: 0.55 },
  CALM: { timeOfDay: 'DAY', temperature: 'NEUTRAL', interior: 0.5 },
  DRAMATIC: { timeOfDay: 'EVENING', temperature: 'WARM', interior: 0.85 },
  NATURAL: { timeOfDay: 'DAY', temperature: 'NEUTRAL', interior: 0.45 },
  ELEGANT: { timeOfDay: 'EVENING', temperature: 'WARM', interior: 0.75 },
  COZY: { timeOfDay: 'EVENING', temperature: 'WARM', interior: 0.8 },
};
const STYLE_WORDS: Record<string, string[]> = {
  'warm-minimal': ['warm minimal', 'soft warm whites', 'light oak', 'textured linen and boucle', 'uncluttered'],
  scandinavian: ['Scandinavian', 'light woods', 'pale walls', 'muted sage accents', 'simple functional furniture'],
  japandi: ['Japandi', 'low natural-wood furniture', 'warm neutrals', 'stone and linen', 'calm and sparse'],
  contemporary: ['contemporary', 'clean lines', 'greige and white', 'mid-tone oak', 'one confident accent'],
  mediterranean: ['Mediterranean', 'sand and terracotta', 'rattan', 'natural textures', 'sunlit warmth'],
  industrial: ['industrial', 'charcoal and grey', 'metal accents', 'raw textures'],
  classic: ['classic', 'walnut and warm woods', 'symmetry', 'soft neutrals'],
  luxury: ['refined luxury', 'pale stone', 'walnut', 'dark accents', 'generous spacing'],
};

/** The most frequent assignment over a set of surfaces (ties: the first seen). */
function dominant(state: DesignState, ids: string[]) {
  const count = new Map<string, { n: number; materialId: string | null; color: string | null }>();
  for (const id of ids) {
    const a = state.surfaces[id];
    if (!a) continue;
    const key = `${a.materialId ?? ''}|${lower(a.color) ?? ''}`;
    const cur = count.get(key) ?? { n: 0, materialId: a.materialId, color: lower(a.color) };
    cur.n += 1;
    count.set(key, cur);
  }
  return [...count.values()].sort((a, b) => b.n - a.n)[0] ?? null;
}

export function deriveDNA(input: {
  preferences: DesignPreferences;
  state: DesignState;
  space: SpaceModel;
  materials: ReadonlyMap<string, CatalogMaterial>;
  sourceJobId: string | null;
}): PropertyDesignDNA {
  const { preferences: p, state, space, materials } = input;
  const colorOf = (materialId: string | null, fallback: string) => lower(materialId ? materials.get(materialId)?.pbr.baseColor : null) ?? fallback;
  const pick = (ids: string[], fallback: string) => {
    const d = dominant(state, ids);
    const materialId = d?.materialId ?? null;
    return { materialId, color: d?.color ?? colorOf(materialId, fallback) };
  };
  const dry = space.rooms.filter((r) => !WET.has(r.kind) && !OUTDOOR.has(r.kind));
  const wet = space.rooms.filter((r) => WET.has(r.kind));
  const out = space.rooms.filter((r) => OUTDOOR.has(r.kind));
  const wallIds = space.surfaces.filter((s) => s.kind === 'WALL' && dry.some((r) => r.id === s.roomId)).map((s) => s.id);
  const walls = pick(wallIds, WALL_DEFAULT[p.walls]);
  const wallColors = new Set(wallIds.map((id) => lower(state.surfaces[id]?.color)).filter(Boolean));
  const accent = wallColors.size > 1 ? [...wallColors].find((c) => c !== walls.color) ?? null : null;
  const floor = pick(dry.map((r) => floorSurfaceId(r.id)), '#d8c4a6');
  const kitchen = state.objects.find((o) => /kitchen/i.test(o.assetId));
  const light = state.lighting;
  return {
    version: 'ds-dna-1',
    preferences: p,
    palette: [...new Set([...(state.palette ?? []).map(lower).filter((c): c is string => !!c), walls.color, floor.color, ACCENT_METAL[p.accent]])].slice(0, 8),
    finishes: {
      floor,
      wetFloor: pick(wet.map((r) => floorSurfaceId(r.id)), '#cfccc5'),
      outdoorFloor: pick(out.map((r) => floorSurfaceId(r.id)), '#9a8a74'),
      walls,
      accentWall: accent ? { materialId: null, color: accent } : null,
      ceiling: { color: '#fbfbf9' },
      cabinetry: { color: lower(kitchen?.colorOverride) ?? (p.palette === 'COOL' ? '#e8eaec' : p.palette === 'NEUTRAL' ? '#ece8e1' : '#efe6d8'), materialId: null },
      metal: ACCENT_METAL[p.accent],
    },
    lighting: light
      ? { timeOfDay: (['DAY', 'EVENING', 'NIGHT'].includes(light.timeOfDay) ? light.timeOfDay : 'DAY') as PropertyDesignDNA['lighting']['timeOfDay'], temperature: light.temperature as PropertyDesignDNA['lighting']['temperature'], interior: Math.max(0, Math.min(1, light.interiorIntensity)) }
      : MOOD_LIGHT[p.mood],
    look: [
      ...(p.style ? STYLE_WORDS[p.style] ?? [] : []),
      `${p.mood.toLowerCase()} mood`,
      `${p.floor.toLowerCase().replace('_', ' ')} floors`,
      `${p.accent.toLowerCase().replace('_', ' ')} accents`,
      ...(p.brief ? [p.brief.slice(0, 240)] : []),
    ],
    sourceJobId: input.sourceJobId,
  };
}
