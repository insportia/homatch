// selection.ts — what the customer actually wants done.
//
// WHAT WAS MISSING
//
// The estimate engine already models quantities, six renovation levels, waste
// factors, per-item material tiers and soft costs. What it could not express
// is the customer's own decisions:
//
//   * "I am not replacing the doors."            -> EXCLUDE
//   * "I have not decided about the kitchen."    -> NOT_DECIDED
//   * "Porcelain tile in the bathroom, laminate  -> a CHOICE between mutually
//      everywhere else."                            exclusive materials
//
// Without that, every scenario silently priced everything the property could
// possibly need, at one global level. The total was internally consistent and
// still wrong for the person reading it.
//
// THE INVARIANT THAT MATTERS
//
//   NOT_DECIDED IS NEVER A NUMBER.
//
// An undecided item is not quietly included (which inflates the budget and
// makes it look like a decision was made) and not quietly excluded (which
// makes the renovation look cheaper than it will be). It is carried out of
// the resolver as an explicit list so the customer is told, in the total,
// what the total does not yet cover. A budget that hides its own gaps is the
// renovation equivalent of a clean bill of health from an unchecked registry.
//
// PRICING IS NOT DECIDED HERE
//
// This module resolves intent to price-item keys. Whether those keys have
// trustworthy prices is priceBook.ts's job, and an item whose price is not
// verified must not become a customer-facing number regardless of how
// enthusiastically it was selected. Selection and pricing are kept apart on
// purpose: wanting something has never made it costable.

import type { Tier } from '../calculations/estimate.ts';

export type Choice = 'INCLUDE' | 'EXCLUDE' | 'NOT_DECIDED';

/** One thing a customer can decide about. */
export interface TaxonomyNode {
  /** Stable id used in saved scenarios. Never reuse or renumber. */
  id: string;
  category: string;
  subcategory: string;
  label: string;
  /**
   * Mutually exclusive ways of doing this job. Choosing one selects its
   * price-item key. A node with a single option is a yes/no decision.
   */
  options: {
    id: string;
    label: string;
    /** Price-item key in the price book, or null when this option exists in
     * the taxonomy but has no priced item yet. Such an option can be chosen
     * and planned; it simply cannot be costed, and says so. */
    itemKey: string | null;
  }[];
  /** What happens when the customer has expressed no opinion. Deliberately
   * NOT a silent include: see the invariant above. */
  defaultChoice: Choice;
}

/**
 * The Georgian-market renovation taxonomy.
 *
 * Every option whose `itemKey` is non-null maps onto a real item in the
 * Tbilisi price book. Options with a null key are genuine parts of a
 * renovation that the price book does not cover yet — they are listed rather
 * than hidden, because a configurator that silently omits half a bathroom
 * teaches the customer to trust a number that was never complete.
 */
export const TAXONOMY: readonly TaxonomyNode[] = Object.freeze([
  {
    id: 'demolition',
    category: 'PREPARATION',
    subcategory: 'Demolition and strip-out',
    label: 'Removing what is there now',
    options: [{ id: 'standard', label: 'Strip out and remove', itemKey: 'demolition' }],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'walls.plaster',
    category: 'WALLS',
    subcategory: 'Preparation',
    label: 'Wall levelling and plaster',
    options: [{ id: 'standard', label: 'Plaster and level', itemKey: 'wall.plaster' }],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'walls.finish',
    category: 'WALLS',
    subcategory: 'Finish',
    label: 'Wall finish',
    options: [
      { id: 'paint', label: 'Paint', itemKey: 'wall.paint' },
      { id: 'tile', label: 'Tile', itemKey: 'wall.tile' },
      { id: 'wallpaper', label: 'Wallpaper', itemKey: null },
    ],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'ceilings.finish',
    category: 'CEILINGS',
    subcategory: 'Finish',
    label: 'Ceiling finish',
    options: [
      { id: 'paint', label: 'Paint', itemKey: 'ceiling.paint' },
      { id: 'stretch', label: 'Stretch ceiling', itemKey: null },
      { id: 'plasterboard', label: 'Plasterboard', itemKey: null },
    ],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'floors.screed',
    category: 'FLOORS',
    subcategory: 'Preparation',
    label: 'Floor levelling',
    options: [{ id: 'screed', label: 'Screed and level', itemKey: 'floor.screed' }],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'floors.finish',
    category: 'FLOORS',
    subcategory: 'Finish',
    label: 'Floor covering',
    options: [
      { id: 'laminate', label: 'Laminate', itemKey: 'floor.laminate' },
      { id: 'tile', label: 'Porcelain tile', itemKey: 'floor.tile' },
      { id: 'spc', label: 'SPC / vinyl', itemKey: null },
      { id: 'parquet', label: 'Parquet', itemKey: null },
    ],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'floors.skirting',
    category: 'FLOORS',
    subcategory: 'Finish',
    label: 'Skirting',
    options: [{ id: 'standard', label: 'Skirting boards', itemKey: 'skirting' }],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'bathroom.waterproofing',
    category: 'BATHROOM',
    subcategory: 'Preparation',
    label: 'Bathroom waterproofing',
    options: [{ id: 'standard', label: 'Waterproofing', itemKey: 'bath.waterproofing' }],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'bathroom.sanitary',
    category: 'BATHROOM',
    subcategory: 'Sanitary ware',
    label: 'Toilet, basin, shower or bath',
    options: [
      { id: 'shower', label: 'Shower', itemKey: null },
      { id: 'bath', label: 'Bathtub', itemKey: null },
      { id: 'both', label: 'Both', itemKey: null },
    ],
    // A bathroom fit-out is a real decision with a real cost, and the price
    // book cannot cost it yet. Defaulting it to INCLUDE would put a zero in
    // the budget for something expensive.
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'plumbing.points',
    category: 'PLUMBING',
    subcategory: 'Rough-in',
    label: 'Plumbing connection points',
    options: [{ id: 'standard', label: 'Plumbing points', itemKey: 'plumbing.point' }],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'electrical.points',
    category: 'ELECTRICAL',
    subcategory: 'Rough-in',
    label: 'Sockets, switches and lighting points',
    options: [{ id: 'standard', label: 'Electrical points', itemKey: 'electrical.point' }],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'doors.interior',
    category: 'DOORS',
    subcategory: 'Interior',
    label: 'Interior doors',
    options: [{ id: 'standard', label: 'Interior doors', itemKey: 'door.interior' }],
    defaultChoice: 'INCLUDE',
  },
  {
    id: 'kitchen.units',
    category: 'KITCHEN',
    subcategory: 'Cabinetry',
    label: 'Kitchen units and worktop',
    options: [
      { id: 'flatpack', label: 'Flat-pack', itemKey: null },
      { id: 'made_to_measure', label: 'Made to measure', itemKey: null },
    ],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'appliances',
    category: 'KITCHEN',
    subcategory: 'Appliances',
    label: 'Appliances',
    options: [{ id: 'standard', label: 'Appliance package', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'windows',
    category: 'WINDOWS',
    subcategory: 'Replacement',
    label: 'Windows',
    options: [{ id: 'standard', label: 'Replace windows', itemKey: null }],
    defaultChoice: 'NOT_DECIDED',
  },
  {
    id: 'heating',
    category: 'HEATING',
    subcategory: 'System',
    label: 'Heating',
    options: [
      { id: 'radiators', label: 'Radiators', itemKey: null },
      { id: 'underfloor', label: 'Underfloor heating', itemKey: null },
    ],
    defaultChoice: 'NOT_DECIDED',
  },
]);

/** One decision. Absent from the map means "the customer has not touched it",
 * which resolves to the node's own default rather than to silence. */
export interface NodeSelection {
  choice: Choice;
  /** Which option, when the node offers more than one. */
  optionId?: string;
  /** Segment override for THIS node only, so premium flooring can sit beside
   * economy paint in the same project. */
  tier?: Tier;
}

export type SelectionMap = Record<string, NodeSelection>;

export interface ResolvedSelection {
  /** Price-item keys the customer has actually asked for and that can be
   * costed. These are the only keys an estimate may include. */
  includedItemKeys: string[];
  /** Per-item tier overrides, ready for ScenarioInput. */
  itemTierOverrides: Record<string, Tier>;
  /** Explicitly declined. Reported so the customer can see what the total
   * assumes they are NOT doing. */
  excluded: { id: string; label: string }[];
  /** Chosen, real, and NOT in the total because nothing can price it yet. */
  selectedButNotPriced: { id: string; label: string; optionLabel: string }[];
  /** Undecided. Never in the total, always surfaced. */
  undecided: { id: string; label: string }[];
  /** True when the total is complete: nothing undecided and nothing selected
   * that could not be priced. The UI must not present a total as final
   * unless this is true. */
  isComplete: boolean;
}

const byId = new Map(TAXONOMY.map((n) => [n.id, n]));

export function taxonomyNode(id: string): TaxonomyNode | null {
  return byId.get(id) ?? null;
}

/** The node's chosen option, honouring the default when the customer has said
 * nothing and falling back to the first option when they chose an id that no
 * longer exists (a taxonomy can gain and lose options between saves). */
function optionFor(node: TaxonomyNode, sel: NodeSelection | undefined) {
  if (sel?.optionId) {
    const hit = node.options.find((o) => o.id === sel.optionId);
    if (hit) return hit;
  }
  return node.options[0] ?? null;
}

/**
 * Turn the customer's decisions into something the estimate engine can use.
 *
 * Three outcomes are kept strictly apart, because collapsing any two of them
 * is how a renovation budget starts lying:
 *
 *   included            -> in the total
 *   excluded            -> not in the total, and the customer said so
 *   undecided / unpriced-> not in the total, and the customer is TOLD
 *
 * The third is the one that matters. It is the difference between "your
 * renovation costs X" and "your renovation costs X, and these four things are
 * not in that number yet".
 */
export function resolveSelection(
  selection: SelectionMap,
  taxonomy: readonly TaxonomyNode[] = TAXONOMY
): ResolvedSelection {
  const includedItemKeys: string[] = [];
  const itemTierOverrides: Record<string, Tier> = {};
  const excluded: { id: string; label: string }[] = [];
  const selectedButNotPriced: { id: string; label: string; optionLabel: string }[] = [];
  const undecided: { id: string; label: string }[] = [];

  for (const node of taxonomy) {
    const sel = selection[node.id];
    const choice: Choice = sel?.choice ?? node.defaultChoice;

    if (choice === 'EXCLUDE') {
      excluded.push({ id: node.id, label: node.label });
      continue;
    }
    if (choice === 'NOT_DECIDED') {
      undecided.push({ id: node.id, label: node.label });
      continue;
    }

    const option = optionFor(node, sel);
    if (!option) {
      undecided.push({ id: node.id, label: node.label });
      continue;
    }

    if (!option.itemKey) {
      // Wanted, real, and not costable. Never silently dropped to zero.
      selectedButNotPriced.push({ id: node.id, label: node.label, optionLabel: option.label });
      continue;
    }

    includedItemKeys.push(option.itemKey);
    if (sel?.tier) itemTierOverrides[option.itemKey] = sel.tier;
  }

  return {
    includedItemKeys: [...new Set(includedItemKeys)],
    itemTierOverrides,
    excluded,
    selectedButNotPriced,
    undecided,
    isComplete: undecided.length === 0 && selectedButNotPriced.length === 0,
  };
}

/** The starting point for a new project: every node at its own default, which
 * deliberately leaves the expensive unpriceable decisions undecided rather
 * than guessing on the customer's behalf. */
export function defaultSelection(taxonomy: readonly TaxonomyNode[] = TAXONOMY): SelectionMap {
  const out: SelectionMap = {};
  for (const n of taxonomy) {
    out[n.id] = { choice: n.defaultChoice, optionId: n.options[0]?.id };
  }
  return out;
}

/** Grouped for rendering, in taxonomy order. */
export function groupByCategory(
  taxonomy: readonly TaxonomyNode[] = TAXONOMY
): { category: string; nodes: TaxonomyNode[] }[] {
  const out: { category: string; nodes: TaxonomyNode[] }[] = [];
  for (const n of taxonomy) {
    let g = out.find((x) => x.category === n.category);
    if (!g) {
      g = { category: n.category, nodes: [] };
      out.push(g);
    }
    g.nodes.push(n);
  }
  return out;
}
