// WHICH WAY EACH OBJECT REACHES THE SCENE — decided by code, not by a model.
//
// For every object the reading saw (or a design placed), the cheapest faithful
// way:
//
//   1. PARAMETRIC  architecture-like built-ins whose deterministic geometry is
//                  better than any model: kitchen runs, wardrobes, shelving,
//                  appliances, sanitaryware, curtains, blinds. Built by the
//                  Blender factory from parameters (and drawn the same way by
//                  the walkthrough, so their doors and switches keep working).
//   2. CATALOGUE   a canonical HOMATCH asset that genuinely LOOKS like it
//                  (reconstruction.looksLike: same plain form, close in size
//                  and colour). A category match alone is never enough: a sofa
//                  that does not look like the picture's sofa is not used.
//   3. FACTORY     everything else HOMATCH can make from parameters — sofas of
//                  any form, shell chairs, beds, tables, plants, rugs — built
//                  by the Blender factory at the size, form and colours read,
//                  and exported as the walkthrough's own model for that piece.
//   4. UNRESOLVED  nothing HOMATCH has represents it (no family yet). Listed
//                  in the quality report by name, never passed off.
//
// No generative 3D in the core path. A future generative adapter would be a
// fifth route, enabled only when separately validated to improve fidelity.

import type { CatalogAsset } from '../catalog.ts';
import type { ObjectType, Reconstruction, ReconObject } from '../reconstructRead.ts';
import { looksLike, matchAsset } from '../reconstruction.ts';
import { RUNTIME_KINDS, type SpecKind } from './sceneSpec.ts';

export type Route = 'CATALOGUE' | 'PARAMETRIC' | 'FACTORY' | 'UNRESOLVED';

export interface ObjectDecision {
  key: string;
  type: ObjectType;
  route: Route;
  /** 0..1: how much this object matters to how the picture looks. */
  impact: number;
  /** The catalogue asset it becomes (its model for CATALOGUE, its family for the others). */
  assetCode: string | null;
  reason: string;
}

/** How much each kind of object carries the look of a room. */
const WEIGHT: Partial<Record<ObjectType, number>> = {
  SOFA: 1, BED_DOUBLE: 1, BED_SINGLE: 0.9, OUTDOOR_SOFA: 0.8, ARMCHAIR: 0.8, DINING_TABLE: 0.7, PLANT: 0.6, PLANTER: 0.6,
  CHAIR: 0.6, OUTDOOR_CHAIR: 0.6, COFFEE_TABLE: 0.55, FLOOR_LAMP: 0.5, BEDSIDE: 0.45, SIDE_TABLE: 0.4, OUTDOOR_TABLE: 0.45, DECOR: 0.35,
  OFFICE_CHAIR: 0.5, BAR_STOOL: 0.45, KITCHEN_RUN: 0.7, KITCHEN_ISLAND: 0.6, WARDROBE: 0.5, RUG: 0.5, TV_UNIT: 0.4,
};

/** 0..1: kind weight, size and how surely it was seen. */
export function impactOf(o: Pick<ReconObject, 'type' | 'widthM' | 'depthM' | 'confidence' | 'basis'>): number {
  const w = WEIGHT[o.type] ?? 0.3;
  const area = Math.min(1, Math.sqrt(Math.max(0.01, o.widthM * o.depthM)) / 1.6);
  const seen = o.basis === 'OBSERVED' ? 1 : 0.4;
  return Math.round(w * (0.55 + 0.45 * area) * seen * (0.5 + 0.5 * Math.max(0, Math.min(1, o.confidence))) * 1000) / 1000;
}

/**
 * Every object's route, deterministic: the same reading and catalogue always
 * give the same decisions, highest impact first. No AI is called here.
 */
export function resolveObjects(recon: Reconstruction, assets: CatalogAsset[]): ObjectDecision[] {
  const byCode = new Map(assets.map((a) => [a.code, a]));
  return [...recon.objects]
    .sort((a, b) => impactOf(b) - impactOf(a) || a.key.localeCompare(b.key))
    .map((o): ObjectDecision => {
      const base = { key: o.key, type: o.type, impact: impactOf(o) };
      const match = matchAsset(o, assets, recon.styleWords);
      const asset = match ? byCode.get(match.assetId) : undefined;
      if (!asset) return { ...base, route: 'UNRESOLVED', assetCode: null, reason: 'no HOMATCH family for this kind yet' };
      if (!asset.procedural) {
        return looksLike(o, asset)
          ? { ...base, route: 'CATALOGUE', assetCode: asset.code, reason: `catalogue model ${asset.code} looks like it` }
          : { ...base, route: 'FACTORY', assetCode: asset.code, reason: 'the catalogue model does not look like the picture' };
      }
      return RUNTIME_KINDS.has(asset.procedural.kind as SpecKind)
        ? { ...base, route: 'FACTORY', assetCode: asset.code, reason: 'built by the factory at the size, form and colours read' }
        : { ...base, route: 'PARAMETRIC', assetCode: asset.code, reason: 'a built-in: deterministic geometry' };
    });
}
