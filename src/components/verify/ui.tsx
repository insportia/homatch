/*
 * VERIFY, IN THE INVESTMENT WORKSPACE'S LANGUAGE.
 *
 * Not a second visual system. These are thin wrappers over the classes the
 * Investment workspace already defines in index.css — `.hm-invest` for the
 * surface tokens, `.hm-invest-panel` for a module's hairline card — so a
 * verification reads as another room in the same building rather than as a
 * different product.
 *
 * WHY WRAPPERS RATHER THAN IMPORTING investment/primitives.tsx DIRECTLY
 *
 * Module/Metric there take i18n KEYS, because every label in a financial
 * model is a fixed string. Verify's headings are frequently data — a
 * cadastral code, a project name, a source's own words — so the same
 * components cannot be reused verbatim without pushing dynamic text through a
 * translation lookup. The CLASSES are identical, which is what makes the two
 * surfaces match; only the prop shape differs.
 *
 * THE LAYOUT RULE THIS FILE EXISTS TO ENFORCE
 *
 * Every text container here carries min-w-0 and every row that mixes a label
 * with a value is allowed to wrap. A flex child whose min-width is `auto`
 * cannot shrink below its content, so a sibling that refuses to shrink pushes
 * it out of the row; a flex child with min-w-0 and no basis can be squeezed to
 * nothing. Both failures produce the same symptom — a column of single
 * characters — and both are prevented by the same discipline: the text column
 * gets a floor, and the thing next to it wraps instead of winning.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * One section of a report.
 *
 * `.hm-invest-panel` and the padding scale are Investment's, unchanged.
 */
export function VerifySection({
  eyebrow,
  title,
  subtitle,
  actions,
  accent,
  children,
  className,
  id,
}: {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  /** A gold hairline, for the one section that is the headline answer. */
  accent?: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn('hm-invest-panel scroll-mt-24 p-5 sm:p-7', accent && 'hm-invest-focus', className)}
    >
      {(eyebrow || title || subtitle || actions) ? (
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
            {eyebrow ? (
              <p className="mb-1 text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--gold-ink))]">
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <h2 className="font-display text-xl font-semibold leading-tight text-foreground break-words">
                {title}
              </h2>
            ) : null}
            {subtitle ? (
              <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-muted-foreground break-words">
                {subtitle}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/**
 * A label and its value, on one line where there is room and two where there
 * is not.
 *
 * THE FIX FOR THE COLLAPSING COLUMN.
 *
 * The previous shape was `flex justify-between` with a label and a value that
 * could not shrink. At 320px in Georgian the value won and the label was
 * squeezed to about one character wide, stacked down the card. Here the row
 * WRAPS: below `sm` the label and the value each own a full line, so neither
 * can compress the other, and from `sm` up they sit together with the label
 * given a sensible basis rather than whatever is left over.
 */
export function Row({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2', className)}>
      <dt className="min-w-0 basis-full break-words text-xs font-medium uppercase tracking-wide text-muted-foreground sm:basis-[14rem] sm:shrink-0">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 basis-full break-words text-sm text-foreground sm:basis-0">
        {children}
      </dd>
    </div>
  );
}

/** A list of Rows, hairline-separated the way Investment separates figures. */
export function RowList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('divide-y divide-border', className)}>{children}</dl>;
}

export type StatusTone = 'confirmed' | 'attention' | 'risk' | 'quiet';

const TONE: Record<StatusTone, string> = {
  // Green survives, because it carries meaning that gold cannot: something
  // was positively established rather than merely emphasised.
  confirmed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  attention: 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]',
  risk: 'border-destructive/45 bg-destructive/10 text-destructive',
  // The absence of a finding. Present, legible, and not competing.
  quiet: 'border-border bg-muted/40 text-muted-foreground',
};

/** A status, stated once, in the one place it belongs. */
export function StatusPill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-full border px-2.5 py-1',
        'text-2xs font-medium leading-snug',
        // Wraps rather than truncating: a status nobody can read in full is
        // not a status.
        'whitespace-normal break-words text-start',
        TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * The headline figure of a section.
 *
 * Gold, and only ever one per section — the same rule the Investment
 * workspace follows, for the same reason: a second accent turns an analysis
 * into a dashboard.
 */
export function Headline({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase leading-tight tracking-wide text-muted-foreground break-words">
        {label}
      </p>
      <p className="mt-1.5 font-display text-2xl font-semibold leading-tight text-[hsl(var(--gold-ink))] break-words">
        {value}
      </p>
      {note ? <p className="mt-1.5 text-2xs leading-relaxed text-muted-foreground break-words">{note}</p> : null}
    </div>
  );
}
