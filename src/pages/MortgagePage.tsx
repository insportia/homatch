// src/pages/MortgagePage.tsx — HOMATCH HOME FINANCING.
//
// A financing workspace, not a calculator page.
//
// THE SHAPE, AND WHY IT IS THIS ONE
//
//   CHOOSE A QUESTION → ENTER WHAT IT NEEDS → READ THE ANSWER
//
// The old page put one form at the top and stacked every result under
// it, which meant somebody who wanted to know whether paying extra was
// worth it scrolled past an amortization table to find out that the
// feature was not exposed at all. Three engines — early repayment,
// refinancing and offer comparison — had been written, tested and never
// given a single call site.
//
// So the entry screen is the nine questions people actually arrive
// with, each card saying whether it can answer yet and what it is
// waiting for. The arithmetic underneath is unchanged: every number on
// every topic comes from src/mortgage/calculations, which this file
// does not touch.
//
// THE SURFACE IS SHARED WITH INVESTMENT, DELIBERATELY
//
// Same deep-navy canvas, same gold accent, same cards, same chips, from
// src/components/workspace. Two financial workspaces in one product
// that look like two products is a cost paid by every user who visits
// both. The app shell around it stays light — see the note in
// index.css for why the palette is scoped to the canvas element rather
// than set on <html>, and the rule it implies: no portalled control
// inside this surface.

import React, { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import PageMeta from '@/components/common/PageMeta';
import { PageBlocks } from '@/site/render/PageBlocks';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { logActivity } from '@/services/api';
import { TOPICS, missingRequirements } from '@/mortgage/topics';
import { useFinancingSession } from '@/components/mortgage/useFinancingSession';
import { TopicHome } from '@/components/mortgage/TopicHome';
import { LoanBuilder } from '@/components/mortgage/LoanBuilder';
import { FinancingPictureView } from '@/components/mortgage/FinancingPictureView';
import { PaymentView } from '@/components/mortgage/views/PaymentView';
import { RateView, CostStack } from '@/components/mortgage/views/RateView';
import { TermsView } from '@/components/mortgage/views/TermsView';
import { AffordabilityView } from '@/components/mortgage/views/AffordabilityView';
import { EarlyRepaymentView, RefinancingView } from '@/components/mortgage/views/PlanViews';
import { OffersView } from '@/components/mortgage/views/OffersView';
import { ProgramsView } from '@/components/mortgage/views/ProgramsView';
import { BeforeYouSignView, ChecklistView } from '@/components/mortgage/views/GuidanceViews';

interface MortgagePrefillState {
  propertyId?: string;
  price?: number;
  currency?: string;
}

export default function MortgagePage() {
  const { t, isRTL } = useLanguage();
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
    inputErrors,
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
    referenceRate,
    ptiRule,
    ltvRule,
    workspaceState,
  } = session;

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

  /* ── Choosing a question ───────────────────────────────────────── */

  if (!topic) {
    return (
      <AppLayout noPadding>
        <PageMeta title={t('mortgage_page_title')} description={t('mortgage_page_subtitle')} />
        <div className="hm-workspace hm-workspace-canvas min-h-[calc(100vh-4rem)]">
          <TopicHome onSelect={selectTopic} state={workspaceState} lastOpened={null} />
          <div className="mx-auto w-full max-w-[72rem] px-4 pb-10 sm:px-5">
            <PageBlocks slug="mortgage" />
          </div>
        </div>
      </AppLayout>
    );
  }

  const definition = TOPICS[topic];
  const missing = missingRequirements(definition, workspaceState);

  return (
    <AppLayout noPadding>
      <PageMeta title={t(definition.titleKey)} description={t(definition.descriptionKey)} />
      <div className="hm-workspace hm-workspace-canvas min-h-[calc(100vh-4rem)]">
        <div className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6 lg:px-8">
          <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => selectTopic(null)}
                aria-label={t('mortgage_back_to_topics')}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-[hsl(var(--gold-border))] hover:text-foreground"
              >
                <ArrowLeft className={cn('h-4 w-4', isRTL && 'scale-x-[-1]')} aria-hidden="true" />
              </button>
              <div className="min-w-0">
                <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold-ink))]">
                  {t('mortgage_product_eyebrow')}
                </p>
                {/* Not truncated: eliding the page's own name is the one label a
                    reader cannot recover from context. */}
                <h1 className="font-display text-xl font-semibold leading-tight text-foreground sm:text-2xl">
                  {t(definition.titleKey)}
                </h1>
              </div>
            </div>

            <button
              type="button"
              onClick={reset}
              className="flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-xs text-muted-foreground transition-colors hover:border-[hsl(var(--gold-border))] hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {t('mortgage_start_over')}
            </button>
          </header>

          <div className="grid gap-6 lg:grid-cols-[24rem_minmax(0,1fr)] xl:grid-cols-[26rem_minmax(0,1fr)]">
            {/* The questions. Sticky on desktop so somebody adjusting a
                fee watches the answer move; a plain block on mobile,
                above the answer, because that is the order of the work. */}
            <aside className="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-6">
              <LoanBuilder
                draft={draft}
                set={set}
                loanAmount={result?.loanAmount ?? null}
                monthlyPayment={result?.monthlyPayment ?? null}
                errors={inputErrors}
              />
            </aside>

            <main className="min-w-0 space-y-6">
              {picture ? <FinancingPictureView picture={picture} /> : null}

              {missing.length ? (
                <p className="hm-workspace-panel px-5 py-8 text-center text-sm text-muted-foreground">
                  {t('mortgage_topic_needs')}{' '}
                  <span className="text-foreground">{missing.map((key) => t(key)).join(', ')}</span>
                </p>
              ) : null}

              {topic === 'MONTHLY_PAYMENT' && result ? (
                <PaymentView result={result} currency={currency} />
              ) : null}

              {topic === 'UNDERSTAND_RATE' && breakdown && result ? (
                <>
                  <RateView breakdown={breakdown} currency={currency} />
                  <CostStack
                    breakdown={breakdown}
                    currency={currency}
                    totalInterest={result.totalInterest}
                    totalRepayment={result.totalRepayment}
                    loanAmount={result.loanAmount}
                  />
                </>
              ) : null}

              {topic === 'COMPARE_TERMS' && termRows.length > 1 ? (
                <TermsView
                  rows={termRows}
                  currency={currency}
                  onSelectTerm={(months) => set('termMonths', months)}
                />
              ) : null}

              {topic === 'AFFORDABILITY' && affordability ? (
                <AffordabilityView affordability={affordability} ptiRule={ptiRule} ltvRule={ltvRule} />
              ) : null}

              {topic === 'EARLY_REPAYMENT' && input ? (
                <EarlyRepaymentView
                  draft={draft}
                  set={set}
                  result={earlyRepayment}
                  currency={currency}
                  context={presetContext}
                  termMonths={input.termMonths}
                />
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

              {topic === 'COMPARE_OFFERS' ? (
                <OffersView
                  offers={offers}
                  comparison={offerComparison}
                  onAdd={addOffer}
                  onUpdate={updateOffer}
                  onRemove={removeOffer}
                  loanAmount={result?.loanAmount ?? 0}
                  termMonths={draft.termMonths ?? 240}
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
                />
              ) : null}

              {topic === 'BEFORE_YOU_SIGN' ? (
                <>
                  <ChecklistView input={input} />
                  <BeforeYouSignView />
                </>
              ) : null}

              {!homatchUser ? (
                <p className="text-center text-2xs text-muted-foreground">
                  <button
                    type="button"
                    className="min-h-11 underline decoration-dotted underline-offset-2"
                    onClick={() => navigate('/auth/login')}
                  >
                    {t('mortgage_sign_in_to_save')}
                  </button>
                </p>
              ) : null}

              <p className="rounded-xl border border-dashed border-border px-5 py-4 text-2xs leading-relaxed text-muted-foreground">
                {t('mortgage_global_disclaimer')}
              </p>

              <PageBlocks slug="mortgage" />
            </main>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
