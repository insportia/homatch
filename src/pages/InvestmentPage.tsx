// src/pages/InvestmentPage.tsx — HOMATCH INVESTMENT INTELLIGENCE.
//
// A first-class product, not a calculator page. The whole of it is an AI
// Investment Consultant: somebody describes a deal in a sentence, and the
// workspace assembles itself around the answer.
//
// WHERE THE NUMBERS COME FROM
//
// src/investment/calculations, deterministically, in the browser, on every
// keystroke. This file collects input and renders output and computes
// nothing — the same separation src/mortgage keeps, for the same reason,
// and the reason the AI can be forbidden from arithmetic and actually held
// to it.
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
//
// PROGRESSIVE DISCLOSURE IS THE LAYOUT
//
// With no purchase price there is one thing on screen: the Consultant.
// Modules appear as the consultation establishes what they need, in the
// order that makes them answerable, and the one the Consultant just
// answered about carries the single gold hairline. Nothing is rendered as
// an empty card waiting to be filled.

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PanelRightClose, PanelRightOpen, Sliders } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import PageMeta from '@/components/common/PageMeta';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { logActivity } from '@/services/api';
import { cn } from '@/lib/utils';
import { useInvestmentSession } from '@/components/investment/useInvestmentSession';
import { ConsultantPanel } from '@/components/investment/ConsultantPanel';
import { AssumptionsPanel } from '@/components/investment/AssumptionsPanel';
import { SnapshotRail } from '@/components/investment/Snapshot';
import {
  ImpliedValueModule,
  IncomeAndYieldModule,
  PricePositionModule,
} from '@/components/investment/IncomeAndYield';
import { MoneyBackModule } from '@/components/investment/MoneyBack';
import { FinancingModule } from '@/components/investment/Financing';
import {
  BreakEvenModule,
  ExitDelayModule,
  HoldAndExitModule,
  ScenarioLabModule,
} from '@/components/investment/Scenarios';
import { CapitalFlowModule } from '@/components/investment/CapitalFlow';
import { EvidenceModule } from '@/components/investment/EvidencePanel';
import type { CapabilityId } from '@/investment/consultant/capabilities';
import type { MarketComparableRange } from '@/investment/calculations/valuation';

/**
 * The order modules appear in.
 *
 * Not an arbitrary running order: it is the order an analyst answers the
 * questions in. What does it earn, what is that worth, when does it come
 * back, what does the bank cost, what happens at the exit, what breaks it,
 * where did the money go, and what does the market actually say.
 */
const MODULE_ORDER: CapabilityId[] = [
  'INCOME_AND_YIELD',
  'INCOME_IMPLIED_VALUE',
  'MARKET_EVIDENCE',
  'MONEY_BACK',
  'FINANCING',
  'HOLD_AND_SELL',
  'EXIT_DELAY',
  'STRESS_TEST',
  'BREAK_EVEN',
  'CAPITAL_FLOW',
];

export default function InvestmentPage() {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const [params] = useSearchParams();
  const session = useInvestmentSession();
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);

  const {
    context,
    model,
    capabilities,
    questions,
    focus,
    messages,
    consultantBusy,
    consultantError,
    lanes,
    comparisons,
    researchPhase,
    researchError,
    researchSteps,
    setField,
    send,
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

  const statusById = useMemo(
    () => Object.fromEntries(capabilities.map((c) => [c.id, c])),
    [capabilities],
  );

  const focused = focus[0] ?? null;

  /** The sale range the price rail compares against, when research ran. */
  const comparableRange: MarketComparableRange | null = useMemo(() => {
    const sale = lanes.find((lane) => lane.transaction === 'SALE');
    if (!sale?.range) return null;
    return {
      low: sale.range.low,
      median: sale.range.median,
      high: sale.range.high,
      currency: sale.range.currency,
      independentSourceCount: sale.range.independentSourceCount,
      observationCount: sale.range.observationCount,
      basis: 'ASKING',
    };
  }, [lanes]);

  const hasScenario = model !== null;
  const researchStatus = statusById.MARKET_EVIDENCE;

  /* ── Entry state ───────────────────────────────────────────────── */

  if (!hasScenario) {
    return (
      <AppLayout noPadding>
        <PageMeta title={t('inv_page_title')} description={t('inv_page_description')} />
        <div className="hm-invest hm-invest-canvas min-h-[calc(100vh-4rem)]">
          <ConsultantPanel
            messages={messages}
            busy={consultantBusy}
            error={consultantError}
            questions={questions}
            onSend={send}
            onReset={reset}
            compact={false}
            hasScenario={false}
          />
        </div>
      </AppLayout>
    );
  }

  /* ── Working state ─────────────────────────────────────────────── */

  return (
    <AppLayout noPadding>
      <PageMeta title={t('inv_page_title')} description={t('inv_page_description')} />
      <div className="hm-invest hm-invest-canvas min-h-[calc(100vh-4rem)]">
        <div className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6 lg:px-8">
          <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold-ink))]">
                {t('inv_product_eyebrow')}
              </p>
              <h1 className="mt-1 font-display text-2xl font-semibold text-foreground sm:text-3xl">
                {t('inv_workspace_title')}
              </h1>
            </div>
            <button
              type="button"
              onClick={() => setAssumptionsOpen((v) => !v)}
              aria-expanded={assumptionsOpen}
              className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs text-muted-foreground transition-colors hover:border-[hsl(var(--gold-border))] hover:text-foreground"
            >
              <Sliders className="h-3.5 w-3.5" aria-hidden="true" />
              {t('inv_assumptions_toggle')}
              {assumptionsOpen ? (
                <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <PanelRightOpen className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          </header>

          <div className="mb-6">
            <SnapshotRail model={model} focus={focus} />
          </div>

          <div
            className={cn(
              'grid gap-6',
              assumptionsOpen
                ? 'lg:grid-cols-[22rem_minmax(0,1fr)_20rem]'
                : 'lg:grid-cols-[22rem_minmax(0,1fr)]',
            )}
          >
            {/* The Consultant stays present throughout. Sticky on desktop
                so the conversation never scrolls away from the analysis it
                produced; a plain block on mobile, above everything. */}
            <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)]">
              <div className="hm-invest-panel h-full p-5 lg:flex lg:max-h-[calc(100vh-6rem)] lg:flex-col">
                <ConsultantPanel
                  messages={messages}
                  busy={consultantBusy}
                  error={consultantError}
                  questions={questions}
                  onSend={send}
                  onReset={reset}
                  compact
                  hasScenario
                />
              </div>
            </aside>

            <main className="min-w-0 space-y-6">
              {MODULE_ORDER.map((id) => {
                const isFocused = focused === id;
                const status = statusById[id];
                const missing = status?.missing ?? [];

                switch (id) {
                  case 'INCOME_AND_YIELD':
                    return (
                      <IncomeAndYieldModule
                        key={id}
                        model={model}
                        focused={isFocused}
                        missing={missing}
                        onVacancyChange={(months) => setField('vacantMonthsPerYear', months)}
                      />
                    );
                  case 'INCOME_IMPLIED_VALUE':
                    return (
                      <ImpliedValueModule
                        key={id}
                        model={model}
                        focused={isFocused}
                        missing={missing}
                        onBenchmarkChange={(percent) => setField('benchmarkYieldPercent', percent)}
                      />
                    );
                  case 'MARKET_EVIDENCE':
                    return (
                      <React.Fragment key={id}>
                        <PricePositionModule
                          model={model}
                          comparableRange={comparableRange}
                          focused={isFocused}
                          onResearch={research}
                          researchAvailable={researchStatus?.state === 'READY'}
                        />
                        <EvidenceModule
                          lanes={lanes}
                          comparisons={comparisons}
                          phase={researchPhase}
                          steps={researchSteps}
                          error={researchError}
                          currency={model.currency}
                          canResearch={researchStatus?.state === 'READY'}
                          missing={missing}
                          onResearch={research}
                          onApply={applyEvidenceOffer}
                          focused={isFocused}
                        />
                      </React.Fragment>
                    );
                  case 'MONEY_BACK':
                    return (
                      <MoneyBackModule key={id} model={model} focused={isFocused} missing={missing} />
                    );
                  case 'FINANCING':
                    return (
                      <FinancingModule key={id} model={model} focused={isFocused} missing={missing} />
                    );
                  case 'HOLD_AND_SELL':
                    return (
                      <HoldAndExitModule
                        key={id}
                        model={model}
                        focused={isFocused}
                        missing={missing}
                        onHoldChange={(months) => setField('holdMonths', months)}
                        onExitPriceChange={(price) => setField('exitPriceAssumption', price)}
                      />
                    );
                  case 'EXIT_DELAY':
                    return model.holdAndExit?.exitPrice.value !== null ? (
                      <ExitDelayModule key={id} model={model} focused={isFocused} />
                    ) : null;
                  case 'STRESS_TEST':
                    return <ScenarioLabModule key={id} model={model} focused={isFocused} />;
                  case 'BREAK_EVEN':
                    return <BreakEvenModule key={id} model={model} focused={isFocused} />;
                  case 'CAPITAL_FLOW':
                    return <CapitalFlowModule key={id} model={model} focused={isFocused} />;
                  default:
                    return null;
                }
              })}

              <p className="rounded-xl border border-dashed border-border px-5 py-4 text-2xs leading-relaxed text-muted-foreground">
                {t('inv_footer_disclaimer')}
              </p>
            </main>

            {assumptionsOpen ? (
              <aside className="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
                <div className="hm-invest-panel p-4">
                  <h2 className="mb-3 font-display text-base font-semibold text-foreground">
                    {t('inv_assumptions_title')}
                  </h2>
                  <p className="mb-4 text-2xs leading-relaxed text-muted-foreground">
                    {t('inv_assumptions_sub')}
                  </p>
                  <AssumptionsPanel
                    context={context}
                    onChange={(field, value) => setField(field, value)}
                    onTextChange={(field, value) => setField(field, value)}
                  />
                </div>
              </aside>
            ) : null}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
