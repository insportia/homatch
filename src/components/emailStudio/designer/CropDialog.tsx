// EMAIL STUDIO — crop an image before it is uploaded (designer image blocks, gallery, video thumbnail).
//
// A frame over the picture: drag inside it to move, drag the corner to resize, or pick an aspect
// ratio. Arrow keys move the frame (Shift: resize) for keyboard users. "Use as is" skips cropping.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { type CropRect, imageSize } from './imageTools';

const ASPECTS: Array<{ key: string; r: number | null }> = [
  { key: 'free', r: null }, { key: '16_9', r: 16 / 9 }, { key: '4_3', r: 4 / 3 }, { key: '1_1', r: 1 }, { key: '3_4', r: 3 / 4 },
];
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

export function CropDialog({ file, onCancel, onDone }: { file: File | null; onCancel: () => void; onDone: (rect: CropRect | null) => void }) {
  const { t } = useLanguage();
  const url = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [rect, setRect] = useState<CropRect>({ x: 0, y: 0, w: 1, h: 1 });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'move' | 'size'; px: number; py: number; r: CropRect } | null>(null);

  useEffect(() => {
    setRect({ x: 0, y: 0, w: 1, h: 1 }); setAspect(null); setNatural(null);
    if (file) void imageSize(file).then(setNatural).catch(() => setNatural(null));
  }, [file]);

  /* Aspect in IMAGE pixels → fractions: h/w fraction ratio = (w_px/h_px) / aspect. */
  const fit = (r: CropRect, a: number | null, anchor: 'center' | 'topleft' = 'center'): CropRect => {
    if (!a || !natural) return r;
    const k = natural.width / natural.height / a;
    let w = r.w, h = w * k;
    if (h > 1) { h = 1; w = h / k; }
    if (anchor === 'center') return { x: clamp(r.x + (r.w - w) / 2, 0, 1 - w), y: clamp(r.y + (r.h - h) / 2, 0, 1 - h), w, h };
    return { x: clamp(r.x, 0, 1 - w), y: clamp(r.y, 0, 1 - h), w, h };
  };

  const onDown = (mode: 'move' | 'size') => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { mode, px: e.clientX, py: e.clientY, r: rect };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; const el = box.current;
    if (!d || !el) return;
    const bw = el.clientWidth, bh = el.clientHeight;
    const dx = (e.clientX - d.px) / bw, dy = (e.clientY - d.py) / bh;
    if (d.mode === 'move') setRect({ ...d.r, x: clamp(d.r.x + dx, 0, 1 - d.r.w), y: clamp(d.r.y + dy, 0, 1 - d.r.h) });
    else {
      const w = clamp(d.r.w + dx, 0.05, 1 - d.r.x), h = clamp(d.r.h + dy, 0.05, 1 - d.r.y);
      setRect(fit({ ...d.r, w, h }, aspect, 'topleft'));
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = 0.02;
    const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!k) return;
    e.preventDefault();
    setRect((r) => (e.shiftKey
      ? fit({ ...r, w: clamp(r.w + k[0], 0.05, 1 - r.x), h: clamp(r.h + k[1], 0.05, 1 - r.y) }, aspect, 'topleft')
      : { ...r, x: clamp(r.x + k[0], 0, 1 - r.w), y: clamp(r.y + k[1], 0, 1 - r.h) }));
  };
  const px = natural ? `${Math.round(rect.w * natural.width)} × ${Math.round(rect.h * natural.height)} px` : '';

  return (
    <Dialog open={Boolean(file)} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('ems_b_crop_title')}</DialogTitle>
          <DialogDescription>{t('ems_b_crop_sub')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('ems_b_crop_aspect')}>
          {ASPECTS.map((a) => (
            <button key={a.key} type="button" aria-pressed={aspect === a.r}
              onClick={() => { setAspect(a.r); setRect((r) => fit(a.r ? { x: 0, y: 0, w: 1, h: 1 } : r, a.r)); }}
              className={cn('h-7 rounded-md border px-2.5 text-xs', aspect === a.r ? 'border-transparent bg-[#0C1119] text-white' : 'text-muted-foreground hover:text-foreground')}>
              {t(`ems_b_crop_${a.key}`)}
            </button>
          ))}
          <span className="ms-auto self-center text-2xs text-muted-foreground" dir="ltr">{px}</span>
        </div>
        <div className="flex justify-center rounded-lg bg-[repeating-conic-gradient(#eee_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-2">
          <div ref={box} className="relative inline-block max-w-full touch-none select-none" onPointerMove={onMove} onPointerUp={() => { drag.current = null; }}>
            {url ? <img src={url} alt="" className="block max-h-[55dvh] max-w-full" draggable={false} /> : null}
            <div
              role="slider" tabIndex={0} aria-label={t('ems_b_crop_frame')} aria-valuetext={px} onKeyDown={onKey} onPointerDown={onDown('move')}
              className="absolute cursor-move outline-none ring-2 ring-white focus-visible:ring-[hsl(38_85%_55%)]"
              style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%`, boxShadow: '0 0 0 9999px rgba(12,17,25,0.55)' }}
            >
              <span className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                {Array.from({ length: 9 }, (_, i) => <span key={i} className="border border-white/25" />)}
              </span>
              <span onPointerDown={onDown('size')} aria-hidden="true"
                className="absolute -bottom-2 -end-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-[hsl(38_85%_52%)]" />
            </div>
          </div>
        </div>
        <p className="text-2xs text-muted-foreground">{t('ems_b_crop_keys')}</p>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={onCancel}>{t('ems_b_cancel')}</Button>
          <Button type="button" variant="outline" onClick={() => onDone(null)}>{t('ems_b_crop_skip')}</Button>
          <Button type="button" onClick={() => onDone(rect.w > 0.995 && rect.h > 0.995 ? null : rect)}>{t('ems_b_crop_apply')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
