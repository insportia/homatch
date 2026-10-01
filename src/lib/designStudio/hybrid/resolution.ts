// WHICH WAY EACH OBJECT REACHES THE SCENE — decided by code, not by a model.
//
// For every object the reading saw, in order of cost:
//
//   1. CATALOGUE  a canonical HOMATCH asset that genuinely LOOKS like it
//                 (reconstruction.looksLike: same plain form, close in size
//                 and colour). A quality score never overrides likeness.
//   2. PARAMETRIC HOMATCH's own drawing can represent it faithfully: built-ins
//                 and simple geometric pieces (kitchen runs, wardrobes,
//                 simple tables, appliances, sanitaryware).
//   3. GENERATE   a high-impact object neither of the above represents well
//                 (a distinctive sofa, shell chairs, beds, plants…): built on
//                 the GPU from its crop of the picture.
//   4. APPROXIMATE everything else, drawn parametrically and SAID to be an
//                 approximation; a dominant piece that ends up here is listed
//                 as unresolved in the quality report, never passed off.
//
// Identical instances (three of the same orange shell chair) are generated
// ONCE and shared. A per-job ceiling bounds how many objects go to the GPU.

import type { CatalogAsset } from '../catalog.ts';
import type { ObjectType, Reconstruction, ReconObject } from '../reconstructRead.ts';
import { looksLike, matchAsset } from '../reconstruction.ts';

export type Route = 'CATALOGUE' | 'PARAMETRIC' | 'GENERATE' | 'APPROXIMATE';

export interface ObjectDecision {
  key: string;
  type: ObjectType;
  route: Route;
  /** 0..1: how much this object matters to how the picture looks. */
  impact: number;
  /** Objects that share one generated model (the same piece seen several times). */
  group: string | null;
  reason: string;
}

/** HOMATCH's own drawing represents these faithfully (built-ins and simple geometry). */
const PARAMETRIC_FAITHFUL: ReadonlySet<ObjectType> = new Set<ObjectType>([
  'KITCHEN_RUN', 'KITCHEN_ISLAND', 'WARDROBE', 'DRESSER', 'SHELVING', 'TV_UNIT', 'TV', 'FRIDGE', 'WASHING_MACHINE',
  'SHOWER', 'BATH', 'TOILET', 'VANITY', 'RUG', 'CURTAIN', 'BLIND', 'DESK',
]);
/** Simple tables are faithful when their form is plain (round or straight). */
const PARAMETRIC_IF_PLAIN: ReadonlySet<ObjectType> = new Set<ObjectType>(['DINING_TABLE', 'COFFEE_TABLE', 'SIDE_TABLE', 'OUTDOOR_TABLE', 'BEDSIDE']);
/** What a GPU-built model can stand for in the walkthrough (seats and decor; nothing with doors or drawers to open). */
export const GENERATABLE: ReadonlySet<ObjectType> = new Set<ObjectType>([
  'SOFA', 'ARMCHAIR', 'CHAIR', 'OFFICE_CHAIR', 'BAR_STOOL', 'BED_DOUBLE', 'BED_SINGLE', 'PLANT', 'PLANTER', 'FLOOR_LAMP',
  'OUTDOOR_CHAIR', 'OUTDOOR_SOFA', 'DECOR', 'COFFEE_TABLE', 'DINING_TABLE', 'SIDE_TABLE', 'OUTDOOR_TABLE', 'BEDSIDE',
]);

/** How much each kind of object carries the look of a room. */
const WEIGHT: Partial<Record<ObjectType, number>> = {
  SOFA: 1, BED_DOUBLE: 1, BED_SINGLE: 0.9, OUTDOOR_SOFA: 0.8, ARMCHAIR: 0.8, DINING_TABLE: 0.7, PLANT: 0.6, PLANTER: 0.6,
  CHAIR: 0.6, OUTDOOR_CHAIR: 0.6, COFFEE_TABLE: 0.55, FLOOR_LAMP: 0.5, BEDSIDE: 0.45, SIDE_TABLE: 0.4, OUTDOOR_TABLE: 0.45, DECOR: 0.35,
  OFFICE_CHAIR: 0.5, BAR_STOOL: 0.45,
};

export interface ResolutionOptions {
  /** Objects at or above this impact may go to the GPU. */
  generateAbove: number;
  /** At most this many distinct models are generated per job (cost ceiling). */
  maxGenerated: number;
  /** The GPU path is available at all (configured, within budget). */
  gpuAvailable: boolean;
}

export const DEFAULT_RESOLUTION: ResolutionOptions = { generateAbove: 0.35, maxGenerated: 10, gpuAvailable: true };

/** 0..1: kind weight, size and how surely it was seen. */
export function impactOf(o: Pick<ReconObject, 'type' | 'widthM' | 'depthM' | 'confidence' | 'basis'>): number {
  const w = WEIGHT[o.type] ?? 0.3;
  const area = Math.min(1, Math.sqrt(Math.max(0.01, o.widthM * o.depthM)) / 1.6);
  const seen = o.basis === 'OBSERVED' ? 1 : 0.4;
  return Math.round(w * (0.55 + 0.45 * area) * seen * (0.5 + 0.5 * Math.max(0, Math.min(1, o.confidence))) * 1000) / 1000;
}

/** Pieces that look the same share one model: type, form, colours and size to the decimetre. */
export function likenessKey(o: Pick<ReconObject, 'type' | 'form' | 'color' | 'secondaryColor' | 'widthM' | 'depthM' | 'heightM'>): string {
  const dm = (m: number) => Math.round(m * 10);
  return [o.type, o.form ?? '-', o.color ?? '-', o.secondaryColor ?? '-', dm(o.widthM), dm(o.depthM), dm(o.heightM)].join('|');
}

/**
 * Every object's route, deterministic: the same reading, catalogue and
 * options always give the same decisions.
 */
export function resolveObjects(recon: Reconstruction, assets: CatalogAsset[], options: ResolutionOptions = DEFAULT_RESOLUTION): ObjectDecision[] {
  const decisions: ObjectDecision[] = [];
  // Highest impact first, so the GPU budget goes where the picture needs it most.
  const ordered = [...recon.objects].sort((a, b) => impactOf(b) - impactOf(a) || a.key.localeCompare(b.key));
  const groups = new Map<string, string>(); // likeness → first key
  let generated = 0;
  for (const o of ordered) {
    const impact = impactOf(o);
    const base = { key: o.key, type: o.type, impact };
    const match = matchAsset(o, assets, recon.styleWords);
    const model = match ? assets.find((a) => a.code === match.assetId) : undefined;
    if (model && !model.procedural && looksLike(o, model)) {
      decisions.push({ ...base, route: 'CATALOGUE', group: null, reason: `catalogue model ${model.code} looks like it` });
      continue;
    }
    const plain = !o.form || o.form === 'STRAIGHT' || o.form === 'ROUND';
    if (PARAMETRIC_FAITHFUL.has(o.type) || (PARAMETRIC_IF_PLAIN.has(o.type) && plain && impact < options.generateAbove + 0.2)) {
      decisions.push({ ...base, route: 'PARAMETRIC', group: null, reason: 'HOMATCH draws this kind faithfully' });
      continue;
    }
    if (options.gpuAvailable && GENERATABLE.has(o.type) && impact >= options.generateAbove && o.px) {
      const likeness = likenessKey(o);
      const first = groups.get(likeness);
      if (first) {
        decisions.push({ ...base, route: 'GENERATE', group: first, reason: `the same piece as ${first}: one model, shared` });
        continue;
      }
      if (generated < options.maxGenerated) {
        generated += 1;
        groups.set(likeness, o.key);
        decisions.push({ ...base, route: 'GENERATE', group: o.key, reason: 'high impact, no catalogue or parametric likeness' });
        continue;
      }
      decisions.push({ ...base, route: 'APPROXIMATE', group: null, reason: 'over the per-job generation ceiling' });
      continue;
    }
    decisions.push({ ...base, route: 'APPROXIMATE', group: null, reason: !o.px ? 'not traced in the picture (nothing to build from)' : !options.gpuAvailable ? 'generation unavailable' : 'low impact: drawn by HOMATCH' });
  }
  return decisions;
}

/** The objects to send to the GPU: one per group, with what the worker needs from the reading. */
export function generationRequests(recon: Reconstruction, decisions: ObjectDecision[]) {
  const byKey = new Map(recon.objects.map((o) => [o.key, o]));
  return decisions.filter((d) => d.route === 'GENERATE' && d.group === d.key).map((d) => {
    const o = byKey.get(d.key)!;
    return {
      key: o.key, type: o.type, label: o.label, image: o.px!.image, at: o.px!.points[0], front: o.px!.points[1] ?? null,
      sizeM: { width: o.widthM, depth: o.depthM, height: o.heightM }, color: o.color, secondaryColor: o.secondaryColor ?? null, form: o.form ?? null,
    };
  });
}
