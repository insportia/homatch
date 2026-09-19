// HOMATCH HOME FINANCING — the state subsidy, in the order a person
// needs it.
//
//   1  what the programme does, before a single question
//   2  four plain facts: how long, which loans, how much, what it pays
//   3  what it is worth ON THIS SCENARIO, as a rate they recognise
//   4  the questions
//   5  a result with reasons and something to do next
//
// WHAT IT USED TO DO, AND WHY EACH PART OF THAT WAS A PROBLEM
//
//   It printed the knowledge-base row's `title`, which is English prose
//   with a decree number in brackets, on a Georgian page. The row now
//   carries a translation key instead and the English title stays in
//   the database where the administrators read it.
//
//   It led with "−4.75%". That is a figure out of a decree, set large,
//   with nothing saying what it does to the money somebody pays. It is
//   still here, one line down, under a sentence that says a 13% rate
//   comes out at about 8.25% for five years — which is the only form of
//   it anybody can act on.
//
//   It asked six questions and then said "does not match the published
//   conditions", full stop. A person who answers six questions is owed
//   the reason, and where the reason is theirs to change — a currency,
//   an amount — they are owed the next step too.
//
// THE LINE THIS VIEW STILL WILL NOT CROSS
//
// "Your details match the main conditions" is as strong as it gets.
// Eligibility is established by the programme's administrator against
// documents. The verdict wording, the colour and the disclaimer all
// carry that, and the rule engine cannot produce anything stronger.

import React from 'react';
import { CheckCircle2, CircleHelp, ExternalLink, XCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Module, formatMoney, formatPercent, intlLocaleFor } from '@/components/workspace/primitives';
import { SourceBadge, YesNoField, ChipField } from '@/components/workspace/controls';
import { AskHomatch } from '../askConsultant';
import {
  computeSubsidyBenefit,
  criterionRole,
  parseSubsidyFormula,
  type ReferenceRateRuleData,
  type SubsidyAnswers,
  type SubsidyMatch,
  type SubsidyReason,
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

function Fact({ labelKey, value }: { labelKey: string; value: string }) {
  const { t } = useLanguage();
  return (
    <div className="min-w-0">
      <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">{t(labelKey)}</p>
      <p className="mt-1 text-sm font-medium leading-snug text-foreground">{value}</p>
    </div>
  );
}

export function ProgramsView({
  programs,
  matches,
  answers,
  onAnswer,
  referenceRate,
  nominalRatePercent,
  currency,
  loading,
}: {
  programs: MortgageRule<SubsidyProgramRuleData>[];
  matches: SubsidyMatch[];
  answers: SubsidyAnswers;
  onAnswer: (questionId: string, answer: boolean | number | undefined) => void;
  referenceRate: MortgageRule<ReferenceRateRuleData> | null;
  nominalRatePercent: number | null;
  currency: string;
  /** True while the knowledge base is still being read. */
  loading?: boolean;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);

  /*
   * A reason carries raw figures out of the rule engine, because the
   * engine has no locale. Money is formatted here, once, so "200000"
   * never reaches a customer and every reason reads in their currency
   * format.
   */
  const say = (reason: SubsidyReason, fallbackCurrency: string) => {
    const vars: Record<string, string | number> = { ...(reason.vars ?? {}) };
    const money = String(vars.currency ?? vars.program ?? fallbackCurrency);
    for (const field of ['max', 'loan'] as const) {
      if (typeof vars[field] === 'number') vars[field] = formatMoney(vars[field] as number, money, locale);
    }
    return t(reason.key, vars);
  };

  if (!programs.length) {
    return (
      <Module
        id="programs-empty"
        eyebrowKey="mortgage_mod_programs_eyebrow"
        titleKey="mortgage_mod_programs_title"
        subtitleKey="mortgage_mod_programs_sub"
      >
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t(loading ? 'mortgage_programs_checking' : 'mortgage_programs_none')}
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
        const programCurrency = data.currency || currency;

        const childCount = answers.three_plus_children;
        const formulaKey =
          typeof childCount === 'number' && childCount >= 3 ? 'threeOrMoreChildren' : 'oneToTwoChildren';
        const benefit = computeSubsidyBenefit({
          formula: parseSubsidyFormula(data.subsidyRateFormula?.[formulaKey]),
          referenceRatePercent: referenceRate?.data.ratePercent ?? null,
          nominalAnnualRatePercent: nominalRatePercent,
          durationMonths: data.durationMonths,
        });
        const months = data.durationMonths;
        const years = months === null ? null : Math.round((months / 12) * 10) / 10;

        return (
          <Module
            key={rule.id}
            id={`program-${rule.id}`}
            eyebrowKey="mortgage_mod_programs_eyebrow"
            titleKey="mortgage_mod_programs_title"
            subtitleKey="mortgage_mod_programs_sub"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              {/*
                The programme's name in the reader's language. The row's
                own `title` is English administrative prose and stays in
                the database; `titleKey` is what a customer sees.
              */}
              <h3 className="min-w-0 font-display text-lg font-semibold leading-tight text-foreground">
                {data.titleKey ? t(data.titleKey) : rule.title}
              </h3>
              <SourceBadge source="OFFICIAL" />
            </div>

            {/* ── 1. What it does, before anything is asked ── */}
            <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-muted-foreground">
              {t(rule.humanExplanation)}
            </p>

            {/* ── 2. The plain facts ── */}
            <div className="mt-5 grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-3">
              {years !== null ? (
                <Fact labelKey="mortgage_subsidy_fact_duration" value={t('mortgage_subsidy_duration_years', { years })} />
              ) : null}
              <Fact
                labelKey="mortgage_subsidy_fact_currency"
                value={t('mortgage_subsidy_fact_currency_value', { currency: programCurrency })}
              />
              {data.maxLoanAmount !== null ? (
                <Fact
                  labelKey="mortgage_subsidy_fact_max"
                  value={formatMoney(data.maxLoanAmount, programCurrency, locale)}
                />
              ) : null}
              {benefit ? (
                <Fact
                  labelKey="mortgage_subsidy_fact_covers"
                  value={t('mortgage_subsidy_worth_points', { points: benefit.reductionPoints })}
                />
              ) : null}
            </div>

            {/* ── 3. What it is worth on THIS scenario ── */}
            {benefit ? (
              <div className="mt-5 rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] p-4">
                <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--gold-ink))]">
                  {t('mortgage_subsidy_worth_title')}
                </p>

                {/* The sentence first, the figure under it. A number set
                    large above six questions is what this section used
                    to be, and it explained nothing. */}
                {benefit.effectiveBorrowerRatePercent !== null && nominalRatePercent !== null && years !== null ? (
                  <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-[hsl(var(--gold-ink))]">
                    {t('mortgage_subsidy_your_rate', {
                      nominal: Math.round(nominalRatePercent * 100) / 100,
                      rate: formatPercent(benefit.effectiveBorrowerRatePercent, locale, 2),
                      years,
                    })}
                  </p>
                ) : null}

                <p className="mt-3 font-display text-xl font-semibold leading-none text-[hsl(var(--gold-ink))]">
                  {/* A plain number: the sentence already says "percentage
                      points", and formatPercent would make it read
                      "4.75% percentage points". */}
                  {t('mortgage_subsidy_worth_points', { points: benefit.reductionPoints })}
                </p>

                <p className="mt-2 max-w-[60ch] text-2xs leading-relaxed text-[hsl(var(--gold-ink))]">
                  {t('mortgage_subsidy_not_bank_rate')}
                </p>

                {referenceRate ? (
                  <p className="mt-2 max-w-[60ch] text-2xs leading-relaxed text-[hsl(var(--gold-ink))] opacity-80">
                    {t('mortgage_subsidy_rate_basis', {
                      reference: formatPercent(referenceRate.data.ratePercent, locale, 2),
                      months: months ?? 0,
                    })}
                    {benefit.capApplied ? ` ${t('mortgage_subsidy_cap_applied')}` : ''}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-5 rounded-lg border border-dashed border-border px-4 py-3 text-2xs leading-relaxed text-muted-foreground">
                {t('mortgage_subsidy_worth_unavailable')}
              </p>
            )}

            {/* ── 4. The questions ── */}
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
                const role = criterionRole(criterion);
                return (
                  <div key={criterion.key}>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {t(question?.promptKey ?? criterion.description)}
                      </span>
                      {role === 'MANDATORY' ? (
                        <span className="text-2xs text-muted-foreground">{t('mortgage_required')}</span>
                      ) : null}
                      {outcome?.satisfied === true && role !== 'CONTEXT' ? (
                        <CheckCircle2
                          className="h-4 w-4 text-[hsl(var(--success))]"
                          aria-label={t('mortgage_subsidy_condition_met')}
                        />
                      ) : null}
                    </div>
                    <p className="mb-2.5 max-w-[60ch] text-2xs leading-relaxed text-muted-foreground">
                      {t(criterion.description)}
                    </p>
                    {/* A condition that cannot open the programme says so
                        rather than letting a "yes" read as a qualification. */}
                    {role === 'CONTEXT' ? (
                      <p className="mb-2.5 max-w-[60ch] text-2xs leading-relaxed text-muted-foreground">
                        {t(criterion.routeClosedOn ? 'mortgage_subsidy_route_closed' : 'mortgage_subsidy_context_note')}
                      </p>
                    ) : null}
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

            {/* ── 5. The result, with its reasons ── */}
            {match ? (
              <div id={`program-result-${rule.id}`} className={cn('mt-6 rounded-xl border px-4 py-4', verdict.tone)}>
                <p className="flex items-start gap-2 text-sm font-medium">
                  <VerdictIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {t(verdict.labelKey)}
                </p>

                {match.verdict === 'LIKELY_MATCH' && match.met.length ? (
                  <ul className="mt-3 space-y-1">
                    {match.met.map((reason) => (
                      <li key={reason.key} className="flex items-start gap-2 text-2xs leading-relaxed">
                        <span aria-hidden="true">✓</span>
                        <span>{say(reason, programCurrency)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {/*
                  The reasons, which for a match are the caveats rather
                  than the refusal. A condition the decree states in a
                  way no rule can check is reported on a LIKELY_MATCH
                  too: dropping it there would make the strongest
                  verdict the only one that hides what it does not know.
                */}
                {match.reasons.length ? (
                  <ul className={cn('space-y-1.5', match.met.length ? 'mt-3 opacity-90' : 'mt-3')}>
                    {match.reasons.map((reason) => (
                      <li key={reason.key} className="text-2xs leading-relaxed">
                        {say(reason, programCurrency)}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {/* NOT ENOUGH INFORMATION names the questions rather than
                    leaving somebody to guess which ones they skipped. */}
                {match.verdict === 'CANNOT_DETERMINE' && match.outstanding.length ? (
                  <div className="mt-3">
                    <p className="text-2xs font-semibold uppercase tracking-[0.12em]">
                      {t('mortgage_subsidy_outstanding_title')}
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {match.outstanding.map((key) => {
                        const criterion = data.eligibilityCriteria.find((c) => c.key === key);
                        if (!criterion) return null;
                        return (
                          <li key={key} className="text-2xs leading-relaxed">
                            {t(criterion.question?.promptKey ?? criterion.description)}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}

                {match.nextStep ? (
                  <p className="mt-3 text-2xs font-medium leading-relaxed">
                    {say(match.nextStep, programCurrency)}
                  </p>
                ) : null}

                {match.verdict === 'LIKELY_MATCH' ? (
                  <p className="mt-3 text-2xs leading-relaxed opacity-90">{t('mortgage_subsidy_disclaimer')}</p>
                ) : null}
              </div>
            ) : null}

            <AskHomatch question={t('mortgage_subsidy_ask')} className="mt-4" />

            {match && match.verdict !== 'LIKELY_MATCH' ? (
              <p className="mt-4 max-w-[64ch] rounded-lg border border-dashed border-border px-4 py-3 text-2xs leading-relaxed text-muted-foreground">
                {t('mortgage_subsidy_disclaimer')}
              </p>
            ) : null}

            {/* ── Provenance ── */}
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
              {/* The row's own `administrator` is English prose with two
                  decree numbers and a semicolon in it, written for the
                  people who maintain the knowledge base. The decree is
                  one tap away behind the official-source link. */}
              <span>{data.administratorKey ? t(data.administratorKey) : data.administrator}</span>
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
