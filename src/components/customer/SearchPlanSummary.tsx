// WHAT HOMATCH UNDERSTOOD, SHOWN BACK.
//
// This is the moment the product is for. Somebody writes a sentence in their own language
// and the system says, in words they can check, what it took that to mean — before it
// spends anything and before it searches anywhere.
//
// WHAT THIS REPLACES. The plan stage was a stack of cards holding a Select, three Inputs
// and a second Select, each with a label above it. A form. It is possible to read your own
// plan off a form, but nobody does: a form asks you to supply something, and the whole
// point here is that HOMATCH already did.
//
// So the plan reads as a STATEMENT by default and the form is one control away. Refine
// opens the same editor, with the same fields, writing to the same state — nothing about
// correcting a plan changed except that you are no longer made to look at the machinery
// to find out what was heard.
//
// THREE THINGS IT REFUSES TO DO
//
//   Invent a value. Every row renders only when the plan actually carries it, and an
//   absent city renders nothing rather than "Any city" — which is a claim about the search
//   that nobody made.
//
//   Flatten REQUIRED and PREFERRED. "Must be in Vake" and "ideally Vake" are different
//   searches and the matcher honours the difference; a summary that showed them the same
//   way would be hiding the one distinction this step exists to expose. UNKNOWN is shown
//   as nothing at all, because it is a confidence effect rather than a promise.
//
//   Say anything about what a search will cost or find. That belongs to the action, and
//   the action is the customer's.

import { Check } from 'lucide-react';
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

/** One line of the plan: what it was, what was heard, and how firmly. */
export interface PlanRowData {
  label: string;
  value: string;
  /** REQUIRED / PREFERRED / FLEXIBLE. Null where the field carries no promise. */
  strength?: string | null;
}

export function PlanRow({ label, value, strength }: PlanRowData) {
  const { t } = useLanguage();
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-2xs text-muted-foreground">{label}</dt>
      {/*
        ONE TEXT FLOW, NOT TWO FLEX ITEMS.
        As a flex row the value wrapped inside its own box while the strength word stayed
        on the first line — at 320px "Vake · Saburtalo" came out as "Vake ·  preferred"
        above "Saburtalo", which reads as the tag belonging to the first district. Inline
        they wrap as one paragraph and the tag stays where it was put: after the value.
      */}
      <dd className="min-w-0 text-end">
        <span
          /*
            dir="auto", NOT dir="ltr".
            A value here can be a bare amount or a whole phrase — "up to $150,000" is
            "עד $150,000" in Hebrew — and forcing the phrase left-to-right put the Hebrew
            preposition on the wrong side of the money with its space swallowed. The
            amounts arrive wrapped in bidi isolates, so auto detects the PHRASE direction
            and each amount keeps its own inside it.
          */
          dir="auto"
          className="break-words text-2xs font-semibold text-foreground"
        >
          {value}
        </span>
        {strength ? (
          /*
            THE DISTINCTION THE MATCHER ACTUALLY HONOURS, and the reason this step exists.
            A required constraint disqualifies; a preferred one costs ranking. Shown as a
            word rather than a colour, because a colour needs a legend.
          */
          <span
            className={cn(
              /* Whole word or next line. At 320px “აუცილებელი” was breaking across two
                 lines mid-word, which reads as a rendering fault rather than as a tag. */
              'ms-2 whitespace-nowrap text-2xs',
              strength === 'REQUIRED'
                ? 'font-semibold text-[hsl(var(--gold-ink))]'
                : 'text-muted-foreground',
            )}
          >
            {/* plan_firmness_*, not plan_strength_*: the picker's words answer the
                question "how firmly?" and several of them are whole clauses. A tag at
                the end of a value is an adjective. */}
            {t(`plan_firmness_${strength.toLowerCase()}` as never)}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

/**
 * The plan, as a statement.
 *
 * `rows` is built by the page from the real plan object — this component decides how a
 * plan LOOKS and never what is in one, so a planner that starts returning a new field
 * does not need this file to change.
 */
export function SearchPlanSummary({
  title,
  rows,
  languages,
  languagesLabel,
  actions,
  note,
  footnote,
}: {
  title: string;
  rows: readonly PlanRowData[];
  /** The languages the search will actually read in. The ceiling, not a suggestion. */
  languages: readonly string[];
  languagesLabel: string;
  actions: React.ReactNode;
  /** A real caveat, where there is one. Never filler. */
  note?: React.ReactNode;
  /** One line about the action, under the action. What it costs, typically. */
  footnote?: React.ReactNode;
}) {
  return (
    /* The gold hairline is the one place this page uses the accent structurally: this
       module is the answer to the question the customer just asked. */
    <section className="hm-discovery-panel hm-discovery-focus overflow-hidden">
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))] ring-1 ring-inset ring-[hsl(var(--gold-border))]"
          aria-hidden="true"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
        </span>
        <h2 className="min-w-0 break-words font-display text-sm font-semibold tracking-[-0.01em] text-foreground">
          {title}
        </h2>
      </header>

      <dl className="divide-y divide-border/70 px-4">
        {rows.map((row) => (
          <PlanRow key={row.label} {...row} />
        ))}
      </dl>

      {languages.length > 0 && (
        /*
          THE SEARCH LANGUAGES, AND THEY ARE A CEILING.
          UI language, campaign search language and a source's own language are three
          different things. What is listed here is what the search will read in — nothing
          outside it — so it is stated rather than implied.
        */
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t border-border px-4 py-3">
          <span className="text-2xs text-muted-foreground">{languagesLabel}</span>
          <span className="flex flex-wrap gap-1">
            {languages.map((code) => (
              <span
                key={code}
                dir="ltr"
                className="rounded border border-border bg-[hsl(var(--secondary))] px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-[0.06em] text-foreground"
              >
                {code}
              </span>
            ))}
          </span>
        </div>
      )}

      {note ? <div className="border-t border-border px-4 py-3">{note}</div> : null}

      <div className="border-t border-border bg-[hsl(var(--secondary))]/35 px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
        {/* Under the button it describes. A sentence about what a search costs, two
            blocks away from the control that starts one, is a sentence nobody reads. */}
        {footnote ? (
          <p className="mt-2.5 break-words text-2xs text-muted-foreground">{footnote}</p>
        ) : null}
      </div>
    </section>
  );
}
