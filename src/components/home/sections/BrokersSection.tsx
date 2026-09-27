import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, Check } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { PAGE, SECTION_Y } from './primitives';
import { useSectionField, useFieldProps } from '@/site/content';

/**
 * REGION — the broker directory.
 *
 * WHY IT HAS A REGION
 *
 * Brokers and agencies are a real Homatch product with a real public page
 * (/brokers), and until this pass the home page never said so. The region is
 * built in the page's own language — glyph-and-eyebrow header, check-listed
 * points, one filled CTA — so it reads as though it was always here.
 *
 * WHAT THE PANEL SHOWS
 *
 * The SHAPE of a directory listing, with every value blanked. Printing a
 * plausible agency name next to real markets would be a fabricated listing —
 * the same rule the mortgage panel follows with its blanked figures. The
 * three grey rows say "listings live here"; the directory page says who.
 *
 * WHAT IT DOES NOT CLAIM
 *
 * Only brokers and agencies with an active paid Homatch listing appear in
 * the directory. Discovered market intelligence about brokers never becomes
 * a listing by itself, and this region does not imply a marketplace of
 * verified professionals that does not exist.
 */

const POINTS = [
  { field: 'p1', title: 'home_brokers_p1_t', desc: 'home_brokers_p1_d' },
  { field: 'p2', title: 'home_brokers_p2_t', desc: 'home_brokers_p2_d' },
  { field: 'p3', title: 'home_brokers_p3_t', desc: 'home_brokers_p3_d' },
] as const;

export function BrokersSection() {
  const sf = useSectionField();
  const fp = useFieldProps();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  return (
    <section id="brokers" className={`${PAGE} scroll-mt-20 ${SECTION_Y}`}>
      <div className="grid gap-9 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div className="min-w-0">
          <div className="flex items-center gap-3.5">
            <span
              className="grid h-12 w-12 shrink-0 place-items-center rounded-[0.9rem] border border-foreground/15 bg-secondary text-foreground sm:h-14 sm:w-14"
              aria-hidden="true"
            >
              <Building2 className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <p className="min-w-0 text-[14px] font-semibold uppercase tracking-[0.22em] text-gold-ink" {...fp('eyebrow')}>
              {sf('eyebrow', 'home_brokers_eyebrow')}
            </p>
          </div>

          <h2
            className="mt-6 text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-foreground sm:mt-7"
            style={{ fontSize: 'clamp(1.4rem, 5.6vw, 2.75rem)' }}
            {...fp('title')}
          >
            {sf('title', 'home_brokers_title')}
          </h2>
          <p className="mt-4 max-w-[34rem] text-pretty text-[16px] leading-[1.65] text-ink-soft sm:mt-5 sm:text-base sm:leading-[1.7]" {...fp('body')}>
            {sf('body', 'home_brokers_body')}
          </p>

          <ul className="mt-7 space-y-3.5 sm:mt-9 sm:space-y-4">
            {POINTS.map(point => (
              <li key={point.field} className="flex gap-3.5">
                <span className="mt-[3px] grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[17px] font-semibold leading-snug text-foreground" {...fp(`${point.field}_t`)}>
                    {sf(`${point.field}_t`, point.title)}
                  </span>
                  <span className="mt-1 block text-pretty text-[16px] leading-relaxed text-ink-soft sm:text-sm" {...fp(`${point.field}_d`)}>
                    {sf(`${point.field}_d`, point.desc)}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => navigate('/brokers')}
            className="group mt-7 inline-flex h-12 items-center justify-center gap-2.5 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors duration-300 hover:bg-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none sm:mt-9"
          >
            <span {...fp('cta')}>{sf('cta', 'home_brokers_cta')}</span>
            <ArrowRight
              className={`h-4 w-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`}
              strokeWidth={2}
              aria-hidden="true"
            />
          </button>
        </div>

        {/* ── The directory, blanked ─────────────────────────────── */}
        <div
          className="min-w-0 overflow-hidden rounded-[1.1rem] border border-foreground/15 bg-card shadow-hover"
          role="img"
          aria-label={t('home_brokers_panel_label')}
        >
          <div className="flex items-center justify-between gap-3 border-b border-foreground/[0.12] px-5 py-4 sm:px-6">
            <p className="text-[14px] font-semibold uppercase tracking-[0.16em] text-muted-foreground" {...fp('panel')}>
              {sf('panel', 'home_brokers_panel_label')}
            </p>
            <span className="h-2 w-2 rounded-full bg-gold" aria-hidden="true" />
          </div>
          <div className="divide-y divide-foreground/[0.08]">
            {[0, 1, 2].map(row => (
              <div key={row} className="flex items-center gap-4 px-5 py-4 sm:px-6 sm:py-5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[0.7rem] border border-gold/45 bg-secondary text-gold-ink">
                  <Building2 className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  {/* Blanked, deliberately: a plausible agency name here would
                      be a fabricated listing. */}
                  <div className="h-2.5 w-2/5 rounded-full bg-foreground/[0.16]" />
                  <div className="h-2 w-3/5 rounded-full bg-foreground/[0.08]" />
                </div>
                <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                  <span className="h-6 w-12 rounded-full border border-foreground/[0.14] bg-secondary" />
                  <span className="h-6 w-12 rounded-full border border-foreground/[0.14] bg-secondary" />
                </div>
              </div>
            ))}
          </div>
          <p className="border-t border-foreground/[0.12] px-5 py-3.5 text-[13px] leading-relaxed text-muted-foreground sm:px-6" {...fp('footnote')}>
            {sf('footnote', 'home_brokers_footnote')}
          </p>
        </div>
      </div>
    </section>
  );
}
