// HOMATCH — DISCOVER → CLASSIFY → AUDIT, with nobody at a laptop.
//
// Every source in source_registry got its access_finding because a person ran
// scripts/audit-source-shape.mjs and read the output. The script says so itself:
// "This script decides nothing." source-lifecycle.ts has modelled
// DISCOVERED → AUDITED since the day it was written, and until recently nothing
// in production ever advanced a source along it.
//
// This function is the producer and the consumer of that ladder. Three modes,
// deliberately separate, because they fail for different reasons and a caller
// needs to know which one did:
//
//   classify  what IS each row? A website, a subreddit, or an artefact of the
//             retired provider discovery. Reads no network at all.
//   discover  harvest candidate hosts from the outbound links of sources we are
//             already permitted to read. Produces DISCOVERED rows.
//   audit     read a candidate's robots.txt, sitemaps and one page, and record
//             what it is. DISCOVERED → AUDITED.
//
// WHICH NETWORK PATH, AND WHY IT IS NOT THE PORTAL ONE
//
// `audit` fetches hosts that arrived in a database row, so it uses
// createCandidateAuditPath() — DNS resolved, every returned address classified,
// ports 80 and 443 only, three re-validated redirect hops, 600KB, no
// credentials. See src/research-core/net/candidate-host.ts for the whole posture
// and for the one thing it still cannot do.
//
// `discover` reads pages of sources that are already IMPLEMENTED or beyond, so
// it uses createPortalRuntime() — those hosts have SourcePolicies and belong on
// that path. Two trust models, two paths, and this function is where the
// difference becomes visible: an unvetted host is never fetched through the
// portal allowlist, and an implemented portal is never fetched under the
// candidate policy.
//
// WHAT IT WILL NOT DO
//
// Request a source whose lifecycle already says no. BLOCKED and RETIRED are
// decisions, and a worker that re-probes them is exactly the "successful fetch
// of a BLOCKED source" that advance() treats as a control having been bypassed.
//
// Activate anything. `discover` inserts rows with active = false, no adapter, no
// tier and no family. `audit` writes access_finding, source_family and the
// evidence and moves DISCOVERED → AUDITED. What a source is WORTH stays a
// judgement for a person.
//
// Invent a source. Every row `discover` inserts is a link that was present in a
// document it fetched, and that document's URL is stored on the row.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createPortalRuntime, PORTAL_SOURCE_POLICIES } from '../../../src/research-core/market/runtime.ts';
import {
  auditSource,
  type AuditFinding,
  type FetchedDocument,
} from '../../../src/research-core/discovery/source-audit.ts';
import {
  classifyRegistryRow,
  summariseClassifications,
  type CandidateClassification,
} from '../../../src/research-core/discovery/candidate-classification.ts';
import {
  harvestCandidates,
  summariseHarvest,
  type HarvestSource,
} from '../../../src/research-core/discovery/candidate-discovery.ts';
import { createCandidateAuditPath } from '../../../src/research-core/net/candidate-host.ts';
import { DohResolver } from '../../../src/research-core/net/doh-resolver.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Lifecycles this must never request. Both are decisions, not observations. */
const UNTOUCHABLE = new Set(['BLOCKED', 'RETIRED']);

/** Rungs whose documents may be harvested for outbound links. */
const HARVEST_FROM = ['IMPLEMENTED', 'FIXTURE_TESTED', 'LIVE_TESTED', 'PRODUCTIVE'];

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

/** Registrable domains that already have a portal SourcePolicy. */
function implementedDomains(): string[] {
  return [...new Set(PORTAL_SOURCE_POLICIES.flatMap((policy) => policy.domains))];
}

const today = () => new Date().toISOString().slice(0, 10);

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
    const mode = String(body.mode ?? 'audit').toLowerCase();

    if (mode === 'classify') return await classify(db, body, started);
    if (mode === 'discover') return await discover(db, body, started);
    if (mode === 'audit') return await audit(db, body, started);

    return json({ error: `unknown mode "${mode}"; expected classify, discover or audit` }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * CLASSIFY — what is this row, actually?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Reads no network. Every judgement comes from the URL, and the registry's own
 * `platform` column is treated as a claim to be checked rather than a fact:
 * measured 2026-09-26, 297 of the 314 DISCOVERED rows declared platform FORUM
 * and every one was a subreddit.
 *
 * NOTHING IS DELETED. A row that turns out never to have been a source
 * (`https://google.com`, `https://t.me/`) moves to RETIRED, which is the state
 * for "deliberately stopped, kept for history". Its url, its created_at and its
 * provenance stay exactly as they were.
 */
async function classify(
  db: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  started: number,
) {
  const limit = Math.max(1, Math.min(500, Number(body.limit) || 400));
  const dryRun = body.dryRun === true;
  const domains = implementedDomains();

  const { data: rows, error } = await db
    .from('source_registry')
    .select('id,name,url,platform,source_type,lifecycle,source_family')
    .eq('lifecycle', 'DISCOVERED')
    .is('source_family', null)
    .not('url', 'is', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  if (!rows?.length) {
    return json({
      success: true, mode: 'classify', classified: 0,
      note: 'every DISCOVERED row already carries a source_family or has left DISCOVERED',
      elapsedMs: Date.now() - started,
    });
  }

  const classifications: CandidateClassification[] = [];
  const written: Array<{ url: string; kind: string; family: string | null; lifecycle: string }> = [];
  const failures: Array<{ url: string; error: string }> = [];

  for (const row of rows) {
    const result = classifyRegistryRow({
      url: String(row.url),
      platform: row.platform as string | null,
      sourceType: row.source_type as string | null,
      name: row.name as string | null,
      implementedDomains: domains,
    });
    classifications.push(result);

    if (dryRun) continue;

    const rationale =
      `Classified automatically ${today()}: ${result.kind}. ${result.rationale}`
      + (result.declaredPlatformMismatch ? ` Note: ${result.declaredPlatformMismatch}.` : '')
      + (result.retire ? ' Retired rather than deleted: the row is history, not a source.' : '');

    const patch: Record<string, unknown> = {
      priority_rationale: rationale,
      updated_at: new Date().toISOString(),
    };
    /*
     * A family is written only when one has been EARNED. A candidate website
     * keeps a null family until the audit reads it: guessing PROPERTY_PORTAL
     * from a hostname is the invented metadata this pass exists to clean up.
     */
    if (result.family) patch.source_family = result.family;
    if (result.retire) {
      patch.lifecycle = 'RETIRED';
      patch.lifecycle_changed_at = new Date().toISOString();
      // An artefact must not sit in anybody's active source list.
      patch.active = false;
    }

    const { error: writeErr } = await db.from('source_registry').update(patch).eq('id', row.id);
    if (writeErr) failures.push({ url: String(row.url), error: writeErr.message });
    else {
      written.push({
        url: String(row.url),
        kind: result.kind,
        family: result.family,
        lifecycle: result.retire ? 'RETIRED' : 'DISCOVERED',
      });
    }
  }

  const summary = summariseClassifications(classifications);

  return json({
    success: true,
    mode: 'classify',
    dryRun,
    classified: classifications.length,
    summary,
    written: written.length,
    failures,
    sample: written.slice(0, 8),
    /*
     * The number that matters is `auditable`. When it is zero the audit step has
     * no input, and saying "nothing to do" would read as a healthy queue.
     */
    note: summary.auditable === 0
      ? `none of the ${summary.total} row(s) classified is a candidate website, so the audit step `
        + 'still has no input from this set. Mode "discover" is what produces candidates.'
      : `${summary.auditable} candidate website(s) are now available to mode "audit".`,
    elapsedMs: Date.now() - started,
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * DISCOVER — where a candidate source comes from.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * From the outbound links of sources Homatch is already permitted to read. Their
 * home pages, partner lists and directories are pages whose purpose is to name
 * the other real participants in this market, and a link is evidence a person
 * can check.
 *
 * This reads IMPLEMENTED-and-beyond hosts through createPortalRuntime, because
 * those hosts have SourcePolicies. It never reads an unvetted host: a candidate
 * is not allowed to nominate others until it has earned PERMITTED, or one
 * unreviewed site could introduce a thousand more.
 */
async function discover(
  db: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  started: number,
) {
  const maxSources = Math.max(1, Math.min(12, Number(body.maxSources) || 8));
  const maxInsert = Math.max(1, Math.min(40, Number(body.maxInsert) || 20));
  const dryRun = body.dryRun === true;
  const domains = implementedDomains();

  const { data: seeds, error } = await db
    .from('source_registry')
    .select('id,name,url,lifecycle,source_family')
    .in('lifecycle', HARVEST_FROM)
    .not('url', 'is', null)
    .order('last_successful_at', { ascending: false, nullsFirst: false })
    .limit(maxSources);
  if (error) throw error;

  if (!seeds?.length) {
    return json({
      success: true, mode: 'discover', inserted: 0,
      note: 'no source has reached IMPLEMENTED or beyond, so there is nothing whose links may be '
        + 'harvested. Discovery deliberately refuses to harvest from unaudited hosts.',
      elapsedMs: Date.now() - started,
    });
  }

  const runtime = createPortalRuntime();
  const harvestSources: HarvestSource[] = [];
  const unreadable: Array<{ url: string; reason: string }> = [];

  for (const seed of seeds) {
    if (UNTOUCHABLE.has(String(seed.lifecycle))) continue;

    let origin: URL;
    try {
      origin = new URL(String(seed.url));
    } catch {
      unreadable.push({ url: String(seed.url), reason: 'unparseable URL on the registry row' });
      continue;
    }

    try {
      // The front page only. A footer and a partner list are there, and one
      // request per source is all a discovery pass is owed.
      const page = await runtime.context.fetchDocument(`${origin.origin}/`);
      harvestSources.push({
        url: page.url,
        domain: registrableOf(origin.hostname),
        html: page.body,
        // The harvester enforces the rung itself, so passing the real one means
        // a seed somehow below PERMITTED is refused there too.
        lifecycle: String(seed.lifecycle),
      });
    } catch (fetchError) {
      unreadable.push({
        url: origin.origin,
        reason: fetchError instanceof Error ? fetchError.message : String(fetchError),
      });
    }
  }

  const objective = {
    market: String(body.market ?? 'GE'),
    languages: (Array.isArray(body.languages) ? body.languages : ['ka', 'en', 'ru']) as never,
    intent: String(body.intent ?? 'BOTH').toUpperCase() as 'SUPPLY' | 'DEMAND' | 'BOTH',
    region: (body.region as string | null) ?? null,
  };

  const candidates = harvestCandidates(harvestSources, objective);
  const harvest = summariseHarvest(harvestSources, candidates);

  /*
   * Dedupe against what the registry already holds, by HOST. A second row for a
   * domain we already know would inflate the count and split its history, which
   * is the failure mode of a registry that grows by re-discovery.
   */
  const { data: existing } = await db.from('source_registry').select('url').limit(2000);
  const known = new Set(
    (existing ?? [])
      .map((row) => {
        try { return new URL(String(row.url)).hostname.toLowerCase().replace(/^www\./, ''); }
        catch { return null; }
      })
      .filter((host): host is string => host !== null),
  );

  const fresh = candidates.filter((candidate) => {
    const host = candidate.host.replace(/^www\./, '');
    if (known.has(host)) return false;
    // A domain that already has a SourcePolicy is not a discovery.
    return !domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  });

  const toInsert = fresh.slice(0, maxInsert);
  const inserted: Array<{ url: string; relevance: number }> = [];
  const failures: Array<{ url: string; error: string }> = [];

  if (!dryRun) {
    for (const candidate of toInsert) {
      const { error: insertErr } = await db.from('source_registry').insert({
        platform: 'WEBSITE',
        source_type: 'WEBSITE',
        url: candidate.url,
        name: candidate.domain,
        country_code: objective.market,
        // NOT ACTIVE. A discovered domain is a lead, and nothing reads a lead.
        active: false,
        priority: 5,
        lifecycle: 'DISCOVERED',
        lifecycle_changed_at: new Date().toISOString(),
        access_state: 'PUBLIC',
        // No family and no tier. The audit decides the first from what it reads;
        // the second is a business judgement and stays with a person.
        source_family: null,
        priority_tier: null,
        priority_rationale:
          `Discovered automatically ${today()} from the outbound links of `
          + `${candidate.discoveredFrom.join(', ')}. Linked ${candidate.linkCount}x`
          + (candidate.anchors.length
            ? ` under anchor text: ${candidate.anchors.slice(0, 3).join(' | ')}`
            : '')
          + `. Relevance ${candidate.relevance}: ${candidate.rationale} `
          + 'Not active, not tiered, no family: nothing has read this site yet.',
      });
      if (insertErr) failures.push({ url: candidate.url, error: insertErr.message });
      else inserted.push({ url: candidate.url, relevance: candidate.relevance });
    }
  }

  return json({
    success: true,
    mode: 'discover',
    dryRun,
    objective,
    seedsConsidered: seeds.length,
    harvest,
    unreadable,
    candidatesFound: candidates.length,
    alreadyKnown: candidates.length - fresh.length,
    newCandidates: fresh.length,
    inserted: inserted.length,
    failures,
    top: toInsert.slice(0, 10).map((candidate) => ({
      url: candidate.url,
      relevance: candidate.relevance,
      linkedFromDocuments: candidate.discoveredFrom.length,
      why: candidate.rationale.slice(0, 160),
    })),
    fetch: runtime.stats(),
    note: 'every row inserted is a link that was present in a document this run fetched, with that '
      + 'document recorded on the row. Nothing was activated, tiered or given a family.',
    elapsedMs: Date.now() - started,
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * AUDIT — read a candidate and record what it is.
 * ═══════════════════════════════════════════════════════════════════════════ */
async function audit(
  db: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  started: number,
) {
  const limit = Math.max(1, Math.min(5, Number(body.limit) || 2));
  const domains = implementedDomains();

  /*
   * Oldest first, and only what has never been characterised. Re-auditing a
   * source that already has a finding spends somebody's rate limit to learn what
   * is already written down; a person who wants that re-checked can clear it.
   *
   * THE FAMILY FILTER IS GONE, and it was the wrong instrument. It excluded all
   * 314 legacy rows because every one had a NULL family — but so does a genuine
   * candidate website, right up until the audit that gives it one. Eligibility
   * is now decided by classifying the URL, below.
   */
  const { data: rows, error } = await db
    .from('source_registry')
    .select('id,name,url,platform,source_type,lifecycle,access_finding,source_family')
    .eq('lifecycle', 'DISCOVERED')
    .is('access_finding', null)
    .not('url', 'is', null)
    .order('created_at', { ascending: true })
    .limit(limit * 20);
  if (error) throw error;

  const eligible: Array<{ row: Record<string, unknown>; classification: CandidateClassification }> = [];
  const skipped: Record<string, number> = {};

  for (const row of rows ?? []) {
    const classification = classifyRegistryRow({
      url: String(row.url),
      platform: row.platform as string | null,
      sourceType: row.source_type as string | null,
      name: row.name as string | null,
      implementedDomains: domains,
    });
    if (classification.auditable) {
      if (eligible.length < limit) eligible.push({ row, classification });
    } else {
      skipped[classification.kind] = (skipped[classification.kind] ?? 0) + 1;
    }
  }

  if (!eligible.length) {
    /*
     * "NOTHING TO DO" AND "NOTHING I AM ABLE TO DO" ARE DIFFERENT ANSWERS, and
     * reporting the second as the first hid the real state here once already.
     * What is reported instead is the count waiting and the classification of
     * what was examined, which is actionable: mode "discover" is the fix.
     */
    const { count } = await db
      .from('source_registry')
      .select('id', { count: 'exact', head: true })
      .eq('lifecycle', 'DISCOVERED')
      .is('access_finding', null);
    const waiting = Number(count ?? 0);

    return json({
      success: true,
      mode: 'audit',
      audited: 0,
      discoveredRowsUnaudited: waiting,
      skippedByClassification: skipped,
      note: waiting === 0
        ? 'nothing is waiting in DISCOVERED'
        : `${waiting} row(s) sit in DISCOVERED and none of the ${(rows ?? []).length} examined is a `
          + 'candidate website. They are community identifiers and artefacts of the retired '
          + 'provider discovery. Mode "discover" produces candidate websites.',
      elapsedMs: Date.now() - started,
    });
  }

  /*
   * THE CANDIDATE PATH, not the portal one. These hosts arrived in a database
   * row and have no SourcePolicy, which is exactly the case
   * createCandidateAuditPath exists for: DNS is resolved and every address it
   * returns must classify as public.
   *
   * The resolver is DNS-over-HTTPS because there is no resolver in a Deno Edge
   * Function — `node:dns` does not exist here and research-core is forbidden
   * from importing one. Without a resolver NetworkPolicy fails closed, so this
   * is what makes the path work at all rather than an optimisation of it.
   */
  const auditPath = createCandidateAuditPath({ resolver: new DohResolver() });
  const results: Array<Record<string, unknown>> = [];

  for (const { row, classification } of eligible) {
    if (UNTOUCHABLE.has(String(row.lifecycle))) {
      results.push({ name: row.name, access: 'SKIPPED', recorded: false,
        detail: `${row.lifecycle} is a decision; not requested` });
      continue;
    }

    const origin = new URL(String(row.url));
    const refusals: string[] = [];

    const read = async (path: string): Promise<FetchedDocument | null> => {
      const target = new URL(path, origin).toString();
      const result = await auditPath.fetchCandidate(target);
      if (result.ok) {
        return { url: result.finalUrl ?? target, status: result.status ?? 0, body: result.body ?? '' };
      }

      /*
       * A refusal is evidence, and WHICH refusal matters. "this host resolves
       * into private space" and "this host's robots.txt says no" are different
       * facts about a candidate, and collapsing them into "fetch failed" is how
       * an auditor records our own configuration as a property of somebody's
       * website. That has happened here twice.
       */
      refusals.push(`${result.refusal}${result.detail ? ` (${result.detail})` : ''}`);

      // A 4xx is a real answer from a real server, and auditSource needs the
      // status to tell 403 (anti-bot) from a page that simply is not there.
      if (result.refusal === 'HTTP_ERROR' && typeof result.status === 'number') {
        return { url: target, status: result.status, body: '' };
      }
      return null;
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

    /*
     * A run where the NETWORK POLICY refused everything tells us nothing about
     * the site: a host that resolves into private space, or a name that does not
     * resolve at all, is a fact about the ROW rather than a characterisation of a
     * website. The row is left exactly as it was and the response says why.
     */
    const policyRefusedAll = refusals.length > 0
      && !robots && !sitemap && !detail
      && refusals.every((reason) => /PRIVATE_ADDRESS|DNS_|NO_ADDRESSES|HOST_BLOCKED|INTERNAL_HOSTNAME|PORT_NOT_ALLOWED|SCHEME_NOT_ALLOWED|CREDENTIALS_IN_URL|MALFORMED_URL/.test(reason));

    if (policyRefusedAll) {
      results.push({
        name: row.name,
        url: row.url,
        access: 'NETWORK_REFUSED',
        recorded: false,
        refusals,
        detail: `nothing was read from ${origin.host} and nothing was recorded: every attempt was `
          + 'refused by the network policy, which is a fact about this row rather than about a site.',
      });
      continue;
    }

    const finding: AuditFinding = auditSource({
      host: origin.host, robots, sitemap, childSitemap, detail,
    });

    /*
     * DISCOVERED → AUDITED, and no further. An audit establishes what a source
     * is, never that it is implemented or worth implementing. The evidence
     * sentence is stored so a person reviewing the row sees what was actually
     * read rather than trusting the label.
     */
    const { error: writeErr } = await db
      .from('source_registry')
      .update({
        lifecycle: 'AUDITED',
        lifecycle_changed_at: new Date().toISOString(),
        access_finding: FINDING[finding.access] ?? null,
        priority_rationale:
          `Audited automatically ${today()} over the candidate-host path: `
          + `${finding.access} / ${finding.shape}. ${finding.evidence}.`
          + (finding.pathShapes.length
            ? ` Top path shapes: ${finding.pathShapes.slice(0, 3).map((p) => `${p.count}x ${p.shape}`).join(', ')}.`
            : '')
          + (refusals.length ? ` Refused reads: ${refusals.join('; ')}.` : '')
          + ' Not tiered: what a source is worth is a judgement for a person.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    results.push({
      name: row.name,
      url: row.url,
      classifiedAs: classification.kind,
      access: finding.access,
      shape: finding.shape,
      recorded: !writeErr,
      ...(refusals.length ? { refusals } : {}),
      ...(writeErr ? { detail: writeErr.message } : {}),
    });
  }

  return json({
    success: true,
    mode: 'audit',
    audited: results.length,
    results,
    skippedByClassification: skipped,
    networkRequests: auditPath.networkRequests(),
    elapsedMs: Date.now() - started,
    note: 'fetched over the candidate-host path: DNS resolved and every address classified public, '
      + 'ports 80/443, re-validated redirects, 600KB cap, no credentials. access_finding and '
      + 'evidence written; lifecycle DISCOVERED -> AUDITED. No adapter, no active flag, no tier.',
  });
}

/** Registrable domain, matching the harvester's own rule. */
function registrableOf(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  const TWO_PART = new Set([
    'com.ge', 'org.ge', 'net.ge', 'edu.ge', 'gov.ge', 'co.uk', 'com.tr', 'com.ua', 'co.il',
  ]);
  return TWO_PART.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}
