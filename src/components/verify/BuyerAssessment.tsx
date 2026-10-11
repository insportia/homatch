// HOMATCH Verify — the buyer assessment, right before the final verdict.
//
// One line per area the report has evidence for (legal, history,
// construction documentation, people, neighbourhood, market), then the
// answer to "would this project reasonably deserve a buyer's confidence, and
// why?", then strengths, concerns and the checks still open. Built in
// verify-synthesis (buyerAssessment.ts): the model's text when it passes the
// guard, else assembled from verified facts. The closing line is fixed copy:
// HOMATCH gives researched evidence and a reasoned assessment; the decision
// is the buyer's.

import React from 'react';
import { Scale, ThumbsUp, AlertCircle, ListChecks } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { readBuyerAssessment } from '@/verify/intelligence/buyerAssessment';

export function hasBuyerAssessment(v: unknown): boolean {
  return readBuyerAssessment(v) !== null;
}

export const BuyerAssessment: React.FC<{ assessment?: unknown; clean?: (s: string) => string }> = ({ assessment, clean }) => {
  const { t } = useLanguage();
  const a = React.useMemo(() => readBuyerAssessment(assessment), [assessment]);
  if (!a) return null;
  const c = clean ?? ((s: string) => s);
  const lists: Array<{ key: string; items: string[]; Icon: React.ComponentType<{ className?: string }>; tone: string }> = [
    { key: 'verify_fn_assess_strengths', items: a.strengths, Icon: ThumbsUp, tone: 'text-emerald-700' },
    { key: 'verify_fn_assess_concerns', items: a.concerns, Icon: AlertCircle, tone: 'text-amber-600' },
    { key: 'verify_fn_assess_checks', items: a.checks, Icon: ListChecks, tone: 'text-[hsl(var(--gold-ink))]' },
  ];
  return (
    <section aria-labelledby="vrx-assess" className="space-y-5 rounded-2xl border border-[hsl(var(--gold-border))] bg-card p-5 sm:p-6" data-buyer-assessment={a.source}>
      <div className="space-y-1">
        <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--gold-ink))]">{t('verify_fn_assess_kicker')}</p>
        <h3 id="vrx-assess" className="flex items-center gap-2 font-display text-xl font-semibold leading-snug tracking-tight break-words">
          <Scale className="h-5 w-5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
          {t('verify_fn_assess_title')}
        </h3>
      </div>

      {a.synthesis.length ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {a.synthesis.map((s) => (
            <div key={s.area} className="min-w-0 border-s-2 border-[hsl(var(--gold-border))] ps-3">
              <dt className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t(`verify_fn_assess_area_${s.area.toLowerCase()}`)}</dt>
              <dd className="text-sm leading-6 text-foreground/90 break-words" dir="auto">{c(s.text)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm font-semibold break-words">{t('verify_fn_assess_question')}</p>
        {c(a.narrative).split(/\n{2,}/).map((p, i) => (
          <p key={i} className="text-[15px] leading-7 text-foreground break-words" dir="auto">{p}</p>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {lists.filter((l) => l.items.length).map(({ key, items, Icon, tone }) => (
          <div key={key} className="min-w-0 space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold break-words">
              <Icon className={`h-4 w-4 shrink-0 ${tone}`} aria-hidden="true" />
              {t(key)}
            </p>
            <ul className="space-y-1.5">
              {items.map((x, i) => (
                <li key={i} className="text-sm leading-6 text-foreground/85 break-words" dir="auto">{c(x)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="border-t border-border pt-3 text-sm leading-6 text-muted-foreground break-words">{t('verify_fn_assess_closing')}</p>
    </section>
  );
};
