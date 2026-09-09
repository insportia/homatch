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
    Backed by --page-inset (index.css), which is the single definition of
    where that edge is. */
export const PAGE_INSET = 'ps-[var(--page-inset)]';

/** The hero's split, expressed once.
 *
 * The copy column takes this share of the PAGE CONTAINER — not of the
 * viewport — so the headline keeps a sane measure on a wide monitor instead
 * of being squeezed between a fixed left gutter and a viewport-relative
 * image. The photograph starts where that column ends and bleeds to the
 * viewport edge, which is what makes the hero read as wider than the grid
 * while still being aligned to it. */
export const HERO_COPY_SHARE = 0.47;
export const HERO_SPLIT = `calc(var(--page-inset) + ${HERO_COPY_SHARE} * min(100vw - 2 * var(--page-inset), var(--page-max)))`;

export function Eyebrow({ children, tone = 'gold' }: { children: React.ReactNode; tone?: 'gold' | 'light' }) {
  return (
    <p className={`text-[11px] font-semibold uppercase tracking-[0.2em] ${tone === 'gold' ? 'text-gold' : 'text-primary-foreground/55'}`}>
      {children}
    </p>
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
      <Eyebrow tone={light ? 'light' : 'gold'}>{eyebrow}</Eyebrow>
      <h2
        className={`mt-4 text-balance font-semibold leading-[1.12] tracking-tight ${light ? 'text-primary-foreground' : 'text-foreground'}`}
        style={{ fontSize: 'clamp(1.75rem, 3.1vw, 2.9rem)' }}
      >
        {title}
      </h2>
      {body && (
        <p className={`mt-5 text-pretty text-[15px] leading-relaxed sm:text-base ${light ? 'text-primary-foreground/70' : 'text-ink-soft'}`}>
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
    tone === 'light' ? 'text-primary-foreground/85 hover:text-primary-foreground'
      : tone === 'gold' ? 'text-gold hover:text-foreground'
        : 'text-foreground hover:text-gold';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group inline-flex items-center gap-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${colour} ${className}`}
    >
      {label}
      <ArrowRight
        className={`h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-0.5' : ''}`}
        aria-hidden="true"
      />
    </button>
  );
}

/** Section vertical rhythm. Deliberately large; the page should breathe. */
export const SECTION_Y = 'py-20 sm:py-24 lg:py-28';
