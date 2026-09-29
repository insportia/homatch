// THE PARTS OF AN UPLOADED MODEL THAT CAN TRUTHFULLY BE EDITED.
//
// The server's model inspector (supabase/functions/_shared/designStudio/
// modelInspect.ts) names, per glTF node, what a part is when it can tell:
// a floor, a wall, a ceiling, a door, a window, a piece of furniture. From
// that, and only that, the workspace offers:
//
//   floors, walls, ceilings   paint and dress them (surface id `part:<node>`)
//   furniture                 hide it (it cannot be moved: it was modelled
//                             in place, and pretending otherwise would lie)
//   anything unidentified     look at it; nothing else
//
// A VISUAL_MODEL has no parts at all. Nothing here guesses beyond the
// inspector's reading.

export type PartRole = 'FLOOR' | 'WALL' | 'CEILING' | 'DOOR' | 'WINDOW' | 'FURNITURE';

export const PAINTABLE_ROLES: ReadonlySet<PartRole> = new Set(['FLOOR', 'WALL', 'CEILING']);
export const HIDEABLE_ROLES: ReadonlySet<PartRole> = new Set(['FURNITURE']);

const ROLES = new Set<PartRole>(['FLOOR', 'WALL', 'CEILING', 'DOOR', 'WINDOW', 'FURNITURE']);

export interface ModelPart {
  id: string;
  node: number;
  role: PartRole;
}

/** What the client needs of the stored model analysis. */
export interface ModelAnalysisSummary {
  kind: 'MODEL_ANALYSIS';
  editability: 'FULLY_STRUCTURED' | 'PARTIALLY_STRUCTURED' | 'VISUAL_MODEL';
  stats: { triangles: number; meshNodes: number; images: number; bytes: number; container: 'GLB' | 'GLTF' };
  normalization: { scale: number; units: 'm' | 'cm' | 'mm'; upAxis: 'Y' | 'Z'; sizeM: [number, number, number] };
  semantics: { counts: Record<PartRole, number>; unidentified: number; rooms: string[]; roles: Record<string, PartRole> };
  warnings: string[];
}

export const partId = (node: number) => `part:${node}`;

export function parsePartId(id: string): number | null {
  const m = /^part:(\d{1,6})$/.exec(id);
  return m ? Number(m[1]) : null;
}

export function isModelAnalysis(value: unknown): value is ModelAnalysisSummary {
  const v = value as Partial<ModelAnalysisSummary> | null;
  return !!v && v.kind === 'MODEL_ANALYSIS' && !!v.semantics && typeof v.semantics.roles === 'object' && !!v.normalization;
}

/** The identified parts, in node order. A VISUAL_MODEL has none, whatever its names say. */
export function modelParts(analysis: unknown): ModelPart[] {
  if (!isModelAnalysis(analysis) || analysis.editability === 'VISUAL_MODEL') return [];
  const out: ModelPart[] = [];
  for (const [key, role] of Object.entries(analysis.semantics.roles)) {
    const node = Number(key);
    if (!Number.isInteger(node) || node < 0 || !ROLES.has(role)) continue;
    out.push({ id: partId(node), node, role });
  }
  return out.sort((a, b) => a.node - b.node);
}

export function partRoles(parts: ModelPart[]): Map<string, PartRole> {
  return new Map(parts.map((p) => [p.id, p.role]));
}
