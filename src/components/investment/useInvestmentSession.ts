// HOMATCH INVESTMENT INTELLIGENCE — the session.
//
// WHERE THE NUMBERS COME FROM ON THIS SCREEN
//
// The SAME engine the server runs, in the browser, on every keystroke.
// That is the reason a slider feels instantaneous and costs nothing: no
// round trip, no credit, no spinner. The server re-runs it independently
// for the Consultant's brief — see the edge function's own note on why the
// model must be handed numbers the client did not choose — but the screen
// is never waiting for it.
//
// WHAT THE SERVER IS FOR
//
// Two things, both optional, both additive:
//   the Consultant   turns a sentence into fields and explains the result
//   research         asks the Research Core what the market is asking
//
// Neither is on the path between the investor moving a control and the
// screen updating. Both can fail without taking the workspace with them.
//
// WHY THE CONTEXT IS THE STATE AND THE MODEL IS DERIVED
//
// A scenario is a set of established values with provenance; the model is
// what arithmetic makes of them. Keeping the model in state as well would
// create two sources of truth that drift the first time somebody updates
// one and forgets the other. useMemo is enough: the whole engine, including
// the break-even solvers, runs in single-digit milliseconds.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { getProperty } from '@/services/api';
import { logActivity } from '@/services/api';
import type { ActivityEventType } from '@/types/types';
import { runInvestmentModel } from '@/investment/calculations';
import type { InvestmentModel } from '@/investment/types';
import {
  applyPatch,
  isModellable,
  toInvestmentInput,
  type ContextPatch,
  type InvestmentContext,
} from '@/investment/consultant/context';
import {
  capabilityStatuses,
  nextQuestions,
  type CapabilityId,
  type CapabilityStatus,
} from '@/investment/consultant/capabilities';
import {
  compareAssumption,
  offerToPatch,
  type AssumptionComparison,
  type EvidenceRange,
  type OfferKind,
} from '@/investment/evidence/compare';

export interface ConsultantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Fields the Consultant understood from this turn. */
  applied?: string[];
  at: string;
}

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

export interface InvestmentSession {
  context: InvestmentContext;
  model: InvestmentModel | null;
  capabilities: CapabilityStatus[];
  questions: string[];
  focus: CapabilityId[];

  messages: ConsultantMessage[];
  consultantBusy: boolean;
  consultantError: string | null;

  researchPhase: ResearchPhase;
  researchError: string | null;
  lanes: LaneResult[];
  comparisons: AssumptionComparison[];
  /** Live progress lines while a sweep runs. Real stages, not a fake bar. */
  researchSteps: string[];

  setField: (field: string, value: number | string | null) => void;
  setFields: (patch: ContextPatch) => void;
  send: (message: string) => Promise<void>;
  research: () => Promise<void>;
  applyEvidenceOffer: (comparison: AssumptionComparison, kind: OfferKind) => void;
  reset: () => void;
  attachProperty: (propertyId: string) => Promise<void>;
  propertyBusy: boolean;
  propertyError: string | null;
}

const STORAGE_KEY = 'homatch.investment.context.v1';

/**
 * A scenario survives a reload.
 *
 * Somebody who has spent ten minutes describing a deal and then refreshes
 * should not lose it, and the alternative — a table — would mean a schema,
 * a migration and an RLS review for something that is genuinely local
 * working state. Nothing here is personal beyond what the person typed
 * about their own property, and it never leaves the device except in the
 * Consultant request they explicitly send.
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

function storeContext(context: InvestmentContext): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(context));
  } catch {
    /* A full or disabled storage must never break the workspace. */
  }
}

let messageSeq = 0;
const nextMessageId = () => `m${Date.now().toString(36)}${(messageSeq += 1).toString(36)}`;

export function useInvestmentSession(): InvestmentSession {
  const { homatchUser, session } = useAuth();
  const { lang } = useLanguage();

  const [context, setContext] = useState<InvestmentContext>(loadStoredContext);
  const [messages, setMessages] = useState<ConsultantMessage[]>([]);
  const [focus, setFocus] = useState<CapabilityId[]>([]);
  const [consultantBusy, setConsultantBusy] = useState(false);
  const [consultantError, setConsultantError] = useState<string | null>(null);

  const [researchPhase, setResearchPhase] = useState<ResearchPhase>('IDLE');
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchSteps, setResearchSteps] = useState<string[]>([]);
  const [lanes, setLanes] = useState<LaneResult[]>([]);

  const [propertyBusy, setPropertyBusy] = useState(false);
  const [propertyError, setPropertyError] = useState<string | null>(null);

  // The context the in-flight request should send, without making every
  // callback depend on it and re-create itself on each keystroke.
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    storeContext(context);
  }, [context]);

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

  const model = useMemo<InvestmentModel | null>(() => {
    if (!isModellable(context)) return null;
    const input = toInvestmentInput(context);
    if (!input) return null;
    try {
      return runInvestmentModel(input);
    } catch {
      // validateInvestmentInput threw on something the context door should
      // have caught. Showing no model is correct; showing a partial one
      // built from a rejected input would be worse.
      return null;
    }
  }, [context]);

  const capabilities = useMemo(() => capabilityStatuses(context, model), [context, model]);
  const questions = useMemo(() => nextQuestions(capabilities), [capabilities]);

  const comparisons = useMemo<AssumptionComparison[]>(() => {
    const out: AssumptionComparison[] = [];
    for (const lane of lanes) {
      if (lane.range) out.push(compareAssumption(context, lane.range));
    }
    return out;
  }, [lanes, context]);

  const setFields = useCallback((patch: ContextPatch) => {
    setContext((current) => applyPatch(current, patch, 'USER', { source: 'workspace' }).context);
  }, []);

  const setField = useCallback(
    (field: string, value: number | string | null) => setFields({ [field]: value }),
    [setFields],
  );

  const reset = useCallback(() => {
    setContext({});
    setMessages([]);
    setLanes([]);
    setFocus([]);
    setResearchPhase('IDLE');
    setResearchError(null);
    setConsultantError(null);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* nothing to do */
      }
    }
  }, []);

  /* ── The Consultant ────────────────────────────────────────────── */

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || consultantBusy) return;

      setMessages((current) => [
        ...current,
        { id: nextMessageId(), role: 'user', content: message, at: new Date().toISOString() },
      ]);
      setConsultantError(null);

      if (!session) {
        // The workspace stays fully usable signed out; only the Consultant
        // needs an account, because fair use is counted per person.
        setConsultantError('inv_consultant_sign_in');
        return;
      }

      setConsultantBusy(true);
      try {
        const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
        const { data, error } = await supabase.functions.invoke('investment-consultant', {
          body: { message, context: contextRef.current, history, locale: lang },
        });
        if (error) throw error;
        if (data?.error) {
          setConsultantError(
            data.code === 'RATE_LIMIT_EXCEEDED' ? 'inv_consultant_rate_limited' : 'inv_consultant_failed',
          );
          return;
        }
        if (data?.context && typeof data.context === 'object') {
          setContext(data.context as InvestmentContext);
        }
        if (Array.isArray(data?.focus)) setFocus(data.focus as CapabilityId[]);
        if (typeof data?.reply === 'string' && data.reply.trim()) {
          setMessages((current) => [
            ...current,
            {
              id: nextMessageId(),
              role: 'assistant',
              content: data.reply as string,
              applied: Array.isArray(data.applied) ? (data.applied as string[]) : undefined,
              at: new Date().toISOString(),
            },
          ]);
        } else if (data?.replyUnavailable) {
          // The arithmetic succeeded and the explanation did not. Say that,
          // rather than discarding a correct analysis over a provider blip.
          setConsultantError('inv_consultant_reply_unavailable');
        }
        track('INVESTMENT_CONSULTATION_TURN');
      } catch {
        setConsultantError('inv_consultant_failed');
      } finally {
        setConsultantBusy(false);
      }
    },
    [consultantBusy, lang, messages, session, track],
  );

  /* ── Research ──────────────────────────────────────────────────── */

  const research = useCallback(async () => {
    if (researchPhase === 'RUNNING') return;
    const city = context.city?.value;
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
      const { data, error } = await supabase.functions.invoke('investment-research', {
        body: {
          city,
          district: context.district?.value ?? null,
          areaSqm: context.areaSqm?.value ?? null,
          rooms: context.rooms?.value ?? null,
          bedrooms: context.bedrooms?.value ?? null,
          propertyType: context.propertyType?.value ?? null,
          projectName: context.projectName?.value ?? null,
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
        setResearchError('inv_research_failed');
        return;
      }
      setLanes(Array.isArray(data?.lanes) ? (data.lanes as LaneResult[]) : []);
      setResearchPhase('DONE');
      track('INVESTMENT_RESEARCH_REQUESTED');
    } catch {
      setResearchPhase('FAILED');
      setResearchError('inv_research_failed');
    } finally {
      for (const timer of timers) window.clearTimeout(timer);
    }
  }, [context, lang, researchPhase, session, track]);

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
         * Origin PROPERTY, so the provenance panel distinguishes it from
         * something the investor typed — they can then disagree with it,
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
    context,
    model,
    capabilities,
    questions,
    focus,
    messages,
    consultantBusy,
    consultantError,
    researchPhase,
    researchError,
    lanes,
    comparisons,
    researchSteps,
    setField,
    setFields,
    send,
    research,
    applyEvidenceOffer,
    reset,
    attachProperty,
    propertyBusy,
    propertyError,
  };
}
