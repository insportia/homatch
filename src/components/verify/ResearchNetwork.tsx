// HOMATCH VERIFY — the living research network (presentation only).
//
// A calm evidence network around the property: research nodes on a ring, the
// HOMATCH property core at the centre, thin connections between them. What
// each node SAYS comes entirely from verify/researchNetwork.ts, which derives
// it from server facts; this file only draws it.
//
// MOTION RULES
//
//   - Geometry is module-level constant, and every element has a stable key,
//     so a re-render (every poll, every clock tick) never remounts anything.
//   - All motion is CSS animation on elements that are ALWAYS rendered —
//     state changes only toggle opacity/fill/stroke, which transition — so a
//     signal never restarts because a poll arrived, and irregular updates
//     blend in instead of jumping.
//   - prefers-reduced-motion: a still, calm network. No flowing signals, no
//     particles, no pulse.
//   - No measurement is drawn. There is no progress value in this picture.

import React from 'react';
import type { NetworkNode, NetworkNodeKey, NetworkState } from '@/verify/researchNetwork';

const W = 360;
const H = 240;
const CX = W / 2;
const CY = H / 2;
const RX = 140;
const RY = 90;
const CORE_R = 26;

const GOLD = 'hsl(38 92% 54%)';
const NAVY = '#0C1119';
const NEUTRAL = 'hsl(215 14% 58%)';

interface Point {
  x: number;
  y: number;
}

/** Ring positions, starting at the top and walking clockwise. Never changes. */
function ringPoint(i: number, n: number): Point {
  const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
  return { x: +(CX + RX * Math.cos(a)).toFixed(2), y: +(CY + RY * Math.sin(a)).toFixed(2) };
}

/** Where a spoke leaves the core, so lines meet its rim rather than its centre. */
function rimPoint(p: Point): Point {
  const dx = p.x - CX;
  const dy = p.y - CY;
  const d = Math.hypot(dx, dy) || 1;
  return { x: +(CX + (dx / d) * (CORE_R + 4)).toFixed(2), y: +(CY + (dy / d) * (CORE_R + 4)).toFixed(2) };
}

/*
 * Deterministic particles: a fixed constellation (no Math.random), so the
 * picture after a remount is the picture before it.
 */
const PARTICLES = Array.from({ length: 14 }, (_, i) => {
  const a = (i * 137.508 * Math.PI) / 180;
  const r = 0.35 + ((i * 53) % 60) / 100;
  return {
    x: +(CX + Math.cos(a) * RX * 1.08 * r).toFixed(2),
    y: +(CY + Math.sin(a) * RY * 1.1 * r).toFixed(2),
    r: 0.6 + ((i * 7) % 5) / 10,
    dur: 9 + ((i * 5) % 9),
    delay: -((i * 1.7) % 9),
  };
});

const STYLE = `
.hm-net-flow{stroke-dasharray:1.5 14;animation:hm-net-flow 2.6s linear infinite}
.hm-net-pulse{transform-box:fill-box;transform-origin:center;animation:hm-net-pulse 2.8s ease-in-out infinite}
.hm-net-spin{transform-box:fill-box;transform-origin:center;animation:hm-net-spin 80s linear infinite}
.hm-net-drift{transform-box:fill-box;animation-name:hm-net-drift;animation-timing-function:ease-in-out;animation-iteration-count:infinite;animation-direction:alternate}
.hm-net-fade{transition:opacity .8s ease,fill .8s ease,stroke .8s ease}
@keyframes hm-net-flow{to{stroke-dashoffset:-31}}
@keyframes hm-net-pulse{0%,100%{transform:scale(1);opacity:.55}50%{transform:scale(1.6);opacity:0}}
@keyframes hm-net-spin{to{transform:rotate(360deg)}}
@keyframes hm-net-drift{from{transform:translate(0,0)}to{transform:translate(6px,-8px)}}
@media (prefers-reduced-motion: reduce){
  .hm-net-flow,.hm-net-pulse,.hm-net-spin,.hm-net-drift{animation:none}
  .hm-net-motion{display:none}
}
`;

interface NodeLook {
  fill: string;
  stroke: string;
  strokeOpacity: number;
  dash?: string;
  spoke: string;
  spokeOpacity: number;
  spokeDash?: string;
}

function lookFor(state: NetworkNode['state']): NodeLook {
  switch (state) {
    case 'ACTIVE':
      return { fill: '#FFFFFF', stroke: GOLD, strokeOpacity: 1, spoke: GOLD, spokeOpacity: 0.45 };
    case 'DONE':
      return { fill: GOLD, stroke: GOLD, strokeOpacity: 0.9, spoke: GOLD, spokeOpacity: 0.26 };
    case 'PARTIAL':
      return { fill: NAVY, stroke: GOLD, strokeOpacity: 0.7, spoke: GOLD, spokeOpacity: 0.16, spokeDash: '3 4' };
    case 'UNAVAILABLE':
      return { fill: NAVY, stroke: NEUTRAL, strokeOpacity: 0.45, dash: '1.6 1.6', spoke: NEUTRAL, spokeOpacity: 0.14, spokeDash: '1.5 4' };
    default:
      return { fill: NAVY, stroke: '#FFFFFF', strokeOpacity: 0.22, spoke: '#FFFFFF', spokeOpacity: 0.07 };
  }
}

export interface ResearchNetworkProps {
  network: NetworkState;
}

function ResearchNetworkImpl({ network }: ResearchNetworkProps) {
  const ring = React.useMemo(() => network.nodes.filter((n) => n.key !== 'complete'), [network.nodes]);
  const n = ring.length;
  const geometry = React.useMemo(() => {
    const out = {} as Record<NetworkNodeKey, { p: Point; rim: Point }>;
    ring.forEach((node, i) => {
      const p = ringPoint(i, n);
      out[node.key] = { p, rim: rimPoint(p) };
    });
    return out;
    // Geometry depends on the node COUNT only, never on node state.
  }, [n]);

  const core = network.nodes.find((x) => x.key === 'complete');
  const complete = core?.state === 'DONE';
  const stopped = network.terminal === 'FAILED' || network.terminal === 'CANCELLED';
  const moving = !network.settled;

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl bg-[#0C1119] aspect-[3/2]"
      aria-hidden="true"
      data-testid="research-network"
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" focusable="false">
        <style>{STYLE}</style>
        <defs>
          <radialGradient id="hm-net-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={GOLD} stopOpacity="0.16" />
            <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Soft field behind the core */}
        <ellipse cx={CX} cy={CY} rx={RX * 0.75} ry={RY * 0.8} fill="url(#hm-net-glow)" className="hm-net-fade" opacity={stopped ? 0.3 : 1} />

        {/* Particles — motion only, hidden for reduced motion, fade when settled */}
        <g className="hm-net-motion hm-net-fade" opacity={moving ? 1 : 0}>
          {PARTICLES.map((p, i) => (
            <circle
              key={`p${i}`}
              cx={p.x}
              cy={p.y}
              r={p.r}
              fill="#FFFFFF"
              opacity={0.18}
              className="hm-net-drift"
              style={{ animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` }}
            />
          ))}
        </g>

        {/* The research path around the ring */}
        {ring.map((node, i) => {
          const next = ring[(i + 1) % n];
          if (i === n - 1) return null;
          const a = geometry[node.key].p;
          const b = geometry[next.key].p;
          const walked = node.state === 'DONE' && (next.state === 'DONE' || next.state === 'ACTIVE');
          return (
            <line
              key={`path-${node.key}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={walked ? GOLD : '#FFFFFF'}
              strokeOpacity={walked ? 0.32 : 0.08}
              strokeWidth={0.8}
              strokeLinecap="round"
              className="hm-net-fade"
            />
          );
        })}

        {/* Spokes: evidence flowing into the property */}
        {ring.map((node) => {
          const { p, rim } = geometry[node.key];
          const look = lookFor(node.state);
          const active = node.state === 'ACTIVE' && moving;
          return (
            <g key={`spoke-${node.key}`}>
              <line
                x1={p.x}
                y1={p.y}
                x2={rim.x}
                y2={rim.y}
                stroke={look.spoke}
                strokeOpacity={look.spokeOpacity}
                strokeWidth={0.9}
                strokeDasharray={look.spokeDash}
                strokeLinecap="round"
                className="hm-net-fade"
              />
              {/* Always mounted, so its animation never restarts; only its opacity follows the state. */}
              <line
                x1={p.x}
                y1={p.y}
                x2={rim.x}
                y2={rim.y}
                stroke={GOLD}
                strokeWidth={1.6}
                strokeLinecap="round"
                className="hm-net-flow hm-net-motion hm-net-fade"
                opacity={active ? 0.9 : 0}
              />
            </g>
          );
        })}

        {/* The property core */}
        <g>
          <circle
            cx={CX}
            cy={CY}
            r={CORE_R + 9}
            fill="none"
            stroke={stopped ? NEUTRAL : GOLD}
            strokeOpacity={0.35}
            strokeWidth={0.7}
            strokeDasharray="2 5"
            className="hm-net-spin hm-net-fade"
          />
          <circle
            cx={CX}
            cy={CY}
            r={CORE_R}
            fill={complete ? 'hsl(38 92% 54% / 0.16)' : NAVY}
            stroke={stopped ? NEUTRAL : GOLD}
            strokeOpacity={stopped ? 0.45 : 0.85}
            strokeWidth={1.2}
            className="hm-net-fade"
          />
          {/* A house: roof and body, drawn as one refined line */}
          <path
            d={`M ${CX - 11} ${CY - 1} L ${CX} ${CY - 11} L ${CX + 11} ${CY - 1} M ${CX - 8} ${CY - 3.5} L ${CX - 8} ${CY + 10} L ${CX + 8} ${CY + 10} L ${CX + 8} ${CY - 3.5} M ${CX - 2.5} ${CY + 10} L ${CX - 2.5} ${CY + 3.5} L ${CX + 2.5} ${CY + 3.5} L ${CX + 2.5} ${CY + 10}`}
            fill="none"
            stroke={stopped ? NEUTRAL : complete ? GOLD : '#FFFFFF'}
            strokeOpacity={stopped ? 0.6 : 0.92}
            strokeWidth={1.3}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="hm-net-fade"
          />
        </g>

        {/* Research nodes */}
        {ring.map((node) => {
          const { p } = geometry[node.key];
          const look = lookFor(node.state);
          const active = node.state === 'ACTIVE';
          return (
            <g key={`node-${node.key}`} transform={`translate(${p.x} ${p.y})`}>
              {/* Halo: always mounted; pulses only while this node is the one working. */}
              <circle
                r={9}
                fill="none"
                stroke={GOLD}
                strokeWidth={0.8}
                className="hm-net-pulse hm-net-fade"
                opacity={active && moving ? 1 : 0}
              />
              <circle
                r={active ? 5.2 : 4.4}
                fill={look.fill}
                stroke={look.stroke}
                strokeOpacity={look.strokeOpacity}
                strokeWidth={1.1}
                strokeDasharray={look.dash}
                className="hm-net-fade"
              />
              {/* Partial: a finding, but not the whole one */}
              <circle r={1.7} fill={GOLD} className="hm-net-fade" opacity={node.state === 'PARTIAL' ? 0.85 : 0} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/*
 * Memoised on the derived state's CONTENT, not identity: networkState() builds
 * a new object on every render, but if nothing it says has changed there is
 * nothing to redraw.
 */
export const ResearchNetwork = React.memo(
  ResearchNetworkImpl,
  (a, b) =>
    a.network.terminal === b.network.terminal &&
    a.network.settled === b.network.settled &&
    a.network.nodes.length === b.network.nodes.length &&
    a.network.nodes.every((n, i) => n.key === b.network.nodes[i].key && n.state === b.network.nodes[i].state),
);
