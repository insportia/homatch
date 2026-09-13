import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { PAGE, SECTION_Y } from '../primitives';
import { useSectionField, useFieldProps } from '@/site/content';

/**
 * THE DEVELOPER PAGE'S OPENING.
 *
 * WHAT IT IS ALLOWED TO SAY
 *
 * Everything on this page describes capabilities this product has: buyer
 * matching, AI qualification, the call centre, WhatsApp, email, and the
 * contact thread they all write to. There are no client counts, no
 * conversion rates and no ROI figures anywhere on it, because we do not have
 * them and inventing them would be the difference between a product page and
 * a claim we cannot stand behind.
 *
 * Every word is a Site Studio field, so the offer can be rewritten without a
 * deploy — which matters most here, where the commercial packaging is still
 * being decided.
 */
export function DevHeroSection() {
  const sf = useSectionField();
  const fp = useFieldProps();
  const { isRTL } = useLanguage();
  const navigate = useNavigate();

  return (
    <section className="bg-[#0D0D0D] text-white">
      <div className={`${PAGE} ${SECTION_Y}`}>
        <div className="max-w-[52rem]">
          <p
            className="flex items-center gap-2.5 text-[14px] font-semibold uppercase tracking-[0.24em] text-gold"
            {...fp('eyebrow')}
          >
            <span className="h-px w-7 bg-gold" aria-hidden="true" />
            {sf('eyebrow', 'mp_dev_eyebrow')}
          </p>
          <h1
            className="mt-4 text-balance font-semibold leading-[1.08] tracking-[-0.025em] sm:mt-5"
            style={{ fontSize: 'clamp(1.75rem, 6vw, 3.4rem)' }}
            {...fp('title')}
          >
            {sf('title', 'mp_dev_title')}
          </h1>
          <p
            className="mt-5 max-w-[42rem] text-pretty text-[17px] leading-[1.65] text-white/70 sm:text-lg sm:leading-[1.7]"
            {...fp('body')}
          >
            {sf('body', 'mp_dev_sub')}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/partners')}
              className="inline-flex min-h-[48px] items-center gap-2 rounded-full bg-gold px-6 text-[16px] font-semibold text-primary transition-colors hover:bg-gold-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D0D0D]"
            >
              <span {...fp('cta')}>{sf('cta', 'mp_dev_cta')}</span>
              <ArrowRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            <a
              href="#dev-flow"
              className="inline-flex min-h-[48px] items-center gap-2 rounded-full border border-white/25 px-6 text-[16px] font-medium text-white/85 transition-colors hover:border-gold hover:text-white"
              {...fp('cta_secondary')}
            >
              {sf('cta_secondary', 'devp_hero_cta2')}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
