// HOMATCH Design Studio — the 3D tour while it is made: a calm, living picture of the work, not a spinner.
//
// A living architectural model grows (WalkGrowth.tsx): home after home, never the same twice, unframed on the page.
// While it loads — and where WebGL is missing — plan after plan draws itself in gold instead (FlatPlan); when the
// visitor prefers reduced motion, one finished plan, still. The steps below show the stage the server reports —
// never a made-up percentage.

import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SectionBoundary } from '@/components/common/SectionBoundary';
import { lazyRoute } from '@/lib/lazyRoute';
import './walkWaiting.css';

const WalkGrowth = lazyRoute(() => import('./WalkGrowth'));
/** The model's edges dissolve into the page: no frame around it. */
const FADE = 'radial-gradient(ellipse 72% 78% at 50% 50%, #000 58%, transparent 100%)';

const GOLD = 'hsl(38 92% 56%)';
const INK = '#0C1119';
const OUTLINE = 'M20 20 H300 V160 H20 Z';
/** One plan's life on screen (ms): drawn, furnished, lit, then it gives way (walkWaiting.css .hm-walk-cycle). */
const CYCLE_MS = 7500;

type Plan = {
  walls: string[];
  doors: string[];
  rooms: Array<{ d: string; fill: string }>;
  pieces: Array<[number, number, number, number]>;
  lamps: Array<[number, number]>;
};
const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
const warm = (a: number) => `rgba(233,185,73,${a})`;

/** Three stylised homes (a two-room flat with a study, a one-bed with a hall, an open studio), in drawing order. */
const PLANS: Plan[] = [
  {
    walls: ['M140 20 V100', 'M140 120 V160', 'M20 100 H90', 'M110 100 H140', 'M200 20 V70', 'M200 90 V160', 'M200 100 H300'],
    doors: ['M90 100 A20 20 0 0 1 110 120', 'M140 100 A20 20 0 0 0 120 120', 'M200 70 A20 20 0 0 1 220 90'],
    rooms: [
      { d: rect(140, 20, 60, 140), fill: warm(0.1) }, { d: rect(20, 20, 120, 80), fill: warm(0.14) },
      { d: rect(200, 20, 100, 80), fill: warm(0.08) }, { d: rect(20, 100, 120, 60), fill: 'rgba(12,17,25,0.04)' },
      { d: rect(200, 100, 100, 60), fill: warm(0.12) },
    ],
    pieces: [[28, 26, 70, 10], [104, 26, 12, 14], [46, 64, 44, 16], [58, 50, 20, 9], [152, 40, 36, 44], [212, 28, 50, 12], [270, 40, 16, 30], [30, 118, 20, 20], [60, 140, 24, 12], [212, 120, 36, 26]],
    lamps: [[70, 46], [170, 34], [240, 60], [230, 132]],
  },
  {
    walls: ['M120 20 V90', 'M120 110 V160', 'M20 90 H70', 'M90 90 H120', 'M220 20 V60', 'M220 80 V160'],
    doors: ['M120 90 A20 20 0 0 1 140 110', 'M70 90 A20 20 0 0 0 90 70', 'M220 60 A20 20 0 0 1 240 80'],
    rooms: [
      { d: rect(20, 20, 100, 70), fill: 'rgba(12,17,25,0.04)' }, { d: rect(20, 90, 100, 70), fill: warm(0.1) },
      { d: rect(120, 20, 100, 140), fill: warm(0.14) }, { d: rect(220, 20, 80, 140), fill: warm(0.09) },
    ],
    pieces: [[28, 28, 18, 18], [60, 28, 22, 12], [28, 140, 80, 12], [135, 28, 50, 6], [170, 52, 30, 22], [140, 90, 30, 10], [132, 110, 50, 16], [235, 40, 50, 40], [232, 140, 56, 12]],
    lamps: [[60, 60], [165, 80], [260, 100]],
  },
  {
    walls: ['M110 20 V50', 'M110 70 V110', 'M110 130 V160', 'M20 70 H90', 'M250 20 V70', 'M250 90 V160'],
    doors: ['M110 50 A20 20 0 0 0 90 70', 'M110 110 A20 20 0 0 1 130 130', 'M250 70 A20 20 0 0 0 230 90'],
    rooms: [
      { d: rect(20, 20, 90, 50), fill: 'rgba(12,17,25,0.04)' }, { d: rect(20, 70, 90, 90), fill: warm(0.1) },
      { d: rect(110, 20, 140, 140), fill: warm(0.14) }, { d: rect(250, 20, 50, 140), fill: warm(0.08) },
    ],
    pieces: [[28, 28, 20, 20], [70, 28, 30, 10], [30, 95, 40, 50], [120, 28, 90, 10], [145, 55, 50, 14], [148, 108, 26, 10], [130, 130, 60, 16], [258, 40, 34, 44], [256, 130, 38, 12]],
    lamps: [[60, 120], [180, 80], [275, 70]],
  },
];

function prefersReducedMotion(): boolean {
  try { return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** The flat drawing: plan after plan drawn in gold — while the living model loads, and where it cannot run (no WebGL,
 * reduced motion: then one finished plan, still). */
function FlatPlan({ still }: { still: boolean }) {
  // The plan on screen: the next one each cycle, for as long as the work lasts.
  const [cycle, setCycle] = React.useState(0);
  React.useEffect(() => {
    if (still) return undefined;
    const t = window.setInterval(() => setCycle((c) => c + 1), CYCLE_MS);
    return () => window.clearInterval(t);
  }, [still]);
  const plan = PLANS[cycle % PLANS.length];
  return (
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
        {/* Keyed by cycle: each plan is drawn from the first stroke, then fades for the next. */}
        <g key={cycle} className={still ? undefined : 'hm-walk-cycle'}>
          {plan.rooms.map((r, i) => <path key={r.d} d={r.d} fill={r.fill} className="hm-walk-room" style={{ animationDelay: `${1.9 + 0.15 * i}s` }} />)}
          <path d={OUTLINE} pathLength={1} fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" className="hm-walk-wall" style={{ animationDuration: '1.4s' }} />
          {plan.walls.map((d, i) => (
            <path key={d} d={d} pathLength={1} fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" className="hm-walk-wall" style={{ animationDelay: `${1.1 + 0.18 * i}s`, animationDuration: '0.7s' }} />
          ))}
          {plan.doors.map((d, i) => (
            <path key={d} d={d} pathLength={1} fill="none" stroke="rgba(12,17,25,0.35)" strokeWidth={1} className="hm-walk-wall" style={{ animationDelay: `${2.2 + 0.2 * i}s`, animationDuration: '0.6s' }} />
          ))}
          {plan.pieces.map(([x, y, w, h], i) => (
            <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} rx={2.5} fill={i % 3 === 0 ? GOLD : 'rgba(12,17,25,0.42)'} className="hm-walk-piece" style={{ animationDelay: `${2.8 + 0.16 * i}s` }} />
          ))}
          {/* The lamps come on once the room is furnished, then breathe. */}
          {plan.lamps.map(([x, y], i) => (
            <g key={`${x}-${y}`} className="hm-walk-room" style={{ animationDelay: `${4.4 + 0.3 * i}s` }}>
              <circle cx={x} cy={y} r={16} fill="url(#hm-walk-lamp)" className="hm-walk-light" />
            </g>
          ))}
          {/* The gold pen, running the outline as it is drawn. */}
          {still ? null : (
            <circle r={3.2} fill={GOLD} className="hm-walk-pen">
              <animateMotion dur="1.4s" path={OUTLINE} fill="freeze" />
            </circle>
          )}
        </g>
      </svg>
      {/* A soft light sweeping the model while it is made. */}
      <span className="hm-walk-scan pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-[rgba(233,185,73,0.22)] to-transparent" aria-hidden="true" />
    </div>
  );
}

/** Stage: 0 the space is read, 1 each room planned, 2 the home built, 3 the result checked. */
export function WalkWaiting({ stage, labels, stepIds, note, testId, children }: { stage: number; labels: string[]; stepIds: string[]; note: string; testId: string; children?: React.ReactNode }) {
  const pct = Math.round(((stage + 0.5) / labels.length) * 100);
  const [still] = React.useState(prefersReducedMotion);
  const [failed, setFailed] = React.useState(false);
  const onFail = React.useCallback(() => setFailed(true), []);
  return (
    <div className="mt-4" role="status" aria-live="polite" data-testid={testId}>
      {still || failed ? <FlatPlan still={still} /> : (
        // The living model, unframed: it grows out of the page and fades back into it at its edges.
        <div className="relative -mx-4 h-[290px] sm:-mx-8 sm:h-[360px]" style={{ maskImage: FADE, WebkitMaskImage: FADE }}>
          {/* Decoration never costs the page: a chunk a deploy removed, a browser without some WebGL feature — the
              flat drawing stands in, the tour's progress below is untouched. */}
          <SectionBoundary name="walk-growth" fallback={<div className="absolute inset-0 flex items-center px-6"><div className="w-full"><FlatPlan still={false} /></div></div>}>
            <React.Suspense fallback={<div className="absolute inset-0 flex items-center px-6"><div className="w-full"><FlatPlan still={false} /></div></div>}>
              <WalkGrowth onFail={onFail} />
            </React.Suspense>
          </SectionBoundary>
        </div>
      )}

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
