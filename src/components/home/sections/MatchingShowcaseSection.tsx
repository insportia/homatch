import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, Sparkles, UserSearch, Waves } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { FeatureGlyph } from '@/components/home/FeatureGlyph';
import { PAGE, SECTION_Y } from './primitives';
import { useSectionField } from '@/site/content';

/**
 * REGION 06 — matching.
 *
 * The previous pass drew this as an abstract fan of curves into an unlabelled
 * node. It was technically accurate and told a visitor nothing. The sentence
 * that has to land in two seconds is:
 *
 *   I give Homatch a property, and it finds people who may actually want it.
 *
 * So the flow is four labelled beats in that order, with the property at one
 * end and named-in-plain-language people at the other.
 *
 * THE HONEST PART
 *
 * A match is a signal of interest, not a buyer. The shortlist preview is
 * marked illustrative, carries no names and no counts, and the region states
 * outright that Homatch shows its reasons so the judgement stays with the
 * person reading it. Overselling this is the fastest way to make the product
 * look like a lead-generation scam, which is precisely what it is not.
 */

const BEATS = [
  { key: 'property', icon: Building2, label: 'mp_match_beat_1' },
  { key: 'analyse', icon: Sparkles, label: 'mp_match_beat_2' },
  { key: 'signals', icon: Waves, label: 'mp_match_beat_3' },
  { key: 'people', icon: UserSearch, label: 'mp_match_beat_4' },
] as const;

/* Relative strength only — a shape, never a percentage Homatch has not
   measured for a real property. */
const SHORTLIST = [
  { key: 'a', width: 'w-[92%]', reason: 'mp_result_match_reason_1' },
  { key: 'b', width: 'w-[74%]', reason: 'mp_result_match_reason_2' },
  { key: 'c', width: 'w-[58%]', reason: 'mp_result_match_reason_3' },
] as const;

export function MatchingShowcaseSection() {
  const sf = useSectionField();
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  return (
    <section id="matching" className="relative scroll-mt-20 overflow-hidden bg-[#080808] text-white">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(60rem 30rem at 20% 0%, hsl(20 80% 50% / 0.14), transparent 62%)' }}
        aria-hidden="true"
      />

      <div className={`${PAGE} relative ${SECTION_Y}`}>
        <div className="flex items-center gap-3.5">
          <FeatureGlyph name="matching" size={48} tone="dark" className="sm:h-14 sm:w-14" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold">{sf('eyebrow', 'mp_match_eyebrow')}</p>
        </div>

        {/* The headline is the sentence this product is named by; the
            mechanism is explained beside it rather than above it. */}
        <div className="mt-6 grid gap-7 sm:mt-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-end lg:gap-16">
          <div className="min-w-0">
            <h2
              className="max-w-[36rem] text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-white"
              style={{ fontSize: 'clamp(1.4rem, 5.6vw, 2.9rem)' }}
            >
              {sf('title', 'mp_match_title')}
            </h2>
            <p className="mt-3.5 max-w-[34rem] text-pretty text-[14.5px] leading-[1.6] text-gold sm:text-[15px]">
              {sf('subtitle', 'mp_match_show_title')}
            </p>
          </div>
          <p className="text-pretty text-[14.5px] leading-[1.65] text-white/70 sm:text-base sm:leading-[1.7]">
            {sf('body', 'mp_match_desc')}
          </p>
        </div>

        {/* ── The four beats ───────────────────────────────────────
            A row on lg, a column below it. The connector is a rule that
            runs between the numbers, not an arrow per gap, so it survives
            wrapping and reads the same in RTL. */}
        <ol className="mt-9 grid grid-cols-2 gap-px overflow-hidden rounded-[0.9rem] border border-white/15 bg-white/10 sm:mt-12 lg:grid-cols-4">
          {BEATS.map((beat, i) => (
            <li key={beat.key} className="flex min-w-0 flex-col bg-[#0C0C0C] p-4 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-[0.6rem] border sm:h-10 sm:w-10 ${
                    i === BEATS.length - 1 ? 'border-gold bg-gold text-[#0A0A0A]' : 'border-white/25 text-gold'
                  }`}
                  aria-hidden="true"
                >
                  <beat.icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
                </span>
                <span className="font-mono text-[11px] tabular-nums text-white/30" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>
              <p className="mt-4 text-pretty text-[14.5px] font-semibold leading-snug text-white sm:mt-5 sm:text-[15px]">{t(beat.label)}</p>
            </li>
          ))}
        </ol>

        {/* ── What comes back ──────────────────────────────────── */}
        <div className="mt-3.5 grid gap-5 sm:mt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-center">
          <div className="min-w-0 rounded-[0.9rem] border border-white/15 bg-[#0C0C0C] p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
                {t('mp_result_match_why')}
              </p>
              <span className="rounded-full border border-white/25 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">
                {t('mp_result_illustrative')}
              </span>
            </div>

            <ul className="mt-5 space-y-4">
              {SHORTLIST.map(row => (
                <li key={row.key} className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/20 text-white/50" aria-hidden="true">
                      <UserSearch className="h-4 w-4" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1 text-[13px] leading-snug text-white/80">{t(row.reason)}</span>
                  </div>
                  <div className="ms-11 mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className={`h-full rounded-full bg-gold ${row.width}`} />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="min-w-0">
            <p className="text-pretty text-sm leading-relaxed text-white/60">{t('mp_match_caveat')}</p>
            <button
              type="button"
              onClick={() => navigate(session ? '/property/add' : '/auth/signup')}
              className="group mt-6 inline-flex h-12 items-center justify-center gap-2.5 rounded-full bg-gold px-6 text-sm font-semibold text-[#0A0A0A] transition-colors duration-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#080808] motion-reduce:transition-none"
            >
              {t('mp_match_cta')}
              <ArrowRight
                className={`h-4 w-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`}
                strokeWidth={2}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
