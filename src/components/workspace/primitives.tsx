// HOMATCH WORKSPACE — the pieces every analytical module is built from.
//
// SHARED BY INVESTMENT AND MORTGAGE, ON PURPOSE
//
// These started in src/components/investment and moved here the day a
// second product needed the same surface. Copying them would have given
// Homatch two design systems that agreed today and drifted by the next
// change; importing Mortgage's result cards out of a folder called
// "investment" would have been the same coupling with a worse name. So
// the presentation layer lives here and both products import it, while
// everything that knows what a number MEANS stays in its own product.
//
// WHY A FIGURE IS A COMPONENT AND NOT A FORMAT CALL
//
// Every number on this surface can legitimately not exist, and the engine
// says so with a reason rather than with a zero. If rendering were
// `fmt(figure.value)` then every call site would independently decide what
// to do with null, and the sites that forgot would print "0" or "NaN" or
// "—" beside a real figure of the same size, where a reader has no way to
// tell "nothing to worry about" from "nobody told us". So the decision is
// made once, here, and a gap looks like a gap: dimmer, smaller, and
// carrying the reason it is missing.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

/**
 * A number that might legitimately not exist, with the reason when it does not.
 *
 * `unavailable` is a plain string rather than a union so both products can
 * use their own vocabulary: Investment passes its named reasons
 * ('MISSING_INPUT', 'NOT_FINANCED', ...) and `unavailableKey` maps them;
 * Mortgage passes an i18n key directly and `unavailableKey` passes it
 * through. Investment's own Figure type is structurally assignable to
 * this, so no call site there changes.
 */
export interface WorkspaceFigure {
  value: number | null;
  unavailable: string | null;
  detail?: string;
}

/* ── Formatting ─────────────────────────────────────────────────────── */

/**
 * Money, in the caller's locale.
 *
 * Whole units by default: cents on a property price are noise, and the
 * engine keeps the precision internally regardless — this is display
 * rounding, applied once, at the edge.
 */
export function formatMoney(
  value: number,
  currency: string,
  locale: string,
  options: { compact?: boolean; decimals?: number } = {},
): string {
  const decimals = options.decimals ?? 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: decimals,
      minimumFractionDigits: 0,
      ...(options.compact && Math.abs(value) >= 10000
        ? { notation: 'compact' as const, maximumFractionDigits: 1 }
        : {}),
    }).format(value);
  } catch {
    // An unsupported currency code must not take a whole page down.
    return `${Math.round(value).toLocaleString(locale)} ${currency}`;
  }
}

export function formatPercent(value: number, locale: string, decimals = 2): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      maximumFractionDigits: decimals,
      minimumFractionDigits: 0,
    }).format(value / 100);
  } catch {
    return `${value.toFixed(decimals)}%`;
  }
}

export function formatNumber(value: number, locale: string, decimals = 2): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: decimals }).format(value);
  } catch {
    return value.toFixed(decimals);
  }
}

/** Maps the six app languages onto BCP-47 tags Intl actually knows. */
export function intlLocaleFor(lang: string): string {
  switch (lang) {
    case 'ka':
      return 'ka-GE';
    case 'ru':
      return 'ru-RU';
    case 'tr':
      return 'tr-TR';
    case 'ar':
      return 'ar';
    case 'he':
      return 'he-IL';
    default:
      return 'en-US';
  }
}

/* ── The figure ─────────────────────────────────────────────────────── */

export type FigureKind = 'money' | 'percent' | 'years' | 'months' | 'ratio' | 'number';

interface FigureValueProps {
  figure: WorkspaceFigure;
  kind: FigureKind;
  currency?: string;
  className?: string;
  /** Rendered instead of the reason when the figure is missing. */
  fallbackKey?: string;
  decimals?: number;
}

/**
 * One number, or one honest absence.
 *
 * The unavailable branch is NOT an em dash. A dash is what a spreadsheet
 * prints for zero, and a reader who has been shown fourteen real figures
 * will read the fifteenth dash as "nothing here" rather than as "we could
 * not establish this". The reason is what makes it useful.
 */
export function FigureValue({
  figure,
  kind,
  currency = 'USD',
  className,
  fallbackKey,
  decimals,
}: FigureValueProps) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);

  if (figure.value === null) {
    const reasonKey = fallbackKey ?? unavailableKey(figure.unavailable);
    return (
      <span className={cn('text-muted-foreground text-sm font-normal', className)} title={figure.detail}>
        {t(reasonKey)}
      </span>
    );
  }

  return (
    <span className={cn('tabular-nums', className)}>
      {renderValue(figure.value, kind, currency, locale, t, decimals)}
    </span>
  );
}

function renderValue(
  value: number,
  kind: FigureKind,
  currency: string,
  locale: string,
  t: (k: string, v?: Record<string, string | number>) => string,
  decimals?: number,
): string {
  switch (kind) {
    case 'money':
      return formatMoney(value, currency, locale, { decimals: decimals ?? 0 });
    case 'percent':
      return formatPercent(value, locale, decimals ?? 2);
    case 'years':
      return t('inv_unit_years', { n: formatNumber(value, locale, decimals ?? 1) });
    case 'months':
      return t('inv_unit_months', { n: formatNumber(value, locale, decimals ?? 0) });
    case 'ratio':
      return formatNumber(value, locale, decimals ?? 2);
    default:
      return formatNumber(value, locale, decimals ?? 0);
  }
}

export function unavailableKey(reason: WorkspaceFigure['unavailable']): string {
  switch (reason) {
    case 'MISSING_INPUT':
      return 'inv_gap_missing_input';
    case 'NOT_MEANINGFUL':
      return 'inv_gap_not_meaningful';
    case 'NO_POSITIVE_INCOME':
      return 'inv_gap_no_positive_income';
    case 'NEVER_RECOVERS':
      return 'inv_gap_never_recovers';
    case 'NOT_FINANCED':
      return 'inv_gap_not_financed';
    default:
      /*
       * An unrecognised reason is treated as ALREADY BEING a key.
       *
       * Investment names its gaps with a small enum and they are all
       * handled above. Mortgage's engines already return i18n keys as
       * their reason ('mortgage_effective_rate_unavailable_no_financing'
       * and friends), so the honest thing is to render what was handed
       * over rather than flatten every mortgage gap into Investment's
       * generic "not established yet".
       */
      return reason ?? 'inv_gap_missing_input';
  }
}

/* ── Layout ─────────────────────────────────────────────────────────── */

/**
 * One analytical module.
 *
 * `focused` is set when the Consultant's last answer was about this module;
 * it draws the single gold hairline that says "this is the thing you just
 * asked about". Only ever one at a time — see the workspace.
 */
export function Module({
  id,
  titleKey,
  subtitleKey,
  eyebrowKey,
  focused,
  actions,
  children,
  className,
}: {
  id?: string;
  titleKey: string;
  subtitleKey?: string;
  eyebrowKey?: string;
  focused?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const { t } = useLanguage();
  return (
    <section
      id={id}
      className={cn(
        'hm-workspace-panel scroll-mt-24 p-5 transition-shadow sm:p-7',
        focused && 'hm-workspace-focus',
        className,
      )}
    >
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrowKey ? (
            <p className="mb-1 text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--gold-ink))]">
              {t(eyebrowKey)}
            </p>
          ) : null}
          <h2 className="font-display text-xl font-semibold leading-tight text-foreground">
            {t(titleKey)}
          </h2>
          {subtitleKey ? (
            <p className="mt-1.5 max-w-[60ch] text-sm text-muted-foreground">{t(subtitleKey)}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** A headline figure with its label, and nothing else competing with it. */
export function Metric({
  labelKey,
  figure,
  kind,
  currency,
  badge,
  emphasis = false,
  decimals,
  noteKey,
}: {
  labelKey: string;
  figure: WorkspaceFigure;
  kind: FigureKind;
  currency?: string;
  /*
   * The provenance chip, supplied by the caller rather than chosen here.
   *
   * Investment labels a value by where it CAME FROM (a portal sweep, the
   * property record, the investor); Mortgage labels it by what KIND of
   * claim it is (calculated, an official rule, an estimate). Those are
   * different vocabularies with different tones, and a shared component
   * that tried to know both would end up knowing neither well.
   */
  badge?: React.ReactNode;
  emphasis?: boolean;
  decimals?: number;
  noteKey?: string;
}) {
  const { t } = useLanguage();
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        {/* Wraps rather than truncates: a metric whose label reads
            "Completion value for your target r…" has stopped being a
            label. Two lines of small caps costs less than the meaning. */}
        <p className="text-xs font-medium uppercase leading-tight tracking-wide text-muted-foreground">
          {t(labelKey)}
        </p>
        {badge}
      </div>
      <p
        className={cn(
          'mt-1.5 font-display font-semibold leading-none',
          emphasis ? 'text-3xl text-[hsl(var(--gold-ink))]' : 'text-2xl text-foreground',
        )}
      >
        <FigureValue figure={figure} kind={kind} currency={currency} decimals={decimals} />
      </p>
      {noteKey ? <p className="mt-1.5 text-2xs text-muted-foreground">{t(noteKey)}</p> : null}
    </div>
  );
}

/** A quiet horizontal rule with a label, for sectioning inside a module. */
export function Divider({ labelKey }: { labelKey?: string }) {
  const { t } = useLanguage();
  if (!labelKey) return <div className="my-5 h-px w-full bg-border" />;
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {t(labelKey)}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * The line that appears where a module cannot answer yet.
 *
 * Deliberately an invitation rather than an error: the consultation has not
 * finished, which is the normal state, and a red empty-state would make a
 * product that is working correctly look broken.
 */
export function NeedsInput({ missing }: { missing: string[] }) {
  const { t } = useLanguage();
  if (!missing.length) return null;
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
      {t('inv_needs_input_prefix')}{' '}
      <span className="text-foreground">{missing.map((key) => t(key)).join(', ')}</span>
    </p>
  );
}

/** A segmented control. Native buttons, no portal — see the surface note. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabelKey,
}: {
  /*
   * NoInfer, so the VALUE decides the type and the options only have to fit.
   *
   * Both other props are inference-blocked so that `value` alone decides it.
   *
   * `onChange` was the real culprit. Given a React setter, inferring T from
   * `(value: T) => void` against `Dispatch<SetStateAction<M>>` yields
   * `M | ((prev: M) => M)` — a union containing a FUNCTION, which fails the
   * `string | number` constraint. TypeScript then discards the candidate and
   * falls back to the constraint itself, so the call site was offered
   * `(value: string | number) => void`, which no narrowly-typed setter is
   * assignable to. `options` widens it the same way via .map().
   *
   * Three such errors were failing CI's type-check, and that job gates
   * Deploy Edge Functions for the whole repository.
   *
   * Type-level only: nothing about the rendered control changes.
   */
  options: ReadonlyArray<{ value: NoInfer<T>; label: string }>;
  value: T;
  onChange: (value: NoInfer<T>) => void;
  ariaLabelKey: string;
}) {
  const { t } = useLanguage();
  return (
    <div
      role="group"
      aria-label={t(ariaLabelKey)}
      className="inline-flex flex-wrap gap-1 rounded-full border border-border bg-[hsl(var(--secondary))] p-1"
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={option.value === value}
          className={cn(
            'rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors',
            option.value === value
              ? 'bg-[hsl(var(--gold))] text-[hsl(var(--primary-foreground))]'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
