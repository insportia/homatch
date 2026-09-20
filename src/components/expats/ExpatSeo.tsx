// HOMATCH FOR EXPATS — the head tags, and an honest note about their limits.
//
// §72 asks for canonical URLs, hreflang, breadcrumbs and structured data.
// All four are here. What none of them can do is make this content
// indexable on their own, because Homatch is a client-rendered Vite
// application with no server rendering: a crawler that does not execute
// JavaScript sees an empty div, and the tags below are written by React
// after that crawler has already decided what the page contains.
//
// Googlebot does render, so this is not useless. But "we added hreflang"
// is not the same claim as "these pages rank", and treating the first as
// the second is how an SEO layer gets marked done while the pages stay
// invisible to everything except Google. Prerendering is the fix and it is
// an infrastructure change, not a component.
//
// WHY BREADCRUMBS ARE EMITTED AS DATA AND NOT ONLY DRAWN
//
// A drawn breadcrumb helps a reader who arrived from search. The
// BreadcrumbList helps the result they clicked show where it sits. They
// are different jobs and this does both from one definition, so they
// cannot drift.

import React from 'react';
import { Helmet } from 'react-helmet-async';
import { useLanguage } from '@/contexts/LanguageContext';

/** The six the product ships. Must match the i18n bundle exactly. */
const LOCALES = ['en', 'ka', 'ru', 'tr', 'ar', 'he'] as const;

const ORIGIN = 'https://homatch.live';

export interface Crumb {
  name: string;
  path: string;
}

export function ExpatSeo({
  path,
  crumbs,
  article,
}: {
  /** Path without origin, always starting with a slash. */
  path: string;
  crumbs?: readonly Crumb[];
  /** Present on a topic page; absent on index pages. */
  article?: {
    headline: string;
    description: string;
    modified: string | null;
  };
}) {
  const { lang } = useLanguage();
  const canonical = `${ORIGIN}${path}`;

  const breadcrumbLd =
    crumbs && crumbs.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: crumbs.map((c, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: c.name,
            item: `${ORIGIN}${c.path}`,
          })),
        }
      : null;

  /*
   * Article, and only Article. §73 says use schema.org when it is
   * semantically correct and do not spam it. FAQPage is tempting on a
   * topic page with headed sections, and it would be wrong: those are
   * sections of an explanation, not questions somebody asked, and marking
   * them up as an FAQ is the kind of thing that eventually earns a manual
   * action.
   */
  const articleLd = article
    ? {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: article.headline,
        description: article.description,
        inLanguage: lang,
        ...(article.modified ? { dateModified: article.modified } : {}),
        publisher: { '@type': 'Organization', name: 'Homatch' },
        mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      }
    : null;

  return (
    <Helmet>
      <link rel="canonical" href={canonical} />
      {LOCALES.map((l) => (
        <link key={l} rel="alternate" hrefLang={l} href={canonical} />
      ))}
      {/* The default for a lang this product does not ship. */}
      <link rel="alternate" hrefLang="x-default" href={canonical} />
      <meta property="og:type" content={article ? 'article' : 'website'} />
      <meta property="og:url" content={canonical} />
      {breadcrumbLd ? (
        <script type="application/ld+json">{JSON.stringify(breadcrumbLd)}</script>
      ) : null}
      {articleLd ? <script type="application/ld+json">{JSON.stringify(articleLd)}</script> : null}
    </Helmet>
  );
}

/**
 * The drawn breadcrumb. Same definition as the structured one above.
 */
export function ExpatBreadcrumbs({ crumbs }: { crumbs: readonly Crumb[] }) {
  const { t } = useLanguage();
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label={t('expat_breadcrumb_aria')} className="mb-6 text-2xs text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1.5">
        {crumbs.map((c, i) => (
          <li key={c.path} className="flex items-center gap-1.5">
            {i > 0 ? <span aria-hidden="true">/</span> : null}
            {i === crumbs.length - 1 ? (
              <span aria-current="page" className="text-foreground">
                {c.name}
              </span>
            ) : (
              <a href={c.path} className="underline underline-offset-2 hover:text-foreground">
                {c.name}
              </a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
