import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Calculator, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Icon, PAGE, SECTION_Y, SectionIntro } from './primitives';

/**
 * REGION 04 — the four intelligence capabilities, with a hierarchy.
 *
 * Nine equal cards would say nine things matter equally, which is false.
 * Matching is the engine; this region gives it the figure and the dominant
 * column, and gives Homatch AI, Homatch Verify and Mortgage Intelligence
 * substantial hairline-separated entries beside it. The professional
 * workflows (call centre, outreach, broker, developer) are one region
 * further down, at their true weight.
 *
 * The figure is drawn from the same vocabulary as the photography — warm ink
 * on warm ground, no chart junk — and shows the only thing worth showing
 * about matching: two sides converging on a ranked result.
 */

function MatchingFigure() {
  const { t } = useLanguage();
  return (
    <svg viewBox="0 0 520 290" className="h-auto w-full" role="img" aria-label={t('mp_cap_matching_title')}>
      <defs>
        <radialGradient id="mf-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="hsl(var(--gold))" stopOpacity="0.18" />
          <stop offset="100%" stopColor="hsl(var(--gold))" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Two sides converging on the engine */}
      <g stroke="hsl(var(--border))" fill="none" strokeWidth="1">
        <path d="M42 58 C172 58 192 136 258 146" />
        <path d="M42 104 C162 104 196 138 258 146" />
        <path d="M42 188 C162 188 196 154 258 146" />
        <path d="M42 234 C172 234 192 156 258 146" />
      </g>
      <g stroke="hsl(var(--gold))" strokeOpacity="0.5" fill="none" strokeWidth="1.25">
        <path d="M262 146 C330 136 360 92 470 92" />
        <path d="M262 146 C330 146 360 146 470 146" />
        <path d="M262 146 C330 156 360 200 470 200" />
      </g>

      {/* Sources */}
      {[58, 104, 188, 234].map(y => (
        <circle key={y} cx="42" cy={y} r="4" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="1.25" />
      ))}

      {/* The engine */}
      <circle cx="260" cy="146" r="60" fill="url(#mf-glow)" />
      <circle cx="260" cy="146" r="23" fill="hsl(var(--primary))" />
      <circle cx="260" cy="146" r="36" fill="none" stroke="hsl(var(--gold))" strokeOpacity="0.4" strokeWidth="1" />
      <circle cx="260" cy="146" r="50" fill="none" stroke="hsl(var(--gold))" strokeOpacity="0.16" strokeWidth="1" />

      {/* Ranked results, descending weight */}
      {[
        { y: 92, w: 44, o: 0.9 },
        { y: 146, w: 34, o: 0.58 },
        { y: 200, w: 24, o: 0.34 },
      ].map(r => (
        <g key={r.y}>
          <rect x="470" y={r.y - 8} width="16" height="16" rx="4" fill="hsl(var(--primary))" opacity={r.o} />
          <rect x="470" y={r.y + 13} width={r.w} height="3" rx="1.5" fill="hsl(var(--gold))" opacity={r.o * 0.7} />
        </g>
      ))}
    </svg>
  );
}

export function CapabilitiesSection() {
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  const points = [t('mp_cap_matching_point_1'), t('mp_cap_matching_point_2'), t('mp_cap_matching_point_3')];

  /* The three capabilities that sit beside matching. Homatch AI is first:
     it is the layer the other two are reached through. */
  const beside = [
    { key: 'ai', icon: Sparkles, title: t('ai_title'), desc: t('mp_cap_short_ai'), go: () => navigate(session ? '/ai' : '/auth/signup') },
    { key: 'verify', icon: ShieldCheck, title: t('mp_cap_verify_title'), desc: t('mp_cap_short_verify'), go: () => navigate('/verify') },
    { key: 'mortgage', icon: Calculator, title: t('mp_cap_mortgage_title'), desc: t('mp_cap_short_mortgage'), go: () => navigate('/mortgage') },
  ];

  return (
    <section id="capabilities" className={`${PAGE} scroll-mt-24 ${SECTION_Y}`}>
      <SectionIntro eyebrow={t('mp_cap_eyebrow')} title={t('mp_cap_title')} body={t('mp_cap_sub')} />

      <div className="mt-16 grid gap-x-16 gap-y-14 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* Dominant: matching intelligence */}
        <div>
          <div className="rounded-[1rem] border border-border bg-secondary/60 p-6 sm:p-9">
            <MatchingFigure />
          </div>

          <div className="mt-9 flex items-center gap-4">
            <Icon icon={Search} size="lg" />
            <h3
              className="text-balance font-semibold leading-[1.16] tracking-[-0.015em] text-foreground"
              style={{ fontSize: 'clamp(1.35rem, 2vw, 1.85rem)' }}
            >
              {t('mp_cap_matching_title')}
            </h3>
          </div>

          <p className="mt-5 max-w-[36rem] text-pretty text-[15px] leading-[1.75] text-ink-soft">
            {t('mp_cap_matching_desc')}
          </p>

          <ul className="mt-7 grid gap-x-6 gap-y-3 border-t border-border pt-6 sm:grid-cols-3">
            {points.map(point => (
              <li key={point} className="flex gap-2.5 text-sm leading-snug text-foreground">
                <span className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        {/* Beside it: hairline rows, no cards */}
        <ul className="lg:pt-4">
          {beside.map((item, i) => (
            <li key={item.key} className={i === 0 ? '' : 'border-t border-border'}>
              <button
                type="button"
                onClick={item.go}
                className="group flex w-full items-start gap-5 py-8 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon icon={item.icon} />
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold leading-snug text-foreground transition-colors group-hover:text-gold-ink">
                    {item.title}
                  </span>
                  <span className="mt-2 block text-pretty text-sm leading-relaxed text-ink-soft">{item.desc}</span>
                </span>
                <ArrowRight
                  className={`mt-3 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
