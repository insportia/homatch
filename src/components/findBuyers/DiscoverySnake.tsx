// The HOMATCH Snake as live-search language — not a game.
//
// PROPERTY → HOMATCH → the public sources this campaign ACTUALLY queued. Every
// node and every movement is a server fact (find_buyers_campaign_status):
//   QUEUED   a hollow node, waiting
//   RUNNING  the gold signal travels out to the source; the node breathes
//   results  a return pulse travels back toward HOMATCH
//   DONE     the node resolves (gold); FAILED the node degrades, others go on
//   PAUSING  movement slows and no new path lights; PAUSED everything is still
// No source is ever drawn that the campaign did not queue. With reduced
// motion the picture is static and every state is still readable (icons,
// labels and the counts beside it).
import React, { useId } from 'react';
import { sourceStyle } from '@/components/findBuyers/brand';
import type { SourceNode } from '@/services/findBuyers';
import type { Motion } from '@/findBuyers/campaignView';

const W = 640;
const ROW = 46;

export function DiscoverySnake({
  sources, motion, propertyLabel, homatchLabel, ariaLabel,
}: {
  sources: SourceNode[];
  motion: Motion;
  propertyLabel: string;
  homatchLabel: string;
  ariaLabel: string;
}) {
  const uid = useId().replace(/:/g, '');
  const n = Math.max(1, sources.length);
  const H = Math.max(176, n * ROW + 36);
  const cy = H / 2;
  const px = 64; const hx = 236; const sx = 520;
  const yOf = (i: number) => (sources.length <= 1 ? cy : 18 + ROW / 2 + i * ((H - 36 - ROW) / (n - 1)));
  const dur = motion === 'slowing' ? '7s' : '2.6s';
  const moving = motion !== 'still';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="h-auto w-full" preserveAspectRatio="xMidYMid meet">
      <style>{`
        .s${uid}-run { stroke-dasharray: 46 420; animation: s${uid}-out ${dur} linear infinite; }
        .s${uid}-back { stroke-dasharray: 10 420; animation: s${uid}-in ${dur} linear infinite; }
        .s${uid}-breathe { transform-box: fill-box; transform-origin: center; animation: s${uid}-b 2.4s ease-in-out infinite; }
        .s${uid}-core { transform-box: fill-box; transform-origin: center; animation: s${uid}-b 3.2s ease-in-out infinite; }
        @keyframes s${uid}-out { from { stroke-dashoffset: 466; } to { stroke-dashoffset: 0; } }
        @keyframes s${uid}-in { from { stroke-dashoffset: 0; } to { stroke-dashoffset: 430; } }
        @keyframes s${uid}-b { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.12); opacity: .82; } }
        @media (prefers-reduced-motion: reduce) {
          .s${uid}-run, .s${uid}-back, .s${uid}-breathe, .s${uid}-core { animation: none; }
          .s${uid}-run { stroke-dasharray: none; }
          .s${uid}-back { display: none; }
        }
      `}</style>
      <defs>
        <linearGradient id={`g${uid}`} x1="0" x2="1">
          <stop offset="0%" stopColor="hsl(42 96% 66%)" />
          <stop offset="100%" stopColor="hsl(34 90% 52%)" />
        </linearGradient>
      </defs>

      {/* property → HOMATCH */}
      <line x1={px + 22} y1={cy} x2={hx - 30} y2={cy} stroke="hsl(40 80% 60% / 0.35)" strokeWidth="2" />
      {moving && sources.length === 0 && (
        <line x1={px + 22} y1={cy} x2={hx - 30} y2={cy} stroke={`url(#g${uid})`} strokeWidth="2.5" strokeLinecap="round" className={`s${uid}-run`} />
      )}

      {sources.map((s, i) => {
        const y = yOf(i);
        const d = `M${hx + 30},${cy} C${hx + 150},${cy} ${sx - 150},${y} ${sx - 22},${y}`;
        const back = `M${sx - 22},${y} C${sx - 150},${y} ${hx + 150},${cy} ${hx + 30},${cy}`;
        const st = sourceStyle(s.source);
        /* lucide icons render an <svg>; positioned inside the network by x/y. */
        const Icon = st.Icon as unknown as React.ComponentType<React.SVGProps<SVGSVGElement>>;
        const failed = s.state === 'FAILED';
        const done = s.state === 'DONE';
        const running = s.state === 'RUNNING';
        return (
          <g key={s.source}>
            <path d={d} fill="none" stroke={failed ? 'hsl(350 60% 70% / 0.45)' : 'hsl(40 80% 60% / 0.22)'}
              strokeWidth="1.6" strokeDasharray={failed || s.state === 'CANCELLED' ? '4 5' : undefined} />
            {running && moving && (
              <path d={d} fill="none" stroke={`url(#g${uid})`} strokeWidth="2.6" strokeLinecap="round" className={`s${uid}-run`} />
            )}
            {running && !moving && <path d={d} fill="none" stroke="hsl(40 90% 62% / 0.7)" strokeWidth="2" />}
            {s.results > 0 && moving && (
              <path d={back} fill="none" stroke="hsl(45 100% 80%)" strokeWidth="3.4" strokeLinecap="round" className={`s${uid}-back`} />
            )}
            {done && <path d={d} fill="none" stroke="hsl(40 90% 60% / 0.65)" strokeWidth="1.8" />}

            <g className={running && moving ? `s${uid}-breathe` : undefined}>
              <circle cx={sx} cy={y} r="19"
                fill={done ? `url(#g${uid})` : failed ? 'hsl(350 35% 22%)' : running ? 'hsl(218 50% 20%)' : 'hsl(218 45% 15%)'}
                stroke={failed ? 'hsl(350 65% 66%)' : done || running ? 'hsl(40 94% 64%)' : 'hsl(40 60% 70% / 0.45)'}
                strokeWidth={running ? 2.4 : 1.6} strokeDasharray={s.state === 'QUEUED' ? '3 3' : undefined} />
              <Icon x={sx - 9} y={y - 9} width={18} height={18}
                color={done ? 'hsl(218 52% 11%)' : failed ? 'hsl(350 70% 75%)' : '#fff'} aria-hidden="true" />
            </g>
            <text x={sx + 28} y={y + 4} fontSize="13" fontWeight="600" fill={failed ? 'hsl(350 60% 80%)' : 'hsl(218 30% 92%)'}>{st.label}</text>
            {s.results > 0 && (
              <g>
                <rect x={sx + 28 + st.label.length * 7.6 + 6} y={y - 9} rx="8" width="30" height="17" fill={`url(#g${uid})`} />
                <text x={sx + 28 + st.label.length * 7.6 + 21} y={y + 3.5} fontSize="11" fontWeight="700" textAnchor="middle" fill="hsl(218 52% 11%)">{s.results}</text>
              </g>
            )}
          </g>
        );
      })}

      {/* the property */}
      <g>
        <rect x={px - 24} y={cy - 22} width="48" height="44" rx="12" fill="hsl(218 45% 15%)" stroke="hsl(40 70% 70% / 0.6)" strokeWidth="1.4" />
        <path d={`M${px - 11},${cy + 1} L${px},${cy - 9} L${px + 11},${cy + 1} M${px - 8},${cy - 1} V${cy + 10} H${px + 8} V${cy - 1}`}
          fill="none" stroke="hsl(40 94% 64%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <text x={px} y={cy + 40} fontSize="12" textAnchor="middle" fill="hsl(218 30% 85%)">{propertyLabel}</text>
      </g>
      {/* HOMATCH intelligence */}
      <g className={moving ? `s${uid}-core` : undefined}>
        <circle cx={hx} cy={cy} r="29" fill="hsl(218 52% 11%)" stroke={`url(#g${uid})`} strokeWidth="3" />
        <circle cx={hx} cy={cy} r="9" fill={`url(#g${uid})`} />
      </g>
      <text x={hx} y={cy + 48} fontSize="12" fontWeight="700" textAnchor="middle" fill="hsl(40 94% 70%)">{homatchLabel}</text>
    </svg>
  );
}

export default DiscoverySnake;
