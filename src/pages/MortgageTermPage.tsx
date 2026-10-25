// /mortgage/terms/:slug — one mortgage word, explained properly.
//
// Order of the page, and why: what it means (the plain answer), why it
// matters to you (the reason to care), how it is calculated (the formula in
// words), a worked example in four short steps with round lari, the usual
// mistakes, then the words that sit next to it. The one-line summary from the
// (i) cards opens the page so the two never disagree.

import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Calculator, Lightbulb, Sigma } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import PageMeta from '@/components/common/PageMeta';
import { useLanguage } from '@/contexts/LanguageContext';
import { CategoryGlyph, LiveNbgLimits, TermHero } from '@/components/mortgage/terms/TermParts';
import {
  TERMS_INDEX_PATH, TERM_PAGES, categoryKey, pageExampleKeys, pageMistakeKeys, pageSectionKey, pageSummaryKey,
  pageTitleKey, termPageBySlug, termPath, type PageTerm,
} from '@/mortgage/termPages';

const LIVE_LIMITS: ReadonlySet<PageTerm> = new Set<PageTerm>(['NBG_LIMITS', 'PTI', 'LTV']);

function Section({ id, icon: Icon, title, children, tone = 'plain' }: {
  id: string;
  icon: typeof BookOpen;
  title: string;
  children: React.ReactNode;
  tone?: 'plain' | 'gold';
}) {
  return (
    <section
      aria-labelledby={id}
      className={tone === 'gold'
        ? 'relative overflow-hidden rounded-3xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] p-5 sm:p-7'
        : 'hm-customer-panel p-5 sm:p-7'}
    >
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0C1119] text-[hsl(38_92%_60%)]">
          <Icon className="h-5 w-5" />
        </span>
        <h2 id={id} className="font-display text-xl font-semibold text-foreground">{title}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function MortgageTermPage() {
  const { t } = useLanguage();
  const { slug } = useParams<{ slug: string }>();
  const page = termPageBySlug(slug);

  if (!page) {
    return (
      <AppLayout noPadding>
        <PageMeta title={t('mortgage_tp_not_found_title')} description={t('mortgage_tp_not_found_body')} />
        <div className="hm-customer hm-customer-canvas min-h-[calc(100vh-4rem)]">
          <div className="mx-auto w-full max-w-[48rem] px-4 py-10 sm:px-6">
            <div className="hm-customer-panel p-6 text-center sm:p-8">
              <h1 className="font-display text-2xl font-semibold text-foreground">{t('mortgage_tp_not_found_title')}</h1>
              <p className="mt-2 text-base text-muted-foreground">{t('mortgage_tp_not_found_body')}</p>
              <Link to={TERMS_INDEX_PATH} className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-full bg-[hsl(var(--gold))] px-6 text-base font-semibold text-[#161309]">
                {t('mortgage_tp_all_terms')}
              </Link>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  const { term } = page;
  const title = t(pageTitleKey(term));
  const index = TERM_PAGES.indexOf(page);
  const prev = index > 0 ? TERM_PAGES[index - 1] : null;
  const next = index < TERM_PAGES.length - 1 ? TERM_PAGES[index + 1] : null;

  return (
    <AppLayout noPadding>
      <PageMeta title={title} description={t(pageSummaryKey(term))} />
      <div className="hm-customer hm-customer-canvas min-h-[calc(100vh-4rem)]">
        <article className="mx-auto w-full max-w-[48rem] space-y-5 px-4 py-6 sm:space-y-6 sm:px-6 sm:py-10">
          <Link to={TERMS_INDEX_PATH} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground shadow-card transition-colors hover:border-[hsl(var(--gold-border))]">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            {t('mortgage_tp_all_terms')}
          </Link>

          <TermHero
            eyebrow={<span className="inline-flex items-center gap-2.5"><CategoryGlyph category={page.category} className="h-9 w-9 rounded-xl" />{t(categoryKey(page.category))}</span>}
            title={title}
            lead={t(pageSummaryKey(term))}
          />

          <Section id="tp-what" icon={BookOpen} title={t('mortgage_tp_what')}>
            <p className="text-base leading-relaxed text-foreground sm:text-[17px]">{t(pageSectionKey(term, 'what'))}</p>
          </Section>

          <Section id="tp-why" icon={Lightbulb} title={t('mortgage_tp_why')} tone="gold">
            <p className="text-base leading-relaxed text-foreground sm:text-[17px]">{t(pageSectionKey(term, 'why'))}</p>
          </Section>

          <Section id="tp-how" icon={Sigma} title={t('mortgage_tp_how')}>
            <p className="rounded-2xl border border-border bg-[hsl(var(--secondary))] px-4 py-4 text-base leading-relaxed text-foreground sm:px-5">
              {t(pageSectionKey(term, 'how'))}
            </p>
          </Section>

          {LIVE_LIMITS.has(term) ? <LiveNbgLimits /> : null}

          <Section id="tp-example" icon={Calculator} title={t('mortgage_tp_example')}>
            <ol className="relative grid gap-3">
              {pageExampleKeys(term).map((key, i, all) => (
                <li key={key} className="relative flex gap-4">
                  <span className="relative flex flex-col items-center">
                    <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ${i === all.length - 1 ? 'bg-[hsl(var(--gold))] text-[#161309]' : 'border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'}`}>
                      {i + 1}
                    </span>
                    {i < all.length - 1 ? <span aria-hidden="true" className="mt-1 w-px flex-1 bg-[hsl(var(--gold-border))]" /> : null}
                  </span>
                  <p className={`pb-2 pt-1.5 text-base leading-relaxed ${i === all.length - 1 ? 'font-semibold text-foreground' : 'text-foreground'}`}>{t(key)}</p>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-sm text-muted-foreground">{t('mortgage_tp_example_note')}</p>
          </Section>

          <Section id="tp-mistakes" icon={AlertTriangle} title={t('mortgage_tp_mistakes')}>
            <ul className="grid gap-2.5">
              {pageMistakeKeys(term).map((key) => (
                <li key={key} className="flex gap-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 dark:border-rose-900/50 dark:bg-rose-950/30">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
                  <span className="text-base leading-relaxed text-foreground">{t(key)}</span>
                </li>
              ))}
            </ul>
          </Section>

          {page.related.length ? (
            <section aria-labelledby="tp-related">
              <h2 id="tp-related" className="mb-3 font-display text-xl font-semibold text-foreground">{t('mortgage_tp_related')}</h2>
              <ul className="flex flex-wrap gap-2">
                {page.related.map((r) => (
                  <li key={r}>
                    <Link to={termPath(r)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground shadow-card transition-colors hover:border-[hsl(var(--gold-border))] hover:text-[hsl(var(--gold-ink))]">
                      {t(pageTitleKey(r))}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <Link to="/mortgage" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--gold))] px-6 text-base font-bold text-[#161309] shadow-card transition-colors hover:bg-[hsl(var(--gold-hover))] sm:w-auto sm:justify-start sm:rounded-full">
            <Calculator className="h-5 w-5" aria-hidden="true" />
            {t('mortgage_tp_try_calculator')}
          </Link>

          <nav aria-label={t('mortgage_tp_all_terms')} className="grid gap-3 sm:grid-cols-2">
            {prev ? (
              <Link to={termPath(prev.term)} className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-card transition-colors hover:border-[hsl(var(--gold-border))]">
                <ArrowLeft className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))] rtl:rotate-180" aria-hidden="true" />
                <span className="min-w-0 text-sm font-medium text-foreground">{t(pageTitleKey(prev.term))}</span>
              </Link>
            ) : <span className="hidden sm:block" />}
            {next ? (
              <Link to={termPath(next.term)} className="flex min-h-14 items-center justify-end gap-3 rounded-2xl border border-border bg-card p-4 text-end shadow-card transition-colors hover:border-[hsl(var(--gold-border))]">
                <span className="min-w-0 text-sm font-medium text-foreground">{t(pageTitleKey(next.term))}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))] rtl:rotate-180" aria-hidden="true" />
              </Link>
            ) : null}
          </nav>

          <p className="rounded-2xl border border-dashed border-border px-5 py-4 text-xs leading-relaxed text-muted-foreground">{t('mortgage_tp_disclaimer')}</p>
        </article>
      </div>
    </AppLayout>
  );
}
