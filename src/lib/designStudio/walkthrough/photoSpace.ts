// FROM A READING OF PHOTOS TO A SPACE THAT CAN BE WALKED — THE WHOLE DETERMINISTIC PART, IN ONE PLACE.
//
// The paid part (the reader looking at the pictures) is done once and its validated reading is kept with its job.
// Everything after it is here, pure: squared and its doors fitted (readingRepair.ts), completed and built
// (inferredSpace.ts), furnished from the selected render (renderFurnishing.ts), and checked against the evidence
// (geometryCheck.ts). When the read room outlines fail that check — rooms drawn in another frame than the pieces,
// slanted outlines, rooms no door joins — the same rooms are laid out again from the pieces (pieceLayout.ts) and
// checked again; the better of the two is the space. Because it is pure, a space built by older code can be built
// again from the kept reading, at no cost, whenever this improves (PHOTO_SPACE_VERSION).

import type { Reconstruction } from '../reconstructRead.ts';
import { checkGeometry, roomsOfScene, type ExpectedSpace, type GeometryCheck } from './geometryCheck.ts';
import { inferredSpace, type InferredSpace } from './inferredSpace.ts';
import { layoutFromPieces, type LayoutRepair } from './pieceLayout.ts';
import { repairReading, type ReadingRepair } from './readingRepair.ts';
import { carryPoint, sceneTransform, type RenderFurnishing } from './renderFurnishing.ts';

export const PHOTO_SPACE_VERSION = 'ds-photo-space-3';

/** Issues a new layout of the same rooms can cure (a missing room it cannot). */
const LAYOUT_ISSUES = new Set(['ROOM_SHAPE_INVALID', 'PIECES_OUTSIDE_ROOM', 'ROOM_UNREACHABLE', 'ESSENTIAL_DOES_NOT_FIT', 'FOOTPRINT_UNCOVERED']);

export interface PhotoSpace {
  recon: Reconstruction;
  readingRepairs: ReadingRepair[];
  space: InferredSpace;
  furnishing: RenderFurnishing | null;
  geometryCheck: GeometryCheck;
  /** READ: the reader's own outlines; FROM_PIECES: laid out again from the pieces (layoutRepairs say how). */
  layout: 'READ' | 'FROM_PIECES';
  layoutRepairs: LayoutRepair[];
}

export interface PhotoSpaceInput {
  sourceKey: string;
  expected: ExpectedSpace[];
  /** The selected render's pieces in the built scene (renderFurnishing.ts furnishingFromReading), when there is one. */
  furnish: ((recon: Reconstruction, floors: Array<{ id: string; polygon: Array<{ x: number; y: number }> }>) => RenderFurnishing | null) | null;
}

const blocking = (g: GeometryCheck) => g.issues.filter((x) => x.blocking).length;

function attempt(read: Reconstruction, input: PhotoSpaceInput): Omit<PhotoSpace, 'layout' | 'layoutRepairs'> | { problems: string[] } {
  const repaired = repairReading(read);
  const recon = repaired.recon;
  const space = inferredSpace(recon, input.sourceKey);
  if ('problems' in space) return space;
  const furnishing = input.furnish ? input.furnish(recon, space.canonical.scene.floors) : null;
  const toScene = sceneTransform(recon, space.canonical.scene.floors);
  const geometryCheck = checkGeometry({
    rooms: roomsOfScene(space.canonical.scene.floors),
    pieces: furnishing ? furnishing.objects : [],
    expected: input.expected,
    unreachable: space.unreachable, repairs: space.repairs,
    footprint: toScene && recon.fidelity?.outline?.length ? recon.fidelity.outline.map((p) => carryPoint(toScene, p)) : null,
  });
  return { recon, readingRepairs: repaired.repairs, space, furnishing, geometryCheck };
}

/** The space of a reading: as read when that passes the check, else laid out from its pieces when that is better. */
export function spaceFromReading(read: Reconstruction, input: PhotoSpaceInput): PhotoSpace | { problems: string[] } {
  const first = attempt(read, input);
  const curable = 'problems' in first || (first.geometryCheck.verdict === 'FAIL' && first.geometryCheck.issues.some((x) => x.blocking && LAYOUT_ISSUES.has(x.code)));
  if (!curable) return { ...(first as Exclude<typeof first, { problems: string[] }>), layout: 'READ', layoutRepairs: [] };
  // Laid out on the squared reading (one frame for rooms and pieces); repaired again on the new walls.
  const squared = 'problems' in first ? repairReading(read).recon : first.recon;
  const laid = layoutFromPieces(squared);
  const second = laid ? attempt(laid.recon, input) : null;
  if (!second || 'problems' in second) return 'problems' in first ? first : { ...first, layout: 'READ', layoutRepairs: [] };
  if ('problems' in first || second.geometryCheck.verdict === 'PASS' || blocking(second.geometryCheck) < blocking(first.geometryCheck)) {
    return { ...second, layout: 'FROM_PIECES', layoutRepairs: laid!.repairs };
  }
  return { ...first, layout: 'READ', layoutRepairs: [] };
}
