// HOMATCH HOME FINANCING — the adapter between mortgage numbers and the
// shared workspace controls.
//
// The controls in src/components/workspace speak in figures, presets and
// sources. Mortgage speaks in `number | null` and a five-value
// ValueOrigin. This file is the one place the two meet, so no mortgage
// view has to know how a chip is built and no workspace control has to
// know what a mortgage is.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { ChipField, ChoiceField, SourceBadge, TextField } from '@/components/workspace/controls';
import type { ValueSource } from '@/components/workspace/sources';
import { FigureValue, type FigureKind } from '@/components/workspace/primitives';
import { mortgagePresetsFor, type PresetContext } from '@/mortgage/presets';
import type { ValueOrigin } from '@/mortgage/types';

/**
 * A plain number as the shared figure shape.
 *
 * `reasonKey` rather than a reason enum: mortgage engines already return
 * i18n keys for their gaps, and the shared FigureValue passes an
 * unrecognised reason straight through to t(). One less vocabulary.
 */
export const fig = (value: number | null, reasonKey = 'mortgage_value_not_entered') => ({
  value,
  unavailable: value === null ? reasonKey : null,
});

/** Mortgage's ValueOrigin in the workspace's badge vocabulary. */
export const ORIGIN_SOURCE: Record<ValueOrigin, ValueSource> = {
  CALCULATED: 'CALCULATED',
  USER_PROVIDED: 'USER',
  OFFICIAL_RULE: 'OFFICIAL',
  ESTIMATE: 'ESTIMATE',
  AI_EXPLANATION: 'AI',
};

export function OriginBadge({ origin, className }: { origin: ValueOrigin; className?: string }) {
  return <SourceBadge source={ORIGIN_SOURCE[origin]} className={className} />;
}

/* ── One question ───────────────────────────────────────────────────── */

export function NumberField({
  field,
  labelKey,
  hintKey,
  kind,
  currency,
  value,
  onChange,
  context,
  required,
  /** Rendered under the control — a derived figure, a warning, anything. */
  children,
}: {
  field: string;
  labelKey: string;
  hintKey?: string;
  kind: FigureKind | 'moneyPerSqm';
  currency: string;
  value: number | null;
  onChange: (value: number | null) => void;
  context: PresetContext;
  required?: boolean;
  children?: React.ReactNode;
}) {
  const { t } = useLanguage();
  const labelId = `mtg-${field}`;
  const presets = mortgagePresetsFor(field, context);

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span id={labelId} className="text-sm font-medium text-foreground">
          {t(labelKey)}
        </span>
        {required ? <span className="text-2xs text-muted-foreground">{t('mortgage_required')}</span> : null}
      </div>
      {hintKey ? (
        <p className="mb-2.5 max-w-[60ch] text-2xs leading-relaxed text-muted-foreground">{t(hintKey)}</p>
      ) : null}
      <ChipField
        presets={presets}
        value={value ?? undefined}
        onChange={(next) => onChange(next)}
        kind={kind as never}
        currency={currency}
        labelledBy={labelId}
      />
      {children}
    </div>
  );
}

export function OptionField({
  labelKey,
  hintKey,
  options,
  value,
  onChange,
}: {
  labelKey: string;
  hintKey?: string;
  options: { value: string; labelKey: string }[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const { t } = useLanguage();
  const labelId = `mtg-opt-${labelKey}`;
  return (
    <div>
      <span id={labelId} className="mb-2.5 block text-sm font-medium text-foreground">
        {t(labelKey)}
      </span>
      {hintKey ? (
        <p className="mb-2.5 max-w-[60ch] text-2xs leading-relaxed text-muted-foreground">{t(hintKey)}</p>
      ) : null}
      <ChoiceField options={options} value={value ?? undefined} onChange={onChange} labelledBy={labelId} />
    </div>
  );
}

export function NameField({
  labelKey,
  value,
  onChange,
}: {
  labelKey: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const { t } = useLanguage();
  const labelId = `mtg-name-${labelKey}`;
  return (
    <div>
      <span id={labelId} className="mb-2.5 block text-sm font-medium text-foreground">
        {t(labelKey)}
      </span>
      <TextField value={value ?? undefined} onChange={onChange} labelledBy={labelId} />
    </div>
  );
}

/* ── A row of label + figure, for the mobile-native tables ──────────── */

export function StatRow({
  labelKey,
  value,
  kind,
  currency,
  decimals,
  tone,
}: {
  labelKey: string;
  value: number | null;
  kind: FigureKind;
  currency?: string;
  decimals?: number;
  tone?: 'default' | 'muted' | 'negative';
}) {
  const { t } = useLanguage();
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2.5 last:border-0">
      <span className="text-sm text-muted-foreground">{t(labelKey)}</span>
      <span
        className={cn(
          'shrink-0 text-sm tabular-nums',
          tone === 'muted' && 'text-muted-foreground',
          tone === 'negative' && 'text-[hsl(var(--destructive))]',
          (!tone || tone === 'default') && 'text-foreground',
        )}
      >
        <FigureValue figure={fig(value)} kind={kind} currency={currency} decimals={decimals} />
      </span>
    </div>
  );
}
