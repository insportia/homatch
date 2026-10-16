/*
 * Find Property — the live search field (decoration, aria-hidden).
 *
 * One requestAnimationFrame loop drives the pure engine in
 * src/findProperty/motion. The loop pauses while the tab is hidden or the
 * field is scrolled off screen, resizes with its box, draws fewer things at a
 * lower frame rate on low-power devices, and under prefers-reduced-motion
 * paints a single composed still frame instead of animating.
 *
 * The only input is the server's own terminal flag: SEARCHING or SETTLED. It
 * shows no number, no percentage and no source; those live beside it, from
 * the server, in text.
 */
import { useEffect, useRef } from 'react';
import { budgetFor, createField, type FieldMode, type FieldState, resizeField, seedOf, setMode, stepField, stillField } from '@/findProperty/motion/searchField';
import { drawField, type FieldPalette } from '@/findProperty/motion/drawField';

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const lowPowerDevice = (w: number) => typeof window !== 'undefined'
  && (w < 640 || !!window.matchMedia?.('(pointer: coarse)').matches || ((navigator as { hardwareConcurrency?: number }).hardwareConcurrency ?? 8) <= 4);

function paletteOf(el: HTMLElement): FieldPalette {
  const gold = getComputedStyle(el).getPropertyValue('--gold').trim() || '38 92% 56%';
  return { gold, ink: '40 100% 92%', node: '40 30% 90%' };
}

export function SearchField({ searchId, terminal, className = '' }: { searchId: string; terminal: boolean; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef<FieldMode>(terminal ? 'SETTLED' : 'SEARCHING');
  const redrawRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    modeRef.current = terminal ? 'SETTLED' : 'SEARCHING';
    redrawRef.current?.();
  }, [terminal]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const seed = seedOf(searchId);
    const palette = paletteOf(canvas);
    let state: FieldState | null = null;
    let raf = 0, last = 0, visible = !document.hidden, onScreen = true, w = 0, h = 0, low = false;
    const still = reducedMotion();

    const paint = () => { if (state) { ctx.setTransform(1, 0, 0, 1, 0, 0); const dpr = canvas.width / Math.max(1, w); ctx.scale(dpr, dpr); drawField(ctx, state, palette); } };
    const drawStill = () => { state = stillField(seed, w, h, budgetFor(w, h, true), modeRef.current); paint(); };
    const tick = (now: number) => {
      raf = 0;
      if (!state || !visible || !onScreen) return;
      const minGap = 1000 / state.budget.fps - 2;
      if (last && now - last < minGap) { raf = requestAnimationFrame(tick); return; }
      const dt = last ? (now - last) / 1000 : 1 / 60;
      last = now;
      if (state.mode !== modeRef.current) setMode(state, modeRef.current);
      stepField(state, dt);
      paint();
      raf = requestAnimationFrame(tick);
    };
    const start = () => { if (!still && !raf && visible && onScreen && state) { last = 0; raf = requestAnimationFrame(tick); } };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      const nw = Math.max(1, Math.round(box.width)), nh = Math.max(1, Math.round(box.height));
      if (nw === w && nh === h) return;
      w = nw; h = nh; low = lowPowerDevice(w);
      const dpr = Math.min(window.devicePixelRatio || 1, low ? 1.5 : 2);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      if (still) { drawStill(); return; }
      if (!state) state = createField(seed, w, h, budgetFor(w, h, low), modeRef.current);
      else resizeField(state, w, h);
      paint();
      start();
    };
    redrawRef.current = () => { if (still) drawStill(); else start(); };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    const onVisibility = () => { visible = !document.hidden; if (visible) start(); else stop(); };
    document.addEventListener('visibilitychange', onVisibility);
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      if (onScreen) start(); else stop();
    }) : null;
    io?.observe(canvas);
    return () => { stop(); ro.disconnect(); io?.disconnect(); document.removeEventListener('visibilitychange', onVisibility); redrawRef.current = null; };
  }, [searchId]);

  return <canvas ref={canvasRef} aria-hidden="true" data-search-field data-motion={terminal ? 'SETTLED' : 'SEARCHING'} className={`block h-full w-full ${className}`} />;
}
