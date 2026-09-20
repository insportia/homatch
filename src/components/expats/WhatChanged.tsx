// HOMATCH FOR EXPATS — what changed, and whether it changes anything for you.
//
// Not a news feed. §46 is explicit, and the difference is not editorial
// taste: a news feed reports what happened, and this reports what a reader
// may now have to DO. Every entry names the rule or fee that moved, cites
// the thing that moved it — the database refuses an unsourced published
// update — and, for somebody with a plan, says how many of their tasks it
// touches.
//
// WHY IT RENDERS NOTHING WHEN THERE IS NOTHING
//
// An empty "recent changes" panel with a cheerful "you're all caught up"
// is furniture. If no rule has changed, the page is shorter.

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ExpatUpdate } from '@/services/expats';

const CHANGE_KEY: Record<string, string> = {
  RULE_CHANGED: 'expat_change_rule',
  FEE_CHANGED: 'expat_change_fee',
  PROCESS_CHANGED: 'expat_change_process',
  DEADLINE_CHANGED: 'expat_change_deadline',
  NEW_REQUIREMENT: 'expat_change_new',
  SOURCE_UNAVAILABLE: 'expat_change_source_gone',
  OTHER: 'expat_change_other',
};

export function WhatChanged({
  updates,
  /** Template keys in the reader's plan, so relevance is a fact not a guess. */
  planTemplateKeys,
}: {
  updates: readonly ExpatUpdate[];
  planTemplateKeys?: readonly string[];
}) {
  const { t, lang } = useLanguage();
  if (updates.length === 0) return null;

  return (
    <section data-expat-what-changed>
      <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold-ink))]">
        {t('expat_changed_eyebrow')}
      </p>
      <h2 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
        {t('expat_changed_title')}
      </h2>

      <ul className="mt-6 space-y-3">
        {updates.map((u) => {
          const body = u.content[lang] ?? u.content.en;
          if (!body) return null;
          const affected = planTemplateKeys
            ? u.affectsTemplateKeys.filter((k) => planTemplateKeys.includes(k)).length
            : 0;

          return (
            <li
              key={u.id}
              data-expat-update={u.id}
              className="rounded-xl border border-border p-5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[hsl(var(--gold-border))] px-2.5 py-0.5 text-2xs text-[hsl(var(--gold-ink))]">
                  {t(CHANGE_KEY[u.changeType] ?? CHANGE_KEY.OTHER)}
                </span>
                <span className="text-2xs uppercase tracking-[0.1em] text-muted-foreground">
                  {t(`expat_domain_${u.domain.toLowerCase()}`)}
                </span>
                {u.effectiveFrom ? (
                  <span className="text-2xs text-muted-foreground">
                    {t('expat_changed_effective', { date: u.effectiveFrom })}
                  </span>
                ) : null}
              </div>

              <h3 className="mt-2 text-sm font-medium text-foreground">{body.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body.body}</p>

              {affected > 0 ? (
                <p className="mt-3 rounded-lg border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]/40 px-3 py-2 text-2xs text-[hsl(var(--gold-ink))]">
                  {t('expat_changed_affects_plan', { n: affected })}
                </p>
              ) : null}

              {u.source ? (
                <p className="mt-3 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                  <span>{u.source.publisher}</span>
                  {u.source.url ? (
                    <a
                      href={u.source.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-center gap-1 text-[hsl(var(--gold-ink))] underline underline-offset-2"
                    >
                      {t('expat_evidence_open_source')}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : null}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
