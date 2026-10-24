// Matching Maintenance Mode — a product announcement, not an error page.
// The approved Georgian copy is verbatim (mw_mt_*); the CTA opens the existing Property
// Search service (/find-property). Only the matching interface is replaced: the property
// header above it, and every other page, stay as they are.

import { ArrowRight, Globe2, Search, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';

export function MaintenanceAnnouncement() {
  const { t } = useLanguage();
  return (
    <section data-testid="mw-maintenance" aria-labelledby="mw-mt-heading"
      className="relative overflow-hidden rounded-[1.4rem] bg-[#0C1119] text-white shadow-hover">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_24rem_at_100%_0%,hsl(38_92%_54%/0.16),transparent_60%),radial-gradient(40rem_20rem_at_0%_100%,hsl(218_60%_40%/0.22),transparent_60%)]" />
      <div className="relative px-5 py-8 sm:px-10 sm:py-12">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(38_92%_60%/0.45)] bg-white/5 px-3 py-1 text-2xs font-bold uppercase tracking-[0.18em] text-[hsl(38_92%_66%)]">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />HOMATCH
        </span>
        <h2 id="mw-mt-heading" className="mt-4 max-w-[24ch] font-display text-3xl font-bold leading-tight tracking-[-0.02em] sm:text-4xl" data-testid="mw-mt-heading">
          {t('mw_mt_heading')}
        </h2>
        <p className="mt-3 max-w-[48ch] text-lg font-semibold leading-snug text-[hsl(40_94%_72%)] sm:text-xl" data-testid="mw-mt-subheading">{t('mw_mt_subheading')}</p>
        <span className="mt-5 block h-[3px] w-16 rounded-full bg-[hsl(38_92%_56%)]" aria-hidden="true" />
        <p className="mt-5 max-w-[68ch] text-[15px] leading-relaxed text-white/80 sm:text-base" data-testid="mw-mt-paragraph">{t('mw_mt_paragraph')}</p>

        <div className="mt-8 grid gap-5 rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold leading-snug sm:text-xl" data-testid="mw-mt-section-title">{t('mw_mt_section_title')}</h3>
            <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-white/75 sm:text-[15px]" data-testid="mw-mt-section-text">{t('mw_mt_section_text')}</p>
            <ul className="mt-4 flex flex-wrap gap-2" aria-hidden="true">
              {[Globe2, Search, SlidersHorizontal].map((Icon, i) => (
                <li key={i} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-[hsl(38_92%_66%)] ring-1 ring-inset ring-white/10"><Icon className="h-4 w-4" /></li>
              ))}
            </ul>
          </div>
          <Link to="/find-property" data-testid="mw-maintenance-cta"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[hsl(38_92%_54%)] px-5 text-center text-[15px] font-bold leading-tight text-[#161309] shadow-card hover:bg-[hsl(38_92%_60%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_60%)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0C1119]">
            <span className="min-w-0 break-words">{t('mw_mt_cta')}</span>
            <ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
