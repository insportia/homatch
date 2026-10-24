// For Expats — the guided journey's answers, read from and written to the existing profile.
//
// Re-opening the journey starts from what the plan already says, so "მონაცემების შეცვლა" never
// silently resets anything, and an exact arrival date the person typed elsewhere survives as
// long as the timing answer still describes it.

import type { ExpatIntent, HousingPlan } from './types';

export type Reason = 'LIVE' | 'WORK' | 'STUDY' | 'INVEST' | 'BROWSING';
export type When = 'MONTH' | 'QUARTER' | 'HALF_YEAR' | 'LATER' | 'HERE';
export type Housing = 'RENT' | 'BUY' | 'CHOSEN' | 'SEARCH';

const DAY = 86_400_000;
export const OFFSET_DAYS: Record<When, number> = { MONTH: 21, QUARTER: 60, HALF_YEAR: 135, LATER: 240, HERE: 0 };
export const INTENTS: Record<Reason, ExpatIntent[]> = {
  LIVE: ['MOVE', 'LIVE'], WORK: ['MOVE', 'BUSINESS'], STUDY: ['MOVE', 'STUDY'], INVEST: ['INVEST', 'BUY'], BROWSING: ['LIVE'],
};
export const HOUSING_PLAN: Record<Housing, HousingPlan> = { SEARCH: 'RENT', RENT: 'RENT', BUY: 'BUY', CHOSEN: 'UNDECIDED' };

export function reasonFromIntents(intents: readonly ExpatIntent[]): Reason | null {
  if (!intents.length) return null;
  if (intents.includes('STUDY')) return 'STUDY';
  if (intents.includes('BUSINESS')) return 'WORK';
  if (intents.includes('INVEST') || intents.includes('BUY')) return 'INVEST';
  if (intents.includes('MOVE')) return 'LIVE';
  return 'BROWSING';
}

export function whenFromArrival(arrival: string | null, now = Date.now()): When | null {
  if (!arrival) return null;
  const days = (Date.parse(arrival) - now) / DAY;
  if (!Number.isFinite(days)) return null;
  if (days <= 0) return 'HERE';
  if (days <= 31) return 'MONTH';
  if (days <= 92) return 'QUARTER';
  if (days <= 183) return 'HALF_YEAR';
  return 'LATER';
}

export function housingFromPlan(plan: HousingPlan | null): Housing | null {
  return plan === 'RENT' ? 'RENT' : plan === 'BUY' ? 'BUY' : null;
}

/** The arrival date the answers imply; an existing date moves only when the timing answer changed. */
export function arrivalFor(when: When, existing: string | null, now = Date.now()): string {
  if (existing && whenFromArrival(existing, now) === when) return existing;
  if (when === 'HERE') return existing && Date.parse(existing) <= now ? existing : new Date(now).toISOString().slice(0, 10);
  return new Date(now + OFFSET_DAYS[when] * DAY).toISOString().slice(0, 10);
}

/** An unchanged reason keeps the intents the person may have refined in the profile. */
export function intentsFor(reason: Reason, existing: readonly ExpatIntent[]): ExpatIntent[] {
  return reasonFromIntents(existing) === reason ? [...existing] : INTENTS[reason];
}
