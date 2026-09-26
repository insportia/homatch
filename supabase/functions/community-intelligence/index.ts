// HOMATCH — asking the global intelligence store a question with a clock in it.
//
// timeBounds() landed with the time model and had no consumers: nine windows were
// computable and nothing ever queried with them, so "LAST HOUR" and "THIS MONTH"
// existed as types and never as answers. This is the read side.
//
// WHAT IT REFUSES TO BLUR
//
// Three things, each of which is a plausible-looking lie if it is blurred:
//
//   WHICH CLOCK. "Buyers who posted today" is published_at; "buyers we found
//   today" is discovered_at. Both are real questions with different answers, and
//   published_at is nullable, so the two windows legitimately return different
//   rows. The column is a parameter and every response states which one answered.
//
//   A CALENDAR BOUNDARY IS LOCAL, A DURATION IS NOT. A Tbilisi operator at 01:00
//   asking for "today" does not mean "since 04:00 yesterday UTC". timeBounds()
//   already knows this; this function's job is to pass the offset through rather
//   than quietly dropping it, which would produce an off-by-one-day report that
//   looks completely reasonable.
//
//   ZERO IS A MEASUREMENT, ABSENT IS NOT. A bucket with no evidence is returned as
//   zero rather than omitted, because a sparse series drawn as a line implies
//   continuity that was never observed. What the store does NOT hold is the most
//   important thing an operator can learn from this endpoint, and it is only
//   visible if the empty buckets are there.
//
// IT COMPUTES NOTHING ITSELF
//
// The windows come from the research core and the aggregation from one SQL
// function. This file resolves a request into those two calls and shapes the
// answer; if it ever grows its own idea of when a week starts, the seam has
// stopped being a seam.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  bucketCount,
  timeBounds,
  type TimeBucket,
  type TimeWindow,
} from '../../../src/research-core/signals/community-evidence.ts';
/*
 * The bucket grid comes from the core, not from here. It has to agree with
 * date_trunc EXACTLY -- the series is assembled by matching generated bucket
 * starts against the query's output as strings -- and a second copy that
 * truncated a week to Sunday would orphan every real value and render the chart
 * as zeroes beside its own data, without throwing.
 */
import { bucketStarts } from '../../../src/research-core/signals/time-buckets.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});

const WINDOWS: readonly TimeWindow[] = [
  'LAST_HOUR', 'TODAY', 'YESTERDAY', 'LAST_24H',
  'THIS_WEEK', 'LAST_7D', 'THIS_MONTH', 'LAST_30D', 'CUSTOM',
];

const BUCKETS: readonly TimeBucket[] = ['HOUR', 'DAY', 'WEEK', 'MONTH'];

/**
 * The most buckets one answer may contain.
 *
 * Thirty days by hour is 720, which is a large but legitimate chart. A five-year
 * custom range by hour is 43,800 — a query nobody should run and a chart nobody
 * can read. Refused with the count, so the caller can see what it asked for
 * rather than being told "too large".
 */
const MAX_BUCKETS = 1_000;

/** The bucket that suits a window, when the caller does not say. */
function defaultBucket(window: TimeWindow): TimeBucket {
  switch (window) {
    case 'LAST_HOUR':
    case 'TODAY':
    case 'YESTERDAY':
    case 'LAST_24H':
      return 'HOUR';
    case 'THIS_WEEK':
    case 'LAST_7D':
      return 'DAY';
    case 'THIS_MONTH':
    case 'LAST_30D':
      return 'DAY';
    default:
      return 'DAY';
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const baseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!baseUrl || !serviceKey) return json({ error: 'not configured' }, 500);

  const db = createClient(baseUrl, serviceKey, { auth: { persistSession: false } });

  /*
   * ADMIN ONLY, AND CHECKED AGAINST THE DATABASE.
   *
   * This reads across every customer's evidence, so the caller's own claim about
   * itself is not enough: the JWT identifies a user and `users.is_admin` decides.
   */
  const authorization = req.headers.get('authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Unauthorized' }, 401);

  const { data: caller } = await db.auth.getUser(token);
  if (!caller?.user) return json({ error: 'Unauthorized' }, 401);
  const { data: profile } = await db
    .from('users').select('is_admin').eq('id', caller.user.id).maybeSingle();
  if (profile?.is_admin !== true) return json({ error: 'Forbidden' }, 403);

  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));

    const window = String(body.window ?? 'LAST_7D').toUpperCase() as TimeWindow;
    if (!WINDOWS.includes(window)) {
      return json({ error: `unknown window: ${window}`, supported: WINDOWS }, 400);
    }

    const column = String(body.column ?? 'discovered_at');
    if (!['published_at', 'discovered_at', 'last_verified_at'].includes(column)) {
      return json({
        error: `unknown time column: ${column}`,
        supported: ['published_at', 'discovered_at', 'last_verified_at'],
      }, 400);
    }

    const bucket = (body.bucket ? String(body.bucket).toUpperCase() : defaultBucket(window)) as TimeBucket;
    if (!BUCKETS.includes(bucket)) {
      return json({ error: `unknown bucket: ${bucket}`, supported: BUCKETS }, 400);
    }

    /*
     * timeBounds() throws for a CUSTOM window with unusable dates, and that is a
     * 400 rather than a 500: the caller asked for something impossible, and the
     * message it wrote says which part.
     */
    let bounds;
    try {
      bounds = timeBounds({
        window,
        column: column as 'published_at' | 'discovered_at' | 'last_verified_at',
        from: body.from ? String(body.from) : undefined,
        to: body.to ? String(body.to) : undefined,
        tzOffsetMinutes: Number.isFinite(Number(body.tzOffsetMinutes))
          ? Number(body.tzOffsetMinutes)
          : 0,
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }

    const count = bucketCount(bounds, bucket);
    if (count > MAX_BUCKETS) {
      return json({
        error: 'that window and bucket would produce more points than any chart can carry',
        buckets: count,
        maxBuckets: MAX_BUCKETS,
        /* Named so the caller can fix it rather than guess. */
        suggestion: bucket === 'HOUR' ? 'DAY' : bucket === 'DAY' ? 'WEEK' : 'MONTH',
      }, 400);
    }

    const { data: rows, error } = await db.rpc('community_evidence_timeseries', {
      p_from: bounds.from,
      p_to: bounds.to,
      p_column: bounds.column,
      p_bucket: bucket,
      p_platform: body.platform ? String(body.platform).toUpperCase() : null,
      p_direction: body.direction ? String(body.direction).toUpperCase() : null,
      p_language: body.language ? String(body.language).toLowerCase() : null,
    });
    /*
     * THE RPC'S REFUSALS ARE REAL ANSWERS, not server faults. An unknown platform
     * raises inside the enum cast on purpose -- so a misspelling cannot read as
     * "no evidence on that platform" -- and that has to reach the caller as a 400
     * with the database's own words, not a 500 that hides which input was wrong.
     */
    if (error) return json({ error: error.message, bounds, bucket }, 400);

    const observed = new Map<string, Record<string, unknown>>();
    for (const row of rows ?? []) {
      observed.set(new Date(String(row.bucket_start)).toISOString(), row);
    }

    const series = bucketStarts(bounds, bucket, MAX_BUCKETS + 1).map((start) => {
      const row = observed.get(start);
      return {
        bucketStart: start,
        /* Zero, never absent. An omitted bucket drawn as a line claims a
           continuity that was never observed. */
        evidence: Number(row?.evidence_count ?? 0),
        demand: Number(row?.demand_count ?? 0),
        supply: Number(row?.supply_count ?? 0),
        reference: Number(row?.reference_count ?? 0),
        unknown: Number(row?.unknown_count ?? 0),
        unavailable: Number(row?.unavailable_count ?? 0),
        /*
         * Whether this count came from a real aggregate row or from filling a gap.
         * Both report zero when there is nothing, and the difference still matters:
         * it is the only way a reader can tell a bucket the query genuinely
         * returned from one this file generated to keep the series continuous.
         */
        fromQuery: row !== undefined,
      };
    });

    const totals = series.reduce((acc, point) => ({
      evidence: acc.evidence + point.evidence,
      demand: acc.demand + point.demand,
      supply: acc.supply + point.supply,
      reference: acc.reference + point.reference,
      unknown: acc.unknown + point.unknown,
      unavailable: acc.unavailable + point.unavailable,
    }), { evidence: 0, demand: 0, supply: 0, reference: 0, unknown: 0, unavailable: 0 });

    return json({
      success: true,
      window,
      /*
       * THE BOUNDS AND THE CLOCK, echoed. A count whose window cannot be read off
       * its own answer is a count nobody can reproduce, and the column is the half
       * of it that a reader would otherwise assume.
       */
      bounds,
      bucket,
      buckets: series.length,
      filters: {
        platform: body.platform ? String(body.platform).toUpperCase() : null,
        direction: body.direction ? String(body.direction).toUpperCase() : null,
        language: body.language ? String(body.language).toLowerCase() : null,
      },
      totals,
      /* How many buckets held evidence, against how many were asked about. The
         emptiness is the finding, so it is stated rather than left to be counted
         off the series by whoever reads it. */
      bucketsWithEvidence: series.filter((point) => point.evidence > 0).length,
      series,
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
