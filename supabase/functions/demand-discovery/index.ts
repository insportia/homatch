// HOMATCH — reading what people are LOOKING FOR, in production.
//
// Every other discovery path in this system reads supply: somebody with a
// flat, telling you about the flat. This reads the other side, and it is the
// side that makes Homatch more than a listings aggregator.
//
// THE DEMAND SIDE HAS BEEN DEAD SINCE AUGUST
//
// raw_signals holds 868 rows. All of them came from APIFY or DATAFORSEO, the
// newest is 2026-08-29, and 672 came from reddit.com — whose robots.txt is
// "User-agent: * / Disallow: /". That route is closed and will not be
// reopened without Reddit's own API and credentials Homatch does not have.
//
// So this reads a board that says we may. forum.ge states Crawl-delay: 2 for
// everyone, which is a clearer invitation than any property portal in the
// registry gave.
//
// THE SAME DOOR AS SUPPLY
//
// It builds createPortalRuntime() — the SSRF host allowlist, the robots
// checker, the per-source rate limiter, the circuit breaker, the request
// coalescer, the document cache. A forum host with no SourcePolicy is not
// fetched at all, exactly like a portal host. There is one fetch path in this
// system and adding a second for demand would mean two places to get robots
// wrong.
//
// WHAT IT WRITES
//
// raw_signals, which already had the freshness contract and the provenance
// columns. NOT a new demand table: a campaign asks one question of one
// market and the answer is both sides of it, so the convergence has to
// happen in the store rather than in a join written later.
//
// WHAT IT REFUSES
//
// A source the registry has not marked scannable. A post whose direction the
// classifier could not decide is KEPT and marked UNKNOWN — dropping those
// would make it impossible to see how much of a board this reader cannot
// read, which is the difference between a quiet source and a broken one.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createPortalRuntime } from '../../../src/research-core/market/runtime.ts';
import { observe, readTopic, topicUrls } from '../../../src/research-core/adapters/forum/board.ts';
import { forumSourceById } from '../../../src/research-core/adapters/forum/sources.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Seven days, matching the evidence delivery window on the supply side. */
const DEFAULT_WINDOW_DAYS = 7;

interface SourceRow {
  id: string;
  name: string | null;
  url: string;
  adapter_id: string | null;
  lifecycle: string;
  active: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server configuration missing' }, 500);

  const db = createClient(supabaseUrl, serviceKey);

  /* A worker surface: no customer, no user JWT, a private token. */
  const presented = req.headers.get('x-cron-token') || '';
  const authorization = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (authorization !== serviceKey) {
    const { data: tokenRow } = await db
      .from('admin_settings').select('value').eq('key', 'demand_discovery_token').maybeSingle();
    const expected = String(tokenRow?.value ?? '').replace(/^"|"$/g, '');
    if (!expected || presented !== expected) return json({ error: 'Forbidden' }, 403);
  }

  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const maxThreads = Math.max(1, Math.min(10, Number(body.maxThreads) || 3));

    /*
     * THE REGISTRY DECIDES. A reader existing in the bundle is not permission
     * to read a board — the same rule the supply path applies, and the reason
     * a FIXTURE_TESTED source cannot reach a customer's budget.
     */
    const { data: sourceRows, error: sourceError } = await db
      .from('source_registry')
      .select('id,name,url,adapter_id,lifecycle,active')
      .eq('source_family', 'FORUM')
      .eq('active', true)
      .in('lifecycle', ['LIVE_TESTED', 'PRODUCTIVE', 'FIXTURE_TESTED']);
    if (sourceError) throw sourceError;

    const permitted = (sourceRows ?? []).filter((r: SourceRow) => r.adapter_id) as SourceRow[];
    if (permitted.length === 0) {
      return json({
        success: true, sourcesPermitted: 0, postsRead: 0,
        note: 'no FORUM source is active and at least fixture-tested; nothing was fetched',
      });
    }

    const runtime = createPortalRuntime();
    const perSource: Record<string, unknown>[] = [];
    let readTotal = 0;
    let written = 0;
    let discovered = 0;
    let updated = 0;
    const directions: Record<string, number> = {};

    for (const source of permitted) {
      const config = forumSourceById(source.adapter_id!);
      if (!config) {
        perSource.push({ source: source.adapter_id, outcome: 'NO_READER' });
        continue;
      }

      let board;
      try {
        board = await runtime.context.fetchDocument(source.url);
      } catch (error) {
        perSource.push({ source: config.id, outcome: 'ERROR', detail: message(error) });
        await recordFailure(db, source.id, message(error));
        continue;
      }
      if (board.status >= 400) {
        /* A refusal is recorded against the SOURCE, so a board that has
           started saying no shows as DEGRADED rather than as a quiet market. */
        perSource.push({ source: config.id, outcome: 'BLOCKED', status: board.status });
        await recordFailure(db, source.id, `board answered HTTP ${board.status}`);
        continue;
      }

      const threads = topicUrls(board.body, source.url, config);
      let sourceRead = 0;
      let sourceWritten = 0;

      for (const thread of threads.slice(0, maxThreads)) {
        let page;
        try {
          page = await runtime.context.fetchDocument(thread);
        } catch { continue; }
        if (page.status >= 400) continue;

        for (const post of readTopic(page.body, thread, config)) {
          sourceRead += 1;
          readTotal += 1;
          const signal = observe(post, config);
          directions[signal.direction] = (directions[signal.direction] ?? 0) + 1;

          const result = await persist(db, source, signal, config.countryCode);
          if (!result) continue;
          sourceWritten += 1;
          written += 1;
          if (result.isNew) discovered += 1; else updated += 1;
        }
      }

      await db.from('source_registry').update({
        last_collected_at: new Date().toISOString(),
        last_successful_at: new Date().toISOString(),
        failure_count: 0,
        last_failure_reason: null,
        scanned_signal_count: sourceRead,
        updated_at: new Date().toISOString(),
      }).eq('id', source.id);

      perSource.push({
        source: config.id,
        outcome: 'OK',
        threadsAvailable: threads.length,
        threadsRead: Math.min(threads.length, maxThreads),
        postsRead: sourceRead,
        postsPersisted: sourceWritten,
      });
    }

    return json({
      success: true,
      sourcesPermitted: permitted.length,
      postsRead: readTotal,
      signalsWritten: written,
      signalsNew: discovered,
      signalsUpdated: updated,
      /*
       * The direction split, which is the number this whole path exists to
       * move. A run that reads two hundred posts and finds no DEMAND has
       * told us something real about the board.
       */
      directions,
      perSource,
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
  signal: any,
  countryCode: string,
): Promise<{ isNew: boolean } | null> {
  if (!signal.externalId) return null;
  const now = new Date().toISOString();

  const { data: existing } = await db
    .from('raw_signals')
    .select('id,content_fingerprint,discovered_at')
    .eq('source_id', source.id)
    .eq('external_id', signal.externalId)
    .maybeSingle();

  const shared = {
    source_id: source.id,
    platform: 'FORUM',
    external_id: signal.externalId,
    source_url: signal.sourceUrl,
    author_public_name: signal.authorName,
    original_text: signal.originalText,
    /* OBSERVED on the post. A Russian post on a Georgian board is Russian. */
    language: signal.language,
    published_at: signal.publishedAt,
    content_fingerprint: signal.contentFingerprint,
    /*
     * The provider is HOMATCH, not a vendor. Every existing row says APIFY
     * or DATAFORSEO and this is the first that does not — which is also how
     * the admin view will be able to separate what we read from what we
     * bought.
     */
    provider: 'HOMATCH',
    /*
     * POST, matching the 868 rows already here. platform already says FORUM,
     * so FORUM_POST would be a second spelling of a fact the row states
     * twice -- and a column with two vocabularies is one nobody can group by.
     */
    content_type: 'POST',
    access_class: 'PUBLIC',
    research_direction: signal.direction,
    direction_confidence: signal.directionConfidence,
    /*
     * A BROKER SAYING "MY CLIENTS ARE LOOKING FOR 2BR FLATS" IS NOT A LEAD.
     *
     * Not a rejection on its own -- an agency posting inventory is perfectly
     * good SUPPLY, and that is most of what a portal is. It disqualifies a
     * post as DEMAND, where an agency advertising its buyer list is a sales
     * pitch aimed at sellers. One of those delivered as a buyer costs more
     * trust than ten missed leads.
     *
     * NULL on every row collected before this column existed, and null is
     * not false: the retired providers never asked the question.
     */
    author_is_agency: signal.agencyVoice,
    /*
     * PENDING, not CLASSIFIED. classifyDirection decided SUPPLY or DEMAND,
     * which is not the same as having extracted a budget, a district and a
     * property type — that is the classifier's job and it runs separately.
     * Marking these CLASSIFIED here would hide them from it forever.
     */
    classification_status: 'PENDING',
    mock_mode: false,
    last_seen_at: now,
  };

  if (!existing) {
    /*
     * A FIRST SIGHTING IS NOT A VERIFICATION. last_verified_at stays null and
     * expires_at bounds how long this may be delivered on — the same
     * contract supply_observations holds.
     */
    const { error } = await db.from('raw_signals').insert({
      ...shared,
      discovered_at: now,
      last_verified_at: null,
      validation_state: 'UNVERIFIED',
      expires_at: new Date(Date.parse(now) + DEFAULT_WINDOW_DAYS * 86_400_000).toISOString(),
    });
    if (error) return null;
    return { isNew: true };
  }

  /*
   * A second sighting moves content_changed_at ONLY if the fingerprint moved.
   * An edited post is new evidence; the same post seen again is not.
   * discovered_at is absent from this update on purpose.
   */
  const changed = existing.content_fingerprint !== signal.contentFingerprint;
  const { error } = await db.from('raw_signals').update({
    ...shared,
    ...(changed ? { content_changed_at: now } : {}),
  }).eq('id', existing.id);
  if (error) return null;
  return { isNew: false };
}

async function recordFailure(db: any, sourceId: string, reason: string) {
  const { data: row } = await db
    .from('source_registry').select('failure_count').eq('id', sourceId).maybeSingle();
  await db.from('source_registry').update({
    failure_count: Number(row?.failure_count ?? 0) + 1,
    last_failure_reason: reason.slice(0, 500),
    last_collected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', sourceId);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
