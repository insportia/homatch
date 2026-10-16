// THE ACTIVE-SEARCH ANIMATION (Find Buyers / Find Tenants).
//
// A canvas drawing of src/findBuyers/motion/searchField.ts: a large network of
// paths that keep branching and reconnecting, fine particles, and a gold,
// snake-like search head travelling through it. Decorative (aria-hidden): the
// words beside it say what is happening; the picture never carries a count, a
// percentage, a finished task or a source name.
//
//   - Its intensity is the server's lifecycle only (fieldModeFor(state)).
//   - One requestAnimationFrame loop, started on mount, stopped on unmount;
//     it pauses while the tab is hidden or the canvas is off screen
//     (IntersectionObserver) and redraws on resize (ResizeObserver).
//   - Low-power devices and phones get a smaller particle budget and a lower
//     pixel ratio.
//   - prefers-reduced-motion, or a PAUSED search: one composed still frame.
//   - Seeded by the campaign id: a refresh draws the same network.
import React, { useEffect, useRef } from 'react';
import {
  buildField, edgeAlpha, fieldModeFor, hashSeed, headPosition, intensityFor, particleBudget, settle, stepField, type Field,
} from '@/findBuyers/motion/searchField';

function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
function isLowPower(width: number): boolean {
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return width < 520 || (n.hardwareConcurrency ?? 8) <= 4 || (n.deviceMemory ?? 8) <= 4 || n.connection?.saveData === true;
}

const GOLD = [244, 196, 92] as const;
const IVORY = [236, 228, 210] as const;
const STEEL = [150, 176, 214] as const;
const rgba = (c: readonly number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

function draw(ctx: CanvasRenderingContext2D, f: Field, w: number, h: number, intensity: number) {
  const sx = w / f.aspect; const sy = h;
  const X = (x: number) => x * sx; const Y = (y: number) => y * sy;
  ctx.clearRect(0, 0, w, h);
  const calm = intensity < 0.2;

  /* depth: soft vignette glow behind the head */
  const hp = headPosition(f);
  const g = ctx.createRadialGradient(X(hp.x), Y(hp.y), 0, X(hp.x), Y(hp.y), Math.max(w, h) * 0.45);
  g.addColorStop(0, rgba(GOLD, calm ? 0.05 : 0.12));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  /* motes */
  for (const m of f.motes) {
    ctx.fillStyle = rgba(m.z > 0.7 ? IVORY : STEEL, 0.12 + 0.28 * m.z * (0.6 + 0.4 * Math.sin(f.time * 1.3 + m.phase)));
    ctx.beginPath(); ctx.arc(X(m.x), Y(m.y), 0.5 + m.z * 1.1, 0, Math.PI * 2); ctx.fill();
  }

  /* paths: faint everywhere, warmer where the search has just been */
  ctx.lineCap = 'round';
  for (const e of f.edges) {
    const a = f.nodes[e.a]; const b = f.nodes[e.b];
    const heat = Math.max(a.glow, b.glow);
    const alpha = edgeAlpha(f, e) * (0.1 + heat * 0.45);
    ctx.strokeStyle = heat > 0.05 ? rgba(GOLD, alpha) : rgba(STEEL, alpha * 0.9);
    ctx.lineWidth = 0.6 + heat * 1.2;
    ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke();
  }

  /* nodes */
  for (const n of f.nodes) {
    const breathe = 0.5 + 0.5 * Math.sin(f.time * 1.6 + n.phase);
    if (n.glow > 0.02) {
      ctx.fillStyle = rgba(GOLD, n.glow * 0.22);
      ctx.beginPath(); ctx.arc(X(n.x), Y(n.y), 3 + n.glow * 7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = n.glow > 0.05 ? rgba(GOLD, 0.55 + n.glow * 0.45) : rgba(IVORY, 0.22 + breathe * 0.18);
    ctx.beginPath(); ctx.arc(X(n.x), Y(n.y), n.r + n.glow * 1.2, 0, Math.PI * 2); ctx.fill();
  }

  /* branching pulses, each with a short tail */
  for (const p of f.pulses) {
    const a = f.nodes[p.from]; const b = f.nodes[p.to];
    const x = a.x + (b.x - a.x) * p.t; const y = a.y + (b.y - a.y) * p.t;
    const tx = a.x + (b.x - a.x) * Math.max(0, p.t - 0.18); const ty = a.y + (b.y - a.y) * Math.max(0, p.t - 0.18);
    ctx.strokeStyle = rgba(GOLD, 0.55); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(X(tx), Y(ty)); ctx.lineTo(X(x), Y(y)); ctx.stroke();
    ctx.fillStyle = rgba([255, 236, 170], 0.95);
    ctx.beginPath(); ctx.arc(X(x), Y(y), 1.8, 0, Math.PI * 2); ctx.fill();
  }

  /* the snake: a tapered gold body, brightest at the head */
  const body = f.trail;
  for (let i = body.length - 1; i > 0; i -= 1) {
    const k = 1 - i / body.length;
    ctx.strokeStyle = rgba(GOLD, (calm ? 0.35 : 0.85) * k);
    ctx.lineWidth = 0.8 + k * 3.4;
    ctx.beginPath(); ctx.moveTo(X(body[i].x), Y(body[i].y)); ctx.lineTo(X(body[i - 1].x), Y(body[i - 1].y)); ctx.stroke();
  }
  const halo = ctx.createRadialGradient(X(hp.x), Y(hp.y), 0, X(hp.x), Y(hp.y), 14);
  halo.addColorStop(0, rgba([255, 240, 190], calm ? 0.5 : 0.95));
  halo.addColorStop(1, rgba(GOLD, 0));
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(X(hp.x), Y(hp.y), 14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = rgba([255, 248, 224], 1);
  ctx.beginPath(); ctx.arc(X(hp.x), Y(hp.y), 2.6, 0, Math.PI * 2); ctx.fill();
}

export function SearchNetworkField({ state, seedKey, className }: {
  /** The server lifecycle state (find_buyers_campaign_status). */
  state: string | null | undefined;
  /** The campaign id: the same search draws the same network. */
  seedKey: string;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mode = fieldModeFor(state);
  const intensityRef = useRef(intensityFor(mode));
  const redrawRef = useRef<() => void>(() => {});
  const kickRef = useRef<() => void>(() => {});

  /* The status changes the intensity without rebuilding the field. */
  useEffect(() => {
    intensityRef.current = intensityFor(mode);
    redrawRef.current();
    kickRef.current();
  }, [mode]);

  useEffect(() => {
    const wrap = wrapRef.current; const canvas = canvasRef.current;
    if (!wrap || !canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const reduced = prefersReducedMotion();
    wrap.dataset.motion = reduced ? 'reduced' : 'full';
    let field: Field | null = null;
    let w = 0; let h = 0; let raf = 0; let last = 0;
    let visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    let onScreen = true;

    const paint = () => { if (field) draw(ctx, field, w, h, intensityRef.current); };
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const nw = Math.max(1, Math.round(r.width)); const nh = Math.max(1, Math.round(r.height));
      if (nw === w && nh === h && field) return;
      w = nw; h = nh;
      const low = isLowPower(w);
      const dpr = Math.min(window.devicePixelRatio || 1, low ? 1.5 : 2);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      field = buildField(hashSeed(seedKey), w / h, particleBudget(w, h, low));
      settle(field, 4);
      paint();
    };
    const tick = (ts: number) => {
      raf = 0;
      const k = intensityRef.current;
      if (!field || reduced || k === 0 || !visible || !onScreen) return;
      const dt = last ? Math.min(0.05, (ts - last) / 1000) : 1 / 60;
      last = ts;
      stepField(field, dt, k);
      paint();
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (reduced || raf || !visible || !onScreen || intensityRef.current === 0) return;
      last = 0;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
    redrawRef.current = paint;
    kickRef.current = start;

    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { resize(); }) : null;
    ro?.observe(wrap);
    const onVisibility = () => { visible = document.visibilityState !== 'hidden'; if (visible) start(); else stop(); };
    document.addEventListener('visibilitychange', onVisibility);
    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => { onScreen = entries.some((e) => e.isIntersecting); if (onScreen) start(); else stop(); }, { threshold: 0 })
      : null;
    io?.observe(wrap);
    start();
    return () => {
      stop();
      ro?.disconnect();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      redrawRef.current = () => {};
      kickRef.current = () => {};
    };
  }, [seedKey]);

  return (
    <div ref={wrapRef} aria-hidden="true" data-testid="fbl-field" data-mode={mode} className={className}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

export default SearchNetworkField;
