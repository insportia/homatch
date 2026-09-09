import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { PAGE, SECTION_Y, SectionIntro } from './primitives';

/**
 * REGION 05 — capabilities, with a hierarchy.
 *
 * Four equal white cards with four equal icons say that four things matter
 * equally, which is false: matching is the engine and the other three are
 * what it feeds. So this is one dominant block with its own figure, and
 * three supporting entries as hairline rows.
 *
 * The figure is drawn from the same vocabulary as the architectural scenes —
 * warm ink on stone, no chart junk — and shows the one thing worth showing
 * about matching: two sides converging on a ranked result.
 */

function MatchingFigure() {
  const { t } = useLanguage();
  return (
    <svg
      viewBox="0 0 520 300"
      className="h-auto w-full"
      role="img"
      aria-label={t('mp_cap_matching_title')}
    >
      <defs>
        <linearGradient id="mf-rail" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="hsl(var(--border))" stopOpacity="0.2" />
          <stop offset="50%" stopColor="hsl(var(--gold))" stopOpacity="0.75" />
          <stop offset="100%" stopColor="hsl(var(--border))" stopOpacity="0.2" />
        </linearGradient>
        <radialGradient id="mf-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="hsl(var(--gold))" stopOpacity="0.22" />
          <stop offset="100%" stopColor="hsl(var(--gold))" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Two sides converging */}
      <g stroke="hsl(var(--border))" fill="none" strokeWidth="1.25">
        <path d="M40 62 C170 62 190 140 258 150" />
        <path d="M40 110 C160 110 195 142 258 150" />
        <path d="M40 190 C160 190 195 158 258 150" />
        <path d="M40 238 C170 238 190 160 258 150" />
      </g>
      <g stroke="hsl(var(--gold))" strokeOpacity="0.55" fill="none" strokeWidth="1.5">
        <path d="M262 150 C330 140 360 96 470 96" />
        <path d="M262 150 C330 150 360 150 470 150" />
        <path d="M262 150 C330 160 360 204 470 204" />
      </g>

      {/* Source nodes */}
      <g>
        {[62, 110, 190, 238].map(y => (
          <g key={y}>
            <circle cx="40" cy={y} r="5" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="1.25" />
            <rect x="-4" y={y - 4} width="22" height="8" rx="4" fill="hsl(var(--sand))" />
          </g>
        ))}
      </g>

      {/* The engine */}
      <circle cx="260" cy="150" r="64" fill="url(#mf-glow)" />
      <circle cx="260" cy="150" r="26" fill="hsl(var(--primary))" />
      <circle cx="260" cy="150" r="38" fill="none" stroke="hsl(var(--gold))" strokeOpacity="0.45" strokeWidth="1" />
      <circle cx="260" cy="150" r="52" fill="none" stroke="hsl(var(--gold))" strokeOpacity="0.18" strokeWidth="1" />

      {/* Ranked results, descending weight */}
      <g>
        {[
          { y: 96, w: 46, o: 0.9 },
          { y: 150, w: 36, o: 0.62 },
          { y: 204, w: 26, o: 0.38 },
        ].map(r => (
          <g key={r.y}>
            <rect x="470" y={r.y - 9} width="18" height="18" rx="5" fill="hsl(var(--primary))" opacity={r.o} />
            <rect x="470" y={r.y + 14} width={r.w} height="4" rx="2" fill="hsl(var(--gold))" opacity={r.o * 0.7} />
          </g>
        ))}
      </g>

      <rect x="0" y="148" width="520" height="1.5" fill="url(#mf-rail)" opacity="0.5" />
    </svg>
  );
}

export function CapabilitiesSection() {
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  const points = [t('mp_cap_matching_point_1'), t('mp_cap_matching_point_2'), t('mp_cap_matching_point_3')];

  const supporting = [
    { key: 'property', title: t('mp_cap_property_title'), desc: t('mp_cap_short_property'), go: () => navigate(session ? '/ai' : '/auth/signup') },
    { key: 'verify', title: t('mp_cap_verify_title'), desc: t('mp_cap_short_verify'), go: () => navigate('/verify') },
    { key: 'mortgage', title: t('mp_cap_mortgage_title'), desc: t('mp_cap_short_mortgage'), go: () => navigate('/mortgage') },
  ];

  return (
    <section id="capabilities" className={`${PAGE} scroll-mt-24 ${SECTION_Y}`}>
      <SectionIntro eyebrow={t('mp_cap_eyebrow')} title={t('mp_cap_title')} body={t('mp_cap_sub')} />

      <div className="mt-16 grid gap-x-16 gap-y-14 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Dominant: matching */}
        <div>
          <div className="rounded-[1.5rem] bg-sand/70 p-6 sm:p-9">
            <MatchingFigure />
          </div>

          <h3
            className="mt-9 text-balance font-semibold leading-[1.16] tracking-tight text-foreground"
            style={{ fontSize: 'clamp(1.4rem, 2.1vw, 1.95rem)' }}
          >
            {t('mp_cap_matching_title')}
          </h3>
          <p className="mt-4 max-w-[36rem] text-pretty text-[15px] leading-relaxed text-ink-soft">
            {t('mp_cap_matching_desc')}
          </p>

          <ul className="mt-7 grid gap-3 sm:grid-cols-3">
            {points.map(point => (
              <li key={point} className="flex gap-2.5 text-sm leading-snug text-foreground">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        {/* Supporting: hairline rows, no cards */}
        <ul className="lg:pt-4">
          {supporting.map((item, i) => (
            <li key={item.key} className={i === 0 ? '' : 'border-t border-border'}>
              <button
                type="button"
                onClick={item.go}
                className="group flex w-full items-start gap-5 py-7 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold leading-snug text-foreground transition-colors group-hover:text-gold">
                    {item.title}
                  </span>
                  <span className="mt-2 block text-sm leading-relaxed text-ink-soft">{item.desc}</span>
                </span>
                <ArrowRight
                  className={`mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`}
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
