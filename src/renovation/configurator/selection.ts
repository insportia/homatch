// selection.ts — resolving what the customer wants into what can be costed.
//
// The taxonomy (taxonomy.ts) says what can be decided. This says what happens
// to each decision, under one invariant:
//
//   NOT_DECIDED IS NEVER A NUMBER.
//
// An undecided item is not quietly included, which would inflate the budget
// and imply a decision nobody made, and not quietly excluded, which would
// make the renovation look cheaper than it will be. The same applies to work
// the customer genuinely chose that no verified price covers: contributing
// zero for a stretch ceiling reads as "free" rather than "not counted".
//
// Wanting something has never made it costable, so selection and pricing stay
// apart: this resolves intent to price-item keys, and priceBook.ts decides
// whether those keys carry trustworthy numbers.

import type { Tier } from '../calculations/estimate.ts';
import {
  TAXONOMY,
  SEGMENT_TO_TIER,
  nodesForRooms,
  type Choice,
  type Segment,
  type RoomKind,
  type TaxonomyNode,
} from './taxonomy.ts';

export {
  TAXONOMY,
  CATEGORY_ORDER,
  SEGMENT_TO_TIER,
  nodesForRooms,
} from './taxonomy.ts';
export type {
  Choice,
  Segment,
  RoomKind,
  NodeScope,
  TaxonomyNode,
  TaxonomyOption,
} from './taxonomy.ts';

/** One decision. Absent means "untouched", which resolves to the node's own
 * default rather than to silence. */
export interface NodeSelection {
  choice: Choice;
  /** Which option, when the node offers more than one. */
  optionId?: string;
  /** Segment for THIS node only, so premium flooring can sit beside economy
   * paint in the same project. */
  segment?: Segment;
  /** Which room, for room-scoped nodes. */
  room?: RoomKind;
}

/** Keyed by node id, or `${nodeId}@${room}` for room-scoped decisions. */
export type SelectionMap = Record<string, NodeSelection>;

export const roomKey = (nodeId: string, room?: RoomKind) => (room ? `${nodeId}@${room}` : nodeId);

export interface ResolvedSelection {
  /** The only keys an estimate may include. */
  includedItemKeys: string[];
  itemTierOverrides: Record<string, Tier>;
  excluded: { id: string; label: string }[];
  /** Chosen, real, and not in the total because nothing can price it yet. */
  selectedButNotPriced: { id: string; label: string; optionLabel: string }[];
  undecided: { id: string; label: string }[];
  /** The total is only final when nothing is undecided and nothing selected
   * is unpriceable. The UI must not present it as final otherwise. */
  isComplete: boolean;
}

function optionFor(node: TaxonomyNode, sel: NodeSelection | undefined) {
  if (sel?.optionId) {
    const hit = node.options.find((o) => o.id === sel.optionId);
    if (hit) return hit;
  }
  return node.options[0] ?? null;
}

/**
 * Turn decisions into something the estimate engine can use.
 *
 * Three outcomes stay strictly apart, because collapsing any two of them is
 * how a renovation budget starts lying:
 *
 *   included             -> in the total
 *   excluded             -> not in the total, and the customer said so
 *   undecided / unpriced -> not in the total, and the customer is TOLD
 */
export function resolveSelection(
  selection: SelectionMap,
  taxonomy: readonly TaxonomyNode[] = TAXONOMY,
  rooms?: readonly RoomKind[]
): ResolvedSelection {
  const nodes = rooms ? nodesForRooms(rooms, taxonomy) : taxonomy;

  const includedItemKeys: string[] = [];
  const itemTierOverrides: Record<string, Tier> = {};
  const excluded: { id: string; label: string }[] = [];
  const selectedButNotPriced: { id: string; label: string; optionLabel: string }[] = [];
  const undecided: { id: string; label: string }[] = [];

  for (const node of nodes) {
    // A room-scoped node is decided once per room it applies to, so a tiled
    // bathroom floor and a laminate bedroom floor are two real decisions
    // rather than one averaged one.
    const targets: (RoomKind | undefined)[] =
      node.scope === 'ROOM' && rooms
        ? (node.appliesTo ?? []).filter((r) => rooms.includes(r))
        : [undefined];

    for (const room of targets.length ? targets : [undefined]) {
      const key = roomKey(node.id, room);
      const sel = selection[key] ?? selection[node.id];
      const choice: Choice = sel?.choice ?? node.defaultChoice;
      const label = room ? `${node.label} (${room.toLowerCase()})` : node.label;

      if (choice === 'EXCLUDE') {
        excluded.push({ id: key, label });
        continue;
      }
      if (choice === 'NOT_DECIDED') {
        undecided.push({ id: key, label });
        continue;
      }

      const option = optionFor(node, sel);
      if (!option) {
        undecided.push({ id: key, label });
        continue;
      }
      if (!option.itemKey) {
        selectedButNotPriced.push({ id: key, label, optionLabel: option.label });
        continue;
      }

      includedItemKeys.push(option.itemKey);
      if (sel?.segment) itemTierOverrides[option.itemKey] = SEGMENT_TO_TIER[sel.segment];
    }
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

/** Every node at its own default, which deliberately leaves the expensive
 * unpriceable decisions undecided rather than guessing for the customer. */
export function defaultSelection(
  taxonomy: readonly TaxonomyNode[] = TAXONOMY,
  rooms?: readonly RoomKind[]
): SelectionMap {
  const nodes = rooms ? nodesForRooms(rooms, taxonomy) : taxonomy;
  const out: SelectionMap = {};
  for (const n of nodes) {
    const targets: (RoomKind | undefined)[] =
      n.scope === 'ROOM' && rooms
        ? (n.appliesTo ?? []).filter((r) => rooms.includes(r))
        : [undefined];
    for (const room of targets.length ? targets : [undefined]) {
      out[roomKey(n.id, room)] = { choice: n.defaultChoice, optionId: n.options[0]?.id, room };
    }
  }
  return out;
}

export function taxonomyNode(id: string, taxonomy: readonly TaxonomyNode[] = TAXONOMY) {
  return taxonomy.find((n) => n.id === id) ?? null;
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
