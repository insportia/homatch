// HOMATCH Design Studio — the 3D tour while it is made: a calm, living picture of the work, not a spinner.
//
// The plan of a home draws itself in gold (the space read), its rooms fill and its furniture settles in (each room
// planned), a soft light sweeps the model (the home built), its lamps glow (the result checked). It shows the stage
// the server reports — never a made-up percentage — and is still when the visitor prefers reduced motion.

import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import './walkWaiting.css';

const GOLD = 'hsl(38 92% 56%)';
const INK = '#0C1119';

/** The plan drawn (one stylised home: four rooms, a hall, a balcony), in drawing order. */
const WALLS = [
  'M20 20 H300 V160 H20 Z', // the outline
  'M140 20 V100', 'M140 120 V160', // kitchen-living | bedroom
  'M20 100 H90', 'M110 100 H140', // bath / hall
  'M200 20 V70', 'M200 90 V160', // bedroom | office
  'M200 100 H300',
];
const ROOMS = [
  { d: 'M140 20 H200 V160 H140 Z', fill: 'rgba(233,185,73,0.10)' },
  { d: 'M20 20 H140 V100 H20 Z', fill: 'rgba(233,185,73,0.14)' },
  { d: 'M200 20 H300 V100 H200 Z', fill: 'rgba(233,185,73,0.08)' },
  { d: 'M20 100 H140 V160 H20 Z', fill: 'rgba(12,17,25,0.04)' },
  { d: 'M200 100 H300 V160 H200 Z', fill: 'rgba(233,185,73,0.12)' },
];
/** The furniture, room by room (rect x, y, w, h). */
const PIECES: Array<[number, number, number, number]> = [
  [28, 26, 70, 10], [104, 26, 12, 14], // kitchen run, fridge
  [46, 64, 44, 16], [58, 50, 20, 9], // sofa, coffee table
  [152, 40, 36, 44], // bed
  [212, 28, 50, 12], [270, 40, 16, 30], // desk, shelf
  [30, 118, 20, 20], [60, 140, 24, 12], // shower, vanity
  [212, 120, 36, 26], // dining
];
const LAMPS: Array<[number, number]> = [[70, 46], [170, 34], [240, 60], [230, 132]];

/** Stage: 0 the space is read, 1 each room planned, 2 the home built, 3 the result checked. */
export function WalkWaiting({ stage, labels, stepIds, note, testId, children }: { stage: number; labels: string[]; stepIds: string[]; note: string; testId: string; children?: React.ReactNode }) {
  const pct = Math.round(((stage + 0.5) / labels.length) * 100);
  return (
    <div className="mt-4" role="status" aria-live="polite" data-testid={testId}>
      <div className="relative overflow-hidden rounded-[18px] bg-[#FBF8F3] ring-1 ring-[#EFE8DC]">
        <svg viewBox="0 0 320 180" className="block h-auto w-full" aria-hidden="true">
          <defs>
            <pattern id="hm-walk-grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M10 0H0V10" fill="none" stroke="rgba(12,17,25,0.05)" strokeWidth="0.5" />
            </pattern>
            <radialGradient id="hm-walk-lamp">
              <stop offset="0%" stopColor={GOLD} stopOpacity="0.9" />
              <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="320" height="180" fill="url(#hm-walk-grid)" />
          {stage >= 1 ? ROOMS.map((r, i) => <path key={r.d} d={r.d} fill={r.fill} className="hm-walk-room" style={{ animationDelay: `${0.15 * i}s` }} />) : null}
          {WALLS.map((d, i) => (
            <path key={d} d={d} pathLength={1} fill="none" stroke={INK} strokeWidth={i === 0 ? 3 : 2} strokeLinecap="round" className="hm-walk-wall" style={{ animationDelay: `${0.35 * i}s` }} />
          ))}
          {/* Door swings, drawn with the walls. */}
          {['M90 100 A20 20 0 0 1 110 120', 'M140 100 A20 20 0 0 0 120 120', 'M200 70 A20 20 0 0 1 220 90'].map((d, i) => (
            <path key={d} d={d} pathLength={1} fill="none" stroke="rgba(12,17,25,0.35)" strokeWidth={1} strokeDasharray="1" className="hm-walk-wall" style={{ animationDelay: `${2.6 + 0.3 * i}s` }} />
          ))}
          {stage >= 1 ? PIECES.map(([x, y, w, h], i) => (
            <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} rx={2.5} fill={i % 3 === 0 ? GOLD : 'rgba(12,17,25,0.42)'} className="hm-walk-piece" style={{ animationDelay: `${0.6 + 0.18 * i}s` }} />
          )) : null}
          {stage >= 3 ? LAMPS.map(([x, y], i) => <circle key={`${x}-${y}`} cx={x} cy={y} r={16} fill="url(#hm-walk-lamp)" className="hm-walk-light" style={{ animationDelay: `${0.5 * i}s` }} />) : null}
        </svg>
        {/* A soft light sweeping the model while it is built. */}
        {stage >= 2 ? <span className="hm-walk-scan pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-[rgba(233,185,73,0.22)] to-transparent" aria-hidden="true" /> : null}
      </div>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#EFE8DC]" aria-hidden="true">
        <div className="hm-walk-bar relative h-full overflow-hidden rounded-full bg-[#0C1119]" style={{ width: `${pct}%` }}>
          <span className="hm-walk-sheen absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-[rgba(233,185,73,0.75)] to-transparent" />
        </div>
      </div>

      <ol className="mt-4 space-y-2.5">
        {labels.map((label, i) => (
          <li key={label} className={cn('flex items-center gap-3 text-[15px]', i < stage ? 'text-[#5B6472]' : i === stage ? 'hm-walk-step font-semibold text-[#0C1119]' : 'text-[#9AA1AC]')} aria-current={i === stage ? 'step' : undefined} data-testid={stepIds[i]}>
            <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full', i < stage ? 'bg-[#0C1119] text-white' : i === stage ? 'hm-walk-dot bg-[hsl(38_92%_56%)]' : 'ring-1 ring-[#D9D1C4]')} aria-hidden="true">
              {i < stage ? <Check className="h-3 w-3" /> : i === stage ? <span className="h-1.5 w-1.5 rounded-full bg-[#0C1119]" /> : null}
            </span>
            {label}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[13px] text-[#5B6472]">{note}</p>
      {children}
    </div>
  );
}
