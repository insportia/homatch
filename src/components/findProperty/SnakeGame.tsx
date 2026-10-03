import { Pause, Play, RotateCcw } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { T } from './format';

/*
 * Optional Snake while a search runs. NOTHING here touches the search: it is a
 * local toy in its own canvas, the search keeps going on the server, and the
 * page polls independently. Keys are captured only while the board has focus,
 * so arrow keys never scroll-jack the page; on touch, swipe on the board.
 */
const CELLS = 18;
const TICK_MS = 130;
type Dir = 'U' | 'D' | 'L' | 'R';
type Cell = { x: number; y: number };
const OPPOSITE: Record<Dir, Dir> = { U: 'D', D: 'U', L: 'R', R: 'L' };
const KEY_DIR: Record<string, Dir> = {
  ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R', w: 'U', s: 'D', a: 'L', d: 'R', W: 'U', S: 'D', A: 'L', D: 'R',
};

function freeCell(snake: Cell[], seed: number): Cell {
  for (let i = 0; i < CELLS * CELLS; i++) {
    const n = (seed * 7919 + i * 104729) % (CELLS * CELLS);
    const c = { x: n % CELLS, y: Math.floor(n / CELLS) };
    if (!snake.some((s) => s.x === c.x && s.y === c.y)) return c;
  }
  return { x: 0, y: 0 };
}

export function SnakeGame({ t, autoFocus = false }: { t: T; autoFocus?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const state = useRef({ snake: [{ x: 8, y: 9 }, { x: 7, y: 9 }, { x: 6, y: 9 }] as Cell[], dir: 'R' as Dir, next: 'R' as Dir, food: { x: 12, y: 9 } as Cell, seed: 1 });
  const [score, setScore] = useState(0);
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const draw = useCallback(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const size = el.width / CELLS;
    ctx.fillStyle = '#0C1119';
    ctx.fillRect(0, 0, el.width, el.height);
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let x = 0; x < CELLS; x++) for (let y = 0; y < CELLS; y++) if ((x + y) % 2 === 0) ctx.fillRect(x * size, y * size, size, size);
    const { snake, food } = state.current;
    ctx.fillStyle = '#F5B841';
    ctx.beginPath();
    ctx.arc((food.x + 0.5) * size, (food.y + 0.5) * size, size * 0.32, 0, Math.PI * 2);
    ctx.fill();
    snake.forEach((c, i) => {
      ctx.fillStyle = i === 0 ? '#F7C964' : 'rgba(245,184,65,0.78)';
      const pad = size * 0.1;
      ctx.fillRect(c.x * size + pad, c.y * size + pad, size - pad * 2, size - pad * 2);
    });
  }, []);

  const reset = useCallback(() => {
    state.current = { snake: [{ x: 8, y: 9 }, { x: 7, y: 9 }, { x: 6, y: 9 }], dir: 'R', next: 'R', food: { x: 12, y: 9 }, seed: state.current.seed + 1 };
    setScore(0);
    setOver(false);
    setRunning(true);
    draw();
    board.current?.focus();
  }, [draw]);

  const turn = useCallback((d: Dir) => {
    const s = state.current;
    if (d !== OPPOSITE[s.dir]) s.next = d;
    if (!running && !over) setRunning(true);
  }, [running, over]);

  useEffect(() => { draw(); if (autoFocus) board.current?.focus(); }, [draw, autoFocus]);

  /* While a finger is on the board the page must not scroll: a swipe is a turn, not a scroll.
     Native listener because React's touch handlers are passive and cannot preventDefault. */
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const stop = (e: TouchEvent) => { e.preventDefault(); };
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const s = state.current;
      s.dir = s.next;
      const head = s.snake[0];
      const next = { x: head.x + (s.dir === 'R' ? 1 : s.dir === 'L' ? -1 : 0), y: head.y + (s.dir === 'D' ? 1 : s.dir === 'U' ? -1 : 0) };
      if (next.x < 0 || next.y < 0 || next.x >= CELLS || next.y >= CELLS || s.snake.some((c) => c.x === next.x && c.y === next.y)) {
        setRunning(false);
        setOver(true);
        return;
      }
      s.snake.unshift(next);
      if (next.x === s.food.x && next.y === s.food.y) {
        s.seed += 1;
        s.food = freeCell(s.snake, s.seed);
        setScore((v) => v + 1);
      } else s.snake.pop();
      draw();
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [running, draw]);

  /* Pause when the tab is hidden; the search does not care either way. */
  useEffect(() => {
    const onHide = () => { if (document.hidden) setRunning(false); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-foreground" aria-live="polite">{t('mps_snake_score', { n: score })}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => (over ? reset() : setRunning((r) => !r))}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-border bg-card px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]"
            aria-label={running ? t('mps_snake_pause') : t('mps_snake_play')}>
            {running ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          </button>
          <button type="button" onClick={reset}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-border bg-card px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]"
            aria-label={t('mps_snake_restart')}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        ref={board}
        tabIndex={0}
        role="application"
        aria-label={t('mps_snake_label')}
        onKeyDown={(e) => {
          const d = KEY_DIR[e.key];
          if (d) { e.preventDefault(); turn(d); }
          else if (e.key === ' ') { e.preventDefault(); if (over) reset(); else setRunning((r) => !r); }
        }}
        onPointerDown={(e) => { touch.current = { x: e.clientX, y: e.clientY }; }}
        onPointerMove={(e) => {
          const start = touch.current;
          if (!start || e.pointerType === 'mouse') return;
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
          turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U'));
          touch.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          const start = touch.current;
          touch.current = null;
          if (!start) return;
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) { if (!running && !over) setRunning(true); return; }
          turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U'));
        }}
        className="relative mx-auto aspect-square w-full max-w-[420px] touch-none select-none overflow-hidden rounded-2xl ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]"
        dir="ltr"
      >
        <canvas ref={canvas} width={CELLS * 24} height={CELLS * 24} className="h-full w-full" />
        {(!running || over) && (
          <div className="absolute inset-0 grid place-items-center bg-[#0C1119]/55 p-4 text-center">
            <p className="text-sm font-medium text-white">{over ? t('mps_snake_over', { n: score }) : t('mps_snake_hint')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
