// HOMATCH — the one popup card: "something finished, here it is".
//
// Used by the live notification toast and by the job centre's completion
// popup, so a finished verification looks the same whichever of the two saw
// it first. A framed card with a mark, a real title, one line that says what
// happened, the subject it is about, and one clear action. No modal, nothing
// that takes focus, nothing that moves for someone who asked things not to
// (the toast library honours prefers-reduced-motion).

import type React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ToastCardProps {
  icon: React.ComponentType<{ className?: string }>;
  tone: 'accent' | 'alert' | 'plain';
  title: string;
  body?: string | null;
  /** What it is about: an address, a file name, a cadastral code. */
  subject?: string | null;
  actionLabel?: string | null;
  onOpen?: () => void;
  onDismiss: () => void;
  dismissLabel: string;
  /** A quiet second row, e.g. an offer to turn on phone notifications. */
  footer?: React.ReactNode;
}

export function ToastCard({
  icon: Icon, tone, title, body, subject, actionLabel, onOpen, onDismiss, dismissLabel, footer,
}: ToastCardProps) {
  return (
    <div
      className={cn(
        'pointer-events-auto relative w-[min(24rem,calc(100vw-2rem))] overflow-hidden',
        'rounded-2xl border bg-card p-4 shadow-[var(--shadow-hover)]',
        tone === 'alert' ? 'border-[hsl(var(--destructive))]/30' : 'border-[hsl(var(--gold-border))]',
      )}
      role="status"
    >
      {/* A thin band of the card's role along its leading edge. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 start-0 w-1',
          tone === 'alert' ? 'bg-[hsl(var(--destructive))]' : 'bg-[hsl(var(--gold))]',
        )}
      />
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset',
            tone === 'accent'
              ? 'bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))] ring-[hsl(var(--gold-border))]'
              : tone === 'alert'
                ? 'bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))] ring-[hsl(var(--destructive))]/25'
                : 'bg-[hsl(var(--secondary))] text-muted-foreground ring-border',
          )}
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="break-words pe-6 font-display text-sm font-semibold leading-snug text-foreground">{title}</p>
          {subject ? (
            <p className="mt-0.5 truncate text-xs font-medium text-foreground/80" dir="auto">{subject}</p>
          ) : null}
          {body ? (
            <p className="mt-1 line-clamp-3 break-words text-xs leading-relaxed text-muted-foreground">{body}</p>
          ) : null}
          {actionLabel && onOpen ? (
            <div className="pt-3">
              <button
                type="button"
                onClick={onOpen}
                className="inline-flex min-h-10 items-center rounded-xl bg-[hsl(var(--primary))] px-4 text-xs font-semibold text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary))]/88 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              >
                {actionLabel}
              </button>
            </div>
          ) : null}
          {footer ? <div className="mt-3 border-t border-border pt-3">{footer}</div> : null}
        </div>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="absolute end-2 top-2 grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[hsl(var(--secondary))] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
