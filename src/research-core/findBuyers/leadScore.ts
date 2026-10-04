// LEAD RANKING — an explainable score from named components, and one lead
// per person with every supporting signal attached (strongest/latest first).

import { INTENT_SCORE, QUALIFYING, type IntentClass } from './intent.ts';

export const LEAD_WEIGHTS = {
  similarity: 0.34, intent: 0.36, recency: 0.1, sourceQuality: 0.07, support: 0.07, specificity: 0.06,
} as const;

export const STRENGTH_THRESHOLDS = { STRONG: 80, GOOD: 65, POSSIBLE: 50 } as const;

export interface LeadSignal {
  signalId: string;
  parentSignalId: string | null;
  kind: 'POST' | 'COMMENT' | 'MESSAGE';
  source: string;
  intentClass: IntentClass;
  intentScore: number;
  similarity: number;
  ageDays: number | null;
  sourceQuality: number | null;
  /** Did the person state a budget, rooms or place (not inherited from parent)? */
  specific: boolean;
  text: string;
  url: string | null;
  parentUrl: string | null;
  parentExcerpt: string | null;
  language: string | null;
  publishedAt: string | null;
  explanation: string;
}

export interface ScoredLead {
  overall: number;
  strength: 'STRONG' | 'GOOD' | 'POSSIBLE' | null;
  components: Record<keyof typeof LEAD_WEIGHTS, number> & { penalties: number };
  best: LeadSignal;
  signals: LeadSignal[];
  qualified: boolean;
}

const recencyScore = (age: number | null) => (age == null ? 30 : age <= 3 ? 100 : age <= 7 ? 85 : age <= 14 ? 65 : age <= 30 ? 40 : 0);

export function signalStrength(s: LeadSignal): number {
  return 0.5 * s.intentScore + 0.4 * s.similarity + 0.1 * recencyScore(s.ageDays);
}

/** Score one person from all of their signals for this campaign. */
export function scoreLead(signals: LeadSignal[]): ScoredLead | null {
  const usable = signals.filter((s) => QUALIFYING.has(s.intentClass));
  if (!usable.length) return null;
  const ordered = [...usable].sort((a, b) => signalStrength(b) - signalStrength(a)
    || Date.parse(b.publishedAt ?? '0') - Date.parse(a.publishedAt ?? '0'));
  const best = ordered[0];
  const support = Math.min(100, 50 + 25 * (ordered.length - 1));
  const components = {
    similarity: best.similarity,
    intent: best.intentScore,
    recency: recencyScore(best.ageDays),
    sourceQuality: Math.round(100 * (best.sourceQuality ?? 0.5)),
    support,
    specificity: ordered.some((s) => s.specific) ? 100 : 40,
    penalties: 0,
  };
  /* Demand older than 30 days is history, not current demand. */
  if (best.ageDays != null && best.ageDays > 30) components.penalties += 25;
  const raw = (Object.keys(LEAD_WEIGHTS) as Array<keyof typeof LEAD_WEIGHTS>)
    .reduce((sum, k) => sum + LEAD_WEIGHTS[k] * components[k], 0) - components.penalties;
  const overall = Math.max(0, Math.min(100, Math.round(raw)));
  const strength = overall >= STRENGTH_THRESHOLDS.STRONG ? 'STRONG'
    : overall >= STRENGTH_THRESHOLDS.GOOD ? 'GOOD'
    : overall >= STRENGTH_THRESHOLDS.POSSIBLE ? 'POSSIBLE' : null;
  return { overall, strength, components, best, signals: ordered, qualified: strength !== null };
}

export function intentScoreOf(c: IntentClass): number { return INTENT_SCORE[c]; }
