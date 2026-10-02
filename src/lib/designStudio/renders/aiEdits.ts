// Editing a picture OpenAI made — through the SAME stable edit pipeline.
//
// An OpenAI-first master's edit map (sceneMap.ts) names its targets "ai:<what>:<n>"
// ("ai:sofa:1", "ai:wall:2", "ai:floor:1"). They are not pieces of HOMATCH's
// 3D design state, so the catalogue-driven actions (actionsFor) do not apply:
// a target of an AI picture offers the APPEARANCE changes the edit pipeline
// makes inside its own mask — a colour for an object, paint for a wall or a
// ceiling, a material for a floor — and the edit sent is exactly the
// pipeline's APPEARANCE contract. Spatial changes (move, replace, remove) are
// not offered: they would need the 3D path, which does not design the picture.
//
// Pure.

import type { EditAction, EditChoice } from './edits';
import type { MapEntry, RenderEdit } from './contract';

const AI_ID = /^ai:([a-z_]+):\d+$/;

/** A target of an AI picture's edit map. */
export const isAiEntry = (e: Pick<MapEntry, 'id'> | null | undefined): boolean => !!e && AI_ID.test(e.id);

/** What it is ("sofa", "kitchen_cabinets", "wall"), or null. */
export const aiWhat = (e: Pick<MapEntry, 'id'>): string | null => AI_ID.exec(e.id)?.[1] ?? null;

/** The changes a target of an AI picture offers (appearance only). */
export function aiActionsFor(e: MapEntry): EditAction[] {
  if (!isAiEntry(e)) return [];
  switch (e.kind) {
    case 'OBJECT': return ['COLOR'];
    case 'WALL': case 'CEILING': return ['PAINT'];
    case 'FLOOR': return ['MATERIAL'];
    default: return [];
  }
}

/**
 * The pipeline's APPEARANCE edit for a choice on an AI target, or null when the
 * choice is not one it offers. The label names the thing (objects) or the
 * material (floors) — the words the edit prompt paints with.
 */
export function aiAppearanceEdit(e: MapEntry, choice: EditChoice, label: string): Extract<RenderEdit, { type: 'APPEARANCE' }> | null {
  const offered = aiActionsFor(e);
  if (!offered.includes(choice.action as EditAction)) return null;
  const what = (aiWhat(e) ?? '').replace(/_/g, ' ');
  if ((choice.action === 'COLOR' || choice.action === 'PAINT') && /^#[0-9a-f]{6}$/i.test(choice.color)) {
    return { type: 'APPEARANCE', targetId: e.id, targetKind: e.kind, color: choice.color.toLowerCase(), materialId: null, label: what.slice(0, 80) };
  }
  if (choice.action === 'MATERIAL' && choice.materialId) {
    return { type: 'APPEARANCE', targetId: e.id, targetKind: e.kind, color: null, materialId: choice.materialId, label: label.slice(0, 80) };
  }
  return null;
}
