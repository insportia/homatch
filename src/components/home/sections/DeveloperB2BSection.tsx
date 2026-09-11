import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, Mail, MessagesSquare, PhoneCall, Radar, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { SceneMedia } from '@/components/home/media/SceneMedia';
import { Button } from '@/components/ui/button';
import { Eyebrow, PAGE, SECTION_Y } from './primitives';

/**
 * REGION 06 — Developer B2B.
 *
 * The largest single region on the page, and deliberately black. "Developer
 * workspace — project records and buyer demand" was a row in a directory,
 * which badly under-sold it: for a developer, Homatch is the whole sales and
 * marketing operation, not a filing cabinet.
 *
 * THE FLOW IS THE ARGUMENT
 *
 * Project → demand → people → matching → AI outreach → calls & email →
 * follow-up → opportunity. Every stage in it maps to something the product
 * actually does today; nothing here promises end-to-end automation of a
 * developer's operations, because that is not what this is.
 *
 * Drawn in SVG/CSS with fine gold lines rather than an animation library —
 * the page's performance budget is spent on photography, and the whole
 * diagram respects prefers-reduced-motion by simply not moving.
 */
const STAGES = [
  { key: 'project', icon: Building2, labelKey: 'mp_dev_stage_project' },
  { key: 'demand', icon: Radar, labelKey: 'mp_dev_stage_demand' },
  { key: 'people', icon: Users, labelKey: 'mp_dev_stage_people' },
  { key: 'calls', icon: PhoneCall, labelKey: 'mp_dev_stage_calls' },
  { key: 'email', icon: Mail, labelKey: 'mp_dev_stage_email' },
  { key: 'followup', icon: MessagesSquare, labelKey: 'mp_dev_stage_followup' },
];

export function DeveloperB2BSection() {
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  const points = [
    { key: '1', title: t('mp_dev_point_1_title'), desc: t('mp_dev_point_1_desc') },
    { key: '2', title: t('mp_dev_point_2_title'), desc: t('mp_dev_point_2_desc') },
    { key: '3', title: t('mp_dev_point_3_title'), desc: t('mp_dev_point_3_desc') },
  ];

  return (
    <section id="developers" className="relative scroll-mt-20 overflow-hidden bg-[#080808] text-white">
      {/* The city, at the bottom of its exposure range: a texture that says
          "a development, in a real place" without turning the region warm. */}
      {/* The city, in black and white. At full chroma a Tbilisi sunset behind
          this much type is both a legibility problem and the single largest
          source of warm colour on a black-white-gold page; desaturated to
          nothing and held at a tenth of its exposure it is pure texture. */}
      <div className="absolute inset-0 saturate-0" aria-hidden="true">
        <SceneMedia scene="platform" alt="" sizes="100vw" position="50% 58%" />
        <div className="absolute inset-0 bg-[#080808]/90" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#080808] via-[#080808]/78 to-[#080808]" />
      </div>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(70rem 36rem at 20% -10%, hsl(38 88% 54% / 0.16), transparent 66%)' }}
        aria-hidden="true"
      />

      <div className={`${PAGE} relative ${SECTION_Y}`}>
        <div className="grid gap-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-20">
          <div>
            <Eyebrow tone="light">{t('mp_dev_eyebrow')}</Eyebrow>
            <h2
              className="mt-5 text-balance font-semibold leading-[1.08] tracking-[-0.025em] text-white"
              style={{ fontSize: 'clamp(1.4rem, 5.6vw, 3.1rem)' }}
            >
              {t('mp_dev_title')}
            </h2>
            <p className="mt-6 max-w-[36rem] text-pretty text-[15px] leading-[1.75] text-white/75 sm:text-base">
              {t('mp_dev_sub')}
            </p>

            <ul className="mt-10 border-t border-white/15">
              {points.map(point => (
                <li key={point.key} className="border-b border-white/15 py-4 sm:py-6">
                  <h3 className="text-base font-semibold text-white">{point.title}</h3>
                  <p className="mt-2 max-w-[34rem] text-pretty text-sm leading-relaxed text-white/65">{point.desc}</p>
                </li>
              ))}
            </ul>

            <Button
              className="mt-9 h-auto min-h-12 gap-2.5 whitespace-normal rounded-full bg-gold px-6 py-3 text-start text-sm text-primary hover:bg-gold/90 sm:px-7"
              onClick={() => navigate('/partners')}
            >
              {t('mp_dev_cta')}
              <ArrowRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </div>

          {/* ── The operation, as a flow ──────────────────────────────
              A vertical rail on every size: six stages read top-to-bottom
              the way the work actually happens, and it needs no separate
              mobile treatment. */}
          <div className="relative">
            <ol className="relative">
              <span
                className="pointer-events-none absolute start-[1.25rem] top-4 bottom-4 w-px sm:start-[1.4rem] bg-gradient-to-b from-transparent via-gold/45 to-transparent"
                aria-hidden="true"
              />
              {STAGES.map((stage, i) => (
                <li key={stage.key} className="relative flex items-center gap-4 py-2.5 sm:gap-5 sm:py-3.5">
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-[0.6rem] border border-white/25 bg-[#111111] text-gold sm:h-11 sm:w-11"
                    aria-hidden="true"
                  >
                    <stage.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{t(stage.labelKey)}</p>
                  </div>
                  <span className="shrink-0 text-[11px] font-semibold tabular-nums tracking-[0.16em] text-white/35" aria-hidden="true">
                    {`0${i + 1}`}
                  </span>
                </li>
              ))}
            </ol>

            {/* Where the flow arrives. */}
            <div className="mt-6 flex items-center gap-5 rounded-[0.8rem] border border-gold/40 bg-gold/[0.08] px-5 py-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[0.6rem] bg-gold text-primary" aria-hidden="true">
                <Building2 className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </span>
              <p className="min-w-0 flex-1 text-sm font-semibold text-white">{t('mp_dev_stage_outcome')}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
