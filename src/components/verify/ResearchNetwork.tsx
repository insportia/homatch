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
import type { NetworkState } from '@/verify/researchNetwork';
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
}

function ResearchNetworkImpl({ network }: ResearchNetworkProps) {
  const host = React.useRef<HTMLDivElement>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const formation = formationFor(network);
  const formationRef = React.useRef<Formation>(formation);
  formationRef.current = formation;
  // Reduced motion redraws on a formation change; the loop reads the ref.
  const redraw = React.useRef<() => void>(() => {});
  React.useEffect(() => {
    redraw.current();
  }, [formation]);

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
          for (let k = 5; k >= 0; k--) {
            const s = Math.max(0, p.t - k * 0.022);
            const [cx, cy] = carrierPoint(p, easeInOut(s));
            const [x, y] = toPx(cx, cy, 0.9);
            const a = (1 - k / 6) * 0.55 * fade * glow;
            ctx.fillStyle = `rgba(${PALETTE.gold[0]},${PALETTE.gold[1]},${PALETTE.gold[2]},${a.toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(x, y, Math.max(0.4, p.size * (1 - k / 7)), 0, Math.PI * 2);
            ctx.fill();
          }
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
        const a = p.alpha * glow * breathe;
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

      // The property — a warm core that breathes; quicker while the report is written.
      const pace = eng.formation === 'CONVERGE' ? 1.6 : eng.formation === 'REST' ? 0.4 : 0.8;
      const pulse = 0.5 + 0.5 * Math.sin(eng.t * pace);
      const core = unit * (0.13 + 0.025 * pulse);
      ctx.globalAlpha = (0.55 + 0.25 * pulse) * Math.min(1.2, glow);
      ctx.drawImage(sprites[1], w / 2 - core * 2.2, h / 2 - core * 2.2, core * 4.4, core * 4.4);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = `rgba(${PALETTE.gold[0]},${PALETTE.gold[1]},${PALETTE.gold[2]},${(0.25 + 0.2 * pulse) * glow})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, unit * 0.075, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(${PALETTE.ivory[0]},${PALETTE.ivory[1]},${PALETTE.ivory[2]},${0.85 * Math.min(1, glow + 0.2)})`;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 2.6, 0, Math.PI * 2);
      ctx.fill();
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
      eng.t += dt;
      step(eng.particles, f, eng.t, dt, aspect, eng.counts);
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
      style={{ height: 'clamp(200px, 42vw, 300px)', background: PALETTE.ground }}
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
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
    a.network.settled === b.network.settled,
);
