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
import { contentHash } from '../../../src/research-core/normalize/hash.ts';

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
    const limit = Math.max(1, Math.min(25, Number(body.limit) || 10));

    /*
     * The oldest sightings first, and only ones at or past their window.
     * Re-reading something seen an hour ago spends somebody's rate limit to
     * learn nothing.
     */
    const { data: due, error } = await db
      .from('supply_observations')
      .select('id,adapter_id,canonical_url,content_fingerprint,last_seen_at,validation_state,'
        + 'source:source_registry!source_id(lifecycle,access_finding)')
      .lte('expires_at', new Date().toISOString())
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
      let fingerprint: string | null = null;
      let detail: string | null = null;

      if (!row.canonical_url) {
        outcome = 'UNKNOWN';
        detail = 'the observation carries no URL';
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
          if (page.status === 404 || page.status === 410) {
            /*
             * GONE, AND THAT IS INFORMATION. The listing sold, or was
             * withdrawn, or the portal reorganised. REMOVED is recorded and
             * the row stays: what it said, and when, is still true.
             */
            outcome = 'REMOVED';
            detail = `HTTP ${page.status}`;
          } else if (page.status >= 400) {
            outcome = 'INACCESSIBLE';
            detail = `HTTP ${page.status}`;
          } else {
            /*
             * Fingerprinted on the page's own text, the same way the first
             * sighting was. A body that hashes the same is the same listing
             * saying the same thing; a different hash is new evidence, and
             * the difference is what content_changed_at records.
             *
             * NOT a re-parse. Deciding here whether the PRICE moved would
             * mean a second extraction path that could disagree with the
             * adapter, and two readers of one page is how a field ends up
             * with two truths.
             */
            fingerprint = contentHash(page.body);
            outcome = fingerprint === row.content_fingerprint ? 'UNCHANGED_VALID' : 'CHANGED_VALID';
          }
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
      const conclusive = outcome === 'UNCHANGED_VALID' || outcome === 'CHANGED_VALID'
        || outcome === 'REMOVED';

      const update: Record<string, unknown> = {
        last_revalidation_outcome: outcome,
        updated_at: now,
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
        if (outcome === 'CHANGED_VALID' && fingerprint) {
          update.content_fingerprint = fingerprint;
          update.content_changed_at = now;
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
