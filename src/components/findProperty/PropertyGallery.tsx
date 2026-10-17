import { Building2, ChevronLeft, ChevronRight, ImageOff, Maximize2 } from 'lucide-react';
import { PhotoViewer } from './PhotoViewer';
import React, { useRef, useState } from 'react';
import type { T } from './format';

/*
 * A source can answer an image request with an error, or with a tiny placeholder
 * instead of the photo (hotlink protection: one Home.ge listing showed a black
 * gallery with "1/12" on 2026-10-17). Both count as broken: the counter, arrows
 * and viewer only ever cover photos that really displayed, and a gallery with
 * none shows a branded placeholder instead of an empty black frame.
 */
const MIN_PHOTO_PX = 48;
const isPlaceholder = (img: HTMLImageElement) => img.naturalWidth < MIN_PHOTO_PX || img.naturalHeight < MIN_PHOTO_PX;

/** Only the active photo loads on cards. Controls never activate the property. */
export function PropertyGallery({ images, t, onOpen, full = false, overlay }: { images: string[]; t: T; onOpen?: () => void; full?: boolean; overlay?: React.ReactNode }) {
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const photos = [...new Set(images.filter(Boolean))];
  // Every photo failed: no counter, no arrows, no viewer — the branded placeholder only.
  const allBroken = photos.length > 0 && photos.every((src) => broken.has(src));
  const [index, setIndex] = useState(0);
  const markBroken = (src: string) => setBroken((current) => (current.has(src) ? current : new Set([...current, src])));
  const touch = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const active = Math.min(index, Math.max(0, photos.length - 1));
  const change = (delta: number) => setIndex((current) => (current + delta + photos.length) % photos.length);
  const [viewer, setViewer] = useState(false);
  const viewable = photos.filter((src) => !broken.has(src));
  const openViewer = () => { if (viewable.length) setViewer(true); };
  // The full page has no other target for a photo click: it opens the viewer.
  const activate = onOpen ?? (full ? openViewer : undefined);
  return <div className="space-y-2">
    <div role="group" aria-label={t('mps_photos')} className={`group relative touch-pan-y overflow-hidden bg-[#0C1119] ${full ? 'aspect-[16/9] rounded-2xl' : 'aspect-[16/10]'}`}
      onKeyDown={(event) => { if (photos.length > 1 && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); change(event.key === 'ArrowRight' ? 1 : -1); } }}
      onTouchStart={(event) => { const start = event.touches[0]; touch.current = start ? { x: start.clientX, y: start.clientY } : null; suppressClick.current = false; }}
      onTouchEnd={(event) => {
        const end = event.changedTouches[0];
        if (touch.current && end) {
          const dx = end.clientX - touch.current.x, dy = end.clientY - touch.current.y;
          if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) && photos.length > 1) {
            suppressClick.current = true;
            change(dx < 0 ? 1 : -1);
          }
        }
        touch.current = null;
      }}>
      <button type="button" disabled={!activate} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } activate?.(); }} aria-label={onOpen ? t('fpw_open_gallery') : t('mps_photo_fullscreen')}
        className="absolute inset-0 grid h-full w-full place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        {photos[active] && !broken.has(photos[active]) ? <>
          <span className="absolute inset-0 grid place-items-center" aria-hidden="true"><Building2 className="h-10 w-10 text-white/20 motion-safe:animate-pulse" /></span>
          <img key={photos[active]} src={photos[active]} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className={`relative h-full w-full ${full ? 'object-contain' : 'object-cover'}`}
            onError={() => markBroken(photos[active])} onLoad={(e) => { if (isPlaceholder(e.currentTarget)) markBroken(photos[active]); }} />
        </> : (
          <span className="flex flex-col items-center gap-2 px-4 text-center" data-gallery-empty={allBroken || !photos.length ? 'all' : 'one'}>
            <span className="grid h-14 w-14 place-items-center rounded-full border border-[hsl(var(--gold)/0.35)] bg-white/[0.04]">{photos.length ? <ImageOff className="h-6 w-6 text-[hsl(var(--gold))]" aria-hidden="true" /> : <Building2 className="h-6 w-6 text-[hsl(var(--gold))]" aria-hidden="true" />}</span>
            <span className="text-xs font-medium text-white/70">{t(allBroken || !photos.length ? 'fpv_photos_unavailable' : 'fpv_photo_unavailable')}</span>
          </span>
        )}
      </button>
      {overlay ? <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap items-start gap-1.5 [&>*]:pointer-events-auto">{overlay}</div> : null}
      {viewable.length ? <button type="button" onClick={openViewer} aria-label={t('mps_photo_fullscreen')} data-photo-fullscreen
        className="absolute bottom-2 start-2 grid h-11 w-11 place-items-center rounded-full bg-black/65 text-white focus-visible:ring-2 focus-visible:ring-ring"><Maximize2 className="h-5 w-5" aria-hidden="true" /></button> : null}
      {photos.length > 1 && !allBroken ? <>
        <button type="button" onClick={() => change(-1)} aria-label={t('fpw_previous_photo')} className="absolute start-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white focus-visible:ring-2 focus-visible:ring-ring"><ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" /></button>
        <button type="button" onClick={() => change(1)} aria-label={t('fpw_next_photo')} className="absolute end-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white focus-visible:ring-2 focus-visible:ring-ring"><ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" /></button>
        <span className="absolute bottom-2 end-2 rounded-full bg-black/65 px-2.5 py-1 text-xs text-white" aria-live="polite">{active + 1}/{photos.length}</span>
      </> : null}
    </div>
    {full && photos.length > 1 && !allBroken ? <div className="flex gap-2 overflow-x-auto pb-2" aria-label={t('mps_photos')}>
      {photos.map((src, photoIndex) => <button type="button" key={src} onClick={() => setIndex(photoIndex)} aria-label={t('fpw_photo', { n: photoIndex + 1 })} aria-pressed={active === photoIndex} className={`h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2 focus-visible:ring-2 focus-visible:ring-ring ${active === photoIndex ? 'border-[hsl(var(--gold))]' : 'border-transparent'}`}>
        {broken.has(src) ? <span className="grid h-full w-full place-items-center bg-[#0C1119]"><ImageOff className="h-5 w-5 text-white/40" aria-hidden="true" /></span>
          : <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => markBroken(src)} onLoad={(e) => { if (isPlaceholder(e.currentTarget)) markBroken(src); }} />}
      </button>)}
    </div> : null}
    {viewer ? <PhotoViewer photos={viewable} start={Math.max(0, viewable.indexOf(photos[active]))} t={t} onClose={() => setViewer(false)} /> : null}
  </div>;
}
