// MY GEORGIA BY HOMI — reading and saving the onboarding answers.
//
// Signed in, every step autosaves to public.expat_profiles (owner-only RLS);
// the database keeps the Matching search in step by itself (trigger, migration
// 20261203091000), so nothing here writes Matching. Signed out, the answers
// wait on this device and are saved to the account after sign up.

import { supabase } from '@/db/supabase';
import { roadmapFor } from '@/expats/plan/roadmap';
import { EMPTY_PROFILE } from '@/expats/types';
import { getProfile, saveProfile, writePlan } from '@/services/expats';
import {
  EMPTY_ANSWERS, normalise, toPlanProfile,
  type MyGeorgiaAnswers,
} from '@/myGeorgia/answers';

export interface MyGeorgiaState {
  answers: MyGeorgiaAnswers;
  /** 0 = not started, 1 to 5 = the step to resume at, 6 = done. */
  step: number;
  completedAt: string | null;
}

const DRAFT_KEY = 'homatch.myGeorgia.draft.v1';

export function loadDraft(): MyGeorgiaState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as MyGeorgiaState;
    return d && d.answers ? { ...d, answers: { ...EMPTY_ANSWERS, ...d.answers } } : null;
  } catch {
    return null;
  }
}

export function saveDraft(state: MyGeorgiaState): void {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

export function clearDraft(): void {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
}

export async function loadMyGeorgia(userId: string): Promise<MyGeorgiaState | null> {
  const { data } = await supabase
    .from('expat_profiles')
    .select('first_name, last_name, nationality, property_intent, cities, budget_band, rent_band, rent_amount, budget_currency, visit_status, arrival_date, arrival_unknown, stay_length, support_topics, personal_notes, onboarding_step, onboarding_completed_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    step: Number(r.onboarding_step ?? 0),
    completedAt: (r.onboarding_completed_at as string) ?? null,
    answers: {
      firstName: (r.first_name as string) ?? '',
      lastName: (r.last_name as string) ?? '',
      country: (r.nationality as string) ?? null,
      propertyIntent: (r.property_intent as MyGeorgiaAnswers['propertyIntent']) ?? null,
      cities: (r.cities as MyGeorgiaAnswers['cities']) ?? [],
      budgetBand: (r.budget_band as MyGeorgiaAnswers['budgetBand']) ?? null,
      rentBand: (r.rent_band as MyGeorgiaAnswers['rentBand']) ?? null,
      rentAmount: r.rent_amount === null || r.rent_amount === undefined ? null : Number(r.rent_amount),
      rentCurrency: ((r.budget_currency as MyGeorgiaAnswers['rentCurrency']) ?? 'USD'),
      visitStatus: (r.visit_status as MyGeorgiaAnswers['visitStatus']) ?? null,
      arrivalDate: (r.arrival_date as string) ?? null,
      arrivalUnknown: Boolean(r.arrival_unknown),
      stayLength: (r.stay_length as MyGeorgiaAnswers['stayLength']) ?? null,
      supportTopics: (r.support_topics as MyGeorgiaAnswers['supportTopics']) ?? [],
      notes: (r.personal_notes as string) ?? '',
    },
  };
}

/**
 * Autosave. Writes the answers and the step to resume at; on the last step
 * also marks the profile complete and writes the plan from the same answers.
 */
export async function saveMyGeorgia(
  userId: string,
  raw: MyGeorgiaAnswers,
  step: number,
  complete = false,
): Promise<{ error: string | null }> {
  const a = normalise(raw);
  /* The plan engine's fields first (nationality, arrival, city, housing), so
     the For Expats plan and My Georgia never disagree about the person. */
  const base = (await getProfile(userId)) ?? EMPTY_PROFILE;
  const planProfile = toPlanProfile(a, base);
  const first = await saveProfile(userId, planProfile);
  if (first.error) return first;

  const { error } = await supabase
    .from('expat_profiles')
    .update({
      first_name: a.firstName || null,
      last_name: a.lastName || null,
      property_intent: a.propertyIntent,
      cities: a.cities,
      budget_band: a.budgetBand,
      rent_band: a.rentBand,
      rent_amount: a.rentAmount,
      budget_currency: a.propertyIntent === 'RENT' ? a.rentCurrency : null,
      visit_status: a.visitStatus,
      arrival_unknown: a.arrivalUnknown,
      stay_length: a.stayLength,
      support_topics: a.supportTopics,
      personal_notes: a.notes.trim() ? a.notes : null,
      onboarding_step: complete ? 6 : Math.max(0, Math.min(5, step)),
      ...(complete ? { onboarding_completed_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (error) return { error: error.message };

  if (complete) {
    const plan = await writePlan(userId, roadmapFor(planProfile));
    if (plan.error) return plan;
  }
  return { error: null };
}
