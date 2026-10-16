import { ChevronLeft, ChevronRight, Minus, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { T } from './format';

const MAX = 5, STEP = 0.5;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Full-screen photo viewer: one photo at a time, at its full resolution.
 * Zoom with + / −, the mouse wheel, a double click or tap, or a pinch;
 * drag to move a zoomed photo; swipe or arrows for the next one; Esc closes.
 */
export function PhotoViewer({ photos, start, t, onClose }: { photos: string[]; start: number; t: T; onClose: () => void }) {
  const [index, setIndex] = useState(start);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const closeRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef(0);

  const reset = () => { setScale(1); setOffset({ x: 0, y: 0 }); };
  const go = useCallback((delta: number) => { setIndex((i) => (i + delta + photos.length) % photos.length); setScale(1); setOffset({ x: 0, y: 0 }); }, [photos.length]);
  const zoom = (next: number) => { const s = clamp(next, 1, MAX); setScale(s); if (s === 1) setOffset({ x: 0, y: 0 }); };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowRight' && photos.length > 1) go(document.dir === 'rtl' ? -1 : 1);
      else if (e.key === 'ArrowLeft' && photos.length > 1) go(document.dir === 'rtl' ? 1 : -1);
      else if (e.key === '+' || e.key === '=') setScale((s) => clamp(s + STEP, 1, MAX));
      else if (e.key === '-') setScale((s) => { const n = clamp(s - STEP, 1, MAX); if (n === 1) setOffset({ x: 0, y: 0 }); return n; });
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; previous?.focus?.(); };
  }, [go, onClose, photos.length]);

  const dist = (a: React.Touch, b: React.Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const button = 'grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] disabled:opacity-40';

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t('mps_photos')} data-photo-viewer className="fixed inset-0 z-[100] flex flex-col bg-black/95 text-white">
      <div className="flex items-center justify-between gap-2 px-3 py-2 sm:px-4">
        <span className="text-sm tabular-nums text-white/80" aria-live="polite">{index + 1}/{photos.length}</span>
        <div className="flex items-center gap-2">
          <button type="button" className={button} onClick={() => zoom(scale - STEP)} disabled={scale <= 1} aria-label={t('mps_photo_zoom_out')}><Minus className="h-5 w-5" aria-hidden="true" /></button>
          <span className="w-12 text-center text-sm tabular-nums text-white/80" data-photo-zoom>{Math.round(scale * 100)}%</span>
          <button type="button" className={button} onClick={() => zoom(scale + STEP)} disabled={scale >= MAX} aria-label={t('mps_photo_zoom_in')}><Plus className="h-5 w-5" aria-hidden="true" /></button>
          <button ref={closeRef} type="button" className={button} onClick={onClose} aria-label={t('mps_photo_close')}><X className="h-5 w-5" aria-hidden="true" /></button>
        </div>
      </div>
      <div className="relative flex-1 touch-none select-none overflow-hidden"
        onWheel={(e) => zoom(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15))}
        onDoubleClick={() => (scale > 1 ? reset() : setScale(2.5))}
        onPointerDown={(e) => { if (e.pointerType === 'mouse' && scale > 1) { drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } }}
        onPointerMove={(e) => { if (drag.current && e.pointerType === 'mouse') setOffset({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y }); }}
        onPointerUp={() => { drag.current = null; }}
        onTouchStart={(e) => {
          if (e.touches.length === 2) { pinch.current = { d: dist(e.touches[0], e.touches[1]), s: scale }; swipe.current = null; return; }
          const p = e.touches[0];
          if (!p) return;
          const now = Date.now();
          if (now - lastTap.current < 300) { lastTap.current = 0; if (scale > 1) reset(); else setScale(2.5); return; }
          lastTap.current = now;
          if (scale > 1) drag.current = { x: p.clientX, y: p.clientY, ox: offset.x, oy: offset.y };
          else swipe.current = { x: p.clientX, y: p.clientY };
        }}
        onTouchMove={(e) => {
          if (pinch.current && e.touches.length === 2) { zoom(pinch.current.s * dist(e.touches[0], e.touches[1]) / pinch.current.d); return; }
          const p = e.touches[0];
          if (drag.current && p) setOffset({ x: drag.current.ox + p.clientX - drag.current.x, y: drag.current.oy + p.clientY - drag.current.y });
        }}
        onTouchEnd={(e) => {
          const p = e.changedTouches[0];
          if (swipe.current && p && photos.length > 1) {
            const dx = p.clientX - swipe.current.x, dy = p.clientY - swipe.current.y;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go((dx < 0 ? 1 : -1) * (document.dir === 'rtl' ? -1 : 1));
          }
          if (e.touches.length < 2) pinch.current = null;
          if (e.touches.length === 0) { drag.current = null; swipe.current = null; }
        }}>
        <img src={photos[index]} alt="" referrerPolicy="no-referrer" draggable={false} data-photo-viewer-image
          className={`absolute inset-0 m-auto max-h-full max-w-full object-contain ${scale > 1 ? 'cursor-grab' : 'cursor-zoom-in'} motion-safe:transition-transform motion-safe:duration-75`}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} />
        {photos.length > 1 ? <>
          <button type="button" className={`${button} absolute start-3 top-1/2 -translate-y-1/2 bg-black/60`} onClick={() => go(-1)} aria-label={t('fpw_previous_photo')}><ChevronLeft className="h-6 w-6 rtl:rotate-180" aria-hidden="true" /></button>
          <button type="button" className={`${button} absolute end-3 top-1/2 -translate-y-1/2 bg-black/60`} onClick={() => go(1)} aria-label={t('fpw_next_photo')}><ChevronRight className="h-6 w-6 rtl:rotate-180" aria-hidden="true" /></button>
        </> : null}
      </div>
      <p className="px-4 py-2 text-center text-xs text-white/60">{t('mps_photo_hint')}</p>
    </div>,
    document.body,
  );
}
