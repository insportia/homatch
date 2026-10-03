// A style, drawn: a small interior vignette in the colours the style really
// produces (its walls, floor, accents and palette). A PLACEHOLDER for the
// photographic style references HOMATCH will render itself — never a photo
// that could pass for the customer's result, and never stock imagery.

import React from 'react';
import { lookPreferences, type LookStyle } from '@/lib/designStudio/lookPresets';
import { STYLE_SWATCHES } from '@/lib/designStudio/grammar';
import type { StyleCode } from '@/lib/designStudio/planToHome';

const FLOOR: Record<string, [string, string]> = {
  LIGHT_WOOD: ['#d9bf98', '#c8ab82'], DARK_WOOD: ['#6b4a32', '#57391f'], STONE: ['#d3cec5', '#bdb7ad'],
  MARBLE: ['#efece8', '#d6d0c8'], CONCRETE: ['#b9b9b6', '#a3a3a0'], TILE: ['#e8e6e1', '#cfccc5'],
};
const WALL: Record<string, string> = { WARM_WHITE: '#f4eee3', COOL_WHITE: '#eef1f4', GREIGE: '#d9d2c7', PLASTER: '#e7dccd', DEEP: '#4b5a5c' };
const METAL: Record<string, string> = { BLACK_METAL: '#1d1f22', BRASS: '#b08d57', CHROME: '#b9bfc5', NATURAL_WOOD: '#a77b52' };

export function StylePreview({ style, className }: { style: LookStyle; className?: string }) {
  const p = lookPreferences(style, 'HIGH_QUALITY');
  const [floorA, floorB] = FLOOR[p.floor] ?? FLOOR.LIGHT_WOOD;
  const wall = WALL[p.walls] ?? WALL.WARM_WHITE;
  const metal = METAL[p.accent] ?? METAL.BLACK_METAL;
  const [, soft, deep] = STYLE_SWATCHES[(p.style ?? 'contemporary') as StyleCode] ?? STYLE_SWATCHES.contemporary;
  const id = `sp-${style}`;
  const classic = style === 'CLASSIC';
  const lux = style === 'LUXURY';
  return (
    <svg viewBox="0 0 320 220" role="img" aria-hidden="true" className={className} data-placeholder="style-illustration" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`${id}-light`} x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity="0.55" /><stop offset="1" stopColor="#ffffff" stopOpacity="0" /></linearGradient>
        <pattern id={`${id}-floor`} width="40" height="10" patternUnits="userSpaceOnUse"><rect width="40" height="10" fill={floorA} /><rect y="9" width="40" height="1" fill={floorB} /><rect x="22" width="1" height="10" fill={floorB} /></pattern>
      </defs>
      <rect width="320" height="150" fill={wall} />
      {classic ? <g stroke={floorB} strokeOpacity="0.35" fill="none"><rect x="18" y="26" width="70" height="90" /><rect x="232" y="26" width="70" height="90" /></g> : null}
      <rect x="112" y="22" width="96" height="92" rx="2" fill="#dfe8ee" />
      <rect x="112" y="22" width="96" height="92" rx="2" fill={`url(#${id}-light)`} />
      <path d="M160 22v92M112 68h96" stroke={metal} strokeWidth="2" />
      <rect y="150" width="320" height="70" fill={`url(#${id}-floor)`} />
      <polygon points="0,150 320,150 320,156 0,156" fill="#000" fillOpacity="0.06" />
      <ellipse cx="160" cy="186" rx="110" ry="16" fill={soft} fillOpacity="0.55" />
      <rect x="70" y="118" width="180" height="40" rx={style === 'MINIMAL' ? 4 : 10} fill={soft} />
      <rect x="70" y="104" width="180" height="22" rx={style === 'MINIMAL' ? 4 : 10} fill={soft} />
      <rect x="62" y="112" width="18" height="46" rx="8" fill={soft} />
      <rect x="240" y="112" width="18" height="46" rx="8" fill={soft} />
      <rect x="100" y="120" width="30" height="18" rx="5" fill={deep} fillOpacity="0.85" />
      <rect x="190" y="120" width="30" height="18" rx="5" fill={wall} />
      <path d="M78 158v8M242 158v8" stroke={metal} strokeWidth="3" />
      <rect x="120" y="170" width="80" height="8" rx="3" fill={lux ? '#efece8' : floorB} />
      <path d="M126 178v10M194 178v10" stroke={metal} strokeWidth="2.5" />
      <path d="M284 158V72" stroke={metal} strokeWidth="2.5" />
      <path d="M270 72h28l-6-16h-16z" fill={lux ? '#f3e2b8' : '#f5ead6'} />
      {style !== 'MINIMAL' ? <g><path d="M32 158c0-20 6-34 12-40" stroke="#7f8f6a" strokeWidth="3" fill="none" /><ellipse cx="40" cy="112" rx="14" ry="20" fill="#8e9b74" /><rect x="26" y="146" width="24" height="14" rx="3" fill={deep} fillOpacity="0.8" /></g> : null}
      {style === 'WARM_COZY' ? <rect x="150" y="100" width="40" height="30" rx="6" fill="#e9cfb5" transform="rotate(-8 170 115)" /> : null}
    </svg>
  );
}
