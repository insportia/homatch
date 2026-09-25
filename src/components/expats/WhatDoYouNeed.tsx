// HOMATCH FOR EXPATS — the front door.
//
// Somebody who wants to buy a flat used to land on a hero, four pathway
// anchors and a list of six topics, and had to work out for themselves that
// Verify is the thing that checks an owner and that Find a property is where
// a search begins. This asks the only question they can certainly answer —
// what do you need to do? — and then shows the steps and the tool for each.
//
// PROGRESSIVE DISCLOSURE, IN THE LITERAL SENSE
//
// Eight choices, one line each. Nothing else is on screen until one is
// chosen; the steps replace the chooser rather than appearing under it, so
// there is never a wall. Each step is a heading, two sentences, and at most
// one action, which is what an elderly or hurried reader can act on.
//
// WHAT IT WILL NOT DO
//
// It states no law, tax, rate or fee. Those change, and they live in the
// topic system with a source and a verified date. Where a step has a topic,
// this links to it and shows when it was last verified; where production has
// no topic for that domain, it says so rather than inventing one.

import { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { EXPAT_NEEDS, stepsFor, type ExpatNeed } from '@/expats/needs';
import type { ExpatTopic } from '@/services/expats';

export function WhatDoYouNeed({ topics }: { topics: ExpatTopic[] }) {
  const { t } = useLanguage();
  const [chosen, setChosen] = useState<ExpatNeed | null>(null);

  /** The topic that carries the facts for a domain, when production has one. */
  const topicFor = (domain?: string) =>
    (domain ? topics.find((topic) => topic.domain === domain) : undefined);

  return (
    <section data-expat-needs className="scroll-mt-24">
      <h2 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
        {chosen ? t('expat_needs_steps_title') : t('expat_needs_title')}
      </h2>
      <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
        {chosen ? t(chosen.hintKey) : t('expat_needs_body')}
      </p>

      {chosen === null ? (
        /*
         * One column on a phone. Two is the most that fits a Georgian or
         * Turkish label without breaking a word across lines, which is the
         * failure that made the old cards unreadable at 360px.
         */
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {EXPAT_NEEDS.map(need => (
            <button
              key={need.key}
              type="button"
              data-expat-need={need.key}
              onClick={() => setChosen(need)}
              className="group flex min-h-[4.5rem] w-full items-center gap-4 rounded-2xl border border-border p-4 text-start transition-colors hover:border-[hsl(var(--gold))] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-foreground">
                  {t(need.labelKey)}
                </span>
                <span className="mt-1 block text-2xs leading-relaxed text-muted-foreground">
                  {t(need.hintKey)}
                </span>
              </span>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1"
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-6">
          <ol className="space-y-3">
            {stepsFor(chosen).map((step, index, all) => {
              const topic = topicFor(step.domain);
              return (
                <li
                  key={step.key}
                  data-expat-step={step.key}
                  className="rounded-2xl border border-border p-4 sm:p-5"
                >
                  <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('expat_needs_step_of', { n: index + 1, total: all.length })}
                  </p>
                  <h3 className="mt-1 text-[17px] font-semibold text-foreground">
                    {t(step.titleKey)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {t(step.bodyKey)}
                  </p>

                  {/* At most one action, and only where the tool is real. */}
                  {step.tool && (
                    <Link
                      to={step.tool.to}
                      data-expat-step-tool={step.key}
                      className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90"
                    >
                      {t(step.tool.labelKey)}
                      <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                    </Link>
                  )}

                  {/*
                    * The facts, with their provenance — or an honest absence.
                    * A guide that does not exist is never implied to.
                    */}
                  {step.domain && (
                    topic ? (
                      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
                        <Check className="h-3.5 w-3.5 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
                        <Link
                          to={`/for-expats/georgia/${topic.slug}`}
                          className="underline underline-offset-2 hover:text-foreground"
                        >
                          {t('expat_needs_read')}
                        </Link>
                      </p>
                    ) : (
                      <p className="mt-3 text-2xs text-muted-foreground">
                        {t('expat_needs_no_topic')}
                      </p>
                    )
                  )}
                </li>
              );
            })}
          </ol>

          <button
            type="button"
            data-expat-needs-reset
            onClick={() => setChosen(null)}
            className="mt-5 inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm text-foreground transition-colors hover:bg-accent"
          >
            {t('expat_needs_change')}
          </button>
        </div>
      )}
    </section>
  );
}

export default WhatDoYouNeed;
