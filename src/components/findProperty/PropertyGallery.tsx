import { Building2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef, useState } from 'react';
import type { T } from './format';

/** Only the active photo loads on cards. Controls never activate the property. */
export function PropertyGallery({ images, t, onOpen, full = false }: { images: string[]; t: T; onOpen?: () => void; full?: boolean }) {
  const photos = [...new Set(images.filter(Boolean))];
  const [index, setIndex] = useState(0);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const touch = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const active = Math.min(index, Math.max(0, photos.length - 1));
  const change = (delta: number) => setIndex((current) => (current + delta + photos.length) % photos.length);
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
      <button type="button" disabled={!onOpen} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onOpen?.(); }} aria-label={t('fpw_open_gallery')}
        className="absolute inset-0 grid h-full w-full place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        {photos[active] && !broken.has(photos[active]) ? <img src={photos[active]} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className={`h-full w-full ${full ? 'object-contain' : 'object-cover'}`} onError={() => setBroken((current) => new Set([...current, photos[active]]))} /> : <Building2 className="h-12 w-12 text-white/30" aria-hidden="true" />}
      </button>
      {photos.length > 1 ? <>
        <button type="button" onClick={() => change(-1)} aria-label={t('fpw_previous_photo')} className="absolute start-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white focus-visible:ring-2 focus-visible:ring-ring"><ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" /></button>
        <button type="button" onClick={() => change(1)} aria-label={t('fpw_next_photo')} className="absolute end-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white focus-visible:ring-2 focus-visible:ring-ring"><ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" /></button>
        <span className="absolute bottom-2 end-2 rounded-full bg-black/65 px-2.5 py-1 text-xs text-white" aria-live="polite">{active + 1}/{photos.length}</span>
      </> : null}
    </div>
    {full && photos.length > 1 ? <div className="flex gap-2 overflow-x-auto pb-2" aria-label={t('mps_photos')}>
      {photos.map((src, photoIndex) => <button type="button" key={src} onClick={() => setIndex(photoIndex)} aria-label={t('fpw_photo', { n: photoIndex + 1 })} aria-pressed={active === photoIndex} className={`h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2 focus-visible:ring-2 focus-visible:ring-ring ${active === photoIndex ? 'border-[hsl(var(--gold))]' : 'border-transparent'}`}>
        {broken.has(src) ? <span className="grid h-full w-full place-items-center bg-[#0C1119]"><Building2 className="h-5 w-5 text-white/30" aria-hidden="true" /></span> : <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setBroken((current) => new Set([...current, src]))} />}
      </button>)}
    </div> : null}
  </div>;
}
