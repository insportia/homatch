#!/usr/bin/env node
/*
 * CONTROLLED LIVE TEST, THROUGH THE REAL FETCH PATH.
 *
 * Not a parser run against downloaded HTML — that is what the fixture tests
 * already do, and it is why those sources are FIXTURE_TESTED and nothing
 * more. This drives createPortalRuntime(), which is the same object the
 * production edge functions build: the SSRF host allowlist, the robots
 * checker, the per-source rate limiter, the circuit breaker, the coalescer
 * and the document cache, all wired exactly as they are in production.
 *
 * A source that passes here has been read over the path a customer's campaign
 * would read it over. That is what LIVE_TESTED is supposed to mean, and
 * nothing weaker should be allowed to set it.
 *
 * WHAT IT MEASURES, PER SOURCE
 *
 * Everything a promotion decision needs and nothing it does not: whether the
 * request was permitted and succeeded, whether the collection page yielded
 * listing links, how many detail pages parsed, and then — per listing —
 * whether the canonical id, URL, transaction, property type, location, price,
 * area and timestamps are actually present. Absent is reported as absent.
 *
 * IT PROMOTES NOTHING BY ITSELF
 *
 * It prints a verdict and a table. Writing LIVE_TESTED into the registry is a
 * separate, deliberate step, because a script that both measures and promotes
 * is a script that will eventually promote something it should not have.
 *
 * Usage: node scripts/live-test-portals.mjs [adapterId ...] [--limit 3] [--json]
 */
import { createPortalRuntime } from '../src/research-core/market/runtime.ts';
import { structuredQuality } from '../src/research-core/parse/listing.ts';

const args = process.argv.slice(2);
const JSON_ONLY = args.includes('--json');
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(args[limitArg + 1]) : 3;
const only = args.filter((a) => !a.startsWith('--') && a !== String(LIMIT));

/**
 * A minimal envelope, with a real city.
 *
 * ss-ge refuses one without: it turns a city into a server-side filter and
 * treats a country-wide sweep as not a comparable set, which is right. The
 * other three have no server-side city filter at all and simply ignore it --
 * and their appliedFilters says so.
 */
function envelope(id, transaction) {
  return {
    id,
    countryCode: 'GE',
    city: 'Tbilisi',
    district: null,
    subDistrict: null,
    projectName: null,
    transaction,
    propertyType: 'ANY',
    // EVERY Range the interface declares. ss-ge reads languages and rooms
    // directly and threw on the first undefined -- a reminder that a partial
    // object satisfies no contract just because the fields you happened to
    // use are present.
    area: { min: null, max: null },
    rooms: { min: null, max: null },
    bedrooms: { min: null, max: null },
    floor: { min: null, max: null },
    price: { min: null, max: null },
    priceCurrency: null,
    languages: ['ka', 'en'],
    limit: LIMIT,
    rationale: 'controlled live reachability test',
  };
}

/** What a single listing actually carried. Absent is reported as absent. */
function fieldReport(portalListing) {
  const l = portalListing.listing;
  return {
    externalId: portalListing.externalId ?? null,
    canonicalUrl: portalListing.url,
    priceBasis: portalListing.priceBasis,
    propertyType: l.propertyType ?? null,
    city: l.city ?? null,
    district: l.district ?? null,
    country: l.country ?? null,
    price: l.sale ? `${l.sale.amount} ${l.sale.currency}` : (l.rent ? `${l.rent.amount} ${l.rent.currency}/rent` : null),
    areaSqm: l.area ? l.area.value : null,
    rooms: l.rooms ?? null,
    bedrooms: l.bedrooms ?? null,
    publishedAt: l.publishedAt ?? null,
    status: l.status ?? null,
    title: l.title ? l.title.slice(0, 60) : null,
    fingerprintInputs: Object.keys(l.fieldOrigins).length,
    quality: Number(structuredQuality(l).toFixed(2)),
    origins: l.fieldOrigins,
  };
}

async function testOne(adapter, context, runtime) {
  const started = Date.now();
  const result = {
    adapterId: adapter.id,
    sourceFamily: adapter.sourceFamily,
    countries: [...adapter.countries],
    reachable: false,
    permitted: null,
    parsed: 0,
    listings: [],
    networkRequests: 0,
    latencyMs: 0,
    verdict: 'UNKNOWN',
    reason: '',
  };

  const query = envelope(`live-${adapter.id}`, 'SALE');
  if (!adapter.supports(query)) {
    result.verdict = 'UNSUPPORTED';
    result.reason = 'the adapter declares no SALE route for GE';
    return result;
  }

  let outcome;
  try {
    outcome = await adapter.searchListings(query, context);
  } catch (error) {
    result.verdict = 'ERROR';
    result.reason = error instanceof Error ? error.message : String(error);
    result.latencyMs = Date.now() - started;
    return result;
  }
  result.latencyMs = Date.now() - started;

  if (!outcome.ok) {
    /*
     * The distinction that decides the lifecycle. A refusal is BLOCKED and a
     * source we can reach but no longer read is DEGRADED — and neither is
     * "the portal had no inventory", which is what an empty success would
     * have been mistaken for.
     */
    result.verdict = outcome.reason === 'BLOCKED' || outcome.reason === 'LOGIN_WALL'
      ? 'BLOCKED'
      : outcome.reason === 'PARSE_FAILED' ? 'DEGRADED' : 'UNREACHABLE';
    result.permitted = outcome.reason !== 'BLOCKED' && outcome.reason !== 'LOGIN_WALL';
    result.reason = `${outcome.reason}: ${outcome.detail ?? ''}`.trim();
    return result;
  }

  result.reachable = true;
  result.permitted = true;
  result.parsed = outcome.value.listings.length;
  result.networkRequests = outcome.value.networkRequests;
  result.truncated = outcome.value.truncated;
  result.appliedFilters = outcome.value.appliedFilters;
  result.listings = outcome.value.listings.map(fieldReport);

  /*
   * CANONICAL ID STABILITY. Two listings from one page sharing an id means
   * the id is not an identity, and every later dedup decision built on it
   * would be wrong.
   */
  const ids = result.listings.map((l) => l.externalId).filter(Boolean);
  result.idsUnique = ids.length === new Set(ids).size;
  result.idsPresent = ids.length;

  if (result.parsed === 0) {
    result.verdict = 'DEGRADED';
    result.reason = 'reached the source and parsed no listing';
  } else if (!result.idsUnique) {
    result.verdict = 'DEGRADED';
    result.reason = 'listing ids are not unique within one page';
  } else if (ids.length < result.parsed) {
    result.verdict = 'DEGRADED';
    result.reason = `${result.parsed - ids.length} of ${result.parsed} listings carry no id`;
  } else {
    result.verdict = 'LIVE_OK';
    result.reason = `parsed ${result.parsed} listing(s), all with unique ids`;
  }

  return result;
}

async function main() {
  const runtime = createPortalRuntime();
  const adapters = runtime.registry.all()
    .filter((a) => (only.length ? only.includes(a.id) : true));

  if (!adapters.length) {
    process.stderr.write(`no adapter matched ${only.join(', ') || '(all)'}\n`);
    process.exit(1);
  }

  const results = [];
  for (const adapter of adapters) {
    const result = await testOne(adapter, runtime.context, runtime);
    results.push(result);

    if (!JSON_ONLY) {
      process.stderr.write(
        `${result.adapterId.padEnd(20)} ${result.verdict.padEnd(12)}`
        + ` parsed=${String(result.parsed).padStart(2)}`
        + ` req=${String(result.networkRequests).padStart(2)}`
        + ` ${String(result.latencyMs).padStart(6)}ms`
        + `  ${result.reason.slice(0, 80)}\n`,
      );
      for (const l of result.listings) {
        process.stderr.write(
          `    id=${String(l.externalId).padEnd(10)} q=${l.quality}`
          + ` ${l.propertyType ?? '—'} ${l.areaSqm ?? '—'}sqm`
          + ` ${l.price ?? 'no price'} ${l.city ?? '—'}/${l.district ?? '—'}`
          + ` ${l.publishedAt ?? 'no date'}\n`,
        );
      }
    }
    // Between sources as well as within one. The per-source rate limiter
    // already spaces requests; this spaces the SOURCES.
    await new Promise((r) => setTimeout(r, 2000));
  }

  const stats = runtime.stats();
  process.stdout.write(`${JSON.stringify({ results, stats }, null, 2)}\n`);

  if (!JSON_ONLY) {
    const ok = results.filter((r) => r.verdict === 'LIVE_OK').map((r) => r.adapterId);
    process.stderr.write(
      `\nfetch path: ${stats.networkRequests} network request(s), `
      + `${stats.cacheHits} cache hit(s), ${stats.coalescedJoins} coalesced join(s)\n`
      + `LIVE_OK: ${ok.join(', ') || 'none'}\n`
      + 'This script promotes nothing. Writing LIVE_TESTED is a separate decision.\n',
    );
  }
}

main().catch((error) => {
  process.stderr.write(`live test failed: ${error?.stack ?? error}\n`);
  process.exit(1);
});
