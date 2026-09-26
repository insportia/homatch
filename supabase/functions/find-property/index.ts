// HOMATCH — FIND PROPERTY: the customer's side of the reverse direction.
//
// supply-matching is the worker: a cron token, no customer, writes supply_matches.
// This is the READ, and it is a different function for a reason that is not stylistic.
//
//   supply-matching  verify_jwt = false, private token, service role, WRITES
//   find-property    verify_jwt = true,  a real user, reads only THEIR results
//
// One function doing both would have to decide per-request whether it was trusting a
// shared worker token or a customer's identity, and a mistake in that branch is the
// difference between a customer seeing their own matches and seeing everybody's.
// supply_matches has RLS on with zero policies precisely so nothing can read it
// without passing through a function that checks the caller — and that is this one.
//
// WHAT IT WILL NOT DO
//
// Return a match for a demand signal the caller does not own. Ownership is resolved
// from the database, not from the request: the caller's user id comes out of their
// JWT, the subscription is looked up by that id, and only the intents that
// subscription points at are read. A caller passing somebody else's signal id gets
// nothing, because the query never sees their parameter.
//
// Invent a result. Every row returned is a persisted assessment produced by the same
// assessMatch() that the forward direction uses, with the dimension trace it was
// written with. There is no scoring here and no re-ranking: the order is the score the
// matcher recorded.
//
// WHAT IT RETURNS IS ALREADY PAID FOR
//
// These matches were produced by matching against supply_observations, which has no
// campaign_id and was funded by whoever triggered the sweep. Reading them costs
// nothing, so there is no reservation, no capture and no wallet read anywhere in this
// file. A locked/unlock model would be double-selling something the campaign already
// bought.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});

/** The most results one request returns. A list nobody scrolls is not a feature. */
const MAX_RESULTS = 60;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const baseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!baseUrl || !serviceKey) return json({ error: 'not configured' }, 500);

  const db = createClient(baseUrl, serviceKey, { auth: { persistSession: false } });

  /*
   * WHO IS ASKING, resolved from the token rather than from the body.
   *
   * The gateway already rejects a missing or malformed JWT before this runs
   * (verify_jwt = true), so this establishes WHICH user, not whether there is one.
   */
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Unauthorized' }, 401);

  const { data: caller } = await db.auth.getUser(token);
  if (!caller?.user) return json({ error: 'Unauthorized' }, 401);

  const { data: profile } = await db
    .from('users').select('id').eq('auth_id', caller.user.id).maybeSingle();
  if (!profile?.id) return json({ error: 'no Homatch profile for this account' }, 403);
  const userId = String(profile.id);

  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(MAX_RESULTS, Number(body.limit) || 20));

    /*
     * THE CALLER'S OWN SEARCHES, and this is the ownership boundary.
     *
     * side = 'SUPPLY' is a subscription watching for LISTINGS, which is what FIND
     * PROPERTY is. A seller watching for buyers is side = 'DEMAND' and belongs to the
     * forward direction and a different screen.
     */
    const { data: subscriptions, error: subError } = await db
      .from('active_search_subscriptions')
      .select('id,intent_id,search_criteria,is_active,created_at')
      .eq('user_id', userId)
      .eq('side', 'SUPPLY')
      .eq('is_active', true)
      .not('intent_id', 'is', null);
    if (subError) throw subError;

    const intentIds = [...new Set((subscriptions ?? [])
      .map((s: Record<string, unknown>) => String(s.intent_id))
      .filter(Boolean))];

    if (intentIds.length === 0) {
      /*
       * NOT AN ERROR, and not an empty list dressed up as one. A customer with no
       * active property search has nothing here yet, and the honest answer says which
       * of the two situations they are in.
       */
      return json({
        success: true,
        searches: 0,
        results: [],
        state: 'NO_ACTIVE_SEARCH',
        note: 'this account has no active property search. Nothing has been matched because '
          + 'nothing has been asked for.',
        elapsedMs: Date.now() - started,
      });
    }

    /*
     * The persisted assessments, best first, for the intents this caller owns.
     *
     * The order is the matcher's own score. Nothing is re-ranked here: a screen that
     * re-sorted results would be making a compatibility judgement, and compatibility
     * is decided once, deterministically, by research-core.
     */
    const { data: matches, error: matchError } = await db
      .from('supply_matches')
      .select('id,intent_profile_id,observation_id,match_score,compatibility,'
        + 'demand_role,supply_role,deal_kind,agreed,conflicted,preference_misses,'
        + 'unknown_dimensions,flexible_dimensions,rationale,dimensions,'
        + 'listing_age_days,listing_age_basis,created_at,'
        + 'observation:supply_observations!observation_id('
        + 'id,city,district,transaction,property_type,sale_amount,sale_currency,'
        + 'rent_amount,rent_currency,area_sqm,rooms,bedrooms,title,canonical_url,'
        + 'published_at,first_seen_at,last_verified_at,detected_language,adapter_id)')
      .in('intent_profile_id', intentIds)
      .eq('compatibility', 'COMPATIBLE')
      .order('match_score', { ascending: false })
      .limit(limit);
    if (matchError) throw matchError;

    const results = (matches ?? []).map((row: Record<string, unknown>) => {
      const joined: unknown = Array.isArray(row.observation)
        ? row.observation[0]
        : row.observation;
      const observation = (joined ?? null) as Record<string, unknown> | null;
      return {
        id: row.id,
        /* 0..1 as the matcher recorded it. Never rescaled to a percentage here: a
           number invented for display is a number nobody can trace. */
        score: Number(row.match_score ?? 0),
        deal: row.deal_kind,
        roles: { demand: row.demand_role, supply: row.supply_role },
        /* THE EXPLANATION, which is the product. A score without reasons is the
           opaque relevance this is meant to be an alternative to. */
        whyThisMatches: row.rationale,
        agreed: row.agreed,
        /* Named separately so a screen can say "not the district you preferred"
           rather than silently ranking it lower. */
        preferenceMisses: row.preference_misses,
        notStated: row.unknown_dimensions,
        flexible: row.flexible_dimensions,
        dimensions: row.dimensions,
        /* Four clocks, all four reported, because they answer different questions. */
        freshness: {
          publishedAt: observation?.published_at ?? null,
          firstSeenAt: observation?.first_seen_at ?? null,
          lastVerifiedAt: observation?.last_verified_at ?? null,
          listingAgeCeilingDays: row.listing_age_days,
          listingAgeCeilingBasis: row.listing_age_basis,
        },
        listing: observation
          ? {
            id: observation.id,
            title: observation.title,
            url: observation.canonical_url,
            city: observation.city,
            district: observation.district,
            transaction: observation.transaction,
            propertyType: observation.property_type,
            areaSqm: observation.area_sqm,
            rooms: observation.rooms,
            bedrooms: observation.bedrooms,
            price: observation.transaction === 'RENT'
              ? { amount: observation.rent_amount, currency: observation.rent_currency }
              : { amount: observation.sale_amount, currency: observation.sale_currency },
            language: observation.detected_language,
            /* Provenance is SECONDARY information and is labelled as such rather than
               leading: which adapter read it matters to an operator, not to a buyer. */
            source: observation.adapter_id,
          }
          : null,
      };
    });

    return json({
      success: true,
      searches: intentIds.length,
      results,
      /*
       * Three states, not two. "You have no search" and "your search found nothing
       * yet" are different situations with different next actions, and an empty array
       * cannot tell them apart.
       */
      state: results.length > 0 ? 'HAS_RESULTS' : 'SEARCHING',
      note: results.length > 0
        ? null
        : 'your search is active and nothing in the store matches it yet. Nothing was '
          + 'charged: these results come from intelligence Homatch already holds.',
      /* Said explicitly, because the absence of a paywall is a product decision. */
      included: true,
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
