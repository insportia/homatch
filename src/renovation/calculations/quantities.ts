// quantities.ts — how much of each thing a renovation actually needs.
//
// PART O's core requirement: do NOT multiply every category by total floor
// area. Each category has its own geometry, and getting that wrong is the
// single biggest source of a nonsense estimate:
//
//   floors      applicable room floor area
//   walls       wall SURFACE area, derived from perimeter x height
//   ceilings    ceiling area (= floor area of the same rooms)
//   skirting    linear metres of perimeter, minus door openings
//   tile        wet-area walls to tiling height, plus wet-area floors
//   electrical  counted POINTS, scaled by room type
//   plumbing    counted POINTS, by fixture
//   doors       counted UNITS
//   demolition  only the area actually being stripped
//
// Where real floor-plan geometry is unavailable we use transparent standard
// assumptions and RETURN them, so the customer can see and override every one
// (PART O: "use transparent standard assumptions").

export type Condition =
  | 'BLACK_FRAME'
  | 'WHITE_FRAME'
  | 'GREEN_FRAME'
  | 'OLD_RENOVATION'
  | 'USABLE_RENOVATION';

export interface RoomSpec {
  kind: 'BEDROOM' | 'LIVING' | 'KITCHEN' | 'BATHROOM' | 'HALLWAY' | 'BALCONY' | 'STORAGE' | 'LAUNDRY';
  /** Floor area in m2. */
  area: number;
  /** Optional real measurements; assumptions are used when absent. */
  perimeter?: number;
  doors?: number;
}

export interface PropertySpec {
  totalArea: number;
  ceilingHeight?: number;
  condition: Condition;
  rooms: RoomSpec[];
}

export interface Assumption {
  key: string;
  description: string;
  value: number | string;
}

export interface Quantities {
  /** itemKey -> quantity in that item's unit. */
  byItem: Record<string, number>;
  assumptions: Assumption[];
  /** Rooms the engine actually costed, for the room breakdown. */
  roomAreas: Record<string, number>;
}

/** Standard assumptions, all overridable and all reported. */
export const DEFAULTS = Object.freeze({
  ceilingHeight: 2.7,
  /** A room's perimeter estimated from its area, assuming a 1:1.4 rectangle.
   * For area A and ratio r: sides are sqrt(A/r) and sqrt(A*r). */
  roomAspectRatio: 1.4,
  /** Fraction of wall area taken by windows/doors, which is not plastered. */
  openingsFraction: 0.15,
  /** Wall tiling height in wet areas. */
  wetWallTileHeight: 2.2,
  doorWidth: 0.9,
});

export function perimeterOf(room: RoomSpec, ratio = DEFAULTS.roomAspectRatio): number {
  if (room.perimeter && room.perimeter > 0) return room.perimeter;
  const shortSide = Math.sqrt(room.area / ratio);
  const longSide = shortSide * ratio;
  return 2 * (shortSide + longSide);
}

const WET = new Set(['BATHROOM', 'LAUNDRY']);
/** Rooms that get a finished floor and painted walls. Balconies and storage
 * are treated separately because they are usually not finished to the same
 * standard — costing them as living space inflates every estimate. */
const HABITABLE = new Set(['BEDROOM', 'LIVING', 'KITCHEN', 'HALLWAY']);

function doorsFor(room: RoomSpec): number {
  if (typeof room.doors === 'number') return room.doors;
  // One door per enclosed room; hallways and living rooms are pass-through.
  if (room.kind === 'HALLWAY' || room.kind === 'LIVING' || room.kind === 'BALCONY') return 0;
  return 1;
}

/** Electrical points scale with room purpose, not with floor area alone. */
function electricalPoints(room: RoomSpec): number {
  const base: Record<string, number> = {
    BEDROOM: 6,
    LIVING: 9,
    KITCHEN: 12,
    BATHROOM: 4,
    HALLWAY: 4,
    BALCONY: 2,
    STORAGE: 2,
    LAUNDRY: 4,
  };
  const perExtraArea = room.area > 18 ? Math.floor((room.area - 18) / 6) : 0;
  return (base[room.kind] ?? 4) + perExtraArea;
}

/** Plumbing points by fixture count, never by area. */
function plumbingPoints(room: RoomSpec): number {
  if (room.kind === 'BATHROOM') return 4; // WC, basin, shower/bath, towel rail
  if (room.kind === 'KITCHEN') return 2; // sink + appliance
  if (room.kind === 'LAUNDRY') return 2;
  return 0;
}

/**
 * How much demolition the current condition implies. A black frame has
 * nothing to strip; an old renovation has everything.
 */
export function demolitionFraction(condition: Condition): number {
  switch (condition) {
    case 'BLACK_FRAME':
    case 'WHITE_FRAME':
      return 0;
    case 'GREEN_FRAME':
      return 0.05;
    case 'OLD_RENOVATION':
      return 1;
    case 'USABLE_RENOVATION':
      return 0.35;
    default:
      return 0;
  }
}

/**
 * Work the current condition has ALREADY had done. A green frame already has
 * screed and plastered walls, so charging for them again is simply wrong.
 * Returns the fraction of that work still required.
 */
export function remainingStructuralFraction(condition: Condition): { plaster: number; screed: number } {
  switch (condition) {
    case 'BLACK_FRAME':
      return { plaster: 1, screed: 1 };
    case 'WHITE_FRAME':
      return { plaster: 0.35, screed: 0.6 };
    case 'GREEN_FRAME':
      return { plaster: 0.1, screed: 0.1 };
    case 'OLD_RENOVATION':
      return { plaster: 0.6, screed: 0.5 };
    case 'USABLE_RENOVATION':
      return { plaster: 0.2, screed: 0.15 };
    default:
      return { plaster: 1, screed: 1 };
  }
}

export function estimateQuantities(property: PropertySpec): Quantities {
  const height = property.ceilingHeight || DEFAULTS.ceilingHeight;
  const assumptions: Assumption[] = [];
  const byItem: Record<string, number> = {};
  const roomAreas: Record<string, number> = {};
  const add = (key: string, qty: number) => {
    if (qty > 0) byItem[key] = round2((byItem[key] || 0) + qty);
  };

  if (!property.ceilingHeight) {
    assumptions.push({ key: 'ceilingHeight', description: 'Ceiling height not supplied; standard height assumed', value: height });
  }
  if (property.rooms.some((r) => !r.perimeter)) {
    assumptions.push({
      key: 'roomShape',
      description: 'Room perimeters estimated from area assuming a rectangular room',
      value: `1:${DEFAULTS.roomAspectRatio}`,
    });
  }
  assumptions.push({
    key: 'openings',
    description: 'Share of wall area taken by windows and doors, excluded from wall finishes',
    value: DEFAULTS.openingsFraction,
  });

  const structural = remainingStructuralFraction(property.condition);
  const demoFraction = demolitionFraction(property.condition);
  assumptions.push({
    key: 'condition',
    description: `Work already present for a ${property.condition.replace(/_/g, ' ').toLowerCase()} is not charged again`,
    value: `plaster ${Math.round(structural.plaster * 100)}%, screed ${Math.round(structural.screed * 100)}% remaining`,
  });

  for (const room of property.rooms) {
    if (room.area <= 0) continue;
    roomAreas[room.kind] = round2((roomAreas[room.kind] || 0) + room.area);

    const perimeter = perimeterOf(room);
    const grossWall = perimeter * height;
    const netWall = grossWall * (1 - DEFAULTS.openingsFraction);
    const isWet = WET.has(room.kind);
    const isHabitable = HABITABLE.has(room.kind);

    // ---- demolition: only what is actually stripped -----------------------
    add('demolition', room.area * demoFraction);

    // ---- walls ------------------------------------------------------------
    if (isWet) {
      // Wet walls are tiled to tiling height; the rest is painted.
      const tiled = perimeter * Math.min(DEFAULTS.wetWallTileHeight, height);
      add('wall.tile', tiled * (1 - DEFAULTS.openingsFraction));
      add('bath.waterproofing', room.area + perimeter * 0.3);
      const above = Math.max(0, netWall - tiled * (1 - DEFAULTS.openingsFraction));
      add('wall.paint', above);
      add('wall.plaster', netWall * structural.plaster);
    } else if (isHabitable || room.kind === 'STORAGE') {
      add('wall.plaster', netWall * structural.plaster);
      add('wall.paint', netWall);
    }

    // ---- ceilings ---------------------------------------------------------
    if (isHabitable || isWet) add('ceiling.paint', room.area);

    // ---- floors -----------------------------------------------------------
    if (isHabitable || isWet || room.kind === 'STORAGE') {
      add('floor.screed', room.area * structural.screed);
      if (isWet || room.kind === 'KITCHEN') add('floor.tile', room.area);
      else if (isHabitable) add('floor.laminate', room.area);
    }

    // ---- skirting: linear, minus door openings ----------------------------
    if (isHabitable && !isWet) {
      add('skirting', Math.max(0, perimeter - doorsFor(room) * DEFAULTS.doorWidth));
    }

    // ---- points and units -------------------------------------------------
    add('electrical.point', electricalPoints(room));
    add('plumbing.point', plumbingPoints(room));
    add('door.interior', doorsFor(room));
  }

  return { byItem, assumptions, roomAreas };
}

/**
 * Builds a room list from what Verify already knows, so the customer edits
 * only what is missing (PART O / PART AC). Deliberately conservative: it
 * distributes the KNOWN total area rather than inventing extra space.
 */
export function roomsFromKnownProperty(input: {
  totalArea: number;
  bedrooms?: number;
  bathrooms?: number;
  hasBalcony?: boolean;
}): RoomSpec[] {
  const bedrooms = Math.max(0, input.bedrooms ?? 1);
  const bathrooms = Math.max(1, input.bathrooms ?? 1);
  const rooms: RoomSpec[] = [];

  // Fixed-ish allocations first, then the remainder becomes living space.
  const bathArea = 4.5 * bathrooms;
  const kitchenArea = Math.min(12, Math.max(7, input.totalArea * 0.12));
  const hallArea = Math.max(4, input.totalArea * 0.08);
  const balconyArea = input.hasBalcony ? Math.min(6, input.totalArea * 0.05) : 0;

  const bedroomArea = bedrooms > 0 ? Math.max(9, input.totalArea * 0.16) : 0;
  const usedByBedrooms = bedroomArea * bedrooms;
  const living = Math.max(
    0,
    input.totalArea - bathArea - kitchenArea - hallArea - balconyArea - usedByBedrooms
  );

  for (let i = 0; i < bedrooms; i++) rooms.push({ kind: 'BEDROOM', area: round2(bedroomArea) });
  for (let i = 0; i < bathrooms; i++) rooms.push({ kind: 'BATHROOM', area: round2(bathArea / bathrooms) });
  rooms.push({ kind: 'KITCHEN', area: round2(kitchenArea) });
  rooms.push({ kind: 'HALLWAY', area: round2(hallArea) });
  if (living > 1) rooms.push({ kind: 'LIVING', area: round2(living) });
  if (balconyArea > 0) rooms.push({ kind: 'BALCONY', area: round2(balconyArea) });
  return rooms;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
