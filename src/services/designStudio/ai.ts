// Asking HOMATCH's AI designer for proposals.
//
// The request carries a structured brief; the answer is a plan the server
// has already validated against the catalogue, the rooms and what the
// customer keeps. Nothing here changes a design: see lib/designStudio/aiPlan.ts.

import { supabase } from '@/db/supabase';
import type { ValidatedPlan } from '@/lib/designStudio/aiPlan';
import { normalizePreferences, type DesignPreferences } from '@/lib/designStudio/planToHome';
import { DesignStudioError } from './projects';

export interface DesignBrief {
  styleCode: string | null;
  palette: string[];
  text: string;
  roomIds: string[];
  alternatives: number;
  /** The customer's chosen look (plan-to-home); the server holds the plan to it. */
  preferences?: DesignPreferences;
}

export async function requestDesign(versionId: string, brief: DesignBrief): Promise<{ jobId: string; plan: ValidatedPlan }> {
  const { data, error } = await supabase.functions.invoke('design-studio-reconstruct/design', { body: { versionId, brief } });
  if (error) {
    let code = 'DS_AI_FAILED';
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (typeof body?.reason === 'string') code = `DS_AI_${body.reason}`;
      else if (typeof body?.error === 'string') code = `DS_AI_${body.error}`;
    } catch { /* keep the generic code */ }
    throw new DesignStudioError(code);
  }
  const r = data as { jobId?: string; plan?: ValidatedPlan } | null;
  if (!r?.jobId || !r.plan || !Array.isArray(r.plan.alternatives)) throw new DesignStudioError('DS_AI_FAILED');
  return { jobId: r.jobId, plan: r.plan };
}

/**
 * Plan-to-home: the customer's chosen look → one validated design intent.
 * The server shows the model only what fits the look and holds the answer
 * to it (materials of the chosen direction, wall colours of the chosen
 * family, the furnishing cap, room semantics); apply it with
 * planToOperations(alt, { …, furnishing: preferences.furnishing }).
 * The jobId is the AI provenance every applied operation must name.
 */
export async function designFromPreferences(input: {
  versionId: string;
  preferences: DesignPreferences;
  /** Rooms in scope; empty or omitted = the whole home. */
  roomIds?: string[];
}): Promise<{ jobId: string; plan: ValidatedPlan }> {
  const preferences = normalizePreferences(input.preferences);
  return requestDesign(input.versionId, {
    styleCode: preferences.style,
    palette: [],
    text: preferences.brief,
    roomIds: input.roomIds ?? [],
    alternatives: 1,
    preferences,
  });
}
