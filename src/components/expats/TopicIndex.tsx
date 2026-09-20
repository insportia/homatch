// HOMATCH FOR EXPATS — the knowledge, grouped by what somebody is doing.
//
// Not a category grid. §7 rules one out for the hero and the reasoning
// holds further down: a grid of twelve tiles labelled RESIDENCY, TAX,
// BANKING asks the reader to already know which of their problems is a
// tax problem. Grouping by DOMAIN with the topic titles visible means they
// read a question they recognise rather than a filing system.
//
// Topics with nothing published under them do not appear. An empty
// "HEALTHCARE" heading is a promise the product has not kept, and a
// heading with one item under it is honest.

import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { localiseTopic, type ExpatTopic } from '@/services/expats';
import { judgeFreshness } from '@/expats/types';

/** Domains in the order somebody actually meets them, not alphabetically. */
const DOMAIN_ORDER = [
  'RESIDENCY',
  'LEGAL',
  'BANKING',
  'COST_OF_LIVING',
  'HEALTHCARE',
  'PROPERTY',
  'TAX',
  'FAMILY',
  'TRANSPORT',
  'BUSINESS',
  'DAILY_LIFE',
];

export function TopicIndex({ topics }: { topics: readonly ExpatTopic[] }) {
  const { t, lang } = useLanguage();

  const grouped = React.useMemo(() => {
    const map = new Map<string, ExpatTopic[]>();
    for (const topic of topics) {
      const list = map.get(topic.domain) ?? [];
      list.push(topic);
      map.set(topic.domain, list);
    }
    return [...map.entries()].sort(
      (a, b) =>
        (DOMAIN_ORDER.indexOf(a[0]) + 1 || 99) - (DOMAIN_ORDER.indexOf(b[0]) + 1 || 99),
    );
  }, [topics]);

  if (grouped.length === 0) return null;

  return (
    <section data-expat-topic-index>
      <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold-ink))]">
        {t('expat_topics_eyebrow')}
      </p>
      <h2 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
        {t('expat_topics_title')}
      </h2>

      <div className="mt-6 space-y-8">
        {grouped.map(([domain, list]) => (
          <div key={domain}>
            <h3 className="mb-3 text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t(`expat_domain_${domain.toLowerCase()}`)}
            </h3>
            <ul className="overflow-hidden rounded-xl border border-border">
              {list.map((topic, i) => {
                const localised = localiseTopic(topic, lang);
                if (!localised) return null;
                const freshness = judgeFreshness(topic.lastVerifiedAt, topic.factClass);
                return (
                  <li key={topic.id} className={i > 0 ? 'border-t border-border' : ''}>
                    <Link
                      to={`/for-expats/georgia/${topic.slug}`}
                      data-expat-topic-link={topic.slug}
                      className="group flex items-start gap-4 px-5 py-4 transition-colors hover:bg-accent"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {localised.content.title}
                          </span>
                          {topic.needsReview ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--warning))] px-2 py-0.5 text-2xs text-[hsl(var(--warning))]">
                              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                              {t('expat_topic_under_review')}
                            </span>
                          ) : null}
                          {freshness === 'STALE' ? (
                            <span className="rounded-full border border-border px-2 py-0.5 text-2xs text-muted-foreground">
                              {t('expat_freshness_stale')}
                            </span>
                          ) : null}
                          {localised.isFallback ? (
                            <span className="rounded-full border border-border px-2 py-0.5 text-2xs text-muted-foreground">
                              {t('expat_topic_in_english')}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block text-2xs leading-relaxed text-muted-foreground">
                          {localised.content.summary}
                        </span>
                      </span>
                      <ArrowRight
                        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
