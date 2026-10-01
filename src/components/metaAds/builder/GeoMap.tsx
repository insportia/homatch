// HOMATCH's map of where the ads run. Not a tile map and not a copy of any
// ad tool: HOMATCH's own navy-and-gold drawing of Georgia (or of the world,
// when the campaign reaches other countries), with every chosen city and pin
// drawn as the real circle Meta will use — radius changes redraw it at once.
//
// Loaded lazily (the outlines are ~40 KB). Pins can be dropped only inside
// Georgia, where HOMATCH knows the country of the point it sends.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { LocationChoiceRow } from '@/services/metaAds';
import data from './geo/geoData.json';
import { PLACES, circleRing, insideRings, placePoint, project, unproject } from './geo/places';

type Ring = Array<[number, number]>;
const GEO = data as unknown as { georgia: Ring[]; neighbours: Record<string, Ring[]>; bbox: [number, number, number, number]; world: Ring[]; centroids: Record<string, [number, number]> };
const ASPECT = 1.6;

const pathOf = (rings: Ring[]) => rings.map((r) => `M${r.map(([lng, lat]) => project(lng, lat).map((v) => v.toFixed(3)).join(',')).join('L')}Z`).join('');

interface Box { x: number; y: number; w: number; h: number }
function boxOf(points: Array<[number, number]>, pad: number, minSpan: number): Box {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  let x0 = Math.min(...xs); let x1 = Math.max(...xs); let y0 = Math.min(...ys); let y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
  let w = Math.max(minSpan, (x1 - x0) * (1 + pad)); let h = Math.max(minSpan / ASPECT, (y1 - y0) * (1 + pad));
  if (w / h < ASPECT) w = h * ASPECT; else h = w / ASPECT;
  x0 = cx - w / 2; y0 = cy - h / 2; x1 = x0 + w; y1 = y0 + h;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function GeoMap({ locations, minRadiusKm, home, pinMode = false, onPin, className }: {
  locations: LocationChoiceRow[];
  /** Meta's floor where its housing rule applies — circles are drawn as they will run. */
  minRadiusKm: number | null;
  /** The advertised property's own point, when known. */
  home?: { lat: number; lng: number; label: string | null } | null;
  pinMode?: boolean;
  onPin?: (lat: number, lng: number) => void;
  className?: string;
}) {
  const { t, lang } = useLanguage();
  const svgRef = useRef<SVGSVGElement>(null);
  const world = locations.some((l) => l.countryCode && l.countryCode.toUpperCase() !== 'GE');

  const shapes = useMemo(() => ({
    georgia: pathOf(GEO.georgia),
    neighbours: Object.values(GEO.neighbours).map(pathOf).join(''),
    world: pathOf(GEO.world),
  }), []);

  const circles = locations.flatMap((l) => {
    if (l.type !== 'city' && l.type !== 'pin') return [];
    const p = placePoint(l);
    if (!p) return [];
    const km = Math.max(minRadiusKm ?? 0, Number(l.radiusKm ?? 17));
    return [{ id: `${l.type}:${l.key}`, name: l.name, pin: l.type === 'pin', ...p, km, ring: circleRing(p.lat, p.lng, km) }];
  });
  const countries = [...new Set(locations.filter((l) => l.type === 'country').map((l) => l.key.toUpperCase()))];
  const georgiaWhole = countries.includes('GE');
  const unplaced = locations.filter((l) => (l.type === 'city' || l.type === 'region') && !placePoint(l) && (l.type === 'region' || !world)).length;

  /* Where to look: the chosen circles, else all of Georgia; the world when abroad. */
  const target: Box = useMemo(() => {
    if (world) {
      const pts = [...countries, 'GE'].map((c) => GEO.centroids[c]).filter(Boolean).map(([lng, lat]) => project(lng, lat));
      return boxOf(pts, 0.9, 55);
    }
    if (circles.length && !georgiaWhole) {
      const pts = circles.flatMap((c) => c.ring.map(([lng, lat]) => project(lng, lat)));
      return boxOf(pts, 0.35, 0.35);
    }
    const [x0, y0, x1, y1] = GEO.bbox;
    return boxOf([project(x0 + 0.5, y0 + 0.4), project(x1 - 0.5, y1 - 0.3)], 0.04, 1);
  }, [world, countries.join(','), circles.map((c) => `${c.id}:${c.km}`).join(','), georgiaWhole]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Glide to the new view instead of jumping. */
  const [view, setView] = useState<Box>(target);
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
  }, [target]);

  const fs = view.w * 0.03;
  const dot = view.w * 0.007;
  const label = (x: number, y: number, text: string, strong = false) => (
    <text x={x} y={y} fontSize={strong ? fs * 1.05 : fs * 0.82} fontWeight={strong ? 700 : 500} textAnchor="middle"
      fill={strong ? 'hsl(40 90% 72%)' : 'rgba(255,255,255,0.72)'} stroke="#0B1220" strokeWidth={fs * 0.28} paintOrder="stroke" strokeLinejoin="round">{text}</text>
  );
  const localName = (p: (typeof PLACES)[number]) => (lang === 'ka' ? p.ka : lang === 'ru' ? p.ru : p.en);
  const regionNames = (() => { try { return new Intl.DisplayNames([lang], { type: 'region' }); } catch { return null; } })();

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!pinMode || !onPin || world || !svgRef.current) return;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const { lng, lat } = unproject(pt.x, pt.y);
    if (insideRings(GEO.georgia, lng, lat)) onPin(Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5);
  };

  const summary = world
    ? t('mm_f_map_aria_world', { n: String(countries.length + circles.length) })
    : t('mm_f_map_aria_ge', { n: String(circles.length || (georgiaWhole ? 1 : 0)) });

  return (
    <div className={cn('relative overflow-hidden rounded-2xl border border-[hsl(var(--gold-border))]/40 bg-[#0B1220] shadow-hover', className)} data-mm-map={world ? 'world' : 'georgia'}>
      <svg ref={svgRef} role="img" aria-label={summary} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        className={cn('block aspect-[16/10] w-full select-none', pinMode && !world ? 'cursor-crosshair' : '')} onClick={onClick}>
        <defs>
          <radialGradient id="mm-map-sea" cx="50%" cy="35%" r="80%">
            <stop offset="0%" stopColor="#16233A" /><stop offset="100%" stopColor="#0B1220" />
          </radialGradient>
          <linearGradient id="mm-map-land" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1E2C46" /><stop offset="100%" stopColor="#15203A" />
          </linearGradient>
        </defs>
        <rect x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3} fill="url(#mm-map-sea)" />
        {world ? (
          <>
            <path d={shapes.world} fill="rgba(160,182,226,0.26)" stroke="rgba(205,218,245,0.45)" strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
            <path d={shapes.georgia} fill="hsl(40 90% 56% / 0.55)" stroke="hsl(40 90% 62%)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {[...countries, 'GE'].filter((c, i, a) => a.indexOf(c) === i).map((c) => {
              const ctr = GEO.centroids[c];
              if (!ctr) return null;
              const [x, y] = project(ctr[0], ctr[1]);
              const chosen = countries.includes(c);
              return (
                <g key={c} data-mm-map-country={c}>
                  {chosen && <circle cx={x} cy={y} r={dot * 3.2} fill="hsl(40 90% 56% / 0.25)" className="motion-safe:animate-pulse" />}
                  <circle cx={x} cy={y} r={dot * 1.4} fill={chosen ? 'hsl(40 90% 60%)' : '#fff'} />
                  {label(x, y - dot * 3.2, regionNames?.of(c) ?? c, chosen)}
                </g>
              );
            })}
          </>
        ) : (
          <>
            <path d={shapes.neighbours} fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.10)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
            <path d={shapes.georgia} fill={georgiaWhole ? 'hsl(40 90% 56% / 0.22)' : 'url(#mm-map-land)'}
              stroke="hsl(40 80% 60% / 0.9)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" data-mm-map-ge={georgiaWhole ? 'whole' : ''} />
            {PLACES.filter((p) => (p.major || (p.kind === 'district' && view.w < 0.6))
              // A chosen area names itself: no second label on top of it.
              && !circles.some((c) => Math.hypot((p.lat - c.lat) * 111, (p.lng - c.lng) * 111 * Math.cos(c.lat * Math.PI / 180)) < c.km)).map((p) => {
              const [x, y] = project(p.lng, p.lat);
              return (
                <g key={p.id} opacity={0.9}>
                  <circle cx={x} cy={y} r={dot * 0.7} fill="rgba(255,255,255,0.8)" />
                  {label(x, y - dot * 1.6, localName(p))}
                </g>
              );
            })}
          </>
        )}
        {!world && circles.map((c, i) => {
          const d = `M${c.ring.map(([lng, lat]) => project(lng, lat).join(',')).join('L')}Z`;
          const [x, y] = project(c.lng, c.lat);
          return (
            <g key={c.id} data-mm-map-circle={c.id} data-mm-map-km={c.km}>
              <path d={d} fill="hsl(40 90% 56% / 0.18)" stroke="hsl(40 90% 62%)" strokeWidth={1.6} strokeDasharray={c.pin ? '5 4' : undefined} vectorEffect="non-scaling-stroke"
                className="transition-[d] duration-300" />
              <circle cx={x} cy={y} r={dot * 1.9} fill="hsl(40 90% 62%)" stroke="#0B1220" strokeWidth={dot * 0.4} />
              <text x={x} y={y + dot * 0.75} fontSize={dot * 2.1} fontWeight={800} textAnchor="middle" fill="#161309">{i + 1}</text>
            </g>
          );
        })}
        {home && !world && (() => {
          const [x, y] = project(home.lng, home.lat);
          return (
            <g data-mm-map-home="">
              <circle cx={x} cy={y} r={dot * 2.4} fill="rgba(255,255,255,0.18)" />
              <circle cx={x} cy={y} r={dot * 1.1} fill="#fff" stroke="hsl(40 90% 56%)" strokeWidth={dot * 0.5} />
            </g>
          );
        })()}
      </svg>
      <span className="pointer-events-none absolute end-3 top-2.5 text-2xs font-semibold tracking-[0.14em] text-[hsl(40_90%_70%)]">HOMATCH</span>
      {/* The legend under the map: numbered areas with their real radius, and what the view means. */}
      <div className="border-t border-white/10 px-3 py-2.5 text-2xs text-white/75" data-mm-map-legend="">
        {!world && circles.length > 0 && (
          <ul className="mb-1.5 flex flex-wrap gap-1.5">
            {circles.map((c, i) => (
              <li key={c.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/[0.08] py-0.5 pe-2.5 ps-0.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[hsl(40_90%_62%)] text-[11px] font-extrabold text-[#161309]">{i + 1}</span>
                <span className="min-w-0 truncate" dir="auto">{c.name}</span>
                <span className="shrink-0 font-semibold text-[hsl(40_90%_72%)]" dir="ltr">{c.km} km</span>
              </li>
            ))}
          </ul>
        )}
        <span>{pinMode && !world ? t('mm_f_map_pin_hint') : world ? t('mm_f_map_world_note') : unplaced ? t('mm_f_map_unplaced', { n: String(unplaced) }) : georgiaWhole ? t('mm_f_map_whole_ge') : circles.length ? t('mm_f_map_live') : ''}</span>
      </div>
    </div>
  );
}
