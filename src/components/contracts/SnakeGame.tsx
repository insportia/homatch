// A small Snake to pass the wait while a contract is read. Entirely local:
// no network, no storage beyond this tab's best score, no effect on the
// analysis. Arrow keys, swipes or the on-screen pad steer it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

const N = 16;
const CELL = 16;
type P = { x: number; y: number };
type Dir = 'U' | 'D' | 'L' | 'R';
const STEP: Record<Dir, P> = { U: { x: 0, y: -1 }, D: { x: 0, y: 1 }, L: { x: -1, y: 0 }, R: { x: 1, y: 0 } };
const OPPOSITE: Record<Dir, Dir> = { U: 'D', D: 'U', L: 'R', R: 'L' };

function freeCell(snake: P[]): P {
  for (;;) {
    const p = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) };
    if (!snake.some((s) => s.x === p.x && s.y === p.y)) return p;
  }
}

export default function SnakeGame({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ snake: [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }] as P[], dir: 'R' as Dir, next: 'R' as Dir, food: { x: 12, y: 8 } as P });
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const [best, setBest] = useState(() => { try { return Number(sessionStorage.getItem('hm.snake.best') ?? 0); } catch { return 0; } });

  const steer = useCallback((d: Dir) => { if (d !== OPPOSITE[state.current.dir]) state.current.next = d; }, []);
  const restart = () => {
    state.current = { snake: [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }], dir: 'R', next: 'R', food: { x: 12, y: 8 } };
    setScore(0); setOver(false);
  };

  useEffect(() => {
    const keys: Record<string, Dir> = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R' };
    const onKey = (e: KeyboardEvent) => { const d = keys[e.key]; if (d) { e.preventDefault(); steer(d); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [steer]);

  useEffect(() => {
    if (over) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      const s = state.current;
      s.dir = s.next;
      const head = { x: s.snake[0].x + STEP[s.dir].x, y: s.snake[0].y + STEP[s.dir].y };
      if (head.x < 0 || head.y < 0 || head.x >= N || head.y >= N || s.snake.some((p) => p.x === head.x && p.y === head.y)) {
        setOver(true);
        setScore((sc) => { setBest((b) => { const nb = Math.max(b, sc); try { sessionStorage.setItem('hm.snake.best', String(nb)); } catch { /* ignore */ } return nb; }); return sc; });
        return;
      }
      s.snake.unshift(head);
      if (head.x === s.food.x && head.y === s.food.y) { s.food = freeCell(s.snake); setScore((v) => v + 1); } else s.snake.pop();
      const ctx = canvas.current?.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#0C1119'; ctx.fillRect(0, 0, N * CELL, N * CELL);
      ctx.fillStyle = 'hsl(38 92% 56%)'; ctx.fillRect(s.food.x * CELL + 3, s.food.y * CELL + 3, CELL - 6, CELL - 6);
      s.snake.forEach((p, i) => { ctx.fillStyle = i === 0 ? '#ffffff' : 'rgba(255,255,255,0.7)'; ctx.fillRect(p.x * CELL + 1, p.y * CELL + 1, CELL - 2, CELL - 2); });
    }, 140);
    return () => clearInterval(id);
  }, [over]);

  const touch = useRef<P | null>(null);
  const pad = 'flex h-11 w-11 items-center justify-center rounded-full border border-white/20 text-white';

  return (
    <div className="rounded-xl border border-white/15 bg-black/30 p-3" data-testid="contract-snake">
      <div className="mb-2 flex items-center justify-between gap-2 text-sm">
        <span>{t('ct_snake_score', { score, best })}</span>
        <button type="button" onClick={onClose} aria-label={t('ct_snake_close')} className="flex h-11 w-11 items-center justify-center rounded-full text-white/80"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <canvas ref={canvas} width={N * CELL} height={N * CELL} role="img" aria-label={t('ct_snake_label')}
          className="max-w-full touch-none rounded-lg border border-white/10"
          onTouchStart={(e) => { const p = e.touches[0]; touch.current = { x: p.clientX, y: p.clientY }; }}
          onTouchEnd={(e) => {
            const s = touch.current; const p = e.changedTouches[0]; if (!s) return;
            const dx = p.clientX - s.x; const dy = p.clientY - s.y;
            if (Math.max(Math.abs(dx), Math.abs(dy)) > 20) steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U'));
          }} />
        <div className="grid grid-cols-3 gap-1" aria-label={t('ct_snake_controls')}>
          <span /><button type="button" className={pad} onClick={() => steer('U')} aria-label="↑"><ArrowUp className="h-4 w-4" aria-hidden="true" /></button><span />
          <button type="button" className={pad} onClick={() => steer('L')} aria-label="←"><ArrowLeft className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" className={pad} onClick={() => steer('D')} aria-label="↓"><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" className={pad} onClick={() => steer('R')} aria-label="→"><ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      </div>
      {over ? (
        <button type="button" onClick={restart} className="mt-3 min-h-11 rounded-full bg-[hsl(38_92%_56%)] px-4 text-sm font-semibold text-[#0C1119]">{t('ct_snake_again')}</button>
      ) : null}
    </div>
  );
}
