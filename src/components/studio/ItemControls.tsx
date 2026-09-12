import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Copy, Plus, Trash2 } from 'lucide-react';
import { FIELD_ATTR } from '@/site/content';

/**
 * THE CONTROLS ON EACH CARD OF THE SELECTED BLOCK.
 *
 * The inspector's list can already reorder and delete them. This is the same
 * set of actions on the card itself, for the same reason the section strip
 * exists: arranging a page should not mean reading a list on the right and
 * working out which row is the thing under the cursor.
 *
 * Portalled INTO the preview document, like the section strip — see
 * SectionControls for why a toolbar in the editor's own document cannot
 * follow an element inside an iframe without drifting.
 *
 * ONLY FOR THE SELECTED SECTION
 *
 * A page can hold several of these blocks, and every card on all of them
 * carrying a floating toolbar would be a page of toolbars. Selection is
 * already how an admin says which block they are working on.
 */

export interface ItemControlsApi {
  sectionId: string;
  /** In render order, which is the order these controls move things within. */
  itemIds: readonly string[];
  /** False once the block is at the size its design supports. */
  canAdd: boolean;
  labels: {
    add: string; up: string; down: string; duplicate: string; remove: string;
  };
  onAddAfter: (itemId: string) => void;
  onMove: (itemId: string, delta: number) => void;
  onDuplicate: (itemId: string) => void;
  onRemove: (itemId: string) => void;
}

interface Spot { id: string; top: number; right: number }

/**
 * Where each card currently is, in the preview's coordinate space.
 *
 * Measured together rather than per card: one scroll listener and one
 * observer for the whole block, instead of a dozen of each.
 */
function useItemSpots(
  body: HTMLElement | null, api: ItemControlsApi | null, revision: unknown,
): Spot[] {
  const [spots, setSpots] = useState<Spot[]>([]);
  const ids = api?.itemIds.join(',') ?? '';
  const sectionId = api?.sectionId ?? '';

  const measure = useCallback(() => {
    if (!body || !sectionId || !ids) { setSpots([]); return; }
    const win = body.ownerDocument.defaultView;
    if (!win) return;

    const next: Spot[] = [];
    for (const id of ids.split(',')) {
      const el = body.querySelector<HTMLElement>(
        `[${FIELD_ATTR.section}="${sectionId}"][${FIELD_ATTR.itemRoot}="${id}"]`,
      );
      if (!el) continue;
      const r = el.getBoundingClientRect();
      // Off the top or bottom of the previewed viewport: no control to draw,
      // and drawing one would pile every off-screen card's toolbar at an edge.
      if (r.bottom < 8 || r.top > win.innerHeight - 8) continue;
      next.push({ id, top: Math.max(r.top + 6, 6), right: Math.max(win.innerWidth - r.right + 6, 6) });
    }
    setSpots(next);
  }, [body, sectionId, ids]);

  useEffect(() => {
    if (!body) { setSpots([]); return; }
    const win = body.ownerDocument.defaultView;
    if (!win) return;

    /*
     * A frame later, not now.
     *
     * This runs on the render that changed the draft, and the preview is a
     * portal into another document — the cards have not been laid out at
     * their new positions yet. Measuring here would place every toolbar
     * where its card used to be, which is most visible on exactly the
     * action that needs it: moving one.
     */
    const raf = win.requestAnimationFrame(measure);

    // Captured: the scrolling element is inside the document, so a listener
    // on the window alone would never hear it.
    win.addEventListener('scroll', measure, true);
    win.addEventListener('resize', measure);
    // The cards change height as their text is edited.
    const ro = new win.ResizeObserver(measure);
    ro.observe(body);
    return () => {
      win.cancelAnimationFrame(raf);
      win.removeEventListener('scroll', measure, true);
      win.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, [body, measure, revision]);

  return spots;
}

export function ItemControls({
  body, api, revision,
}: {
  body: HTMLElement | null;
  api: ItemControlsApi | null;
  /** Re-measure when the draft changes: cards move, grow and disappear. */
  revision: unknown;
}) {
  const spots = useItemSpots(body, api, revision);

  if (!body || !api || spots.length === 0) return null;

  const btn = 'grid h-6 w-6 place-items-center rounded text-white/85 transition-colors '
    + 'hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-35';

  return createPortal(
    <>
      {spots.map(spot => {
        const at = api.itemIds.indexOf(spot.id);
        return (
          <div
            key={spot.id}
            style={{ position: 'fixed', top: spot.top, right: spot.right, zIndex: 2147482000 }}
            // The preview is click-to-select, and the cards are editable text.
            // A press on this toolbar is neither.
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            role="toolbar"
            aria-label={api.labels.duplicate}
            className={
              'flex items-center gap-0.5 rounded-md border border-white/10 '
              + 'bg-[hsl(0_0%_8%/0.9)] p-0.5 shadow-[0_4px_14px_hsl(0_0%_0%/0.3)] backdrop-blur-sm'
            }
          >
            <button
              type="button" className={btn} disabled={at <= 0}
              onClick={() => api.onMove(spot.id, -1)}
              title={api.labels.up} aria-label={api.labels.up}
            >
              <ChevronUp className="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              type="button" className={btn} disabled={at === api.itemIds.length - 1}
              onClick={() => api.onMove(spot.id, 1)}
              title={api.labels.down} aria-label={api.labels.down}
            >
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              type="button" className={btn} disabled={!api.canAdd}
              onClick={() => api.onAddAfter(spot.id)}
              title={api.labels.add} aria-label={api.labels.add}
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              type="button" className={btn} disabled={!api.canAdd}
              onClick={() => api.onDuplicate(spot.id)}
              title={api.labels.duplicate} aria-label={api.labels.duplicate}
            >
              <Copy className="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`${btn} text-red-300 hover:bg-red-500/25 hover:text-red-200`}
              onClick={() => api.onRemove(spot.id)}
              title={api.labels.remove} aria-label={api.labels.remove}
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </>,
    body,
  );
}
