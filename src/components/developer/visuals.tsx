import React from 'react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import type { UnitStatus } from '@/services/developer/types';
import { formatMoney, formatNumber } from './primitives';

/**
 * THE VISUAL LANGUAGE OF THE DEVELOPER PRODUCT.
 *
 * primitives.tsx holds the furniture — panels, pills, tables, empty states.
 * This holds the things that make the product look like it is about BUILDINGS:
 * a sales bar you can read across a room, a hero figure that is allowed to be
 * bigger than its neighbours, a cover that is architecture rather than a grey
 * rectangle, and two small charts that cost no dependency.
 *
 * ONE RULE RUNS THROUGH ALL OF IT: different information gets different
 * treatment. Thirteen identical white tiles with a number in each is what this
 * product looked like before, and it is why it read as an admin panel. A
 * figure that matters is drawn large; a figure that supports it is drawn small
 * beside it; a proportion is drawn as a proportion rather than as six numbers
 * the reader has to add up.
 */

// ── Status colour, in one place ────────────────────────────────────────────

/**
 * The four states a sales floor actually talks about, and the colour each one
 * gets everywhere in the product — bar, plate, dot, legend.
 *
 * Restrained on purpose. Available is the brand's own gold because it is the
 * thing being sold; sold is near-black because it is finished and should
 * recede; the two in between are the only real colours on the page.
 */
export const STATUS_FILL: Record<UnitStatus, string> = {
  AVAILABLE: 'bg-gold',
  ON_HOLD: 'bg-slate-400',
  NEGOTIATION: 'bg-sky-500',
  RESERVED: 'bg-amber-500',
  CONTRACT_PENDING: 'bg-violet-500',
  SOLD: 'bg-foreground',
  HIDDEN: 'bg-muted-foreground/40',
};

export const STATUS_TEXT: Record<UnitStatus, string> = {
  AVAILABLE: 'text-gold-ink',
  ON_HOLD: 'text-slate-500',
  NEGOTIATION: 'text-sky-700 dark:text-sky-400',
  RESERVED: 'text-amber-700 dark:text-amber-400',
  CONTRACT_PENDING: 'text-violet-700 dark:text-violet-400',
  SOLD: 'text-foreground',
  HIDDEN: 'text-muted-foreground',
};

export interface StatusCounts {
  available: number;
  on_hold?: number;
  negotiation: number;
  reserved: number;
  contract_pending: number;
  sold: number;
}

const BAR_ORDER: Array<[keyof StatusCounts, UnitStatus, string]> = [
  ['sold', 'SOLD', 'dev_unit_status_sold'],
  ['contract_pending', 'CONTRACT_PENDING', 'dev_unit_status_contract_pending'],
  ['reserved', 'RESERVED', 'dev_unit_status_reserved'],
  ['negotiation', 'NEGOTIATION', 'dev_unit_status_negotiation'],
  ['on_hold', 'ON_HOLD', 'dev_unit_status_on_hold'],
  ['available', 'AVAILABLE', 'dev_unit_status_available'],
];

/**
 * WHERE THE PROJECT IS, IN ONE LINE.
 *
 * Sold first, available last, so the bar fills from the left as the building
 * sells and a glance at how far the dark runs is a glance at the quarter.
 * The same component is the project card's footer, the project header's
 * headline and the Home page's inventory band, which is how those three
 * screens end up agreeing with each other.
 */
export function SalesBar({
  counts, size = 'default', className, showLegend = false,
}: {
  counts: StatusCounts;
  size?: 'sm' | 'default' | 'lg';
  className?: string;
  showLegend?: boolean;
}) {
  const { t } = useLanguage();
  const segments = BAR_ORDER
    .map(([key, status, labelKey]) => ({
      status, labelKey, value: Number(counts[key] ?? 0),
    }))
    .filter((s) => s.value > 0);
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const height = size === 'lg' ? 'h-2.5' : size === 'sm' ? 'h-1' : 'h-1.5';

  return (
    <div className={className}>
      <div
        className={cn('flex w-full overflow-hidden rounded-full bg-muted', height)}
        role="img"
        aria-label={segments.map((s) => `${t(s.labelKey)} ${s.value}`).join(', ')}
      >
        {total === 0 ? null : segments.map((s) => (
          <span
            key={s.status}
            className={cn(STATUS_FILL[s.status], 'transition-[width] duration-500 ease-out')}
            style={{ width: `${(s.value / total) * 100}%` }}
          />
        ))}
      </div>
      {showLegend && total > 0 && (
        <ul className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          {segments.map((s) => (
            <li key={s.status} className="flex items-center gap-1.5 text-2xs">
              <span aria-hidden="true" className={cn('h-2 w-2 rounded-sm', STATUS_FILL[s.status])} />
              <span className="text-muted-foreground">{t(s.labelKey)}</span>
              <span className="tabular font-medium">{s.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A FIGURE THAT IS ALLOWED TO MATTER MORE THAN ITS NEIGHBOURS.
 *
 * `hero` is for the one number a screen exists to report. `default` supports
 * it. `quiet` is for context nobody scans for but everybody wants once they
 * have stopped. The three sizes are the whole point: a grid where every tile
 * is identical tells the reader that nothing on it is important.
 */
export function Metric({
  label, value, hint, delta, weight = 'default', tone, className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  delta?: { value: number; label?: string } | null;
  weight?: 'hero' | 'default' | 'quiet';
  tone?: 'attention' | 'good';
  className?: string;
}) {
  const size = weight === 'hero'
    ? 'text-[2.25rem] leading-[1.05] sm:text-[2.75rem]'
    : weight === 'quiet' ? 'text-lg' : 'text-2xl';
  return (
    <div className={cn('min-w-0', className)}>
      <p className={cn(
        'truncate text-2xs uppercase tracking-[0.12em]',
        tone === 'attention' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
      )}>
        {label}
      </p>
      <p className={cn(
        'mt-1 tabular font-semibold tracking-[-0.02em]',
        size,
        tone === 'good' && 'text-emerald-700 dark:text-emerald-400',
        tone === 'attention' && 'text-amber-700 dark:text-amber-400',
      )}>
        {value}
      </p>
      {(hint || delta) && (
        <p className="mt-1 truncate text-2xs text-muted-foreground">
          {delta && (
            <span className={cn(
              'mr-1.5 tabular font-medium',
              delta.value >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground',
            )}>
              {delta.value >= 0 ? '+' : ''}{delta.value}{delta.label ? ` ${delta.label}` : ''}
            </span>
          )}
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * A SECTION HEADING WITH A RULE UNDER IT.
 *
 * Architecture drawings label their parts; so does this. The gold hairline is
 * the only decoration, and it is what makes a long page read as a set of
 * rooms rather than a scroll of boxes.
 */
export function SectionHead({
  title, sub, action, className,
}: {
  title: string; sub?: string; action?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('mb-3.5 flex items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {title}
        </h2>
        <span aria-hidden="true" className="mt-1.5 block h-px w-10 bg-gold-border/70" />
        {sub && <p className="mt-2 max-w-prose text-xs text-muted-foreground">{sub}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * THE COVER OF A DEVELOPMENT.
 *
 * With a photograph, the photograph. Without one — which is every project on
 * its first day — a drawn elevation rather than a grey rectangle with a small
 * icon in the middle. The lines are derived from the project's own name, so
 * two developments do not look like the same missing image, and the whole
 * thing is eight SVG elements rather than a download.
 */
export function ProjectCover({
  src, name, className, ratio = 'aspect-[4/3]', overlay,
}: {
  src?: string | null;
  name: string;
  className?: string;
  ratio?: string;
  overlay?: React.ReactNode;
}) {
  const seed = React.useMemo(() => {
    let h = 0;
    for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h;
  }, [name]);

  const bays = 4 + (seed % 4);
  const storeys = 5 + ((seed >> 3) % 4);
  const lit = React.useMemo(() => {
    const set = new Set<number>();
    let h = seed || 1;
    const cells = bays * storeys;
    for (let i = 0; i < Math.max(3, Math.round(cells * 0.18)); i += 1) {
      h = (h * 1103515245 + 12345) >>> 0;
      set.add(h % cells);
    }
    return set;
  }, [seed, bays, storeys]);

  return (
    <div className={cn('relative overflow-hidden bg-muted', ratio, className)}>
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
        />
      ) : (
        /* A DRAWN ELEVATION, NOT A MISSING IMAGE.
           Every project has one on its first day, and a grey rectangle with a
           small icon in it is the single clearest signal that a product is
           unfinished. This is an outlined mass with a window grid, a datum
           line and a horizon — the vocabulary of an architect's drawing —
           and its proportions come from the project's own name, so two
           developments do not look like the same blank. */
        <svg
          viewBox="0 0 120 90"
          preserveAspectRatio="xMidYMax slice"
          className="h-full w-full"
          aria-hidden="true"
        >
          <rect width="120" height="90" className="fill-muted" />
          <g className="text-foreground">
            {/* The mass. */}
            <rect
              x={18} y={20} width={84} height={64}
              className="fill-current" opacity="0.08"
            />
            <rect
              x={18} y={20} width={84} height={64}
              className="stroke-current" fill="none" strokeWidth="0.7" opacity="0.5"
            />
            {/* The openings. */}
            {Array.from({ length: storeys }).flatMap((_, row) => (
              Array.from({ length: bays }).map((__, col) => {
                const w = 84 / bays;
                const h = 64 / storeys;
                const on = lit.has(row * bays + col);
                return (
                  <rect
                    key={`${row}-${col}`}
                    x={18 + col * w + w * 0.22}
                    y={20 + row * h + h * 0.22}
                    width={w * 0.56}
                    height={h * 0.56}
                    className="fill-current"
                    opacity={on ? 0.42 : 0.16}
                  />
                );
              })
            ))}
            {/* Parapet, datum and horizon. */}
            <line x1={14} y1={20} x2={106} y2={20} className="stroke-current" strokeWidth="1.1" opacity="0.55" />
            <line x1={4} y1={84} x2={116} y2={84} className="stroke-current" strokeWidth="0.7" opacity="0.35" />
            <line x1={4} y1={88} x2={116} y2={88} className="stroke-current" strokeWidth="0.4" opacity="0.18" />
          </g>
        </svg>
      )}
      {overlay}
    </div>
  );
}

// ── Two charts, no dependency ──────────────────────────────────────────────

/**
 * A BAR CHART THAT KNOWS WHEN TO SAY NOTHING.
 *
 * Every chart in this product renders real rows or renders an explanation.
 * Given no data it returns null and lets the caller show an empty state, so
 * there is no such thing here as a decorative axis with nothing under it.
 */
export function BarRows({
  rows, format, className, max,
}: {
  rows: Array<{ label: string; value: number; hint?: string; tone?: 'gold' | 'neutral' }>;
  format?: (n: number) => string;
  className?: string;
  max?: number;
}) {
  if (!rows.length) return null;
  const ceiling = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className={cn('space-y-2.5', className)}>
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3">
          <span className="truncate text-xs" title={row.label}>{row.label}</span>
          <span className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <span
              className={cn(
                'block h-full rounded-full transition-[width] duration-700 ease-out',
                row.tone === 'neutral' ? 'bg-foreground/70' : 'bg-gold',
              )}
              style={{ width: `${Math.max(2, (row.value / ceiling) * 100)}%` }}
            />
          </span>
          <span className="tabular text-xs font-medium">
            {format ? format(row.value) : row.value}
            {row.hint && <span className="ml-1.5 font-normal text-muted-foreground">{row.hint}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A FUNNEL, DRAWN AS ONE.
 *
 * Leads to viewings to reservations to sales is the shape of the business,
 * and four numbers in four boxes hide exactly the thing worth seeing: where
 * it narrows. Each step is drawn against the FIRST step, so the taper is the
 * conversion rate rather than a decoration.
 */
export function Funnel({
  steps, className,
}: {
  steps: Array<{ label: string; value: number }>;
  className?: string;
}) {
  const { lang: language } = useLanguage();
  const first = steps[0]?.value ?? 0;
  if (!steps.length || first <= 0) return null;
  return (
    <ol className={cn('space-y-2', className)}>
      {steps.map((step, i) => {
        const share = step.value / first;
        const prev = i > 0 ? steps[i - 1].value : null;
        const rate = prev && prev > 0 ? Math.round((step.value / prev) * 100) : null;
        return (
          <li key={step.label} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{step.label}</span>
            <span className="relative h-7 flex-1 overflow-hidden rounded-sm bg-muted">
              <span
                className="absolute inset-y-0 left-0 rounded-sm bg-gold/70 transition-[width] duration-700 ease-out"
                style={{ width: `${Math.max(3, share * 100)}%` }}
              />
              <span className="absolute inset-y-0 left-2.5 flex items-center tabular text-xs font-semibold">
                {formatNumber(step.value, language)}
              </span>
            </span>
            <span className="w-12 shrink-0 text-right tabular text-2xs text-muted-foreground">
              {rate === null ? '' : `${rate}%`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * MONEY AS A PROPORTION.
 *
 * Contracted, collected and outstanding are three numbers whose only
 * interesting property is their ratio. Drawn, that is one glance; listed, it
 * is arithmetic.
 */
export function MoneyBar({
  collected, contracted, overdue = 0, currency, className,
}: {
  collected: number; contracted: number; overdue?: number;
  currency: string; className?: string;
}) {
  const { t, lang: language } = useLanguage();
  const total = Math.max(contracted, collected, 1);
  const pctCollected = Math.min(100, (collected / total) * 100);
  const pctOverdue = Math.min(100 - pctCollected, (overdue / total) * 100);
  return (
    <div className={className}>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <span className="bg-emerald-600 transition-[width] duration-700" style={{ width: `${pctCollected}%` }} />
        <span className="bg-amber-500 transition-[width] duration-700" style={{ width: `${pctOverdue}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-2xs">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-emerald-600" />
          <span className="text-muted-foreground">{t('dev_stat_collected')}</span>
          <span className="tabular font-medium">{formatMoney(collected, currency, language)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-muted-foreground/40" />
          <span className="text-muted-foreground">{t('dev_stat_contracted')}</span>
          <span className="tabular font-medium">{formatMoney(contracted, currency, language)}</span>
        </span>
        {overdue > 0 && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-amber-500" />
            <span className="text-amber-700 dark:text-amber-400">{t('dev_stat_overdue')}</span>
            <span className="tabular font-medium">{formatMoney(overdue, currency, language)}</span>
          </span>
        )}
      </div>
    </div>
  );
}
