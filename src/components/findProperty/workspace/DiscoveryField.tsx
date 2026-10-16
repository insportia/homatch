/*
 * Find Property — the discovery field (presentation only).
 *
 * Verify's intelligence-field engine (src/verify/motion/intelligenceField.ts),
 * driven by THIS search's real source states: every property site the search
 * was sent to sits on the ring; its thread into the home shows its real state.
 * Searching threads flow, finished ones hold a steady gold, a site that could
 * not answer is a quiet steel dash. There is no percentage, no countdown and
 * no invented count; the field never says a site succeeded before it did.
 *
 * One requestAnimationFrame loop, paused when the tab is hidden or the field
 * is off screen; under prefers-reduced-motion a single composed still, redrawn
 * only when a source changes state. Decorative (aria-hidden): the source list
 * beside it carries every name and state as text.
 */
import React from 'react';
import {
  FEEL, PALETTE, carrierPoint, createParticles, easeInOut, particleBudget, ringPercent, ringPosition, step, tintRgb,
  type Formation, type Particle,
} from './fieldMotion';

export type FieldNodeState = 'IDLE' | 'ACTIVE' | 'DONE' | 'UNAVAILABLE';
export interface FieldNode { key: string; label: string; state: FieldNodeState }

export function fieldFormation(nodes: FieldNode[], terminal: boolean): Formation {
  if (terminal) return nodes.length && nodes.every((n) => n.state === 'UNAVAILABLE') ? 'DIM' : 'REST';
  return nodes.some((n) => n.state === 'ACTIVE') ? 'STREAMS' : 'GATHER';
}

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

const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const lowPower = () => {
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return (n.hardwareConcurrency ?? 8) <= 4 || (n.deviceMemory ?? 8) <= 4 || n.connection?.saveData === true;
};

/** A home drawn in strokes, at the centre of the search. */
function drawHome(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, alpha: number) {
  const [r, g, b] = PALETTE.gold;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.78, cy - s * 0.1);
  ctx.lineTo(cx - s * 0.78, cy + s * 0.82);
  ctx.lineTo(cx + s * 0.78, cy + s * 0.82);
  ctx.lineTo(cx + s * 0.78, cy - s * 0.1);
  ctx.moveTo(cx - s * 1.02, cy + s * 0.08);
  ctx.lineTo(cx, cy - s * 0.92);
  ctx.lineTo(cx + s * 1.02, cy + s * 0.08);
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
  ctx.fillStyle = `rgba(${PALETTE.ivory[0]},${PALETTE.ivory[1]},${PALETTE.ivory[2]},${0.75 * alpha})`;
  ctx.fillRect(cx - s * 0.6, cy + s * 0.05, s * 0.26, s * 0.22);
  ctx.restore();
}

function DiscoveryFieldImpl({ nodes, terminal }: { nodes: FieldNode[]; terminal: boolean }) {
  const host = React.useRef<HTMLDivElement>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const formation = fieldFormation(nodes, terminal);
  const nodesRef = React.useRef(nodes);
  nodesRef.current = nodes;
  const formationRef = React.useRef(formation);
  formationRef.current = formation;
  const redraw = React.useRef<() => void>(() => {});
  const signature = nodes.map((n) => `${n.key}:${n.state}`).join('|');
  React.useEffect(() => { redraw.current(); }, [formation, signature]);

  React.useEffect(() => {
    const el = canvas.current;
    const box = host.current;
    if (!el || !box) return;
    const ctx = el.getContext('2d', { alpha: false });
    if (!ctx) return;
    const reduced = reducedMotion();
    const low = lowPower();
    const sprites = { 0: glowSprite(PALETTE.ivory), 1: glowSprite(PALETTE.gold), 2: glowSprite(PALETTE.steel) } as const;
    let w = 0, h = 0, dpr = 1, aspect = 1.6, raf = 0, last = 0, visible = true, onScreen = true;
    let particles: Particle[] = [];
    let counts = { motes: 0, anchors: 0 };
    let t = 0, glow = FEEL[formationRef.current].glow, links = FEEL[formationRef.current].links;
    let lanes = formationRef.current === 'STREAMS' ? 1 : 0;

    const resize = () => {
      const r = box.getBoundingClientRect();
      const nw = Math.max(1, Math.round(r.width));
      const nh = Math.max(1, Math.round(r.height));
      if (nw === w && nh === h) return;
      const grew = !particles.length || Math.abs(nw * nh - w * h) / Math.max(1, w * h) > 0.4;
      w = nw; h = nh;
      dpr = Math.min(window.devicePixelRatio || 1, low ? 1.5 : 2);
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      aspect = w / h;
      if (grew) {
        const budget = particleBudget(w, h, low);
        particles = createParticles(budget, aspect, 0x4d0e);
        counts = { motes: budget.motes, anchors: budget.anchors };
        for (let i = 0; i < 90; i++) step(particles, formationRef.current, i / 30, 1 / 30, aspect, counts);
        t = 3;
      }
      if (reduced) draw();
    };

    const toPx = (x: number, y: number, z: number): [number, number] => {
      const cam = Math.sin(t * 0.07) * 6 * (1 - z);
      const s = h * 0.46;
      return [w / 2 + x * s + cam, h / 2 + y * s + Math.cos(t * 0.05) * 3 * (1 - z)];
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      bg.addColorStop(0, '#121A26');
      bg.addColorStop(0.55, PALETTE.ground);
      bg.addColorStop(1, PALETTE.groundEdge);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const unit = h * 0.46;
      const f = formationRef.current;

      for (const p of particles) {
        if (p.fam !== 'DUST') continue;
        const [x, y] = toPx(p.x, p.y, p.z);
        const [r, g, b] = tintRgb(p.tint);
        ctx.fillStyle = `rgba(${r},${g},${b},${(p.alpha * glow * (0.75 + 0.25 * Math.sin(t * 0.9 * p.speed + p.phase)) * p.z).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, p.size * p.z, 0, Math.PI * 2);
        ctx.fill();
      }

      // Comparative lanes while sites are being read: prices side by side.
      if (lanes > 0.02) {
        const groups: Particle[][] = Array.from({ length: 5 }, () => []);
        for (const p of particles) if (p.fam === 'MOTE') groups[p.slot % 5].push(p);
        ctx.lineWidth = 1.1;
        groups.forEach((g, bi) => {
          if (g.length < 3) return;
          const pts = g.map((p) => toPx(p.x, p.y, p.z)).sort((a, b) => a[0] - b[0]);
          ctx.strokeStyle = `rgba(${PALETTE.gold[0]},${PALETTE.gold[1]},${PALETTE.gold[2]},${(0.16 * lanes * (0.6 + 0.4 * Math.sin(t * 0.7 + bi * 1.3)) * glow).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length - 1; i++) ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
          ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
          ctx.stroke();
        });
      }

      const linkers = particles.filter((p) => p.fam === 'MOTE' || p.fam === 'ANCHOR');
      const maxD = unit * 0.34 * links * Math.min(1.5, Math.max(1, Math.sqrt(aspect / 1.6)));
      const used = new Map<Particle, number>();
      ctx.lineWidth = 0.7;
      for (let i = 0; i < linkers.length; i++) {
        const a = linkers[i];
        const [ax, ay] = toPx(a.x, a.y, a.z);
        for (let j = i + 1; j < linkers.length; j++) {
          const b = linkers[j];
          if ((used.get(a) ?? 0) >= 3 || (used.get(b) ?? 0) >= 3) continue;
          const [bx, by] = toPx(b.x, b.y, b.z);
          const d = Math.hypot(bx - ax, by - ay);
          if (d > maxD || d < 2) continue;
          const alpha = Math.pow(1 - d / maxD, 2) * 0.32 * glow * (0.55 + 0.45 * Math.sin(t * 1.1 + a.phase + b.phase));
          if (alpha < 0.012) continue;
          const [r, g, bl] = a.fam === 'ANCHOR' || b.fam === 'ANCHOR' ? PALETTE.gold : PALETTE.ivory;
          ctx.strokeStyle = `rgba(${r},${g},${bl},${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
          used.set(a, (used.get(a) ?? 0) + 1);
          used.set(b, (used.get(b) ?? 0) + 1);
        }
      }

      if (FEEL[f].carriers) {
        for (const p of particles) {
          if (p.fam !== 'CARRIER' || p.t <= 0 || p.t >= 1) continue;
          const fade = Math.sin(Math.PI * p.t);
          ctx.lineCap = 'round';
          let prev = toPx(...carrierPoint(p, easeInOut(Math.max(0, p.t - 0.12))), 0.9);
          for (let k = 11; k >= 0; k--) {
            const cur = toPx(...carrierPoint(p, easeInOut(Math.max(0, p.t - k * 0.01))), 0.9);
            ctx.strokeStyle = `rgba(${PALETTE.gold[0]},${PALETTE.gold[1]},${PALETTE.gold[2]},${((1 - k / 12) * 0.5 * fade * glow).toFixed(3)})`;
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

      for (const p of linkers) {
        const [x, y] = toPx(p.x, p.y, p.z);
        const a = p.alpha * glow * (0.85 + 0.15 * Math.sin(t * 0.8 * p.speed + p.phase)) * (p.fam === 'ANCHOR' ? 0.55 : 1);
        const halo = (p.fam === 'ANCHOR' ? 9 : 5.5) * p.size * p.z;
        ctx.globalAlpha = Math.min(1, a * 0.6);
        ctx.drawImage(sprites[p.tint], x - halo, y - halo, halo * 2, halo * 2);
        ctx.globalAlpha = 1;
        const [r, g, b] = tintRgb(p.tint);
        ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, a).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, p.size * p.z * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }

      // Each site on the ring, its thread into the home showing its real state.
      const nodes = nodesRef.current;
      const n = nodes.length;
      const homeR = unit * 0.15;
      const cx = w / 2, cy = h / 2;
      nodes.forEach((node, i) => {
        const [nx, ny] = toPx(...ringPosition(i, n, aspect), 1);
        const dx = cx - nx, dy = cy - ny;
        const d = Math.hypot(dx, dy) || 1;
        const ex = cx - (dx / d) * homeR, ey = cy - (dy / d) * homeR;
        const bend = d * 0.12 * (i % 2 ? 1 : -1) * (1 + 0.15 * Math.sin(t * 0.4 + i));
        const qx = (nx + ex) / 2 - (dy / d) * bend, qy = (ny + ey) / 2 + (dx / d) * bend;
        const active = node.state === 'ACTIVE';
        const rgb = node.state === 'UNAVAILABLE' ? PALETTE.steel : node.state === 'IDLE' ? PALETTE.ivory : PALETTE.gold;
        const alpha = active ? 0.42 : node.state === 'DONE' ? 0.26 : node.state === 'UNAVAILABLE' ? 0.12 : 0.07;
        ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(alpha * Math.min(1.1, glow + 0.2)).toFixed(3)})`;
        ctx.lineWidth = active ? 1.4 : 1;
        if (active) { ctx.setLineDash([2, 7]); ctx.lineDashOffset = -t * 18; } else if (node.state === 'UNAVAILABLE') ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.quadraticCurveTo(qx, qy, ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);
        if (active) {
          for (let k = 0; k < 2; k++) {
            const u = (t * 0.32 + k * 0.5 + i * 0.13) % 1;
            const q = 1 - u;
            const sx = q * q * nx + 2 * q * u * qx + u * u * ex;
            const sy = q * q * ny + 2 * q * u * qy + u * u * ey;
            ctx.globalAlpha = 0.85 * Math.sin(Math.PI * u);
            ctx.drawImage(sprites[1], sx - 9, sy - 9, 18, 18);
            ctx.globalAlpha = 1;
          }
        }
      });

      const pace = f === 'REST' ? 0.4 : 0.8;
      const pulse = 0.5 + 0.5 * Math.sin(t * pace);
      const haloR = homeR * (1.9 + 0.25 * pulse);
      ctx.globalAlpha = (0.5 + 0.25 * pulse) * Math.min(1.2, glow);
      ctx.drawImage(sprites[1], cx - haloR, cy - haloR, haloR * 2, haloR * 2);
      ctx.globalAlpha = 1;
      if (FEEL[f].carriers) {
        for (let k = 0; k < 2; k++) {
          const ph = (t / 3.2 + k / 2) % 1;
          ctx.strokeStyle = `rgba(${PALETTE.gold[0]},${PALETTE.gold[1]},${PALETTE.gold[2]},${((1 - ph) * 0.22 * glow).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(cx, cy, homeR * (1 + ph * 1.5), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      drawHome(ctx, cx, cy + homeR * 0.04, homeR * 0.52, Math.min(1, glow + 0.25));

      nodes.forEach((node, i) => {
        const [x, y] = toPx(...ringPosition(i, n, aspect), 1);
        const [gr, gg, gb] = PALETTE.gold;
        if (node.state === 'ACTIVE') {
          const g = 16 + 5 * Math.sin(t * 2.2 + i);
          ctx.globalAlpha = 0.75;
          ctx.drawImage(sprites[1], x - g, y - g, g * 2, g * 2);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = `rgba(${gr},${gg},${gb},0.55)`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, 10, t * 1.1 + i, t * 1.1 + i + Math.PI * 1.25);
          ctx.stroke();
        }
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, node.state === 'ACTIVE' ? 5 : 4, 0, Math.PI * 2);
        if (node.state === 'DONE' || node.state === 'ACTIVE') {
          ctx.fillStyle = `rgba(${gr},${gg},${gb},0.95)`;
          ctx.fill();
        } else {
          const rgb = node.state === 'UNAVAILABLE' ? PALETTE.steel : PALETTE.ivory;
          ctx.fillStyle = PALETTE.ground;
          ctx.fill();
          ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${node.state === 'UNAVAILABLE' ? 0.55 : 0.32})`;
          ctx.stroke();
        }
      });
    };

    const tick = (now: number) => {
      raf = 0;
      if (!visible || !onScreen) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const f = formationRef.current;
      const k = 1 - Math.exp(-dt / 0.5);
      glow += (FEEL[f].glow - glow) * k;
      links += (FEEL[f].links - links) * k;
      lanes += ((f === 'STREAMS' ? 1 : 0) - lanes) * k;
      t += dt;
      // Arrivals come from the sites being read right now, taking turns.
      const nodes = nodesRef.current;
      const active = nodes.map((nd, i) => (nd.state === 'ACTIVE' ? i : -1)).filter((i) => i >= 0);
      const from = active.length ? ringPosition(active[Math.floor(t / 3) % active.length], nodes.length, aspect) : null;
      step(particles, f, t, dt, aspect, counts, from);
      draw();
      raf = requestAnimationFrame(tick);
    };
    const start = () => { if (reduced || raf || !visible || !onScreen) return; last = 0; raf = requestAnimationFrame(tick); };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
    redraw.current = () => {
      if (!reduced) return;
      const f = formationRef.current;
      glow = FEEL[f].glow; links = FEEL[f].links; lanes = f === 'STREAMS' ? 1 : 0;
      for (let i = 0; i < 120; i++) step(particles, f, t + i / 30, 1 / 30, aspect, counts);
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    resize();
    redraw.current();
    const onVisibility = () => { visible = !document.hidden; if (visible) start(); else stop(); };
    document.addEventListener('visibilitychange', onVisibility);
    const io = new IntersectionObserver((entries) => { onScreen = entries.some((e) => e.isIntersecting); if (onScreen) start(); else stop(); });
    io.observe(box);
    start();
    return () => { stop(); ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVisibility); redraw.current = () => {}; };
  }, []);

  const active = nodes.filter((n) => n.state === 'ACTIVE');
  return (
    <div ref={host} aria-hidden="true" data-formation={formation} data-discovery-field
      className="relative w-full overflow-hidden rounded-2xl ring-1 ring-black/5"
      style={{ height: 'clamp(220px, 42vw, 340px)', background: PALETTE.ground }}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      {nodes.map((node, i) => {
        const pos = ringPercent(i, nodes.length);
        const side = Math.abs(pos.cos) > 0.35 ? (pos.cos > 0 ? 'end' : 'start') : pos.sin < 0 ? 'top' : 'bottom';
        const transform = side === 'end' ? 'translate(12px, -50%)' : side === 'start' ? 'translate(calc(-100% - 12px), -50%)'
          : side === 'top' ? 'translate(-50%, calc(-100% - 10px))' : 'translate(-50%, 10px)';
        const on = node.state === 'ACTIVE';
        const color = on ? 'rgb(240,196,110)' : node.state === 'DONE' ? 'rgba(236,230,216,0.85)' : node.state === 'IDLE' ? 'rgba(236,230,216,0.45)' : 'rgba(170,186,210,0.7)';
        return (
          <span key={node.key} dir="auto"
            className={`pointer-events-none absolute hidden max-w-[9rem] rounded-md px-1.5 py-0.5 text-2xs leading-snug transition-colors duration-700 motion-reduce:transition-none sm:block ${on ? 'font-semibold' : ''}`}
            style={{ left: `${pos.left}%`, top: `${pos.top}%`, transform, color, background: on ? 'rgba(11,16,24,0.78)' : 'rgba(11,16,24,0.55)', boxShadow: on ? '0 0 0 1px rgba(221,170,72,0.35)' : 'none' }}>
            {node.label}
          </span>
        );
      })}
      {active.length ? (
        <span dir="auto" className="pointer-events-none absolute inset-x-4 bottom-3 text-center text-xs font-semibold leading-tight sm:hidden" style={{ color: 'rgb(240,196,110)' }}>
          {active.map((n) => n.label).join(' · ')}
        </span>
      ) : null}
    </div>
  );
}

export const DiscoveryField = React.memo(DiscoveryFieldImpl,
  (a, b) => a.terminal === b.terminal && a.nodes.length === b.nodes.length && a.nodes.every((n, i) => n.key === b.nodes[i].key && n.state === b.nodes[i].state && n.label === b.nodes[i].label));
