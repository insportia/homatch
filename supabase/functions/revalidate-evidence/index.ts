// HOMATCH — the worker that re-reads evidence, so nothing else has to.
//
// WHY THIS EXISTS SEPARATELY FROM THE MATCH RUN
//
// The freshness contract says evidence older than the window is revalidated
// before it is shown. Doing that inside a match run, or worse inside a page
// view, has two failure modes and both are bad:
//
//   the customer waits on somebody else's server
//   a signal wanted by forty campaigns is re-read forty times
//
// So run-matching-v2 refuses stale evidence and QUEUES it. This claims from
// that queue, on its own tick, at its own rate.
//
// WHAT IT IS ALLOWED TO CONCLUDE
//
// Six outcomes, and the three that are not conclusive are the reason this is
// careful. A timeout is INACCESSIBLE and establishes nothing; the queue puts
// the job back and applyRevalidation advances no timestamp. Only a real read
// producing real content is UNCHANGED_VALID or CHANGED_VALID.
//
// A 200 IS NOT A READ. A cookie wall, a consent interstitial and a soft 404
// all answer 200 and carry nothing, so a response that produced no usable
// text is UNKNOWN rather than a confirmation.
//
// WHAT IT WILL NOT DO
//
// Reach a source the registry says we may not. A signal whose source is
// BLOCKED is completed as INACCESSIBLE without a request being made: the
// block is a decision, and a revalidation worker is not the place to
// relitigate it. Nor does it touch the retired providers -- it fetches public
// URLs over plain HTTP with an identifying User-Agent, and nothing else.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  loadFreshnessPolicy,
  recordRevalidation,
  type RevalidationOutcome,
} from '../_shared/evidenceFreshness.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/* The same identity the crawler uses everywhere else. Named, reachable, and
   honest about what it is. */
const USER_AGENT =
  'HomatchResearch/1.0 (+https://homatch.ge/research-bot; respects robots.txt and rate limits)';

/** Sources we have established we may not read. Never requested. */
const BLOCKED_LIFECYCLES = new Set(['BLOCKED', 'RETIRED']);

/*
 * AND THE OTHER HALF: A SOURCE NOBODY HAS AUDITED IS NOT ONE WE MAY READ.
 *
 * BLOCKED is the easy case -- we looked and the answer was no. The harder one
 * is DISCOVERED: a URL that exists in the registry because some earlier sweep
 * put it there, whose robots.txt nobody has ever asked.
 *
 * This matters immediately rather than theoretically. Production holds 119
 * classified signals, all from 2026-08-28/29 and all therefore outside the
 * seven-day window, and nearly all of them come from Reddit communities the
 * retired discovery registered without auditing. Revalidating them naively
 * would mean several hundred requests to a site whose terms nobody here has
 * read, to re-check evidence from sources the lifecycle already excludes from
 * campaigns.
 *
 * So the worker re-reads only where an audit established a permitted route.
 * An unaudited source produces UNKNOWN -- honest, cheap, and it leaves the
 * evidence exactly as undeliverable as it already was.
 */
const PERMITTED_FINDINGS = new Set(['PUBLIC_HTML', 'API_AVAILABLE', 'FEED_AVAILABLE']);

interface FetchResult {
  outcome: RevalidationOutcome;
  text: string | null;
  detail: string;
}

/**
 * Re-read one piece of evidence.
 *
 * The mapping from what happened to what it MEANS is the whole job:
 *
 *   404 / 410          REMOVED     the source says it is gone
 *   401 / 403          INACCESSIBLE a wall. Says nothing about the listing.
 *   429 / 5xx          INACCESSIBLE their problem, and temporary
 *   timeout / network  INACCESSIBLE ours, and temporary
 *   200 with content   the caller decides valid or invalid
 *   200 with nothing   UNKNOWN     we read a page and learned nothing
 */
async function reread(url: string, timeoutMs: number): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,*/*' },
    });

    if (response.status === 404 || response.status === 410) {
      return { outcome: 'REMOVED', text: null, detail: `HTTP ${response.status}` };
    }
    if (response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500) {
      return { outcome: 'INACCESSIBLE', text: null, detail: `HTTP ${response.status}` };
    }
    if (!response.ok) {
      return { outcome: 'UNKNOWN', text: null, detail: `HTTP ${response.status}` };
    }

    const body = await response.text();
    const text = readableText(body);
    if (!text) {
      /*
       * The page answered and carried nothing we could read. That is not a
       * confirmation and it is not a removal -- it is a page we do not
       * understand, and saying so is the only honest option.
       */
      return { outcome: 'UNKNOWN', text: null, detail: 'the response carried no readable text' };
    }
    return { outcome: 'UNCHANGED_VALID', text, detail: `read ${text.length} characters` };
  } catch (error) {
    const name = (error as { name?: string })?.name;
    return {
      outcome: 'INACCESSIBLE',
      text: null,
      detail: name === 'AbortError' ? 'timeout' : String((error as Error)?.message ?? error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The visible text of a page, roughly.
 *
 * Deliberately crude: this is deciding "did we read anything at all", not
 * parsing a listing. Scripts and styles are removed because a cookie wall is
 * mostly script and would otherwise look like content.
 */
function readableText(html: string): string | null {
  const stripped = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 40 ? stripped.slice(0, 20_000) : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'Server configuration missing' }, 500);

  /*
   * The same private-token shape as the other cron-driven workers. This
   * belongs to no customer and cannot present a user JWT, so it authenticates
   * on a token in admin_settings and answers anything else with 403.
   */
  const db = createClient(url, serviceKey);
  const presented = req.headers.get('x-cron-token') || '';
  const authorization = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (authorization !== serviceKey) {
    const { data: tokenRow } = await db
      .from('admin_settings').select('value').eq('key', 'revalidation_worker_token').maybeSingle();
    const expected = typeof tokenRow?.value === 'string'
      ? tokenRow.value
      : (tokenRow?.value as { toString?: () => string } | null)?.toString?.() ?? '';
    if (!expected || presented !== String(expected).replace(/^"|"$/g, '')) {
      return json({ error: 'Forbidden' }, 403);
    }
  }

  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(50, Number(body.limit) || 10));
    const timeoutMs = Math.max(2000, Math.min(20_000, Number(body.timeoutMs) || 12_000));
    const worker = `revalidate-evidence:${crypto.randomUUID().slice(0, 8)}`;
    const policy = await loadFreshnessPolicy(db);

    const { data: jobs, error: claimError } = await db.rpc('claim_revalidation', {
      p_worker: worker, p_limit: limit,
    });
    if (claimError) throw claimError;
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return json({ success: true, claimed: 0, processed: 0, outcomes: {} });
    }

    const outcomes: Record<string, number> = {};
    let processed = 0;
    let changed = 0;

    for (const job of jobs) {
      const signalId = String(job.signal_id);

      const { data: signal } = await db
        .from('raw_signals')
        .select('id,source_url,source:source_registry!source_id(lifecycle,access_finding)')
        .eq('id', signalId)
        .maybeSingle();

      const source = Array.isArray(signal?.source) ? signal?.source[0] : signal?.source;
      const sourceLifecycle = String(source?.lifecycle ?? '');

      let result: FetchResult;
      if (!signal?.source_url) {
        /*
         * Evidence with no address cannot be re-read. Not a failure of ours
         * and not a statement about the listing -- UNKNOWN, permanently, and
         * the queue exhausts its attempts and stops asking.
         */
        result = { outcome: 'UNKNOWN', text: null, detail: 'the signal carries no source URL' };
      } else if (!PERMITTED_FINDINGS.has(String(source?.access_finding ?? ''))) {
        /*
         * Never audited, or audited and found to need something we will not
         * do. Either way no request is made, and the outcome says which.
         */
        result = {
          outcome: 'UNKNOWN',
          text: null,
          detail: source?.access_finding
            ? `source access is ${source.access_finding}; not requested`
            : `source is ${sourceLifecycle || 'unregistered'} and has never been audited; not requested`,
        };
      } else if (BLOCKED_LIFECYCLES.has(sourceLifecycle)) {
        /*
         * THE RULE THAT MATTERS. A blocked source is not requested, at all.
         * The block is a decision about whether we may read it, and a
         * background worker is not the place to relitigate it -- fetching
         * anyway would be exactly the bypass the lifecycle exists to prevent.
         */
        result = {
          outcome: 'INACCESSIBLE',
          text: null,
          detail: `source is ${sourceLifecycle} (${source?.access_finding ?? 'no finding'}); not requested`,
        };
      } else {
        result = await reread(String(signal.source_url), timeoutMs);
      }

      const written = await recordRevalidation(db, signalId, result.outcome, {
        text: result.text,
        policy,
      });
      if (written.contentChanged) changed++;

      await db.rpc('complete_revalidation', {
        p_id: job.id,
        p_outcome: result.outcome,
        p_error: written.ok ? result.detail : `${result.detail}; write failed: ${written.reason}`,
      });

      outcomes[result.outcome] = (outcomes[result.outcome] || 0) + 1;
      processed++;

      // One request at a time, spaced. Nineteen sites is not a load test and
      // neither is a revalidation backlog.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    return json({
      success: true,
      claimed: jobs.length,
      processed,
      contentChanged: changed,
      outcomes,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
