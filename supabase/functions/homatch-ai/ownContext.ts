// HOMI internal context: the CALLER'S OWN rows, and nothing else.
//
// PRIVACY P0 (owner, 2026-10-29): another person's search requests, intents,
// properties, matches, reports or notes must never reach this person's AI
// context. Every retrieval HOMI makes for the prompt lives in this one file so
// it can be audited and tested in one place:
//
//   - `callerId` is public.users.id resolved by the edge function from the
//     VERIFIED JWT (sb.auth.getUser), never from the request body;
//   - every query filters on that id (or, for matches, on the ids of the
//     caller's own properties read here first);
//   - every returned row is checked AGAIN in code (defence in depth: a
//     mistaken or missing filter fails closed instead of leaking);
//   - other people's data (intent_profiles, external leads, other users'
//     searches) is not read at all. The old free-text ilike over every
//     user's intent_profiles.original_text is gone for good.
//
// Runtime-neutral: the edge function and node:test import it; the database
// client and the retention check are passed in.

export type OwnSection = 'verifications' | 'properties' | 'matches' | 'myGeorgia';

export interface OwnContext {
  verifications: any[];
  properties: any[];
  matches: any[];
  myGeorgia: any[];
}

export type RetentionFilter = (ids: string[]) => Promise<Set<string>>;

/** Tables HOMI may read for the prompt, and the column that scopes each to the caller. */
export const OWN_CONTEXT_TABLES = Object.freeze({
  research_jobs: 'user_id',
  expat_profiles: 'user_id',
  properties: 'user_id',
  matches: 'property_id (of the caller\'s own properties)',
});

/* Structured, locked preview fields of a match on the caller's own property.
   Deliberately NOT preview_excerpt: that is the other person's own words
   (their post or search text), and another person's words never enter this
   person's AI context. */
export const MATCH_COLUMNS = 'id,property_id,match_score,signal_strength,intent_confidence,match_reasons,mismatch_reasons,preview_platform,preview_language,preview_city,preview_budget_min,preview_budget_max,preview_currency';

const own = (row: any, callerId: string) => row && typeof row === 'object' && row.user_id === callerId;
const withoutOwner = ({ user_id: _u, ...rest }: any) => rest;

/**
 * Load the requested sections for `callerId`. A retrieval error is thrown to
 * the caller (the edge function turns it into "could not reach your saved
 * data", never into "you have none").
 */
export async function loadOwnContext(
  sb: any,
  callerId: string,
  sections: ReadonlySet<OwnSection>,
  expiredReports: RetentionFilter,
): Promise<OwnContext> {
  const out: OwnContext = { verifications: [], properties: [], matches: [], myGeorgia: [] };
  if (typeof callerId !== 'string' || callerId.length < 8) return out;

  /* THE RESEARCH THIS PERSON ALREADY PAID FOR: the synthesised, customer-facing
     summary (the words already on their screen), never result_json, which holds
     raw evidence, OCR and personal identification numbers. */
  if (sections.has('verifications')) {
    const { data: v, error } = await sb
      .from('research_jobs')
      .select('id,user_id,query,entity_name,address,project_name,developer_name,company_name,completed_at,synthesis_json')
      .eq('user_id', callerId)
      .eq('status', 'COMPLETE')
      .is('deleted_at', null)
      .order('completed_at', { ascending: false })
      .limit(5);
    if (error) throw error;
    let live: any[] = (v || []).filter((j: any) => own(j, callerId));
    // Retention (20261102090000): an expired report is not handed to the
    // assistant. If expiry cannot be checked, no report context is given.
    try {
      const expired = await expiredReports(live.map((j: any) => j.id));
      live = live.filter((j: any) => !expired.has(j.id));
    } catch {
      live = [];
    }
    out.verifications = live.map((j: any) => {
      const r = j.synthesis_json?.report;
      return {
        jobId: j.id,
        query: j.query,
        property: j.entity_name || j.project_name || j.address || null,
        developer: j.developer_name || j.company_name || null,
        completedAt: j.completed_at,
        verdict: r?.summary?.label ?? null,
        summary: r?.summary?.statement ?? null,
        keyFindings: (r?.keyFindings ?? []).slice(0, 5).map((f: any) => f?.finding).filter(Boolean),
        attentionPoints: (r?.attentionPoints ?? []).slice(0, 4).map((a: any) => a?.point).filter(Boolean),
      };
    });
  }

  /* MY GEORGIA BY HOMI: their own onboarding answers and their own note. */
  if (sections.has('myGeorgia')) {
    const { data: mg, error } = await sb
      .from('expat_profiles')
      .select('user_id,first_name,nationality,property_intent,cities,budget_band,rent_band,rent_amount,budget_currency,visit_status,arrival_date,arrival_unknown,stay_length,support_topics,personal_notes,onboarding_completed_at,household')
      .eq('user_id', callerId)
      .maybeSingle();
    if (error) throw error;
    if (own(mg, callerId) && (mg.onboarding_completed_at || mg.property_intent)) {
      out.myGeorgia = [{
        firstName: mg.first_name, country: mg.nationality, propertyIntent: mg.property_intent, cities: mg.cities,
        budgetBand: mg.budget_band, monthlyRent: mg.rent_band ? { band: mg.rent_band, amount: mg.rent_amount, currency: mg.budget_currency } : null,
        visitStatus: mg.visit_status, arrival: mg.arrival_unknown ? 'unknown' : mg.arrival_date, stay: mg.stay_length,
        wantsHelpWith: mg.support_topics, household: mg.household, ownNote: mg.personal_notes, completed: Boolean(mg.onboarding_completed_at),
      }];
    }
  }

  /* Their own properties, and the matches on THOSE properties only (MATCH_COLUMNS). */
  if (sections.has('properties') || sections.has('matches')) {
    const { data: p, error } = await sb.from('properties')
      .select('id,user_id,title,transaction_type,property_type,matching_status,property_facts(*)')
      .eq('user_id', callerId).eq('is_deleted', false).limit(15);
    if (error) throw error;
    const mine = (p || []).filter((x: any) => own(x, callerId));
    if (sections.has('properties')) out.properties = mine.map(withoutOwner);
    const ids: string[] = mine.map((x: any) => x.id);
    if (ids.length && sections.has('matches')) {
      const { data: m, error: mErr } = await sb.from('matches')
        .select(MATCH_COLUMNS)
        .in('property_id', ids).order('match_score', { ascending: false }).limit(30);
      if (mErr) throw mErr;
      const allowed = new Set(ids);
      out.matches = (m || []).filter((row: any) => allowed.has(row?.property_id));
    }
  }
  return out;
}
