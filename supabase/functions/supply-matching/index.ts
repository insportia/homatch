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
import { notify } from '../_shared/notify.ts';
import {
  assessMatch,
  type DemandSide,
  type StrengthMap,
  type SupplySide,
} from '../../../src/research-core/match/compatibility.ts';
import { supplyRoleFrom } from '../../../src/research-core/match/participants.ts';
import { attributionFrom } from '../../../src/research-core/match/broker-attribution.ts';
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
    /*
     * A TARGETED, NETWORK-ONLY RUN is what native intent asks for: "this person just
     * stated what they want — is there a Homatch property for it?" It reads no external
     * supply and writes no external match, so a requirement said in a chat cannot turn
     * into an acquisition of any kind.
     */
    const onlyProfiles: string[] = Array.isArray(body.intentProfileIds)
      ? (body.intentProfileIds as unknown[]).map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, MAX_DEMAND)
      : [];
    const nativeOnly = body.nativeOnly === true;
    const limit = Math.max(1, Math.min(nativeOnly ? 200 : MAX_DEMAND, Number(body.maxDemand) || (nativeOnly ? 200 : 10)));

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
        + 'intent_confidence,country,rooms_min,rooms_max,classifier_version,'
        + 'signal:raw_signals!signal_id(id,classification_status,platform),'
        /*
         * WHOSE DEMAND THIS IS, where it is anybody's.
         *
         * intent_profiles has no user column — it holds a requirement, not a person —
         * and the account is on the subscription that watches it. That is the canonical
         * join and it is the only thing that makes a native match have two identities;
         * an external demand read off a forum simply has no row here, which is the
         * honest answer rather than a gap.
         */
        + `subscriptions:active_search_subscriptions${nativeOnly ? '!inner' : ''}!intent_id(user_id,is_active,side,search_criteria)`)
      .not('city', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit * 4);
    if (onlySignal) demandQuery = demandQuery.eq('signal_id', onlySignal);
    if (onlyProfiles.length) demandQuery = demandQuery.in('id', onlyProfiles);
    if (nativeOnly) demandQuery = demandQuery.eq('subscriptions.is_active', true);

    const { data: demandRows, error: demandError } = await demandQuery;
    if (demandError) throw demandError;

    const eligible = (demandRows ?? []).filter((row: Record<string, unknown>) => {
      /*
       * A NATIVE DEMAND HAS NOTHING TO CLASSIFY.
       *
       * The gate below is right for an external row: a classifier's provisional reading
       * of a stranger's post must not reach a customer. A plan the customer was shown
       * and confirmed is not a reading of anything — planToIntentProfile writes
       * intent_confidence 1 for exactly this reason — and applying the external gate to
       * it made every demand Find Property persists invisible to this worker.
       */
      if (row.signal_id === null || row.signal_id === undefined) return true;
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
      /* The Homatch network pass, counted apart from the external one so a run can say
         which of the two produced what. */
      nativeCandidatesRead: 0,
      nativeCompatible: 0,
      nativePersisted: 0,
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
      /*
       * WHOSE DEMAND THIS IS. Null for an external signal, which is the correct answer
       * and the reason the native pass below is skipped for it: there is no Homatch
       * account on a forum post, and inventing one is the single thing this whole
       * distinction exists to prevent.
       */
      const subscriptions = (Array.isArray(demandRow.subscriptions)
        ? demandRow.subscriptions
        : demandRow.subscriptions ? [demandRow.subscriptions] : []) as Array<Record<string, unknown>>;
      const demandUserId = subscriptions.find((sub) => sub.is_active === true)?.user_id as
        string | undefined ?? null;

      /*
       * THE FIRMNESS THE PERSON STATED, where they stated one. A native demand carries its
       * own strength map on the subscription (search_criteria.strength) — REQUIRED,
       * PREFERRED, FLEXIBLE as the person said it, or as their confirmed plan said it.
       * Only a demand with no stated strengths falls back to the product default.
       */
      const activeSubscription = subscriptions.find((sub) => sub.is_active === true);
      const criteria = (activeSubscription?.search_criteria ?? {}) as Record<string, unknown>;
      const planStrength = (): StrengthMap | null => {
        /* A confirmed Search Plan stores each constraint as { value, strength }. */
        const map: Record<string, string> = {};
        const pick = (field: string, dimension: string) => {
          const entry = criteria[field] as { strength?: string } | null | undefined;
          if (entry && typeof entry === 'object' && entry.strength && entry.strength !== 'UNKNOWN') {
            map[dimension] = entry.strength;
          }
        };
        pick('city', 'CITY'); pick('districts', 'DISTRICT'); pick('propertyTypes', 'PROPERTY_TYPE');
        pick('budget', 'PRICE'); pick('bedrooms', 'BEDROOMS'); pick('areaSqm', 'AREA');
        return Object.keys(map).length ? map as StrengthMap : null;
      };
      const statedStrength = (criteria.strength && typeof criteria.strength === 'object')
        ? criteria.strength as StrengthMap
        : planStrength();
      const strength: StrengthMap = statedStrength && Object.keys(statedStrength).length
        ? { DISTRICT: 'PREFERRED', ...statedStrength }
        : { DISTRICT: 'PREFERRED' };

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
        roomsMin: (demandRow.rooms_min as number | null) ?? null,
        roomsMax: (demandRow.rooms_max as number | null) ?? null,
        strength,
      };

      /*
       * CANDIDATE SUPPLY, narrowed cheaply and imprecisely in SQL and decided precisely
       * in the module. placeNamesFor() supplies every spelling of the city this core
       * knows, because supply_observations holds one city as 'Tbilisi', 'tbilisi' and
       * 'თბილისი' -- an equality filter finds about half of them.
       */
      const cityNames = placeNamesFor(demand.city);
      /*
       * ILIKE, NOT IN, AND THE REASON IS MEASURED.
       *
       * placeNamesFor() returns the canonical spellings this core knows, and they are
       * all LOWERCASE because that is how the PLACES table stores them:
       *
       *   placeNamesFor('Tbilisi') -> ["tbilisi", "თბილისი", "тбилиси", "tiflis"]
       *
       * supply_observations holds 'Tbilisi' with a capital T on 12 rows, 'თბილისი' on 8
       * and 'tbilisi' on 1. Postgres IN is case-SENSITIVE, so `.in('city', names)` matched
       * 9 of 21 -- and the 12 it dropped included both rows old enough to fail the
       * publication-age ceiling, which is why a run that should have rejected two
       * rejected none.
       *
       * ilike without a wildcard is an exact case-insensitive match, which is precisely
       * the comparison wanted. comparePlaces() still decides per row afterwards; this only
       * has to stop the database hiding rows before the decision is reached.
       */
      const cityFilter = cityNames.map((name) => `city.ilike.${name}`).join(',');
      /* A network-only run reads no external supply at all. */
      const { data: candidates } = nativeOnly ? { data: [] as Record<string, unknown>[] } : await db
        .from('supply_observations')
        .select('id,city,district,transaction,property_type,sale_amount,sale_currency,'
          + 'rent_amount,rent_currency,area_sqm,rooms,bedrooms,published_at,'
          + 'first_seen_at,last_seen_at,last_verified_at,content_changed_at,expires_at,'
          + 'content_fingerprint,validation_state,failed_checks,adapter_id,source_status,'
          + 'supply_role,broker_id,title,description')
        .or(cityFilter)
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

        /*
         * THE ROLE COMES FROM THE ROLE COLUMN.
         *
         * It used to come from `source_status`, which holds AVAILABLE or null and has
         * never held a role -- so supplyRoleFrom returned null for every row, every one
         * of the 25 persisted matches carried supply_role null, and PARTICIPANTS was
         * UNKNOWN on all of them. BROKER and AGENCY were declared participants that had
         * never once participated.
         *
         * `supply_role` is written by discovery from the listing text. It is still null
         * far more often than not -- most listings do not say who is offering, and
         * UNKNOWN remains the honest answer for those -- but now it is null because the
         * listing was silent, not because the matcher was reading the wrong column.
         *
         * The fall back to the text is for rows discovered before that column existed:
         * re-reading their stored title and description costs no network and no credit,
         * and the alternative is a year of history permanently roleless.
         */
        const storedRole = supplyRoleFrom((supplyRow.supply_role as string | null) ?? null);
        const role = storedRole ?? attributionFrom({
          title: (supplyRow.title as string | null) ?? null,
          description: (supplyRow.description as string | null) ?? null,
        }).role;

        const supply: SupplySide = {
          role,
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

      /* ── THE HOMATCH NETWORK ──────────────────────────────────────────
       *
       * The same demand, against properties real accounts own. Only where the demand
       * itself belongs to an account: an external signal read off a forum has no
       * Homatch identity, and a match between it and a Homatch property could not offer
       * either side anybody to talk to.
       */
      if (demandUserId) {
        const { data: nativeRows } = await db
          .from('properties')
          .select('id,user_id,homatch_id,title,transaction_type,property_type,'
            + 'matching_status,archived_at,contact_phone_e164,'
            + 'facts:property_facts!property_id(city,district,total_price,currency,'
            + 'area,rooms,bedrooms)')
          .eq('is_deleted', false)
          .is('archived_at', null)
          .eq('matching_status', 'ACTIVE')
          /*
           * NOBODY MATCHES THEMSELVES. Filtered here so the work is not done, and
           * refused again by a CHECK constraint on the table so it cannot be reached by
           * a path that forgets. An owner who is also searching is an ordinary person,
           * not an edge case.
           */
          .neq('user_id', demandUserId)
          .limit(MAX_CANDIDATES);

        totals.nativeCandidatesRead += (nativeRows ?? []).length;
        /* Which properties still fit, so the ones that no longer do stop being shown. */
        const compatibleProperties: string[] = [];

        for (const candidate of nativeRows ?? []) {
          const propertyRow = candidate as Record<string, unknown>;
          const propertyFacts = (Array.isArray(propertyRow.facts)
            ? propertyRow.facts[0]
            : propertyRow.facts) as Record<string, unknown> | null | undefined;

          /*
           * A PROPERTY, SHAPED AS SUPPLY. The same SupplySide the observation path
           * builds, so assessMatch() cannot treat the two differently. A rent price and
           * a sale price are the same column on a property and the transaction type
           * says which, so only one of the two amounts is ever populated — putting the
           * figure in both would let a rental match a buyer's budget.
           */
          const transaction = String(propertyRow.transaction_type ?? '').toUpperCase();
          const amount = (propertyFacts?.total_price as number | null) ?? null;
          const amountCurrency = (propertyFacts?.currency as string | null) ?? null;
          const nativeSupply: SupplySide = {
            role: supplyRoleFrom('OWNER') ?? 'SELLER',
            transaction: transaction || null,
            city: (propertyFacts?.city as string | null) ?? null,
            district: (propertyFacts?.district as string | null) ?? null,
            propertyType: (propertyRow.property_type as string | null) ?? null,
            saleAmount: transaction === 'RENT' ? null : amount,
            saleCurrency: transaction === 'RENT' ? null : amountCurrency,
            rentAmount: transaction === 'RENT' ? amount : null,
            rentCurrency: transaction === 'RENT' ? amountCurrency : null,
            areaSqm: (propertyFacts?.area as number | null) ?? null,
            bedrooms: (propertyFacts?.bedrooms as number | null) ?? null,
            rooms: (propertyFacts?.rooms as number | null) ?? null,
          };

          const assessment = assessMatch(demand, nativeSupply, { minAgreements: MIN_AGREEMENTS });
          if (assessment.compatibility !== 'COMPATIBLE') continue;
          totals.nativeCompatible += 1;
          if (dryRun) continue;

          /*
           * ONE ROW PER RELATIONSHIP, FOREVER. The conflict target is the partial unique
           * index on (intent_profile_id, property_id): a tick that runs every hour
           * re-evaluates the pair rather than adding a tenth copy of the same flat to
           * somebody's list.
           */
          /*
           * ONE ROW PER RELATIONSHIP, FOREVER. Through a SQL function because the identity
           * is a PARTIAL unique index on (intent_profile_id, property_id), and PostgREST
           * cannot name a predicate in its conflict target — the upsert this replaced
           * failed on every call. The function does.
           */
          const { data: written, error: nativeError } = await db.rpc('upsert_native_match', {
            p: {
              intent_profile_id: demandRow.id as string,
              property_id: propertyRow.id as string,
              /* Resolved from the owning rows under the service role. Never from a
                 client — this table has RLS on and no policies. */
              supply_user_id: propertyRow.user_id as string,
              demand_user_id: demandUserId,
              campaign_id: campaignId,
              compatibility: assessment.compatibility,
              match_score: assessment.score,
              demand_role: assessment.roles.demand,
              supply_role: assessment.roles.supply,
              deal_kind: assessment.deal,
              agreed: assessment.agreed,
              conflicted: assessment.conflicted,
              preference_misses: assessment.preferenceMisses,
              unknown_dimensions: assessment.unknown,
              flexible_dimensions: assessment.flexible,
              rationale: assessment.rationale,
              dimensions: assessment.dimensions,
            },
          });

          if (nativeError) {
            totals.persistenceFailures += 1;
            results.push({ propertyId: propertyRow.id, error: nativeError.message });
            continue;
          }
          totals.nativePersisted += 1;

          /*
           * BOTH SIDES ARE TOLD, AND NOT THE SAME THING.
           *
           * The owner learns there is somebody whose stated requirements fit their
           * property; the searcher learns there is a property that fits what they
           * asked for. Neither sentence claims an intention nobody has expressed —
           * "you have a buyer" is a state that does not exist here.
           *
           * The dedupe key is the RELATIONSHIP, so the hourly re-evaluation above tells
           * nobody a second time; the group key collapses a first sweep that finds nine
           * into one interruption rather than nine.
           */
          const matchId = String(written ?? '');
          compatibleProperties.push(propertyRow.id as string);
          if (matchId) {
            await notify(db, {
              userId: String(propertyRow.user_id),
              type: 'MATCH_AVAILABLE',
              title: 'A Homatch member is looking for something like your property',
              body: 'Their stated requirements fit this property.',
              priority: 'NORMAL',
              deepLink: `/property/${propertyRow.id}/matches`,
              entityType: 'supply_match',
              entityId: matchId,
              dedupeKey: `native-match:${matchId}:supply`,
              groupKey: `native-match-supply:${propertyRow.id}`,
              groupWindow: '6 hours',
              /* A collapsed burst must say how many it collapsed. Without this the
                 aggregate row keeps the FIRST event's title and the other eight are
                 invisible — which is worse than nine interruptions, because the
                 customer does not know there is anything else to look at. */
              groupTitle: '{n} Homatch members are looking for something like your property',
              metadata: {
                kind: 'NATIVE_MATCH_SUPPLY',
                property_id: propertyRow.id,
                homatch_id: propertyRow.homatch_id ?? null,
              },
            });
            await notify(db, {
              userId: demandUserId,
              type: 'MATCH_AVAILABLE',
              title: 'A Homatch property may fit what you are looking for',
              body: String(demandRow.classifier_version ?? '') === 'search-plan-1.0.0'
                ? 'It fits the plan you confirmed.'
                : 'It fits the requirements you described.',
              priority: 'NORMAL',
              deepLink: '/find-property?view=homatch',
              entityType: 'supply_match',
              entityId: matchId,
              dedupeKey: `native-match:${matchId}:demand`,
              groupKey: `native-match-demand:${demandRow.id}`,
              groupWindow: '6 hours',
              groupTitle: '{n} Homatch properties match your search',
              metadata: {
                kind: 'NATIVE_MATCH_DEMAND',
                origin: String(demandRow.classifier_version ?? '') === 'search-plan-1.0.0' ? 'SEARCH_PLAN' : 'CONVERSATION',
                property_id: propertyRow.id,
                homatch_id: propertyRow.homatch_id ?? null,
              },
            });
          }
        }

        /* A property that no longer fits this demand stops being shown as a match. */
        if (!dryRun) {
          await db.rpc('retire_native_matches', {
            p_intent_profile_id: demandRow.id as string,
            p_keep: compatibleProperties,
          });
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
