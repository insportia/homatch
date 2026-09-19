// src/pages/InvestmentPage.tsx — HOMATCH INVESTMENT INTELLIGENCE.
//
// A professional investment workspace. Four business models, structured
// input, and an answer that updates as it is entered.
//
// THE SHAPE OF THE EXPERIENCE, AND WHY IT IS THIS ONE
//
//   SELECT STRATEGY → ENTER PROPERTY DATA → REVIEW ASSUMPTIONS → RESULT
//
// The strategy comes first because it decides everything after it: which
// questions are worth asking, which engine runs, and what the headline
// figure even means. A workspace that asked for a purchase price before
// knowing whether this is a flip or a rental would be asking the same
// twenty questions of everybody and answering none of them well.
//
// WHERE THE NUMBERS COME FROM
//
// src/investment/calculations, deterministically, in the browser, on every
// click. This file collects input and renders output and computes nothing
// — the same separation src/mortgage keeps, for the same reason.
//
// THE RESULT IS NOT A WALL OF MODULES
//
// Six figures at the top answer the question the investor came with. The
// detailed modules sit below them, in the order an analyst works through,
// and they are the strategy's own — a flip does not get a vacancy ladder
// and a rental does not get a construction payment schedule.
//
// THE SURFACE
//
// The app shell stays light; the workspace inside it is dark. That is one
// scoped token block (`.hm-invest` in index.css) rather than a third
// data-surface, because data-surface lives on <html> and would drag the
// header, the mobile nav and every portalled menu into the dark palette
// with it. The consequence is a rule this page keeps deliberately: no
// portalled control inside the canvas — native selects, plain buttons,
// inline disclosure.

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, RotateCcw, Search } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import PageMeta from '@/components/common/PageMeta';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { logActivity } from '@/services/api';
import { cn } from '@/lib/utils';
import { useInvestmentSession } from '@/components/investment/useInvestmentSession';
import { StrategyHome } from '@/components/investment/StrategyHome';
import { DealBuilder } from '@/components/investment/DealBuilder';
import { ResultSummary } from '@/components/investment/ResultSummary';
import { EvidenceModule } from '@/components/investment/EvidencePanel';
import { RenovateResults } from '@/components/investment/results/RenovateResults';
import { ConstructionResults } from '@/components/investment/results/ConstructionResults';
import { RentalResults } from '@/components/investment/results/RentalResults';
import { ValueResults } from '@/components/investment/results/ValueResults';
import { STRATEGIES } from '@/investment/strategies/definitions';

export default function InvestmentPage() {
  const { t, isRTL } = useLanguage();
  const { homatchUser } = useAuth();
  const [params] = useSearchParams();
  const session = useInvestmentSession();

  const {
    strategy,
    selectStrategy,
    resumable,
    context,
    run,
    summary,
    state,
    missingLabels,
    lanes,
    comparisons,
    comparableRange,
    marketPresets,
    researchPhase,
    researchError,
    researchSteps,
    setField,
    research,
    applyEvidenceOffer,
    reset,
    attachProperty,
  } = session;

  /* A property can be handed in from anywhere in the app: the detail page,
     a match, a share link. Origin PROPERTY, so the investor can disagree
     with the listing's own numbers — which they often should. */
  const propertyId = params.get('propertyId');
  useEffect(() => {
    if (!propertyId) return;
    void attachProperty(propertyId);
  }, [propertyId, attachProperty]);

  useEffect(() => {
    if (!homatchUser) return;
    logActivity(homatchUser.id, 'INVESTMENT_PAGE_OPENED').catch(() => {});
  }, [homatchUser]);

  const [evidenceOpen, setEvidenceOpen] = useState(false);

  /* ── Choosing a strategy ───────────────────────────────────────── */

  if (!strategy || !run) {
    return (
      <AppLayout noPadding>
        <PageMeta title={t('inv_page_title')} description={t('inv_page_description')} />
        <div className="hm-invest hm-invest-canvas min-h-[calc(100vh-4rem)]">
          <StrategyHome onSelect={selectStrategy} resumable={resumable} />
        </div>
      </AppLayout>
    );
  }

  const definition = STRATEGIES[strategy];
  const currency = (context.currency?.value as string) ?? 'USD';
  const areaSqm = (context.areaSqm?.value as number | undefined) ?? null;
  const proposedPrice = (context.proposedPrice?.value as number | undefined) ?? null;
  const canResearch = Boolean(context.city?.value);

  return (
    <AppLayout noPadding>
      <PageMeta title={t(definition.titleKey)} description={t(definition.descriptionKey)} />
      <div className="hm-invest hm-invest-canvas min-h-[calc(100vh-4rem)]">
        <div className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6 lg:px-8">
          <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => selectStrategy(null)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-[hsl(var(--gold-border))] hover:text-foreground"
                aria-label={t('inv_back_to_strategies')}
              >
                <ArrowLeft
                  className={cn('h-4 w-4', isRTL && 'scale-x-[-1]')}
                  aria-hidden="true"
                />
              </button>
              <div className="min-w-0">
                <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold-ink))]">
                  {t('inv_product_eyebrow')}
                </p>
                <h1 className="truncate font-display text-xl font-semibold text-foreground sm:text-2xl">
                  {t(definition.titleKey)}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEvidenceOpen((open) => !open)}
                aria-expanded={evidenceOpen}
                className="flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-xs text-muted-foreground transition-colors hover:border-[hsl(var(--gold-border))] hover:text-foreground"
              >
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                {t('inv_market_toggle')}
              </button>
              <button
                type="button"
                onClick={reset}
                className="flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-xs text-muted-foreground transition-colors hover:border-[hsl(var(--gold-border))] hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                {t('inv_start_over')}
              </button>
            </div>
          </header>

          <div className="grid gap-6 lg:grid-cols-[24rem_minmax(0,1fr)] xl:grid-cols-[26rem_minmax(0,1fr)]">
            {/* The questions. Sticky on desktop so an investor adjusting an
                assumption watches the result move rather than scrolling
                back to find it; a plain block on mobile, above the answer,
                because that is the order the work happens in. */}
            <aside className="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-6">
              <DealBuilder
                strategy={strategy}
                context={context}
                onSet={setField}
                marketPresets={marketPresets}
              />
            </aside>

            <main className="min-w-0 space-y-6">
              <ResultSummary
                titleKey={definition.titleKey}
                flowKey={definition.flowKey}
                metrics={summary}
                state={state}
                missingLabels={missingLabels}
                currency={currency}
              />

              {evidenceOpen ? (
                <EvidenceModule
                  lanes={lanes}
                  comparisons={comparisons}
                  phase={researchPhase}
                  steps={researchSteps}
                  error={researchError}
                  currency={currency}
                  canResearch={canResearch}
                  city={(context.city?.value as string) ?? ''}
                  district={(context.district?.value as string) ?? ''}
                  onLocationChange={(field, value) => setField(field, value || null)}
                  onResearch={research}
                  onApply={applyEvidenceOffer}
                  focused={false}
                />
              ) : null}

              {state === 'MISSING_INPUT' ? (
                <p className="hm-invest-panel px-5 py-8 text-center text-sm text-muted-foreground">
                  {t('inv_result_awaiting')}
                </p>
              ) : null}

              {strategy === 'RENOVATE_RESELL' && run.model && run.flip ? (
                <RenovateResults
                  model={run.model}
                  flip={run.flip}
                  scenarios={run.flipScenarios}
                  timings={run.flipTimings}
                />
              ) : null}

              {strategy === 'CONSTRUCTION_RESALE' && run.construction ? (
                <ConstructionResults
                  model={run.construction}
                  delays={run.delays}
                  priceScenarios={run.priceScenarios}
                />
              ) : null}

              {strategy === 'RENTAL_INVESTMENT' && run.model ? (
                <RentalResults
                  model={run.model}
                  missing={missingLabels}
                  comparableRange={comparableRange}
                  showExit={(context.includeExitScenario?.value as string) === 'YES'}
                  onVacancyChange={(months) => setField('vacantMonthsPerYear', months)}
                  onBenchmarkChange={(percent) => setField('benchmarkYieldPercent', percent)}
                  onHoldChange={(months) => setField('holdMonths', months)}
                  onExitPriceChange={(price) => setField('exitPriceAssumption', price)}
                  onResearch={research}
                  researchAvailable={canResearch}
                />
              ) : null}

              {strategy === 'INVESTMENT_VALUE' && run.value ? (
                <ValueResults
                  result={run.value}
                  proposedPrice={proposedPrice}
                  areaSqm={areaSqm}
                  comparableRange={comparableRange}
                />
              ) : null}

              <p className="rounded-xl border border-dashed border-border px-5 py-4 text-2xs leading-relaxed text-muted-foreground">
                {t('inv_footer_disclaimer')}
              </p>
            </main>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
