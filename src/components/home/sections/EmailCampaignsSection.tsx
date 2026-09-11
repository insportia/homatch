import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { FeatureGlyph } from '@/components/home/FeatureGlyph';
import { PAGE, SECTION_Y } from './primitives';
import { useSectionField } from '@/site/content';

/**
 * REGION 08 — email campaigns.
 *
 * WHY THIS EXISTS AS A REGION
 *
 * The previous pass put this in a footnote strip under the AI Call Center,
 * and the code said so in as many words. Outreach is calls AND email, both
 * are shipped products on their own routes, and a strip at the bottom of
 * somebody else's section is a statement about importance that nobody
 * intended to make.
 *
 * It does NOT copy the call centre's layout. A call is a live event, so that
 * region shows one in progress. A campaign is a piece of work you assemble,
 * so this region shows the builder: the audience, the subject, the message
 * that Homatch AI drafts, and the outcome that comes back against each
 * contact.
 *
 * NOTHING IN THE PANEL IS INVENTED
 *
 * No contact names, no list sizes, no open or click rates. The fields are
 * labelled and their values are blank, because the page has no campaign and
 * a plausible "38% opened" would be a fabricated metric on a marketing page.
 */

const POINTS = [
  { key: 'audience', title: 'mp_email_point_1', desc: 'mp_email_point_1_d' },
  { key: 'draft', title: 'mp_email_point_2', desc: 'mp_email_point_2_d' },
  { key: 'record', title: 'mp_email_point_3', desc: 'mp_email_point_3_d' },
] as const;

const STAGES = [
  'mp_email_stage_1', 'mp_email_stage_2', 'mp_email_stage_3',
  'mp_email_stage_4', 'mp_email_stage_5', 'mp_email_stage_6',
] as const;

export function EmailCampaignsSection() {
  const sf = useSectionField();
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  const open = () => navigate(session ? '/outreach/email' : '/auth/signup');

  return (
    <section id="email" className={`${PAGE} scroll-mt-20 ${SECTION_Y}`}>
      <div className="grid gap-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-center lg:gap-16">
        {/* ── The argument ─────────────────────────────────────── */}
        <div className="min-w-0">
          <div className="flex items-center gap-3.5">
            <FeatureGlyph name="email" size={48} className="sm:h-14 sm:w-14" />
            <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-ink">
              {sf('eyebrow', 'mp_email_eyebrow')}
            </p>
          </div>

          <h2
            className="mt-6 text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-foreground sm:mt-7"
            style={{ fontSize: 'clamp(1.4rem, 5.6vw, 2.75rem)' }}
          >
            {sf('title', 'mp_email_show_title')}
          </h2>
          <p className="mt-4 max-w-[34rem] text-pretty text-[14.5px] leading-[1.65] text-ink-soft sm:mt-5 sm:text-base sm:leading-[1.7]">
            {sf('body', 'mp_email_desc')}
          </p>

          <ul className="mt-7 grid gap-px overflow-hidden rounded-[0.9rem] border border-foreground/[0.14] bg-foreground/10 sm:mt-9 sm:grid-cols-3">
            {POINTS.map(point => (
              <li key={point.key} className="bg-card p-4 sm:p-5">
                <h3 className="text-sm font-semibold leading-snug text-foreground">{t(point.title)}</h3>
                <p className="mt-2 text-pretty text-[13px] leading-relaxed text-ink-soft">{t(point.desc)}</p>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={open}
            className="group mt-7 inline-flex h-12 items-center justify-center gap-2.5 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors duration-300 hover:bg-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none sm:mt-9"
          >
            {t('mp_email_cta')}
            <ArrowRight
              className={`h-4 w-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`}
              strokeWidth={2}
              aria-hidden="true"
            />
          </button>
        </div>

        {/* ── The campaign, as an object ───────────────────────── */}
        <div className="min-w-0 overflow-hidden rounded-[1.1rem] border border-foreground/15 bg-card shadow-hover" role="img" aria-label={t('mp_email_title')}>
          <div className="space-y-2.5 p-5 sm:p-6">
            <Field label={t('mp_email_field_1')} />
            <Field label={t('mp_email_field_2')} />

            {/* The message, with the AI draft sitting inside the field rather
                than beside it: the drafting is part of writing the campaign,
                not a separate product bolted on. */}
            <div className="rounded-[0.7rem] border border-foreground/[0.14] bg-secondary/60 p-3.5">
              <p className="text-[12px] font-medium text-ink-soft">{t('mp_email_field_3')}</p>
              <div className="mt-3 space-y-2" aria-hidden="true">
                <span className="block h-2 w-[92%] rounded-full bg-foreground/[0.16]" />
                <span className="block h-2 w-[78%] rounded-full bg-foreground/[0.13]" />
                <span className="block h-2 w-[85%] rounded-full bg-foreground/[0.16]" />
                <span className="block h-2 w-[54%] rounded-full bg-foreground/10" />
              </div>
              <p className="mt-3.5 inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground">
                <Sparkles className="h-3 w-3 shrink-0 text-gold" strokeWidth={2} aria-hidden="true" />
                {t('mp_email_field_ai')}
              </p>
            </div>
          </div>

          {/* The path a campaign takes, end to end. */}
          <ol className="grid grid-cols-2 gap-px border-t border-foreground/[0.12] bg-foreground/10 sm:grid-cols-3">
            {STAGES.map((stage, i) => (
              <li key={stage} className="flex items-center gap-2.5 bg-card px-3.5 py-3">
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold tabular-nums ${
                    i === STAGES.length - 1
                      ? 'bg-gold text-[#0A0A0A]'
                      : 'border border-foreground/[0.22] text-muted-foreground'
                  }`}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <span className="min-w-0 text-[12px] font-medium leading-tight text-foreground">{t(stage)}</span>
              </li>
            ))}
          </ol>

          <p className="border-t border-foreground/[0.12] px-5 py-3.5 text-pretty text-xs leading-relaxed text-muted-foreground sm:px-6">
            {t('mp_email_panel_note')}
          </p>
        </div>
      </div>
    </section>
  );
}

function Field({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[0.7rem] border border-foreground/[0.14] bg-secondary/60 px-3.5 py-3">
      <span className="min-w-0 text-[12px] font-medium text-ink-soft">{label}</span>
      <span className="h-2 w-16 shrink-0 rounded-full bg-foreground/[0.16] sm:w-24" aria-hidden="true" />
    </div>
  );
}
