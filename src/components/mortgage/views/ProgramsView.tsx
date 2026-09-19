// HOMATCH HOME FINANCING — government programmes, with their paperwork
// attached.
//
// WHAT CHANGED FROM THE OLD CARD
//
// It printed a title and one paragraph — and because the paragraph was
// stored as an i18n key that had never been added to any bundle, what
// it actually printed was the string "mortgage_kb_subsidy_human_
// explanation". Everything else the knowledge base holds about the
// programme — the ceiling, the duration, the rate formula, six
// eligibility conditions, the decree, the source URL, when a human last
// checked it — was loaded on every page view and thrown away.
//
// THE LINE THIS VIEW WILL NOT CROSS
//
// "Likely match based on what you entered" is as strong as it gets.
// Eligibility is established by the programme's administrator against
// documents, and the distance between those two sentences is the
// difference between a useful tool and a false promise. The verdict
// wording, the colour and the disclaimer all carry it.

import React from 'react';
import { CheckCircle2, CircleHelp, ExternalLink, XCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Module, formatMoney, formatPercent, intlLocaleFor } from '@/components/workspace/primitives';
import { SourceBadge, YesNoField, ChipField } from '@/components/workspace/controls';
import { StatRow } from '../fields';
import {
  computeSubsidyBenefit,
  parseSubsidyFormula,
  type ReferenceRateRuleData,
  type SubsidyAnswers,
  type SubsidyMatch,
  type SubsidyVerdict,
} from '@/mortgage/rules/subsidy';
import type { MortgageRule, SubsidyProgramRuleData } from '@/mortgage/types';

const VERDICT: Record<SubsidyVerdict, { icon: typeof CheckCircle2; labelKey: string; tone: string }> = {
  LIKELY_MATCH: {
    icon: CheckCircle2,
    labelKey: 'mortgage_subsidy_verdict_likely',
    tone: 'border-[hsl(var(--success)/0.45)] bg-[hsl(var(--success)/0.08)] text-[hsl(var(--success))]',
  },
  NOT_A_MATCH: {
    icon: XCircle,
    labelKey: 'mortgage_subsidy_verdict_no',
    tone: 'border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.06)] text-[hsl(var(--destructive))]',
  },
  CANNOT_DETERMINE: {
    icon: CircleHelp,
    labelKey: 'mortgage_subsidy_verdict_unknown',
    tone: 'border-border bg-[hsl(var(--secondary))] text-muted-foreground',
  },
};

export function ProgramsView({
  programs,
  matches,
  answers,
  onAnswer,
  referenceRate,
  nominalRatePercent,
  currency,
}: {
  programs: MortgageRule<SubsidyProgramRuleData>[];
  matches: SubsidyMatch[];
  answers: SubsidyAnswers;
  onAnswer: (questionId: string, answer: boolean | number | undefined) => void;
  referenceRate: MortgageRule<ReferenceRateRuleData> | null;
  nominalRatePercent: number | null;
  currency: string;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);

  if (!programs.length) {
    return (
      <Module
        id="programs-empty"
        eyebrowKey="mortgage_mod_programs_eyebrow"
        titleKey="mortgage_mod_programs_title"
        subtitleKey="mortgage_mod_programs_sub"
      >
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t('mortgage_programs_none')}
        </p>
      </Module>
    );
  }

  return (
    <>
      {programs.map((rule, index) => {
        const match = matches[index];
        const data = rule.data;
        const verdict = match ? VERDICT[match.verdict] : VERDICT.CANNOT_DETERMINE;
        const VerdictIcon = verdict.icon;

        const childCount = answers.three_plus_children;
        const formulaKey =
          typeof childCount === 'number' && childCount >= 3 ? 'threeOrMoreChildren' : 'oneToTwoChildren';
        const benefit = computeSubsidyBenefit({
          formula: parseSubsidyFormula(data.subsidyRateFormula?.[formulaKey]),
          referenceRatePercent: referenceRate?.data.ratePercent ?? null,
          nominalAnnualRatePercent: nominalRatePercent,
          durationMonths: data.durationMonths,
        });

        return (
          <Module
            key={rule.id}
            id={`program-${rule.id}`}
            eyebrowKey="mortgage_mod_programs_eyebrow"
            titleKey="mortgage_mod_programs_title"
            subtitleKey="mortgage_mod_programs_sub"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="min-w-0 font-display text-lg font-semibold leading-tight text-foreground">
                {rule.title}
              </h3>
              <SourceBadge source="OFFICIAL" />
            </div>

            <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-muted-foreground">
              {t(rule.humanExplanation)}
            </p>

            {/* ── What the programme is ── */}
            <div className="mt-5">
              <StatRow
                labelKey="mortgage_subsidy_max_loan"
                value={data.maxLoanAmount}
                kind="money"
                currency={data.currency || currency}
              />
              <StatRow labelKey="mortgage_subsidy_duration" value={data.durationMonths} kind="months" />
            </div>

            {/* ── What it is worth, at today's reference rate ── */}
            {benefit ? (
              <div className="mt-5 rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] p-4">
                <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--gold-ink))]">
                  {t('mortgage_subsidy_worth_title')}
                </p>
                <p className="mt-2 font-display text-2xl font-semibold leading-none text-[hsl(var(--gold-ink))]">
                  −{formatPercent(benefit.reductionPoints, locale, 2)}
                </p>
                <p className="mt-2 max-w-[56ch] text-2xs leading-relaxed text-[hsl(var(--gold-ink))]">
                  {t('mortgage_subsidy_worth_note', {
                    reference: formatPercent(referenceRate?.data.ratePercent ?? 0, locale, 2),
                    months: benefit.months ?? 0,
                  })}
                  {benefit.capApplied ? ` ${t('mortgage_subsidy_cap_applied')}` : ''}
                </p>
                {benefit.effectiveBorrowerRatePercent !== null ? (
                  <p className="mt-2 text-sm text-[hsl(var(--gold-ink))]">
                    {t('mortgage_subsidy_your_rate', {
                      rate: formatPercent(benefit.effectiveBorrowerRatePercent, locale, 2),
                    })}
                  </p>
                ) : null}
                {referenceRate ? (
                  <p className="mt-2 text-2xs text-[hsl(var(--gold-ink))] opacity-80">
                    {referenceRate.sourceAuthority} ·{' '}
                    {t('mortgage_verified_on', { date: referenceRate.lastVerifiedAt })}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-5 rounded-lg border border-dashed border-border px-4 py-3 text-2xs leading-relaxed text-muted-foreground">
                {t('mortgage_subsidy_worth_unavailable')}
              </p>
            )}

            {/* ── The questions ── */}
            <h4 className="mt-7 font-display text-base font-semibold text-foreground">
              {t('mortgage_subsidy_check_title')}
            </h4>
            <p className="mt-1 max-w-[60ch] text-2xs leading-relaxed text-muted-foreground">
              {t('mortgage_subsidy_check_sub')}
            </p>

            <div className="mt-4 space-y-5">
              {data.eligibilityCriteria.map((criterion) => {
                const question = criterion.question;
                const outcome = match?.outcomes.find((o) => o.criterion.key === criterion.key);
                return (
                  <div key={criterion.key}>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {t(question?.promptKey ?? criterion.description)}
                      </span>
                      {criterion.mandatory ? (
                        <span className="text-2xs text-muted-foreground">{t('mortgage_required')}</span>
                      ) : null}
                      {outcome?.satisfied === true ? (
                        <CheckCircle2
                          className="h-4 w-4 text-[hsl(var(--success))]"
                          aria-label={t('mortgage_subsidy_condition_met')}
                        />
                      ) : null}
                    </div>
                    <p className="mb-2.5 max-w-[60ch] text-2xs leading-relaxed text-muted-foreground">
                      {t(criterion.description)}
                    </p>
                    {!question ? (
                      <p className="text-2xs italic text-muted-foreground">
                        {t('mortgage_subsidy_not_checkable')}
                      </p>
                    ) : question.type === 'YES_NO' ? (
                      <YesNoField
                        value={
                          typeof answers[question.id] === 'boolean'
                            ? answers[question.id]
                              ? 'YES'
                              : 'NO'
                            : undefined
                        }
                        onChange={(v) => onAnswer(question.id, v === null ? undefined : v === 'YES')}
                      />
                    ) : (
                      <ChipField
                        presets={[0, 1, 2, 3, 4].map((value) => ({ value, kind: 'USER' as const }))}
                        value={typeof answers[question.id] === 'number' ? (answers[question.id] as number) : undefined}
                        onChange={(v) => onAnswer(question.id, v ?? undefined)}
                        kind="number"
                        currency={currency}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── The verdict ── */}
            {match ? (
              <div className={cn('mt-6 rounded-xl border px-4 py-3.5', verdict.tone)}>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <VerdictIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {t(verdict.labelKey)}
                </p>
                {match.reasons.length ? (
                  <ul className="mt-2 space-y-0.5">
                    {match.reasons.map((key) => (
                      <li key={key} className="text-2xs leading-relaxed">
                        {t(key)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <p className="mt-4 max-w-[64ch] rounded-lg border border-dashed border-border px-4 py-3 text-2xs leading-relaxed text-muted-foreground">
              {t('mortgage_subsidy_disclaimer')}
            </p>

            {/* ── Provenance ── */}
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
              <span>{data.administrator}</span>
              <span aria-hidden="true">·</span>
              <span>{t('mortgage_verified_on', { date: rule.lastVerifiedAt })}</span>
              {rule.effectiveFrom ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{t('mortgage_in_force_since', { date: rule.effectiveFrom })}</span>
                </>
              ) : null}
              {/* A 19px line of small print is a link a thumb cannot hit.
                  The negative margin keeps the 44px target from pushing the
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
            </div>
          </Module>
        );
      })}
    </>
  );
}
