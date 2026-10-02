// HOMATCH's map of where the ads run — CAMPAIGN TARGETS ONLY. Not a tile map
// and not a copy of any ad tool: HOMATCH's own navy-and-gold drawing.
//
//   · Every chosen place is drawn once, numbered in the order of the list.
//   · A city / pin is the real circle Meta will use (radius changes redraw it).
//   · A neighbourhood or region is a marker (Meta draws its own area; no fake
//     radius). A country is a marker on the country (Georgia: its outline).
//   · A place is drawn only where its coordinates are known — Meta's, a pin's,
//     or a known Georgian city. Anything else is listed as "not drawn", never
//     placed at a guessed point.
//   · The view fits all targets; with none, a neutral view and a hint. No
//     device, IP, property or default point ever appears as a target.
//
// Loaded lazily (the outlines are ~40 KB). Pins can be dropped inside Georgia,
// where HOMATCH knows the country of the point it sends.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { LocationChoiceRow } from '@/services/metaAds';
import data from './geo/geoData.json';
import { circleRing, insideRings, placePoint, project, unproject } from './geo/places';
import { mapTargets, type MapBox } from './geo/mapTargets';

type Ring = Array<[number, number]>;
const GEO = data as unknown as { georgia: Ring[]; neighbours: Record<string, Ring[]>; bbox: [number, number, number, number]; world: Ring[]; centroids: Record<string, [number, number]> };

const pathOf = (rings: Ring[]) => rings.map((r) => `M${r.map(([lng, lat]) => project(lng, lat).map((v) => v.toFixed(3)).join(',')).join('L')}Z`).join('');
const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function GeoMap({ locations, minRadiusKm, pinMode = false, onPin, className }: {
  locations: LocationChoiceRow[];
  /** Meta's floor where its housing rule applies — circles are drawn as they will run. */
  minRadiusKm: number | null;
  pinMode?: boolean;
  onPin?: (lat: number, lng: number) => void;
  className?: string;
}) {
  const { t, lang } = useLanguage();
  const svgRef = useRef<SVGSVGElement>(null);
  const shapes = useMemo(() => ({ georgia: pathOf(GEO.georgia), neighbours: Object.values(GEO.neighbours).map(pathOf).join(''), world: pathOf(GEO.world) }), []);
  const m = useMemo(() => mapTargets(locations, minRadiusKm, { centroids: GEO.centroids, georgiaBbox: GEO.bbox, point: placePoint, ring: circleRing, project }),
    [locations, minRadiusKm]);
  const target = m.view;

  /* Glide to the new view instead of jumping. */
  const [view, setView] = useState<MapBox>(target);
  const viewRef = useRef(view);
  useEffect(() => {
    const from = viewRef.current;
    if (reduceMotion()) { viewRef.current = target; setView(target); return; }
    let raf = 0; const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 480);
      const e = 1 - (1 - k) ** 3;
      const v = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e };
      viewRef.current = v; setView(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target.x, target.y, target.w, target.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const fs = view.w * 0.03;
  const dot = view.w * 0.007;
  const regionNames = (() => { try { return new Intl.DisplayNames([lang], { type: 'region' }); } catch { return null; } })();
  const label = (x: number, y: number, text: string) => (
    <text x={x} y={y} fontSize={fs * 0.9} fontWeight={700} textAnchor="middle" fill="hsl(40 90% 74%)"
      stroke="#0B1220" strokeWidth={fs * 0.28} paintOrder="stroke" strokeLinejoin="round">{text}</text>
  );
  const marker = (x: number, y: number, n: number) => (
    <>
      <circle cx={x} cy={y} r={dot * 1.9} fill="hsl(40 90% 62%)" stroke="#0B1220" strokeWidth={dot * 0.4} />
      <text x={x} y={y + dot * 0.75} fontSize={dot * 2.1} fontWeight={800} textAnchor="middle" fill="#161309">{n}</text>
    </>
  );

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!pinMode || !onPin || !svgRef.current) return;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const { lng, lat } = unproject(pt.x, pt.y);
    if (insideRings(GEO.georgia, lng, lat)) onPin(Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5);
  };

  const drawn = m.items.filter((i) => i.drawn);
  const summary = m.items.length ? t('mm_c_map_aria', { n: String(m.items.length), drawn: String(drawn.length) }) : t('mm_c_map_empty');

  return (
    <div className={cn('relative overflow-hidden rounded-2xl border border-[hsl(var(--gold-border))]/40 bg-[#0B1220] shadow-hover', className)}
      data-mm-map={m.scope} data-mm-map-targets={m.items.length} data-mm-map-drawn={drawn.length}>
      <svg ref={svgRef} role="img" aria-label={summary} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        className={cn('block aspect-[16/10] w-full select-none', pinMode ? 'cursor-crosshair' : '')} onClick={onClick}>
        <defs>
          <radialGradient id="mm-map-sea" cx="50%" cy="35%" r="80%">
            <stop offset="0%" stopColor="#16233A" /><stop offset="100%" stopColor="#0B1220" />
          </radialGradient>
        </defs>
        <rect x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3} fill="url(#mm-map-sea)" />
        {/* Geography (never a target): land, Georgia's neighbours and Georgia's outline. */}
        <path d={shapes.world} fill="rgba(160,182,226,0.16)" stroke="rgba(205,218,245,0.30)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
        <path d={shapes.neighbours} fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.10)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
        <path d={shapes.georgia} fill={m.georgiaWhole ? 'hsl(40 90% 56% / 0.24)' : 'rgba(30,44,70,0.85)'}
          stroke={m.georgiaWhole ? 'hsl(40 90% 62%)' : 'rgba(205,218,245,0.45)'} strokeWidth={1.2} vectorEffect="non-scaling-stroke"
          data-mm-map-ge={m.georgiaWhole ? 'whole' : ''} />
        {/* Targets, in list order. */}
        {m.items.filter((i) => i.drawn).map((i) => {
          const [x, y] = project(i.lng!, i.lat!);
          return (
            <g key={i.id} data-mm-map-target={i.id} data-mm-map-kind={i.kind} {...(i.ring ? { 'data-mm-map-circle': i.id, 'data-mm-map-km': i.km } : {})}>
              {i.ring && (
                <path d={`M${i.ring.map(([lng, lat]) => project(lng, lat).join(',')).join('L')}Z`} fill="hsl(40 90% 56% / 0.18)" stroke="hsl(40 90% 62%)"
                  strokeWidth={1.6} strokeDasharray={i.kind === 'pin' ? '5 4' : undefined} vectorEffect="non-scaling-stroke" />
              )}
              {!i.ring && <circle cx={x} cy={y} r={dot * 3.4} fill="hsl(40 90% 56% / 0.22)" />}
              {marker(x, y, i.n)}
              {i.kind === 'country' && label(x, y - dot * 3.6, regionNames?.of(i.code ?? '') ?? i.name)}
            </g>
          );
        })}
      </svg>
      <span className="pointer-events-none absolute end-3 top-2.5 text-2xs font-semibold tracking-[0.14em] text-[hsl(40_90%_70%)]">HOMATCH</span>
      {/* Legend: every target with its number and real radius; what is not drawn, and why. */}
      <div className="border-t border-white/10 px-3 py-2.5 text-2xs text-white/75" data-mm-map-legend="">
        {m.items.length > 0 ? (
          <ul className="mb-1 flex flex-wrap gap-1.5">
            {m.items.map((i) => (
              <li key={i.id} data-mm-map-legend-item={i.id} className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full py-0.5 pe-2.5 ps-0.5', i.drawn ? 'bg-white/[0.08]' : 'border border-dashed border-white/25')}>
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[hsl(40_90%_62%)] text-[11px] font-extrabold text-[#161309]">{i.n}</span>
                <span className="min-w-0 truncate" dir="auto">{i.kind === 'country' ? regionNames?.of(i.code ?? '') ?? i.name : i.name}</span>
                {i.km != null && <span className="shrink-0 font-semibold text-[hsl(40_90%_72%)]" dir="ltr">{i.km} km</span>}
                {!i.drawn && <span className="shrink-0 text-white/50">· {t('mm_c_map_not_drawn')}</span>}
              </li>
            ))}
          </ul>
        ) : null}
        <span>{pinMode ? t('mm_f_map_pin_hint') : m.items.length === 0 ? t('mm_c_map_empty') : m.items.some((i) => !i.drawn) ? t('mm_c_map_not_drawn_why') : t('mm_f_map_live')}</span>
      </div>
    </div>
  );
}
