import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Calculator, Mail, PhoneCall, Search, ShieldCheck, Sparkles, UserSearch,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { ArrowLink, Eyebrow, PAGE } from './primitives';

/**
 * REGION 03 — how the intelligence connects the platform. The first black
 * moment, and the page's answer to "what actually happens when I ask?".
 *
 * WHY THERE IS NO INPUT HERE
 *
 * The hero already carries the console. Repeating it two regions later would
 * put the same control on the page twice, which teaches a visitor nothing
 * and makes the page feel padded. The hero is where you ASK; this is where
 * you see WHAT IT REACHES.
 *
 * The middle band is the whole point: one question fans out across every
 * capability Homatch actually has and comes back as one grounded answer.
 * That is the product claim in a single diagram — and it replaces the
 * previous pass's separate five-step "how it works" strip, which was saying
 * much the same thing a second time.
 */
export function AISection() {
  const { session } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  /* Every node here is a capability that exists in the product today. */
  const reach = [
    { key: 'client', icon: UserSearch, label: t('mp_match_title') },
    { key: 'property', icon: Search, label: t('mp_find_title') },
    { key: 'verify', icon: ShieldCheck, label: t('mp_verify_capability_title') },
    { key: 'mortgage', icon: Calculator, label: t('mp_mortgage_title') },
    { key: 'calls', icon: PhoneCall, label: t('call_center_title') },
    { key: 'email', icon: Mail, label: t('mp_email_title') },
    { key: 'developers', icon: Building2, label: t('mp_dev_eyebrow') },
  ];

  return (
    <section id="how" className="relative scroll-mt-24 overflow-hidden bg-primary text-primary-foreground">
      {/* One warm bloom so the black is not flat. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(64rem 34rem at 50% -12%, hsl(36 38% 56% / 0.13), transparent 68%)' }}
        aria-hidden="true"
      />

      <div className={`${PAGE} relative py-20 sm:py-24 lg:py-28`}>
        <div className="mx-auto max-w-[46rem] text-center">
          <div className="flex justify-center">
            <Eyebrow tone="light">{t('mp_flow_eyebrow')}</Eyebrow>
          </div>
          <h2
            className="mt-5 text-balance font-semibold leading-[1.1] tracking-[-0.02em] text-white"
            style={{ fontSize: 'clamp(1.75rem, 3.1vw, 2.9rem)' }}
          >
            {t('mp_flow_title')}
          </h2>
          <p className="mx-auto mt-5 max-w-[38rem] text-pretty text-[15px] leading-[1.75] text-white/65 sm:text-base">
            {t('mp_flow_sub')}
          </p>
        </div>

        {/* ── The flow ─────────────────────────────────────────────
            Three beats stacked on mobile, three columns from lg, joined by a
            single gold hairline rather than by arrows. */}
        <div className="relative mt-16 grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)_minmax(0,0.85fr)] lg:items-start lg:gap-10">
          <span
            className="pointer-events-none absolute inset-x-0 top-[1.6rem] hidden h-px bg-gradient-to-r from-transparent via-gold/35 to-transparent lg:block"
            aria-hidden="true"
          />

          <FlowStep step="01" title={t('mp_flow_1')} desc={t('mp_flow_1_desc')} />

          {/* Homatch AI, and everything it reaches. */}
          <div className="relative">
            <div className="mx-auto flex max-w-[26rem] flex-col items-center text-center">
              <span
                className="grid h-[3.25rem] w-[3.25rem] place-items-center rounded-full border border-gold/40 bg-white/[0.05] text-gold"
                aria-hidden="true"
              >
                <Sparkles className="h-5 w-5" strokeWidth={1.5} />
              </span>
              <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">{t('ai_title')}</p>
              <p className="mt-3 text-pretty text-sm leading-relaxed text-white/65">{t('mp_flow_2_desc')}</p>
            </div>

            <ul className="mt-8 flex flex-wrap justify-center gap-2">
              {reach.map(item => (
                <li
                  key={item.key}
                  className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3.5 py-2 text-xs text-white/80"
                >
                  <item.icon className="h-[15px] w-[15px] shrink-0 text-gold" strokeWidth={1.5} aria-hidden="true" />
                  {item.label}
                </li>
              ))}
            </ul>
          </div>

          <FlowStep step="02" title={t('mp_flow_5')} desc={t('mp_flow_5_desc')} align="end" />
        </div>

        <div className="mt-14 flex justify-center">
          <ArrowLink
            tone="light"
            label={t('mp_flow_cta')}
            onClick={() => navigate(session ? '/ai' : '/auth/signup')}
          />
        </div>
      </div>
    </section>
  );
}

function FlowStep({ step, title, desc, align = 'start' }: {
  step: string; title: string; desc: string; align?: 'start' | 'end';
}) {
  return (
    <div className={`flex flex-col ${align === 'end' ? 'lg:items-end lg:text-end' : ''}`}>
      <span
        className="grid h-[3.25rem] w-[3.25rem] place-items-center rounded-full border border-white/15 text-[11px] font-semibold tracking-[0.16em] text-white/55"
        aria-hidden="true"
      >
        {step}
      </span>
      <h3 className="mt-5 text-balance text-lg font-semibold leading-snug text-white">{title}</h3>
      <p className="mt-2.5 max-w-[20rem] text-pretty text-sm leading-relaxed text-white/60">{desc}</p>
    </div>
  );
}
