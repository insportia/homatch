// HOMATCH — FIND PROPERTY: which listing fits this person.
//
// The direction the product did not have. run-matching-v2 fixes a PROPERTY and
// iterates demand, which answers "who wants this flat" and writes `matches`. This
// fixes a DEMAND and iterates supply, which answers "which flat fits this person" and
// writes `supply_matches`.
//
// IT IS THE SAME COMPARISON. Both call assessMatch() in research-core, so the two
// directions cannot disagree about a pair — a flat that matches a buyer is a flat
// whose buyer matches it. Nothing here re-implements compatibility, and if it ever
// starts to, the seam has stopped being a seam.
//
// EXISTING INTELLIGENCE FIRST, AND THAT IS THE WHOLE POINT
//
// This worker acquires nothing. It reads the global store Homatch already paid for
// and matches against it, which is the cheapest lead in the system:
//
//   supply_observations has no campaign_id, so one sweep serves every campaign
//   every row it reads was already funded by whoever triggered the sweep
//   two campaigns wanting the same market do NOT each fetch: they each match
//
// External acquisition is supply-discovery's job and is gated by the coverage
// assessment there. By the time this runs, the question "do we need to go outside" has
// already been answered.
//
// FOUR CLOCKS, KEPT APART
//
// A listing can be current in one sense and stale in three others, and this function
// refuses to collapse them:
//
//   discovered_at      when Homatch first saw it
//   last_verified_at   when we last confirmed it — judgeDelivery()'s question
//   published_at       when the SELLER spoke — the listing-age policy's question
//   content_changed_at when the text moved
//
// A TOUCH can make the second current while the third is four years old, which is
// precisely what the first live Telegram sync produced: seven posts from 2022, all
// "FRESH". So delivery freshness and publication age are checked SEPARATELY and a row
// must pass both.
//
// NOTHING IS CHARGED HERE. No reservation, no capture, no wallet read. Matching
// against intelligence already held is not a billable acquisition, and a worker that
// quietly billed for it would be charging twice for one sweep.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  assessMatch,
  type DemandSide,
  type StrengthMap,
  type SupplySide,
} from '../../../src/research-core/match/compatibility.ts';
import { supplyRoleFrom } from '../../../src/research-core/match/participants.ts';
import { placeNamesFor } from '../../../src/research-core/normalize/place.ts';
import { judgeDelivery } from '../../../src/research-core/discovery/revalidation.ts';
import {
  ageCeilingMs,
  describeCeiling,
  listingContextFrom,
  resolveAgeCeiling,
  type AgeCeilingConfig,
} from '../../../src/research-core/discovery/listing-age-policy.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});

/** How many candidate listings one demand row is compared against per run. */
const MAX_CANDIDATES = 500;

/** How many demand rows a single tick will serve. */
const MAX_DEMAND = 25;

/**
 * The floor for calling a pair a match.
 *
 * Three, not the module's default of two. Production rows are sparse and a pair
 * agreeing on only the transaction and the city is a coincidence — it would pair
 * every Tbilisi enquiry with every Tbilisi listing, which is the failure mode that
 * makes a match list worthless.
 */
const MIN_AGREEMENTS = 3;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const baseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!baseUrl || !serviceKey) return json({ error: 'not configured' }, 500);

  const db = createClient(baseUrl, serviceKey, { auth: { persistSession: false } });

  /* A worker tick: no customer, no user JWT, authenticated on a private token. */
  const presented = req.headers.get('x-cron-token') || '';
  const authorization = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (authorization !== serviceKey) {
    const { data: tokenRow } = await db
      .from('admin_settings').select('value').eq('key', 'supply_matching_token').maybeSingle();
    const expected = String(tokenRow?.value ?? '').replace(/^"|"$/g, '');
    if (!expected || presented !== expected) return json({ error: 'Forbidden' }, 403);
  }

  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun === true;
    const campaignId = body.campaignId ? String(body.campaignId) : null;
    const onlySignal = body.signalId ? String(body.signalId) : null;
    const limit = Math.max(1, Math.min(MAX_DEMAND, Number(body.maxDemand) || 10));

    /*
     * THE DEMAND SIDE, and only what is already allowed to be shown.
     *
     * classification_status CLASSIFIED is the same gate run-matching-v2 enforces: a
     * PENDING row carries the cheap regex verdict, not the real classification, and a
     * provisional guess must never reach a customer. This is why the seven live
     * Telegram rows do not appear here yet, and that is correct rather than a bug.
     */
    let demandQuery = db
      .from('intent_profiles')
      .select('id,signal_id,intent_type,transaction_type,city,district,property_types,'
        + 'bedrooms_min,bedrooms_max,area_min,area_max,budget_min,budget_max,currency,'
        + 'intent_confidence,country,'
        + 'signal:raw_signals!signal_id(id,classification_status,platform)')
      .not('city', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit * 4);
    if (onlySignal) demandQuery = demandQuery.eq('signal_id', onlySignal);

    const { data: demandRows, error: demandError } = await demandQuery;
    if (demandError) throw demandError;

    const eligible = (demandRows ?? []).filter((row: Record<string, unknown>) => {
      const signal = Array.isArray(row.signal) ? row.signal[0] : row.signal;
      return String((signal as Record<string, unknown>)?.classification_status ?? '') === 'CLASSIFIED';
    }).slice(0, limit);

    if (!eligible.length) {
      return json({
        success: true,
        demandConsidered: (demandRows ?? []).length,
        demandEligible: 0,
        note: (demandRows ?? []).length === 0
          ? 'no intent_profiles row states a city'
          : 'every candidate demand row is still awaiting classification; a provisional '
            + 'verdict must not reach a customer, so none is matched',
        elapsedMs: Date.now() - started,
      });
    }

    /* The operator's age ceilings, read once for the whole tick. */
    const { data: ceilingRow } = await db
      .from('admin_settings').select('value').eq('key', 'listing_age_ceilings').maybeSingle();
    const ceilingConfig: AgeCeilingConfig | undefined = (() => {
      const raw = ceilingRow?.value;
      if (raw && typeof raw === 'object') return raw as AgeCeilingConfig;
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === 'object' ? parsed as AgeCeilingConfig : undefined;
        } catch { return undefined; }
      }
      return undefined;
    })();

    const results: Array<Record<string, unknown>> = [];
    const totals = {
      demandServed: 0,
      candidatesRead: 0,
      /* Rows the global store answered without anything being fetched. THE number
         that makes existing-intelligence-first worth having. */
      reusedFromStore: 0,
      rejectedStaleDelivery: 0,
      rejectedPublicationAge: 0,
      compatible: 0,
      incompatible: 0,
      insufficient: 0,
      persisted: 0,
      persistenceFailures: 0,
      /* Always zero here, asserted rather than assumed: this worker acquires nothing. */
      networkFetches: 0,
    };

    for (const row of eligible) {
      const demandRow = row as Record<string, unknown>;
      const signal = Array.isArray(demandRow.signal) ? demandRow.signal[0] : demandRow.signal;
      const signalId = String((signal as Record<string, unknown>)?.id ?? demandRow.signal_id);

      /*
       * STRENGTH FROM WHAT THE ROW ACTUALLY SAYS.
       *
       * intent_profiles has no strength columns, so nothing here invents one. What it
       * does have is a specificity_score and explicit fields, and the honest reading
       * is: a field the person stated is REQUIRED, and a district is the one thing
       * routinely expressed as a preference rather than a rule -- people say "ideally
       * Saburtalo" far more often than they say "Saburtalo or nothing".
       *
       * That single PREFERRED is a product judgement and it is written down as one. It
       * is not derived from a model and it is not a guess about this person; it is the
       * default the product applies until the intake actually asks.
       */
      const strength: StrengthMap = { DISTRICT: 'PREFERRED' };

      const demand: DemandSide = {
        intentType: (demandRow.intent_type as string | null) ?? null,
        transactionType: (demandRow.transaction_type as string | null) ?? null,
        city: (demandRow.city as string | null) ?? null,
        district: (demandRow.district as string | null) ?? null,
        propertyTypes: (demandRow.property_types as string[] | null) ?? null,
        budgetMin: demandRow.budget_min as number | null,
        budgetMax: demandRow.budget_max as number | null,
        currency: (demandRow.currency as string | null) ?? null,
        areaMin: demandRow.area_min as number | null,
        areaMax: demandRow.area_max as number | null,
        bedroomsMin: demandRow.bedrooms_min as number | null,
        bedroomsMax: demandRow.bedrooms_max as number | null,
        strength,
      };

      /*
       * CANDIDATE SUPPLY, narrowed cheaply and imprecisely in SQL and decided precisely
       * in the module. placeNamesFor() supplies every spelling of the city this core
       * knows, because supply_observations holds one city as 'Tbilisi', 'tbilisi' and
       * 'თბილისი' -- an equality filter finds about half of them.
       */
      const cityNames = placeNamesFor(demand.city);
      const { data: candidates } = await db
        .from('supply_observations')
        .select('id,city,district,transaction,property_type,sale_amount,sale_currency,'
          + 'rent_amount,rent_currency,area_sqm,rooms,bedrooms,published_at,'
          + 'first_seen_at,last_seen_at,last_verified_at,content_changed_at,expires_at,'
          + 'content_fingerprint,validation_state,failed_checks,adapter_id,source_status')
        .in('city', cityNames)
        .limit(MAX_CANDIDATES);

      totals.candidatesRead += (candidates ?? []).length;
      totals.reusedFromStore += (candidates ?? []).length;

      const assessments: Array<{ observationId: string; assessment: ReturnType<typeof assessMatch>; ageDays: number; ageBasis: string }> = [];

      for (const candidate of candidates ?? []) {
        const supplyRow = candidate as Record<string, unknown>;

        /*
         * CLOCK ONE: may this be shown at all? judgeDelivery() answers whether our
         * OBSERVATION is current, which is a question about us.
         */
        const delivery = judgeDelivery({
          firstSeenAt: String(supplyRow.first_seen_at),
          lastSeenAt: String(supplyRow.last_seen_at),
          lastVerifiedAt: (supplyRow.last_verified_at as string | null) ?? null,
          contentChangedAt: (supplyRow.content_changed_at as string | null) ?? null,
          expiresAt: (supplyRow.expires_at as string | null) ?? null,
          contentFingerprint: String(supplyRow.content_fingerprint ?? ''),
          validationState: String(supplyRow.validation_state ?? 'UNVERIFIED') as never,
          failedChecks: Number(supplyRow.failed_checks ?? 0),
        });
        if (!delivery.deliverable) {
          totals.rejectedStaleDelivery += 1;
          continue;
        }

        /*
         * CLOCK TWO: is the CLAIM still worth making? A separate question about the
         * SELLER, and the one a TOUCH cannot answer. Seven 2022 Telegram posts were
         * "FRESH" by clock one and four years old by this one.
         */
        const context = listingContextFrom({
          transaction: (supplyRow.transaction as string | null) ?? null,
          propertyType: (supplyRow.property_type as string | null) ?? null,
        });
        const ceiling = resolveAgeCeiling(context, {
          market: (demandRow.country as string | null) ?? null,
          config: ceilingConfig,
        });
        const publishedAt = supplyRow.published_at as string | null;
        if (publishedAt) {
          const published = Date.parse(publishedAt);
          if (Number.isFinite(published) && Date.now() - published > ageCeilingMs(ceiling)) {
            totals.rejectedPublicationAge += 1;
            continue;
          }
        }

        const supply: SupplySide = {
          /* The adapter tells us what KIND of source this is; a portal listing carries
             no role of its own, so this is null far more often than not and the
             PARTICIPANTS dimension is honestly UNKNOWN for it. */
          role: supplyRoleFrom((supplyRow.source_status as string | null) ?? null),
          transaction: (supplyRow.transaction as string | null) ?? null,
          city: (supplyRow.city as string | null) ?? null,
          district: (supplyRow.district as string | null) ?? null,
          propertyType: (supplyRow.property_type as string | null) ?? null,
          saleAmount: supplyRow.sale_amount as number | null,
          saleCurrency: (supplyRow.sale_currency as string | null) ?? null,
          rentAmount: supplyRow.rent_amount as number | null,
          rentCurrency: (supplyRow.rent_currency as string | null) ?? null,
          areaSqm: supplyRow.area_sqm as number | null,
          bedrooms: supplyRow.bedrooms as number | null,
          rooms: supplyRow.rooms as number | null,
        };

        const assessment = assessMatch(demand, supply, { minAgreements: MIN_AGREEMENTS });
        if (assessment.compatibility === 'COMPATIBLE') totals.compatible += 1;
        else if (assessment.compatibility === 'INCOMPATIBLE') totals.incompatible += 1;
        else totals.insufficient += 1;

        if (assessment.compatibility === 'COMPATIBLE') {
          assessments.push({
            observationId: String(supplyRow.id),
            assessment,
            ageDays: ceiling.days,
            ageBasis: ceiling.basis,
          });
        }
      }

      assessments.sort((a, b) => b.assessment.score - a.assessment.score);

      /*
       * PERSIST ONLY THE COMPATIBLE ONES. There is no product reason to store every
       * pair that failed, and a table full of refusals makes the ones that matter
       * harder to find. The counters above record how many were considered.
       */
      if (!dryRun) {
        for (const entry of assessments) {
          const { error: writeError } = await db.from('supply_matches').upsert({
            intent_profile_id: demandRow.id as string,
            signal_id: signalId,
            observation_id: entry.observationId,
            campaign_id: campaignId,
            compatibility: entry.assessment.compatibility,
            match_score: entry.assessment.score,
            demand_role: entry.assessment.roles.demand,
            supply_role: entry.assessment.roles.supply,
            deal_kind: entry.assessment.deal,
            agreed: entry.assessment.agreed,
            conflicted: entry.assessment.conflicted,
            preference_misses: entry.assessment.preferenceMisses,
            unknown_dimensions: entry.assessment.unknown,
            flexible_dimensions: entry.assessment.flexible,
            rationale: entry.assessment.rationale,
            dimensions: entry.assessment.dimensions,
            listing_age_days: entry.ageDays,
            listing_age_basis: entry.ageBasis,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'signal_id,observation_id' });

          if (writeError) {
            /* NEVER SWALLOWED. A refused write that increments nothing is
               indistinguishable from a run that found nothing to write. */
            totals.persistenceFailures += 1;
            results.push({
              signalId, observationId: entry.observationId,
              error: writeError.message,
            });
          } else {
            totals.persisted += 1;
          }
        }
      }

      totals.demandServed += 1;
      results.push({
        signalId,
        intentProfileId: demandRow.id,
        city: demand.city,
        intent: demand.intentType,
        candidatesConsidered: (candidates ?? []).length,
        compatible: assessments.length,
        best: assessments[0]
          ? {
            observationId: assessments[0].observationId,
            score: assessments[0].assessment.score,
            deal: assessments[0].assessment.deal,
            rationale: assessments[0].assessment.rationale,
            preferenceMisses: assessments[0].assessment.preferenceMisses,
          }
          : null,
        ...(dryRun ? { dryRun: true } : {}),
      });
    }

    return json({
      success: true,
      demandConsidered: (demandRows ?? []).length,
      demandEligible: eligible.length,
      totals,
      /*
       * SAID OUT LOUD, because it is the economic claim the whole store rests on: this
       * worker matched against intelligence Homatch already held and fetched nothing.
       */
      acquisition: {
        networkFetches: 0,
        note: 'this worker performs no external acquisition. Every candidate was read from '
          + 'supply_observations, which has no campaign_id, so one sweep serves every '
          + 'campaign and nothing was paid for twice.',
      },
      results,
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
