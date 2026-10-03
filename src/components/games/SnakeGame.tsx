// HOMATCH SNAKE — one shared, lightweight game for the long waits.
//
// It only WATCHES the work it is shown beside (`status`, `stageLabel`): it
// never starts, restarts, pauses, cancels or retries anything, writes nothing
// anywhere and fakes no progress. When the work is ready it says so in the
// bar above the board ("View result"), without stopping the game or leaving
// it; when the work fails it says so quietly, and the game goes on — a
// failed job is never a game over.
//
// Playing: the first move starts it. Swipe anywhere on the board (a turn
// happens as the finger moves, and a sloppy diagonal reads as its main
// direction), tap the board on the side to turn to, or use the arrow pad on a
// touch screen; arrows or WASD on a keyboard (by physical key), Space pauses,
// Enter plays again. Only the board and the pad take touch gestures. The rules
// step in whole cells on their own clock; the picture is drawn every frame in
// between (one requestAnimationFrame loop, the game kept in a ref), so it moves
// smoothly at any refresh rate and React re-renders only when the score or the
// state changes. Reduced motion: a calmer pace and no glow. Loaded lazily,
// only when someone chooses to play.

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Pause, Play, RotateCcw, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  between, type Cell, createGame, type Dir, keyDir, type SnakeState, start, step, swipeDir, tapDir, tickMs, togglePause, turn,
} from '@/lib/games/snake';
import { cn } from '@/lib/utils';

export type WatchedStatus = 'PROCESSING' | 'READY' | 'FAILED';

const COLS = 17;
const ROWS = 17;
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]';
const BEST_KEY = 'hm-snake-best';
const GOLD = 'hsl(38 92% 56%)';
/** A swipe turns as soon as the finger has travelled this far (px), and can turn again in the same gesture. */
const SWIPE_PX = 18;
const FACING: Record<Dir, [number, number]> = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] };

function readBest(): number {
  try { return Number(window.localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
}
function writeBest(n: number) {
  try { window.localStorage.setItem(BEST_KEY, String(n)); } catch { /* private mode: no record kept */ }
}
const prefersReduced = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
const touchScreen = () => {
  try { return window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 640; } catch { return false; }
};

interface Ui { score: number; alive: boolean; paused: boolean; started: boolean; won: boolean }
const uiOf = (g: SnakeState): Ui => ({ score: g.score, alive: g.alive, paused: g.paused, started: g.started, won: g.won });

export default function SnakeGame({ status, stageLabel, onView, onClose }: {
  status: WatchedStatus;
  /** The work's real stage, in the customer's words. */
  stageLabel: string;
  onView: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const reduced = useRef(prefersReduced());
  const [touchUi] = useState(touchScreen);
  // The game itself lives here (read and written by the frame loop and the controls), never in React state.
  const engine = useRef<{ g: SnakeState; prev: Cell[]; acc: number; last: number }>({ g: createGame(COLS, ROWS, Math.random), prev: [], acc: 0, last: 0 });
  const [ui, setUi] = useState<Ui>(() => uiOf(engine.current.g));
  const [best, setBest] = useState(readBest);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const board = useRef<HTMLDivElement | null>(null);
  const pad = useRef<HTMLDivElement | null>(null);
  const size = useRef(0);
  const gesture = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);

  const sync = useCallback(() => {
    const next = uiOf(engine.current.g);
    setUi((u) => (u.score === next.score && u.alive === next.alive && u.paused === next.paused && u.started === next.started && u.won === next.won ? u : next));
  }, []);

  /** Change the game; a jump (turning round, a new game) is drawn where it lands, not slid into. */
  const apply = useCallback((fn: (g: SnakeState) => SnakeState) => {
    const e = engine.current;
    const before = e.g;
    e.g = fn(before);
    if (e.g === before) return;
    if (e.g.snake !== before.snake) e.prev = e.g.snake;
    // The first move: the first step follows quickly, so the game answers at once.
    if (!before.started && e.g.started) e.acc = tickMs(e.g.score, reduced.current) * 0.65;
    sync();
  }, [sync]);

  /** A control's visible answer: the pad's arrow lights for a moment (no re-render). */
  const flash = useCallback((d: Dir) => {
    const b = pad.current?.querySelector<HTMLElement>(`[data-dir="${d}"]`);
    if (!b) return;
    b.dataset.on = '1';
    window.setTimeout(() => { delete b.dataset.on; }, 140);
  }, []);

  const steer = useCallback((d: Dir) => { apply((g) => turn(g, d)); flash(d); }, [apply, flash]);
  const restart = useCallback(() => {
    const e = engine.current;
    e.g = start(createGame(COLS, ROWS, Math.random));
    e.prev = e.g.snake;
    e.acc = 0;
    sync();
  }, [sync]);
  const pause = useCallback(() => { apply(togglePause); }, [apply]);

  useEffect(() => {
    if (ui.score > best) { setBest(ui.score); writeBest(ui.score); }
  }, [ui.score, best]);

  // Keys: only while the game is open; the page's own shortcuts are left alone otherwise.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('button,input,textarea,select') && (e.code === 'Space' || e.code === 'Enter')) return; // a focused button handles its own activation
      const d = keyDir(e);
      if (d) { e.preventDefault(); steer(d); return; }
      if (e.code === 'Space') { e.preventDefault(); pause(); return; }
      if (e.code === 'Enter') { if (!engine.current.g.alive) restart(); return; }
      if (e.code === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [steer, pause, restart, onClose]);

  // The board's size (the canvas is drawn at the device's resolution).
  useEffect(() => {
    const box = board.current;
    const c = canvas.current;
    if (!box || !c) return;
    const fit = () => {
      const px = Math.floor(box.clientWidth);
      if (!px || px === size.current) return;
      size.current = px;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = px * dpr; c.height = px * dpr; c.style.width = `${px}px`; c.style.height = `${px}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // One loop: the rules' clock (fixed steps, whatever the refresh rate) and the picture, every frame.
  useEffect(() => {
    let raf = 0;
    let live = true;
    const draw = (now: number, tFrac: number) => {
      const c = canvas.current; const px = size.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx || !px) return;
      const e = engine.current; const g = e.g;
      const dpr = c.width / px;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cell = px / COLS;
      ctx.fillStyle = '#0C1119';
      ctx.fillRect(0, 0, px, px);
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      for (let y = 0; y < ROWS; y += 1) for (let x = y % 2; x < COLS; x += 2) ctx.fillRect(x * cell, y * cell, cell, cell);
      if (g.food) {
        const pulse = reduced.current ? 0 : Math.sin(now / 260) * 0.04;
        if (!reduced.current) { ctx.shadowColor = GOLD; ctx.shadowBlur = cell * 0.7; }
        ctx.fillStyle = GOLD;
        ctx.beginPath(); ctx.arc((g.food.x + 0.5) * cell, (g.food.y + 0.5) * cell, cell * (0.3 + pulse), 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
      const pts = between(e.prev.length ? e.prev : g.snake, g.snake, tFrac).map((p) => ({ x: (p.x + 0.5) * cell, y: (p.y + 0.5) * cell }));
      if (!pts.length) return;
      ctx.globalAlpha = g.alive ? 1 : 0.55;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(247,244,239,0.78)';
      ctx.lineWidth = cell * 0.62;
      ctx.beginPath();
      ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      for (let i = pts.length - 2; i >= 0; i -= 1) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      const h = pts[0];
      ctx.fillStyle = '#F7F4EF';
      ctx.beginPath(); ctx.arc(h.x, h.y, cell * 0.4, 0, Math.PI * 2); ctx.fill();
      // Two small eyes, looking the way it is going (a buffered turn shows a beat early).
      const [fx, fy] = FACING[g.queue[0] ?? g.dir];
      ctx.fillStyle = '#0C1119';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(h.x + fx * cell * 0.14 - fy * side * cell * 0.15, h.y + fy * cell * 0.14 + fx * side * cell * 0.15, cell * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    const frame = (now: number) => {
      if (!live) return;
      const e = engine.current;
      // A hidden tab stops the frames; coming back never replays the time away.
      const dt = e.last ? Math.min(250, now - e.last) : 0;
      e.last = now;
      let tFrac = 1;
      if (e.g.alive && e.g.started && !e.g.paused) {
        e.acc += dt;
        let steps = 0;
        let interval = tickMs(e.g.score, reduced.current);
        while (e.acc >= interval && steps < 3) {
          const before = e.g;
          e.prev = before.snake;
          e.g = step(before, Math.random);
          e.acc -= interval;
          steps += 1;
          if (!e.g.alive) { e.acc = 0; break; }
          interval = tickMs(e.g.score, reduced.current);
        }
        if (steps) sync();
        tFrac = e.g.alive ? e.acc / interval : 1;
      }
      draw(now, tFrac);
      raf = window.requestAnimationFrame(frame);
    };
    raf = window.requestAnimationFrame(frame);
    return () => { live = false; window.cancelAnimationFrame(raf); };
  }, [sync]);

  // The board: swipes turn as the finger moves; a tap turns towards it. Only the board takes the gesture.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // A press on a button over the board ("Play again") is the button's: capturing it here would send the
    // release to the board and the button's click would never happen.
    if (e.target instanceof Element && e.target.closest('button')) return;
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* an old browser: the gesture still ends on this board */ }
    e.currentTarget.dataset.on = '1';
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const d = swipeDir(e.clientX - g.x, e.clientY - g.y, SWIPE_PX);
    if (!d) return;
    steer(d);
    g.x = e.clientX; g.y = e.clientY; g.moved = true;
  };
  const endGesture = (e: React.PointerEvent<HTMLDivElement>, tap: boolean) => {
    const g = gesture.current;
    delete e.currentTarget.dataset.on;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (!tap || g.moved || !engine.current.g.alive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cell = rect.width / COLS;
    const game = engine.current.g;
    const head = game.snake[0];
    const heading = game.queue[game.queue.length - 1] ?? game.dir;
    const d = tapDir({ x: head.x + 0.5, y: head.y + 0.5 }, heading, { x: (e.clientX - rect.left) / cell, y: (e.clientY - rect.top) / cell });
    if (d) steer(d);
    else if (!game.started) steer(game.dir);
  };

  // The arrow pad: a press acts on touch-down (no click delay); a keyboard press of a focused arrow acts on click.
  const padButton = (d: Dir, Icon: typeof ChevronUp, label: string, area: string) => (
    <button type="button" data-dir={d} aria-label={label}
      onPointerDown={(e) => { e.preventDefault(); steer(d); }}
      onClick={(e) => { if (e.detail === 0) steer(d); }}
      className={cn('grid h-14 place-items-center rounded-2xl bg-white/[0.07] text-white ring-1 ring-white/10 transition-[background-color,transform] duration-100 active:scale-95 data-[on]:bg-[hsl(38_92%_56%)]/30 data-[on]:ring-[hsl(38_92%_56%)]/60', area, RING)}
      data-testid={`snake-pad-${d.toLowerCase()}`}>
      <Icon className="h-6 w-6" aria-hidden="true" />
    </button>
  );

  const statusLine = status === 'READY' ? t('dsx_sn_ready') : status === 'FAILED' ? t('dsx_rec_title') : t('dsx_sn_job', { stage: stageLabel });

  return (
    <div className="fixed inset-0 z-50 flex flex-col overscroll-none bg-[#0C1119] text-white" role="dialog" aria-modal="true" aria-label={t('dsx_sn_play')} data-testid="snake-game" data-status={status}>
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className={cn('flex min-h-11 items-center gap-2 rounded-full transition-colors', status === 'READY' && 'bg-[hsl(38_92%_56%)]/10 ps-3 ring-1 ring-[hsl(38_92%_56%)]/45')} data-testid="snake-bar">
          <p className={cn('min-w-0 flex-1 truncate text-[13px] font-medium', status === 'FAILED' ? 'text-[hsl(0_80%_80%)]' : status === 'READY' ? 'font-semibold text-white' : 'text-white/70')} role="status" aria-live="polite" data-testid="snake-job">
            {status === 'PROCESSING' ? <span className="me-2 inline-block h-2 w-2 rounded-full bg-[hsl(38_92%_56%)] align-middle motion-safe:animate-pulse" aria-hidden="true" /> : null}
            {statusLine}
          </p>
          {status === 'READY' ? (
            <button type="button" onClick={onView} className={cn('h-9 shrink-0 rounded-full bg-[hsl(38_92%_56%)] px-4 text-[13px] font-semibold text-[#0C1119]', RING)} data-testid="snake-ready-view">{t('dsx_sn_view_result')}</button>
          ) : null}
          {status === 'FAILED' ? (
            <button type="button" onClick={onView} className={cn('h-9 shrink-0 rounded-full px-3 text-[13px] font-medium text-white underline underline-offset-4', RING)} data-testid="snake-failed-view">{t('dsx_view')}</button>
          ) : null}
          <button type="button" onClick={onClose} aria-label={t('dsx_sn_close')} className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-white/10', RING)} data-testid="snake-close">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* The score, the board and the pad stay together: low on a phone (where the thumbs are), centred on a desktop. */}
        <div className={cn('flex flex-1 flex-col', touchUi ? 'justify-end' : 'justify-center')}>
        <div className="mx-auto mt-2 flex w-full items-center justify-between text-[14px] font-semibold tabular-nums">
          <span data-testid="snake-score">{t('dsx_sn_score', { n: String(ui.score) })}</span>
          <span className="text-white/60">{t('dsx_sn_best', { n: String(best) })}</span>
        </div>

        <div className="relative mt-2 flex justify-center">
          <div ref={board}
            className={cn('relative aspect-square w-full touch-none select-none overflow-hidden rounded-[20px] ring-1 ring-white/10 transition-shadow duration-150 data-[on]:ring-white/30 [-webkit-tap-highlight-color:transparent]',
              touchUi ? 'max-w-[min(100%,calc(100dvh-18.5rem))]' : 'max-w-[min(100%,calc(100dvh-12rem))]', ui.alive && ui.started && !ui.paused && 'cursor-pointer')}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={(e) => endGesture(e, true)} onPointerCancel={(e) => endGesture(e, false)}
            onContextMenu={(e) => e.preventDefault()}
            role="application" aria-label={t('dsx_sn_board')} data-testid="snake-board" data-started={ui.started ? '1' : '0'}>
            <canvas ref={canvas} className="block h-full w-full" />
            {ui.alive && !ui.started ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4" data-testid="snake-start">
                <p className="rounded-full bg-black/45 px-4 py-2 text-center text-[13px] font-medium text-white/90 backdrop-blur-sm">{t('dsx_sn_start')}</p>
              </div>
            ) : null}
            {ui.paused ? (
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#0C1119]/45">
                <Pause className="h-10 w-10 text-white/80" aria-hidden="true" />
              </div>
            ) : null}
            {!ui.alive ? (
              <div className="absolute inset-0 grid place-items-center bg-[#0C1119]/70" data-testid="snake-over">
                <div className="text-center">
                  <p className="font-display text-[22px] font-semibold">{ui.won ? t('dsx_sn_score', { n: String(ui.score) }) : t('dsx_sn_over')}</p>
                  <button type="button" onClick={restart} autoFocus className={cn('mt-4 inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-[#0C1119] active:scale-95', RING)} data-testid="snake-restart">
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />{t('dsx_sn_restart')}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {touchUi ? (
          // Physical directions, the same in every language (never mirrored).
          <div ref={pad} dir="ltr" className="mx-auto mt-3 grid w-full max-w-[300px] touch-none select-none grid-cols-3 gap-2" data-testid="snake-pad">
            {padButton('UP', ChevronUp, t('dsx_sn_up'), 'col-start-2')}
            {padButton('LEFT', ChevronLeft, t('dsx_sn_left'), 'col-start-1 row-start-2')}
            {padButton('DOWN', ChevronDown, t('dsx_sn_down'), 'col-start-2 row-start-2')}
            {padButton('RIGHT', ChevronRight, t('dsx_sn_right'), 'col-start-3 row-start-2')}
          </div>
        ) : null}

        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-2xs leading-snug text-white/55">{t('dsx_sn_help2')}</p>
          {ui.alive && ui.started ? (
            <button type="button" onClick={pause} className={cn('inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[14px] font-medium ring-1 ring-white/25', RING)} data-testid="snake-pause" aria-pressed={ui.paused}>
              {ui.paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
              {t(ui.paused ? 'dsx_sn_resume' : 'dsx_sn_pause')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
