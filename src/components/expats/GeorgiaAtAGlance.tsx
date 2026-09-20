// HOMATCH FOR EXPATS — Georgia, oriented rather than summarised.
//
// §9 asks for a country intelligence interface rather than a tourism
// infographic, and warns: never invent statistics. Those two pull hard
// against each other, because what makes a country panel look impressive
// is exactly the population figure, the GDP number and the "4th easiest
// place to do business" ranking that nobody has verified.
//
// So this panel carries no statistics at all. What it carries is the small
// set of things a foreigner needs in the first minute that are STRUCTURAL
// rather than numeric — the currency, the language and its alphabet, the
// cities worth considering — plus, where Homatch has actually read
// something, a link to the sourced page that says it.
//
// It is a shorter panel than a fabricated one would be. It is also the
// only kind that can be shipped without somebody eventually discovering
// that the population figure was four years old.

import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { EXPAT_CITIES } from '@/expats/geography';

/**
 * Orientation facts, chosen because they do not change and do not need a
 * source to be checked: a reader can verify every one of them by looking
 * at a banknote or a street sign on their first morning.
 */
const ORIENTATION = ['currency', 'language', 'script', 'time'] as const;

export function GeorgiaAtAGlance() {
  const { t } = useLanguage();

  return (
    <section data-expat-glance>
      <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold-ink))]">
        {t('expat_glance_eyebrow')}
      </p>
      <h2 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
        {t('expat_glance_title')}
      </h2>
      <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
        {t('expat_glance_body')}
      </p>

      <dl className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {ORIENTATION.map((k) => (
          <div key={k} className="bg-background p-5">
            <dt className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
              {t(`expat_glance_${k}_label`)}
            </dt>
            <dd className="mt-1.5 font-display text-lg font-semibold text-foreground">
              {t(`expat_glance_${k}_value`)}
            </dd>
            <dd className="mt-1 text-2xs leading-relaxed text-muted-foreground">
              {t(`expat_glance_${k}_note`)}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-6">
        <h3 className="text-sm font-medium text-foreground">{t('expat_glance_cities_title')}</h3>
        <p className="mt-1 text-2xs text-muted-foreground">{t('expat_glance_cities_note')}</p>
        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {EXPAT_CITIES.map((city) => (
            <li key={city.key}>
              <Link
                to={`/for-expats/georgia/${city.key}`}
                data-expat-city={city.key}
                className="group flex h-full flex-col rounded-xl border border-border p-4 transition-colors hover:border-[hsl(var(--gold-border))]"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-lg font-semibold text-foreground">
                    {city.nameEn}
                  </span>
                  <span className="text-2xs text-muted-foreground">{city.nameKa}</span>
                </span>
                <span className="mt-1.5 flex-1 text-2xs leading-relaxed text-muted-foreground">
                  {t(city.blurbKey)}
                </span>
                <span className="mt-3 inline-flex items-center gap-1 text-2xs text-[hsl(var(--gold-ink))]">
                  {t('expat_glance_city_open')}
                  <ArrowRight
                    className="h-3 w-3 transition-transform group-hover:translate-x-0.5 rtl:rotate-180"
                    aria-hidden="true"
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
