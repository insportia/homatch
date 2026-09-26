// HOMATCH — auditing candidate sources without a person at a laptop.
//
// Every one of the sources in source_registry got its access_finding because
// somebody ran scripts/audit-source-shape.mjs and read the output. The script
// says so itself: "This script decides nothing." And source-lifecycle.ts has
// modelled DISCOVERED -> AUDITED since it was written, while nothing in
// production ever advanced a source along it — because the only thing that
// could was a script nobody scheduled.
//
// That is the ceiling on the registry, not the supply of candidate websites.
// This removes it: DISCOVERED rows are audited here, on the same fetch path
// every adapter uses, and the finding is written back with its evidence.
//
// WHAT IT WILL NOT DO
//
// Request a source whose lifecycle already says no. BLOCKED and RETIRED are
// decisions, and a worker that re-probes them is exactly the "successful fetch
// of a BLOCKED source" that advance() treats as a control having been
// bypassed.
//
// Enable anything. It writes access_finding, source_family and the evidence,
// and moves DISCOVERED -> AUDITED. It never sets an adapter, never sets
// active, and never assigns priority_tier — what a source is WORTH is a
// business judgement and it stays with a person.
//
// Fetch more than it needs. Five documents per host at most: robots.txt, the
// sitemap, one child sitemap, and one candidate detail page. No pagination, no
// recursion, no queue of its own.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createPortalRuntime } from '../../../src/research-core/market/runtime.ts';
import {
  auditSource,
  type AuditFinding,
  type FetchedDocument,
} from '../../../src/research-core/discovery/source-audit.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Lifecycles this must never request. Both are decisions, not observations. */
const UNTOUCHABLE = new Set(['BLOCKED', 'RETIRED']);

/**
 * How the audit's access verdict maps onto source_registry.access_finding.
 *
 * The column's vocabulary is fixed by a check constraint, and the audit's
 * UNKNOWN has no member there — a source we could not characterise keeps a
 * null finding rather than being given the most convenient one.
 */
const FINDING: Record<string, string | null> = {
  PUBLIC_HTML: 'PUBLIC_HTML',
  ROBOTS_DISALLOWED: 'ROBOTS_DISALLOWED',
  ANTI_BOT: 'ANTI_BOT',
  UNREACHABLE: 'UNREACHABLE',
  UNKNOWN: null,
};

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
      .from('admin_settings').select('value').eq('key', 'source_audit_token').maybeSingle();
    const expected = String(tokenRow?.value ?? '').replace(/^"|"$/g, '');
    if (!expected || presented !== expected) return json({ error: 'Forbidden' }, 403);
  }

  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(5, Number(body.limit) || 2));

    /*
     * Oldest first, and only what has never been characterised. Re-auditing a
     * source that already has a finding spends somebody's rate limit to learn
     * what is already written down; a person who wants that re-checked can
     * clear the finding.
     */
    const { data: candidates, error } = await db
      .from('source_registry')
      .select('id,name,url,lifecycle,access_finding,source_family')
      .eq('lifecycle', 'DISCOVERED')
      .is('access_finding', null)
      .not('url', 'is', null)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw error;

    if (!candidates?.length) {
      return json({
        success: true, audited: 0,
        note: 'no DISCOVERED source is waiting for a first audit',
      });
    }

    const runtime = createPortalRuntime();
    const results: Array<{ name: string; access: string; shape: string; recorded: boolean; detail?: string }> = [];

    for (const row of candidates) {
      if (UNTOUCHABLE.has(String(row.lifecycle))) {
        results.push({ name: row.name, access: 'SKIPPED', shape: 'SKIPPED', recorded: false,
          detail: `${row.lifecycle} is a decision; not requested` });
        continue;
      }

      let origin: URL;
      try {
        origin = new URL(String(row.url));
      } catch {
        results.push({ name: row.name, access: 'UNKNOWN', shape: 'UNKNOWN', recorded: false,
          detail: 'the registry row carries no parseable URL' });
        continue;
      }

      /*
       * The runtime refuses a host with no SourcePolicy, which is the boundary
       * that keeps this from becoming a general-purpose fetcher. A candidate
       * nobody has written a policy for is reported as such rather than
       * reached anyway.
       */
      const read = async (path: string): Promise<FetchedDocument | null> => {
        try {
          const page = await runtime.context.fetchDocument(new URL(path, origin).toString());
          return { url: page.url, status: page.status, body: page.body };
        } catch {
          return null;
        }
      };

      const robots = await read('/robots.txt');
      const sitemap = await read('/sitemap.xml');

      /* One child sitemap, only when the first was an index. */
      let childSitemap: FetchedDocument | null = null;
      const firstChild = sitemap?.status === 200
        ? /<loc>\s*([^<\s]+\.xml)\s*<\/loc>/i.exec(sitemap.body)?.[1]
        : undefined;
      if (firstChild) childSitemap = await read(firstChild);

      /* One candidate detail page: the longest non-xml URL the sitemaps named,
         which is the likeliest to be a listing rather than a category. */
      const pool = [sitemap, childSitemap]
        .filter((d): d is FetchedDocument => !!d && d.status === 200)
        .flatMap((d) => [...d.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]))
        .filter((u) => !/\.xml(\.gz)?$/i.test(u));
      const candidateDetail = pool.sort((a, b) => b.length - a.length)[0];
      const detail = candidateDetail ? await read(candidateDetail) : null;

      const finding: AuditFinding = auditSource({
        host: origin.host, robots, sitemap, childSitemap, detail,
      });

      const accessFinding = FINDING[finding.access] ?? null;

      /*
       * DISCOVERED -> AUDITED, and no further. An audit establishes what a
       * source is, never that it is implemented or worth implementing. The
       * evidence sentence is stored so a person reviewing the row can see
       * what was actually read rather than trusting the label.
       */
      const { error: writeErr } = await db
        .from('source_registry')
        .update({
          lifecycle: 'AUDITED',
          lifecycle_changed_at: new Date().toISOString(),
          access_finding: accessFinding,
          priority_rationale:
            `Audited automatically ${new Date().toISOString().slice(0, 10)}: `
            + `${finding.access} / ${finding.shape}. ${finding.evidence}.`
            + (finding.pathShapes.length
              ? ` Top path shapes: ${finding.pathShapes.slice(0, 3).map((p) => `${p.count}x ${p.shape}`).join(', ')}.`
              : '')
            + ' Not tiered: what a source is worth is a judgement for a person.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      results.push({
        name: row.name,
        access: finding.access,
        shape: finding.shape,
        recorded: !writeErr,
        ...(writeErr ? { detail: writeErr.message } : {}),
      });
    }

    return json({
      success: true,
      audited: results.length,
      results,
      fetch: runtime.stats(),
      elapsedMs: Date.now() - started,
      note: 'access_finding and evidence written; lifecycle DISCOVERED -> AUDITED. '
        + 'No adapter, no active flag and no priority_tier were set.',
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
