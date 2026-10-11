// HOMATCH Verify — the building's technical facts, explained.
//
// One card per major technical fact (structure, foundation, seismic design,
// facade, windows, insulation, energy, engineering systems, lifts, finishes),
// each answering: what it is, why it matters, what it means for the buyer,
// and what to check. The text is a fixed glossary (technicalExplained.ts),
// built server-side into report.technicalExplained. The note that these are
// design statements, not guarantees, is said ONCE, above the cards.

import React from 'react';
import { BadgeCheck, Globe2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { readTechnicalCards, type TechnicalCard } from '@/verify/intelligence/technicalExplained';

const dmy = (iso?: string | null): string | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
};

export function hasTechnicalExplained(cards: unknown): boolean {
  return readTechnicalCards(cards).length > 0;
}

const ROWS: Array<{ field: keyof Pick<TechnicalCard, 'what' | 'why' | 'buyerMeaning' | 'verify'>; key: string }> = [
  { field: 'what', key: 'verify_fn_tech_what' },
  { field: 'why', key: 'verify_fn_tech_why' },
  { field: 'buyerMeaning', key: 'verify_fn_tech_buyer' },
  { field: 'verify', key: 'verify_fn_tech_check' },
];

export const TechnicalExplained: React.FC<{ cards?: unknown }> = ({ cards }) => {
  const { t } = useLanguage();
  const list = React.useMemo(() => readTechnicalCards(cards), [cards]);
  if (!list.length) return null;
  return (
    <section aria-labelledby="vrx-tech" className="space-y-4" data-technical-explained>
      <div className="space-y-1.5">
        <h3 id="vrx-tech" className="font-display text-lg font-semibold leading-snug tracking-tight break-words">{t('verify_fn_tech_title')}</h3>
        <p className="max-w-[62ch] text-sm leading-6 text-muted-foreground break-words">{t('verify_fn_tech_note')}</p>
      </div>
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {list.map((c) => {
          const date = dmy(c.date);
          return (
            <li key={c.topic} className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5" data-tech-topic={c.topic}>
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                <h4 className="min-w-0 text-sm font-semibold leading-5 break-words">{c.title}</h4>
                <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-foreground/80">
                  {c.source === 'OFFICIAL'
                    ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
                    : <Globe2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                  <span className="break-words">
                    {c.source === 'OFFICIAL'
                      ? [t('verify_fn_tech_source_official'), c.caseRef ? `⁦${c.caseRef}⁩` : null, date ? `⁦${date}⁩` : null].filter(Boolean).join(' · ')
                      : t('verify_fn_tech_source_public')}
                  </span>
                </span>
              </div>
              {c.stated ? (
                <p className="mt-2 border-s-2 border-[hsl(var(--gold-border))] ps-3 text-sm leading-6 text-foreground/85 break-words" dir="auto">{c.stated}</p>
              ) : null}
              <dl className="mt-3 space-y-2.5">
                {ROWS.map((row) => (c[row.field] ? (
                  <div key={row.field} className="space-y-0.5">
                    <dt className="text-2xs font-semibold uppercase tracking-[0.06em] text-[hsl(var(--gold-ink))]">{t(row.key)}</dt>
                    <dd className="text-sm leading-6 text-foreground/90 break-words" dir="auto">{c[row.field]}</dd>
                  </div>
                ) : null))}
              </dl>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
