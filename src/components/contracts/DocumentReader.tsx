/*
 * "WE ARE INSIDE THE DOCUMENT, READING IT."
 *
 * A page held up to the light: a beam passes down it, the lines it crosses
 * light up, the passages worth noting keep a gold trace, and the things HOMI
 * looks for in every contract slide out beside it as cards.
 *
 * HONESTY. The motion is driven by the mode the parent passes, and the parent
 * derives the mode from the server's real analysis_state (or from "nothing
 * uploaded yet" on the entry page). The cards on the side are the TOPICS HOMI
 * reads for (price, dates, obligations…), labelled as such, never invented
 * findings and never a percentage. The real findings appear only when the
 * analysis is DONE, on the result page.
 *
 * Under prefers-reduced-motion the CSS stops every animation and leaves a
 * still, legible frame (contracts.css).
 */
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import './contracts.css';

/** A style with the stagger index the CSS reads as --i. */
const v = (i: number, extra?: CSSProperties) => ({ '--i': i, ...extra } as CSSProperties);

export type ReaderMode = 'idle' | 'queued' | 'reading' | 'done';

export interface ReaderPull { key: string; label: string; icon: ReactNode }

/* Line widths (percent) and which lines keep a mark: fixed, so the page looks
 * like a page and never re-randomises on render. */
const LINES: Array<[number, 0 | 1]> = [
  [92, 0], [86, 0], [95, 1], [70, 0], [88, 0], [93, 0], [64, 1], [90, 0], [82, 0], [96, 1], [58, 0], [84, 0], [74, 0],
];

export function DocumentReader({
  mode, pulls, pullsTitle, className,
}: {
  mode: ReaderMode;
  pulls: ReaderPull[];
  pullsTitle: string;
  className?: string;
}) {
  const live = mode === 'reading' || mode === 'idle';
  return (
    <div
      className={cn('ct-stage relative grid min-w-0 grid-cols-1 items-center gap-5 min-[480px]:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] min-[480px]:gap-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-6', className)}
      data-reader-mode={mode}
      aria-hidden="true"
    >
      {/* The page. */}
      <div className="relative mx-auto aspect-[3/4] w-full max-w-[10rem] min-[480px]:max-w-[12rem]">
        <span className="ct-halo pointer-events-none absolute -inset-6 rounded-full" />
        <div className="ct-paper-back absolute inset-0 rounded-xl bg-white/10 ring-1 ring-white/10" />
        <div className={cn(
          'ct-paper absolute inset-0 overflow-hidden rounded-xl bg-[#FBFAF6] p-3.5 sm:p-4',
          mode === 'reading' && 'ct-reading',
          mode === 'idle' && 'ct-idle',
          mode === 'queued' && 'ct-queued',
          mode === 'done' && 'ct-done',
        )}>
          {/* Letterhead: a title bar and a small seal. */}
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-1/2 rounded-full bg-[#0C1119]/70" />
            <span className="ms-auto h-4 w-4 rounded-full border-2 border-[hsl(38_92%_50%)]/70" />
          </div>
          <div className="space-y-[7px]">
            {LINES.map(([w, mark], i) => (
              <div key={i} className="ct-line" data-mark={mark} style={v(i, { width: `${w}%` })} />
            ))}
          </div>
          {/* Signature lines. */}
          <div className="absolute inset-x-3.5 bottom-3.5 flex gap-3 sm:inset-x-4">
            <span className="h-px flex-1 bg-[#0C1119]/30" />
            <span className="h-px flex-1 bg-[#0C1119]/30" />
          </div>
          {mode !== 'done' ? <span className="ct-beam" /> : null}
        </div>
        {live ? [0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="ct-mote" style={v(i, { insetInlineStart: `${12 + i * 18}%`, bottom: `${8 + (i % 3) * 14}%` })} />
        )) : null}
      </div>

      {/* What HOMI reads for, sliding out of the page. */}
      <div className="min-w-0">
        <p className="mb-2 text-xs font-semibold text-[hsl(38_92%_70%)]">{pullsTitle}</p>
        <ul className="flex flex-wrap gap-1.5 min-[480px]:block min-[480px]:space-y-1.5">
          {pulls.map((p, i) => (
            <li
              key={p.key}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-[13px] text-white/90 backdrop-blur-sm',
                live ? 'ct-pull' : 'ct-pull-static',
                mode === 'done' && 'border-[hsl(38_92%_56%)]/40 bg-[hsl(38_92%_56%)]/10',
                mode === 'queued' && 'opacity-60',
              )}
              style={v(i)}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[hsl(38_92%_56%)]/15 text-[hsl(38_92%_66%)]">{p.icon}</span>
              <span className="min-w-0 leading-snug [overflow-wrap:normal]">{p.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
