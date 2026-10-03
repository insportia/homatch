import { X } from 'lucide-react';
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SnakeGame } from './SnakeGame';
import type { T } from './format';

/*
 * The Snake entry point: a small, deliberate game card, not a paragraph. The
 * preview is a static drawing of a board (snake, food, score) in HOMATCH
 * navy and gold; the whole card is one button and opens the game at once.
 */
const SNAKE = [[3, 6], [4, 6], [5, 6], [6, 6], [6, 5], [6, 4], [7, 4], [8, 4]];
const FOOD = [11, 4];

export function SnakeThumbnail({ t, onOpen, searching }: { t: T; onOpen: () => void; searching: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('mps_snake_open')}
      data-action="mps-snake-open"
      className="group relative block w-full overflow-hidden rounded-2xl bg-[#0C1119] text-start shadow-hover ring-1 ring-white/10 transition hover:ring-[hsl(38_92%_56%/0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_60%)]"
    >
      <svg viewBox="0 0 160 90" className="block h-auto w-full" aria-hidden="true">
        <defs>
          <radialGradient id="mps-snake-glow" cx="80%" cy="0%" r="90%">
            <stop offset="0%" stopColor="#F5B841" stopOpacity="0.22" />
            <stop offset="70%" stopColor="#F5B841" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="160" height="90" fill="#0C1119" />
        {Array.from({ length: 16 * 9 }, (_, i) => (i % 16 + Math.floor(i / 16)) % 2 === 0 ? (
          <rect key={i} x={(i % 16) * 10} y={Math.floor(i / 16) * 10} width="10" height="10" fill="#ffffff" opacity="0.035" />
        ) : null)}
        <rect width="160" height="90" fill="url(#mps-snake-glow)" />
        {SNAKE.map(([x, y], i) => (
          <rect key={i} x={x * 10 + 1.2} y={y * 10 + 1.2} width="7.6" height="7.6" rx="2" fill={i === SNAKE.length - 1 ? '#F7C964' : '#F5B841'} opacity={0.45 + (i / SNAKE.length) * 0.55} />
        ))}
        <circle cx={FOOD[0] * 10 + 5} cy={FOOD[1] * 10 + 5} r="3.2" fill="#F5B841" className="motion-safe:animate-pulse" />
        <rect x="118" y="7" width="34" height="13" rx="6.5" fill="#ffffff" opacity="0.1" />
        <text x="135" y="16.6" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#ffffff" opacity="0.85">12</text>
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-[#0C1119] via-[#0C1119]/70 to-transparent px-4 pb-3 pt-8">
        <span className="font-display text-base font-semibold text-white">{t('mps_snake_game')}</span>
        {searching ? <span className="text-xs text-white/60">{t('mps_snake_status')}</span> : null}
      </div>
    </button>
  );
}

/**
 * The game, over the page. The search is untouched: polling keeps running in
 * the page underneath, nothing here calls the search service, and closing
 * returns to exactly the same search.
 */
export function SnakeOverlay({ t, open, onClose, resultsReady, onViewResults }: {
  t: T; open: boolean; onClose: () => void; resultsReady: boolean; onViewResults: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  /* Portalled to <body>: a transformed page ancestor would otherwise re-anchor `fixed`. */
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t('mps_snake_game')} className="fixed inset-0 z-[200] flex items-stretch justify-center bg-[#05080d]/80 backdrop-blur-sm sm:items-center sm:p-6">
      <div className="hm-discovery flex w-full max-w-[480px] flex-col gap-4 overflow-y-auto bg-background p-4 pt-[max(1rem,env(safe-area-inset-top))] sm:rounded-2xl sm:p-6 sm:shadow-hover">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold text-foreground">{t('mps_snake_game')}</p>
            {!resultsReady ? <p className="text-xs text-muted-foreground" aria-live="polite">{t('mps_snake_status')}</p> : null}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('mps_snake_close')}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {resultsReady ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.08)] px-3.5 py-2.5" role="status">
            <span className="text-sm font-medium text-foreground">{t('mps_snake_ready')}</span>
            <button type="button" onClick={onViewResults} data-action="mps-snake-view"
              className="inline-flex min-h-[36px] items-center rounded-lg bg-[#0C1119] px-3.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
              {t('mps_snake_ready_cta')}
            </button>
          </div>
        ) : null}
        <SnakeGame t={t} autoFocus />
      </div>
    </div>,
    document.body,
  );
}
