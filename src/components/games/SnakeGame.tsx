// HOMATCH SNAKE — one shared, lightweight game for the long waits.
//
// It only WATCHES the work it is shown beside (`status`, `stageLabel`): it
// never starts, restarts, pauses, cancels or retries anything, writes nothing
// anywhere and fakes no progress. When the work is ready it says so over the
// board ("View" opens the result, "Keep playing" carries on); when the work
// fails it says so quietly, and the game goes on — a failed job is never a
// game over.
//
// Arrow keys or WASD (by physical key, so any layout steers), Space to pause,
// Enter to play again; swipe on a phone (the board takes the gesture, the
// page does not scroll). Reduced motion: a calmer pace and no glow. Loaded
// lazily, only when someone chooses to play.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { createGame, keyDir, step, swipeDir, tickMs, togglePause, turn, type Dir, type SnakeState } from '@/lib/games/snake';

export type WatchedStatus = 'PROCESSING' | 'READY' | 'FAILED';

const COLS = 17;
const ROWS = 17;
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]';
const BEST_KEY = 'hm-snake-best';

function readBest(): number {
  try { return Number(window.localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
}
function writeBest(n: number) {
  try { window.localStorage.setItem(BEST_KEY, String(n)); } catch { /* private mode: no record kept */ }
}
const prefersReduced = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

export default function SnakeGame({ status, stageLabel, onView, onClose }: {
  status: WatchedStatus;
  /** The work's real stage, in the customer's words. */
  stageLabel: string;
  onView: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const reduced = useRef(prefersReduced());
  const [game, setGame] = useState<SnakeState>(() => createGame(COLS, ROWS, Math.random));
  const [best, setBest] = useState(readBest);
  const [readyOpen, setReadyOpen] = useState(status === 'READY');
  const [readySeen, setReadySeen] = useState(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const board = useRef<HTMLDivElement | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const box = board.current;
    if (!box) return;
    const ro = new ResizeObserver(() => setSize(Math.floor(box.clientWidth)));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // The work became ready while playing: say so once, over the board (the game pauses under it).
  useEffect(() => {
    if (status === 'READY' && !readySeen) { setReadyOpen(true); setGame((g) => (g.alive && !g.paused ? togglePause(g) : g)); }
  }, [status, readySeen]);

  // The clock.
  useEffect(() => {
    if (!game.alive || game.paused || readyOpen) return;
    const id = window.setTimeout(() => setGame((g) => step(g, Math.random)), tickMs(game.score, reduced.current));
    return () => window.clearTimeout(id);
  }, [game, readyOpen]);

  useEffect(() => {
    if (game.score > best) { setBest(game.score); writeBest(game.score); }
  }, [game.score, best]);

  const restart = useCallback(() => setGame(createGame(COLS, ROWS, Math.random)), []);
  const steer = useCallback((d: Dir) => setGame((g) => turn(g, d)), []);

  // Keys: only while the game is open; the page's own shortcuts are left alone otherwise.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('button,input,textarea,select') && e.code !== 'Escape') {
        if (e.code === 'Space' || e.code === 'Enter') return; // a focused button handles its own activation
      }
      const d = keyDir(e);
      if (d) { e.preventDefault(); steer(d); return; }
      if (e.code === 'Space') { e.preventDefault(); setGame((g) => togglePause(g)); return; }
      if (e.code === 'Enter') { setGame((g) => (g.alive ? g : createGame(COLS, ROWS, Math.random))); return; }
      if (e.code === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [steer, onClose]);

  // Drawing: the board in HOMATCH's navy and gold.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    if (!size) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== size * dpr) { c.width = size * dpr; c.height = size * dpr; c.style.width = `${size}px`; c.style.height = `${size}px`; }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cell = size / COLS;
    ctx.fillStyle = '#0C1119';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let y = 0; y < ROWS; y += 1) for (let x = (y % 2); x < COLS; x += 2) ctx.fillRect(x * cell, y * cell, cell, cell);
    if (game.food) {
      const fx = game.food.x * cell + cell / 2;
      const fy = game.food.y * cell + cell / 2;
      if (!reduced.current) { ctx.shadowColor = 'hsl(38 92% 56%)'; ctx.shadowBlur = cell * 0.8; }
      ctx.fillStyle = 'hsl(38 92% 56%)';
      ctx.beginPath(); ctx.arc(fx, fy, cell * 0.32, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    game.snake.forEach((p, i) => {
      const inset = i === 0 ? cell * 0.08 : cell * 0.14;
      ctx.fillStyle = i === 0 ? '#F7F4EF' : `rgba(247,244,239,${Math.max(0.45, 0.92 - i * 0.02)})`;
      const r = cell * 0.28;
      const x = p.x * cell + inset; const y = p.y * cell + inset; const w = cell - inset * 2;
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + w, r); ctx.arcTo(x + w, y + w, x, y + w, r); ctx.arcTo(x, y + w, x, y, r); ctx.arcTo(x, y, x + w, y, r);
      ctx.fill();
    });
  }, [game, size]);

  // Swipes on the board: the board keeps the gesture (touch-action: none), so the page never scrolls under it.
  const onPointerDown = (e: React.PointerEvent) => { touch.current = { x: e.clientX, y: e.clientY }; };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = touch.current; touch.current = null;
    if (!start) return;
    const d = swipeDir(e.clientX - start.x, e.clientY - start.y);
    if (d) steer(d);
    else if (!game.alive) restart();
  };

  const statusLine = status === 'READY' ? t('dsx_ready') : status === 'FAILED' ? t('dsx_fail_title') : t('dsx_sn_job', { stage: stageLabel });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0C1119] text-white" role="dialog" aria-modal="true" aria-label={t('dsx_sn_play')} data-testid="snake-game" data-status={status}>
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <p className={cn('min-w-0 flex-1 truncate text-[13px] font-medium', status === 'FAILED' ? 'text-[hsl(0_80%_80%)]' : 'text-white/70')} role="status" aria-live="polite" data-testid="snake-job">
            {status === 'PROCESSING' ? <span className="me-2 inline-block h-2 w-2 rounded-full bg-[hsl(38_92%_56%)] align-middle motion-safe:animate-pulse" aria-hidden="true" /> : null}
            {statusLine}
          </p>
          {status === 'READY' && !readyOpen ? (
            <button type="button" onClick={onView} className={cn('h-9 rounded-full bg-[hsl(38_92%_56%)] px-4 text-[13px] font-semibold text-[#0C1119]', RING)} data-testid="snake-view-chip">{t('dsx_view')}</button>
          ) : null}
          {status === 'FAILED' ? (
            <button type="button" onClick={onView} className={cn('h-9 rounded-full px-3 text-[13px] font-medium text-white underline underline-offset-4', RING)} data-testid="snake-failed-view">{t('dsx_view')}</button>
          ) : null}
          <button type="button" onClick={onClose} aria-label={t('dsx_sn_close')} className={cn('grid h-11 w-11 place-items-center rounded-full hover:bg-white/10', RING)} data-testid="snake-close">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between text-[14px] font-semibold tabular-nums">
          <span data-testid="snake-score">{t('dsx_sn_score', { n: String(game.score) })}</span>
          <span className="text-white/60">{t('dsx_sn_best', { n: String(best) })}</span>
        </div>

        <div className="relative mt-3 flex flex-1 items-start justify-center">
          <div ref={board} className="relative aspect-square w-full max-w-[min(100%,calc(100dvh-15rem))] touch-none select-none overflow-hidden rounded-[20px] ring-1 ring-white/10"
            onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { touch.current = null; }}
            role="img" aria-label={t('dsx_sn_board')} data-testid="snake-board">
            <canvas ref={canvas} className="block h-full w-full" />
            {!game.alive && !readyOpen ? (
              <div className="absolute inset-0 grid place-items-center bg-[#0C1119]/70" data-testid="snake-over">
                <div className="text-center">
                  <p className="font-display text-[22px] font-semibold">{game.won ? t('dsx_sn_score', { n: String(game.score) }) : t('dsx_sn_over')}</p>
                  <button type="button" onClick={restart} className={cn('mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-semibold text-[#0C1119]', RING)} data-testid="snake-restart">
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />{t('dsx_sn_restart')}
                  </button>
                </div>
              </div>
            ) : null}
            {readyOpen ? (
              <div className="absolute inset-0 grid place-items-center bg-[#0C1119]/90 px-6" data-testid="snake-ready">
                <div className="text-center">
                  <p className="font-display text-[24px] font-semibold">{t('dsx_ready')}</p>
                  <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                    <button type="button" onClick={onView} className={cn('inline-flex h-12 items-center justify-center rounded-full bg-[hsl(38_92%_56%)] px-6 text-[15px] font-semibold text-[#0C1119]', RING)} data-testid="snake-ready-view" autoFocus>
                      {t('dsx_view')}
                    </button>
                    <button type="button" onClick={() => { setReadyOpen(false); setReadySeen(true); }} className={cn('inline-flex h-12 items-center justify-center rounded-full px-6 text-[15px] font-medium text-white ring-1 ring-white/30', RING)} data-testid="snake-ready-continue">
                      {t('dsx_sn_continue')}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-2xs leading-snug text-white/55">{t('dsx_sn_help')}</p>
          {game.alive ? (
            <button type="button" onClick={() => setGame((g) => togglePause(g))} className={cn('inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[14px] font-medium ring-1 ring-white/25', RING)} data-testid="snake-pause" aria-pressed={game.paused}>
              {game.paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
              {t(game.paused ? 'dsx_sn_resume' : 'dsx_sn_pause')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
