import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImageUp, Loader2, Trash2 } from 'lucide-react';

/**
 * CLICK THE PICTURE YOU WANT TO CHANGE.
 *
 * Replacing an image used to mean selecting the section, finding the media
 * control in the sidebar's form, and knowing which of "photo", "plate" and
 * "backdrop" was the one on screen. On a section with more than one image
 * that is a guess, and a guess that is only revealed after the upload.
 *
 * So the picture itself is the control. Clicking one anchors this toolbar to
 * it, and the toolbar acts on THAT slot — the one under the pointer, named by
 * the element rather than inferred from a form.
 *
 * It is portalled into the preview document for the same reason the section
 * controls are: the page lives in an iframe, so its own coordinates are the
 * only ones that stay correct when anything scrolls.
 */

/**
 * Which picture is selected — by identity, never by element.
 *
 * Selecting a picture also selects its section, which re-renders it, and
 * React may replace the DOM node in the process. A held element reference
 * is disconnected the instant it is used, and the toolbar vanished on the
 * same click that summoned it. The identity survives; the element is
 * looked up again whenever it is needed.
 */
export interface MediaTarget {
  sectionId: string;
  slot: string;
}

export interface MediaControlsProps {
  body: HTMLElement | null;
  target: MediaTarget | null;
  /** Bumped when the page re-renders, so the anchor is found again. */
  revision: unknown;
  busy: boolean;
  /** Whether this slot currently has a replacement to remove. */
  hasOverride: boolean;
  labels: { replace: string; uploading: string; remove: string };
  onReplace: () => void;
  onRemove: () => void;
}

export function MediaControls({
  body, target, revision, busy, hasOverride, labels, onReplace, onRemove,
}: MediaControlsProps) {
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);

  // Re-found on every render of the page, not remembered from the click.
  const el = body && target
    ? body.querySelector<HTMLElement>(
      `[data-hm-section="${target.sectionId}"][data-hm-media="${target.slot}"]`,
    )
    : null;

  const measure = useCallback(() => {
    if (!el) { setBox(null); return; }
    const r = el.getBoundingClientRect();
    // Inside the image's top-left, so it never sits off the edge of a
    // full-bleed photograph or over the section's own controls above it.
    setBox({ top: Math.max(r.top + 10, 8), left: Math.max(r.left + 10, 8) });
  }, [el]);

  useEffect(() => {
    measure();
    if (!el) return;
    const win = el.ownerDocument.defaultView;
    if (!win) return;
    win.addEventListener('scroll', measure, true);
    win.addEventListener('resize', measure);
    const ro = new win.ResizeObserver(measure);
    ro.observe(el);
    return () => {
      win.removeEventListener('scroll', measure, true);
      win.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, [el, measure, revision]);

  if (!body || !target || !el || !box) return null;

  const btn = 'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium '
    + 'text-white/90 transition-colors hover:bg-white/15 hover:text-white '
    + 'disabled:pointer-events-none disabled:opacity-40';

  return createPortal(
    <div
      data-studio-ui
      role="toolbar"
      aria-label={labels.replace}
      style={{ position: 'fixed', top: box.top, left: box.left, zIndex: 2147483000 }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className={
        'flex items-center gap-0.5 rounded-lg border border-white/10 '
        + 'bg-[hsl(0_0%_8%/0.94)] p-1 shadow-[0_8px_24px_hsl(0_0%_0%/0.35)] backdrop-blur-sm'
      }
    >
      <button type="button" className={btn} onClick={onReplace} disabled={busy}>
        {busy
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          : <ImageUp className="h-3.5 w-3.5" aria-hidden="true" />}
        {busy ? labels.uploading : labels.replace}
      </button>

      {/* Only offered when there is an override to remove. Removing falls back
          to the photograph the code ships, so nothing is ever left empty. */}
      {hasOverride && !busy && (
        <button
          type="button"
          className={`${btn} text-red-300 hover:bg-red-500/25 hover:text-red-200`}
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          {labels.remove}
        </button>
      )}
    </div>,
    body,
  );
}

/**
 * Which marked image, if any, a click landed on.
 *
 * Exported so the preview can wire it to a listener and so it can be tested
 * without a browser.
 */
export function mediaTargetFromClick(node: EventTarget | null): MediaTarget | null {
  if (!(node instanceof HTMLElement)) return null;
  const el = node.closest<HTMLElement>('[data-hm-media]');
  if (!el) return null;
  const sectionId = el.getAttribute('data-hm-section');
  const slot = el.getAttribute('data-hm-media');
  if (!sectionId || !slot) return null;
  return { sectionId, slot };
}
