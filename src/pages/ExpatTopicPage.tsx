// HOMATCH FOR EXPATS — one topic, read properly.
//
// §13 lists sixteen possible sections and then says: do not render empty
// ones. The way to obey that is not to check each for emptiness at render
// time — it is to let the CONTENT decide which sections exist. A topic
// carries the sections it has and this page renders them in the order the
// editor put them in. There is no template with holes.
//
// WHY THE SOURCED FACTS SIT ABOVE THE PROSE
//
// The fee, the deadline and the rule are what somebody came for. The
// explanation around them is what makes the numbers usable, and it is
// longer. Putting the facts first means the reader who already understands
// the process gets their number in one screen, and the reader who does not
// scrolls on.
//
// WHY A FALLBACK TO ENGLISH IS ANNOUNCED
//
// A Georgian reader who opens a topic that exists only in English should
// be told that is what happened, not left wondering whether the interface
// broke. One line, at the top, and then the English.

import React from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import PageMeta from '@/components/common/PageMeta';
import { useLanguage } from '@/contexts/LanguageContext';
import { ExpatSeo, ExpatBreadcrumbs, type Crumb } from '@/components/expats/ExpatSeo';
import { SourcedFact } from '@/components/expats/Provenance';
import { judgeFreshness } from '@/expats/types';
import {
  getTopic,
  getTopicFacts,
  localiseTopic,
  type ExpatTopic,
  type TopicFact,
} from '@/services/expats';

/** The handoffs a topic can carry, by the domain it belongs to. */
const DOMAIN_HANDOFF: Record<string, { to: string; key: string }[]> = {
  PROPERTY: [
    { to: '/verify', key: 'verify' },
    { to: '/investment', key: 'investment' },
    { to: '/mortgage', key: 'mortgage' },
    { to: '/contracts', key: 'contracts' },
  ],
  COST_OF_LIVING: [{ to: '/mortgage', key: 'mortgage' }],
  BANKING: [{ to: '/mortgage', key: 'mortgage' }],
};

export default function ExpatTopicPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t, lang } = useLanguage();

  const [topic, setTopic] = React.useState<ExpatTopic | null>(null);
  const [facts, setFacts] = React.useState<TopicFact[]>([]);
  const [state, setState] = React.useState<'LOADING' | 'READY' | 'MISSING'>('LOADING');

  React.useEffect(() => {
    if (!slug) return;
    let live = true;
    void (async () => {
      const found = await getTopic(slug);
      if (!live) return;
      if (!found) {
        setState('MISSING');
        return;
      }
      setTopic(found);
      setState('READY');
      const f = await getTopicFacts(found.id);
      if (live) setFacts(f);
    })();
    return () => {
      live = false;
    };
  }, [slug]);

  if (!slug) return <Navigate to="/for-expats/georgia" replace />;

  if (state === 'LOADING') {
    return (
      <div className="mx-auto w-full max-w-[52rem] px-5 py-16">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-6 h-10 w-3/4 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-24 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (state === 'MISSING' || !topic) {
    return (
      <div className="mx-auto w-full max-w-[52rem] px-5 py-20">
        <h1 className="font-display text-2xl font-semibold text-foreground">
          {t('expat_topic_missing_title')}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">{t('expat_topic_missing_body')}</p>
        <Link
          to="/for-expats/georgia"
          className="mt-6 inline-flex items-center gap-2 text-sm text-[hsl(var(--gold-ink))] underline underline-offset-2"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          {t('expat_topic_back')}
        </Link>
      </div>
    );
  }

  const localised = localiseTopic(topic, lang);
  if (!localised) return <Navigate to="/for-expats/georgia" replace />;

  const { content, isFallback } = localised;
  const path = `/for-expats/georgia/${topic.slug}`;
  const crumbs: Crumb[] = [
    { name: t('expat_crumb_home'), path: '/for-expats/georgia' },
    { name: t(`expat_domain_${topic.domain.toLowerCase()}`), path: '/for-expats/georgia' },
    { name: content.title, path },
  ];
  const freshness = judgeFreshness(topic.lastVerifiedAt, topic.factClass);
  const handoffs = DOMAIN_HANDOFF[topic.domain] ?? [];

  return (
    <>
      <PageMeta title={`${content.title} — Homatch`} description={content.summary} />
      <ExpatSeo
        path={path}
        crumbs={crumbs}
        article={{
          headline: content.title,
          description: content.summary,
          modified: topic.lastVerifiedAt,
        }}
      />

      <article className="mx-auto w-full max-w-[52rem] px-5 py-12 sm:py-16">
        <ExpatBreadcrumbs crumbs={crumbs} />

        {isFallback ? (
          <p
            data-expat-language-fallback
            className="mb-6 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-2xs text-muted-foreground"
          >
            {t('expat_topic_english_only')}
          </p>
        ) : null}

        <header>
          <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--gold-ink))]">
            {t(`expat_domain_${topic.domain.toLowerCase()}`)}
          </p>
          {/* text-2xl on a phone, not text-3xl. A topic title is words a
              translator chose, and some languages compound: at 320px and
              30px, Russian "Здравоохранение" needs 285px of a 280px
              column and the browser has to break inside it. At 24px it
              fits with room to spare, and the heading still reads as the
              largest thing on the page. Shrinking the type is the fix
              here rather than permitting a mid-word break, because a
              title that breaks across a hyphenless boundary is the defect
              the reader actually notices. */}
          <h1 className="font-display text-2xl font-semibold leading-tight text-foreground sm:text-4xl">
            {content.title}
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">{content.summary}</p>

          <p className="mt-4 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
            {topic.lastVerifiedAt ? (
              <span>
                {t('expat_topic_last_verified', { date: topic.lastVerifiedAt.slice(0, 10) })}
              </span>
            ) : null}
            {freshness === 'STALE' ? (
              <span className="rounded-full border border-[hsl(var(--warning))] px-2 py-0.5 text-[hsl(var(--warning))]">
                {t('expat_topic_due_recheck')}
              </span>
            ) : null}
          </p>
        </header>

        {topic.needsReview && topic.reviewReason ? (
          <div
            data-expat-topic-review
            className="mt-6 rounded-xl border border-[hsl(var(--warning))] bg-[hsl(var(--warning))]/10 p-4"
          >
            <p className="text-sm font-medium text-foreground">{t('expat_topic_review_title')}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {topic.reviewReason}
            </p>
          </div>
        ) : null}

        {facts.length > 0 ? (
          <section className="mt-8 space-y-4 rounded-2xl border border-border p-5 sm:p-6">
            <h2 className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t('expat_topic_facts_heading')}
            </h2>
            {facts.map((f) => (
              <SourcedFact
                key={f.id}
                statement={f.statement[lang] ?? f.statement.en ?? ''}
                fact={{
                  factClass: f.factClass,
                  availability: f.availability,
                  register: f.register,
                  sources: f.sources,
                  needsReview: f.needsReview,
                }}
                className="border-t border-border pt-4 first:border-0 first:pt-0"
              />
            ))}
          </section>
        ) : null}

        <div className="mt-10 space-y-8">
          {content.sections.map((section, i) => (
            <section key={`${section.kind}-${i}`} data-expat-section={section.kind}>
              {/* Section headings never end with a period: they are labels,
                  not sentences. The content is authored that way and this
                  renders it unchanged. */}
              <h2 className="font-display text-xl font-semibold text-foreground">
                {section.heading}
              </h2>
              <p className="mt-3 text-[0.9375rem] leading-[1.7] text-foreground/90">
                {section.body}
              </p>
            </section>
          ))}
        </div>

        {handoffs.length > 0 ? (
          <aside className="mt-12 rounded-2xl border border-border p-5 sm:p-6">
            <h2 className="text-sm font-medium text-foreground">{t('expat_topic_next_title')}</h2>
            <p className="mt-1.5 text-2xs text-muted-foreground">{t('expat_topic_next_body')}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {handoffs.map((h) => (
                <Link
                  key={h.key}
                  to={h.to}
                  data-expat-handoff={h.key.toUpperCase()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-2xs text-foreground transition-colors hover:border-[hsl(var(--gold-border))]"
                >
                  {t(`expat_handoff_${h.key}`)}
                  <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </aside>
        ) : null}

        <Link
          to="/for-expats/georgia"
          className="mt-10 inline-flex items-center gap-2 text-sm text-[hsl(var(--gold-ink))] underline underline-offset-2"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          {t('expat_topic_back')}
        </Link>
      </article>
    </>
  );
}
