// HOMATCH VERIFY — the living intelligence field (presentation only).
//
// A calm, cinematic field of evidence around the property. WHAT it shows —
// which kind of research is happening — comes entirely from the server-
// derived network state (verify/researchNetwork.ts: activeKey, terminal,
// settled); HOW it moves lives in verify/motion/intelligenceField.ts.
//
// RULES
//
//   - Real state only. The formation follows the research-agent stage; it
//     never implies a source succeeded and draws no measurement — there is
//     no progress value in this picture.
//   - One requestAnimationFrame loop, started on mount, stopped on unmount,
//     when the tab is hidden and when the field scrolls out of view.
//     A poll or a clock tick never restarts it: state arrives through a ref.
//   - Cost-aware: particle counts scale with the surface and drop on
//     low-power devices; if frames run slow the field sheds dust and draws
//     links on alternate frames. Glows are pre-rendered sprites — no
//     per-frame blur, no filters.
//   - prefers-reduced-motion: a still, composed frame of the current
//     formation, redrawn only when the research stage changes.
//   - Decorative to assistive technology (aria-hidden); the visible legend in
//     ResearchStream carries every node's name and state.

import React from 'react';
import type { NetworkState, NetworkNode } from '@/verify/researchNetwork';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  FEEL,
  PALETTE,
  carrierPoint,
  createParticles,
  easeInOut,
  formationFor,
  particleBudget,
  step,
  tintRgb,
  ringPercent,
  ringPosition,
  type Formation,
  type Particle,
} from '@/verify/motion/intelligenceField';

export interface ResearchNetworkProps {
  network: NetworkState;
}

/** A soft radial glow, rendered once per tint and drawn as an image. */
function glowSprite(rgb: readonly [number, number, number]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.55)`);
  grad.addColorStop(0.35, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.18)`);
  grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function isLowPower(): boolean {
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return (n.hardwareConcurrency ?? 8) <= 4 || (n.deviceMemory ?? 8) <= 4 || n.connection?.saveData === true;
}

interface Engine {
  formation: Formation;
  /** Visual feel, eased toward the formation's own so changes blend. */
  glow: number;
  links: number;
  particles: Particle[];
  counts: { motes: number; anchors: number };
  t: number;
  frameMs: number;
  thin: boolean;
  /** Eased 0…1 presence of the formation-specific layers (ribbons, bridges). */
  wave: number;
  lanes: number;
  bridge: number;
}

/*
 * A house, drawn in strokes — the property at the centre of the research.
 * `s` is the half-width of the mark.
 */
function drawHouse(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, alpha: number) {
  const [r, g, b] = PALETTE.gold;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Body, roof and chimney as one outline; door as a second.
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.78, cy - s * 0.1);
  ctx.lineTo(cx - s * 0.78, cy + s * 0.82);
  ctx.lineTo(cx + s * 0.78, cy + s * 0.82);
  ctx.lineTo(cx + s * 0.78, cy - s * 0.1);
  ctx.moveTo(cx - s * 1.02, cy + s * 0.08);
  ctx.lineTo(cx, cy - s * 0.92);
  ctx.lineTo(cx + s * 1.02, cy + s * 0.08);
  ctx.moveTo(cx + s * 0.48, cy - s * 0.46);
  ctx.lineTo(cx + s * 0.48, cy - s * 0.78);
  ctx.lineTo(cx + s * 0.66, cy - s * 0.78);
  ctx.lineTo(cx + s * 0.66, cy - s * 0.28);
  ctx.fillStyle = `rgba(11,16,24,${0.85 * alpha})`;
  ctx.strokeStyle = `rgba(${r},${g},${b},${0.95 * alpha})`;
  ctx.lineWidth = Math.max(1.4, s * 0.09);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.2, cy + s * 0.82);
  ctx.lineTo(cx - s * 0.2, cy + s * 0.3);
  ctx.lineTo(cx + s * 0.2, cy + s * 0.3);
  ctx.lineTo(cx + s * 0.2, cy + s * 0.82);
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.stroke();
  // A lit window: the home is occupied by evidence.
  ctx.fillStyle = `rgba(${PALETTE.ivory[0]},${PALETTE.ivory[1]},${PALETTE.ivory[2]},${0.75 * alpha})`;
  ctx.fillRect(cx - s * 0.6, cy + s * 0.05, s * 0.26, s * 0.22);
  ctx.restore();
}

function ResearchNetworkImpl({ network }: ResearchNetworkProps) {
  const { t } = useLanguage();
  const ring = React.useMemo(() => network.nodes.filter((n) => n.key !== 'complete'), [network.nodes]);
  const activeNode = ring.find((n) => n.state === 'ACTIVE') ?? null;
  const ringRef = React.useRef<NetworkNode[]>(ring);
  ringRef.current = ring;
  const host = React.useRef<HTMLDivElement>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const formation = formationFor(network);
  const formationRef = React.useRef<Formation>(formation);
  formationRef.current = formation;
  // Reduced motion redraws on a formation change; the loop reads the ref.
  const redraw = React.useRef<() => void>(() => {});
  const ringSignature = ring.map((n) => `${n.key}:${n.state}`).join('|');
  React.useEffect(() => {
    redraw.current();
  }, [formation, ringSignature]);

  React.useEffect(() => {
    const el = canvas.current;
    const box = host.current;
    if (!el || !box) return;
    const ctx = el.getContext('2d', { alpha: false });
    if (!ctx) return;

    const reduced = prefersReducedMotion();
    const lowPower = isLowPower();
    const sprites = { 0: glowSprite(PALETTE.ivory), 1: glowSprite(PALETTE.gold), 2: glowSprite(PALETTE.steel) } as const;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let aspect = 1.6;
    let raf = 0;
    let last = 0;
    let visible = true;
    let onScreen = true;
    let frame = 0;
    const eng: Engine = {
      formation: formationRef.current,
      glow: FEEL[formationRef.current].glow,
      links: FEEL[formationRef.current].links,
      particles: [],
      counts: { motes: 0, anchors: 0 },
      t: 0,
      frameMs: 16,
      thin: false,
      wave: formationRef.current === 'WAVE' ? 1 : 0,
      lanes: formationRef.current === 'STREAMS' ? 1 : 0,
      bridge: formationRef.current === 'WEAVE' ? 1 : 0,
    };

    const resize = () => {
      const r = box.getBoundingClientRect();
      const nw = Math.max(1, Math.round(r.width));
      const nh = Math.max(1, Math.round(r.height));
      if (nw === w && nh === h) return;
      const grew = !eng.particles.length || Math.abs(nw * nh - w * h) / Math.max(1, w * h) > 0.4;
      w = nw;
      h = nh;
      dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2);
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      aspect = w / h;
      if (grew) {
        const budget = particleBudget(w, h, lowPower);
        eng.particles = createParticles(budget, aspect);
        eng.counts = { motes: budget.motes, anchors: budget.anchors };
        // Settle the field before the first frame, so it never opens as noise.
        for (let i = 0; i < 90; i++) step(eng.particles, eng.formation, i / 30, 1 / 30, aspect, eng.counts);
        eng.t = 3;
      }
      if (reduced) draw();
    };

    const toPx = (x: number, y: number, z: number): [number, number] => {
      // Restrained parallax: the far layer drifts a few pixels against the near one.
      const cam = Math.sin(eng.t * 0.07) * 6 * (1 - z);
      const s = h * 0.46;
      return [w / 2 + x * s + cam, h / 2 + y * s + Math.cos(eng.t * 0.05) * 3 * (1 - z)];
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Ground: deep navy, a faint warm lift at the centre, darker edges.
      const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      bg.addColorStop(0, '#121A26');
      bg.addColorStop(0.55, PALETTE.ground);
      bg.addColorStop(1, PALETTE.groundEdge);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const glow = eng.glow;
      const ps = eng.particles;
      const unit = h * 0.46;

      // Dust — tiny, deep, faint.
      for (const p of ps) {
        if (p.fam !== 'DUST') continue;
        const [x, y] = toPx(p.x, p.y, p.z);
        const twinkle = 0.75 + 0.25 * Math.sin(eng.t * 0.9 * p.speed + p.phase);
        const [r, g, b] = tintRgb(p.tint);
        ctx.fillStyle = `rgba(${r},${g},${b},${(p.alpha * glow * twinkle * p.z).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, p.size * p.z, 0, Math.PI * 2);
        ctx.fill();
      }

      // Ribbons — the shape of public research (three waves) and of the market
      // (five comparative lanes), drawn as soft continuous curves through
      // the motes of each band, so the formation reads as flow, not dots.
      const ribbon = (bands: number, weight: number, rgb: readonly [number, number, number]) => {
        if (weight < 0.02) return;
        const groups: Particle[][] = Array.from({ length: bands }, () => []);
        for (const p of ps) if (p.fam === 'MOTE') groups[p.slot % bands].push(p);
        ctx.lineWidth = 1.1;
        groups.forEach((g, bi) => {
          if (g.length < 3) return;
          const pts = g.map((p) => toPx(p.x, p.y, p.z)).sort((a, b) => a[0] - b[0]);
          const shimmer = 0.6 + 0.4 * Math.sin(eng.t * 0.7 + bi * 1.3);
          ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(0.16 * weight * shimmer * glow).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length - 1; i++) {
            // Through midpoints: a smooth curve that never kinks at a mote.
            const mx = (pts[i][0] + pts[i + 1][0]) / 2;
            const my = (pts[i][1] + pts[i + 1][1]) / 2;
            ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
          }
          ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
          ctx.stroke();
        });
      };
      ribbon(3, eng.wave, PALETTE.ivory);
      ribbon(5, eng.lanes, PALETTE.gold);

      // Bridges — reconciliation: two bodies of evidence joined by arcs that
      // breathe and carry a travelling spark across.
      if (eng.bridge > 0.02) {
        const left = toPx(-aspect * 0.48, 0, 1);
        const right = toPx(aspect * 0.48, 0, 1);
        for (let i = 0; i < 4; i++) {
          const lift = (i - 1.5) * unit * 0.16 + Math.sin(eng.t * 0.5 + i) * unit * 0.03;
          const cx = (left[0] + right[0]) / 2;
          const cy = h / 2 + lift * 1.6;
          ctx.strokeStyle = `rgba(${PALETTE.gold[0]},${PALETTE.gold[1]},${PALETTE.gold[2]},${(0.14 * eng.bridge * glow).toFixed(3)})`;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(left[0], left[1] + lift * 0.4);
          ctx.quadraticCurveTo(cx, cy, right[0], right[1] + lift * 0.4);
          ctx.stroke();
          // The spark: a point travelling the arc, alternating direction.
          const s = (eng.t * 0.18 + i * 0.27) % 1;
          const u = i % 2 ? 1 - s : s;
          const q = 1 - u;
          const sx = q * q * left[0] + 2 * q * u * cx + u * u * right[0];
          const sy = q * q * (left[1] + lift * 0.4) + 2 * q * u * cy + u * u * (right[1] + lift * 0.4);
          const g = 7;
          ctx.globalAlpha = 0.7 * eng.bridge * Math.sin(Math.PI * u) * glow;
          ctx.drawImage(sprites[1], sx - g, sy - g, g * 2, g * 2);
          ctx.globalAlpha = 1;
        }
      }

      // Links — curved, pulsing, dissolving with distance.
      const linkers = ps.filter((p) => p.fam === 'MOTE' || p.fam === 'ANCHOR');
      if (!eng.thin || frame % 2 === 0) {
        // Reach grows a little on wide fields, where neighbours sit further apart
        // horizontally; on phone-shaped fields (aspect ≈ 1.6) it is unchanged.
        const maxD = unit * 0.34 * eng.links * Math.min(1.5, Math.max(1, Math.sqrt(aspect / 1.6)));
        const used = new Map<Particle, number>();
        ctx.lineWidth = 0.7;
        for (let i = 0; i < linkers.length; i++) {
          const a = linkers[i];
          const [ax, ay] = toPx(a.x, a.y, a.z);
          for (let j = i + 1; j < linkers.length; j++) {
            const b = linkers[j];
            if ((used.get(a) ?? 0) >= 3 || (used.get(b) ?? 0) >= 3) continue;
            const [bx, by] = toPx(b.x, b.y, b.z);
            const dx = bx - ax;
            const dy = by - ay;
            const d = Math.hypot(dx, dy);
            if (d > maxD || d < 2) continue;
            const pulse = 0.55 + 0.45 * Math.sin(eng.t * 1.1 + a.phase + b.phase);
            const alpha = Math.pow(1 - d / maxD, 2) * 0.32 * glow * pulse;
            if (alpha < 0.012) continue;
            // Bend perpendicular to the link, breathing slowly.
            const bend = d * 0.16 * Math.sin(eng.t * 0.45 + a.slot * 0.7 + b.slot * 0.3);
            const cx = (ax + bx) / 2 - (dy / d) * bend;
            const cy = (ay + by) / 2 + (dx / d) * bend;
            const gold = a.fam === 'ANCHOR' || b.fam === 'ANCHOR';
            const [r, g, bl] = gold ? PALETTE.gold : PALETTE.ivory;
            ctx.strokeStyle = `rgba(${r},${g},${bl},${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.quadraticCurveTo(cx, cy, bx, by);
            ctx.stroke();
            used.set(a, (used.get(a) ?? 0) + 1);
            used.set(b, (used.get(b) ?? 0) + 1);
          }
        }
      }

      // Carriers — evidence arriving along curved paths, with a fading trail.
      if (FEEL[eng.formation].carriers) {
        for (const p of ps) {
          if (p.fam !== 'CARRIER' || p.t <= 0 || p.t >= 1) continue;
          const fade = Math.sin(Math.PI * p.t);
          // A continuous streak that tapers and fades behind the head.
          ctx.lineCap = 'round';
          let prev = toPx(...carrierPoint(p, easeInOut(Math.max(0, p.t - 0.12))), 0.9);
          for (let k = 11; k >= 0; k--) {
            const s = Math.max(0, p.t - k * 0.01);
            const [cx, cy] = carrierPoint(p, easeInOut(s));
            const cur = toPx(cx, cy, 0.9);
            const a = (1 - k / 12) * 0.5 * fade * glow;
            ctx.strokeStyle = `rgba(${PALETTE.gold[0]},${PALETTE.gold[1]},${PALETTE.gold[2]},${a.toFixed(3)})`;
            ctx.lineWidth = Math.max(0.3, p.size * 1.1 * (1 - k / 12));
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(cur[0], cur[1]);
            ctx.stroke();
            prev = cur;
          }
          ctx.lineCap = 'butt';
          const [hx, hy] = toPx(p.x, p.y, 0.9);
          const g = 14 * fade;
          ctx.globalAlpha = 0.8 * fade * glow;
          ctx.drawImage(sprites[1], hx - g, hy - g, g * 2, g * 2);
          ctx.globalAlpha = 1;
        }
      }

      // Motes and anchors — individually sized, glowing by depth.
      for (const p of linkers) {
        const [x, y] = toPx(p.x, p.y, p.z);
        const breathe = 0.85 + 0.15 * Math.sin(eng.t * 0.8 * p.speed + p.phase);
        // The theme ring is the structure now; the ambient anchors step back.
        const a = p.alpha * glow * breathe * (p.fam === 'ANCHOR' ? 0.55 : 1);
        const halo = (p.fam === 'ANCHOR' ? 9 : 5.5) * p.size * p.z;
        ctx.globalAlpha = Math.min(1, a * (p.fam === 'ANCHOR' ? 0.9 : 0.6));
        ctx.drawImage(sprites[p.tint], x - halo, y - halo, halo * 2, halo * 2);
        ctx.globalAlpha = 1;
        const [r, g, b] = tintRgb(p.tint);
        ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, a).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, p.size * p.z * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }

      // THE JOURNEY. A fine track through the themes in research order; the
      // stretch the research has already covered is gold, the rest a hairline.
      {
        const nodesJ = ringRef.current;
        const nJ = nodesJ.length;
        if (nJ > 1) {
          const pts = nodesJ.map((_, i) => toPx(...ringPosition(i, nJ, aspect), 1));
          let reached = -1;
          nodesJ.forEach((nd, i) => {
            if (nd.state !== 'IDLE') reached = i;
          });
          // Complete: the journey closes into a full ring.
          const closed = eng.formation === 'REST' && nodesJ.every((nd) => nd.state !== 'IDLE' && nd.state !== 'ACTIVE');
          for (let i = 0; i < nJ - (closed ? 0 : 1); i++) {
            const [ax, ay] = pts[i];
            const [bx, by] = pts[(i + 1) % nJ];
            // Bow each segment outward, so the track reads as a ring, not a polygon.
            const mx = (ax + bx) / 2;
            const my = (ay + by) / 2;
            const ox = mx - w / 2;
            const oy = my - h / 2;
            const od = Math.hypot(ox, oy) || 1;
            const cx = mx + (ox / od) * unit * 0.07;
            const cy = my + (oy / od) * unit * 0.07;
            const covered = closed || i < reached;
            ctx.strokeStyle = covered
              ? `rgba(${PALETTE.gold[0]},${PALETTE.gold[1]},${PALETTE.gold[2]},${(0.32 * Math.min(1, glow + 0.2)).toFixed(3)})`
              : 'rgba(236,230,216,0.07)';
            ctx.lineWidth = covered ? 1.2 : 1;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.quadraticCurveTo(cx, cy, bx, by);
            ctx.stroke();
          }
        }
      }

      // THE THEMES AND THEIR THREADS INTO THE HOUSE.
      // Each research theme sits on the ring; its thread to the house shows
      // its REAL state: idle threads are barely there, finished ones hold a
      // steady gold, the active one flows. Nothing here is a measurement.
      const nodes = ringRef.current;
      const n = nodes.length;
      const houseR = unit * 0.15;
      const cxH = w / 2;
      const cyH = h / 2;
      nodes.forEach((node, i) => {
        const [fx, fy] = ringPosition(i, n, aspect);
        const [nx, ny] = toPx(fx, fy, 1);
        const dx = cxH - nx;
        const dy = cyH - ny;
        const d = Math.hypot(dx, dy) || 1;
        const ex = cxH - (dx / d) * houseR;
        const ey = cyH - (dy / d) * houseR;
        const bend = d * 0.12 * (i % 2 ? 1 : -1) * (1 + 0.15 * Math.sin(eng.t * 0.4 + i));
        const qx = (nx + ex) / 2 - (dy / d) * bend;
        const qy = (ny + ey) / 2 + (dx / d) * bend;
        const st = node.state;
        const active = st === 'ACTIVE';
        const rgb = st === 'UNAVAILABLE' ? PALETTE.steel : st === 'IDLE' ? PALETTE.ivory : PALETTE.gold;
        const alpha = active ? 0.42 : st === 'DONE' ? 0.24 : st === 'PARTIAL' ? 0.2 : st === 'UNAVAILABLE' ? 0.12 : 0.07;
        ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(alpha * Math.min(1.1, glow + 0.2)).toFixed(3)})`;
        ctx.lineWidth = active ? 1.4 : 1;
        if (active) {
          ctx.setLineDash([2, 7]);
          ctx.lineDashOffset = -eng.t * 18;
        } else if (st === 'PARTIAL' || st === 'UNAVAILABLE') {
          ctx.setLineDash([3, 5]);
        }
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.quadraticCurveTo(qx, qy, ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);
        if (active) {
          // Two sparks travelling the thread into the house.
          for (let k = 0; k < 2; k++) {
            const u = (eng.t * 0.32 + k * 0.5) % 1;
            const q = 1 - u;
            const sx = q * q * nx + 2 * q * u * qx + u * u * ex;
            const sy = q * q * ny + 2 * q * u * qy + u * u * ey;
            const g = 9;
            ctx.globalAlpha = 0.85 * Math.sin(Math.PI * u);
            ctx.drawImage(sprites[1], sx - g, sy - g, g * 2, g * 2);
            ctx.globalAlpha = 1;
          }
        }
      });

      // The house — the property, breathing quicker while the report is written.
      const pace = eng.formation === 'CONVERGE' ? 1.6 : eng.formation === 'REST' ? 0.4 : 0.8;
      const pulse = 0.5 + 0.5 * Math.sin(eng.t * pace);
      const haloR = houseR * (1.9 + 0.25 * pulse);
      ctx.globalAlpha = (0.5 + 0.25 * pulse) * Math.min(1.2, glow);
      ctx.drawImage(sprites[1], cxH - haloR, cyH - haloR, haloR * 2, haloR * 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = `rgba(${PALETTE.gold[0]},${PALETTE.gold[1]},${PALETTE.gold[2]},${((0.18 + 0.14 * pulse) * glow).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cxH, cyH, houseR, 0, Math.PI * 2);
      ctx.stroke();
      // Evidence arriving: slow ripples leave the house while research runs.
      if (FEEL[eng.formation].carriers) {
        for (let k = 0; k < 2; k++) {
          const ph = (eng.t / 3.2 + k / 2) % 1;
          const rr = houseR * (1 + ph * 1.5);
          ctx.strokeStyle = `rgba(${PALETTE.gold[0]},${PALETTE.gold[1]},${PALETTE.gold[2]},${((1 - ph) * 0.22 * glow).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(cxH, cyH, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      drawHouse(ctx, cxH, cyH + houseR * 0.04, houseR * 0.52, Math.min(1, glow + 0.25));

      // The theme nodes themselves, on top of their threads.
      nodes.forEach((node, i) => {
        const [fx, fy] = ringPosition(i, n, aspect);
        const [x, y] = toPx(fx, fy, 1);
        const st = node.state;
        if (st === 'ACTIVE') {
          const g = 16 + 5 * Math.sin(eng.t * 2.2);
          ctx.globalAlpha = 0.75;
          ctx.drawImage(sprites[1], x - g, y - g, g * 2, g * 2);
          ctx.globalAlpha = 1;
          // A slow orbit around the theme being researched.
          ctx.strokeStyle = `rgba(${PALETTE.gold[0]},${PALETTE.gold[1]},${PALETTE.gold[2]},0.55)`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, 10, eng.t * 1.1, eng.t * 1.1 + Math.PI * 1.25);
          ctx.stroke();
          const oa = eng.t * 1.1 + Math.PI * 1.25;
          ctx.fillStyle = 'rgba(240,196,110,0.95)';
          ctx.beginPath();
          ctx.arc(x + Math.cos(oa) * 10, y + Math.sin(oa) * 10, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        const r = st === 'ACTIVE' ? 5 : 4;
        const [gr, gg, gb] = PALETTE.gold;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        if (st === 'DONE' || st === 'ACTIVE') {
          ctx.fillStyle = `rgba(${gr},${gg},${gb},0.95)`;
          ctx.fill();
        } else if (st === 'PARTIAL') {
          ctx.fillStyle = PALETTE.ground;
          ctx.fill();
          ctx.strokeStyle = `rgba(${gr},${gg},${gb},0.85)`;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y, r, Math.PI / 2, (Math.PI * 3) / 2);
          ctx.fillStyle = `rgba(${gr},${gg},${gb},0.85)`;
          ctx.fill();
        } else {
          const rgb = st === 'UNAVAILABLE' ? PALETTE.steel : PALETTE.ivory;
          ctx.fillStyle = PALETTE.ground;
          ctx.fill();
          ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${st === 'UNAVAILABLE' ? 0.55 : 0.32})`;
          ctx.stroke();
        }
      });
    };

    const tick = (now: number) => {
      raf = 0;
      if (!visible || !onScreen) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      frame++;
      // Adaptive: a device that cannot keep up sheds dust and halves link work.
      eng.frameMs = eng.frameMs * 0.95 + dt * 1000 * 0.05;
      if (!eng.thin && frame > 120 && eng.frameMs > 26) {
        eng.thin = true;
        let dropped = 0;
        eng.particles = eng.particles.filter((p) => p.fam !== 'DUST' || dropped++ % 2 === 0);
      }
      const f = formationRef.current;
      eng.formation = f;
      // Feel eases over ~1.5 s, so a stage change reads as a transition.
      const k = 1 - Math.exp(-dt / 0.5);
      eng.glow += (FEEL[f].glow - eng.glow) * k;
      eng.links += (FEEL[f].links - eng.links) * k;
      eng.wave += ((f === 'WAVE' ? 1 : 0) - eng.wave) * k;
      eng.lanes += ((f === 'STREAMS' ? 1 : 0) - eng.lanes) * k;
      eng.bridge += ((f === 'WEAVE' ? 1 : 0) - eng.bridge) * k;
      eng.t += dt;
      const nodesNow = ringRef.current;
      const ai = nodesNow.findIndex((x) => x.state === 'ACTIVE');
      step(eng.particles, f, eng.t, dt, aspect, eng.counts, ai >= 0 ? ringPosition(ai, nodesNow.length, aspect) : null);
      draw();
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (reduced || raf || !visible || !onScreen) return;
      last = 0;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    redraw.current = () => {
      if (!reduced) return;
      // A composed still: let the new formation settle, then draw once.
      eng.formation = formationRef.current;
      eng.glow = FEEL[eng.formation].glow;
      eng.links = FEEL[eng.formation].links;
      eng.wave = eng.formation === 'WAVE' ? 1 : 0;
      eng.lanes = eng.formation === 'STREAMS' ? 1 : 0;
      eng.bridge = eng.formation === 'WEAVE' ? 1 : 0;
      for (let i = 0; i < 120; i++) step(eng.particles, eng.formation, eng.t + i / 30, 1 / 30, aspect, eng.counts);
      draw();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(box);
    resize();
    redraw.current();

    const onVisibility = () => {
      visible = !document.hidden;
      if (visible) start();
      else stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const io = new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      if (onScreen) start();
      else stop();
    });
    io.observe(box);
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      redraw.current = () => {};
    };
  }, []);

  return (
    <div
      ref={host}
      aria-hidden="true"
      data-formation={formation}
      className="relative w-full overflow-hidden rounded-xl ring-1 ring-white/5"
      style={{ height: 'clamp(250px, 46vw, 360px)', background: PALETTE.ground }}
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      {/* The theme labels, placed at the same points the canvas draws the
          nodes. On a phone only the active theme is named (the legend below
          lists every one); from sm up, all of them. */}
      {ring.map((node, i) => {
        const pos = ringPercent(i, ring.length);
        const side = Math.abs(pos.cos) > 0.35 ? (pos.cos > 0 ? 'end' : 'start') : pos.sin < 0 ? 'top' : 'bottom';
        const transform =
          side === 'end'
            ? 'translate(12px, -50%)'
            : side === 'start'
              ? 'translate(calc(-100% - 12px), -50%)'
              : side === 'top'
                ? 'translate(-50%, calc(-100% - 10px))'
                : 'translate(-50%, 10px)';
        const active = node.state === 'ACTIVE';
        // Explicit colours: ivory at the opacity its state earns, gold when active.
        const color = active
          ? 'rgb(240,196,110)'
          : node.state === 'DONE'
            ? 'rgba(236,230,216,0.82)'
            : node.state === 'IDLE'
              ? 'rgba(236,230,216,0.42)'
              : 'rgba(236,230,216,0.62)';
        return (
          <span
            key={node.key}
            dir="auto"
            className={`hidden sm:block pointer-events-none absolute max-w-[10rem] rounded-md px-1.5 py-0.5 text-[11.5px] leading-snug tracking-[0.01em] transition-colors duration-700 motion-reduce:transition-none ${
              active ? 'font-semibold' : ''
            } ${side === 'start' ? 'text-end' : side === 'end' ? 'text-start' : 'text-center'}`}
            style={{
              left: `${pos.left}%`,
              top: `${pos.top}%`,
              transform,
              color,
              // A quiet chip, so a name stays legible over passing particles.
              background: active ? 'rgba(11,16,24,0.78)' : 'rgba(11,16,24,0.55)',
              boxShadow: active ? '0 0 0 1px rgba(221,170,72,0.35)' : 'none',
            }}
          >
            {t(node.labelKey)}
          </span>
        );
      })}
      {/* On a phone the ring is too tight for every name: the theme being
          researched now is captioned under the house instead. */}
      {activeNode ? (
        <span
          dir="auto"
          className="sm:hidden pointer-events-none absolute inset-x-4 bottom-3 text-center text-xs font-semibold leading-tight"
          style={{ color: 'rgb(240,196,110)' }}
        >
          {t(activeNode.labelKey)}
        </span>
      ) : null}
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
    a.network.activeKey === b.network.activeKey &&
    a.network.terminal === b.network.terminal &&
    a.network.settled === b.network.settled &&
    a.network.nodes.length === b.network.nodes.length &&
    a.network.nodes.every((n, i) => n.key === b.network.nodes[i].key && n.state === b.network.nodes[i].state),
);
