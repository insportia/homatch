// MY GEORGIA BY HOMI — the Georgia living guide, as twelve categories.
//
// One component for everyone: on the public For Expats page it is the general
// guide; on My Georgia the same categories come ordered by what the person
// said they need. A category shows only topics that exist and are published,
// each with its last-reviewed date and a "needs checking" mark when a source
// is due for review, so no card leads to an empty page.

import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { formatExpatDate } from '@/expats/display';
import { GUIDE_CATEGORIES, type GuideCategoryKey } from '@/myGeorgia/answers';
import { localiseTopic, type ExpatTopic } from '@/services/expats';

export function GuideHub({
  topics,
  categories,
  only,
  compact = false,
}: {
  topics: readonly ExpatTopic[];
  /** The order to show categories in (personalised on My Georgia). */
  categories?: readonly (typeof GUIDE_CATEGORIES)[number][];
  /** Limit to these categories (a dashboard section). */
  only?: readonly GuideCategoryKey[];
  compact?: boolean;
}) {
  const { t, lang } = useLanguage();
  const bySlug = React.useMemo(() => new Map(topics.map((tp) => [tp.slug, tp])), [topics]);
  const list = (categories ?? GUIDE_CATEGORIES).filter((c) => !only || only.includes(c.key));
  const seen = new Set<string>();

  const cards = list
    .map((c) => {
      const items = c.topics
        .map((slug) => bySlug.get(slug))
        .filter((tp): tp is ExpatTopic => Boolean(tp))
        .filter((tp) => (seen.has(`${c.key}:${tp.slug}`) ? false : (seen.add(`${c.key}:${tp.slug}`), true)));
      return { c, items };
    })
    .filter((x) => x.items.length > 0);

  if (cards.length === 0) return null;

  return (
    <div className={cn('grid gap-4', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3')} data-guide-hub>
      {cards.map(({ c, items }) => (
        <section key={c.key} data-guide-category={c.key} className="rounded-2xl border border-border bg-card p-5">
          <h3 className="font-display text-lg font-semibold text-foreground">{t(`mg_cat_${c.key.toLowerCase()}`)}</h3>
          <ul className="mt-3 space-y-2">
            {items.map((tp) => {
              const local = localiseTopic(tp, lang);
              if (!local) return null;
              return (
                <li key={tp.slug}>
                  <Link
                    to={`/for-expats/georgia/${tp.slug}`}
                    data-expat-topic-link={tp.slug}
                    className="group flex min-h-11 items-start justify-between gap-3 rounded-xl px-2 py-2 hover:bg-accent"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">{local.content.title}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {tp.needsReview
                          ? t('mg_status_review')
                          : tp.lastVerifiedAt
                            ? t('mg_reviewed', { date: formatExpatDate(tp.lastVerifiedAt, lang) })
                            : null}
                      </span>
                    </span>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default GuideHub;
