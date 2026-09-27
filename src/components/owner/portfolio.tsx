// THE OWNER'S PORTFOLIO, AS ITS OWN PRESENTATION LAYER.
//
// WHAT THIS REPLACES, and why restyling it was never going to be enough.
//
// The property row was assembled from shadcn's Card, Button and Badge plus a bespoke
// segmented control, on the root palette. Every visible part of it therefore came from
// somewhere that had no idea what a property is: the media well was `bg-secondary/40` with
// a struck-through image glyph in it, the status was a grey capsule, the primary action a
// black rectangle, edit and overflow two grey 32px squares beside it, and the facts a
// single muted string joined with dots. Changing the colours of those parts produced
// exactly what it sounds like — the old page with gold on it.
//
// So the parts are rebuilt here, for this product:
//
//   MediaWell        a landscape frame with a real empty state rather than a broken-image
//                    placeholder, and a provenance mark that reads as a caption
//   StatusMark       a dot and a word, because a property's state is a qualifier and not
//                    a category that needs a container
//   FactLine         labelled values, so area, rooms and type are readable as facts
//                    rather than as one grey sentence
//   Money            the price at the weight a price deserves, with per-m² beneath it
//   IntelLine        what HOMATCH knows about this property, compactly, in words
//   RowActions       one contextual primary, a contained edit, a contained overflow
//
// WHAT DOES NOT CHANGE. The four-column architecture — media, identity, intelligence,
// actions — is what makes ten properties scannable and is the reason this product is
// neither the Dashboard nor Matches. The data, the routes, the permissions and the
// storage are untouched: `PrivateImage` still resolves R2 keys through the same signing
// path, and every value here is one the row already had.

import { ImageOff } from 'lucide-react';
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

/**
 * The landscape frame, and an empty state that was designed.
 *
 * A property with no photograph is a normal state — an import that carried none, a
 * listing part-way through being written — and it was rendered as a grey box with a
 * struck-through image icon, which reads as a failure. What belongs there is a quiet
 * surface that says "no photograph yet" without pretending anything went wrong, and
 * certainly not a stock photograph of somebody else's building.
 */
export function MediaWell({
  children,
  hasMedia,
  ratio = 'wide',
}: {
  children?: React.ReactNode;
  hasMedia: boolean;
  ratio?: 'wide' | 'tall';
}) {
  const { t } = useLanguage();
  return (
    <div
      className={cn(
        'relative overflow-hidden bg-[hsl(var(--secondary))]',
        ratio === 'wide' ? 'aspect-[16/10]' : 'aspect-[16/9]',
      )}
    >
      {hasMedia ? children : (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-1.5 px-3 text-center">
            <ImageOff className="h-4 w-4 text-muted-foreground/45" strokeWidth={1.5} aria-hidden="true" />
            <span className="text-2xs text-muted-foreground/70">{t('prop_no_photo')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Where a property came from, as a caption on its own photograph. */
export function SourceMark({ label }: { label: string }) {
  return (
    <span className="absolute bottom-1.5 start-1.5 max-w-[calc(100%-0.75rem)] rounded-md bg-[hsl(var(--card))]/92 px-1.5 py-0.5 text-2xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm">
      <span className="break-words">{label}</span>
    </span>
  );
}

/**
 * A property's state, as a dot and a word.
 *
 * It was a filled Badge — a capsule sized like a button, competing with the title beside
 * it. State is a qualifier: ACTIVE, PAUSED, DRAFT, ARCHIVED are four values of one thing,
 * and four values of one thing do not each need a container.
 */
export function StatusMark({ status, archived }: { status: string; archived: boolean }) {
  const { t } = useLanguage();
  const live = !archived && status === 'ACTIVE';
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          archived
            ? 'bg-muted-foreground/40'
            : live
              ? 'bg-[hsl(var(--gold))]'
              : 'bg-muted-foreground/55',
        )}
      />
      <span className={cn('truncate text-2xs font-semibold', live ? 'text-[hsl(var(--gold-ink))]' : 'text-muted-foreground')}>
        {archived ? t('prop_state_archived') : t(`prop_state_${status.toLowerCase()}` as never)}
      </span>
    </span>
  );
}

/**
 * The facts, as facts.
 *
 * They were one muted string joined with middots — "Apartment · Sale · 97.2 m² · 3 rooms"
 * — which is scannable only if you already know the order. Each value keeps its own slot
 * and its own small label, so a reader looking for the area finds the area.
 */
export function FactLine({
  items,
}: {
  items: ReadonlyArray<{ label: string; value: string }>;
}) {
  if (!items.length) return null;
  return (
    <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 items-baseline gap-1.5">
          <dt className="text-2xs text-muted-foreground/80">{item.label}</dt>
          <dd className="truncate text-2xs font-semibold text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The price, at the weight a price deserves, with the per-square-metre beneath it. */
export function Money({ price, perSqm, none }: {
  price: string | null;
  perSqm: string | null;
  none: string;
}) {
  if (!price) {
    return <p className="text-2xs text-muted-foreground">{none}</p>;
  }
  return (
    <div className="min-w-0">
      <p className="font-display text-lg font-bold leading-none tracking-[-0.02em] text-foreground tabular-nums" dir="ltr">
        {price}
      </p>
      {perSqm && (
        <p className="mt-1 text-2xs text-muted-foreground tabular-nums" dir="ltr">{perSqm}/m²</p>
      )}
    </div>
  );
}

/**
 * What HOMATCH knows about this property.
 *
 * The workspace is not a property CRUD list — each row is an entry point into the
 * matching product — and that has to read as a sentence a person understands rather than
 * as three counters in capsules. Rendered only from values that exist.
 */
export function IntelLine({
  total, fresh, strong,
}: {
  total: number; fresh: number; strong: number;
}) {
  const { t } = useLanguage();
  if (total <= 0) {
    return <p className="text-2xs text-muted-foreground">{t('prop_intel_none')}</p>;
  }
  return (
    <p className="text-2xs leading-snug text-muted-foreground">
      <span className="font-display text-sm font-bold text-foreground tabular-nums" dir="ltr">{total}</span>
      {' '}
      {t('prop_intel_total')}
      {fresh > 0 && (
        <>
          {' · '}
          <span className="font-semibold text-[hsl(var(--gold-ink))] tabular-nums" dir="ltr">{fresh}</span>
          {' '}
          {t('prop_intel_new')}
        </>
      )}
      {strong > 0 && (
        <>
          {' · '}
          <span className="font-semibold text-foreground tabular-nums" dir="ltr">{strong}</span>
          {' '}
          {t('prop_intel_strong')}
        </>
      )}
    </p>
  );
}

/* ── The control family ──────────────────────────────────────────────── */

const CONTROL = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--card))]';

/**
 * The one contextual action a row offers.
 *
 * Warm rather than black. The old row's primary was `bg-primary`, which on this palette
 * is near-black, and three of them down a list made the page look like a form. A gold
 * ground with gold ink is unmistakably the action without being the loudest object in
 * the viewport.
 *
 * A CLASS, not a component, because the caller decides the element: this is a <Link> in
 * a row and a <button> in a dialog, and a presentation layer that tried to own routing
 * would be reimplementing react-router badly.
 */
export const OWNER_PRIMARY = cn(
  CONTROL,
  'border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-3 text-[hsl(var(--gold-ink))]',
  'hover:border-[hsl(var(--gold))] hover:bg-[hsl(var(--gold))] hover:text-[hsl(var(--primary-foreground))]',
);

/** A contained icon control. Two grey squares became two controls with a real hit area. */
export const OWNER_ICON = cn(
  CONTROL,
  'w-9 shrink-0 border border-border bg-[hsl(var(--card))] text-muted-foreground',
  'hover:border-[hsl(var(--gold-border))] hover:text-foreground',
);

/** A quiet control for the page's own secondary actions. */
export const OWNER_SECONDARY = cn(
  CONTROL,
  'border border-border bg-[hsl(var(--card))] px-3 text-foreground',
  'hover:border-[hsl(var(--gold-border))] hover:text-[hsl(var(--gold-ink))]',
);

export { CONTROL as OWNER_CONTROL };
