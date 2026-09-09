import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Search, UserSearch } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Eyebrow, Icon, PAGE, SECTION_Y } from './primitives';

/**
 * REGION 02 — the two doors into matching.
 *
 * Matching runs in both directions, and that is the strongest single thing
 * Homatch does, so it gets the first region after the hero rather than a
 * slot among nine features.
 *
 * Deliberately NOT two cards: one surface, one hairline between the halves,
 * and the whole half is the control. The hover cue is a gold rule drawing in
 * along the bottom — quieter than a shadow lift, and it keeps the two halves
 * reading as a single object.
 */
export function PrimaryIntentSection() {
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  const doors = [
    {
      key: 'client',
      index: '01',
      icon: UserSearch,
      title: t('mp_cap_client_title'),
      desc: t('mp_cap_client_desc'),
      cta: t('mp_cap_client_cta'),
      go: () => navigate(session ? '/property/add' : '/auth/signup'),
    },
    {
      key: 'property',
      index: '02',
      icon: Search,
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
          className="mt-5 text-balance font-semibold leading-[1.14] tracking-[-0.02em] text-foreground"
          style={{ fontSize: 'clamp(1.6rem, 2.6vw, 2.4rem)' }}
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
            <div className="flex items-center gap-4">
              <Icon icon={door.icon} />
              <span className="text-xs font-semibold tracking-[0.24em] text-gold-ink">{door.index}</span>
            </div>

            <h3
              className="mt-6 text-balance font-semibold leading-[1.16] tracking-[-0.015em] text-foreground"
              style={{ fontSize: 'clamp(1.3rem, 1.9vw, 1.75rem)' }}
            >
              {door.title}
            </h3>

            <p className="mt-4 max-w-[30rem] text-pretty text-[15px] leading-[1.75] text-ink-soft">{door.desc}</p>

            <span className="mt-8 inline-flex items-center gap-2.5 text-sm font-medium text-foreground transition-colors group-hover:text-gold-ink">
              {door.cta}
              <ArrowRight
                className={`h-4 w-4 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </span>

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
