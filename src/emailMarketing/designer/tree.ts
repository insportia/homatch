// EMAIL DESIGNER — structural edits on a design's block tree.
//
// A design nests at most two levels: the email's top level holds any block; a section holds
// blocks and column rows (never another section); a column holds content blocks only. Every
// structural action the editor offers — drag to a place, move with the keyboard, duplicate,
// copy/paste, group into a section, ungroup, delete — goes through these pure functions, which
// refuse a placement the format cannot hold (they return null) instead of producing one that
// normalizeDoc would silently drop. Ids are unique across the whole tree, so an id is an address.

import { type Block, cloneBlock, type ColumnsBlock, LIMITS, type LeafBlock, type SectionBlock, walkBlocks } from './document.ts';

/** 'root' | 's:<sectionId>' | 'c:<columnsId>:<0|1>' */
export type ContainerKey = string;
export const ROOT: ContainerKey = 'root';
export const sectionKey = (id: string): ContainerKey => `s:${id}`;
export const columnKey = (id: string, col: 0 | 1): ContainerKey => `c:${id}:${col}`;

export interface Place { container: ContainerKey; index: number }

const isLeaf = (b: Block): b is LeafBlock => b.type !== 'columns' && b.type !== 'section';

/** Whether a block may live in a container. */
export function canContain(container: ContainerKey, b: Block): boolean {
  if (container === ROOT) return true;
  if (container.startsWith('s:')) return b.type !== 'section';
  return isLeaf(b);
}

export function findBlock(blocks: Block[], id: string): Block | null {
  return walkBlocks(blocks).find((b) => b.id === id) ?? null;
}

/** The blocks directly inside a container ([] when it does not exist). */
export function childrenOf(blocks: Block[], container: ContainerKey): Block[] {
  if (container === ROOT) return blocks;
  const [kind, id, col] = container.split(':');
  const owner = findBlock(blocks, id);
  if (kind === 's' && owner?.type === 'section') return owner.children;
  if (kind === 'c' && owner?.type === 'columns') return owner.columns[Number(col) as 0 | 1] ?? [];
  return [];
}

/** Where a block is: its container and index. */
export function locate(blocks: Block[], id: string): Place | null {
  const i = blocks.findIndex((b) => b.id === id);
  if (i >= 0) return { container: ROOT, index: i };
  for (const b of walkBlocks(blocks)) {
    if (b.type === 'section') {
      const j = b.children.findIndex((x) => x.id === id);
      if (j >= 0) return { container: sectionKey(b.id), index: j };
    }
    if (b.type === 'columns') {
      for (const c of [0, 1] as const) {
        const j = b.columns[c].findIndex((x) => x.id === id);
        if (j >= 0) return { container: columnKey(b.id, c), index: j };
      }
    }
  }
  return null;
}

/** The ids of a block and everything inside it. */
export function subtreeIds(b: Block): string[] {
  return walkBlocks([b]).map((x) => x.id);
}

/* Rebuild the tree with one container's children replaced. */
function withChildren(blocks: Block[], container: ContainerKey, next: Block[]): Block[] {
  if (container === ROOT) return next;
  const [kind, id, col] = container.split(':');
  const map = (list: Block[]): Block[] => list.map((b) => {
    if (b.id === id && kind === 's' && b.type === 'section') return { ...b, children: next as SectionBlock['children'] };
    if (b.id === id && kind === 'c' && b.type === 'columns') {
      const cols = [...b.columns] as ColumnsBlock['columns'];
      cols[Number(col) as 0 | 1] = next as LeafBlock[];
      return { ...b, columns: cols };
    }
    if (b.type === 'section') return { ...b, children: map(b.children) as SectionBlock['children'] };
    return b;
  });
  return map(blocks);
}

/** Apply fn to one block wherever it is. */
export function updateBlock(blocks: Block[], id: string, fn: (b: Block) => Block): Block[] {
  const map = (list: Block[]): Block[] => list.map((b) => {
    if (b.id === id) return fn(b);
    if (b.type === 'section') return { ...b, children: map(b.children) as SectionBlock['children'] };
    if (b.type === 'columns') return { ...b, columns: [map(b.columns[0]), map(b.columns[1])] as ColumnsBlock['columns'] };
    return b;
  });
  return map(blocks);
}

export function removeBlocks(blocks: Block[], ids: Iterable<string>): Block[] {
  const drop = new Set(ids);
  const map = (list: Block[]): Block[] => list.filter((b) => !drop.has(b.id)).map((b) => {
    if (b.type === 'section') return { ...b, children: map(b.children) as SectionBlock['children'] };
    if (b.type === 'columns') return { ...b, columns: [map(b.columns[0]), map(b.columns[1])] as ColumnsBlock['columns'] };
    return b;
  });
  return map(blocks);
}

const capOf = (container: ContainerKey) => (container === ROOT ? LIMITS.blocks : container.startsWith('s:') ? LIMITS.sectionChildren : 8);

/** Insert blocks at a place; null when the container cannot hold them or would overflow. */
export function insertBlocks(blocks: Block[], place: Place, items: Block[]): Block[] | null {
  if (!items.length) return blocks;
  if (place.container !== ROOT && !findBlock(blocks, place.container.split(':')[1])) return null;
  if (!items.every((b) => canContain(place.container, b))) return null;
  const list = [...childrenOf(blocks, place.container)];
  if (list.length + items.length > capOf(place.container)) return null;
  list.splice(Math.max(0, Math.min(place.index, list.length)), 0, ...items);
  return withChildren(blocks, place.container, list);
}

/**
 * Move blocks (in their current document order) to a place given in the CURRENT tree's terms:
 * the index counts siblings as they are before the move. A block never moves into itself.
 */
export function moveBlocks(blocks: Block[], ids: string[], place: Place): Block[] | null {
  const items = walkBlocks(blocks).filter((b) => ids.includes(b.id));
  /* Drop the ids that sit inside another moved block: they travel with it. */
  const inner = new Set(items.flatMap((b) => subtreeIds(b).slice(1)));
  const moving = items.filter((b) => !inner.has(b.id));
  if (!moving.length) return blocks;
  const targetOwner = place.container === ROOT ? null : place.container.split(':')[1];
  if (targetOwner && moving.some((b) => subtreeIds(b).includes(targetOwner))) return null;
  const siblings = childrenOf(blocks, place.container);
  const before = siblings.slice(0, place.index).filter((b) => moving.some((m) => m.id === b.id)).length;
  const removed = removeBlocks(blocks, moving.map((b) => b.id));
  return insertBlocks(removed, { container: place.container, index: place.index - before }, moving);
}

/** One step up or down among its siblings. */
export function nudge(blocks: Block[], id: string, dir: -1 | 1): Block[] | null {
  const at = locate(blocks, id);
  if (!at) return null;
  const n = childrenOf(blocks, at.container).length;
  const j = at.index + dir;
  if (j < 0 || j >= n) return null;
  return moveBlocks(blocks, [id], { container: at.container, index: dir === 1 ? j + 1 : j });
}

/** Fresh-id copies inserted right after the last of the originals (same container). */
export function duplicateBlocks(blocks: Block[], ids: string[]): { blocks: Block[]; ids: string[] } | null {
  const sel = walkBlocks(blocks).filter((b) => ids.includes(b.id));
  if (!sel.length) return null;
  const at = locate(blocks, sel[sel.length - 1].id);
  if (!at || !sel.every((b) => locate(blocks, b.id)?.container === at.container)) return null;
  const copies = sel.map((b) => cloneBlock(b));
  const next = insertBlocks(blocks, { container: at.container, index: at.index + 1 }, copies);
  return next ? { blocks: next, ids: copies.map((c) => c.id) } : null;
}

/** Paste: copies of clipboard blocks, at the place if they fit there, else after it at the top level. */
export function pasteBlocks(blocks: Block[], place: Place, clip: Block[]): { blocks: Block[]; ids: string[] } | null {
  const copies = clip.map((b) => cloneBlock(b));
  const here = insertBlocks(blocks, place, copies);
  if (here) return { blocks: here, ids: copies.map((c) => c.id) };
  /* Fall back to the top level, just after the top-level block that holds the place. */
  let idx = blocks.length;
  if (place.container !== ROOT) {
    const owner = place.container.split(':')[1];
    const top = blocks.findIndex((b) => subtreeIds(b).includes(owner));
    if (top >= 0) idx = top + 1;
  } else idx = place.index;
  const root = insertBlocks(blocks, { container: ROOT, index: idx }, copies);
  return root ? { blocks: root, ids: copies.map((c) => c.id) } : null;
}

/** Wrap sibling blocks (same container, not themselves sections) into a new section in their place. */
export function groupIntoSection(blocks: Block[], ids: string[], make: (children: SectionBlock['children']) => SectionBlock): { blocks: Block[]; id: string } | null {
  const places = ids.map((id) => locate(blocks, id));
  if (!places.length || places.some((p) => !p)) return null;
  const container = places[0]!.container;
  if (container !== ROOT || places.some((p) => p!.container !== container)) return null;
  const siblings = childrenOf(blocks, container);
  const members = siblings.filter((b) => ids.includes(b.id));
  if (members.some((b) => b.type === 'section') || members.length > LIMITS.sectionChildren) return null;
  const first = Math.min(...places.map((p) => p!.index));
  const section = make(members as SectionBlock['children']);
  const rest = removeBlocks(blocks, members.map((b) => b.id));
  const next = insertBlocks(rest, { container, index: first }, [section]);
  return next ? { blocks: next, id: section.id } : null;
}

/** Replace a top-level section by its children. */
export function ungroupSection(blocks: Block[], id: string): { blocks: Block[]; ids: string[] } | null {
  const at = locate(blocks, id);
  const s = findBlock(blocks, id);
  if (!at || at.container !== ROOT || s?.type !== 'section') return null;
  const list = [...blocks];
  list.splice(at.index, 1, ...s.children);
  if (list.length > LIMITS.blocks) return null;
  return { blocks: list, ids: s.children.map((c) => c.id) };
}

/** The outline the Layers panel shows: depth-first, with each row's container. */
export interface LayerRow { block: Block; depth: number; container: ContainerKey; index: number; col?: 0 | 1; parentId?: string }
export function layerRows(blocks: Block[]): LayerRow[] {
  const out: LayerRow[] = [];
  const visit = (list: Block[], depth: number, container: ContainerKey, parentId?: string, col?: 0 | 1) => {
    list.forEach((b, index) => {
      out.push({ block: b, depth, container, index, parentId, ...(col != null ? { col } : {}) });
      if (b.type === 'section') visit(b.children, depth + 1, sectionKey(b.id), b.id);
      if (b.type === 'columns') ([0, 1] as const).forEach((c) => visit(b.columns[c], depth + 1, columnKey(b.id, c), b.id, c));
    });
  };
  visit(blocks, 0, ROOT);
  return out;
}

/** Whether a block or any block containing it is locked (locked layers refuse edits and moves). */
export function isLockedPath(blocks: Block[], id: string): boolean {
  for (let cur: string | null = id; cur;) {
    const b = findBlock(blocks, cur);
    if (!b) return false;
    if (b.locked) return true;
    const at = locate(blocks, cur);
    cur = at && at.container !== ROOT ? at.container.split(':')[1] : null;
  }
  return false;
}
