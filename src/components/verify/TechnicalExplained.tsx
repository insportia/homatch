// HOMATCH Verify — the building's technical facts, explained.
//
// The owner's TECHNICAL copy, then one card per structural or engineering
// fact; the MATERIALS copy, then the facade, windows, insulation and
// finishes. Each card: what the term means, what the documents establish,
// why it matters, what the documents cannot prove, and what to check. The
// text is a fixed glossary (technicalExplained.ts); the copy above each group
// says once that a design statement is not the work as built.

import React from 'react';
import { BadgeCheck, Globe2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { readTechnicalCards, MATERIAL_TOPICS, type TechnicalCard } from '@/verify/intelligence/technicalExplained';

const dmy = (iso?: string | null): string | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
};

export function hasTechnicalExplained(cards: unknown): boolean {
  return readTechnicalCards(cards).length > 0;
}

/* Each finding: what the term means, what the documents establish, why it
   matters, what the documents cannot prove, then what to check. */
const ROWS: Array<{ field: keyof Pick<TechnicalCard, 'what' | 'establishes' | 'why' | 'cannotProve' | 'verify'>; key: string }> = [
  { field: 'what', key: 'verify_v6_tech_term' },
  { field: 'establishes', key: 'verify_v6_tech_establishes' },
  { field: 'why', key: 'verify_v6_tech_why' },
  { field: 'cannotProve', key: 'verify_v6_tech_cannot' },
  { field: 'verify', key: 'verify_fn_tech_check' },
];

const Cards: React.FC<{ list: TechnicalCard[] }> = ({ list }) => {
  const { t } = useLanguage();
  return (
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
                    ? [t('verify_fn_tech_source_official'), date ? `\u2066${date}\u2069` : null].filter(Boolean).join(' · ')
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
                  <dd className={`text-sm leading-6 break-words ${row.field === 'cannotProve' ? 'text-muted-foreground' : 'text-foreground/90'}`} dir="auto">{c[row.field]}</dd>
                </div>
              ) : null))}
            </dl>
          </li>
        );
      })}
    </ul>
  );
};

const Intro: React.FC<{ id: string; title: string; body: string }> = ({ id, title, body }) => (
  <div className="space-y-2">
    <h3 id={id} className="font-display text-lg font-semibold leading-snug tracking-tight break-words">{title}</h3>
    {body.split(/\n+/).map((p, i) => (
      <p key={i} className="max-w-[68ch] text-[15px] leading-7 text-foreground/90 break-words">{p}</p>
    ))}
  </div>
);

/**
 * The approved TECHNICAL copy over the structure and engineering findings,
 * then the approved MATERIALS copy over the facade, windows, insulation and
 * finishes. Each heading shows only with findings under it.
 */
export const TechnicalExplained: React.FC<{ cards?: unknown }> = ({ cards }) => {
  const { t } = useLanguage();
  const list = React.useMemo(() => readTechnicalCards(cards), [cards]);
  if (!list.length) return null;
  const technical = list.filter((c) => !MATERIAL_TOPICS.includes(c.topic));
  const materials = list.filter((c) => MATERIAL_TOPICS.includes(c.topic));
  return (
    <div className="space-y-8" data-technical-explained>
      {technical.length ? (
        <section aria-labelledby="vrx-tech" className="space-y-4">
          <Intro id="vrx-tech" title={t('verify_v6_tech_title')} body={t('verify_v6_tech_body')} />
          <Cards list={technical} />
        </section>
      ) : null}
      {materials.length ? (
        <section aria-labelledby="vrx-materials" className="space-y-4" data-materials>
          <Intro id="vrx-materials" title={t('verify_v6_materials_title')} body={t('verify_v6_materials_body')} />
          <Cards list={materials} />
        </section>
      ) : null}
    </div>
  );
};
