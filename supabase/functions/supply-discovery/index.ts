// HOMATCH — reading the market, in production, and keeping what it said.
//
// This is the production discovery path. It builds the same
// createPortalRuntime() the market lane uses — SSRF host allowlist, robots
// checker, per-source rate limiter, circuit breaker, request coalescer,
// document cache — asks each permitted adapter for listings, and writes what
// comes back into the global intelligence store.
//
// WHY THE RESULT IS NOT OWNED BY A CAMPAIGN
//
// supply_observations has no campaign_id. A campaign that asks for Tbilisi
// sale listings pays for the fetch; the SECOND campaign in the same market
// reuses the rows rather than re-fetching, and that reuse is the entire
// economic argument for a discovery network over a per-campaign scraper.
// campaign_supply_references records which campaign used what, and whether it
// discovered or reused it.
//
// WHICH SOURCES IT MAY READ
//
// Only those the registry says are scannable: lifecycle LIVE_TESTED or
// PRODUCTIVE, and active. A source that has only been fixture-tested has
// never been proven to return real content, and a customer's budget is not
// the place to find out. The check is made against the DATABASE rather than
// against the adapter list, because the adapter existing is not permission.
//
// WHEN A CAMPAIGN ASKS
//
// Given a campaignId, this function builds the envelope ITSELF from the
// campaign's property and its resolved search languages. It does not accept
// one from the caller. A campaign that selected Georgian and English has a
// ceiling, and a ceiling a caller can widen by passing a wider body is not a
// ceiling -- it is a default.
//
// The envelope is deliberately narrow in two places and deliberately open in
// two others, and both choices are about what a comparable IS. See
// campaignEnvelope() for the reasoning; the short version is that price is
// never constrained, because a competing asking price is the answer this
// scan exists to produce and filtering on it would hide exactly the listings
// that explain the market.
//
// WHAT IT WILL NOT DO
//
// Reach a host with no SourcePolicy — the runtime refuses that, not this
// function. Follow anything that is not a detail URL for the source that
// published it. Invent a field. Merge two observations the resolver was not
// confident about.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createPortalRuntime } from '../../../src/research-core/market/runtime.ts';
import { structuredQuality } from '../../../src/research-core/parse/listing.ts';
import { detectLanguage } from '../../../src/research-core/normalize/language.ts';
import { contentHash } from '../../../src/research-core/normalize/hash.ts';
import {
  deriveSearchBudget,
  withinPriorityCeiling,
  type SearchBudget,
} from '../../../src/research-core/discovery/search-budget.ts';
import {
  mergesEntity,
  priceRange,
  representative,
  resolve,
  type ResolvableObservation,
} from '../../../src/research-core/discovery/entity-resolution.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Seven days, matching the evidence delivery window. */
const DEFAULT_WINDOW_DAYS = 7;

interface SourceRow {
  id: string;
  name: string | null;
  url: string;
  adapter_id: string | null;
  lifecycle: string;
  active: boolean;
  quality_score: number | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server configuration missing' }, 500);

  const db = createClient(supabaseUrl, serviceKey);

  /*
   * A cron/worker surface, like the other ticks: it belongs to no customer,
   * cannot present a user JWT, and authenticates on a private token.
   */
  const presented = req.headers.get('x-cron-token') || '';
  const authorization = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (authorization !== serviceKey) {
    const { data: tokenRow } = await db
      .from('admin_settings').select('value').eq('key', 'supply_discovery_token').maybeSingle();
    const expected = String(tokenRow?.value ?? '').replace(/^"|"$/g, '');
    if (!expected || presented !== expected) return json({ error: 'Forbidden' }, 403);
  }

  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const perSource = Math.max(1, Math.min(10, Number(body.limitPerSource) || 3));
    const campaignId = body.campaignId ? String(body.campaignId) : null;
    const jobId = body.jobId ? String(body.jobId) : null;

    /*
     * THE CAMPAIGN'S ENVELOPE IS NOT NEGOTIABLE BY THE CALLER.
     *
     * With a campaignId, every constraint below comes from the campaign's own
     * property and language selection, read here. Without one, this is an
     * operator sweep and the body supplies the market.
     */
    const scope = campaignId
      ? await campaignEnvelope(db, campaignId)
      : operatorEnvelope(body);
    if ('error' in scope) return json({ error: scope.error }, scope.status);

    const { city, transaction, countryCode } = scope;

    /*
     * THE REGISTRY DECIDES, NOT THE ADAPTER LIST.
     *
     * An adapter existing in the bundle is not permission to read a source.
     * source_may_scan_for_campaign() is the same gate the freshness work
     * established, and `active` is how a source that parses but carries
     * nothing matchable is kept out of a customer's budget.
     */
    const { data: sourceRows, error: sourceError } = await db
      .from('source_registry')
      .select('id,name,url,adapter_id,lifecycle,active,quality_score,priority_tier')
      .not('adapter_id', 'is', null)
      .eq('active', true)
      .in('lifecycle', ['LIVE_TESTED', 'PRODUCTIVE']);
    if (sourceError) throw sourceError;

    /*
     * WHAT THIS CUSTOMER HAS PAID TO HAVE SEARCHED.
     *
     * The registry says which sources CAN be read. It says nothing about how
     * many of them one campaign is entitled to, and without that a free-plan
     * campaign fans out across every source in the registry -- which is
     * survivable at eight and is not at a hundred.
     *
     * The numbers are not invented here. product_plan_entitlements already
     * carries priority_level per plan and product, and its 0/1/2 is the same
     * axis as source_registry.priority_tier, so the ceiling is one
     * comparison. billing_entitlements is the same RPC beginExecution reads,
     * so a campaign's discovery and its bill cannot disagree about the plan.
     *
     * AN OPERATOR SWEEP HAS NO CEILING, and that is deliberate rather than an
     * oversight: with no campaignId there is no customer, nobody is being
     * billed, and the run is Homatch filling its own store. The bound there
     * is limitPerSource, which is already applied.
     */
    let budget: SearchBudget | null = null;
    let entitlementNote = 'operator sweep: no customer, no priority ceiling';
    if (campaignId) {
      const { data: owner } = await db
        .from('matching_campaigns')
        .select('property:properties!property_id(user_id)')
        .eq('id', campaignId)
        .maybeSingle();
      const property = Array.isArray(owner?.property) ? owner?.property[0] : owner?.property;
      const userId = property?.user_id ?? null;
      if (userId) {
        const { data: ent } = await db.rpc('billing_entitlements', { p_user_id: userId });
        const product = (ent?.products ?? []).find((p: any) => p.product_code === 'FIND_CLIENTS');
        const planCode = String(ent?.plan_code ?? 'FREE');

        /*
         * THE SPEND CEILING COMES FROM THE TABLE, NOT FROM THE RPC.
         *
         * billing_entitlements returns quality_tier, result_ceiling and
         * priority_level per product and does NOT return
         * provider_budget_ceiling_cents -- billing.ts reads that separately in
         * providerBudgetFor(), which is why nothing noticed.
         *
         * Reading it off the RPC payload therefore yielded undefined, the
         * budget reported "cost is UNKNOWN", and a ceiling that IS configured
         * (200c on FIND_CLIENTS/FREE, 600 on VIP, 1500 on PREMIUM) was
         * silently not enforced. Caught by the first production run of this
         * gate rather than by any test, because every fixture had supplied the
         * field the real RPC omits.
         *
         * Nothing overspent while it was wrong: maxSourceJobs is the bound
         * that always applies, which is the entire reason it exists.
         */
        const { data: ceiling } = await db
          .from('product_plan_entitlements')
          .select('provider_budget_ceiling_cents')
          .eq('product_code', 'FIND_CLIENTS')
          .eq('plan_code', planCode)
          .maybeSingle();

        budget = deriveSearchBudget(product
          ? {
            productCode: 'FIND_CLIENTS',
            planCode,
            qualityTier: product.quality_tier ?? null,
            resultCeiling: product.result_ceiling ?? null,
            providerBudgetCeilingCents: ceiling?.provider_budget_ceiling_cents ?? null,
            priorityLevel: product.priority_level ?? null,
          }
          : null);
        entitlementNote = budget.rationale;
      } else {
        /* A campaign whose owner cannot be resolved is not given the widest
           envelope by default. The narrowest one is the safe failure. */
        budget = deriveSearchBudget(null);
        entitlementNote = `campaign owner unresolved; ${budget.rationale}`;
      }
    }

    const tiered = (sourceRows ?? []).map((row: any) => ({
      id: String(row.adapter_id),
      priorityTier: row.priority_tier ?? null,
      row: row as SourceRow,
    }));
    const gate = budget
      ? withinPriorityCeiling(tiered, budget)
      : { eligible: tiered, skipped: [] as Array<{ id: string; reason: string; detail: string }> };

    const permitted = new Map<string, SourceRow>();
    for (const entry of gate.eligible) {
      if (entry.row.adapter_id) permitted.set(entry.row.adapter_id, entry.row);
    }
    if (permitted.size === 0) {
      return json({
        success: true, sourcesPermitted: 0, observations: 0,
        note: 'no source is both LIVE_TESTED and active; nothing was fetched',
      });
    }

    const runtime = createPortalRuntime();
    const adapters = runtime.registry.all().filter((a) => permitted.has(a.id));

    const query = {
      id: `supply-${countryCode}-${city}-${transaction}`.toLowerCase(),
      transaction, countryCode, city,
      propertyType: scope.propertyType,
      district: scope.district,
      subDistrict: null, projectName: null,
      area: scope.area,
      rooms: { min: null, max: null },
      bedrooms: { min: null, max: null },
      floor: { min: null, max: null },
      /*
       * OPEN, ALWAYS. A comparable set filtered by the subject's own price
       * would confirm the price it was given instead of testing it.
       */
      price: { min: null, max: null },
      priceCurrency: null,
      languages: scope.languages,
      limit: perSource,
      rationale: scope.rationale,
    };

    const perSourceReport: Record<string, unknown>[] = [];
    const written: string[] = [];
    let reached = 0;
    let blocked = 0;
    let discovered = 0;
    let reused = 0;

    for (const adapter of adapters) {
      const source = permitted.get(adapter.id)!;
      if (!adapter.supports(query as never)) {
        perSourceReport.push({ adapter: adapter.id, outcome: 'UNSUPPORTED' });
        continue;
      }

      let outcome;
      try {
        outcome = await adapter.searchListings(query as never, runtime.context);
      } catch (error) {
        perSourceReport.push({ adapter: adapter.id, outcome: 'ERROR', detail: message(error) });
        await recordSourceFailure(db, source.id, message(error));
        continue;
      }

      if (!outcome.ok) {
        /*
         * A refusal is recorded as a refusal against the SOURCE, so a site
         * that has started saying no shows up as DEGRADED rather than as a
         * market that went quiet.
         */
        blocked += 1;
        perSourceReport.push({ adapter: adapter.id, outcome: outcome.reason, detail: outcome.detail });
        await recordSourceFailure(db, source.id, `${outcome.reason}: ${outcome.detail ?? ''}`);
        continue;
      }

      reached += 1;
      const rows: string[] = [];
      for (const portalListing of outcome.value.listings) {
        const result = await persist(db, source, portalListing, countryCode);
        if (!result) continue;
        rows.push(result.id);
        written.push(result.id);
        if (result.isNew) discovered += 1; else reused += 1;

        if (campaignId) {
          await db.from('campaign_supply_references').upsert({
            campaign_id: campaignId,
            observation_id: result.id,
            job_id: jobId,
            origin: result.isNew ? 'DISCOVERED_BY_THIS_CAMPAIGN' : 'REUSED_EXISTING',
            evidence_freshness: 'NEW_UNVERIFIED',
          }, { onConflict: 'campaign_id,observation_id', ignoreDuplicates: true });
        }
      }

      await db.from('source_registry').update({
        last_collected_at: new Date().toISOString(),
        last_successful_at: new Date().toISOString(),
        failure_count: 0,
        last_failure_reason: null,
        scanned_signal_count: (outcome.value.listings.length ?? 0),
        updated_at: new Date().toISOString(),
      }).eq('id', source.id);

      perSourceReport.push({
        adapter: adapter.id,
        outcome: 'OK',
        parsed: outcome.value.listings.length,
        persisted: rows.length,
        networkRequests: outcome.value.networkRequests,
        appliedFilters: outcome.value.appliedFilters,
        /*
         * Read listings the envelope removed. Without it, a source that
         * offered forty comparables and matched two reports the same as one
         * that had two -- and the first is a source worth reading again.
         */
        rejectedByEnvelope: outcome.value.rejectedByEnvelope ?? 0,
      });
    }

    /*
     * ENTITY RESOLUTION, AFTER EVERYTHING IS WRITTEN.
     *
     * Deliberately not per-listing: the whole point is comparing across
     * sources, and a listing can only be compared with what has already been
     * stored. Every comparison is recorded, including the refusals.
     */
    const resolution = await resolveMarket(db, countryCode, city, transaction);

    return json({
      success: true,
      city, transaction, countryCode,
      campaignId,
      /*
       * The envelope, echoed back. A run whose scope cannot be read off its
       * own result is a run nobody can reproduce or audit later.
       */
      envelope: {
        source: campaignId ? 'CAMPAIGN' : 'REQUEST',
        propertyType: scope.propertyType,
        district: scope.district,
        area: scope.area,
        price: null,
        languages: scope.languages,
        rationale: scope.rationale,
      },
      sourcesPermitted: permitted.size,
      /*
       * What the entitlement did, reported rather than implied. "Permitted 3"
       * on its own cannot be told apart from "the registry only has 3", and
       * the two call for opposite responses.
       */
      entitlement: {
        applied: budget !== null,
        rationale: entitlementNote,
        sourcePriorityCeiling: budget?.sourcePriorityCeiling ?? null,
        targetResults: budget?.targetResults ?? null,
        /* Reported so "unset" can be told from "set and ignored" — the exact
           confusion that hid the ceiling not being read at all. */
        maxInternalCostCents: budget?.maxInternalCostCents ?? null,
        maxSourceJobs: budget?.maxSourceJobs ?? null,
        sourcesConsidered: tiered.length,
        sourcesOutsideEntitlement: gate.skipped.length,
        skipped: gate.skipped.slice(0, 10),
      },
      sourcesReached: reached,
      sourcesBlocked: blocked,
      observationsWritten: written.length,
      observationsNew: discovered,
      observationsUpdated: reused,
      resolution,
      perSource: perSourceReport,
      fetch: runtime.stats(),
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    return json({ error: message(error) }, 500);
  }
});

/* ────────────────────────────────────────────────────────────────────── */

interface Envelope {
  city: string;
  transaction: 'SALE' | 'RENT';
  countryCode: string;
  propertyType: 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL' | 'ANY';
  district: string | null;
  area: { min: number | null; max: number | null };
  languages: readonly string[];
  rationale: string;
}

/**
 * An operator sweep. The body says which market, and nothing narrows it.
 *
 * This is how the market gets read outside any campaign — a scheduled tick
 * filling the global store so the first campaign in a city is not also the
 * one that pays for discovering it.
 */
function operatorEnvelope(body: Record<string, unknown>): Envelope {
  return {
    city: String(body.city || 'Tbilisi'),
    transaction: String(body.transaction || 'SALE').toUpperCase() === 'RENT' ? 'RENT' : 'SALE',
    countryCode: String(body.countryCode || 'GE').toUpperCase(),
    propertyType: 'ANY',
    district: null,
    area: { min: null, max: null },
    languages: ['ka', 'en'],
    rationale: 'operator supply sweep: fill the global store for this market',
  };
}

/**
 * THE COMPARABLE ENVELOPE, derived from the campaign's own subject.
 *
 * NARROW ON TWO THINGS
 *
 * The transaction and the property type, because a rental is not a comparable
 * for a sale and a plot of land is not a comparable for a flat. These are
 * categorical: getting them wrong does not make the set noisier, it makes it
 * about something else.
 *
 * Area, within a band. A 97m2 flat is not meaningfully compared against a
 * 300m2 one, and the band is stated in admin_settings rather than buried
 * here, because how wide "similar size" is is a market judgement that will be
 * argued about and should be arguable in one place.
 *
 * OPEN ON TWO THINGS, DELIBERATELY
 *
 * PRICE. The competing asking price is the ANSWER this scan produces. An
 * envelope built around the subject's own price would return the listings
 * that agree with it and silently drop the ones that do not, which is how a
 * tool ends up confirming every price it is shown.
 *
 * DISTRICT. The property states Krtsanisi; the portals write ქრწანისი,
 * Krtsanisi and Krcanisi, and the alias table that makes Tbilisi and თბილისი
 * one city covers cities only. Applying a district filter today would drop
 * real neighbours over spelling, and the difference between "no comparables
 * in this district" and "we could not read the district" is exactly the kind
 * of false emptiness this codebase keeps refusing to produce. The district
 * travels on each observation, so ranking can weigh it later — it is a
 * weight, not a gate, until the vocabulary is real.
 */
async function campaignEnvelope(
  db: any,
  campaignId: string,
): Promise<Envelope | { error: string; status: number }> {
  const { data: campaign, error } = await db
    .from('matching_campaigns')
    .select('id,property_id,search_language_mode,search_languages_selected,search_languages_resolved')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) return { error: message(error), status: 500 };
  if (!campaign) return { error: `campaign ${campaignId} does not exist`, status: 404 };

  const { data: property } = await db
    .from('properties')
    .select('id,property_type,transaction_type')
    .eq('id', campaign.property_id)
    .maybeSingle();
  const { data: facts } = await db
    .from('property_facts')
    .select('city,district,country_code,area')
    .eq('property_id', campaign.property_id)
    .maybeSingle();

  /*
   * NO CITY, NO SCAN. Every source here is a city-level collection page, and
   * a campaign whose property has no stated city would otherwise be given the
   * default market — a scan that looks like it answered a question about this
   * property and did not.
   */
  const city = String(facts?.city ?? '').trim();
  if (!city) {
    return { error: 'the campaign property states no city; supply discovery has no market to read', status: 422 };
  }

  const { data: bandRow } = await db
    .from('admin_settings').select('value').eq('key', 'supply_comparable_area_band').maybeSingle();
  const band = clampBand(bandRow?.value);

  const area = Number(facts?.area ?? 0);
  const areaBand = area > 0
    ? { min: Math.round(area * (1 - band)), max: Math.round(area * (1 + band)) }
    : { min: null, max: null };

  return {
    city,
    transaction: String(property?.transaction_type ?? 'SALE').toUpperCase() === 'RENT' ? 'RENT' : 'SALE',
    countryCode: String(facts?.country_code ?? 'GE').toUpperCase(),
    propertyType: normalizeType(property?.property_type),
    district: null,
    area: areaBand,
    /*
     * THE CEILING, as the campaign resolved it. Not widened here and not
     * defaulted past: a campaign that has not yet resolved its languages gets
     * the source-neutral pair the adapters can actually read, recorded in the
     * rationale so the report does not imply a choice the customer made.
     */
    languages: Array.isArray(campaign.search_languages_resolved) && campaign.search_languages_resolved.length > 0
      ? campaign.search_languages_resolved
      : ['ka', 'en'],
    rationale: Array.isArray(campaign.search_languages_resolved) && campaign.search_languages_resolved.length > 0
      ? `comparables for campaign ${campaignId}, languages as resolved by the campaign`
      : `comparables for campaign ${campaignId}; the campaign has resolved no search languages, so this scan used ka+en and claims no customer selection`,
  };
}

/** A band of 0 would return only exact-area matches; one of 1 is no band at all. */
function clampBand(raw: unknown): number {
  const parsed = Number(String(raw ?? '').replace(/^"|"$/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) return 0.25;
  return parsed;
}

function normalizeType(raw: unknown): Envelope['propertyType'] {
  const value = String(raw ?? '').toUpperCase();
  return value === 'APARTMENT' || value === 'HOUSE' || value === 'LAND' || value === 'COMMERCIAL'
    ? value
    : 'ANY';
}

async function persist(
  db: any,
  source: SourceRow,
  portalListing: any,
  countryCode: string,
): Promise<{ id: string; isNew: boolean } | null> {
  const listing = portalListing.listing;
  const externalId = portalListing.externalId;
  if (!externalId) return null;

  const text = [listing.title, listing.description].filter(Boolean).join(' ');
  const fingerprint = listing.contentFingerprint ?? contentHash(text || portalListing.url);
  const detected = text ? detectLanguage(text) : null;
  const now = new Date().toISOString();

  const { data: existing } = await db
    .from('supply_observations')
    .select('id,content_fingerprint,first_seen_at')
    .eq('source_id', source.id)
    .eq('external_id', externalId)
    .maybeSingle();

  const shared = {
    source_id: source.id,
    adapter_id: portalListing.portalId,
    external_id: externalId,
    canonical_url: portalListing.url,
    transaction: listing.rent ? 'RENT' : 'SALE',
    property_type: listing.propertyType,
    country_code: listing.country ?? countryCode,
    city: listing.city,
    district: listing.district,
    sale_amount: listing.sale?.amount ?? null,
    sale_currency: listing.sale?.currency ?? null,
    sale_basis: listing.sale?.basis ?? null,
    rent_amount: listing.rent?.amount ?? null,
    rent_currency: listing.rent?.currency ?? null,
    rent_period: listing.rentPeriod ?? null,
    area_sqm: listing.area?.value ?? null,
    rooms: listing.rooms,
    bedrooms: listing.bedrooms,
    floor: listing.floor,
    total_floors: listing.totalFloors,
    year_built: listing.yearBuilt,
    title: listing.title,
    description: listing.description,
    /* OBSERVED, not assumed. A Russian listing found by a Georgian query is
       a Russian listing. */
    detected_language: detected?.reliable ? detected.language : null,
    published_at: listing.publishedAt,
    source_status: listing.status,
    content_fingerprint: fingerprint,
    field_origins: listing.fieldOrigins ?? {},
    structured_quality: Number(structuredQuality(listing).toFixed(3)),
    parser_version: 'portal-family-1.0.0',
    adapter_version: 'configured-portal-1.0.0',
    last_seen_at: now,
    updated_at: now,
  };

  if (!existing) {
    /*
     * A FIRST SIGHTING IS NOT A VERIFICATION. last_verified_at stays null:
     * we have one observation and nothing to compare it against. expires_at
     * bounds how long that first sighting may be delivered on.
     */
    const { data, error } = await db.from('supply_observations').insert({
      ...shared,
      first_seen_at: now,
      last_verified_at: null,
      validation_state: 'UNVERIFIED',
      expires_at: new Date(Date.parse(now) + DEFAULT_WINDOW_DAYS * 86_400_000).toISOString(),
    }).select('id').single();
    if (error) return null;
    return { id: data.id, isNew: true };
  }

  /*
   * Seen again. content_changed_at moves ONLY if the fingerprint moved, so
   * "the price changed" stays distinguishable from "we re-read it and it
   * said the same thing". first_seen_at is absent from the update and a
   * trigger enforces that it cannot move.
   */
  const changed = existing.content_fingerprint !== fingerprint;
  const { error } = await db.from('supply_observations').update({
    ...shared,
    ...(changed ? { content_changed_at: now } : {}),
  }).eq('id', existing.id);
  if (error) return null;
  return { id: existing.id, isNew: false };
}

async function recordSourceFailure(db: any, sourceId: string, reason: string) {
  const { data } = await db.from('source_registry')
    .select('failure_count,lifecycle').eq('id', sourceId).maybeSingle();
  const failures = Number(data?.failure_count ?? 0) + 1;

  await db.from('source_registry').update({
    failure_count: failures,
    last_failure_reason: reason.slice(0, 300),
    last_collected_at: new Date().toISOString(),
    /* Three consecutive failures on a source that WAS working is DEGRADED.
       A source that never worked stays where it is — it has not degraded,
       it has never been proven. */
    ...(failures >= 3 && data?.lifecycle === 'PRODUCTIVE'
      ? { lifecycle: 'DEGRADED', lifecycle_changed_at: new Date().toISOString() }
      : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', sourceId);

  await db.from('source_lifecycle_events').insert({
    source_id: sourceId,
    from_state: data?.lifecycle ?? 'UNKNOWN',
    to_state: failures >= 3 && data?.lifecycle === 'PRODUCTIVE' ? 'DEGRADED' : (data?.lifecycle ?? 'UNKNOWN'),
    evidence_kind: 'LIVE_FETCH',
    reason: reason.slice(0, 300),
    rejected: false,
    detail: { failures },
  });
}

/**
 * Compare what this market holds, and record every verdict.
 *
 * Bounded: the most recent observations in one market, compared pairwise.
 * A market with thousands of listings needs blocking keys rather than a
 * cross product, and the bound here is what stops this quietly becoming an
 * O(n²) sweep before that exists.
 */
async function resolveMarket(db: any, countryCode: string, city: string, transaction: string) {
  const { data: rows } = await db
    .from('supply_observations')
    .select('id,source_id,adapter_id,external_id,canonical_url,country_code,city,district,transaction,property_type,area_sqm,rooms,bedrooms,floor,sale_amount,sale_currency,content_fingerprint,structured_quality,entity_id')
    .eq('country_code', countryCode)
    .eq('transaction', transaction)
    .order('updated_at', { ascending: false })
    .limit(60);

  const observations: ResolvableObservation[] = (rows ?? []).map((r: any) => ({
    id: r.id, sourceId: r.source_id, adapterId: r.adapter_id,
    externalId: r.external_id, canonicalUrl: r.canonical_url,
    countryCode: r.country_code, city: r.city, district: r.district,
    transaction: r.transaction, propertyType: r.property_type,
    areaSqm: r.area_sqm === null ? null : Number(r.area_sqm),
    rooms: r.rooms, bedrooms: r.bedrooms, floor: r.floor,
    saleAmount: r.sale_amount === null ? null : Number(r.sale_amount),
    saleCurrency: r.sale_currency,
    contentFingerprint: r.content_fingerprint,
    quality: Number(r.structured_quality ?? 0),
    /*
     * THE ENTITY THIS OBSERVATION IS ALREADY ON.
     *
     * The select has always asked for entity_id and this mapping dropped it,
     * so applyMerges' `existingId` lookup found undefined every time and
     * INSERTED a new entity on every run. Production had three rows for one
     * Saburtalo flat: identical city, district, area and price range, each
     * claiming observation_count 2, and two of them holding no observations
     * at all because the newest insert had taken them.
     *
     * Nothing failed. The orphans are invisible unless you ask which
     * observations point at an entity, and any count of "properties known"
     * was growing by one per merged pair per run.
     */
    entityId: r.entity_id ?? null,
  }));

  const verdicts: Record<string, number> = {};
  const merges: Array<[string, string]> = [];

  for (let i = 0; i < observations.length; i += 1) {
    for (let j = i + 1; j < observations.length; j += 1) {
      const decision = resolve(observations[i], observations[j]);
      verdicts[decision.verdict] = (verdicts[decision.verdict] ?? 0) + 1;

      // EVERY comparison, including the refusals. An ambiguous pair stays
      // two entities and the doubt is written down.
      await db.from('supply_resolution_decisions').upsert({
        left_observation_id: observations[i].id,
        right_observation_id: observations[j].id,
        verdict: decision.verdict,
        confidence: decision.confidence,
        signals: decision.signals,
      }, { onConflict: 'left_observation_id,right_observation_id' });

      if (mergesEntity(decision.verdict)) merges.push([observations[i].id, observations[j].id]);
    }
  }

  const entitiesTouched = await applyMerges(db, observations, merges, countryCode, city, transaction);
  return { compared: observations.length, verdicts, entitiesTouched };
}

/** Union the confident pairs and write one entity per group. */
async function applyMerges(
  db: any,
  observations: ResolvableObservation[],
  merges: Array<[string, string]>,
  countryCode: string,
  city: string,
  transaction: string,
): Promise<number> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) && parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (const o of observations) parent.set(o.id, o.id);
  for (const [a, b] of merges) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }

  const groups = new Map<string, ResolvableObservation[]>();
  for (const o of observations) {
    const root = find(o.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(o);
  }

  let touched = 0;
  for (const [, members] of groups) {
    // A group of one is not an entity yet. Creating one per observation
    // would make "entities" a synonym for "listings".
    if (members.length < 2) continue;

    const rep = representative(members);
    const range = priceRange(members);
    const now = new Date().toISOString();

    /*
     * REUSE THE ENTITY THAT EXISTS. No cast: the field is on the type now,
     * so dropping it in the mapping is a compile error rather than a silent
     * new entity on every run.
     */
    const existingId = members.find((m) => m.entityId)?.entityId ?? null;
    const payload = {
      country_code: countryCode,
      city: rep?.city ?? city,
      district: rep?.district ?? null,
      transaction,
      property_type: rep?.propertyType ?? null,
      area_sqm: rep?.areaSqm ?? null,
      rooms: rep?.rooms ?? null,
      bedrooms: rep?.bedrooms ?? null,
      observation_count: members.length,
      source_count: new Set(members.map((m) => m.sourceId)).size,
      // The RANGE, not a figure. "Four sources, $150,000 to $162,000" is a
      // true sentence; an average is a number nobody published.
      min_price: range?.min ?? null,
      max_price: range?.max ?? null,
      price_currency: range?.currency ?? null,
      price_spread: range?.spread ?? null,
      last_seen_at: now,
      updated_at: now,
    };

    let entityId = existingId;
    if (entityId) {
      await db.from('supply_entities').update(payload).eq('id', entityId);
    } else {
      const { data } = await db.from('supply_entities').insert(payload).select('id').single();
      entityId = data?.id ?? null;
    }
    if (!entityId) continue;

    await db.from('supply_observations')
      .update({ entity_id: entityId, updated_at: now })
      .in('id', members.map((m) => m.id));
    touched += 1;
  }
  return touched;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
