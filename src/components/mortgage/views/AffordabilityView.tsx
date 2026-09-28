// HOMATCH HOME FINANCING — PTI and LTV, explained before they are
// measured.
//
// THE ACRONYM IS NOT THE POINT
//
// The old view printed "PTI 34.2%" with a green pill. A borrower who
// does not already know what PTI is learns nothing from that, and one
// who does still cannot see what the limit was or who set it. So each
// one leads with the sentence — "how much of your monthly income is
// already committed to debt" — and then shows three things side by
// side: the official limit, the calculated value, and the distance
// between them.
//
// AND IT NEVER SAYS YOU WILL BE APPROVED
//
// Being inside a published macroprudential limit is a necessary
// condition, not a sufficient one; the bank's own underwriting is a
// separate process with its own criteria. The engine's header says the
// same, and the disclaimer here is not decoration.

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Module, formatPercent, intlLocaleFor } from '@/components/workspace/primitives';
import { SourceBadge } from '@/components/workspace/controls';
import type {
  AffordabilityResult,
  LtvLimitRuleData,
  MortgageRule,
  PtiLimitRuleData,
} from '@/mortgage/types';

function RatioCard({
  titleKey,
  explainKey,
  acronymKey,
  leadKey,
  value,
  limit,
  within,
  rule,
  locale,
  breakdown,
}: {
  titleKey: string;
  explainKey: string;
  /** The industry's name for the same thing, said after the plain one. */
  acronymKey: string;
  /** The personalized opening sentence — THE USER'S number, in words. */
  leadKey: string;
  value: number | null;
  limit: number | null;
  within: boolean | null;
  rule: { officialSourceUrl: string; sourceAuthority: string; lastVerifiedAt: string } | null;
  locale: string;
  /** The three inputs the ratio is made of, so nobody has to hunt them. */
  breakdown?: Array<{ labelKey: string; value: number }> & { currency?: string };
}) {
  const { t } = useLanguage();

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
      <h3 className="font-display text-base font-semibold text-foreground">{t(titleKey)}</h3>
      {/* YOUR SITUATION, before any threshold: the sentence a person can
          repeat to someone else. */}
      {value !== null ? (
        <p className="mt-2 max-w-[52ch] text-[15px] font-medium leading-relaxed text-foreground">
          {t(leadKey, { p: formatPercent(value, locale, 1) })}
        </p>
      ) : null}
      <p className="mt-1.5 max-w-[48ch] text-sm leading-relaxed text-muted-foreground">{t(explainKey)}</p>
      {/* THE PLAIN SENTENCE LEADS AND THE ACRONYM FOLLOWS. A borrower
          who has never met "PTI" learns nothing from a heading that
          opens with it; one who has still recognises it here. */}
      <p className="mt-1 text-2xs text-muted-foreground">{t(acronymKey)}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('mortgage_afford_your_value')}
          </p>
          <p
            className={cn(
              'mt-1 font-display text-2xl font-semibold leading-none',
              within === false ? 'text-[hsl(var(--destructive))]' : 'text-foreground',
            )}
          >
            {value === null ? '—' : formatPercent(value, locale, 1)}
          </p>
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('mortgage_afford_official_limit')}
            </p>
            {rule ? <SourceBadge source="OFFICIAL" /> : null}
          </div>
          <p className="mt-1 font-display text-2xl font-semibold leading-none text-foreground">
            {limit === null ? t('mortgage_afford_no_rule') : formatPercent(limit, locale, 0)}
          </p>
        </div>
        <div>
          <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('mortgage_afford_difference')}
          </p>
          <p className="mt-1 font-display text-2xl font-semibold leading-none text-foreground">
            {value === null || limit === null ? '—' : `${value > limit ? '+' : '−'}${formatPercent(Math.abs(value - limit), locale, 1)}`}
          </p>
          <p className="mt-1.5 max-w-[26ch] text-2xs text-muted-foreground">
            {value === null || limit === null
              ? t('mortgage_afford_difference_unknown')
              : value > limit
                ? t('mortgage_afford_difference_over')
                : t('mortgage_afford_difference_under')}
          </p>
        </div>
      </div>

      {value !== null && limit !== null ? (
        <div className="mt-4">
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--muted))]" dir="ltr">
            <div
              className={cn(
                'h-full rounded-full',
                value > limit ? 'bg-[hsl(var(--destructive))]' : 'bg-[hsl(var(--success))]',
              )}
              style={{ width: `${Math.min(100, (value / Math.max(limit, value)) * 100)}%` }}
            />
            <div
              className="absolute top-[-3px] h-[14px] w-0.5 bg-[hsl(var(--gold))]"
              style={{ left: `${Math.min(100, (limit / Math.max(limit, value)) * 100)}%` }}
              aria-hidden="true"
            />
          </div>
          <p className="mt-1.5 text-2xs text-muted-foreground">{t('mortgage_afford_bar_note')}</p>
        </div>
      ) : null}

      {breakdown && breakdown.length ? (
        <div className="mt-4 rounded-lg border border-border px-3 py-1">
          {breakdown.map((row) => (
            <div key={row.labelKey} className="flex items-baseline justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
              <span className="text-muted-foreground">{t(row.labelKey)}</span>
              <span className="tabular-nums text-foreground" dir="ltr">
                {row.value.toLocaleString(locale)}{breakdown.currency ? ` ${breakdown.currency}` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {rule ? (
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
          <span>{rule.sourceAuthority}</span>
          <span aria-hidden="true">·</span>
          <span>{t('mortgage_verified_on', { date: rule.lastVerifiedAt })}</span>
          {/* A 19px line of small print is a link a thumb cannot hit. The
              negative margin keeps the 44px target from pushing the
              provenance line apart. */}
          <a
            href={rule.officialSourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="-my-3 inline-flex min-h-[44px] items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            {t('mortgage_official_source')}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </p>
      ) : null}
    </div>
  );
}

export function AffordabilityView({
  affordability,
  ptiRule,
  ltvRule,
  propertyPrice,
  downPayment,
  loanAmount,
  currency,
}: {
  affordability: AffordabilityResult;
  ptiRule: MortgageRule<PtiLimitRuleData> | null;
  ltvRule: MortgageRule<LtvLimitRuleData> | null;
  propertyPrice: number | null;
  downPayment: number | null;
  loanAmount: number | null;
  currency: string;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);

  return (
    <Module
      id="affordability"
      eyebrowKey="mortgage_mod_afford_eyebrow"
      titleKey="mortgage_mod_afford_title"
      subtitleKey="mortgage_mod_afford_sub"
    >
      <div className="space-y-3">
        <RatioCard
          titleKey="mortgage_afford_pti_title"
          explainKey="mortgage_afford_pti_explain"
          acronymKey="mortgage_afford_pti_acronym"
          leadKey="mortgage_afford_pti_lead"
          value={affordability.ptiPercent}
          limit={ptiRule?.data.maxPtiPercent ?? null}
          within={affordability.ptiWithinPublishedLimit}
          rule={ptiRule}
          locale={locale}
        />
        <RatioCard
          titleKey="mortgage_afford_ltv_title"
          explainKey="mortgage_afford_ltv_explain"
          acronymKey="mortgage_afford_ltv_acronym"
          leadKey="mortgage_afford_ltv_lead"
          value={affordability.ltvPercent}
          breakdown={
            propertyPrice !== null && downPayment !== null && loanAmount !== null
              ? Object.assign(
                  [
                    { labelKey: 'mortgage_label_property_price', value: propertyPrice },
                    { labelKey: 'mortgage_label_down_payment', value: downPayment },
                    { labelKey: 'mortgage_result_loan_amount', value: loanAmount },
                  ],
                  { currency },
                )
              : undefined
          }
          limit={ltvRule?.data.maxLtvPercent ?? null}
          within={affordability.ltvWithinPublishedLimit}
          rule={ltvRule}
          locale={locale}
        />
      </div>

      <p className="mt-5 max-w-[64ch] rounded-lg border border-dashed border-border px-4 py-3 text-2xs leading-relaxed text-muted-foreground">
        {t('mortgage_affordability_disclaimer')}
      </p>
    </Module>
  );
}
