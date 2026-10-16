// THE PUBLISHING WORKSPACE'S PRESENTATION PARTS.
//
// Written against the owner surface's gold/navy grammar (OWNER_SURFACE tokens,
// PageHero's near-black band, gold accents) rather than shadcn's neutral one — the
// same reasoning as src/components/customer/surface.tsx. Status is a dot and a word,
// never a capsule the size of a button.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { type PublicationStatus, type Tone, toneOf } from '@/publishing/model';

const DOT: Record<Tone, string> = {
  live: 'bg-[hsl(var(--gold))]',
  pending: 'bg-sky-500',
  problem: 'bg-red-500',
  quiet: 'bg-muted-foreground/45',
};
const INK: Record<Tone, string> = {
  live: 'text-[hsl(var(--gold-ink))]',
  pending: 'text-sky-700',
  problem: 'text-red-700',
  quiet: 'text-muted-foreground',
};

/** A publication's state (or "not published" when there is none), as a dot and a word. */
export function PublicationMark({ status, className }: { status: PublicationStatus | null; className?: string }) {
  const { t } = useLanguage();
  const tone = toneOf(status);
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[tone])} />
      <span className={cn('text-2xs font-semibold break-words', INK[tone])}>
        {t(status ? `pubw_status_${status.toLowerCase()}` : 'pubw_status_not_started')}
      </span>
    </span>
  );
}

/** The listing's own state: draft, ready, archived. */
export function ListingMark({ ready, archived }: { ready: boolean; archived: boolean }) {
  const { t } = useLanguage();
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', archived ? 'bg-muted-foreground/40' : ready ? 'bg-emerald-500' : 'bg-amber-500')} />
      <span className="text-2xs font-semibold text-muted-foreground">
        {t(archived ? 'pubw_listing_archived' : ready ? 'pubw_listing_ready' : 'pubw_listing_draft')}
      </span>
    </span>
  );
}

/** A white working panel with an optional quiet heading. */
export function Panel({ title, aside, children, className, id }: {
  title?: string; aside?: React.ReactNode; children: React.ReactNode; className?: string; id?: string;
}) {
  return (
    <section id={id} className={cn('min-w-0 rounded-2xl border border-border bg-[hsl(var(--card))] p-4 shadow-card sm:p-5', className)}>
      {title || aside ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="min-w-0 font-display text-base font-semibold text-foreground break-words">{title}</h2> : <span />}
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** One overview number. A zero is shown as a zero; nothing is estimated. */
export function Kpi({ label, value, tone = 'quiet', onClick, active }: {
  label: string; value: number; tone?: Tone; onClick?: () => void; active?: boolean;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-pressed={onClick ? !!active : undefined}
      className={cn(
        'min-w-0 rounded-xl border bg-[hsl(var(--card))] px-3 py-2.5 text-start transition-colors',
        active ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]' : 'border-border',
        onClick && 'hover:border-[hsl(var(--gold-border))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
      )}
    >
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[tone])} />
        <span className="min-w-0 text-2xs font-medium text-muted-foreground break-words">{label}</span>
      </span>
      <span className="mt-0.5 block font-display text-2xl font-bold tabular-nums text-foreground">{value}</span>
    </Tag>
  );
}

/** A server error code, explained. Unknown codes fall back to a generic sentence, never the raw code alone. */
export function useErrorText() {
  const { t } = useLanguage();
  return (code: string | null | undefined) => {
    if (!code) return '';
    const key = `pubw_err_${code.toLowerCase()}`;
    const text = t(key);
    return text === key ? t('pubw_err_generic', { code }) : text;
  };
}

export function dateTime(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
