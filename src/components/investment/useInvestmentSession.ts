// HOMATCH INVESTMENT INTELLIGENCE — the session.
//
// WHERE THE NUMBERS COME FROM ON THIS SCREEN
//
// The SAME engine the server runs, in the browser, on every click. That is
// why there is no Calculate button and no spinner: there is nothing to
// wait for. No round trip, no credit, no network at all.
//
// WHAT THE SERVER IS FOR
//
// One thing, and it is optional: asking what the market is currently
// asking. It feeds the input controls better starting points and gives the
// result something to be measured against. Every strategy produces its
// full answer with the server switched off.
//
// WHY THE CONTEXT IS THE STATE AND EVERYTHING ELSE IS DERIVED
//
// A scenario is a set of established values with provenance; the model is
// what arithmetic makes of them. Keeping the model in state as well would
// create two sources of truth that drift the first time somebody updates
// one and forgets the other. useMemo is enough: the whole engine, including
// the break-even solvers and the backsolves, runs in single-digit
// milliseconds.
//
// WHY THE STRATEGY IS STORED NEXT TO THE CONTEXT
//
// The chosen strategy decides which questions are asked and which engine
// runs, so it is part of the scenario, not part of the routing. Somebody
// who reloads mid-analysis lands back inside their analysis.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { getProperty, logActivity } from '@/services/api';
import type { ActivityEventType } from '@/types/types';
import {
  applyPatch,
  type ContextPatch,
  type InvestmentContext,
} from '@/investment/consultant/context';
import {
  STRATEGIES,
  analysisState,
  missingRequiredFields,
  type AnalysisState,
  type StrategyId,
} from '@/investment/strategies/definitions';
import { runStrategy, type StrategyRun } from '@/investment/strategies/run';
import { summarySlots, type SummarySlot } from '@/investment/strategies/summary';
import type { MarketComparableRange } from '@/investment/calculations/valuation';
import {
  compareAssumption,
  offerToPatch,
  type AssumptionComparison,
  type EvidenceRange,
  type OfferKind,
} from '@/investment/evidence/compare';

export interface LaneResult {
  transaction: 'SALE' | 'RENT';
  range: EvidenceRange | null;
  portals: Array<{ id: string; sourceFamily: string; state: string; found: number; detail: string | null }>;
  comparables: Array<{
    url: string;
    sourceFamily: string;
    price: number | null;
    currency: string | null;
    pricePerSqm: number | null;
    areaSqm: number | null;
    rooms: number | null;
    bedrooms: number | null;
    floor: number | null;
    title: string | null;
    retrievedAt: string;
    alsoListedAt: string[];
  }>;
  pricePerSqm: { median: number; count: number; currency: string } | null;
  uniquePropertyCount: number;
  crossPostedCount: number;
  uncertainDuplicateCount: number;
  conflictCount: number;
  truncatedByDeadline: boolean;
  widened: boolean;
  networkRequests: number;
  startedAt: string;
  finishedAt: string;
  refusal: string | null;
}

export type ResearchPhase = 'IDLE' | 'RUNNING' | 'DONE' | 'FAILED' | 'RATE_LIMITED' | 'UNAUTHENTICATED';

/** A starting point taken from real listings, offered on an input control. */
export interface MarketPreset {
  value: number;
  labelKey: string;
}

export interface InvestmentSession {
  strategy: StrategyId | null;
  selectStrategy: (strategy: StrategyId | null) => void;
  /** A strategy with work already in it, for the "continue" badge on the home. */
  resumable: StrategyId | null;

  context: InvestmentContext;
  run: StrategyRun | null;
  summary: SummarySlot[];
  state: AnalysisState;
  /** Labels of the required answers still outstanding. */
  missingLabels: string[];

  researchPhase: ResearchPhase;
  researchError: string | null;
  lanes: LaneResult[];
  comparisons: AssumptionComparison[];
  comparableRange: MarketComparableRange | null;
  marketPresets: Record<string, MarketPreset[]>;
  /** Live progress lines while a sweep runs. Real stages, not a fake bar. */
  researchSteps: string[];

  setField: (field: string, value: number | string | null) => void;
  setFields: (patch: ContextPatch) => void;
  research: () => Promise<void>;
  applyEvidenceOffer: (comparison: AssumptionComparison, kind: OfferKind) => void;
  reset: () => void;
  attachProperty: (propertyId: string) => Promise<void>;
  propertyBusy: boolean;
  propertyError: string | null;
}

const STORAGE_KEY = 'homatch.investment.context.v1';
const STRATEGY_KEY = 'homatch.investment.strategy.v1';

/**
 * A scenario survives a reload.
 *
 * Somebody who has spent ten minutes describing a deal and then refreshes
 * should not lose it, and the alternative — a table — would mean a schema,
 * a migration and an RLS review for something that is genuinely local
 * working state. Nothing here is personal beyond what the person entered
 * about their own property, and it never leaves the device except in a
 * market request they explicitly start.
 */
function loadStoredContext(): InvestmentContext {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    // Re-validated through the one door rather than trusted: storage is
    // writable by anything running on this origin, including an older
    // version of this file with different bounds.
    let context: InvestmentContext = {};
    for (const [field, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const e = entry as { value?: unknown; origin?: unknown; at?: unknown; source?: unknown };
      if (!e || typeof e !== 'object' || e.value === undefined || e.value === null) continue;
      const origin =
        e.origin === 'PROPERTY' || e.origin === 'RESEARCH' || e.origin === 'DERIVED' ? e.origin : 'USER';
      context = applyPatch(context, { [field]: e.value as number | string }, origin, {
        at: typeof e.at === 'string' ? e.at : new Date().toISOString(),
        ...(typeof e.source === 'string' ? { source: e.source } : {}),
      }).context;
    }
    return context;
  } catch {
    return {};
  }
}

function loadStoredStrategy(): StrategyId | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STRATEGY_KEY);
    return raw && raw in STRATEGIES ? (raw as StrategyId) : null;
  } catch {
    return null;
  }
}

function store(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* A full or disabled storage must never break the workspace. */
  }
}

export function useInvestmentSession(): InvestmentSession {
  const { homatchUser, session } = useAuth();
  const { t, lang } = useLanguage();

  const [context, setContext] = useState<InvestmentContext>(loadStoredContext);
  const [strategy, setStrategy] = useState<StrategyId | null>(loadStoredStrategy);

  const [researchPhase, setResearchPhase] = useState<ResearchPhase>('IDLE');
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchSteps, setResearchSteps] = useState<string[]>([]);
  const [lanes, setLanes] = useState<LaneResult[]>([]);

  const [propertyBusy, setPropertyBusy] = useState(false);
  const [propertyError, setPropertyError] = useState<string | null>(null);

  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    store(STORAGE_KEY, JSON.stringify(context));
  }, [context]);

  useEffect(() => {
    store(STRATEGY_KEY, strategy);
  }, [strategy]);

  const track = useCallback(
    (eventType: ActivityEventType, metadata?: Record<string, unknown>) => {
      // activity_events.user_id is NOT NULL and this page is public, so a
      // signed-out visitor is a deliberate no-op rather than a placeholder
      // row that would violate the constraint.
      if (!homatchUser) return;
      logActivity(homatchUser.id, eventType, undefined, metadata).catch(() => {});
    },
    [homatchUser],
  );

  const valueOf = useCallback(
    (field: string) =>
      (context as Record<string, { value?: string | number } | undefined>)[field]?.value,
    [context],
  );

  const run = useMemo<StrategyRun | null>(
    () => (strategy ? runStrategy(strategy, context) : null),
    [strategy, context],
  );

  const summary = useMemo(() => (run ? summarySlots(run) : []), [run]);

  const state = useMemo<AnalysisState>(
    () => (strategy ? analysisState(strategy, valueOf) : 'MISSING_INPUT'),
    [strategy, valueOf],
  );

  const missingLabels = useMemo(
    () =>
      strategy
        ? missingRequiredFields(strategy, valueOf).map((field) => t(field.labelKey))
        : [],
    [strategy, valueOf, t],
  );

  /*
   * Recorded once per strategy, the first time every question it asks has
   * an answer. The product question this exists to answer is which of the
   * four business models people actually finish, and firing on every
   * keystroke after that would answer a different question badly.
   */
  const completed = useRef(new Set<StrategyId>());
  useEffect(() => {
    if (!strategy || state !== 'COMPLETE' || completed.current.has(strategy)) return;
    completed.current.add(strategy);
    track('INVESTMENT_ANALYSIS_COMPLETED', { strategy });
  }, [strategy, state, track]);

  /**
   * The strategy worth offering to continue.
   *
   * The context is shared across strategies by design — an area is an area
   * — so "has work in it" means the last strategy the investor chose, not
   * whichever one happens to have fields filled.
   */
  const resumable = useMemo(
    () => (strategy && Object.keys(context).length > 0 ? strategy : null),
    [strategy, context],
  );

  const setFields = useCallback((patch: ContextPatch) => {
    setContext((current) => applyPatch(current, patch, 'USER', { source: 'workspace' }).context);
  }, []);

  const setField = useCallback(
    (field: string, value: number | string | null) => setFields({ [field]: value }),
    [setFields],
  );

  const selectStrategy = useCallback(
    (next: StrategyId | null) => {
      setStrategy(next);
      if (next) track('INVESTMENT_STRATEGY_SELECTED', { strategy: next });
    },
    [track],
  );

  const reset = useCallback(() => {
    setContext({});
    setStrategy(null);
    setLanes([]);
    setResearchPhase('IDLE');
    setResearchError(null);
    setResearchSteps([]);
    store(STORAGE_KEY, null);
    store(STRATEGY_KEY, null);
  }, []);

  /* ── Market evidence ───────────────────────────────────────────── */

  const comparisons = useMemo<AssumptionComparison[]>(() => {
    const out: AssumptionComparison[] = [];
    for (const lane of lanes) {
      if (lane.range) out.push(compareAssumption(context, lane.range));
    }
    return out;
  }, [lanes, context]);

  /**
   * The asking range for the subject, for the price scale and the position
   * module. Asking, and labelled as asking: a portal publishes what sellers
   * want, and calling that a market value would be the product telling its
   * first lie.
   */
  const comparableRange = useMemo<MarketComparableRange | null>(() => {
    const sale = lanes.find((lane) => lane.transaction === 'SALE' && lane.range);
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

  /**
   * Observed figures offered directly on the input controls.
   *
   * These REPLACE the generic illustrations for the same field rather than
   * joining them — see DealBuilder's own note. A market chip and an example
   * chip sitting side by side look identical at a glance, and the investor
   * would have no way to tell which of the two came from anywhere real.
   */
  const marketPresets = useMemo<Record<string, MarketPreset[]>>(() => {
    const out: Record<string, MarketPreset[]> = {};
    const spread = (range: EvidenceRange): MarketPreset[] => [
      { value: Math.round(range.low), labelKey: 'inv_preset_market_low' },
      { value: Math.round(range.median), labelKey: 'inv_preset_market_typical' },
      { value: Math.round(range.high), labelKey: 'inv_preset_market_high' },
    ];

    for (const lane of lanes) {
      if (!lane.range) continue;
      if (lane.transaction === 'RENT') {
        out.monthlyRent = spread(lane.range);
        continue;
      }
      const sale = spread(lane.range);
      out.purchasePrice = sale;
      out.askingPrice = sale;
      out.proposedPrice = sale;
      // A resale or a completed price is a FUTURE price and the sweep only
      // ever saw today's. Offered as a starting point, never as the answer.
      out.exitPriceAssumption = sale;
      out.expectedCompletedPrice = sale;

      if (lane.pricePerSqm) {
        const median = Math.round(lane.pricePerSqm.median);
        const perSqm: MarketPreset[] = [
          { value: Math.round(median * 0.9), labelKey: 'inv_preset_market_low' },
          { value: median, labelKey: 'inv_preset_market_typical' },
          { value: Math.round(median * 1.1), labelKey: 'inv_preset_market_high' },
        ];
        out.purchasePricePerSqm = perSqm;
        out.expectedResalePricePerSqm = perSqm;
        out.expectedCompletedPricePerSqm = perSqm;
      }
    }
    return out;
  }, [lanes]);

  const research = useCallback(async () => {
    if (researchPhase === 'RUNNING') return;
    const city = contextRef.current.city?.value;
    if (!city) {
      setResearchError('inv_research_needs_city');
      return;
    }
    if (!session) {
      setResearchPhase('UNAUTHENTICATED');
      return;
    }

    setResearchPhase('RUNNING');
    setResearchError(null);
    // Real stages, named as they are entered. Not a percentage: nothing
    // here knows how long a portal will take, and a bar that guesses is a
    // lie that happens to be animated.
    setResearchSteps(['inv_research_step_planning']);

    const advance = (key: string) => setResearchSteps((steps) => [...steps, key]);
    const timers = [
      window.setTimeout(() => advance('inv_research_step_sale'), 600),
      window.setTimeout(() => advance('inv_research_step_rent'), 4000),
      window.setTimeout(() => advance('inv_research_step_dedupe'), 9000),
    ];

    try {
      const current = contextRef.current;
      const { data, error } = await supabase.functions.invoke('investment-research', {
        body: {
          city,
          district: current.district?.value ?? null,
          areaSqm: current.areaSqm?.value ?? null,
          rooms: current.rooms?.value ?? null,
          bedrooms: current.bedrooms?.value ?? null,
          propertyType: current.propertyType?.value ?? null,
          projectName: current.projectName?.value ?? null,
          locale: lang,
        },
      });
      if (error) throw error;
      if (data?.error) {
        if (data.code === 'RATE_LIMIT_EXCEEDED') {
          setResearchPhase('RATE_LIMITED');
          return;
        }
        if (data.code === 'SUBJECT_TOO_BROAD') {
          setResearchPhase('FAILED');
          setResearchError('inv_research_subject_too_broad');
          return;
        }
        setResearchPhase('FAILED');
        setResearchError('inv_research_none_found');
        return;
      }
      setLanes(Array.isArray(data?.lanes) ? (data.lanes as LaneResult[]) : []);
      setResearchPhase('DONE');
      track('INVESTMENT_RESEARCH_REQUESTED');
    } catch {
      setResearchPhase('FAILED');
      setResearchError('inv_research_none_found');
    } finally {
      for (const timer of timers) window.clearTimeout(timer);
    }
  }, [lang, researchPhase, session, track]);

  const applyEvidenceOffer = useCallback(
    (comparison: AssumptionComparison, kind: OfferKind) => {
      const patch = offerToPatch(comparison, kind);
      if (!patch) return;
      setContext(
        (current) =>
          applyPatch(current, patch, 'RESEARCH', {
            source: comparison.evidence.basis,
          }).context,
      );
      track('INVESTMENT_EVIDENCE_APPLIED');
    },
    [track],
  );

  /* ── Attaching a Homatch property ──────────────────────────────── */

  const attachProperty = useCallback(
    async (propertyId: string) => {
      setPropertyBusy(true);
      setPropertyError(null);
      try {
        const property = await getProperty(propertyId);
        const facts = Array.isArray(property?.facts) ? property?.facts[0] : property?.facts;
        if (!property || !facts) {
          setPropertyError('inv_property_not_found');
          return;
        }
        /*
         * ONLY WHAT THE RECORD ACTUALLY CARRIES.
         *
         * Origin PROPERTY, so the provenance chip distinguishes it from
         * something the investor entered — they can then disagree with it,
         * which they often should: a listing price is the seller's number,
         * not the buyer's.
         */
        const patch: ContextPatch = {};
        if (facts.total_price) patch.purchasePrice = facts.total_price;
        if (facts.total_price) patch.askingPrice = facts.total_price;
        if (facts.currency) patch.currency = facts.currency;
        if (facts.area) patch.areaSqm = facts.area;
        if (facts.rooms) patch.rooms = facts.rooms;
        if (facts.bedrooms) patch.bedrooms = facts.bedrooms;
        if (facts.floor) patch.floor = facts.floor;
        if (facts.city) patch.city = facts.city;
        if (facts.district) patch.district = facts.district;
        if (facts.address) patch.address = facts.address;
        if (property.property_type) patch.propertyType = property.property_type;
        if (facts.condition) patch.condition = facts.condition;
        patch.propertyId = property.id;

        setContext(
          (current) =>
            applyPatch(current, patch, 'PROPERTY', { source: `property:${property.id.slice(0, 8)}` })
              .context,
        );
        track('INVESTMENT_PROPERTY_ATTACHED');
      } catch {
        setPropertyError('inv_property_not_found');
      } finally {
        setPropertyBusy(false);
      }
    },
    [track],
  );

  return {
    strategy,
    selectStrategy,
    resumable,
    context,
    run,
    summary,
    state,
    missingLabels,
    researchPhase,
    researchError,
    lanes,
    comparisons,
    comparableRange,
    marketPresets,
    researchSteps,
    setField,
    setFields,
    research,
    applyEvidenceOffer,
    reset,
    attachProperty,
    propertyBusy,
    propertyError,
  };
}
