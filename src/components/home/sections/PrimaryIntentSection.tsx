import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Eyebrow, PAGE, SECTION_Y } from './primitives';

/**
 * REGION 03 — the two doors.
 *
 * The strongest thing Homatch does is run matching in both directions, so it
 * gets the first thing after the hero and it is not competing with six other
 * features for attention.
 *
 * Deliberately NOT two cards. It is one surface split by a single hairline,
 * with the whole half acting as the control — which is why the numerals and
 * the generous internal padding do the work that a border would otherwise do.
 */
export function PrimaryIntentSection() {
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  const doors = [
    {
      key: 'client',
      index: '01',
      title: t('mp_cap_client_title'),
      desc: t('mp_cap_client_desc'),
      cta: t('mp_cap_client_cta'),
      go: () => navigate(session ? '/property/add' : '/auth/signup'),
    },
    {
      key: 'property',
      index: '02',
      title: t('mp_cap_property_title'),
      desc: t('mp_cap_property_desc'),
      cta: t('mp_cap_property_cta'),
      go: () => navigate(session ? '/ai' : '/auth/signup'),
    },
  ];

  return (
    <section className={`${PAGE} ${SECTION_Y}`}>
      <div className="max-w-[46rem]">
        <Eyebrow>{t('mp_intent_eyebrow')}</Eyebrow>
        <p
          className="mt-4 text-balance font-semibold leading-[1.15] tracking-tight text-foreground"
          style={{ fontSize: 'clamp(1.6rem, 2.7vw, 2.5rem)' }}
        >
          {t('mp_intent_lead')}
        </p>
      </div>

      <div className="mt-14 grid border-t border-border md:grid-cols-2">
        {doors.map((door, i) => (
          <button
            key={door.key}
            type="button"
            onClick={door.go}
            className={`group relative flex flex-col items-start border-b border-border py-10 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:py-14 ${
              i === 0 ? 'md:pe-12 lg:pe-20' : 'md:border-s md:border-s-border md:ps-12 lg:ps-20'
            }`}
          >
            <span className="text-xs font-semibold tracking-[0.24em] text-gold">{door.index}</span>

            <h3
              className="mt-6 text-balance font-semibold leading-[1.15] tracking-tight text-foreground"
              style={{ fontSize: 'clamp(1.35rem, 2vw, 1.85rem)' }}
            >
              {door.title}
            </h3>

            <p className="mt-4 max-w-[30rem] text-pretty text-[15px] leading-relaxed text-ink-soft">{door.desc}</p>

            <span className="mt-8 inline-flex items-center gap-2.5 text-sm font-medium text-foreground transition-colors group-hover:text-gold">
              {door.cta}
              <ArrowRight
                className={`h-4 w-4 transition-transform group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`}
                aria-hidden="true"
              />
            </span>

            {/* The hover cue is a gold rule that draws in along the bottom of
                the module, not a shadow lift — quieter, and it keeps the two
                halves reading as one surface. */}
            <span
              className="pointer-events-none absolute bottom-[-1px] start-0 h-px w-0 bg-gold transition-[width] duration-500 group-hover:w-full motion-reduce:transition-none"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </section>
  );
}
