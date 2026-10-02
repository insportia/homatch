// THE PICTURE YOU CAN TOUCH — a render whose objects answer to a tap.
//
// The render's object map (a lossless id image + its legend) says which
// canonical object or surface every pixel shows. Hover (desktop) or tap
// (phone) finds it; editable things get a soft lift and a thin gold edge, the
// rest of the picture is left alone. Keyboard and screen-reader users get the
// same targets as a list. Nothing here edits anything: it reports selections.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { MapEntry, ObjectMap } from '@/lib/designStudio/renders/contract';

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

interface IdPixels { width: number; height: number; data: Uint8ClampedArray }

async function loadIds(url: string): Promise<IdPixels> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ids ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, 0, 0);
  return { width: bmp.width, height: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
}

/** A highlight layer for one target: a soft lift over it and a gold edge around it. */
function paintHighlight(canvas: HTMLCanvasElement, ids: IdPixels, color: string, strong: boolean) {
  const r = parseInt(color.slice(1, 3), 16); const g = parseInt(color.slice(3, 5), 16); const b = parseInt(color.slice(5, 7), 16);
  canvas.width = ids.width; canvas.height = ids.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const out = ctx.createImageData(ids.width, ids.height);
  const at = (x: number, y: number) => {
    const i = (y * ids.width + x) * 4;
    return ids.data[i] === r && ids.data[i + 1] === g && ids.data[i + 2] === b;
  };
  const w = ids.width; const h = ids.height;
  const edge = Math.max(1, Math.round(w / 700));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!at(x, y)) continue;
      let border = false;
      for (let d = 1; d <= edge && !border; d += 1) {
        if (x - d < 0 || x + d >= w || y - d < 0 || y + d >= h || !at(x - d, y) || !at(x + d, y) || !at(x, y - d) || !at(x, y + d)) border = true;
      }
      const i = (y * w + x) * 4;
      if (border) { out.data[i] = 246; out.data[i + 1] = 177; out.data[i + 2] = 52; out.data[i + 3] = 255; } else { out.data[i] = 255; out.data[i + 1] = 255; out.data[i + 2] = 255; out.data[i + 3] = strong ? 46 : 30; }
    }
  }
  ctx.putImageData(out, 0, 0);
}

export function RenderViewer({
  imageUrl, idsUrl, legend, editable, selectedId, onSelect, alt, labelFor, className,
}: {
  imageUrl: string;
  idsUrl: string | null;
  legend: ObjectMap | null;
  /** Which targets may be selected (the rest are part of the scene). */
  editable: (entry: MapEntry) => boolean;
  selectedId: string | null;
  onSelect: (entry: MapEntry | null, at: { x: number; y: number } | null) => void;
  alt: string;
  /** A target's name, for the keyboard list and the hover title. */
  labelFor: (entry: MapEntry) => string;
  className?: string;
}) {
  const [ids, setIds] = useState<IdPixels | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hoverCanvas = useRef<HTMLCanvasElement>(null);
  const selCanvas = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const byColor = useMemo(() => new Map((legend?.entries ?? []).map((e) => [e.color.toLowerCase(), e])), [legend]);
  const byId = useMemo(() => new Map((legend?.entries ?? []).map((e) => [e.id, e])), [legend]);
  const targets = useMemo(() => (legend?.entries ?? []).filter((e) => editable(e) && e.coverage > 0.0008), [legend, editable]);

  useEffect(() => {
    let alive = true;
    setIds(null);
    if (idsUrl) loadIds(idsUrl).then((p) => { if (alive) setIds(p); }).catch(() => {});
    return () => { alive = false; };
  }, [idsUrl]);

  const entryAt = useCallback((clientX: number, clientY: number): MapEntry | null => {
    const img = imgRef.current;
    if (!img || !ids) return null;
    const rect = img.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * ids.width);
    const y = Math.floor(((clientY - rect.top) / rect.height) * ids.height);
    if (x < 0 || y < 0 || x >= ids.width || y >= ids.height) return null;
    const i = (y * ids.width + x) * 4;
    const e = byColor.get(hex(ids.data[i], ids.data[i + 1], ids.data[i + 2]));
    return e && editable(e) ? e : null;
  }, [ids, byColor, editable]);

  useEffect(() => {
    const c = hoverCanvas.current;
    if (!c) return;
    const e = hoverId && hoverId !== selectedId ? byId.get(hoverId) : null;
    if (!e || !ids) { c.width = 1; c.height = 1; return; }
    paintHighlight(c, ids, e.color, false);
  }, [hoverId, selectedId, byId, ids]);
  useEffect(() => {
    const c = selCanvas.current;
    if (!c) return;
    const e = selectedId ? byId.get(selectedId) : null;
    if (!e || !ids) { c.width = 1; c.height = 1; return; }
    paintHighlight(c, ids, e.color, true);
  }, [selectedId, byId, ids]);

  const hover = hoverId ? byId.get(hoverId) : null;

  return (
    <div className={cn('relative', className)} data-testid="render-viewer">
      <div className="relative">
        <img
          ref={imgRef} src={imageUrl} alt={alt} draggable={false}
          className={cn('block h-auto w-full select-none', hover ? 'cursor-pointer' : '')}
          onPointerMove={(ev) => { if (ev.pointerType === 'mouse') setHoverId(entryAt(ev.clientX, ev.clientY)?.id ?? null); }}
          onPointerLeave={() => setHoverId(null)}
          onClick={(ev) => {
            const e = entryAt(ev.clientX, ev.clientY);
            const rect = (ev.currentTarget as HTMLImageElement).getBoundingClientRect();
            onSelect(e, e ? { x: (ev.clientX - rect.left) / rect.width, y: (ev.clientY - rect.top) / rect.height } : null);
          }}
          title={hover ? labelFor(hover) : undefined}
        />
        <canvas ref={hoverCanvas} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
        <canvas ref={selCanvas} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
      </div>
      {targets.length ? (
        <ul className="sr-only" aria-label={alt}>
          {targets.map((e) => (
            <li key={e.id}>
              <button type="button" aria-pressed={selectedId === e.id} onClick={() => onSelect(e, { x: (e.box[0] + e.box[2]) / 2, y: (e.box[1] + e.box[3]) / 2 })}>{labelFor(e)}</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
