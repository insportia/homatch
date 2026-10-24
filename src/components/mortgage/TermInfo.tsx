// HOMATCH HOME FINANCING — "what does this word mean?", answered in place.
//
// A small (i) beside a label opens a card: the plain explanation first, a
// worked example on request (the person's own numbers when they have a
// scenario, a clearly labelled sample otherwise), and a way to ask HOMI
// for more. Nothing is forced before calculating; it is there when needed.

import React, { createContext, useContext, useState } from 'react';
import { Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatMoney, formatPercent, intlLocaleFor } from '@/components/workspace/primitives';
import { GLOSSARY_TERMS, TERM_FOR_LABEL, termBodyKey, termExample, termTitleKey, type ExampleScenario, type GlossaryTerm } from '@/mortgage/glossary';
import { useMortgageAsk } from './askConsultant';

const ScenarioContext = createContext<ExampleScenario | null>(null);

/** The page hands its current scenario down so examples can use the person's own numbers. */
export function GlossaryScenarioProvider({ scenario, children }: { scenario: ExampleScenario | null; children: React.ReactNode }) {
  return <ScenarioContext.Provider value={scenario}>{children}</ScenarioContext.Provider>;
}

export function TermInfo({ term, className, chip }: { term: GlossaryTerm; className?: string; /** Render as a named chip instead of an (i). */ chip?: boolean }) {
  const { t, lang } = useLanguage();
  const scenario = useContext(ScenarioContext);
  const { ask, available } = useMortgageAsk();
  const [open, setOpen] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const locale = intlLocaleFor(lang);
  const example = open ? termExample(term, scenario) : null;
  const currency = (scenario ?? null)?.currency ?? 'GEL';
  const vars = example
    ? Object.fromEntries(Object.entries(example.vars).map(([k, v]) => [k,
        v.kind === 'money' ? formatMoney(v.value, currency, locale) : v.kind === 'percent' ? formatPercent(v.value, locale, 2) : String(v.value)]))
    : {};

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setShowExample(false); }}>
      <PopoverTrigger asChild>
        {chip ? (
          <button type="button" data-term={term} className="min-h-11 rounded-full border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:border-[hsl(var(--gold-border))] aria-expanded:border-[hsl(var(--gold))]">
            {t(termTitleKey(term))}
          </button>
        ) : (
        <button
          type="button"
          aria-label={t('mortgage_term_info_aria', { term: t(termTitleKey(term)) })}
          data-term={term}
          className={cn('-m-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-2 text-muted-foreground transition-colors hover:text-[hsl(var(--gold-ink))] focus-visible:text-[hsl(var(--gold-ink))]', className)}
        >
          <Info className="h-4 w-4" aria-hidden="true" />
        </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] rounded-xl border-[hsl(var(--gold-border))] p-4 text-start">
        <p className="font-display text-base font-semibold text-foreground">{t(termTitleKey(term))}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{t(termBodyKey(term))}</p>
        {example ? (
          showExample ? (
            <div className="mt-3 rounded-lg bg-[hsl(var(--gold-soft))] px-3 py-2.5">
              <p className="text-2xs font-semibold uppercase tracking-wide text-[hsl(var(--gold-ink))]">
                {t(example.sample ? 'mortgage_term_example_sample' : 'mortgage_term_example_yours')}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-foreground">{t(example.key, vars)}</p>
            </div>
          ) : (
            <button type="button" onClick={() => setShowExample(true)} className="mt-2 min-h-11 text-sm font-medium text-[hsl(var(--gold-ink))] underline decoration-dotted underline-offset-4">
              {t('mortgage_term_show_example')}
            </button>
          )
        ) : null}
        {available ? (
          <button
            type="button"
            onClick={() => { ask(t('mortgage_term_ask_prompt', { term: t(termTitleKey(term)) })); setOpen(false); }}
            className="mt-2 flex min-h-11 items-center rounded-full border border-[hsl(var(--gold-border))] px-4 text-sm font-medium text-[hsl(var(--gold-ink))]"
          >
            {t('mortgage_term_ask_homi')}
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** The (i) for a label key, when that label is a term worth explaining. */
export function LabelTerm({ labelKey, className }: { labelKey: string; className?: string }) {
  const term = TERM_FOR_LABEL[labelKey];
  return term ? <TermInfo term={term} className={className} /> : null;
}

/** Every term in one place, for the person who wants to read before they calculate. */
export function GlossaryPanel() {
  const { t } = useLanguage();
  return (
    <section aria-labelledby="mortgage-glossary-title" className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">
      <h2 id="mortgage-glossary-title" className="font-display text-lg font-semibold text-foreground">{t('mortgage_glossary_title')}</h2>
      <p className="mt-1.5 max-w-[60ch] text-sm text-muted-foreground">{t('mortgage_glossary_sub')}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {GLOSSARY_TERMS.map((term) => <TermInfo key={term} term={term} chip />)}
      </div>
    </section>
  );
}
