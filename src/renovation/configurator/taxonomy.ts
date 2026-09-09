// taxonomy.ts — the renovation universe a Tbilisi buyer actually configures.
//
// SCOPE, AND WHY IT IS THIS BIG
//
// A renovation is not six line items. A customer deciding whether to buy a
// black-frame apartment needs to see the whole shape of the job, including
// the parts nobody has priced yet, because the expensive surprises live
// precisely there: kitchen, sanitary ware, windows, heating, HVAC. A small
// "demo" taxonomy would produce a total that is tidy, confident and far too
// low, which is worse than no total at all.
//
// So every node below is a decision a real project has to make. Nodes whose
// options carry `itemKey: null` are genuine work the price book cannot cost
// yet — they are listed, planned and counted as UNPRICED rather than hidden,
// and they default to NOT_DECIDED so they can never contribute a silent zero.
//
// SCOPE OF A NODE
//
//   PROPERTY  decided once for the whole flat (electrics, heating, windows)
//   ROOM      decided per room, because the answer legitimately differs
//             (bathroom floor is tile; the bedroom's probably is not)
//
// Room-scoped nodes carry `appliesTo`, so the configurator only asks about a
// bathroom when there is one.

import type { Tier } from '../calculations/estimate.ts';

export type Choice = 'INCLUDE' | 'EXCLUDE' | 'NOT_DECIDED';
export type NodeScope = 'PROPERTY' | 'ROOM';

/** Quality band the customer thinks in. Maps onto the engine's price tier. */
export type Segment = 'ECONOMY' | 'STANDARD' | 'PREMIUM';

export const SEGMENT_TO_TIER: Readonly<Record<Segment, Tier>> = Object.freeze({
  ECONOMY: 'low',
  STANDARD: 'typical',
  PREMIUM: 'high',
});

/** Room kinds the quantity engine already understands. */
export type RoomKind =
  | 'LIVING' | 'BEDROOM' | 'KITCHEN' | 'BATHROOM' | 'HALLWAY'
  | 'BALCONY' | 'STORAGE' | 'LAUNDRY';

export interface TaxonomyOption {
  id: string;
  label: string;
  /** Price-book key, or null when this is real work with no verified price. */
  itemKey: string | null;
  /** Free-text spec hints shown to the customer, never invented pricing. */
  spec?: string;
}

export interface TaxonomyNode {
  /** Stable id used in saved scenarios. Never reuse or renumber. */
  id: string;
  category: string;
  subcategory: string;
  label: string;
  /** Translation key, when one exists. Taxonomy labels are data, not UI
   * literals; this lets them be translated incrementally without the
   * configurator rendering blanks in the meantime. */
  labelKey?: string;
  scope: NodeScope;
  /** For ROOM scope: which rooms this decision applies to. */
  appliesTo?: RoomKind[];
  options: TaxonomyOption[];
  defaultChoice: Choice;
  /** Shown under the label so the customer knows why it is being asked. */
  hint?: string;
}

const P = 'PROPERTY' as const;
const R = 'ROOM' as const;
const WET: RoomKind[] = ['BATHROOM', 'LAUNDRY'];
const DRY: RoomKind[] = ['LIVING', 'BEDROOM', 'HALLWAY', 'STORAGE'];
const ALL_ROOMS: RoomKind[] = ['LIVING', 'BEDROOM', 'KITCHEN', 'BATHROOM', 'HALLWAY', 'BALCONY', 'STORAGE', 'LAUNDRY'];

export const TAXONOMY: readonly TaxonomyNode[] = Object.freeze([
  /* ---------------- PREPARATION ---------------- */
  {
    id: 'prep.demolition', category: 'PREPARATION', subcategory: 'Strip-out',
    label: 'Removing what is there now', scope: P,
    hint: 'Old finishes, partitions and fittings that have to come out first.',
    options: [{ id: 'standard', label: 'Strip out and remove', itemKey: 'demolition' }],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'prep.waste', category: 'PREPARATION', subcategory: 'Logistics',
    label: 'Waste removal and skips', scope: P,
    options: [{ id: 'standard', label: 'Container hire and disposal', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'prep.transport', category: 'PREPARATION', subcategory: 'Logistics',
    label: 'Delivery and lifting materials', scope: P,
    hint: 'Matters more on a high floor without a service lift.',
    options: [{ id: 'standard', label: 'Transport and hoisting', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'prep.protection', category: 'PREPARATION', subcategory: 'Site',
    label: 'Protecting what stays', scope: P,
    options: [{ id: 'standard', label: 'Covering and protection', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },

  /* ---------------- STRUCTURE ---------------- */
  {
    id: 'structure.partitions', category: 'STRUCTURE', subcategory: 'Layout',
    label: 'New internal partitions', scope: P,
    hint: 'Only if you are changing the layout.',
    options: [
      { id: 'block', label: 'Block partitions', itemKey: null },
      { id: 'plasterboard', label: 'Plasterboard partitions', itemKey: null },
    ],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'structure.openings', category: 'STRUCTURE', subcategory: 'Layout',
    label: 'New or widened openings', scope: P,
    options: [{ id: 'standard', label: 'Form openings', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },

  /* ---------------- WALLS ---------------- */
  {
    id: 'walls.plaster', category: 'WALLS', subcategory: 'Preparation',
    label: 'Wall levelling and plaster', scope: P,
    options: [{ id: 'standard', label: 'Plaster and level', itemKey: 'wall.plaster' }],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'walls.finish.dry', category: 'WALLS', subcategory: 'Finish',
    label: 'Wall finish', scope: R, appliesTo: DRY.concat(['KITCHEN']),
    options: [
      { id: 'paint', label: 'Paint', itemKey: 'wall.paint' },
      { id: 'wallpaper', label: 'Wallpaper', itemKey: null },
      { id: 'decorative', label: 'Decorative plaster', itemKey: null },
      { id: 'panels', label: 'Wall panels', itemKey: null },
    ],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'walls.finish.wet', category: 'WALLS', subcategory: 'Finish',
    label: 'Wet-room wall finish', scope: R, appliesTo: WET,
    options: [
      { id: 'tile', label: 'Tile', itemKey: 'wall.tile' },
      { id: 'porcelain', label: 'Large-format porcelain', itemKey: null },
      { id: 'paint', label: 'Moisture-resistant paint', itemKey: 'wall.paint' },
    ],
    defaultChoice: 'INCLUDE',
  },

  /* ---------------- CEILINGS ---------------- */
  {
    id: 'ceilings.finish', category: 'CEILINGS', subcategory: 'Finish',
    label: 'Ceiling finish', scope: R, appliesTo: ALL_ROOMS,
    options: [
      { id: 'paint', label: 'Plaster and paint', itemKey: 'ceiling.paint' },
      { id: 'stretch', label: 'Stretch ceiling', itemKey: null },
      { id: 'plasterboard', label: 'Suspended plasterboard', itemKey: null },
    ],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'ceilings.cornice', category: 'CEILINGS', subcategory: 'Detail',
    label: 'Cornices and coving', scope: P,
    options: [{ id: 'standard', label: 'Cornices', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },

  /* ---------------- FLOORS ---------------- */
  {
    id: 'floors.screed', category: 'FLOORS', subcategory: 'Preparation',
    label: 'Floor levelling', scope: P,
    options: [{ id: 'screed', label: 'Screed and level', itemKey: 'floor.screed' }],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'floors.finish.dry', category: 'FLOORS', subcategory: 'Covering',
    label: 'Floor covering', scope: R, appliesTo: DRY,
    options: [
      { id: 'laminate', label: 'Laminate', itemKey: 'floor.laminate', spec: 'Class 32/33 typical' },
      { id: 'spc', label: 'SPC / vinyl', itemKey: null },
      { id: 'parquet', label: 'Engineered parquet', itemKey: null },
      { id: 'tile', label: 'Porcelain tile', itemKey: 'floor.tile' },
      { id: 'carpet', label: 'Carpet', itemKey: null },
    ],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'floors.finish.wet', category: 'FLOORS', subcategory: 'Covering',
    label: 'Wet-room floor', scope: R, appliesTo: WET.concat(['KITCHEN', 'BALCONY']),
    options: [
      { id: 'tile', label: 'Porcelain tile', itemKey: 'floor.tile' },
      { id: 'spc', label: 'Waterproof SPC', itemKey: null },
    ],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'floors.skirting', category: 'FLOORS', subcategory: 'Detail',
    label: 'Skirting', scope: P,
    options: [{ id: 'standard', label: 'Skirting boards', itemKey: 'skirting' }],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'floors.underlay', category: 'FLOORS', subcategory: 'Preparation',
    label: 'Acoustic underlay', scope: P,
    options: [{ id: 'standard', label: 'Underlay', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },

  /* ---------------- WATERPROOFING ---------------- */
  {
    id: 'waterproofing.wet', category: 'WATERPROOFING', subcategory: 'Wet rooms',
    label: 'Waterproofing', scope: R, appliesTo: WET.concat(['BALCONY']),
    hint: 'The one thing that is ruinous to skip and expensive to redo.',
    options: [{ id: 'standard', label: 'Tanking and membrane', itemKey: 'bath.waterproofing' }],
    defaultChoice: 'INCLUDE',
  },

  /* ---------------- PLUMBING ---------------- */
  {
    id: 'plumbing.points', category: 'PLUMBING', subcategory: 'Rough-in',
    label: 'Plumbing connection points', scope: P,
    options: [{ id: 'standard', label: 'Supply and waste points', itemKey: 'plumbing.point' }],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'plumbing.risers', category: 'PLUMBING', subcategory: 'Rough-in',
    label: 'Replacing risers and stopcocks', scope: P,
    options: [{ id: 'standard', label: 'Riser replacement', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'plumbing.waterheater', category: 'PLUMBING', subcategory: 'Hot water',
    label: 'Water heater', scope: P,
    options: [
      { id: 'electric', label: 'Electric boiler', itemKey: null },
      { id: 'gas', label: 'Gas water heater', itemKey: null },
      { id: 'combi', label: 'Combi boiler', itemKey: null },
    ],
    defaultChoice: 'NOT_DECIDED',
  },

  /* ---------------- SANITARY WARE ---------------- */
  {
    id: 'sanitary.toilet', category: 'BATHROOM', subcategory: 'Sanitary ware',
    label: 'Toilet', scope: R, appliesTo: ['BATHROOM'],
    options: [
      { id: 'floor', label: 'Floor-standing', itemKey: null },
      { id: 'wallhung', label: 'Wall-hung with concealed cistern', itemKey: null },
    ],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'sanitary.basin', category: 'BATHROOM', subcategory: 'Sanitary ware',
    label: 'Basin and vanity', scope: R, appliesTo: ['BATHROOM'],
    options: [
      { id: 'pedestal', label: 'Pedestal basin', itemKey: null },
      { id: 'vanity', label: 'Vanity unit with basin', itemKey: null },
      { id: 'countertop', label: 'Countertop basin', itemKey: null },
    ],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'sanitary.bathing', category: 'BATHROOM', subcategory: 'Sanitary ware',
    label: 'Shower or bath', scope: R, appliesTo: ['BATHROOM'],
    options: [
      { id: 'shower', label: 'Shower enclosure', itemKey: null },
      { id: 'bath', label: 'Bathtub', itemKey: null },
      { id: 'both', label: 'Both', itemKey: null },
      { id: 'walkin', label: 'Walk-in wet area', itemKey: null },
    ],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'sanitary.mixers', category: 'BATHROOM', subcategory: 'Brassware',
    label: 'Taps and mixers', scope: R, appliesTo: WET.concat(['KITCHEN']),
    options: [{ id: 'standard', label: 'Mixers', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'sanitary.accessories', category: 'BATHROOM', subcategory: 'Accessories',
    label: 'Bathroom accessories', scope: R, appliesTo: ['BATHROOM'],
    options: [{ id: 'standard', label: 'Rails, mirror, fittings', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },

  /* ---------------- ELECTRICAL ---------------- */
  {
    id: 'electrical.points', category: 'ELECTRICAL', subcategory: 'Rough-in',
    label: 'Sockets, switches and lighting points', scope: P,
    options: [{ id: 'standard', label: 'Electrical points', itemKey: 'electrical.point' }],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'electrical.panel', category: 'ELECTRICAL', subcategory: 'Distribution',
    label: 'Consumer unit and protection', scope: P,
    options: [{ id: 'standard', label: 'New panel and breakers', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'electrical.rewire', category: 'ELECTRICAL', subcategory: 'Distribution',
    label: 'Full rewire', scope: P,
    hint: 'Usually unavoidable in an older flat.',
    options: [{ id: 'standard', label: 'Rewire', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'electrical.lighting', category: 'LIGHTING', subcategory: 'Fittings',
    label: 'Light fittings', scope: R, appliesTo: ALL_ROOMS,
    options: [
      { id: 'spots', label: 'Recessed spots', itemKey: null },
      { id: 'pendant', label: 'Pendants and fittings', itemKey: null },
      { id: 'track', label: 'Track lighting', itemKey: null },
    ],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'electrical.lowvoltage', category: 'ELECTRICAL', subcategory: 'Data',
    label: 'Internet, TV and intercom', scope: P,
    options: [{ id: 'standard', label: 'Low-voltage wiring', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'electrical.smart', category: 'ELECTRICAL', subcategory: 'Smart home',
    label: 'Smart home control', scope: P,
    options: [{ id: 'standard', label: 'Smart switches and control', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },

  /* ---------------- HEATING / HVAC ---------------- */
  {
    id: 'heating.system', category: 'HEATING', subcategory: 'System',
    label: 'Heating', scope: P,
    options: [
      { id: 'radiators', label: 'Radiators', itemKey: null },
      { id: 'underfloor', label: 'Underfloor heating', itemKey: null },
      { id: 'mixed', label: 'Underfloor in wet rooms, radiators elsewhere', itemKey: null },
    ],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'hvac.cooling', category: 'HVAC', subcategory: 'Cooling',
    label: 'Air conditioning', scope: P,
    options: [
      { id: 'split', label: 'Split units', itemKey: null },
      { id: 'ducted', label: 'Ducted system', itemKey: null },
    ],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'hvac.ventilation', category: 'HVAC', subcategory: 'Ventilation',
    label: 'Extraction and ventilation', scope: R, appliesTo: WET.concat(['KITCHEN']),
    options: [{ id: 'standard', label: 'Extractor and ducting', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },

  /* ---------------- DOORS / WINDOWS ---------------- */
  {
    id: 'doors.interior', category: 'DOORS', subcategory: 'Interior',
    label: 'Interior doors', scope: P,
    options: [
      { id: 'standard', label: 'Interior doors', itemKey: 'door.interior' },
      { id: 'sliding', label: 'Sliding doors', itemKey: null },
    ],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'doors.entrance', category: 'DOORS', subcategory: 'Entrance',
    label: 'Entrance door', scope: P,
    options: [{ id: 'standard', label: 'Security entrance door', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'windows.replace', category: 'WINDOWS', subcategory: 'Replacement',
    label: 'Windows', scope: P,
    options: [
      { id: 'pvc', label: 'PVC double glazing', itemKey: null },
      { id: 'aluminium', label: 'Aluminium', itemKey: null },
    ],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'windows.sills', category: 'WINDOWS', subcategory: 'Detail',
    label: 'Window sills and reveals', scope: P,
    options: [{ id: 'standard', label: 'Sills and reveals', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'balcony.glazing', category: 'WINDOWS', subcategory: 'Balcony',
    label: 'Balcony glazing', scope: R, appliesTo: ['BALCONY'],
    options: [{ id: 'standard', label: 'Glaze the balcony', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },

  /* ---------------- INSULATION ---------------- */
  {
    id: 'insulation.thermal', category: 'INSULATION', subcategory: 'Thermal',
    label: 'Thermal insulation', scope: P,
    options: [{ id: 'standard', label: 'Insulate external walls', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'insulation.acoustic', category: 'INSULATION', subcategory: 'Acoustic',
    label: 'Sound insulation', scope: P,
    options: [{ id: 'standard', label: 'Acoustic treatment', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },

  /* ---------------- KITCHEN ---------------- */
  {
    id: 'kitchen.units', category: 'KITCHEN', subcategory: 'Cabinetry',
    label: 'Kitchen units', scope: R, appliesTo: ['KITCHEN'],
    options: [
      { id: 'flatpack', label: 'Flat-pack', itemKey: null },
      { id: 'made', label: 'Made to measure', itemKey: null },
    ],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'kitchen.worktop', category: 'KITCHEN', subcategory: 'Worktop',
    label: 'Worktop', scope: R, appliesTo: ['KITCHEN'],
    options: [
      { id: 'laminate', label: 'Laminate', itemKey: null },
      { id: 'quartz', label: 'Quartz', itemKey: null },
      { id: 'stone', label: 'Natural stone', itemKey: null },
    ],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'kitchen.splashback', category: 'KITCHEN', subcategory: 'Finish',
    label: 'Splashback', scope: R, appliesTo: ['KITCHEN'],
    options: [
      { id: 'tile', label: 'Tile', itemKey: 'wall.tile' },
      { id: 'glass', label: 'Glass panel', itemKey: null },
    ],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'kitchen.appliances', category: 'KITCHEN', subcategory: 'Appliances',
    label: 'Appliances', scope: R, appliesTo: ['KITCHEN'],
    options: [
      { id: 'essential', label: 'Hob, oven, extractor', itemKey: null },
      { id: 'full', label: 'Full package including fridge and dishwasher', itemKey: null },
    ],
    defaultChoice: 'NOT_DECIDED',
  },

  /* ---------------- JOINERY / FURNITURE ---------------- */
  {
    id: 'joinery.wardrobes', category: 'FURNITURE', subcategory: 'Fitted',
    label: 'Fitted wardrobes', scope: R, appliesTo: ['BEDROOM', 'HALLWAY'],
    options: [{ id: 'standard', label: 'Fitted wardrobe', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'joinery.loose', category: 'FURNITURE', subcategory: 'Loose',
    label: 'Loose furniture', scope: P,
    hint: 'Usually bought separately, but it belongs in the budget.',
    options: [{ id: 'standard', label: 'Furniture package', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },

  /* ---------------- FINISHING ---------------- */
  {
    id: 'finishing.cleaning', category: 'FINISHING', subcategory: 'Handover',
    label: 'Post-construction cleaning', scope: P,
    options: [{ id: 'standard', label: 'Deep clean', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'finishing.snagging', category: 'FINISHING', subcategory: 'Handover',
    label: 'Snagging and touch-ups', scope: P,
    options: [{ id: 'standard', label: 'Snagging', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },

  /* ---------------- PROFESSIONAL ---------------- */
  {
    id: 'professional.design', category: 'PROFESSIONAL', subcategory: 'Design',
    label: 'Interior design and drawings', scope: P,
    options: [{ id: 'standard', label: 'Design package', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'professional.supervision', category: 'PROFESSIONAL', subcategory: 'Management',
    label: 'Site supervision', scope: P,
    options: [{ id: 'standard', label: 'Supervision', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },
]);

/** Categories in display order. */
export const CATEGORY_ORDER: readonly string[] = Object.freeze([
  'PREPARATION', 'STRUCTURE', 'WALLS', 'CEILINGS', 'FLOORS', 'WATERPROOFING',
  'PLUMBING', 'BATHROOM', 'ELECTRICAL', 'LIGHTING', 'HEATING', 'HVAC',
  'DOORS', 'WINDOWS', 'INSULATION', 'KITCHEN', 'FURNITURE', 'FINISHING',
  'PROFESSIONAL',
]);

/** Nodes that apply given the rooms this property actually has. A bathroom
 * question for a property with no bathroom is noise, and noise is what makes
 * a configurator feel like an admin form. */
export function nodesForRooms(
  rooms: readonly RoomKind[],
  taxonomy: readonly TaxonomyNode[] = TAXONOMY
): TaxonomyNode[] {
  const present = new Set(rooms);
  return taxonomy.filter(
    (n) => n.scope === 'PROPERTY' || (n.appliesTo ?? []).some((r) => present.has(r))
  );
}
