// EMAIL STUDIO — pointer drag & drop for the designer (palette → canvas, canvas → canvas).
//
// Pointer events (mouse, pen and touch alike), not the HTML5 drag API: the drop place is computed
// from the real canvas DOM under the pointer. Containers carry data-container (root, a section,
// one column) and their blocks data-block-id; the place is the container under the pointer and
// the index of the first sibling whose middle lies below it. A place the format cannot hold
// (tree.ts canContain, or into the dragged block itself) climbs to the enclosing container,
// before or after the block that owns it. Over anything outside the canvas (a panel, a sheet, the
// toolbar) there is no place, and letting go there cancels. Escape cancels; the viewport scrolls
// near its edges.
// Keyboard users never need this: every move also exists as a command (Layers panel, Alt+↑/↓).

import { useCallback, useEffect, useRef, useState } from 'react';
import { type Block, type BlockType, createBlock } from '@/emailMarketing/designer/document';
import { canContain, type ContainerKey, findBlock, type Place, ROOT, subtreeIds } from '@/emailMarketing/designer/tree';

export type DragPayload =
  | { kind: 'new'; type: BlockType; label: string }
  | { kind: 'section'; block: Block; label: string }
  | { kind: 'move'; ids: string[]; label: string };

export interface DropIndicator { left: number; top: number; width: number; vertical?: false }
export interface DragState { payload: DragPayload; x: number; y: number; place: Place | null; line: DropIndicator | null }

const THRESHOLD = 5;

export function useBlockDrag({ blocks, viewport, onDrop }: {
  blocks: Block[];
  viewport: React.RefObject<HTMLElement | null>;
  onDrop: (payload: DragPayload, place: Place) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const pending = useRef<{ payload: DragPayload; x: number; y: number; id: number } | null>(null);
  const live = useRef<DragState | null>(null);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const sample = (payload: DragPayload): Block[] => {
    if (payload.kind === 'new') return [createBlock(payload.type)];
    if (payload.kind === 'section') return [payload.block];
    return payload.ids.map((id) => findBlock(blocksRef.current, id)).filter((b): b is Block => Boolean(b));
  };

  const resolve = useCallback((payload: DragPayload, x: number, y: number): { place: Place; line: DropIndicator } | null => {
    const root = viewport.current;
    if (!root) return null;
    const items = sample(payload);
    if (!items.length) return null;
    const forbidden = new Set(payload.kind === 'move' ? items.flatMap(subtreeIds) : []);
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    /* Outside the canvas: no place (dropping on a panel must not move the block to the top level). */
    if (!el || !root.contains(el)) return null;
    /* Space inside the canvas but outside every container (below the last block) means the email
       itself: the top level, at the position the pointer is level with. */
    let container = el.closest<HTMLElement>('[data-container]') ?? root.querySelector<HTMLElement>('[data-container="root"]');
    /* Beside the email (the gutter with the handle, the margin): the deepest container at that
       height — of side-by-side columns, the nearer one. A finger on the handle moves straight down
       the gutter; without this every such drag went to the top level, and nothing inside a section
       could be reordered on a phone. */
    const card = root.querySelector<HTMLElement>('.hm-canvas-card');
    if (card && (!card.contains(el) || el.closest('[data-rail]'))) {
      const level = Array.from(card.querySelectorAll<HTMLElement>('[data-container]')).filter((c) => {
        const r = c.getBoundingClientRect();
        return r.height > 0 && y >= r.top && y <= r.bottom;
      });
      const deepest = level.filter((c) => !level.some((o) => o !== c && c.contains(o)));
      const gap = (c: HTMLElement) => { const r = c.getBoundingClientRect(); return x < r.left ? r.left - x : x > r.right ? x - r.right : 0; };
      const nearest = deepest.sort((a, b) => gap(a) - gap(b))[0];
      if (nearest) container = nearest;
    }
    while (container) {
      const key = container.dataset.container as ContainerKey;
      const owner = key === ROOT ? null : key.split(':')[1];
      const ok = !(owner && forbidden.has(owner)) && items.every((b) => canContain(key, b));
      if (ok) {
        const kids = Array.from(container.querySelectorAll<HTMLElement>(':scope > [data-block-id]'));
        let index = kids.length;
        for (let i = 0; i < kids.length; i += 1) {
          const r = kids[i].getBoundingClientRect();
          if (y < r.top + r.height / 2) { index = i; break; }
        }
        const cr = container.getBoundingClientRect();
        const top = kids.length === 0 ? cr.top + Math.min(cr.height / 2, 12)
          : index < kids.length ? kids[index].getBoundingClientRect().top : kids[kids.length - 1].getBoundingClientRect().bottom;
        return { place: { container: key, index }, line: { left: cr.left + 2, width: Math.max(24, cr.width - 4), top } };
      }
      /* Climb: to the container that holds the owner block. */
      const ownerEl = container.closest<HTMLElement>('[data-block-id]');
      container = ownerEl?.parentElement?.closest<HTMLElement>('[data-container]') ?? null;
    }
    return null;
  }, [viewport]);

  const end = useCallback((commit: boolean) => {
    const d = live.current;
    live.current = null;
    pending.current = null;
    setDrag(null);
    document.body.style.removeProperty('user-select');
    if (commit && d?.place) onDropRef.current(d.payload, d.place);
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.id) return;
      if (!live.current && Math.hypot(e.clientX - p.x, e.clientY - p.y) < THRESHOLD) return;
      e.preventDefault();
      document.body.style.setProperty('user-select', 'none');
      /* Near an edge, scroll: the canvas box when it scrolls itself (desktop), else the page (phone). */
      const vp = viewport.current;
      /* Only a box that REALLY overflows scrolls itself (a pixel of rounding must not move the
         email under the pointer), and the edge zone never covers more than a fifth of it. */
      const boxScrolls = Boolean(vp && vp.scrollHeight - vp.clientHeight > 8);
      const top = boxScrolls && vp ? vp.getBoundingClientRect().top : 0;
      const bottom = boxScrolls && vp ? vp.getBoundingClientRect().bottom : window.innerHeight;
      const zone = Math.min(56, (bottom - top) / 5);
      const step = e.clientY < top + zone ? -16 : e.clientY > bottom - zone ? 16 : 0;
      if (step) (boxScrolls && vp ? vp : window).scrollBy({ top: step });
      const hit = resolve(p.payload, e.clientX, e.clientY);
      const next: DragState = { payload: p.payload, x: e.clientX, y: e.clientY, place: hit?.place ?? null, line: hit?.line ?? null };
      live.current = next;
      setDrag(next);
    };
    const up = (e: PointerEvent) => { if (pending.current && e.pointerId === pending.current.id) end(Boolean(live.current)); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && (live.current || pending.current)) { e.preventDefault(); end(false); } };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key, true);
    };
  }, [end, resolve, viewport]);

  /** Arm a drag from a pointerdown; it starts once the pointer has moved a few pixels (a click stays a click). */
  const begin = useCallback((payload: DragPayload, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    pending.current = { payload, x: e.clientX, y: e.clientY, id: e.pointerId };
  }, []);

  return { drag, begin, dragging: Boolean(drag) };
}
