import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Mail, PhoneCall } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Icon, PAGE, SECTION_Y, SectionIntro } from './primitives';

/**
 * REGION 05 — AI marketing and communication.
 *
 * The AI Call Center and email campaigns were previously two rows in a
 * directory at the bottom of the page, which read as afterthoughts. They are
 * real products with their own routes, so they get a region, two substantial
 * panels and a fragment each showing the shape of what they produce — a call
 * with its outcome, a campaign with its sends.
 *
 * WHAT THE FRAGMENTS DO NOT DO
 *
 * They show no counts, no rates and no names. A signed-out visitor has no
 * campaigns, and inventing "142 sent / 89 opened" to fill the space would be
 * a fabricated metric on a marketing page. The fragments show STRUCTURE:
 * the stages a call moves through, the fields a campaign has.
 */
export function MarketingIntelligenceSection() {
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  const gated = (path: string) => () => navigate(session ? path : '/auth/signup');
  const arrow = `h-4 w-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`;

  const callStages = [t('mp_calls_stage_1'), t('mp_calls_stage_2'), t('mp_calls_stage_3'), t('mp_calls_stage_4')];
  const emailFields = [t('mp_email_field_1'), t('mp_email_field_2'), t('mp_email_field_3')];

  return (
    <section className={`${PAGE} ${SECTION_Y}`}>
      <SectionIntro eyebrow={t('mp_marketing_eyebrow')} title={t('mp_marketing_title')} body={t('mp_marketing_sub')} />

      <div className="mt-14 grid gap-5 lg:grid-cols-2">
        {/* ── AI Call Center ── */}
        <article className="group flex flex-col rounded-[0.9rem] border border-foreground/15 bg-card transition-[border-color,box-shadow] duration-300 hover:border-foreground/30 hover:shadow-hover motion-reduce:transition-none">
          <div className="p-6 sm:p-8">
            <Icon icon={PhoneCall} size="lg" />
            <h3
              className="mt-5 text-balance font-semibold leading-[1.18] tracking-[-0.015em] text-foreground"
              style={{ fontSize: 'clamp(1.25rem, 1.7vw, 1.6rem)' }}
            >
              {t('call_center_title')}
            </h3>
            <p className="mt-3 text-pretty text-[15px] leading-[1.7] text-ink-soft">{t('mp_calls_desc')}</p>
          </div>

          {/* The stages a call moves through — structure, not statistics. */}
          <div className="mx-6 mb-6 rounded-[0.7rem] border border-foreground/12 bg-secondary/70 p-4 sm:mx-8" role="img" aria-label={t('call_center_title')}>
            <ol className="relative flex items-start justify-between gap-2">
              <span className="pointer-events-none absolute inset-x-4 top-[9px] h-px bg-foreground/15" aria-hidden="true" />
              {callStages.map((stage, i) => (
                <li key={stage} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
                  <span
                    className={`grid h-[18px] w-[18px] place-items-center rounded-full bg-secondary ${i === callStages.length - 1 ? 'text-gold' : 'text-foreground/40'}`}
                    aria-hidden="true"
                  >
                    <span className={`h-2 w-2 rounded-full ${i === callStages.length - 1 ? 'bg-gold' : 'bg-foreground/35'}`} />
                  </span>
                  <span className="mt-2.5 text-[10px] leading-tight text-ink-soft">{stage}</span>
                </li>
              ))}
            </ol>

            {/* The shape of a call once it has run: two sides of a
                conversation and the outcome kept against the contact. Bars,
                not sentences — there is no real transcript to show a
                signed-out visitor, and inventing one would be a lie about
                the product. */}
            <div className="mt-4 space-y-1.5 border-t border-foreground/12 pt-4" aria-hidden="true">
              {[['start', 'w-[62%]'], ['end', 'w-[44%]'], ['start', 'w-[54%]']].map(([side, width], i) => (
                <div key={i} className={`flex ${side === 'end' ? 'justify-end' : 'justify-start'}`}>
                  <span
                    className={`h-2 rounded-full ${width} ${side === 'end' ? 'bg-foreground/12' : 'bg-foreground/20'}`}
                  />
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-md bg-primary px-2.5 py-2">
              <PhoneCall className="h-3 w-3 shrink-0 text-gold" strokeWidth={1.75} aria-hidden="true" />
              <span className="min-w-0 truncate text-[11px] font-medium text-primary-foreground">
                {t('mp_calls_stage_4')}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={gated('/outreach/calls')}
            className="mt-auto flex items-center justify-between gap-3 border-t border-foreground/12 px-6 py-4 text-start text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-8"
          >
            {t('mp_calls_cta')}
            <ArrowRight className={arrow} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </article>

        {/* ── Email campaigns ── */}
        <article className="group flex flex-col rounded-[0.9rem] border border-foreground/15 bg-card transition-[border-color,box-shadow] duration-300 hover:border-foreground/30 hover:shadow-hover motion-reduce:transition-none">
          <div className="p-6 sm:p-8">
            <Icon icon={Mail} size="lg" />
            <h3
              className="mt-5 text-balance font-semibold leading-[1.18] tracking-[-0.015em] text-foreground"
              style={{ fontSize: 'clamp(1.25rem, 1.7vw, 1.6rem)' }}
            >
              {t('mp_email_title')}
            </h3>
            <p className="mt-3 text-pretty text-[15px] leading-[1.7] text-ink-soft">{t('mp_email_desc')}</p>
          </div>

          {/* A campaign's fields — again structure, not numbers. */}
          <div className="mx-6 mb-6 space-y-1.5 rounded-[0.7rem] border border-foreground/12 bg-secondary/70 p-4 sm:mx-8" role="img" aria-label={t('mp_email_title')}>
            {emailFields.map(field => (
              <div key={field} className="flex items-center justify-between gap-3 rounded-md border border-foreground/10 bg-card px-2.5 py-2">
                <span className="min-w-0 truncate text-[11px] text-ink-soft">{field}</span>
                <span className="h-1.5 w-12 shrink-0 rounded-full bg-foreground/15" aria-hidden="true" />
              </div>
            ))}
            <div className="flex items-center gap-2 rounded-md bg-primary px-2.5 py-2">
              <Mail className="h-3 w-3 shrink-0 text-gold" strokeWidth={1.75} aria-hidden="true" />
              <span className="min-w-0 truncate text-[11px] font-medium text-primary-foreground">{t('mp_email_field_ai')}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={gated('/outreach/email')}
            className="mt-auto flex items-center justify-between gap-3 border-t border-foreground/12 px-6 py-4 text-start text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-8"
          >
            {t('mp_email_cta')}
            <ArrowRight className={arrow} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </article>
      </div>
    </section>
  );
}
