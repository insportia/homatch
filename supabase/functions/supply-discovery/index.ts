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
    const city = String(body.city || 'Tbilisi');
    const transaction = String(body.transaction || 'SALE').toUpperCase() === 'RENT' ? 'RENT' : 'SALE';
    const perSource = Math.max(1, Math.min(10, Number(body.limitPerSource) || 3));
    const campaignId = body.campaignId ? String(body.campaignId) : null;
    const jobId = body.jobId ? String(body.jobId) : null;
    const countryCode = String(body.countryCode || 'GE').toUpperCase();

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
      .select('id,name,url,adapter_id,lifecycle,active,quality_score')
      .not('adapter_id', 'is', null)
      .eq('active', true)
      .in('lifecycle', ['LIVE_TESTED', 'PRODUCTIVE']);
    if (sourceError) throw sourceError;

    const permitted = new Map<string, SourceRow>();
    for (const row of (sourceRows ?? []) as SourceRow[]) {
      if (row.adapter_id) permitted.set(row.adapter_id, row);
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
      transaction, propertyType: 'ANY', countryCode,
      city, district: null, subDistrict: null, projectName: null,
      area: { min: null, max: null }, rooms: { min: null, max: null },
      bedrooms: { min: null, max: null }, floor: { min: null, max: null },
      price: { min: null, max: null }, priceCurrency: null,
      languages: ['ka', 'en'] as const,
      limit: perSource,
      rationale: 'supply discovery',
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
      sourcesPermitted: permitted.size,
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

    const existingId = (members.find((m) => (m as any).entityId) as any)?.entityId ?? null;
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
