// src/pages/MortgagePage.tsx — HOMATCH MORTGAGE AI CONSULTANT.
//
// A calculator with a consultant attached, in that order.
//
// WHAT THIS PAGE USED TO BE, AND WHY IT ISN'T
//
// Nine topic cards. Before a person could find out what a loan cost a
// month, they had to decide whether their question was about effective
// rates, PTI, refinancing, early repayment, government programmes or
// bank offers — a taxonomy of the product's own capabilities, put in
// front of somebody who had come to type four numbers. Every one of
// those capabilities was real and none of them was the reason anybody
// opened the page.
//
// So the order is now:
//
//   A  the name
//   B  five fields and one button
//   C  the monthly payment, large
//   D  the consultant, which already knows the scenario
//   E  five optional tools, closed
//   F  what to check before signing
//   G  effective rate, term ladder, schedule, checklist — behind doors
//
// Nothing was deleted. Every engine still has a call site; they are
// simply reached by scrolling rather than by choosing.
//
// THE SURFACE IS STILL SHARED WITH INVESTMENT
//
// Same deep-navy canvas, same gold accent, same panels, from
// src/components/workspace. See the note in index.css for why the
// palette is scoped to the canvas element rather than set on <html>.

import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import PageMeta from '@/components/common/PageMeta';
import { PageBlocks } from '@/site/render/PageBlocks';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { logActivity } from '@/services/api';
import { buildConsultantBrief } from '@/mortgage/consultantBrief';
import { useFinancingSession } from '@/components/mortgage/useFinancingSession';
import { SimpleCalculator } from '@/components/mortgage/SimpleCalculator';
import { ResultHeadline } from '@/components/mortgage/ResultHeadline';
import { ConsultantPanel } from '@/components/mortgage/ConsultantPanel';
import { MortgageAskProvider } from '@/components/mortgage/askConsultant';
import { ToolShelf } from '@/components/mortgage/ToolShelf';
import { AdvancedInputs } from '@/components/mortgage/AdvancedInputs';
import { DetailsSection } from '@/components/mortgage/DetailsSection';
import { FinancingPictureView } from '@/components/mortgage/FinancingPictureView';
import { AffordabilityView } from '@/components/mortgage/views/AffordabilityView';
import { EarlyRepaymentView, RefinancingView } from '@/components/mortgage/views/PlanViews';
import { SummaryView } from '@/components/mortgage/SummaryView';
import { OffersView } from '@/components/mortgage/views/OffersView';
import { ProgramsView } from '@/components/mortgage/views/ProgramsView';
import { BeforeYouSignView } from '@/components/mortgage/views/GuidanceViews';

interface MortgagePrefillState {
  propertyId?: string;
  price?: number;
  currency?: string;
}

export default function MortgagePage() {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = (location.state as { context?: MortgagePrefillState } | null)?.context;

  const session = useFinancingSession({ price: prefill?.price, currency: prefill?.currency });
  const {
    draft,
    set,
    reset,
    topic,
    selectTopic,
    input,
    result,
    breakdown,
    termRows,
    affordability,
    picture,
    earlyRepayment,
    refinancing,
    offers,
    addOffer,
    updateOffer,
    removeOffer,
    offerComparison,
    subsidyPrograms,
    subsidyAnswers,
    answerSubsidy,
    subsidyMatches,
    rulesReady,
    referenceRate,
    ptiRule,
    ltvRule,
    ptiRules,
    ltvRules,
    workspaceState,
  } = session;

  /*
   * PRESSED, OR ARRIVED WITH AN ANSWER ALREADY.
   *
   * The button exists because a calculator without one feels like it is
   * still waiting for something. But somebody returning to a scenario
   * they entered yesterday should not have to press it again to see
   * their own numbers, and once the result is on screen every further
   * edit updates it live — a stale figure beside a changed field is the
   * one thing worse than no figure.
   */
  const [pressed, setPressed] = useState(false);
  /* Captured on the first render only. Whether the SCENARIO WAS ALREADY
     COMPLETE WHEN THE PAGE OPENED is a different question from whether
     it is complete now — reading it live would make the button vanish
     the instant somebody finished typing, and they would never get to
     press it. */
  const [arrivedWithScenario] = useState(() => input !== null);
  const showResult = result !== null && (pressed || arrivedWithScenario);

  useEffect(() => {
    if (!homatchUser) return;
    logActivity(homatchUser.id, 'MORTGAGE_PAGE_OPENED').catch(() => {});
    if (prefill?.propertyId) {
      logActivity(homatchUser.id, 'PROPERTY_MORTGAGE_OPENED', prefill.propertyId).catch(() => {});
    }
  }, [homatchUser, prefill?.propertyId]);

  const currency = draft.currency;
  const presetContext = useMemo(
    () => ({
      propertyPrice: draft.propertyPrice ?? undefined,
      loanAmount: result?.loanAmount ?? undefined,
      termMonths: draft.termMonths ?? undefined,
      monthlyPayment: result?.monthlyPayment ?? undefined,
      currency,
    }),
    [draft.propertyPrice, draft.termMonths, result?.loanAmount, result?.monthlyPayment, currency],
  );

  /*
   * WHAT THE CONSULTANT IS TOLD.
   *
   * Every figure in here came out of the deterministic engines, including
   * the what-if ladders. The model is asked to explain them, never to
   * produce them. See src/mortgage/consultantBrief.ts.
   */
  const brief = useMemo(
    () =>
      input
        ? buildConsultantBrief({
            input,
            offers,
            monthlyNetIncome: draft.monthlyNetIncome,
            existingMonthlyDebtObligations: draft.existingMonthlyDebtObligations,
            ptiRules,
            ltvRules,
            ptiRule,
            ltvRule,
            subsidyPrograms,
            ownLoan: {
              remainingPrincipal: draft.ownRemainingPrincipal,
              remainingTermMonths: draft.ownRemainingTermMonths,
              nominalRatePercent: draft.ownNominalRatePercent,
              newRatePercent: draft.refiNewRatePercent,
              newTermMonths: draft.refiNewTermMonths,
              feesFlat: draft.refinancingFeesFlat,
            },
          })
        : null,
    [
      input, offers, draft.monthlyNetIncome, draft.existingMonthlyDebtObligations,
      ptiRules, ltvRules, ptiRule, ltvRule, subsidyPrograms,
      draft.ownRemainingPrincipal, draft.ownRemainingTermMonths, draft.ownNominalRatePercent,
      draft.refiNewRatePercent, draft.refiNewTermMonths, draft.refinancingFeesFlat,
    ],
  );

  /*
   * ONE CONSULTANT, REACHED FROM THE WHOLE PAGE.
   *
   * The checklist cards, the findings in the financing picture and the
   * contract topics all end in a question. The provider is what lets
   * them put that question to the conversation that is already running
   * further up, instead of printing it and hoping somebody retypes it.
   * See components/mortgage/askConsultant.tsx.
   */
  return (
    <AppLayout noPadding>
      <PageMeta title={t('mortgage_page_title')} description={t('mortgage_page_subtitle')} />
      <MortgageAskProvider>
        {/*
          * PREMIUM LIGHT, NOT THE ANALYTICAL NAVY.
          *
          * The consultant used to wear .hm-workspace — a dark instrument
          * panel inside the light customer shell, which read as a different
          * product the moment it opened. The customer family (Dashboard,
          * Credits, Profile, Communications) is light; the mortgage
          * consultant is part of that family, and every mortgage component
          * speaks in tokens, so the same markup carries on the light ground.
          */}
        <div className="hm-customer hm-customer-canvas min-h-[calc(100vh-4rem)]">
          <div className="mx-auto w-full max-w-[64rem] space-y-8 px-4 py-8 sm:px-6 sm:py-10">
            {/* ── A. The name — DARK STRUCTURAL FRAMING.
                The navy band is the product's frame: deep ink ground, white
                title, gold eyebrow and a hairline of gold light. The WORK
                happens on the white panels below it. */}
            <header className="overflow-hidden rounded-2xl bg-[#0C1119] px-5 py-6 text-white shadow-hover sm:px-9 sm:py-10">
              <div className="relative">
                <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[hsl(38_92%_60%)]">
                  {t('mortgage_product_eyebrow')}
                </p>
                <h1 className="mt-2 font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-white sm:text-4xl">
                  {t('mortgage_page_title')}
                </h1>
                <p className="mt-2.5 max-w-[58ch] text-[15px] leading-relaxed text-white/80 sm:text-base">
                  {t('mortgage_opening_promise')}
                </p>
                <span className="mt-5 block h-[3px] w-16 rounded-full bg-[hsl(38_92%_56%)]" aria-hidden="true" />
              </div>
            </header>

            {/* ── B. The calculator ── */}
            <SimpleCalculator
              draft={draft}
              set={set}
              calculated={showResult}
              onCalculate={() => {
                setPressed(true);
                requestAnimationFrame(() => {
                  document.getElementById('result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
              }}
            />

            {showResult && result ? (
              <>
                {/* ── C. The answer ── */}
                <ResultHeadline result={result} currency={currency} />

                {/* ── D. The consultant ── */}
                <ConsultantPanel brief={brief} />

                {/* ── E. Optional tools ── */}
                <ToolShelf open={topic} onOpen={selectTopic} state={workspaceState}>
                  {topic === 'EARLY_REPAYMENT' && input ? (
                    <EarlyRepaymentView
                      draft={draft}
                      set={set}
                      result={earlyRepayment}
                      currency={currency}
                      context={presetContext}
                      termMonths={input.termMonths}
                      monthlyPayment={result.monthlyPayment}
                    />
                  ) : null}

                  {topic === 'COMPARE_OFFERS' ? (
                    <OffersView
                      offers={offers}
                      comparison={offerComparison}
                      onAdd={addOffer}
                      onUpdate={updateOffer}
                      onRemove={removeOffer}
                      loanAmount={result.loanAmount}
                      termMonths={draft.termMonths ?? 240}
                      currency={currency}
                      context={presetContext}
                    />
                  ) : null}

                  {topic === 'AFFORDABILITY' ? (
                    affordability ? (
                      <AffordabilityView
                        affordability={affordability}
                        ptiRule={ptiRule}
                        ltvRule={ltvRule}
                        propertyPrice={input?.propertyPrice ?? null}
                        downPayment={input?.downPayment ?? null}
                        loanAmount={result.loanAmount}
                        currency={currency}
                      />
                    ) : (
                      <AdvancedInputs
                        draft={draft}
                        set={set}
                        loanAmount={result.loanAmount}
                        monthlyPayment={result.monthlyPayment}
                      />
                    )
                  ) : null}

                  {topic === 'REFINANCING' ? (
                    <RefinancingView
                      draft={draft}
                      set={set}
                      result={refinancing}
                      currency={currency}
                      context={presetContext}
                    />
                  ) : null}

                  {topic === 'GOVERNMENT_PROGRAMS' ? (
                    <ProgramsView
                      programs={subsidyPrograms}
                      matches={subsidyMatches}
                      answers={subsidyAnswers}
                      onAnswer={answerSubsidy}
                      referenceRate={referenceRate}
                      nominalRatePercent={draft.nominalAnnualRatePercent}
                      currency={currency}
                      loading={!rulesReady}
                      loanAmount={result.loanAmount}
                      amortizingMonths={input ? input.termMonths - (input.gracePeriodMonths ?? 0) : null}
                      onSwitchCurrency={(next) => set('currency', next)}
                    />
                  ) : null}
                </ToolShelf>

                {/* ── F. Before you sign ── */}
                <BeforeYouSignView />

                {/* ── G. Details and methodology ── */}
                <DetailsSection
                  input={input}
                  result={result}
                  breakdown={breakdown}
                  termRows={termRows}
                  currency={currency}
                  onSelectTerm={(months) => set('termMonths', months)}
                />

                {/* The bank's own cost sheet, and income. Optional, closed,
                    and the only thing that makes the effective rate exact. */}
                <AdvancedInputs
                  draft={draft}
                  set={set}
                  loanAmount={result.loanAmount}
                  monthlyPayment={result.monthlyPayment}
                />

                {picture ? <FinancingPictureView picture={picture} /> : null}

                {/* ── The live summary: one scenario, one answer ── */}
                {input ? (
                  <SummaryView
                    input={input}
                    result={result}
                    affordability={affordability}
                    earlyRepayment={earlyRepayment}
                    subsidyMatch={subsidyMatches[0] ?? null}
                  />
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => { reset(); setPressed(false); }}
                    className="flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-xs text-muted-foreground transition-colors hover:border-[hsl(var(--gold-border))] hover:text-foreground"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('mortgage_start_over')}
                  </button>
                  {!homatchUser ? (
                    <button
                      type="button"
                      className="min-h-11 text-2xs text-muted-foreground underline decoration-dotted underline-offset-2"
                      onClick={() => navigate('/auth/login')}
                    >
                      {t('mortgage_sign_in_to_save')}
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}

            <p className="rounded-xl border border-dashed border-border px-5 py-4 text-2xs leading-relaxed text-muted-foreground">
              {t('mortgage_global_disclaimer')}
            </p>

            <PageBlocks slug="mortgage" />
          </div>
        </div>
      </MortgageAskProvider>
    </AppLayout>
  );
}
