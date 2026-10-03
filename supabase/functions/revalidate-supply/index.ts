// HOMATCH — asking whether a listing is still what it said it was.
//
// supply_observations has carried the freshness contract since it was
// created: first_seen_at, last_seen_at, last_verified_at, content_changed_at,
// expires_at, validation_state. Every field was written honestly — a first
// sighting is not a verification, so last_verified_at stays null, and
// expires_at bounds how long that first sighting may be delivered on.
//
// Nothing ever re-checked them. So after seven days an observation silently
// left its window and stayed in the table looking exactly like a fresh one to
// anybody who did not read the date.
//
// revalidate-evidence does this for raw_signals, the demand side. This is its
// opposite number, and it is a SEPARATE function rather than a flag on that
// one because the two read different tables through different adapters and
// have different failure modes — a portal listing that 404s has been sold or
// withdrawn, a forum post that 404s has been deleted, and those are not the
// same event.
//
// WHAT IT WILL NOT DO
//
// Request a source the registry has not audited, or one it has BLOCKED. That
// check is the whole point of the lifecycle and a background worker is not
// the place to relitigate it.
//
// Delete anything. A listing that has gone is recorded as REMOVED, not
// erased: "this was on the market in September at $145,000 and is not now" is
// one of the more valuable things this system can know, and deleting the row
// would destroy it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createPortalRuntime } from '../../../src/research-core/market/runtime.ts';
import { extractListing } from '../../../src/research-core/adapters/portal/family.ts';
import { sourceById, sourceForUrl } from '../../../src/research-core/adapters/portal/sources.ts';
import {
  judgeRevalidation, revalidationMethod, snapshotOfListing, snapshotOfRow, SUPPLY_REVALIDATION_POLICY,
} from '../../../src/research-core/discovery/supply-revalidation.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Seven days, matching the window a first sighting is given. */
const WINDOW_DAYS = 7;

/**
 * Source access findings a request may be made against.
 *
 * Anything else — never audited, login required, anti-bot, terms prohibit —
 * means no request. The same list revalidate-evidence uses.
 */
const PERMITTED_FINDINGS = new Set(['PUBLIC_HTML', 'API_AVAILABLE', 'FEED_AVAILABLE']);
const BLOCKED_LIFECYCLES = new Set(['BLOCKED', 'RETIRED']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server configuration missing' }, 500);
  const db = createClient(supabaseUrl, serviceKey);

  const presented = req.headers.get('x-cron-token') || '';
  const authorization = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (authorization !== serviceKey) {
    const { data: tokenRow } = await db
      .from('admin_settings').select('value').eq('key', 'revalidation_worker_token').maybeSingle();
    const expected = String(tokenRow?.value ?? '').replace(/^"|"$/g, '');
    if (!expected || presented !== expected) return json({ error: 'Forbidden' }, 403);
  }

  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(SUPPLY_REVALIDATION_POLICY.MAX_PER_RUN, Number(body.limit) || 10));

    /*
     * The oldest sightings first, and only ones at or past their window.
     * Re-reading something seen an hour ago spends somebody's rate limit to
     * learn nothing.
     */
    const { data: due, error } = await db
      .from('supply_observations')
      .select('id,adapter_id,canonical_url,content_fingerprint,last_seen_at,validation_state,transaction,'
        + 'sale_amount,sale_currency,rent_amount,rent_currency,area_sqm,rooms,field_origins,'
        + 'source:source_registry!source_id(lifecycle,access_finding)')
      .lte('expires_at', new Date().toISOString())
      /* Community posts are not portal pages: their deletion is visible only to
         the channel reader (supply-revalidation.ts revalidationMethod). */
      .not('adapter_id', 'like', '%-community')
      .order('expires_at', { ascending: true })
      .limit(limit);
    if (error) throw error;

    if (!due?.length) {
      return json({
        success: true, due: 0, revalidated: 0,
        note: 'no observation has reached the end of its freshness window',
      });
    }

    const runtime = createPortalRuntime();
    const outcomes: Record<string, number> = {};
    let changed = 0;
    let verified = 0;

    for (const row of due) {
      const source = Array.isArray(row.source) ? row.source[0] : row.source;
      const lifecycle = String(source?.lifecycle ?? '');
      const finding = String(source?.access_finding ?? '');
      const now = new Date().toISOString();

      let outcome: string;
      let detail: string | null = null;
      let judged: ReturnType<typeof judgeRevalidation> | null = null;
      let current: ReturnType<typeof snapshotOfListing> | null = null;
      let httpStatus: number | null = null;
      const before = snapshotOfRow(row as never);

      if (revalidationMethod(row as never).method !== 'PORTAL_REFETCH') {
        outcome = 'UNKNOWN';
        detail = revalidationMethod(row as never).reason;
      } else if (BLOCKED_LIFECYCLES.has(lifecycle)) {
        /* A blocked source is not requested. Not now, not by a worker. */
        outcome = 'INACCESSIBLE';
        detail = `source is ${lifecycle}; not requested`;
      } else if (!PERMITTED_FINDINGS.has(finding)) {
        outcome = 'UNKNOWN';
        detail = finding
          ? `source access is ${finding}; not requested`
          : 'source has never been audited; not requested';
      } else {
        try {
          const page = await runtime.context.fetchDocument(row.canonical_url, { forceRefresh: true });
          httpStatus = page.status;
          /*
           * RE-READ WITH THE SAME READER. The page goes through the adapter
           * configuration that first extracted it (family.ts extractListing),
           * so price, area and rooms are compared field by field -- never a
           * whole-page hash, which changes with every ad and counter on the
           * page and used to report every listing as changed.
           */
          const config = sourceById(String(row.adapter_id ?? '')) ?? sourceForUrl(String(row.canonical_url));
          if (page.status >= 200 && page.status < 300 && config) {
            const extracted = extractListing(page.body, page.url || row.canonical_url, config);
            if (extracted.ok && extracted.listing) current = snapshotOfListing(extracted.listing as never, (row.transaction as string | null) ?? null);
          }
          judged = judgeRevalidation({ status: page.status, before, after: current });
          outcome = judged.outcome;
          if (outcome === 'REMOVED' || outcome === 'INACCESSIBLE') detail = `HTTP ${page.status}`;
          else if (outcome === 'UNKNOWN') detail = config ? 'the page answered but its adapter could not read it' : 'no adapter configuration reads this page';
        } catch (error) {
          outcome = 'INACCESSIBLE';
          detail = message(error);
        }
      }

      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;

      /*
       * WHAT A VERIFICATION IS. Only a request that actually reached the
       * source and read it moves last_verified_at. INACCESSIBLE and UNKNOWN
       * mean we did not find out, and writing a verification date for a
       * question nobody answered is the exact fabrication this contract
       * exists to prevent.
       */
      const conclusive = judged?.conclusive === true;

      /* What this check found, kept with the row: last checked, availability,
         HTTP answer, price movement and how sure the comparison was. */
      const origins = (row.field_origins && typeof row.field_origins === 'object') ? row.field_origins as Record<string, unknown> : {};
      const history = Array.isArray((origins.revalidation as Record<string, unknown> | undefined)?.priceHistory)
        ? ((origins.revalidation as Record<string, unknown>).priceHistory as unknown[]).slice(-9) : [];
      const priceChange = judged?.comparison?.priceChange ?? null;
      const update: Record<string, unknown> = {
        last_revalidation_outcome: outcome,
        updated_at: now,
        field_origins: {
          ...origins,
          revalidation: {
            checkedAt: now,
            outcome,
            httpStatus,
            availability: outcome === 'REMOVED' ? 'REMOVED' : conclusive ? 'AVAILABLE' : 'UNKNOWN',
            confidence: judged?.confidence ?? 0,
            changedFields: judged?.comparison?.changedFields ?? [],
            detail,
            priceHistory: priceChange && judged?.comparison?.changedFields.includes('price')
              ? [...history, { at: now, from: priceChange.from, to: priceChange.to, currency: priceChange.currency }]
              : history,
          },
        },
      };

      if (conclusive) {
        update.last_verified_at = now;
        update.last_seen_at = now;
        verified += 1;
        update.validation_state = outcome === 'REMOVED' ? 'REMOVED' : 'VALID';
        /* A new window only for something still there. */
        if (outcome !== 'REMOVED') {
          update.expires_at = new Date(Date.parse(now) + WINDOW_DAYS * 86_400_000).toISOString();
        }
        if (outcome === 'CHANGED_VALID' && current) {
          /* The listing now says this. content_fingerprint is NOT touched: it is
             the listing's own text identity, which dedupe relies on. */
          update.content_changed_at = now;
          if (current.price !== null && current.currency) {
            if (row.transaction === 'RENT') { update.rent_amount = current.price; update.rent_currency = current.currency; }
            else { update.sale_amount = current.price; update.sale_currency = current.currency; }
          }
          if (current.areaSqm !== null) update.area_sqm = current.areaSqm;
          if (current.rooms !== null) update.rooms = current.rooms;
          changed += 1;
        }
      } else {
        /*
         * UNVERIFIABLE, and last_verified_at is LEFT ALONE. A failed
         * revalidation must not overwrite a verification that really
         * happened earlier — the history is the point.
         */
        update.validation_state = 'UNVERIFIABLE';
      }

      await db.from('supply_observations').update(update).eq('id', row.id);
    }

    return json({
      success: true,
      due: due.length,
      verified,
      contentChanged: changed,
      outcomes,
      fetch: runtime.stats(),
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    return json({ error: message(error) }, 500);
  }
});

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
