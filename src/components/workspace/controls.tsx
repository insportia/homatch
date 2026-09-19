// HOMATCH WORKSPACE — the things you click.
//
// SHARED BY INVESTMENT AND MORTGAGE. See the note at the top of
// primitives.tsx for why these live here rather than inside one product.
//
// THE DEFAULT IS NOT A TEXT BOX
//
// Every control here leads with options and keeps typing behind a "custom"
// button. That is not a stylistic preference: an empty numeric field asks
// somebody to produce a figure out of nothing, while three plausible
// amounts ask them to recognise one. Recognition is faster, and on a phone
// it is the difference between finishing and abandoning.
//
// WHERE A NUMBER CAME FROM IS PART OF THE CONTROL
//
// A suggestion computed from what was already entered, a market
// observation, a trade convention, a published rule and a round
// illustration are five different kinds of claim, and a chip that renders
// them identically is quietly dishonest. Every option carries its source
// and shows it.
//
// TAP TARGETS
//
// Nothing here is smaller than 44px in its tappable dimension. The chips
// wrap rather than scroll horizontally, because a hidden option is not an
// option — and a row that scrolls sideways on a phone hides most of them.

import React, { useEffect, useRef, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { formatMoney, formatNumber, formatPercent, intlLocaleFor } from './primitives';
import { SOURCE_LABEL_KEYS, SOURCE_TONES, type ValueSource } from './sources';

/* ── The shapes a control speaks ────────────────────────────────────── */

/** How a numeric value is rendered and what unit it wears. */
export type ValueKind = 'money' | 'moneyPerSqm' | 'percent' | 'months' | 'years' | 'number' | 'text';

/** One selectable option on a choice or card control. */
export interface WorkspaceOption {
  value: string;
  labelKey: string;
  /** Shown under the label on a card. */
  descriptionKey?: string;
}

/** One clickable suggestion on a numeric field. */
export interface WorkspacePreset {
  value: number;
  /** Rendered as-is when present; otherwise the value is formatted by kind. */
  labelKey?: string;
  kind: ValueSource;
  /** Extra line under the chip, e.g. "$750/m² × 80 m²". */
  noteKey?: string;
  noteVars?: Record<string, string | number>;
}

/* ── Where a value came from ────────────────────────────────────────── */

export type { ValueSource };

export function SourceBadge({ source, className }: { source: ValueSource; className?: string }) {
  const { t } = useLanguage();
  const key = SOURCE_LABEL_KEYS[source];
  const tone = SOURCE_TONES[source];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-[1px] text-2xs font-medium leading-none',
        tone,
        className,
      )}
    >
      {t(key)}
    </span>
  );
}

/* ── Formatting a value for a chip ──────────────────────────────────── */

/**
 * ONE ROW, ONE NOTATION.
 *
 * Money compacts above a hundred thousand, which is right on its own and
 * wrong in a row of choices: "$84,000 · $112K" reads as two different kinds
 * of number and the eye stops to compare them. So the decision belongs to
 * the SET, not the value — the caller passes `compact` once for every chip
 * it is about to draw. Left unset, a standalone figure decides for itself.
 */
export function formatValue(
  value: number,
  kind: ValueKind,
  currency: string,
  locale: string,
  t: (k: string, v?: Record<string, string | number>) => string,
  compact?: boolean,
): string {
  switch (kind) {
    case 'money':
      return formatMoney(value, currency, locale, { compact: compact ?? value >= 100000 });
    case 'moneyPerSqm':
      return `${formatMoney(value, currency, locale)}/m²`;
    case 'percent':
      return formatPercent(value, locale, value % 1 === 0 ? 0 : 1);
    case 'months':
      return value % 12 === 0 && value >= 12
        ? t('inv_unit_years', { n: value / 12 })
        : t('inv_unit_months', { n: formatNumber(value, locale, value % 1 === 0 ? 0 : 1) });
    default:
      return formatNumber(value, locale, value % 1 === 0 ? 0 : 1);
  }
}

/* ── Chips: the workhorse ───────────────────────────────────────────── */

export function ChipField({
  presets,
  value,
  onChange,
  kind,
  currency,
  labelledBy,
}: {
  presets: WorkspacePreset[];
  value: number | undefined;
  onChange: (value: number | null) => void;
  kind: ValueKind;
  currency: string;
  labelledBy?: string;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const matched = presets.find((preset) => nearlyEqual(preset.value, value));
  // Decided across the whole row so every chip in it reads alike.
  const compact = presets.some((preset) => Math.abs(preset.value) >= 100_000);
  // "Custom" stays open while a typed value is in play, and opens on demand.
  const [typing, setTyping] = useState(false);
  const isCustom = value !== undefined && !matched;

  useEffect(() => {
    if (typing) inputRef.current?.focus();
  }, [typing]);

  const showInput = typing || isCustom;

  return (
    <div className="space-y-2" role="group" aria-labelledby={labelledBy}>
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => {
          const active = nearlyEqual(preset.value, value);
          return (
            <button
              key={`${preset.value}-${preset.labelKey ?? ''}`}
              type="button"
              onClick={() => {
                setTyping(false);
                onChange(active ? null : preset.value);
              }}
              aria-pressed={active}
              className={cn(
                'min-h-[44px] rounded-xl border px-4 py-2 text-start transition-colors',
                active
                  ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]'
                  : 'border-border bg-[hsl(var(--secondary))] hover:border-[hsl(var(--gold-border))]',
              )}
            >
              <span
                className={cn(
                  'block text-sm font-medium tabular-nums',
                  active ? 'text-[hsl(var(--gold-ink))]' : 'text-foreground',
                )}
              >
                {preset.labelKey
                  ? t(preset.labelKey, preset.noteVars)
                  : formatValue(preset.value, kind, currency, locale, t, compact)}
              </span>
              {preset.noteKey ? (
                <span className="mt-0.5 block text-2xs text-muted-foreground">
                  {t(preset.noteKey, preset.noteVars)}
                </span>
              ) : null}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setTyping((open) => !open)}
          aria-pressed={showInput}
          className={cn(
            'flex min-h-[44px] items-center gap-1.5 rounded-xl border px-4 py-2 text-sm transition-colors',
            showInput
              ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
              : 'border-dashed border-border text-muted-foreground hover:text-foreground',
          )}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          {t('inv_custom')}
        </button>
      </div>

      {showInput ? (
        <div className="flex items-stretch gap-2">
          <span className="flex flex-1 items-stretch overflow-hidden rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--input))]">
            <input
              ref={inputRef}
              type="number"
              inputMode="decimal"
              value={value ?? ''}
              aria-label={t('inv_custom_value')}
              onChange={(event) => {
                const raw = event.target.value;
                onChange(raw === '' ? null : Number(raw));
              }}
              className="min-h-[44px] w-full min-w-0 bg-transparent px-4 text-base text-foreground outline-none"
            />
            <span className="flex items-center px-3 text-xs text-muted-foreground">
              {unitFor(kind, currency, t)}
            </span>
          </span>
          {value !== undefined ? (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setTyping(false);
              }}
              aria-label={t('inv_clear')}
              className="flex min-h-[44px] w-11 items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function unitFor(
  kind: ValueKind,
  currency: string,
  t: (k: string) => string,
): string {
  switch (kind) {
    case 'money':
      return currency;
    case 'moneyPerSqm':
      return `${currency}/m²`;
    case 'percent':
      return '%';
    case 'months':
      return t('inv_unit_months_short');
    default:
      return '';
  }
}

/** Two values within a hundredth. Presets are rounded; typed values are not. */
function nearlyEqual(a: number, b: number | undefined): boolean {
  return b !== undefined && Math.abs(a - b) < 0.005;
}

/* ── Choice: a segmented control for a small decision ───────────────── */

export function ChoiceField({
  options,
  value,
  onChange,
  labelledBy,
}: {
  options: WorkspaceOption[];
  value: string | undefined;
  onChange: (value: string | null) => void;
  labelledBy?: string;
}) {
  const { t } = useLanguage();
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-[hsl(var(--secondary))] p-1"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(active ? null : option.value)}
            aria-pressed={active}
            className={cn(
              'min-h-[40px] rounded-lg px-4 text-sm font-medium transition-colors',
              active
                ? 'bg-[hsl(var(--gold))] text-[hsl(var(--primary-foreground))]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(option.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

/* ── Yes / No ───────────────────────────────────────────────────────── */

export function YesNoField({
  value,
  onChange,
  labelledBy,
}: {
  value: string | undefined;
  onChange: (value: string | null) => void;
  labelledBy?: string;
}) {
  const { t } = useLanguage();
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex gap-2">
      {[
        { value: 'YES', labelKey: 'inv_yes' },
        { value: 'NO', labelKey: 'inv_no' },
      ].map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(active ? null : option.value)}
            aria-pressed={active}
            className={cn(
              'min-h-[44px] min-w-[5.5rem] rounded-xl border px-5 text-sm font-medium transition-colors',
              active
                ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                : 'border-border bg-[hsl(var(--secondary))] text-muted-foreground hover:text-foreground',
            )}
          >
            {t(option.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

/* ── Cards: for a decision that deserves room ───────────────────────── */

/**
 * COLUMNS ARE DECIDED HERE, NOT BY THE CALLER.
 *
 * These live in a 24rem sidebar, so three columns is about 7rem a card.
 * "Renovate and resell" in 7rem breaks mid-word — the choice that decides
 * the entire analysis, rendered as "Renov / ate and / resell". A card
 * carrying a description gets half the row; a bare label can have a third.
 */
export function CardChoiceField({
  options,
  value,
  onChange,
}: {
  options: WorkspaceOption[];
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  const { t } = useLanguage();
  const described = options.some((option) => option.descriptionKey);
  return (
    <div className={cn('grid gap-2.5', described ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              'flex min-h-[64px] flex-col justify-center rounded-xl border p-4 text-start transition-colors',
              active
                ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]'
                : 'border-border bg-[hsl(var(--secondary))] hover:border-[hsl(var(--gold-border))]',
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  'text-sm font-semibold',
                  active ? 'text-[hsl(var(--gold-ink))]' : 'text-foreground',
                )}
              >
                {t(option.labelKey)}
              </span>
              {active ? (
                <Check className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
              ) : null}
            </span>
            {option.descriptionKey ? (
              <span className="mt-1 block text-2xs leading-snug text-muted-foreground">
                {t(option.descriptionKey)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ── Free text, for names and places only ───────────────────────────── */

export function TextField({
  value,
  onChange,
  labelledBy,
}: {
  value: string | undefined;
  onChange: (value: string | null) => void;
  labelledBy?: string;
}) {
  return (
    <input
      type="text"
      dir="auto"
      aria-labelledby={labelledBy}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      className="min-h-[44px] w-full rounded-xl border border-border bg-[hsl(var(--input))] px-4 text-base text-foreground outline-none focus:border-[hsl(var(--gold-border))]"
    />
  );
}

/* ── A figure the product simply knows ──────────────────────────────── */

/**
 * A value the investor never has to enter because it follows from what they
 * already entered — a price per m², a balance still owed.
 *
 * Deliberately NOT an input. Rendering it as an empty box invites somebody
 * to type a third number that then disagrees with the two it came from.
 */
export function DerivedReadout({
  labelKey,
  value,
  kind,
  currency,
}: {
  labelKey: string;
  value: number;
  kind: ValueKind;
  currency: string;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border px-4 py-2.5">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        {t(labelKey)}
        <SourceBadge source="CALCULATED" />
      </span>
      <span className="text-sm font-medium tabular-nums text-foreground">
        {formatValue(value, kind, currency, locale, t)}
      </span>
    </div>
  );
}
