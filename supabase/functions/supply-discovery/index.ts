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
import { withoutAlreadyRead } from '../../../src/research-core/discovery/search-expansion.ts';
import { placeNamesFor } from '../../../src/research-core/normalize/place.ts';
import { attributionFrom } from '../../../src/research-core/match/broker-attribution.ts';
import { isBrokerRole } from '../../../src/research-core/match/broker-identity.ts';
import { dealKindFrom } from '../../../src/research-core/match/participants.ts';
import { assessCoverage, decideSweep } from '../../../src/research-core/discovery/coverage.ts';
import {
  ageCeilingMs,
  describeCeiling,
  listingContextFrom,
  resolveAgeCeiling,
  type AgeCeilingConfig,
} from '../../../src/research-core/discovery/listing-age-policy.ts';
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

  /**
 * How much deliverable evidence per language makes a sweep unnecessary.
 *
 * Three, because one listing is not a comparables set: a customer shown a single
 * flat has been told nothing about what their property competes against. It is a
 * product judgement rather than a constant of nature, which is why it sits at the
 * call site and not inside the coverage module.
 */
const COVERAGE_FLOOR_PER_LANGUAGE = 3;

/*
 * HOW OLD A LISTING MAY BE is no longer a constant here.
 *
 * It was `90 * 86_400_000`, and the commit that added it said in writing that the
 * number was a guess at the Tbilisi rental market rather than a measurement. The
 * guess was fine; freezing it into this one call site was not, because the next
 * reader had no way to tell a placeholder from a calibrated figure.
 *
 * It now comes from listing-age-policy.ts, which keys the ceiling by transaction
 * context, carries the PROVENANCE of every number (ASSUMED / CONFIGURED /
 * MEASURED), and lets an operator calibrate one market without rewriting any of
 * this. Ninety days remains the fallback when no context is known, and it says so.
 *
 * Still entirely separate from the delivery window: that asks how long ago WE
 * looked, this asks how long ago the SELLER spoke.
 */

const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const perSource = Math.max(1, Math.min(10, Number(body.limitPerSource) || 3));
    const campaignId = body.campaignId ? String(body.campaignId) : null;
    const jobId = body.jobId ? String(body.jobId) : null;

    /*
     * EXISTING INTELLIGENCE FIRST, IN ITS PUREST FORM.
     *
     * Every listing already in the store carries the title and description it was
     * discovered with, and the supply role was always readable from them -- nobody
     * was reading it. This mode re-reads what we already hold and writes the role
     * and the broker attribution, with ZERO network fetches and zero credits.
     *
     * It is not a convenience for tests. It is the only way the history gets a
     * role at all: rows discovered before the column existed would otherwise stay
     * permanently roleless, and PARTICIPANTS would stay UNKNOWN on them forever
     * for a reason that has nothing to do with what the listing said.
     *
     * Attribution only. It cannot fetch, cannot create a campaign, cannot spend,
     * and cannot touch a directory listing.
     */
    if (String(body.mode ?? '') === 'attribute-stored') {
      return await attributeStored(db, {
        limit: Math.max(1, Math.min(2000, Number(body.limit) || 500)),
        onlyMissing: body.onlyMissing !== false,
      });
    }

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
     * DO WE ALREADY KNOW ENOUGH NOT TO GO OUTSIDE?
     *
     * The header of this file calls campaign-to-campaign reuse "the entire
     * economic argument for a discovery network over a per-campaign scraper", and
     * the reuse it described was real but only ever happened AFTER the fetch: a
     * campaign in a city Homatch swept an hour ago swept it again and then
     * discovered the rows were already there. Nothing asked beforehand.
     *
     * It is decided HERE rather than in match-campaign because this function owns
     * the envelope. match-campaign is explicitly forbidden from passing a city --
     * that would be its opinion of the campaign overriding the campaign -- so it
     * cannot assess coverage without first acquiring the opinion it must not have.
     *
     * THE QUERY IS DELIBERATELY LOOSE AND THE DECISION IS NOT.
     *
     * supply_observations.city is unnormalised: one city is held as 'Tbilisi',
     * 'tbilisi' and 'თბილისი' -- measured in production 2026-09-26 -- so
     * `city = 'Tbilisi'` matched 11 of 20 Tbilisi rows and would have swept for
     * the nine it already had. placeNamesFor() supplies every spelling this core
     * knows, from the same table comparePlaces() decides with, and assessCoverage()
     * makes the per-row judgement. One vocabulary, used at both ends.
     */
    const { data: heldRows } = await db
      .from('supply_observations')
      .select('id,city,detected_language,validation_state,first_seen_at,last_seen_at,'
        + 'last_verified_at,content_changed_at,expires_at,content_fingerprint,failed_checks,'
        + 'published_at')
      /*
       * ILIKE rather than IN, for the reason measured in supply-matching: placeNamesFor()
       * returns lowercase canonical names and this column holds 'Tbilisi' with a capital
       * T, so a case-sensitive IN silently hid 12 of 21 Tbilisi rows -- and under-reading
       * the store makes the coverage gate report a gap that is not there and pay to
       * re-find what it already had.
       */
      .or(placeNamesFor(city).map((name) => `city.ilike.${name}`).join(','))
      .eq('transaction', transaction)
      .limit(2000);

    /*
     * THE CEILING FOR THIS CAMPAIGN'S MARKET, resolved from what the campaign
     * actually states rather than from a number in this file.
     *
     * The config row is optional: with nothing configured every ceiling is the
     * built-in ASSUMED default, which is exactly the behaviour this replaces. The
     * resolved ceiling and its provenance are echoed in the response, so a skipped
     * sweep can be explained without anybody guessing which number applied.
     */
    const { data: ceilingRow } = await db
      .from('admin_settings').select('value').eq('key', 'listing_age_ceilings').maybeSingle();
    /*
     * admin_settings.value is jsonb, so it arrives already parsed -- but a row set
     * by hand can hold a JSON STRING containing JSON, which arrives as a string.
     * Parsed defensively and treated as absent when it is neither: a malformed
     * settings row must leave every ceiling at its built-in default rather than
     * throwing a campaign's discovery run.
     */
    const ceilingConfig: AgeCeilingConfig | undefined = (() => {
      const raw = ceilingRow?.value;
      if (raw && typeof raw === 'object') return raw as AgeCeilingConfig;
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === 'object' ? parsed as AgeCeilingConfig : undefined;
        } catch {
          return undefined;
        }
      }
      return undefined;
    })();

    const listingContext = listingContextFrom({
      transaction,
      propertyType: scope.propertyType,
    });
    const ageCeiling = resolveAgeCeiling(listingContext, {
      market: countryCode,
      config: ceilingConfig,
    });

    const coverage = assessCoverage(
      (heldRows ?? []).map((row: Record<string, unknown>) => ({
        ref: String(row.id),
        city: (row.city as string | null) ?? null,
        language: (row.detected_language as string | null) ?? null,
        sourceId: null,
        /* When the SELLER spoke, which is a different question from when we last
           looked -- and the one an archive of 2022 posts answers badly. */
        publishedAt: (row.published_at as string | null) ?? null,
        freshness: {
          firstSeenAt: String(row.first_seen_at),
          lastSeenAt: String(row.last_seen_at),
          lastVerifiedAt: (row.last_verified_at as string | null) ?? null,
          contentChangedAt: (row.content_changed_at as string | null) ?? null,
          expiresAt: (row.expires_at as string | null) ?? null,
          contentFingerprint: String(row.content_fingerprint ?? ''),
          validationState: String(row.validation_state ?? 'UNVERIFIED') as never,
          failedChecks: Number(row.failed_checks ?? 0),
        },
      })),
      {
        market: countryCode,
        city,
        languages: scope.languages,
        minPerLanguage: COVERAGE_FLOOR_PER_LANGUAGE,
        maxPublishedAgeMs: ageCeilingMs(ageCeiling),
      },
    );

    /*
     * AN OPERATOR SWEEP IS NEVER TOLD IT ALREADY HAS ENOUGH.
     *
     * Its whole purpose is filling the store so the first campaign in a city is
     * not also the one that pays to discover it, and a gate that skipped it would
     * make the store permanently as thin as it is now. Only a CAMPAIGN can be
     * answered out of what we hold, so the decision is read but not obeyed here.
     */
    const sweep = campaignId
      ? decideSweep(coverage)
      : { sweep: true, languages: [], reason: 'operator sweep: the store is being filled on purpose' };

    if (!sweep.sweep) {
      /*
       * NOTHING IS READ. But the campaign DID use this evidence, so the references
       * are still written -- with origin REUSED_EXISTING, which is what actually
       * happened. Without them a skipped sweep would leave the campaign with no
       * record of the intelligence that answered it, and unauditable reuse is a
       * worse outcome than the duplicate fetch this gate prevents.
       */
      let recorded = 0;
      for (const observationId of coverage.countedRefs) {
        const { error: refError } = await db.from('campaign_supply_references').upsert({
          campaign_id: campaignId,
          observation_id: observationId,
          job_id: jobId,
          origin: 'REUSED_EXISTING',
          evidence_freshness: 'NEW_UNVERIFIED',
        }, { onConflict: 'campaign_id,observation_id', ignoreDuplicates: true });
        if (!refError) recorded += 1;
      }

      return json({
        success: true,
        /* The saving is real and it is named, so it cannot be confused with a
           sweep that found nothing. */
        reusedExistingIntelligence: true,
        sourcesReached: 0,
        networkFetches: 0,
        discovered: 0,
        reused: coverage.countedRefs.length,
        referencesRecorded: recorded,
        city, transaction, countryCode,
        coverage: {
          verdict: coverage.verdict,
          deliverableByLanguage: coverage.deliverableByLanguage,
          excluded: coverage.excluded,
          uncounted: coverage.uncounted,
          rationale: coverage.rationale,
        },
        /* The ceiling that decided it, and where the number came from. A skipped
           sweep justified by an unexplained figure is not explainable. */
        listingAge: {
          context: ageCeiling.context,
          days: ageCeiling.days,
          basis: ageCeiling.basis,
          fellBack: ageCeiling.fellBack,
          description: describeCeiling(ageCeiling),
        },
        elapsedMs: Date.now() - started,
      });
    }

    /*
     * A PARTIAL campaign sweeps only the languages it is missing, so the half
     * already paid for is not bought twice. An UNCOVERED one has every requested
     * language among its gaps, so this narrows to the list it started with -- and a
     * gap that is not about language at all leaves the list empty, which has to
     * mean "sweep unscoped" rather than "sweep nothing".
     *
     * A SEPARATE VALUE, never an assignment to scope.languages. The envelope is
     * this file's record of what the CAMPAIGN asked for, and narrowing it in place
     * would make the echoed-back envelope describe the sweep instead of the
     * request -- so a customer reading it could not tell a two-language campaign
     * that reused Georgian from a campaign that only ever wanted Russian.
     */
    const sweepLanguages = sweep.languages.length > 0 ? sweep.languages : scope.languages;

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
            /*
             * Passed by the caller that holds the grant, because only it
             * knows how THIS run was funded. PAYG means the customer
             * authorised credits for this search, so the plan's tier is a
             * floor rather than a wall -- see search-budget.ts. Absent is
             * read conservatively: a sweep nobody told is the plan's own.
             */
            funding: body.funding === 'PAYG' ? 'PAYG'
              : body.funding === 'INCLUDED' ? 'INCLUDED' : null,
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

    /*
     * AN EXPANSION BUYS NEW WORK ONLY.
     *
     * When a campaign is searching deeper, the caller names the sources it has
     * already paid to read and they are dropped here. This runs AFTER the
     * entitlement gate and never instead of it: an expansion widens what a
     * customer bought, and it must not be able to reach a source the gate
     * refused for a reason of its own.
     *
     * By id, deliberately, and not by tier arithmetic. A source can be missing
     * from the first sweep for reasons that have nothing to do with its tier —
     * DEGRADED that morning, breaker open, UNSUPPORTED for that city — and a
     * "tier N+1 upwards" rule would never reach it again. What was actually read
     * is the receipt; the tier is only a budget. See search-expansion.ts.
     */
    const excludeAdapterIds: string[] = Array.isArray(body.excludeAdapterIds)
      ? body.excludeAdapterIds.map((id: unknown) => String(id).trim()).filter(Boolean)
      : [];
    const expansion = excludeAdapterIds.length > 0
      ? withoutAlreadyRead(gate.eligible.map((entry) => ({ id: entry.id, entry })), excludeAdapterIds)
      : null;
    const eligible = expansion ? expansion.fresh.map((item) => item.entry) : gate.eligible;

    const permitted = new Map<string, SourceRow>();
    for (const entry of eligible) {
      if (entry.row.adapter_id) permitted.set(entry.row.adapter_id, entry.row);
    }

    /*
     * An expansion whose exclusion set covers everything left reads nothing, and
     * that must be reported as such rather than falling back to a full sweep.
     * Charging for a sweep and then re-reading what the customer already owns is
     * the exact failure the exclusion exists to prevent, and a silent fallback
     * would reintroduce it while looking like resilience.
     */
    if (expansion && permitted.size === 0) {
      return json({
        success: true,
        sourcesPermitted: 0,
        observations: 0,
        expansion: {
          requested: true,
          excludedAlreadyRead: expansion.skipped.length,
          freshSources: 0,
        },
        note: 'every source inside this campaign\'s entitlement has already been read by an '
          + 'earlier sweep, so a deeper search would have bought nothing new. Nothing was fetched.',
      });
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
      /* THE NARROWED LIST. A PARTIAL campaign fetches only the languages it is
         missing; scope.languages stays the record of what it asked for. */
      languages: sweepLanguages,
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
        /*
         * WHAT WAS ACTUALLY SWEPT, beside what was asked for. Identical on a cold
         * market and shorter when the store already answered part of the request,
         * and the difference is the whole saving -- invisible if only one of the
         * two were reported.
         */
        languagesSwept: sweepLanguages,
        rationale: scope.rationale,
      },
      /* Why this sweep happened at all, in the same words a skipped one reports. */
      coverage: {
        verdict: coverage.verdict,
        deliverableByLanguage: coverage.deliverableByLanguage,
        excluded: coverage.excluded,
        uncounted: coverage.uncounted,
        rationale: coverage.rationale,
      },
      listingAge: {
        context: ageCeiling.context,
        days: ageCeiling.days,
        basis: ageCeiling.basis,
        fellBack: ageCeiling.fellBack,
        description: describeCeiling(ageCeiling),
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
      /*
       * Only present when the caller asked for an expansion, so its absence
       * cannot be mistaken for "an expansion that excluded nothing".
       */
      ...(expansion ? {
        expansion: {
          requested: true,
          excludedAlreadyRead: expansion.skipped.length,
          freshSources: permitted.size,
        },
      } : {}),
      /*
       * WHICH sources this sweep actually read, by adapter id.
       *
       * The receipt. A later expansion excludes exactly this set, and without it
       * the only way to avoid re-buying a source would be to infer it from the
       * tier, which is wrong in both directions.
       *
       * Only OK counts. A source that errored, was UNSUPPORTED for this city or
       * had its breaker open was not read, so a later expansion is free to try
       * it again — the customer got nothing from it and should not be told they
       * already have it. A source that answered OK with zero listings WAS read,
       * and "there is nothing here" is a real answer worth not paying for twice.
       */
      sourcesRead: perSourceReport
        .filter((row) => row.outcome === 'OK')
        .map((row) => String(row.adapter)),
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

  /*
   * WHO IS OFFERING, read off the listing before it is stored.
   *
   * Deterministic and explainable -- a keyword decision with the deciding word
   * recorded -- and it costs nothing, because the text is already in hand. Null for
   * most listings, which is the honest answer and leaves PARTICIPANTS honestly
   * UNKNOWN rather than falsely agreed.
   */
  const attribution = attributionFrom({
    title: listing.title,
    description: listing.description,
    canonicalUrl: portalListing.url,
  });

  /*
   * A BROKER RECORD IS ONLY CREATED FOR A BROKER, and only when the listing carried
   * something stable enough to identify a firm by. An owner's mobile number is not
   * an identity to be stored -- see broker-attribution.ts, which does not even
   * collect it.
   */
  const brokerId = isBrokerRole(attribution.role) && attribution.identity
    ? await upsertBrokerIntelligence(db, {
      attribution,
      role: attribution.role,
      sourceId: source.id,
      adapterId: portalListing.portalId,
      countryCode: listing.country ?? countryCode,
      city: listing.city,
      language: detected?.reliable ? detected.language : null,
      dealKind: dealKindFrom({
        transaction: listing.rent ? 'RENT' : 'SALE',
        propertyType: listing.propertyType,
      }),
      now,
    })
    : null;

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
    /* Two different facts, and source_status is neither of them. */
    supply_role: attribution.role,
    broker_id: brokerId,
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
    if (brokerId) {
      await recordBrokerLineage(db, brokerId, {
        sourceId: source.id,
        adapterId: portalListing.portalId,
        observationId: data.id,
        canonicalUrl: portalListing.url,
        keys: attribution.keys,
        now,
      });
    }
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
  if (brokerId) {
    await recordBrokerLineage(db, brokerId, {
      sourceId: source.id,
      adapterId: portalListing.portalId,
      observationId: existing.id,
      canonicalUrl: portalListing.url,
      keys: attribution.keys,
      now,
    });
  }
  return { id: existing.id, isNew: false };
}

/* ------------------------------------------------------------------ *
 * Broker intelligence                                                *
 * ------------------------------------------------------------------ */

/**
 * Read the supply role off every stored listing, and attribute the brokers.
 *
 * NO FETCHES. The counter is reported as zero and is a real zero rather than an
 * unmeasured one: nothing in this function can reach the network, and the response
 * says so in the same shape the sweep path uses so the two are comparable.
 *
 * Failures are counted per row rather than swallowed. A write that the database
 * rejects has to show up in the response -- an `if (!error)` that quietly moves on
 * is how eighteen rejected inserts once looked like a successful run.
 */
async function attributeStored(db: any, options: { limit: number; onlyMissing: boolean }) {
  const startedAt = Date.now();
  let query = db
    .from('supply_observations')
    .select('id,source_id,adapter_id,canonical_url,title,description,city,country_code,'
      + 'detected_language,transaction,property_type,supply_role,broker_id')
    .limit(options.limit);
  /* Re-reading a row whose role is already written changes nothing and costs a write. */
  if (options.onlyMissing) query = query.is('supply_role', null);

  const { data: rows, error: readError } = await query;
  if (readError) return json({ error: `read failed: ${readError.message}` }, 500);

  const totals = {
    read: (rows ?? []).length,
    roleWritten: 0,
    roleStillUnknown: 0,
    brokersLinked: 0,
    brokersCreated: 0,
    excludesIntermediaries: 0,
    writeFailures: [] as string[],
  };
  const byRole: Record<string, number> = {};
  const brokerIdsSeen = new Set<string>();

  for (const row of rows ?? []) {
    const now = new Date().toISOString();
    const attribution = attributionFrom({
      title: (row.title as string | null) ?? null,
      description: (row.description as string | null) ?? null,
      canonicalUrl: (row.canonical_url as string | null) ?? null,
    });
    if (attribution.excludesIntermediaries) totals.excludesIntermediaries += 1;

    if (!attribution.role) {
      totals.roleStillUnknown += 1;
      continue;
    }
    byRole[attribution.role] = (byRole[attribution.role] ?? 0) + 1;

    let brokerId: string | null = null;
    if (isBrokerRole(attribution.role) && attribution.identity) {
      brokerId = await upsertBrokerIntelligence(db, {
        attribution,
        role: attribution.role,
        sourceId: String(row.source_id),
        adapterId: String(row.adapter_id ?? 'unknown'),
        countryCode: String(row.country_code ?? 'GE'),
        city: (row.city as string | null) ?? null,
        language: (row.detected_language as string | null) ?? null,
        dealKind: dealKindFrom({
          transaction: (row.transaction as string | null) ?? null,
          propertyType: (row.property_type as string | null) ?? null,
        }),
        now,
      });
      if (brokerId) {
        totals.brokersLinked += 1;
        brokerIdsSeen.add(brokerId);
      }
    }

    const { error: writeError } = await db.from('supply_observations').update({
      supply_role: attribution.role,
      broker_id: brokerId,
      updated_at: now,
    }).eq('id', row.id);
    if (writeError) {
      totals.writeFailures.push(`${row.id}: ${writeError.message}`);
      continue;
    }
    totals.roleWritten += 1;

    if (brokerId) {
      await recordBrokerLineage(db, brokerId, {
        sourceId: String(row.source_id),
        adapterId: String(row.adapter_id ?? 'unknown'),
        observationId: String(row.id),
        canonicalUrl: String(row.canonical_url ?? ''),
        keys: attribution.keys,
        now,
      });
    }
  }

  totals.brokersCreated = brokerIdsSeen.size;

  return json({
    mode: 'attribute-stored',
    /* The same shape the sweep path reports, so the claim is comparable. */
    acquisition: { networkFetches: 0, creditsSpent: 0 },
    totals,
    byRole,
    /*
     * SAID EXPLICITLY, because the whole point of the separation is that nobody has
     * to go and check. This path writes to broker_intelligence and to
     * broker_intelligence_sources. It does not hold an owner_user_id and therefore
     * cannot write a directory listing at all.
     */
    directoryListingsTouched: 0,
    tookMs: Date.now() - startedAt,
  });
}

/**
 * Find or create the broker record this sighting belongs to, and return its id.
 *
 * DEDUP READS EVERY KEY, NOT JUST THE STRONGEST ONE. A firm first seen with a
 * domain and seen again three weeks later on a different portal with only a phone
 * number is one firm, and looking up solely by the strongest key of the new
 * sighting would create a second record. So the lineage table -- which holds every
 * key of every past sighting -- is searched first, and only if nothing matches is a
 * new identity minted from the strongest key available.
 *
 * NOTHING HERE CAN PRODUCE A DIRECTORY LISTING. There is no column to set: a paid
 * registration lives in a different table whose owner_user_id this function does
 * not have and cannot obtain.
 */
async function upsertBrokerIntelligence(db: any, input: {
  attribution: ReturnType<typeof attributionFrom>;
  role: 'AGENCY' | 'BROKER';
  sourceId: string;
  adapterId: string;
  countryCode: string;
  city: string | null | undefined;
  language: string | null;
  dealKind: string | null;
  now: string;
}): Promise<string | null> {
  const keys = input.attribution.keys;
  if (!keys.length) return null;

  /* 1. Has any key of this sighting been seen before, on any source? */
  const orFilter = keys
    .map((key) => `and(key_kind.eq.${key.kind},natural_key.eq.${key.value})`)
    .join(',');
  const { data: known } = await db
    .from('broker_intelligence_sources')
    .select('broker_id')
    .or(orFilter)
    .limit(1);
  let brokerId: string | null = known?.[0]?.broker_id ?? null;

  /* 2. Or does a record already carry the strongest key as its own identity? */
  if (!brokerId) {
    const strongest = keys[0];
    const { data: existing } = await db
      .from('broker_intelligence')
      .select('id')
      .eq('key_kind', strongest.kind)
      .eq('natural_key', strongest.value)
      .maybeSingle();
    brokerId = existing?.id ?? null;

    if (!brokerId) {
      const { data: created, error } = await db.from('broker_intelligence').insert({
        key_kind: strongest.kind,
        natural_key: strongest.value,
        role: input.role,
        display_name: input.attribution.evidence.displayName ?? null,
        country_code: input.countryCode,
        cities: input.city ? [input.city] : [],
        languages: input.language ? [input.language] : [],
        deal_kinds: input.dealKind ? [input.dealKind] : [],
        first_seen_at: input.now,
        last_seen_at: input.now,
        /*
         * A FIRST SIGHTING IS NOT A VERIFICATION, the same rule the observations
         * follow. We have read a name and a number off one page; we have not
         * confirmed the firm exists, so last_verified_at stays null and the state
         * stays UNVERIFIED.
         */
        last_verified_at: null,
        validation_state: 'UNVERIFIED',
      }).select('id').single();
      /*
       * A race on the unique index is not a failure: another worker created the same
       * firm a millisecond earlier, which is the dedup working. Read it back.
       */
      if (error) {
        const { data: raced } = await db
          .from('broker_intelligence')
          .select('id')
          .eq('key_kind', strongest.kind)
          .eq('natural_key', strongest.value)
          .maybeSingle();
        brokerId = raced?.id ?? null;
      } else {
        brokerId = created.id;
      }
      if (!brokerId) return null;
      await refreshBrokerCoverage(db, brokerId, input);
      return brokerId;
    }
  }

  await refreshBrokerCoverage(db, brokerId, input);
  return brokerId;
}

/**
 * Move the freshness clock and widen the coverage arrays.
 *
 * last_seen_at moves on every sighting because that is what it means. Cities,
 * languages and deal kinds are unioned rather than replaced: an agency that works
 * in Vake and Batumi in Georgian and Russian is all four of those things, and the
 * most recent listing is not the whole firm. Nothing here touches
 * last_verified_at -- seeing a name again is not confirming it.
 */
async function refreshBrokerCoverage(db: any, brokerId: string, input: {
  city: string | null | undefined;
  language: string | null;
  dealKind: string | null;
  now: string;
}) {
  const { data: current } = await db
    .from('broker_intelligence')
    .select('cities,languages,deal_kinds')
    .eq('id', brokerId)
    .maybeSingle();
  if (!current) return;

  const union = (existing: string[] | null, addition: string | null | undefined) => {
    const list = Array.isArray(existing) ? [...existing] : [];
    const value = addition ? String(addition) : '';
    if (value && !list.includes(value)) list.push(value);
    return list;
  };

  await db.from('broker_intelligence').update({
    last_seen_at: input.now,
    cities: union(current.cities, input.city),
    languages: union(current.languages, input.language),
    deal_kinds: union(current.deal_kinds, input.dealKind),
    updated_at: input.now,
  }).eq('id', brokerId);
}

/**
 * Record WHERE this broker was seen, one row per key per source.
 *
 * This is the provenance the product has to be able to show a customer: not "we
 * know about this agency" but "we read this agency's phone number off this listing
 * on this portal on this date". It is also what makes source_count derivable
 * instead of merely asserted, and what lets a later phone-only sighting find a
 * record that was created from a domain.
 */
async function recordBrokerLineage(db: any, brokerId: string, input: {
  sourceId: string;
  adapterId: string;
  observationId: string;
  canonicalUrl: string;
  keys: Array<{ kind: string; value: string }>;
  now: string;
}) {
  for (const key of input.keys) {
    /* Upsert on the declared identity, so a re-read moves last_seen_at and does
       not accumulate a row per crawl. */
    await db.from('broker_intelligence_sources').upsert({
      broker_id: brokerId,
      source_id: input.sourceId,
      adapter_id: input.adapterId,
      observation_id: input.observationId,
      canonical_url: input.canonicalUrl,
      key_kind: key.kind,
      natural_key: key.value,
      last_seen_at: input.now,
    }, { onConflict: 'broker_id,source_id,key_kind,natural_key' });
  }

  /*
   * COUNTS ARE COUNTED, not incremented. An incremented counter drifts the first
   * time a write is retried, and these two numbers are shown to customers as "seen
   * on N sources" -- a number that has to be true.
   */
  const { count: observations } = await db
    .from('supply_observations')
    .select('id', { count: 'exact', head: true })
    .eq('broker_id', brokerId);
  const { data: lineage } = await db
    .from('broker_intelligence_sources')
    .select('source_id')
    .eq('broker_id', brokerId);
  const sources = new Set((lineage ?? []).map((row: any) => row.source_id)).size;

  await db.from('broker_intelligence').update({
    observation_count: observations ?? 0,
    source_count: sources,
    updated_at: input.now,
  }).eq('id', brokerId);
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
