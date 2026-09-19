// HOMATCH INVESTMENT INTELLIGENCE — entering the deal, mostly by clicking.
//
// WHAT THIS IS NOT
//
// Not a form with twenty fields and a Calculate button. Sections open one
// at a time, collapse into a one-line summary once answered, and the
// analysis beside them updates on every click. There is no submit step
// because there is nothing to submit: the numbers are already moving.
//
// THREE RULES IT ENFORCES
//
//   ONE QUESTION AT A TIME IS OBVIOUS. The section holding the next
//   unanswered question is the one that is open, and it says so.
//
//   AN ANSWERED SECTION GETS OUT OF THE WAY. It becomes "80 m² · $100,000 ·
//   $1,250/m²" with a tick, and one tap reopens it. A long page of open
//   sections is the form this replaces.
//
//   A DERIVED FIGURE IS SHOWN, NOT ASKED. Price per m² appears the moment a
//   price and an area exist. Asking for it would invite a third number that
//   disagrees with the two it came from.

import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, Sliders } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { InvestmentContext } from '@/investment/consultant/context';
import {
  type FieldDef,
  type StrategyId,
  nextUnansweredField,
  visibleGroupsOf,
} from '@/investment/strategies/definitions';
import { derivedValueFor, presetsFor } from '@/investment/strategies/presets';
import {
  CardChoiceField,
  ChipField,
  ChoiceField,
  DerivedReadout,
  SourceBadge,
  TextField,
  YesNoField,
  formatValue,
} from './controls';
import { intlLocaleFor } from './primitives';

export function DealBuilder({
  strategy,
  context,
  onSet,
  marketPresets,
}: {
  strategy: StrategyId;
  context: InvestmentContext;
  onSet: (field: string, value: number | string | null) => void;
  /**
   * Options observed in real listings, keyed by field. When present these
   * REPLACE the generic illustrations for that field — a market figure and
   * an example must never sit side by side looking alike.
   */
  marketPresets: Record<string, { value: number; labelKey: string }[]>;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const currency = (context.currency?.value as string) ?? 'USD';

  const valueOf = useMemo(
    () => (field: string) =>
      (context as Record<string, { value?: string | number } | undefined>)[field]?.value,
    [context],
  );

  const groups = useMemo(() => visibleGroupsOf(strategy, valueOf), [strategy, valueOf]);
  const next = useMemo(() => nextUnansweredField(strategy, valueOf), [strategy, valueOf]);

  /** The section holding the next question opens itself. */
  const activeGroupId = useMemo(() => {
    if (!next) return null;
    return groups.find((group) => group.fields.some((f) => f.field === next.field))?.id ?? null;
  }, [groups, next]);

  const [manuallyOpen, setManuallyOpen] = useState<Record<string, boolean>>({});
  const [showAdvanced, setShowAdvanced] = useState<Record<string, boolean>>({});

  const isOpen = (groupId: string) =>
    manuallyOpen[groupId] ?? (groupId === activeGroupId || activeGroupId === null);

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const open = isOpen(group.id);
        const answered = group.fields.filter((f) => valueOf(f.field) !== undefined);
        const complete = group.fields
          .filter((f) => f.required)
          .every((f) => valueOf(f.field) !== undefined);
        const isNext = group.id === activeGroupId;
        const advancedShown = showAdvanced[group.id] ?? false;
        const visibleFields = group.fields.filter((f) => !f.advanced || advancedShown);
        const hiddenAdvanced = group.fields.filter((f) => f.advanced).length;

        return (
          <section
            key={group.id}
            className={cn(
              'hm-invest-panel overflow-hidden',
              isNext && !open ? 'border-[hsl(var(--gold-border))]' : undefined,
            )}
          >
            <button
              type="button"
              onClick={() => setManuallyOpen((state) => ({ ...state, [group.id]: !open }))}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-start"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{t(group.titleKey)}</span>
                  {complete && answered.length > 0 ? (
                    <Check className="h-4 w-4 shrink-0 text-[hsl(var(--success))]" aria-hidden="true" />
                  ) : null}
                  {isNext ? (
                    <span className="rounded-full bg-[hsl(var(--gold-soft))] px-2 py-0.5 text-2xs font-medium text-[hsl(var(--gold-ink))]">
                      {t('inv_next_step')}
                    </span>
                  ) : null}
                </span>
                {!open && answered.length > 0 ? (
                  <span className="mt-1 block truncate text-2xs text-muted-foreground">
                    {summaryOf(group.fields, context, currency, locale, t)}
                  </span>
                ) : null}
                {!open && answered.length === 0 && group.descriptionKey ? (
                  <span className="mt-1 block truncate text-2xs text-muted-foreground">
                    {t(group.descriptionKey)}
                  </span>
                ) : null}
              </span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                  open && 'rotate-180',
                )}
                aria-hidden="true"
              />
            </button>

            {open ? (
              <div className="space-y-6 border-t border-border px-5 py-5">
                {group.descriptionKey ? (
                  <p className="-mt-1 text-sm text-muted-foreground">{t(group.descriptionKey)}</p>
                ) : null}

                {visibleFields.map((definition) => (
                  <FieldRow
                    key={definition.field}
                    definition={definition}
                    strategy={strategy}
                    context={context}
                    currency={currency}
                    onSet={onSet}
                    marketPresets={marketPresets[definition.field]}
                    highlight={next?.field === definition.field}
                  />
                ))}

                {hiddenAdvanced > 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setShowAdvanced((state) => ({ ...state, [group.id]: !advancedShown }))
                    }
                    className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Sliders className="h-3.5 w-3.5" aria-hidden="true" />
                    {advancedShown ? t('inv_hide_detail') : t('inv_more_detail')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/* ── One question ───────────────────────────────────────────────────── */

function FieldRow({
  definition,
  strategy,
  context,
  currency,
  onSet,
  marketPresets,
  highlight,
}: {
  definition: FieldDef;
  strategy: StrategyId;
  context: InvestmentContext;
  currency: string;
  onSet: (field: string, value: number | string | null) => void;
  marketPresets?: { value: number; labelKey: string }[];
  highlight: boolean;
}) {
  const { t } = useLanguage();
  const labelId = `inv-label-${definition.field}`;
  const entry = (context as Record<string, { value?: string | number; origin?: string } | undefined>)[
    definition.field
  ];
  const rawValue = entry?.value;

  /*
   * MARKET EVIDENCE REPLACES THE ILLUSTRATIONS, IT DOES NOT JOIN THEM.
   *
   * Showing "$650 (market) · $700 (example) · $780 (market)" in one row
   * makes the observed figures indistinguishable at a glance from the
   * invented ones. Where the evidence lane has found something for this
   * field, it is the whole set of options.
   */
  const presets = marketPresets?.length
    ? marketPresets.map((preset) => ({
        value: preset.value,
        labelKey: preset.labelKey,
        kind: 'MARKET' as const,
      }))
    : presetsFor(definition.field, context, strategy);

  const derived = derivedValueFor(definition.field, context);

  // Where the value follows from other answers and has not been overridden,
  // it is shown rather than asked for.
  if (derived && rawValue === undefined) {
    return (
      <DerivedReadout
        labelKey={definition.labelKey}
        value={derived.value}
        kind={definition.kind}
        currency={currency}
      />
    );
  }

  return (
    <div className={cn('rounded-xl', highlight && 'ring-1 ring-[hsl(var(--gold-border))] ring-offset-4 ring-offset-[hsl(var(--card))]')}>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span id={labelId} className="text-sm font-medium text-foreground">
          {t(definition.labelKey)}
        </span>
        {definition.required ? (
          <span className="text-2xs text-muted-foreground">{t('inv_required')}</span>
        ) : null}
        {rawValue !== undefined && entry?.origin === 'RESEARCH' ? (
          <SourceBadge source="MARKET" />
        ) : null}
      </div>

      {definition.hintKey ? (
        <p className="mb-2.5 max-w-[60ch] text-2xs leading-relaxed text-muted-foreground">
          {t(definition.hintKey)}
        </p>
      ) : null}

      {definition.control === 'cards' && definition.options ? (
        <CardChoiceField
          options={definition.options}
          value={rawValue as string | undefined}
          onChange={(value) => onSet(definition.field, value)}
        />
      ) : definition.control === 'choice' && definition.options ? (
        <ChoiceField
          options={definition.options}
          value={rawValue as string | undefined}
          onChange={(value) => onSet(definition.field, value)}
          labelledBy={labelId}
        />
      ) : definition.control === 'yesno' ? (
        <YesNoField
          value={rawValue as string | undefined}
          onChange={(value) => onSet(definition.field, value)}
          labelledBy={labelId}
        />
      ) : definition.control === 'text' ? (
        <TextField
          value={rawValue as string | undefined}
          onChange={(value) => onSet(definition.field, value)}
          labelledBy={labelId}
        />
      ) : (
        <ChipField
          presets={presets}
          value={rawValue as number | undefined}
          onChange={(value) => onSet(definition.field, value)}
          kind={definition.kind}
          currency={currency}
          labelledBy={labelId}
        />
      )}
    </div>
  );
}

/* ── The one-line summary a closed section shows ────────────────────── */

function summaryOf(
  fields: FieldDef[],
  context: InvestmentContext,
  currency: string,
  locale: string,
  t: (k: string, v?: Record<string, string | number>) => string,
): string {
  const parts: string[] = [];
  for (const definition of fields) {
    const entry = (context as Record<string, { value?: string | number } | undefined>)[
      definition.field
    ];
    const value = entry?.value;
    if (value === undefined || value === null || value === '') continue;
    if (definition.options) {
      const option = definition.options.find((o) => o.value === value);
      parts.push(option ? t(option.labelKey) : String(value));
      continue;
    }
    if (typeof value === 'number') {
      parts.push(formatValue(value, definition.kind, currency, locale, t));
      continue;
    }
    parts.push(String(value));
  }
  return parts.slice(0, 4).join(' · ');
}
