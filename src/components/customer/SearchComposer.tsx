// THE THING YOU TALK TO, NOT A FIELD YOU FILL IN.
//
// WHAT THIS REPLACES was, in its own markup: a page title, a description, a white Card,
// a <label>, a <textarea> with a border, a helper line and a Button. That is a settings
// form. It does not matter how good the placeholder copy is — a labelled input inside a
// bordered card on a grey page reads as data entry, and the one thing this product must
// not feel like at its front door is data entry.
//
// WHAT MAKES THIS DIFFERENT IS NOT DECORATION:
//
//   THE SURFACE IS THE CONTROL. There is no card around a field; the panel IS the field,
//   and the whole thing lights up at the gold hairline when it has focus — the same
//   `hm-product-focus` treatment the approved workspace uses for "this is the module
//   you are working in". A border around a border is what made the old one read as a
//   form within a form.
//
//   THE SUBMIT IS INSIDE. A separate button below a field is a form's grammar. A send
//   affordance sitting in the composer's own corner is a composer's.
//
//   THE DISABLED STATE EXPLAINS ITSELF, in place, rather than being a grey rectangle with
//   nothing next to it.
//
//   SUGGESTIONS ARE LIGHT. Four complete requests as quiet chips that FILL the composer.
//   They never start a paid search: the customer still reads what was written and presses
//   send, because a tap that spends money on a suggestion nobody re-read is a trap.
//
// No Card, no Badge, no Button from shadcn — see the root-cause note in surface.tsx.

import { ArrowUp, Loader2, Sparkles } from 'lucide-react';
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

export function HomatchSearchComposer({
  value,
  onChange,
  onSubmit,
  busy,
  placeholder,
  hint,
  readyHint,
  submitLabel,
  suggestions,
  suggestionsLabel,
  composerRef,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  busy?: boolean;
  placeholder: string;
  /** Shown while the composer is empty: what would make it work. */
  hint: string;
  /** Shown once there is something to send: what happens next. */
  readyHint: string;
  submitLabel: string;
  suggestions: ReadonlyArray<{ key: string; text: string }>;
  suggestionsLabel: string;
  /* Nullable, because useRef<T | null>(null) is what a ref to a DOM node actually is
     before it mounts — and the page already declares it that way. */
  composerRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useLanguage();
  const ready = value.trim().length > 0 && !busy;

  return (
    <div className="space-y-3">
      {/*
        THE COMPOSER IS THE PANEL. focus-within lifts the gold hairline, which is the
        workspace's own "you are here" signal rather than a new interaction colour.
      */}
      <div
        className={cn(
          'hm-discovery-panel relative p-3 transition-shadow',
          'focus-within:border-border',
          'focus-within:shadow-[inset_0_1px_0_0_hsl(var(--ring)/0.30)]',
        )}
      >
        <div className="flex items-start gap-2.5">
          <Sparkles
            className="mt-1 h-4 w-4 shrink-0 text-foreground"
            aria-hidden="true"
          />
          {/*
            A BARE TEXTAREA. No border, no ring, no background of its own — the panel
            already is all three, and nesting a second bordered box inside it is exactly
            what made the old composer look like a form control sitting in a card.
          */}
          <textarea
            id="find-property-composer"
            ref={composerRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={3}
            onKeyDown={(event) => {
              /* Enter sends; Shift+Enter is a new line. The composer's grammar, and the
                 reason it has a send affordance rather than a submit button. */
              if (event.key === 'Enter' && !event.shiftKey && ready) {
                event.preventDefault();
                onSubmit();
              }
            }}
            className="min-h-[4.5rem] w-full resize-none border-0 bg-transparent p-0 text-sm leading-relaxed text-foreground outline-none ring-0 placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0"
            placeholder={placeholder}
          />
        </div>

        <div className="mt-2 flex items-end justify-between gap-3 border-t border-border/50 pt-2">
          <p className="min-w-0 text-2xs leading-snug text-muted-foreground/75">
            {ready ? readyHint : hint}
          </p>
          {/*
            THE SEND AFFORDANCE, in the composer's corner. Round, gold, 32px — the size
            of a send control, not of a form's submit button.
          */}
          <button
            type="button"
            onClick={onSubmit}
            disabled={!ready}
            aria-label={submitLabel}
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
              ready
                ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))]/90'
                : 'bg-[hsl(var(--secondary))] text-muted-foreground/50',
            )}
          >
            {busy
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <ArrowUp className="h-4 w-4 rtl:rotate-0" />}
          </button>
        </div>
      </div>

      {/* ── SOMETHING TO START FROM ─────────────────────────────────────
        Quiet chips, not marketing cards. They fill the composer and stop; the customer
        reads what was written and presses send themselves, because a tap that starts a
        paid search on text nobody re-read is a trap. */}
      <div className="space-y-1.5">
        <p className="text-2xs font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
          {suggestionsLabel}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.key}
              type="button"
              onClick={() => {
                onChange(suggestion.text);
                composerRef?.current?.focus();
              }}
              className="max-w-full rounded-full border border-border px-3 py-1.5 text-start text-2xs text-muted-foreground transition-colors hover:border-[hsl(var(--ring))]/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            >
              <span className="line-clamp-1">{suggestion.text}</span>
            </button>
          ))}
        </div>
      </div>

      <span className="sr-only">{t('plan_composer_label')}</span>
    </div>
  );
}

/**
 * The three steps, as one quiet line each.
 *
 * WHAT THIS REPLACES was three bordered cards in a grid, each with a numbered circle, an
 * icon, a title and a body — roughly 190px of explanation under a composer that had not
 * been used yet. The information is worth keeping; the packaging was three more cards on
 * a page whose problem was that everything was a card.
 */
export function HowItWorks({
  steps,
}: {
  steps: ReadonlyArray<{ key: string; title: string; body: string }>;
}) {
  return (
    <ol className="space-y-2.5">
      {steps.map((step, index) => (
        <li key={step.key} className="flex gap-2.5">
          <span
            aria-hidden="true"
            className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--secondary))] text-2xs font-semibold text-foreground"
          >
            {index + 1}
          </span>
          <p className="min-w-0 text-2xs leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">{step.title}</span>
            {' — '}
            {step.body}
          </p>
        </li>
      ))}
    </ol>
  );
}
