import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { PAGE } from './primitives';
import { useSectionField, useFieldProps, useIsEditing } from '@/site/content';

/**
 * THE CLOSE — one decision, and what it costs.
 *
 * The page ends on the one dark surface after the AI Talk stage: a contained
 * panel rather than a full-bleed photograph, so the page stays one light
 * composition and the close reads as a deliberate full stop.
 *
 * WHAT IT SAYS ABOUT PRICE, AND WHERE THAT COMES FROM
 *
 * Only what the Pricing page itself states: pay as you go, no subscription,
 * and the credit rate. The rate is the same figure PricingPage falls back to
 * (`creditsPerUsd ?? 10`, rendered through payg_rate_line) — it is not a
 * price for anything, and no product price is quoted here, because those
 * live in the catalogue and change without a deploy.
 *
 * A signed-in visitor is not offered an account they already have: the
 * primary action becomes their dashboard. Inside Site Studio the editable
 * copy is shown instead, so it can be clicked and changed.
 */
const CREDITS_PER_USD = '10';

export function ClosingCTASection() {
  const sf = useSectionField();
  const fp = useFieldProps();
  const editing = useIsEditing();
  const { status } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const signedIn = status === 'AUTHENTICATED';

  return (
    <section className={`${PAGE} pb-16 pt-4 sm:pb-20 lg:pb-24`}>
      <div className="relative isolate overflow-hidden rounded-[1.75rem] bg-[hsl(var(--pub-night))] px-6 py-12 text-white sm:px-12 sm:py-16 lg:px-16">
        <div
          className="pointer-events-none absolute inset-0 -z-10 ltr:[background:radial-gradient(34rem_22rem_at_100%_0%,hsl(var(--gold)/0.18),transparent_70%)] rtl:[background:radial-gradient(34rem_22rem_at_0%_0%,hsl(var(--gold)/0.18),transparent_70%)]"
          aria-hidden="true"
        />
        <div className="grid items-end gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:gap-16">
          <div className="min-w-0">
            <h2 className="hm-pub-h2 text-white" {...fp('title')}>{sf('title', 'pub_close_title')}</h2>
            <p className="mt-4 max-w-[36rem] text-pretty text-[17px] leading-relaxed text-white/75" {...fp('body')}>
              {sf('body', 'pub_close_body')}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={() => navigate(signedIn ? '/dashboard' : '/auth/signup')}
                className="hm-pub-btn hm-pub-btn--lg bg-white text-[hsl(var(--pub-night))] hover:bg-white/90"
              >
                <span {...fp('cta')}>{signedIn && !editing ? t('nav_dashboard') : sf('cta', 'mp_cta_primary')}</span>
                <ArrowRight className="hm-pub-arrow" strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => navigate('/verify')}
                className="hm-pub-btn hm-pub-btn--lg border-white/25 bg-transparent text-white hover:border-white/50 hover:bg-white/[0.06]"
              >
                <span {...fp('cta_secondary')}>{sf('cta_secondary', 'mp_verify_capability_cta')}</span>
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.14] bg-white/[0.04] p-6">
            <p className="text-[14px] font-semibold text-gold" {...fp('price_label')}>{sf('price_label', 'payg_headline')}</p>
            <p className="mt-3 font-display text-[1.75rem] font-bold tracking-[-0.01em] text-white">
              <bdi className="hm-pub-num">{t('payg_rate_line', { credits: CREDITS_PER_USD, usd: '1' })}</bdi>
            </p>
            <p className="mt-2 text-pretty text-[15px] leading-relaxed text-white/70" {...fp('price_body')}>
              {sf('price_body', 'payg_no_subscription')}
            </p>
            <button
              type="button"
              onClick={() => navigate('/pricing')}
              className="group mt-4 inline-flex min-h-[2.75rem] items-center gap-1.5 text-[15px] font-semibold text-white underline decoration-gold/60 decoration-[1.5px] underline-offset-4 hover:decoration-gold hm-pub-focus"
            >
              <span {...fp('price_cta')}>{sf('price_cta', 'pub_close_pricing')}</span>
              <ArrowRight className="hm-pub-arrow" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
