// HOMATCH HOME FINANCING — "what does this word mean?", answered in place.
//
// A small (i) beside a label opens a card: the plain explanation first, a
// worked example on request (the person's own numbers when they have a
// scenario, a clearly labelled sample otherwise), and a way to ask HOMI
// for more. Nothing is forced before calculating; it is there when needed.

import React, { createContext, useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatMoney, formatPercent, intlLocaleFor } from '@/components/workspace/primitives';
import { TERM_FOR_LABEL, termBodyKey, termExample, termTitleKey, type ExampleScenario, type GlossaryTerm } from '@/mortgage/glossary';
import { TERMS_INDEX_PATH, TERM_PAGES, pageTitleKey, termPath } from '@/mortgage/termPages';
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
          className={cn('-m-3 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full p-3 text-muted-foreground transition-colors hover:text-[hsl(var(--gold-ink))] focus-visible:text-[hsl(var(--gold-ink))]', className)}
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
              <p className="text-xs font-semibold text-[hsl(var(--gold-ink))]">
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
        <Link
          to={termPath(term)}
          onClick={() => setOpen(false)}
          className="mt-2 flex min-h-11 items-center justify-between gap-2 rounded-xl bg-[#0C1119] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#161d29]"
        >
          {t('mortgage_tp_open')}
          <ArrowRight className="h-4 w-4 shrink-0 text-[hsl(38_92%_60%)] rtl:rotate-180" aria-hidden="true" />
        </Link>
      </PopoverContent>
    </Popover>
  );
}

/** The (i) for a label key, when that label is a term worth explaining. */
export function LabelTerm({ labelKey, className }: { labelKey: string; className?: string }) {
  const term = TERM_FOR_LABEL[labelKey];
  return term ? <TermInfo term={term} className={className} /> : null;
}

/** The most asked words first; the full list is one tap away. */
const FEATURED = ['EFFECTIVE_RATE', 'NOMINAL_RATE', 'PTI', 'LTV', 'DOWN_PAYMENT', 'ANNUITY', 'EARLY_REPAYMENT', 'CURRENCY_RISK'] as const;

/**
 * Every term in one place, for the person who wants to read before they
 * calculate. Each chip is a link to the term's own page, not a tooltip: the
 * short popover text was the "tiny almost zero information snippet" people
 * complained about, so the glossary now leads to the full explanation.
 */
export function GlossaryPanel() {
  const { t } = useLanguage();
  return (
    <section aria-labelledby="mortgage-glossary-title" className="relative overflow-hidden rounded-3xl bg-[#0C1119] p-5 text-white shadow-hover sm:p-8">
      <div aria-hidden="true" className="pointer-events-none absolute -end-20 -top-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,hsl(38_92%_56%/0.2),transparent_65%)]" />
      <div className="relative">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[hsl(38_92%_56%/0.35)] bg-[hsl(38_92%_56%/0.12)] text-[hsl(38_92%_60%)]">
            <BookOpen className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="mortgage-glossary-title" className="font-display text-xl font-semibold text-white sm:text-2xl">{t('mortgage_glossary_title')}</h2>
            <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-white/75 sm:text-base">{t('mortgage_tp_glossary_card_body')}</p>
          </div>
        </div>
        <ul className="mt-5 flex flex-wrap gap-2">
          {FEATURED.map((term) => (
            <li key={term}>
              <Link to={termPath(term)} className="inline-flex min-h-11 items-center rounded-full border border-white/15 bg-white/[0.06] px-4 text-sm font-medium text-white transition-colors hover:border-[hsl(38_92%_56%)] hover:bg-white/[0.1]">
                {t(pageTitleKey(term))}
              </Link>
            </li>
          ))}
        </ul>
        <Link to={TERMS_INDEX_PATH} className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-full bg-[hsl(38_92%_56%)] px-6 text-base font-bold text-[#161309] transition-colors hover:bg-[hsl(38_92%_62%)]">
          {t('mortgage_tp_glossary_cta')}
          <span className="text-sm font-semibold opacity-75">· {t('mortgage_tp_index_count', { n: TERM_PAGES.length })}</span>
          <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
