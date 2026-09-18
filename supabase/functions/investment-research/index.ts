// HOMATCH INVESTMENT INTELLIGENCE — market evidence for a consultation.
//
// WHAT THIS DOES NOT DO
//
// It does not crawl. It does not cache. It does not keep a source registry,
// a cost ledger, a networking layer or a browser pool. Every one of those is
// src/research-core's, already shared with Verify's own market lane, and
// this function is a CONSUMER of it: createPortalRuntime() builds the one
// policy-enforced fetch path, and runInvestmentLane() asks it the two
// questions an investment consultation has — what are comparable units
// asking to sell for, and what are they asking to let for.
//
// TWO SWEEPS, KEPT APART
//
// Sale and rent are separate runs producing separate ranges on separate
// price bases, because the core refuses to pool across bases and it is
// right to: an asking rent and an asking sale price do not average into
// anything real.
//
// WHAT THE RESULT IS AND IS NOT
//
// It is ASKING evidence. It positions a price among listings. It is NOT a
// market value, not a transaction record and not a forecast, and the basis
// travels on every range so no renderer can quietly drop the distinction.
// Georgia's Public Registry does not publish transaction prices in a form
// public research can read — the core's MARKET_COMPARABLES profile says so
// and marks that objective permanently unavailable — so this function never
// claims one.
//
// BILLING: FREE, AND WHY THAT IS THE HONEST ANSWER RATHER THAN A GIVEAWAY
//
// This lane calls no metered provider. It is direct, rate-limited,
// robots-respecting HTTP to an operator-configured portal allowlist, so its
// landed COGS is compute and nothing else. Homatch prices a product against
// `billable_products.reference_landed_cogs_cents`, and there is no
// investment product row: creating one would be a pricing decision, which
// belongs in the database with the rest of billing v2 and not in a function.
// Charging credits for a call that spends nothing would be inventing a
// price; so this is free and bounded by a per-user daily ceiling on the
// SAME rate_limit_events table the AI assistant already uses. If and when
// investment research grows a paid provider leg, that leg goes through
// beginExecution against a real product row, exactly like Verify.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createPortalRuntime } from '../../../src/research-core/market/runtime.ts';
import {
  pricePerSqmSummary,
  runInvestmentLane,
  subjectSupportsResearch,
  type LaneSubject,
} from '../../../src/investment/evidence/lane.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RATE_LIMIT_OPERATION = 'investment_market_sweep';
/** A sweep is six pages, not a crawl. Twelve a day is generous for a person. */
const DAILY_SWEEP_LIMIT = 12;
const LANE_BUDGET_MS = 18_000;

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

function text(value: unknown, max = 120): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function positive(value: unknown, max: number): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > max) return null;
  return n;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user?.id) return json({ error: 'unauthorized' }, 401);

    const { data: profile } = await supabase
      .from('users')
      .select('id')
      .eq('auth_id', auth.user.id)
      .maybeSingle();
    const uid = profile?.id as string | undefined;
    if (!uid) return json({ error: 'profile_not_found' }, 404);

    const body = await req.json().catch(() => ({}));

    /*
     * THE SUBJECT IS REBUILT FROM SCALARS, NEVER ACCEPTED AS AN OBJECT.
     *
     * Nothing the client sends reaches the fetch path as a URL, a host or a
     * path. It supplies a city, a district and a few numbers; the adapter
     * turns those into a query against a fixed allowlist. That is what makes
     * `skipDnsResolution` sound in the portal runtime — no URL on this path
     * comes from a user.
     */
    const city = text(body?.city);
    if (!city) return json({ error: 'city_required' }, 400);

    const subject: LaneSubject = {
      city,
      district: text(body?.district),
      areaSqm: positive(body?.areaSqm, 100_000),
      rooms: positive(body?.rooms, 60),
      bedrooms: positive(body?.bedrooms, 60),
      propertyType: text(body?.propertyType, 40),
      projectName: text(body?.projectName),
      countryCode: text(body?.countryCode, 2) ?? 'GE',
    };

    if (!subjectSupportsResearch(subject)) {
      // The core's own bar. "Every apartment in Tbilisi" is not a comparable
      // set, and running it would burn requests to produce noise.
      return json({ error: 'subject_too_broad', code: 'SUBJECT_TOO_BROAD' }, 400);
    }

    const requested: Array<'SALE' | 'RENT'> = Array.isArray(body?.transactions)
      ? (body.transactions as unknown[]).filter(
          (t): t is 'SALE' | 'RENT' => t === 'SALE' || t === 'RENT',
        )
      : ['SALE', 'RENT'];
    const transactions = requested.length ? [...new Set(requested)] : (['SALE', 'RENT'] as const);

    /* ── Fair use: free, but bounded ───────────────────────────────── */
    const now = new Date();
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).toISOString();
    const { count } = await supabase
      .from('rate_limit_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uid)
      .eq('operation', RATE_LIMIT_OPERATION)
      .gte('created_at', dayStart);
    if ((count ?? 0) >= DAILY_SWEEP_LIMIT) {
      const resetAt = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
      ).toISOString();
      return json(
        { error: 'rate_limited', code: 'RATE_LIMIT_EXCEEDED', limit: DAILY_SWEEP_LIMIT, resetAt },
        429,
      );
    }

    const runtime = createPortalRuntime();

    /*
     * Sequential, not parallel.
     *
     * The two sweeps hit the SAME portal, and the per-source rate limit in
     * the runtime is deliberately gentle (two concurrent, one a second).
     * Firing both at once would queue behind that limiter anyway while
     * doubling the chance of tripping the circuit breaker, and the portal
     * owes us nothing.
     */
    const lanes = [];
    for (const transaction of transactions) {
      lanes.push(
        await runInvestmentLane(subject, transaction, runtime.registry, runtime.context, {
          budgetMs: LANE_BUDGET_MS,
        }),
      );
    }

    await supabase.from('rate_limit_events').insert({ user_id: uid, operation: RATE_LIMIT_OPERATION });

    const stats = runtime.stats();

    return json({
      subject,
      lanes: lanes.map((lane) => ({
        ...lane,
        pricePerSqm: lane.transaction === 'SALE' ? pricePerSqmSummary(lane.comparables) : null,
      })),
      /** Honest counters, not a progress bar. */
      research: {
        networkRequests: stats.networkRequests,
        cacheHits: stats.cacheHits,
        cacheMisses: stats.cacheMisses,
        coalescedJoins: stats.coalescedJoins,
      },
      /** What this evidence is, stated in the payload and not only in the UI. */
      basisNote: 'ASKING_ONLY',
    });
  } catch (error) {
    console.error('investment-research failed', error instanceof Error ? error.message : String(error));
    return json({ error: 'internal_error' }, 500);
  }
});
