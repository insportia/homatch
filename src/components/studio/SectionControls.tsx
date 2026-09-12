import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown, ChevronUp, Copy, Eye, EyeOff, Pencil, Plus, Trash2,
} from 'lucide-react';

/**
 * THE CONTROLS THAT FLOAT ON THE SELECTED SECTION.
 *
 * The structure list can already reorder and hide. This is the same set of
 * actions where the admin is actually looking — on the block itself — so
 * building a page does not mean reading a list on the left to work out which
 * row is the thing under the cursor.
 *
 * WHY IT IS PORTALLED INTO THE PREVIEW DOCUMENT
 *
 * The page renders inside an iframe, so it has its own coordinate space. A
 * toolbar in the editor's document would need the iframe's offset, its
 * scroll position and its zoom folded into every measurement, and would drift
 * the moment any of the three changed. Portalled INTO the iframe, the
 * section's own getBoundingClientRect is already the right answer, and
 * `position: fixed` there means fixed to the previewed viewport — which is
 * what "stays on the section's top edge while you scroll" actually requires.
 *
 * The preview's stylesheets are cloned into that document, so these classes
 * resolve exactly as they do in the editor.
 */

export interface SectionControlsApi {
  /** Reordering is bounded by the ends of the page. */
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Only repeatable blocks can be copied or deleted. */
  repeatable: boolean;
  enabled: boolean;
  /** What "add below" will insert, named so it is not a surprise. */
  addLabel: string;
  labels: {
    edit: string; addBelow: string; moveUp: string; moveDown: string;
    duplicate: string; hide: string; show: string; delete: string;
  };
  onEdit: () => void;
  onAddBelow: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
}

interface Box { top: number; left: number; width: number }

/** Follows the section through scrolling, resizing and content changes. */
function useSectionBox(root: HTMLElement | null): Box | null {
  const [box, setBox] = useState<Box | null>(null);

  const measure = useCallback(() => {
    if (!root) { setBox(null); return; }
    const r = root.getBoundingClientRect();
    setBox({ top: r.top, left: r.left, width: r.width });
  }, [root]);

  useEffect(() => {
    measure();
    if (!root) return;
    const win = root.ownerDocument.defaultView;
    if (!win) return;

    // Scroll must be captured: the scrolling element is inside the document,
    // and a listener on the window alone would never hear it.
    win.addEventListener('scroll', measure, true);
    win.addEventListener('resize', measure);
    // The section's own height changes as its text is edited.
    const ro = new win.ResizeObserver(measure);
    ro.observe(root);
    return () => {
      win.removeEventListener('scroll', measure, true);
      win.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, [root, measure]);

  return box;
}

export function SectionControls({
  root, body, api,
}: { root: HTMLElement | null; body: HTMLElement | null; api: SectionControlsApi | null }) {
  const box = useSectionBox(root);

  /*
   * Edit means: arm the mode, then put the caret in this section's
   * first editable string.
   *
   * The focus is deferred a frame because arming the mode is what adds
   * `contenteditable`; focusing in the same tick would run before the
   * edit layer has touched the DOM and would silently do nothing.
   * `[data-studio-field]` is stamped by that layer, so this can only
   * ever land on a field the registry declares.
   */
  const onEditHere = useCallback(() => {
    api?.onEdit();
    const el = root;
    if (!el) return;
    const win = el.ownerDocument.defaultView;
    win?.requestAnimationFrame(() => {
      el.querySelector<HTMLElement>('[data-studio-field]')?.focus();
    });
  }, [api, root]);

  if (!body || !root || !api || !box) return null;

  const btn = 'grid h-7 w-7 place-items-center rounded-md text-white/85 transition-colors '
    + 'hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-35';

  /*
   * Sits just above the section, and tucks INSIDE it when the section starts
   * at the very top of the viewport — otherwise the strip for the first
   * section would be drawn off-screen and be unreachable.
   */
  const top = box.top < 40 ? Math.max(box.top + 8, 8) : box.top - 38;

  const strip = (
    <div
      style={{
        position: 'fixed', top, left: Math.max(box.left + 8, 8),
        maxWidth: `${Math.max(box.width - 16, 120)}px`, zIndex: 2147483000,
      }}
      // The preview is click-to-select; a click on the toolbar is not a click
      // on the page behind it.
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label={api.labels.edit}
      className={
        'flex items-center gap-0.5 overflow-x-auto rounded-lg border border-white/10 '
        + 'bg-[hsl(0_0%_8%/0.94)] p-1 shadow-[0_8px_24px_hsl(0_0%_0%/0.35)] '
        + 'backdrop-blur-sm'
      }
    >
      <button
        type="button" className={btn} onClick={onEditHere}
        title={api.labels.edit} aria-label={api.labels.edit}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span className="mx-0.5 h-4 w-px shrink-0 bg-white/15" aria-hidden="true" />
      <button
        type="button" className={btn} onClick={api.onMoveUp} disabled={!api.canMoveUp}
        title={api.labels.moveUp} aria-label={api.labels.moveUp}
      >
        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button
        type="button" className={btn} onClick={api.onMoveDown} disabled={!api.canMoveDown}
        title={api.labels.moveDown} aria-label={api.labels.moveDown}
      >
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span className="mx-0.5 h-4 w-px shrink-0 bg-white/15" aria-hidden="true" />
      <button
        type="button" className={btn} onClick={api.onToggleEnabled}
        title={api.enabled ? api.labels.hide : api.labels.show}
        aria-label={api.enabled ? api.labels.hide : api.labels.show}
      >
        {api.enabled
          ? <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          : <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      <button
        type="button" className={btn} onClick={api.onAddBelow}
        title={`${api.labels.addBelow} — ${api.addLabel}`} aria-label={api.labels.addBelow}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {/* Copy and delete exist only for the block that can genuinely repeat.
          The designed regions are hidden, never duplicated or destroyed. */}
      {api.repeatable && (
        <>
          <button type="button" className={btn} onClick={api.onDuplicate} title={api.labels.duplicate} aria-label={api.labels.duplicate}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`${btn} text-red-300 hover:bg-red-500/25 hover:text-red-200`}
            onClick={api.onDelete} title={api.labels.delete} aria-label={api.labels.delete}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );

  return createPortal(strip, body);
}
