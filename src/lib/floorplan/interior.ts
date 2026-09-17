import type { GeneratedScene, FloorMesh, WallMesh } from './geometry';
import type { MetrePoint, RoomKind } from '@/services/developer/floorplan';

/**
 * ONE PRESET, REUSED — NOT FIVE HUNDRED GENERATED INTERIORS.
 *
 * The economics of this product are the reason the architecture looks like
 * this. Five hundred apartments across twenty layouts is TWENTY interiors, not
 * five hundred: the preset places reusable assets by rule against a verified
 * room polygon, so the work and the bytes are per LAYOUT and the apartment
 * number is just a label on the same scene.
 *
 * Nothing here calls a model. Placement is arithmetic against the room's own
 * geometry, which is what makes it repeatable, auditable and free.
 *
 * WHAT IT REFUSES TO DO
 *
 * A piece of furniture that intersects a wall, blocks a door, overlaps another
 * piece or leaves the room polygon is not adjusted, nudged or shrunk — the
 * room is returned as MANUAL_REVIEW_REQUIRED and nothing is placed in it. A
 * published apartment with a sofa through a wall is worse than a published
 * apartment with an empty living room, because the first one destroys the
 * buyer's trust in everything else on the page.
 *
 * WHAT EXISTS TODAY, SAID PLAINLY. The rules below are real and tested. The
 * ASSET LIBRARY THEY REFER TO DOES NOT EXIST YET: `assetId` names a dt_assets
 * row our 3D team has not produced. `resolvePreset()` reports which ids are
 * missing, and a preset with missing ids must not be published. That is why
 * MODERN_WARM is FOUNDATION rather than PROVEN.
 */

export type PresetId = 'MODERN_WARM' | 'LUXURY_LIGHT' | 'MINIMAL';

export interface PresetPiece {
  /** A dt_assets row id, resolved at publish time. One per layout, reused. */
  assetId: string;
  /** Footprint in metres, axis-aligned before rotation. */
  widthM: number;
  depthM: number;
  heightM: number;
  /** How it wants to sit: against a wall, in the middle, or in a corner. */
  placement: 'WALL' | 'CENTRE' | 'CORNER';
  /** Metres of clear space that must stay in front of it. */
  clearanceM: number;
  /** Only placed in a room at least this big. */
  minRoomAreaM2: number;
}

export interface RoomRecipe {
  kind: RoomKind;
  pieces: PresetPiece[];
}

export interface InteriorPreset {
  id: PresetId;
  /** Whether this preset's assets actually exist. Never assumed. */
  state: 'FOUNDATION' | 'READY';
  rooms: RoomRecipe[];
}

/**
 * MODERN_WARM. The rules are complete; the assets are not.
 *
 * Every id below is a placeholder for a piece our 3D team has yet to author,
 * and `resolvePreset` will report every one of them as missing until they
 * exist. They are written out rather than left blank so the shape of the
 * library is a decision already made rather than one deferred.
 */
export const MODERN_WARM: InteriorPreset = {
  id: 'MODERN_WARM',
  state: 'FOUNDATION',
  rooms: [
    {
      kind: 'LIVING',
      pieces: [
        { assetId: 'mw/sofa-3seat', widthM: 2.2, depthM: 0.9, heightM: 0.8, placement: 'WALL', clearanceM: 0.9, minRoomAreaM2: 12 },
        { assetId: 'mw/coffee-table', widthM: 1.1, depthM: 0.6, heightM: 0.4, placement: 'CENTRE', clearanceM: 0.5, minRoomAreaM2: 12 },
        { assetId: 'mw/rug-large', widthM: 2.4, depthM: 1.7, heightM: 0.02, placement: 'CENTRE', clearanceM: 0, minRoomAreaM2: 14 },
      ],
    },
    {
      kind: 'BEDROOM',
      pieces: [
        { assetId: 'mw/bed-double', widthM: 1.6, depthM: 2.0, heightM: 0.6, placement: 'WALL', clearanceM: 0.7, minRoomAreaM2: 9 },
        { assetId: 'mw/wardrobe', widthM: 1.8, depthM: 0.6, heightM: 2.2, placement: 'WALL', clearanceM: 0.8, minRoomAreaM2: 11 },
      ],
    },
    {
      kind: 'KITCHEN',
      pieces: [
        { assetId: 'mw/kitchen-run', widthM: 2.6, depthM: 0.65, heightM: 0.9, placement: 'WALL', clearanceM: 1.1, minRoomAreaM2: 6 },
        { assetId: 'mw/dining-set-4', widthM: 1.4, depthM: 0.9, heightM: 0.75, placement: 'CENTRE', clearanceM: 0.7, minRoomAreaM2: 12 },
      ],
    },
    {
      kind: 'BATHROOM',
      pieces: [
        { assetId: 'mw/vanity', widthM: 0.9, depthM: 0.5, heightM: 0.85, placement: 'WALL', clearanceM: 0.7, minRoomAreaM2: 3 },
      ],
    },
  ],
};

export const PRESETS: Record<PresetId, InteriorPreset> = {
  MODERN_WARM,
  // Declared so the product's three-choice architecture is visible, and
  // deliberately EMPTY: a preset with no recipes places nothing and can never
  // be published, which is the correct behaviour for a library nobody has
  // made yet. Naming it is not the same as claiming it.
  LUXURY_LIGHT: { id: 'LUXURY_LIGHT', state: 'FOUNDATION', rooms: [] },
  MINIMAL: { id: 'MINIMAL', state: 'FOUNDATION', rooms: [] },
};

// ── Placement ──────────────────────────────────────────────────────────────

export interface Placement {
  assetId: string;
  /** Centre of the piece, metres, in the scene's own frame. */
  position: MetrePoint;
  /** Radians, counter-clockwise from +x. */
  rotation: number;
  widthM: number;
  depthM: number;
  heightM: number;
}

export type RoomOutcome =
  | { roomId: string; state: 'PLACED'; placements: Placement[] }
  | { roomId: string; state: 'SKIPPED_TOO_SMALL' }
  | { roomId: string; state: 'NO_RECIPE' }
  | { roomId: string; state: 'MANUAL_REVIEW_REQUIRED'; reason: string };

export interface InteriorResult {
  preset: PresetId;
  rooms: RoomOutcome[];
  /** Asset ids the preset needs and the workspace does not have. */
  missingAssets: string[];
  /** True only when every room either placed cleanly or had nothing to place. */
  publishable: boolean;
}

/** Axis-aligned bounds of a room polygon, the frame placement works in. */
function bounds(polygon: MetrePoint[]) {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
}

/** Ray casting. A centre outside its own room is the first thing to catch. */
function contains(polygon: MetrePoint[], point: MetrePoint): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const straddles = (a.y > point.y) !== (b.y > point.y);
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

interface Rect { x: number; y: number; w: number; d: number }

/** Two centimetres is a rug, not an obstacle. */
const FLAT_M = 0.05;
const isFlat = (piece: { heightM: number }) => piece.heightM <= FLAT_M;
const isFlatPlacement = (p: Placement) => p.heightM <= FLAT_M;

const rectOf = (p: Placement): Rect => ({
  x: p.position.x - p.widthM / 2,
  y: p.position.y - p.depthM / 2,
  w: p.widthM,
  d: p.depthM,
});

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;

/** Every door's swing, as a rectangle nothing may stand in. */
function doorKeepOuts(walls: WallMesh[]): Rect[] {
  const out: Rect[] = [];
  for (const wall of walls) {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const ux = dx / length;
    const uy = dy / length;
    for (const opening of wall.openings) {
      if (opening.kind !== 'DOOR') continue;
      const cx = wall.start.x + ux * opening.offsetM;
      const cy = wall.start.y + uy * opening.offsetM;
      // A square the width of the leaf, centred on it: crude, and crude in the
      // safe direction — it reserves more space than a swing needs.
      const reach = Math.max(opening.widthM, 0.9);
      out.push({ x: cx - reach, y: cy - reach, w: reach * 2, d: reach * 2 });
    }
  }
  return out;
}

/**
 * Lay a recipe into one room, or refuse it.
 *
 * Pieces are placed largest first along the room's longest wall, then in the
 * centre. Every candidate is checked against the room polygon, the door
 * keep-outs and everything already placed. THERE IS NO FALLBACK: a piece that
 * does not fit cleanly fails the room, and the room is returned for a person.
 */
export function placeRoom(
  room: FloorMesh,
  recipe: RoomRecipe,
  keepOuts: Rect[],
): RoomOutcome {
  const box = bounds(room.polygon);
  const placements: Placement[] = [];

  const usable = recipe.pieces.filter((p) => room.areaM2 >= p.minRoomAreaM2);
  if (usable.length === 0) return { roomId: room.id, state: 'SKIPPED_TOO_SMALL' };

  const ordered = [...usable].sort((a, b) => (b.widthM * b.depthM) - (a.widthM * a.depthM));
  const inset = 0.05;

  for (const piece of ordered) {
    const candidates: Array<{ position: MetrePoint; rotation: number }> = [];

    if (piece.placement === 'WALL' || piece.placement === 'CORNER') {
      // Against each of the four sides of the room's bounding box.
      candidates.push(
        { position: { x: (box.minX + box.maxX) / 2, y: box.minY + piece.depthM / 2 + inset }, rotation: 0 },
        { position: { x: (box.minX + box.maxX) / 2, y: box.maxY - piece.depthM / 2 - inset }, rotation: Math.PI },
        { position: { x: box.minX + piece.depthM / 2 + inset, y: (box.minY + box.maxY) / 2 }, rotation: Math.PI / 2 },
        { position: { x: box.maxX - piece.depthM / 2 - inset, y: (box.minY + box.maxY) / 2 }, rotation: -Math.PI / 2 },
      );
    } else {
      candidates.push({ position: room.centroid, rotation: 0 });
    }

    const fitted = candidates.find((candidate) => {
      const trial: Placement = {
        assetId: piece.assetId,
        position: candidate.position,
        rotation: candidate.rotation,
        widthM: piece.widthM,
        depthM: piece.depthM,
        heightM: piece.heightM,
      };
      // A rotated piece occupies its swapped footprint.
      const turned = Math.abs(Math.sin(candidate.rotation)) > 0.5;
      const rect = turned
        ? { x: trial.position.x - piece.depthM / 2, y: trial.position.y - piece.widthM / 2, w: piece.depthM, d: piece.widthM }
        : rectOf(trial);

      // Every corner inside the room, not merely the centre.
      const corners: MetrePoint[] = [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.w, y: rect.y },
        { x: rect.x + rect.w, y: rect.y + rect.d },
        { x: rect.x, y: rect.y + rect.d },
      ];
      if (!corners.every((c) => contains(room.polygon, c))) return false;
      if (keepOuts.some((k) => overlaps(rect, k))) return false;
      /* A FLOOR COVERING IS NOT AN OBSTRUCTION. A rug is two centimetres
         tall and a coffee table is meant to stand on it, so flat pieces
         must be inside the room and clear of the doors and are otherwise
         allowed to share their footprint. Treating them as furniture makes
         every properly composed living room fail. */
      if (!isFlat(piece) && placements.some((p) => !isFlatPlacement(p) && overlaps(rect, rectOf(p)))) {
        return false;
      }
      return true;
    });

    if (!fitted) {
      return {
        roomId: room.id,
        state: 'MANUAL_REVIEW_REQUIRED',
        reason: `${piece.assetId} does not fit cleanly`,
      };
    }

    placements.push({
      assetId: piece.assetId,
      position: fitted.position,
      rotation: fitted.rotation,
      widthM: piece.widthM,
      depthM: piece.depthM,
      heightM: piece.heightM,
    });
  }

  return { roomId: room.id, state: 'PLACED', placements };
}

/**
 * Lay a whole preset into a generated shell.
 *
 * `availableAssetIds` is what the workspace actually holds. Anything the
 * preset names and the workspace does not have is reported, and a result with
 * missing assets is NOT publishable however well the placement went — a scene
 * referring to geometry nobody authored renders as an empty room with an
 * invisible sofa in it.
 */
export function furnish(
  scene: GeneratedScene,
  presetId: PresetId,
  availableAssetIds: Set<string>,
): InteriorResult {
  const preset = PRESETS[presetId];
  const keepOuts = doorKeepOuts(scene.walls);
  const byKind = new Map(preset.rooms.map((r) => [r.kind, r]));

  const rooms: RoomOutcome[] = scene.floors
    .filter((floor) => !floor.outdoor)
    .map((floor) => {
      const recipe = byKind.get(floor.kind);
      if (!recipe) return { roomId: floor.id, state: 'NO_RECIPE' as const };
      return placeRoom(floor, recipe, keepOuts);
    });

  const needed = new Set(preset.rooms.flatMap((r) => r.pieces.map((p) => p.assetId)));
  const missingAssets = [...needed].filter((id) => !availableAssetIds.has(id)).sort();

  const anyReview = rooms.some((r) => r.state === 'MANUAL_REVIEW_REQUIRED');
  return {
    preset: presetId,
    rooms,
    missingAssets,
    publishable: preset.state === 'READY' && missingAssets.length === 0 && !anyReview,
  };
}
