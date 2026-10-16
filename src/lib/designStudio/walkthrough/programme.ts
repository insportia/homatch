// WHAT EVERY ROOM OF A HOME MUST HOLD, WHATEVER THE DESIGN — THE ROOM PROGRAMME.
//
// A walkthrough is planned from the selected design (a model's scene plan, the render's own pieces); this file is
// the floor under it. Every room has the pieces that make it that room — a kitchen its cabinetry and its fridge, a
// bathroom its toilet, basin and shower, a bedroom its bed and wardrobe, a living room its sofa, coffee table and
// television, an office its desk and chair — and the home has a kitchen somewhere even when the reading called the
// open plan "living". The builder (build.ts) adds what the plan left out, by the walkthrough's own placement rules,
// and the READY gate refuses a home whose rooms miss what defines them (core needs).
//
// The room's kind is read with its label: a "Kitchen / Living" read as LIVING is a kitchen-living, an UNKNOWN
// "Office" is an office, a home of one habitable room is a studio (it is slept in too).
//
// Pure (Deno + Node).

import type { CatalogAsset } from '../catalog.ts';
import { pieceRole } from '../placementSearch.ts';
import { isDesk, isFixture, isIsland, isKitchen } from './walkability.ts';

type AssetWords = Pick<CatalogAsset, 'category' | 'subcategory' | 'code' | 'heightM'> & { canonicalSubcategory?: string | null };
const words = (a: AssetWords) => [a.canonicalSubcategory, a.subcategory, a.category, a.code].filter(Boolean).join(' ').toUpperCase();

/** What a room is used as, from its kind and its label. */
export type Use = 'KITCHEN' | 'KITCHEN_LIVING' | 'STUDIO' | 'LIVING' | 'DINING' | 'BEDROOM' | 'BATHROOM' | 'WC' | 'OFFICE' | 'OUTDOOR' | 'OTHER';

export interface Need {
  id: string;
  /** Whether a catalogue piece serves it. */
  serves: (a: AssetWords) => boolean;
  /** A piece the design placed that already meets it, though the programme would not choose it (an island is a kitchen). */
  metBy?: (a: AssetWords) => boolean;
  /** How many the room holds (dining chairs). */
  count: number;
  /** Core: a room without it is not that room — the READY gate refuses it. */
  core: boolean;
  /** The footprint (m²) a piece that suits an ordinary room has: the catalogue's choice is the nearest to it. */
  targetM2: number;
}

const isFridge = (a: AssetWords) => /FRIDGE|REFRIGERATOR/.test(words(a));
const isRun = (a: AssetWords) => isKitchen(a) && !isFridge(a) && /RUN|UNIT|CABINET|COUNTER|KITCHEN/.test(words(a)) && !/APPLIANCE/.test(words(a));
const isToilet = (a: AssetWords) => /TOILET|\bWC\b/.test(words(a));
const isBasin = (a: AssetWords) => /VANITY|SINK|BASIN/.test(words(a)) && !isKitchen(a);
const isWash = (a: AssetWords) => /\bSHOWER\b|\bBATH\b|BATHTUB/.test(words(a).replace(/[^A-Z0-9]+/g, ' '));
const isWardrobe = (a: AssetWords) => /WARDROBE|CLOSET/.test(words(a));
const isOutdoor = (a: AssetWords) => /OUTDOOR|GARDEN|PATIO/.test(words(a));
const role = (r: ReturnType<typeof pieceRole>) => (a: AssetWords) => pieceRole(a) === r && !isOutdoor(a);
const diningTable = (a: AssetWords) => pieceRole(a) === 'TABLE' && !isDesk(a) && !isIsland(a) && !isOutdoor(a) && !/COFFEE|SIDE/.test(words(a));
const diningChair = (a: AssetWords) => pieceRole(a) === 'CHAIR' && /DINING/.test(words(a));
const officeChair = (a: AssetWords) => pieceRole(a) === 'CHAIR' && /OFFICE|DESK/.test(words(a));
const outdoorChair = (a: AssetWords) => isOutdoor(a) && pieceRole(a) === 'CHAIR';
const outdoorTable = (a: AssetWords) => isOutdoor(a) && pieceRole(a) === 'TABLE';

const need = (id: string, serves: Need['serves'], targetM2: number, core = false, count = 1): Need => ({ id, serves, count, core, targetM2 });
// A kitchen island or peninsula the design shows is that kitchen's counter (the programme itself places a run).
const KITCHEN_NEEDS = [{ ...need('KITCHEN_RUN', isRun, 1.8, true), metBy: (a: AssetWords) => isRun(a) || isIsland(a) }, need('FRIDGE', isFridge, 0.5, true)];

/** What a room is used as: its kind, read with its label, and with the home around it (`homeHasKitchen`, `habitable`). */
export function roomUseOf(kind: string, label: string | null, home: { habitableRooms: number; kitchenRoomId: string | null; roomId: string }): Use {
  const k = String(kind).toUpperCase();
  const l = String(label ?? '').toUpperCase();
  if (k === 'BALCONY' || k === 'TERRACE' || k === 'LOGGIA' || k === 'PATIO' || k === 'PORCH') return 'OUTDOOR';
  if (k === 'WC') return 'WC';
  if (k === 'BATHROOM' || /BATH|SHOWER|ENSUITE|EN-SUITE/.test(l)) return 'BATHROOM';
  if (/\bWC\b|TOILET|POWDER/.test(l)) return 'WC';
  if (k === 'STUDIO' || /STUDIO/.test(l)) return 'STUDIO';
  if (k === 'KITCHEN_LIVING' || (/KITCHEN|COOK/.test(l) && /LIVING|LOUNGE|DINING|SALON|OPEN/.test(l))) return 'KITCHEN_LIVING';
  if (k === 'KITCHEN' || /KITCHEN|COOK/.test(l)) return 'KITCHEN';
  if (k === 'BEDROOM' || k === 'KIDS_ROOM' || k === 'GUEST_ROOM' || /BED|SLEEP|NURSERY|KIDS|CHILD|GUEST/.test(l)) return 'BEDROOM';
  if (k === 'OFFICE' || k === 'STUDY' || /OFFICE|STUDY|WORK/.test(l)) return 'OFFICE';
  if (k === 'DINING' || /DINING/.test(l)) return 'DINING';
  if (k === 'LIVING' || /LIVING|LOUNGE|SALON|SITTING|FAMILY/.test(l)) {
    // The home's only habitable room is slept in; the living room of a home with no kitchen holds it.
    if (home.habitableRooms === 1) return 'STUDIO';
    return home.kitchenRoomId === home.roomId ? 'KITCHEN_LIVING' : 'LIVING';
  }
  return 'OTHER';
}

/** The pieces a room of this use holds, core first, larger rooms holding more. */
export function needsOf(use: Use, areaM2: number): Need[] {
  const living = [need('SOFA', role('SOFA'), 1.6, true), ...(areaM2 >= 10 ? [need('COFFEE_TABLE', role('COFFEE_TABLE'), 0.5)] : []), ...(areaM2 >= 12 ? [need('TV', role('TV'), 0.6)] : []), ...(areaM2 >= 16 ? [need('ARMCHAIR', role('ARMCHAIR'), 0.7)] : [])];
  const dining = (min: number) => (areaM2 >= min ? [need('DINING_TABLE', diningTable, 1.2), need('DINING_CHAIR', diningChair, 0.25, false, areaM2 >= min + 6 ? 4 : 2)] : []);
  switch (use) {
    case 'KITCHEN': return [...KITCHEN_NEEDS, ...dining(9)];
    case 'KITCHEN_LIVING': return [...KITCHEN_NEEDS, ...living, ...dining(20)];
    case 'STUDIO': return [...KITCHEN_NEEDS, need('BED', role('BED'), 2.8, true), ...(areaM2 >= 22 ? [need('SOFA', role('SOFA'), 1.4)] : []), ...(areaM2 >= 18 ? [need('WARDROBE', isWardrobe, 1)] : []), ...dining(26)];
    case 'LIVING': return [...living, ...dining(24)];
    case 'DINING': return [need('DINING_TABLE', diningTable, 1.2, true), need('DINING_CHAIR', diningChair, 0.25, false, areaM2 >= 10 ? 4 : 2)];
    case 'BEDROOM': return [need('BED', role('BED'), areaM2 >= 10 ? 3.2 : 2.0, true), ...(areaM2 >= 8 ? [need('WARDROBE', isWardrobe, 1)] : []), ...(areaM2 >= 9 ? [need('NIGHTSTAND', role('NIGHTSTAND'), 0.2)] : [])];
    // A shower room of a square metre or two holds its shower (the toilet is the WC's next door); a bathroom holds all three.
    case 'BATHROOM': return areaM2 < 2.2
      ? [need('SHOWER_OR_BATH', isWash, 0.8, true), need('BASIN', isBasin, 0.3)]
      : [need('TOILET', isToilet, 0.25, true), need('BASIN', isBasin, 0.4, true), ...(areaM2 >= 2.5 ? [need('SHOWER_OR_BATH', isWash, 1.0, true)] : [])];
    case 'WC': return [need('TOILET', isToilet, 0.25, true), ...(areaM2 >= 1.6 ? [need('BASIN', isBasin, 0.3)] : [])];
    case 'OFFICE': return [need('DESK', isDesk, 1.0, true), need('OFFICE_CHAIR', officeChair, 0.3)];
    case 'OUTDOOR': return areaM2 >= 2.5 ? [need('OUTDOOR_CHAIR', outdoorChair, 0.4, false, areaM2 >= 4 ? 2 : 1), ...(areaM2 >= 4 ? [need('OUTDOOR_TABLE', outdoorTable, 0.4)] : [])] : [];
    default: return [];
  }
}

/** The catalogue room kinds a room of this use takes pieces from (a kitchen-living takes the kitchen's and the living room's). */
export function kindsFor(use: Use, kind: string): string[] {
  switch (use) {
    case 'KITCHEN': return ['KITCHEN', 'DINING', kind];
    case 'KITCHEN_LIVING': return ['KITCHEN', 'LIVING', 'DINING', kind];
    case 'STUDIO': return ['KITCHEN', 'LIVING', 'BEDROOM', 'DINING', kind];
    case 'LIVING': return ['LIVING', 'DINING', kind];
    case 'DINING': return ['DINING', 'KITCHEN', 'LIVING', kind];
    case 'BEDROOM': return ['BEDROOM', kind];
    case 'BATHROOM': return ['BATHROOM', 'WC', kind];
    case 'WC': return ['WC', 'BATHROOM', kind];
    case 'OFFICE': return ['OFFICE', 'BEDROOM', 'LIVING', kind];
    case 'OUTDOOR': return ['BALCONY', 'TERRACE', kind];
    default: return [kind];
  }
}

export interface RoomProgramme { roomId: string; use: Use; needs: Need[]; kinds: string[] }

/**
 * Every room's programme in one home. The home's kitchen: a room read or labelled as one, else the largest living
 * room (every home is cooked in), else — with no living room either — the largest habitable room.
 */
export function homeProgramme(rooms: Array<{ id: string; kind: string; label: string | null; areaM2: number; outdoor?: boolean }>): Map<string, RoomProgramme> {
  const habitable = rooms.filter((r) => !r.outdoor && !/BATH|WC|HALL|CORRIDOR|STORAGE|STAIR/.test(String(r.kind).toUpperCase()) && !/BATH|WC|HALL|CORRIDOR|STORAGE/.test(String(r.label ?? '').toUpperCase()));
  const first = new Map(rooms.map((r) => [r.id, roomUseOf(r.kind, r.label, { habitableRooms: habitable.length, kitchenRoomId: null, roomId: r.id })]));
  const hasKitchen = [...first.values()].some((u) => u === 'KITCHEN' || u === 'KITCHEN_LIVING' || u === 'STUDIO');
  const kitchenRoomId = hasKitchen ? null
    : ([...rooms].filter((r) => first.get(r.id) === 'LIVING').sort((a, b) => b.areaM2 - a.areaM2 || (a.id < b.id ? -1 : 1))[0]?.id ?? null);
  const out = new Map<string, RoomProgramme>();
  for (const r of rooms) {
    const use = roomUseOf(r.kind, r.label, { habitableRooms: habitable.length, kitchenRoomId, roomId: r.id });
    // A kitchen only inferred (the reading named no kitchen anywhere) is furnished when it fits, never required.
    const inferred = r.id === kitchenRoomId;
    const needs = needsOf(use, r.areaM2).map((nd) => (inferred && (nd.id === 'KITCHEN_RUN' || nd.id === 'FRIDGE') ? { ...nd, core: false } : nd));
    out.set(r.id, { roomId: r.id, use, needs, kinds: [...new Set(kindsFor(use, r.kind))] });
  }
  return out;
}

/** Whether a standing piece is a fixture or appliance the programme protects (never given way for a walk). */
export const isProgrammeFixture = (a: AssetWords) => isFixture(a) || isKitchen(a);
