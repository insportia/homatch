// HOMATCH Verify — the final conclusion, right before the bottom line.
//
// "საბოლოოდ, რას ვფიქრობთ ამ ქონებაზე?": the owner-approved copy with its
// bracketed parts replaced by verified specifics (strengths, concerns with
// their practical significance, a positive / balanced / cautious stance),
// then the checks still open and the approved closing paragraph. Built in
// verify-synthesis (buyerAssessment.ts): the model's lists when they pass the
// guard, else assembled from verified facts.

import React from 'react';
import { Scale, ThumbsUp, AlertCircle, ListChecks } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { readBuyerAssessment } from '@/verify/intelligence/buyerAssessment';

export function hasBuyerAssessment(v: unknown): boolean {
  return readBuyerAssessment(v) !== null;
}

const STANCE_TONE = {
  POSITIVE: 'border-emerald-700/40 bg-emerald-50/50 dark:bg-emerald-950/20',
  BALANCED: 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft)/0.45)]',
  CAUTIOUS: 'border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20',
} as const;

/**
 * THE FINAL CONCLUSION (owner, 2026-10-11). The approved copy, with its three
 * bracketed parts replaced by verified specifics (buyerAssessment.ts
 * finalConclusion): what the documents establish in this project's favour,
 * the concerns with their practical significance, and whether the evidence
 * supports a positive, balanced or cautious assessment. Then the checks the
 * buyer can do, and the approved closing paragraph. Never a placeholder,
 * never a purchase recommendation, never a percentage.
 */
/* `kind`: the registry kind (kindGuard.copyKindOf); the apartment copy is unchanged without it. */
export const BuyerAssessment: React.FC<{ assessment?: unknown; clean?: (s: string) => string; kind?: string }> = ({ assessment, clean, kind }) => {
  const { t } = useLanguage();
  const a = React.useMemo(() => readBuyerAssessment(assessment, kind ?? 'APARTMENT'), [assessment, kind]);
  if (!a) return null;
  const c = clean ?? ((s: string) => s);
  const k = a.conclusion;
  return (
    <section aria-labelledby="vrx-assess" className="space-y-5 rounded-2xl border border-[hsl(var(--gold-border))] bg-card p-5 sm:p-6" data-buyer-assessment={a.source} data-stance={k?.stance ?? null}>
      <h3 id="vrx-assess" className="flex items-center gap-2 font-display text-xl font-semibold leading-snug tracking-tight break-words">
        <Scale className="h-5 w-5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
        {t('verify_v6s_final_title')}
      </h3>
      {t('verify_v6s_final_lede').split(/\n+/).map((p, i) => (
        <p key={i} className="max-w-[68ch] text-[15px] leading-7 text-foreground/90 break-words">{p}</p>
      ))}

      {k?.strengths ? (
        <div className="space-y-1.5" data-conclusion-strengths>
          <p className="flex items-center gap-1.5 text-sm font-semibold break-words">
            <ThumbsUp className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
            {t('verify_v6s_final_strengths')}
          </p>
          <p className="text-[15px] leading-7 text-foreground break-words" dir="auto">{c(k.strengths)}</p>
        </div>
      ) : null}

      {k?.concerns.length ? (
        <div className="space-y-1.5" data-conclusion-concerns>
          <p className="flex items-center gap-1.5 text-sm font-semibold break-words">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            {t('verify_v6s_final_concerns')}
          </p>
          <ul className="space-y-1.5">
            {k.concerns.map((x, i) => (
              <li key={i} className="border-s-2 border-amber-400/70 ps-3 text-[15px] leading-7 text-foreground/90 break-words" dir="auto">{c(x)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {k ? (
        <div className={`rounded-xl border p-4 ${STANCE_TONE[k.stance]}`} data-conclusion-stance={k.stance}>
          <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t(`verify_v6s_stance_${k.stance.toLowerCase()}`)}</p>
          <p className="mt-1 text-[15px] leading-7 text-foreground break-words" dir="auto">{c(k.stanceText)}</p>
        </div>
      ) : null}

      {a.checks.length ? (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold break-words">
            <ListChecks className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
            {t('verify_fn_assess_checks')}
          </p>
          <ul className="space-y-1.5">
            {a.checks.map((x, i) => (
              <li key={i} className="text-sm leading-6 text-foreground/85 break-words" dir="auto">{c(x)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="border-t border-border pt-3 text-[15px] leading-7 text-foreground/85 break-words">{t('verify_v6s_final_closing')}</p>
    </section>
  );
};
