import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { FeatureGlyph } from '@/components/home/FeatureGlyph';
import { PAGE, SECTION_Y } from './primitives';
import { useSectionField } from '@/site/content';

/**
 * REGION 06 — the mortgage consultant.
 *
 * WHY IT HAS A REGION
 *
 * Financing decides whether a purchase happens at all, and until this pass
 * it was a tile in a small secondary row. That said "optional" whatever the
 * copy claimed. It is a real product on a real route, so it gets the same
 * weight as verification and matching, in a shape built around what it
 * actually produces: a scenario.
 *
 * WHAT THE PANEL SHOWS
 *
 * The INPUTS of a financing scenario and the one number they resolve to,
 * with a second column showing that the same inputs can be set against
 * another set of terms. The figures are blanked rather than invented: the
 * page has no property and no customer, and printing a plausible-looking
 * GEL payment next to the word "scenario" would be a fabricated quote.
 *
 * WHAT IT DOES NOT CLAIM
 *
 * Homatch models the cost. It does not talk to a bank, does not submit an
 * application and cannot promise anybody approval, and the region says so in
 * its own footnote rather than leaving it to be assumed.
 */

const POINTS = [
  { key: 'payment', title: 'mp_mortgage_point_1', desc: 'mp_mortgage_point_1_d' },
  { key: 'structure', title: 'mp_mortgage_point_2', desc: 'mp_mortgage_point_2_d' },
  { key: 'compare', title: 'mp_mortgage_point_3', desc: 'mp_mortgage_point_3_d' },
] as const;

const ROWS = ['mp_mortgage_row_price', 'mp_mortgage_row_down', 'mp_mortgage_row_term', 'mp_mortgage_row_rate'] as const;

export function MortgageSection() {
  const sf = useSectionField();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  return (
    <section id="mortgage" className={`${PAGE} scroll-mt-20 ${SECTION_Y}`}>
      <div className="grid gap-9 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div className="min-w-0">
          <div className="flex items-center gap-3.5">
            <FeatureGlyph name="mortgage" size={48} className="sm:h-14 sm:w-14" />
            <p className="min-w-0 text-[13px] font-semibold uppercase tracking-[0.22em] text-gold-ink">
              {sf('eyebrow', 'mp_mortgage_eyebrow')}
            </p>
          </div>

          <h2
            className="mt-6 text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-foreground sm:mt-7"
            style={{ fontSize: 'clamp(1.4rem, 5.6vw, 2.75rem)' }}
          >
            {sf('title', 'mp_mortgage_show_title')}
          </h2>
          <p className="mt-4 max-w-[34rem] text-pretty text-[16px] leading-[1.65] text-ink-soft sm:mt-5 sm:text-base sm:leading-[1.7]">
            {sf('body', 'mp_mortgage_desc')}
          </p>

          <ul className="mt-7 space-y-3.5 sm:mt-9 sm:space-y-4">
            {POINTS.map(point => (
              <li key={point.key} className="flex gap-3.5">
                <span className="mt-[3px] grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[17px] font-semibold leading-snug text-foreground">{t(point.title)}</span>
                  <span className="mt-1 block text-pretty text-[15px] leading-relaxed text-ink-soft sm:text-sm">
                    {t(point.desc)}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => navigate('/mortgage')}
            className="group mt-7 inline-flex h-12 items-center justify-center gap-2.5 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors duration-300 hover:bg-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none sm:mt-9"
          >
            {t('mp_mortgage_cta')}
            <ArrowRight
              className={`h-4 w-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`}
              strokeWidth={2}
              aria-hidden="true"
            />
          </button>
        </div>

        {/* ── The scenario ─────────────────────────────────────── */}
        <div className="min-w-0 overflow-hidden rounded-[1.1rem] border border-foreground/15 bg-card shadow-hover" role="img" aria-label={t('mp_mortgage_title')}>
          <div className="flex items-center justify-between gap-3 border-b border-foreground/[0.12] px-5 py-4 sm:px-6">
            <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {t('mp_mortgage_scenario')}
            </p>
            {/* Two columns of the same shape: the point is that a second set
                of terms sits beside the first, not what is in them. */}
            <div className="flex shrink-0 items-center gap-2" aria-hidden="true">
              <span className="grid h-6 w-6 place-items-center rounded-[0.35rem] bg-primary text-[13px] font-semibold text-primary-foreground">A</span>
              <span className="grid h-6 w-6 place-items-center rounded-[0.35rem] border border-foreground/20 text-[13px] font-semibold text-muted-foreground">B</span>
            </div>
          </div>

          <dl className="divide-y divide-foreground/10">
            {ROWS.map(row => (
              <div key={row} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                <dt className="min-w-0 flex-1 text-[15px] text-ink-soft sm:text-sm">{t(row)}</dt>
                <dd className="flex shrink-0 items-center gap-2" aria-hidden="true">
                  <span className="h-2 w-14 rounded-full bg-foreground/20 sm:w-20" />
                  <span className="h-2 w-10 rounded-full bg-foreground/10 sm:w-14" />
                </dd>
              </div>
            ))}
          </dl>

          <div className="flex items-center justify-between gap-4 bg-primary px-5 py-5 text-primary-foreground sm:px-6">
            <p className="min-w-0 text-[15px] font-semibold uppercase tracking-[0.14em] text-gold sm:text-sm">
              {t('mp_mortgage_row_result')}
            </p>
            <span className="flex shrink-0 items-center gap-2" aria-hidden="true">
              <span className="h-3 w-16 rounded-full bg-gold sm:w-24" />
              <span className="h-3 w-11 rounded-full bg-white/25 sm:w-16" />
            </span>
          </div>

          <p className="px-5 py-4 text-pretty text-xs leading-relaxed text-muted-foreground sm:px-6">
            {t('mp_mortgage_note')}
          </p>
        </div>
      </div>
    </section>
  );
}
