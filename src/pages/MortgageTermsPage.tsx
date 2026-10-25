// /mortgage/terms — every mortgage word, grouped, each a card that opens its
// own page. Public, so a person can read before they ever calculate.

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Search } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import PageMeta from '@/components/common/PageMeta';
import { useLanguage } from '@/contexts/LanguageContext';
import { CategoryGlyph, TermHero } from '@/components/mortgage/terms/TermParts';
import {
  TERM_CATEGORIES, TERM_PAGES, categoryKey, pageSummaryKey, pageTitleKey, termPath,
} from '@/mortgage/termPages';

export default function MortgageTermsPage() {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return TERM_CATEGORIES.map((category) => ({
      category,
      pages: TERM_PAGES.filter((p) => p.category === category).filter((p) => {
        if (!q) return true;
        return `${t(pageTitleKey(p.term))} ${t(pageSummaryKey(p.term))}`.toLocaleLowerCase().includes(q);
      }),
    })).filter((g) => g.pages.length > 0);
  }, [query, t]);

  return (
    <AppLayout noPadding>
      <PageMeta title={t('mortgage_tp_index_title')} description={t('mortgage_tp_index_sub')} />
      <div className="hm-customer hm-customer-canvas min-h-[calc(100vh-4rem)]">
        <div className="mx-auto w-full max-w-[64rem] space-y-6 px-4 py-6 sm:space-y-8 sm:px-6 sm:py-10">
          <Link to="/mortgage" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground shadow-card transition-colors hover:border-[hsl(var(--gold-border))]">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            {t('mortgage_tp_back_calculator')}
          </Link>

          <TermHero eyebrow={t('mortgage_tp_index_eyebrow')} title={t('mortgage_tp_index_title')} lead={t('mortgage_tp_index_sub')}>
            <label className="mt-6 flex min-h-12 max-w-md items-center gap-3 rounded-2xl border border-white/15 bg-white/[0.06] px-4 focus-within:border-[hsl(38_92%_56%)] focus-within:ring-2 focus-within:ring-[hsl(38_92%_56%/0.35)]">
              <Search className="h-4 w-4 shrink-0 text-white/60" aria-hidden="true" />
              <span className="sr-only">{t('mortgage_tp_index_search')}</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('mortgage_tp_index_search')}
                className="min-h-11 w-full min-w-0 bg-transparent text-base text-white placeholder:text-white/50 focus:outline-none"
              />
            </label>
            <p className="mt-3 text-sm text-white/60">{t('mortgage_tp_index_count', { n: TERM_PAGES.length })}</p>
          </TermHero>

          {groups.length === 0 ? (
            <p role="status" className="hm-customer-panel p-6 text-center text-base text-muted-foreground">{t('mortgage_tp_index_none')}</p>
          ) : null}

          {groups.map(({ category, pages }) => (
            <section key={category} aria-labelledby={`cat-${category}`}>
              <div className="mb-3 flex items-center gap-3">
                <CategoryGlyph category={category} className="h-10 w-10 border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]" />
                <h2 id={`cat-${category}`} className="font-display text-xl font-semibold text-foreground">{t(categoryKey(category))}</h2>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {pages.map((p) => (
                  <li key={p.slug}>
                    <Link
                      to={termPath(p.term)}
                      className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 shadow-card transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--gold-border))] hover:shadow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                    >
                      <span className="font-display text-lg font-semibold leading-snug text-foreground">{t(pageTitleKey(p.term))}</span>
                      <span className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{t(pageSummaryKey(p.term))}</span>
                      <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[hsl(var(--gold-ink))]">
                        {t('mortgage_tp_open')}
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <p className="rounded-2xl border border-dashed border-border px-5 py-4 text-xs leading-relaxed text-muted-foreground">{t('mortgage_tp_disclaimer')}</p>
        </div>
      </div>
    </AppLayout>
  );
}
