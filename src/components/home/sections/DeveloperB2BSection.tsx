import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Building, Handshake, Users } from 'lucide-react';
import { PAGE, SECTION_Y } from './primitives';
import { useSectionField, useFieldProps } from '@/site/content';
import type { TranslationKey } from '@/i18n/translations';

/**
 * REGION — for professionals: brokers, developers, partners.
 *
 * The section type is still `developers` (its stored identity in Site
 * Studio), but it no longer argues for one audience with a six-stage
 * pipeline diagram. Three kinds of professional use Homatch, each has a real
 * public page, and each card says in one sentence what that page is for.
 *
 * Brokers is the directory of brokers and agencies with an ACTIVE, PAID
 * Homatch listing — the page itself (BrokersPage) is another workstream's;
 * this only links to it, in words that match what it states.
 */
const CARDS: {
  key: 'brokers' | 'developers' | 'partners';
  to: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: TranslationKey;
  body: TranslationKey;
  cta: TranslationKey;
}[] = [
  { key: 'brokers', to: '/brokers', icon: Users, title: 'pub_nav_brokers', body: 'pub_pro_brokers_d', cta: 'pub_pro_brokers_cta' },
  { key: 'developers', to: '/developers', icon: Building, title: 'mp_nav_developers', body: 'pub_pro_developers_d', cta: 'pub_pro_developers_cta' },
  { key: 'partners', to: '/partners', icon: Handshake, title: 'home_nav_partners', body: 'pub_pro_partners_d', cta: 'pub_pro_partners_cta' },
];

export function DeveloperB2BSection() {
  const sf = useSectionField();
  const fp = useFieldProps();

  return (
    <section id="professionals" className={`${PAGE} scroll-mt-24 ${SECTION_Y}`}>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <div className="max-w-[34rem]">
          <p className="hm-pub-eyebrow" {...fp('eyebrow')}>{sf('eyebrow', 'nav_professional')}</p>
          <h2 className="hm-pub-h2 mt-4 text-foreground" {...fp('title')}>{sf('title', 'pub_pro_title')}</h2>
          <p className="hm-pub-lead mt-4" {...fp('body')}>{sf('body', 'pub_pro_body')}</p>
        </div>

        <ul className="grid gap-3">
          {CARDS.map(card => (
            <li key={card.key}>
              <Link
                to={card.to}
                className="hm-pub-card bg-card hm-pub-card--link group flex items-start gap-4 p-5 sm:items-center sm:p-6"
              >
                <span className="hm-pub-icon" aria-hidden="true"><card.icon className="h-5 w-5" strokeWidth={1.8} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-semibold text-foreground" {...fp(`${card.key}_t`)}>
                    {sf(`${card.key}_t`, card.title)}
                  </span>
                  <span className="mt-1 block text-pretty text-[15px] leading-relaxed text-ink-soft" {...fp(`${card.key}_d`)}>
                    {sf(`${card.key}_d`, card.body)}
                  </span>
                  <span className="mt-3 inline-flex items-center gap-1.5 text-[14.5px] font-semibold text-foreground group-hover:text-gold-ink sm:hidden">
                    <span {...fp(`${card.key}_cta`)}>{sf(`${card.key}_cta`, card.cta)}</span>
                    <ArrowRight className="hm-pub-arrow" strokeWidth={2} aria-hidden="true" />
                  </span>
                </span>
                <span className="hidden shrink-0 items-center gap-1.5 text-[14.5px] font-semibold text-foreground group-hover:text-gold-ink sm:inline-flex" aria-hidden="true">
                  {sf(`${card.key}_cta`, card.cta)}
                  <ArrowRight className="hm-pub-arrow" strokeWidth={2} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
