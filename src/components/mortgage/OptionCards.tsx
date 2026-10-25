// HOMATCH HOME FINANCING — answers that look like answers.
//
// The questionnaire used a segmented control whose unselected options were
// grey words on grey, so people did not see that they could tap them. Each
// option is now a framed card with a round marker: empty when free, filled
// gold with a tick when chosen. It is a real radio group: one Tab stop,
// arrow keys move and choose, Space/Enter choose, a visible focus ring, and
// screen readers hear "radio button, 2 of 4, checked".
//
// Tapping the chosen card again clears it, as the old control did, so an
// accidental answer can always be taken back.

import React, { useRef } from 'react';
import { Check } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

export interface CardOption {
  value: string;
  labelKey: string;
  /** Optional second line under the label. */
  hintKey?: string;
}

export function OptionCards({
  options,
  value,
  onChange,
  labelledBy,
  columns,
}: {
  options: CardOption[];
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  labelledBy?: string;
  /** Two short answers (yes/no) sit side by side; longer lists stack on a phone. */
  columns?: 1 | 2;
}) {
  const { t } = useLanguage();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const focusIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const cols = columns ?? (options.length === 2 ? 2 : 1);

  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    refs.current[next]?.focus();
    onChange(options[next].value);
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(i, 1); break;
      case 'ArrowUp': e.preventDefault(); move(i, -1); break;
      case 'ArrowRight': e.preventDefault(); move(i, rtl ? -1 : 1); break;
      case 'ArrowLeft': e.preventDefault(); move(i, rtl ? 1 : -1); break;
      case 'Home': e.preventDefault(); move(0, 0); break;
      case 'End': e.preventDefault(); move(options.length - 1, 0); break;
      default: break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className={cn('grid gap-2.5', cols === 2 ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2')}
    >
      {options.map((option, i) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === focusIndex ? 0 : -1}
            onClick={() => onChange(checked ? null : option.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'group flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-start transition-[border-color,background-color,box-shadow] duration-150 motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              checked
                ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold-soft))] shadow-card'
                : 'border-border bg-card hover:border-[hsl(var(--gold-border))] hover:bg-[hsl(var(--secondary))]',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors motion-reduce:transition-none',
                checked ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold))] text-[#161309]' : 'border-muted-foreground/40 bg-background group-hover:border-[hsl(var(--gold-border))]',
              )}
            >
              {checked ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
            </span>
            <span className="min-w-0">
              <span className={cn('block text-[15px] leading-snug', checked ? 'font-semibold text-foreground' : 'font-medium text-foreground')}>
                {t(option.labelKey)}
              </span>
              {option.hintKey ? <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{t(option.hintKey)}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Yes / No as two cards. Values stay 'YES' / 'NO' so callers do not change. */
export function YesNoCards({ value, onChange, labelledBy }: {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  labelledBy?: string;
}) {
  return (
    <OptionCards
      options={[{ value: 'YES', labelKey: 'mortgage_opt_yes' }, { value: 'NO', labelKey: 'mortgage_opt_no' }]}
      value={value}
      onChange={onChange}
      labelledBy={labelledBy}
      columns={2}
    />
  );
}
