import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { ArrowRight } from 'lucide-react';

/**
 * The Main Page's shared editorial furniture.
 *
 * These exist so sections are composed from typography, rules and spacing
 * rather than from bordered rectangles. There is deliberately no generic
 * "Card" here: a bordered surface appears on this page only where it holds a
 * real object or interaction (the AI console, the illustrative result
 * panels), and those build their own.
 */

/** The page grid. One measure, used by every section, so the left edge of the
    logo, the headline and every section title sit on the same line. */
export const PAGE = 'mx-auto w-full max-w-[90rem] px-5 sm:px-8 lg:px-10';

/** Start-padding that lands exactly on the page grid's content edge, for
    full-bleed sections that align to it without nesting another container.
    Backed by --page-inset (index.css), the single definition of that edge. */
export const PAGE_INSET = 'ps-[var(--page-inset)]';

/** The hero's split, expressed once.
 *
 * The copy column takes this share of the PAGE CONTAINER — not of the
 * viewport — so the headline keeps a sane measure on a wide monitor instead
 * of being squeezed between a fixed left gutter and a viewport-relative
 * image. The photograph starts where that column ends and bleeds to the
 * viewport edge, which is what makes the hero read as wider than the grid
 * while still being aligned to it. */
export const HERO_COPY_SHARE = 0.5;
export const HERO_SPLIT = `calc(var(--page-inset) + ${HERO_COPY_SHARE} * min(100vw - 2 * var(--page-inset), var(--page-max)))`;

/** Section vertical rhythm. Deliberately large; the page should breathe. */
export const SECTION_Y = 'py-20 sm:py-24 lg:py-28';

/**
 * The small letter-spaced label above a headline.
 *
 * On light grounds this uses --gold-ink, never --gold: champagne gold is
 * 2.6:1 on warm-white, which is unreadable at 11px. The decorative gold is
 * reserved for rules, icons and dark surfaces, where it clears 6.9:1.
 */
export function Eyebrow({ children, tone = 'dark' }: { children: React.ReactNode; tone?: 'dark' | 'light' }) {
  return (
    <p className={`text-[11px] font-semibold uppercase tracking-[0.22em] ${tone === 'light' ? 'text-gold' : 'text-gold-ink'}`}>
      {children}
    </p>
  );
}

/**
 * THE ICON SYSTEM
 *
 * One treatment everywhere: a thin (1.5px) lucide stroke in near-black on a
 * small warm square with a hairline. Gold arrives on interaction — the tile
 * warms and the stroke turns gold — rather than shouting at rest. The tile
 * grows with size while the stroke does not, so a row of them reads as one
 * set rather than as assorted graphics.
 */
export function Icon({
  icon: Glyph, size = 'md', tone = 'dark', className = '',
}: {
  icon: React.ElementType;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'dark' | 'light';
  className?: string;
}) {
  const box = size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-12 w-12' : 'h-11 w-11';
  const glyph = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-5 w-5' : 'h-[18px] w-[18px]';
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-[0.7rem] border transition-colors duration-300 motion-reduce:transition-none ${
        tone === 'light'
          ? 'border-white/15 bg-white/[0.06] text-gold'
          : 'border-border bg-secondary text-foreground group-hover:border-gold/45 group-hover:bg-gold-soft group-hover:text-gold-ink'
      } ${box} ${className}`}
      aria-hidden="true"
    >
      <Glyph className={glyph} strokeWidth={1.5} />
    </span>
  );
}

/**
 * A section's opening block: eyebrow, headline, and an optional standfirst.
 * Constrained to a reading measure rather than the full page width, which is
 * most of what keeps the page feeling editorial instead of like a dashboard.
 */
export function SectionIntro({
  eyebrow, title, body, tone = 'dark', align = 'start', className = '',
}: {
  eyebrow: string;
  title: React.ReactNode;
  body?: string;
  tone?: 'dark' | 'light';
  align?: 'start' | 'center';
  className?: string;
}) {
  const light = tone === 'light';
  return (
    <div className={`${align === 'center' ? 'mx-auto max-w-[44rem] text-center' : 'max-w-[46rem]'} ${className}`}>
      <Eyebrow tone={light ? 'light' : 'dark'}>{eyebrow}</Eyebrow>
      <h2
        className={`mt-5 text-balance font-semibold leading-[1.1] tracking-[-0.02em] ${light ? 'text-white' : 'text-foreground'}`}
        style={{ fontSize: 'clamp(1.75rem, 3.1vw, 2.9rem)' }}
      >
        {title}
      </h2>
      {body && (
        <p className={`mt-5 text-pretty text-[15px] leading-[1.75] sm:text-base ${light ? 'text-white/70' : 'text-ink-soft'}`}>
          {body}
        </p>
      )}
    </div>
  );
}

/** A quiet text link with a directional arrow. The page's default control. */
export function ArrowLink({
  label, onClick, tone = 'dark', className = '',
}: { label: string; onClick: () => void; tone?: 'dark' | 'light' | 'gold'; className?: string }) {
  const { isRTL } = useLanguage();
  const colour =
    tone === 'light' ? 'text-white/85 hover:text-white'
      : tone === 'gold' ? 'text-gold-ink hover:text-foreground'
        : 'text-foreground hover:text-gold-ink';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group inline-flex items-center gap-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${colour} ${className}`}
    >
      {label}
      <ArrowRight
        className={`h-4 w-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`}
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </button>
  );
}
