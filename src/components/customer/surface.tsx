// THE CUSTOMER SURFACE, AND WHY IT HAD TO BE A NEW FILE.
//
// THE ROOT CAUSE OF THREE FAILED REDESIGNS, stated in code:
//
// HOMATCH's premium visual system is not a set of components. It is a SCOPED TOKEN
// BLOCK — `.hm-workspace` / `.hm-invest` in src/index.css — which redeclares
// --background, --card, --primary, --border, --gold*, --shadow-* and turns on tabular
// numerals for everything inside it. Investment, Mortgage, Contracts and Verify wear it
// by wrapping themselves in `<div className="hm-invest hm-invest-canvas">`.
//
// Matches, Find Property and My Properties never opted in. They render on the ROOT light
// palette, where those same tokens resolve to:
//
//     --card: 0 0% 100%        white
//     --border: 214 9% 82%     a grey hairline
//     --primary: 0 0% 5%       black
//     --secondary: 214 8% 88%  a grey fill
//
// and then they compose shadcn's primitives, which are written in terms of exactly those
// tokens: Card is `rounded-xl border bg-card shadow-card-soft`, Badge is
// `rounded-md border px-2.5 py-1 text-xs font-semibold`, Button is
// `bg-primary text-primary-foreground`.
//
// So "large white rounded rectangle, thin grey border, grey pill, black rectangular
// button" is not a styling choice anybody made on those pages. It is the literal
// resolution of `<Card><Badge/><Button/></Card>` on the root palette. Rearranging the
// children cannot change it, which is precisely why rearranging the children three times
// produced the same screenshot three times.
//
// WHAT THIS FILE DOES
//
// Opts the customer surfaces into the SAME token block the approved pages use, and gives
// them their own small set of presentation primitives written against the gold/navy
// grammar rather than against shadcn's neutral one. Investment and Mortgage are not
// touched, not imported, and not restructured — only the CSS class names they already
// publish are reused, which is what those class names are for.
//
// Verify is protected and is not a source here: nothing below is imported from it.

import { Loader2 } from 'lucide-react';
import React from 'react';
import { cn } from '@/lib/utils';

/**
 * The deep analytical canvas, bled to the edges.
 *
 * `AppLayout noPadding` is required for this: the default layout pads its children, so a
 * canvas inside it would float as a rectangle with a light gutter around it — which is
 * the "huge empty canvas" failure in a different costume. Investment does the same thing
 * and for the same reason.
 *
 * The `min-h` keeps the canvas reaching the bottom of the viewport on a short page, so a
 * Matches list with one result does not end in a band of the old palette.
 */
/*
 * TWO PRODUCT GROUNDS, AND A PAGE PICKS ONE. NEITHER IS THE SHELL.
 *
 * `AppLayout surfaceClass` takes whichever a page hands it, so the choice is made per
 * product rather than per application. That is the fix for the shell's theme reaching
 * Matches: there is no longer one wrapper over authenticated routes for a product to
 * inherit, and adding a third product ground costs one constant rather than a decision
 * about everybody else.
 */
export const DISCOVERY_SURFACE = 'hm-discovery hm-discovery-canvas min-h-[calc(100dvh-4rem)]';
export const OWNER_SURFACE = 'hm-owner hm-owner-canvas min-h-[calc(100dvh-4rem)]';
export const PRODUCT_SURFACE = 'hm-product min-h-[calc(100dvh-4rem)]';

export function CustomerSurface({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full max-w-[86rem] px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A page header that is a header, not a hero.
 *
 * WHAT IT REPLACES cost roughly 210px before the first result on a 390px phone: an h1 at
 * text-xl on its own line, a property subtitle, a counts line, a full-width outlined
 * button, then a tab rail. Five stacked blocks to say "these are your matches".
 *
 * This is two lines. The eyebrow carries the CONTEXT (which property) in 13px gold small
 * caps; the title carries the subject; the count sits on the title's own line as a quiet
 * suffix rather than as a third paragraph. Actions go inline and are text-weight, not
 * filled rectangles.
 */
export function CustomerPageHeader({
  eyebrow,
  title,
  count,
  actions,
}: {
  eyebrow?: string | null;
  title: string;
  count?: string | null;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 truncate text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--primary))]">
            {eyebrow}
          </p>
        ) : null}
        {/* text-base on a phone. At text-lg a Georgian heading wrapped to two lines and
            became the largest object on a page whose subject is the list below it. */}
        <h1 className="font-display text-base font-semibold leading-tight text-foreground sm:text-lg">
          {title}
        </h1>
        {count ? (
          <p className="mt-1 text-2xs font-medium text-foreground/85">{count}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  );
}

/**
 * The result filters, as a rail that admits it scrolls.
 *
 * WHAT IT REPLACES was shadcn Tabs: `shrink-0` triggers inside an `overflow-x-auto` list,
 * which on a 390px phone in Georgian clipped the fourth label mid-word with no edge
 * treatment at all — it read as a rendering bug, and the selected tab was a large filled
 * rounded rectangle in the accent colour.
 *
 * Three changes. The selected state is the gold pill the approved Segmented control uses,
 * at its proportions. The count is a superscript-weight suffix rather than a bracketed
 * number competing with the label. And `.scroll-x-shadow` — already in index.css and
 * already used elsewhere — puts a fade on whichever edge has content beyond it, so a
 * partly visible label reads as "there is more this way" instead of as clipping.
 */
export function FilterRail<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      /*
       * A MASK, NOT `.scroll-x-shadow`.
       *
       * That utility paints `hsl(0 0% 0% / 0.10)` at the edges — a black wash, which is
       * how you signal overflow on a white table and completely invisible on a near-black
       * canvas. Measured: the fourth filter was still clipped mid-word with no affordance
       * at all, which reads as a rendering bug rather than as "scroll for more".
       *
       * Fading the CONTENT works on any ground because it does not assume one. The mask
       * is inset only at the end edge, so the first filter is never dimmed.
       *
       * The underscores inside calc() are load-bearing. Tailwind turns them into spaces,
       * and `calc(100%-28px)` without them is not valid CSS — the whole mask-image is
       * dropped and the rail clips again with no affordance, which is what the first
       * render of this showed.
       */
      className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-0.5 [mask-image:linear-gradient(to_right,black_0,black_calc(100%_-_28px),transparent_100%)] rtl:[mask-image:linear-gradient(to_left,black_0,black_calc(100%_-_28px),transparent_100%)]"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            /* An unselected filter had no surface at all, so three of the four looked
               like a caption. They are all controls; only one of them is on. min-h-8 is
               a touch-safe target at this size. */
            className={cn(
              'inline-flex min-h-8 shrink-0 items-center rounded-full border px-3 text-2xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
              /* The QUIET gold. A solid gold fill is the brand's primary-CTA treatment —
                 it is what the active sidebar destination and "top up" wear — and
                 spending it on a filter makes a toggle the loudest thing on a results
                 page. */
              selected
                ? 'border-border bg-[hsl(var(--secondary))] text-foreground'
                : 'border-border bg-[hsl(var(--card))] text-muted-foreground hover:border-[hsl(var(--ring))]/40 hover:text-foreground',
            )}
          >
            <span className="whitespace-nowrap">
              {option.label}
              {option.count !== undefined ? (
                <span className={cn('ms-1.5 font-semibold tabular-nums', selected ? '' : 'opacity-70')}>
                  {option.count}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * One fact, as an icon and a value on a shared baseline.
 *
 * NOT A PILL. The rejected card rendered city, budget, rooms and recency as four
 * capsules, which is four borders, four backgrounds and a row of height each time they
 * wrapped — capsules for information that is not categorical and has no state. A pill
 * says "this is one of a set of discrete values"; a city is just a city.
 */
export function Fact({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-2xs text-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0 text-foreground" aria-hidden="true" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * How well something fits, as a dot and a word.
 *
 * WHAT IT REPLACES was a bordered Badge in one of five colours, sized like a button and
 * sitting at the top-left of the card as its loudest element. A strength is a qualifier,
 * not a status — it does not need a container, and the three tiers do not need three
 * hues. One gold dot at full, half and quarter opacity carries the whole scale, and the
 * word next to it carries the meaning.
 *
 * No green. Green here would be a sixth accent in a system that has one.
 */
export function StrengthMark({ tier, label }: { tier: string; label: string }) {
  const dot =
    tier === 'STRONG'
      ? 'bg-[hsl(var(--primary))]'
      : tier === 'GOOD'
        ? 'bg-foreground/55'
        : 'bg-muted-foreground/45';
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot)} aria-hidden="true" />
      <span
        className={cn(
          'truncate text-2xs font-semibold',
          tier === 'STRONG' ? 'text-foreground' : 'text-foreground',
        )}
      >
        {label}
      </span>
    </span>
  );
}

/**
 * A secondary action that still reads as a control.
 *
 * The rail's "open property" and the search module's start/stop were gold words with an
 * arrow. They are real buttons and always were; nothing about them said so. This is the
 * quieter sibling of CardAction — a bordered surface rather than a filled one, because a
 * rail should not compete with the list beside it — and it is touch-safe at 36px.
 */
export function QuietAction({
  label,
  icon: Icon,
  onClick,
  disabled,
  busy,
  full,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  full?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-border',
        'bg-[hsl(var(--secondary))] px-3 py-1.5 text-2xs font-semibold text-foreground',
        'transition-colors hover:border-[hsl(var(--ring))]/40 hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
        'disabled:opacity-60',
        full && 'w-full',
      )}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : Icon ? (
        <Icon className="h-3.5 w-3.5 shrink-0" />
      ) : null}
      <span className="break-words text-start">{label}</span>
    </button>
  );
}

/**
 * Somebody else's words, marked as somebody else's.
 *
 * The rejected card put a large italic foreign-language paragraph in the middle of the
 * card with nothing saying what it was — an Arabic reader met a Turkish sentence in the
 * position a product normally uses for its own copy. A gold rule down the start edge and
 * a 13px label turn it into a quotation, and `dir="auto"` lets it take its own direction
 * rather than inheriting the page's.
 *
 * One line collapsed. The whole thing lives in the detail view.
 */
export function SourceQuote({ text, label }: { text: string; label: string }) {
  return (
    <div className="min-w-0 border-s-2 border-border ps-2.5">
      <p className="text-2xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      {/* Not italic. A whole line of italic Georgian, Russian or Arabic is harder to read
          than the same line upright, and the start-edge rule already says "this is
          somebody else's text". dir="auto" so a Latin excerpt inside an RTL page takes
          its own direction. */}
      <p dir="auto" className="mt-0.5 line-clamp-1 text-2xs text-foreground/90">
        {text}
      </p>
    </div>
  );
}

/**
 * The same shape, for an action that leaves.
 *
 * A result on Find Property ends at somebody else's listing. Rendering that as a button
 * would take away the three things a reader expects from a destination — middle click,
 * copy link, and seeing where it goes before committing — so it is an anchor wearing the
 * primary action's shape rather than a button pretending to be one.
 *
 * `noopener noreferrer nofollow` because these are third-party pages this product neither
 * controls nor endorses.
 */
export function LinkAction({
  label,
  href,
  icon: Icon,
}: {
  label: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="group inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3.5 py-1.5 text-2xs font-semibold text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary))]/88 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2"
    >
      <span className="break-words text-start">{label}</span>
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
    </a>
  );
}

/**
 * The one action on a card, as a control that is read rather than a rectangle that is
 * seen.
 *
 * WHAT IT REPLACES was two adjacent filled buttons — a black one and a grey one — which
 * between them took a full row of the card and gave a secondary action the same visual
 * weight as the primary one. Here the primary is gold text with a chevron and the
 * secondary is an unlabelled overflow trigger the caller supplies, at icon size.
 */
export function CardAction({
  label,
  suffix,
  onClick,
  disabled,
  busy,
  overflow,
}: {
  label: string;
  suffix?: string | null;
  onClick: () => void;
  disabled?: boolean;
  busy?: React.ReactNode;
  overflow?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      {/*
        A REAL BUTTON, WITH A SURFACE.
        This was gold text and an arrow. It had focus, it took keyboard input and it was
        semantically a <button> — and a reader could not tell. A control needs a shape, a
        boundary, padding and a touch-safe height before any of its behaviour matters.
        min-h-9 is 36px, which is the smallest comfortable target; the label wraps rather
        than clipping, because Georgian labels are long.
      */}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="group inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3.5 py-1.5 text-2xs font-semibold text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary))]/88 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 disabled:opacity-55"
      >
        {busy}
        <span className="break-words text-start">{label}</span>
        {suffix ? (
          <span className="shrink-0 font-medium" dir="ltr">{suffix}</span>
        ) : null}
        <span aria-hidden="true" className="shrink-0 transition-transform rtl:rotate-180 group-hover:translate-x-0.5">
          {'→'}
        </span>
      </button>
      {overflow}
    </div>
  );
}

/**
 * The navy structural header — the approved Mortgage hero, promoted.
 * Deep ink ground, gold eyebrow, white title, a gold hairline of light.
 * Structure only: the WORK always happens on white below it.
 */
export function PageHero({ eyebrow, title, subtitle, actions, compact = false }: {
  eyebrow?: string | null;
  title: string;
  subtitle?: string | null;
  actions?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <header className={`overflow-hidden rounded-2xl bg-[#0C1119] text-white shadow-hover ${compact ? 'px-5 py-5 sm:px-7 sm:py-6' : 'px-5 py-6 sm:px-9 sm:py-8'}`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[hsl(38_92%_60%)]">{eyebrow}</p>
          ) : null}
          <h1 className={`mt-1.5 font-display font-bold leading-tight tracking-[-0.02em] text-white ${compact ? 'text-2xl sm:text-3xl' : 'text-3xl sm:text-4xl'}`}>
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 max-w-[58ch] text-[15px] leading-relaxed text-white/80 sm:text-base">{subtitle}</p>
          ) : null}
          <span className="mt-4 block h-[3px] w-16 rounded-full bg-[hsl(38_92%_56%)]" aria-hidden="true" />
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
