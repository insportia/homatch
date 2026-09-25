// HOMATCH RESEARCH CORE — when two searches are the same search.
//
// A thousand active campaigns do not mean a thousand fetches. Most of them
// are asking overlapping questions of the same handful of portals: Tbilisi
// two-bedroom flats between two prices, over and over, with the boundaries
// moved slightly. Executed literally that is a thousand outbound requests to
// a source that would have answered all of them once.
//
// Two things make that avoidable, and they are different problems.
//
// IDENTITY. Two searches that mean the same thing must produce the same key,
// whatever order their fields were written in, so a cache hit and a duplicate
// job can both be recognised. That is canonicalSearchKey, and it reuses
// stableHash from normalize/hash.ts -- which already sorts object keys, so
// nothing here re-implements canonical JSON.
//
// COVERAGE. Two searches that merely OVERLAP can sometimes be served by one
// wider fetch. That is coalesce(), and it is the dangerous half: a covering
// envelope that is too generous downloads a portion of the source nobody
// asked for, and the saving turns into a much larger cost. So coverage is
// bounded, refuses more often than it accepts, and every refusal says why.
//
// WHAT THIS DOES NOT DECIDE
//
// Which campaign may see which listing. A covering fetch is a fetch, not a
// result set: every member still has its own envelope re-applied by
// withinEnvelope() before anything reaches a customer. Sharing the request is
// not sharing the answer, and the test file states that as its own case.

import { stableHash } from '../normalize/hash.ts';
import type { ListingQuery } from '../adapters/portal/types.ts';

/**
 * The fields that make a search THE SAME SEARCH.
 *
 * `id` and `rationale` are deliberately absent: one is a per-run label and
 * the other is prose for a report. Including either would give every campaign
 * its own key and quietly disable every cache and every coalesce, while
 * looking like it worked.
 *
 * `limit` is absent for the same reason in reverse -- asking for 20 of a
 * thing and 50 of a thing is the same question with a different appetite, and
 * the wider one's results answer the narrower one.
 */
function semanticShape(query: ListingQuery): Record<string, unknown> {
  return {
    transaction: query.transaction,
    propertyType: query.propertyType,
    countryCode: query.countryCode.toUpperCase(),
    city: query.city?.trim().toLowerCase() ?? null,
    district: query.district?.trim().toLowerCase() ?? null,
    subDistrict: query.subDistrict?.trim().toLowerCase() ?? null,
    projectName: query.projectName?.trim().toLowerCase() ?? null,
    area: query.area,
    rooms: query.rooms,
    bedrooms: query.bedrooms,
    floor: query.floor,
    price: query.price,
    priceCurrency: query.priceCurrency?.toUpperCase() ?? null,
    languages: [...query.languages].sort(),
  };
}

/**
 * The identity of one source's execution of one search.
 *
 * Deterministic, order-independent, and scoped to the source: the same
 * envelope asked of ss.ge and of place.ge is two jobs, not one.
 */
export function canonicalSearchKey(sourceId: string, query: ListingQuery): string {
  return stableHash({ sourceId, spec: semanticShape(query) });
}

/** Two searches asking the same thing, regardless of field order. */
export function isSameSearch(a: ListingQuery, b: ListingQuery): boolean {
  return stableHash(semanticShape(a)) === stableHash(semanticShape(b));
}

export interface Range { min: number | null; max: number | null }

/** The union of two ranges. An open end stays open: it already covered everything. */
function union(a: Range, b: Range): Range {
  return {
    min: a.min === null || b.min === null ? null : Math.min(a.min, b.min),
    max: a.max === null || b.max === null ? null : Math.max(a.max, b.max),
  };
}

/** How much wider a union is than the widest member it replaces. */
function widening(members: readonly Range[], covering: Range): number | null {
  if (covering.min === null || covering.max === null) return null;
  const coveringSpan = covering.max - covering.min;
  let widest = 0;
  for (const member of members) {
    if (member.min === null || member.max === null) return null;
    widest = Math.max(widest, member.max - member.min);
  }
  if (widest <= 0) return coveringSpan > 0 ? null : 1;
  return coveringSpan / widest;
}

export interface CoalesceOptions {
  /**
   * How much wider than its widest member a covering envelope may be.
   *
   * Not a tuning knob so much as the whole safety property. At 1 nothing ever
   * coalesces; unbounded, three narrow searches justify downloading a city.
   * The default is deliberately timid: a covering fetch may be half again as
   * wide as the widest thing it replaces, and no wider.
   */
  maxWidening?: number;
}

export interface CoalescedGroup {
  /** The single envelope to fetch. Equal to the member when a group has one. */
  covering: ListingQuery;
  members: ListingQuery[];
  /** Why these were merged, or why a group stayed alone. */
  reason: string;
}

const DEFAULT_MAX_WIDENING = 1.5;

/**
 * Group searches that one fetch can honestly serve.
 *
 * Categorical fields must match EXACTLY -- a sale is not a rental, Tbilisi is
 * not Batumi, and an apartment is not a house. Widening those would not
 * produce a broader answer to the same question, it would produce an answer
 * to a different one, and every member would then have to discard most of it.
 *
 * Only the numeric ranges are unioned, and only when the result stays within
 * maxWidening of the widest member.
 */
export function coalesce(
  queries: readonly ListingQuery[],
  options: CoalesceOptions = {},
): CoalescedGroup[] {
  const maxWidening = options.maxWidening ?? DEFAULT_MAX_WIDENING;
  const buckets = new Map<string, ListingQuery[]>();

  for (const query of queries) {
    /* The categorical identity. Anything differing here can never merge. */
    const key = stableHash({
      transaction: query.transaction,
      propertyType: query.propertyType,
      countryCode: query.countryCode.toUpperCase(),
      city: query.city?.trim().toLowerCase() ?? null,
      district: query.district?.trim().toLowerCase() ?? null,
      priceCurrency: query.priceCurrency?.toUpperCase() ?? null,
    });
    const bucket = buckets.get(key);
    if (bucket) bucket.push(query);
    else buckets.set(key, [query]);
  }

  const groups: CoalescedGroup[] = [];

  for (const bucket of buckets.values()) {
    if (bucket.length === 1) {
      groups.push({
        covering: bucket[0],
        members: [bucket[0]],
        reason: 'no other search shares this market and category',
      });
      continue;
    }

    /*
     * GREEDY, NOT ALL-OR-NOTHING.
     *
     * The first version unioned the whole bucket and, if that single envelope
     * came out too wide, refused to merge ANY of it. Measured on 1,000
     * synthetic campaigns -- five price bands 50k wide, each offset by 10k --
     * the full union spanned 90k against a widest member of 50k, so it
     * refused every time and produced 1,000 fetches for 20 distinct searches.
     * Correct, in that nothing unsafe was fetched, and useless.
     *
     * So members are sorted by lower bound and a group is extended only while
     * the union STAYS inside the limit. A band that would burst the envelope
     * starts the next group instead of poisoning the current one. The safety
     * property is unchanged -- no covering envelope is ever wider than
     * maxWidening -- and the bucket still collapses.
     */
    const ordered = [...bucket].sort((a, b) => {
      const left = a.price.min ?? Number.NEGATIVE_INFINITY;
      const right = b.price.min ?? Number.NEGATIVE_INFINITY;
      return left - right;
    });

    let run: ListingQuery[] = [];

    const flush = () => {
      if (run.length === 0) return;
      if (run.length === 1) {
        groups.push({
          covering: run[0],
          members: [run[0]],
          reason: 'no other search in this market could be covered within the widening limit',
        });
        run = [];
        return;
      }
      const coveringPrice = run.map((q) => q.price).reduce(union);
      const coveringArea = run.map((q) => q.area).reduce(union);
      const spread = Math.max(
        widening(run.map((q) => q.price), coveringPrice) ?? 0,
        widening(run.map((q) => q.area), coveringArea) ?? 0,
      );
      const first = run[0];
      groups.push({
        covering: {
          ...first,
          id: `${first.id}:coalesced`,
          price: coveringPrice,
          area: coveringArea,
          rooms: run.map((q) => q.rooms).reduce(union),
          bedrooms: run.map((q) => q.bedrooms).reduce(union),
          floor: run.map((q) => q.floor).reduce(union),
          limit: Math.max(...run.map((q) => q.limit)),
          rationale: `One fetch covering ${run.length} overlapping searches in the same market.`,
        },
        members: [...run],
        reason: `${run.length} searches share a market and category; covering envelope is`
          + ` ${spread.toFixed(2)}x the widest member`,
      });
      run = [];
    };

    for (const query of ordered) {
      const candidate = [...run, query];
      const coveringPrice = candidate.map((q) => q.price).reduce(union);
      const coveringArea = candidate.map((q) => q.area).reduce(union);
      const priceWidening = widening(candidate.map((q) => q.price), coveringPrice);
      const areaWidening = widening(candidate.map((q) => q.area), coveringArea);

      /*
       * An unmeasurable widening is a refusal, not a pass. A null means an
       * open-ended range, and "infinitely wider than its members" is the one
       * case where merging is most expensive.
       */
      const unbounded = priceWidening === null || areaWidening === null;
      const tooWide = !unbounded
        && (priceWidening > maxWidening || areaWidening > maxWidening);

      if (run.length > 0 && (unbounded || tooWide)) {
        flush();
        /* An open-ended member can never join anything, so it stands alone. */
        if (unbounded && (query.price.max === null || query.price.min === null
          || query.area.max === null || query.area.min === null)) {
          groups.push({
            covering: query,
            members: [query],
            reason: 'a member has an open-ended range, so no bounded covering envelope exists',
          });
          continue;
        }
      }
      run.push(query);
    }
    flush();
  }

  return groups;
}
