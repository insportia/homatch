// MARKETPLACE SEARCH — the customer's side of the rebuilt Find Property.
//
// JWT-verified; every action resolves the caller's own HOMATCH user and only
// ever reads or changes that user's searches. Customers never touch the
// marketplace tables directly (they are service-role / admin-only), and never
// see ranking internals, cost or worker errors.
//
//   capabilities  is Marketplace Search on, and can it dispatch at all
//   understand    OpenAI call 1: the customer's words → Search Intelligence Brief
//   start         SERVER READINESS GATE, then plan + search + one run per eligible worker
//   status        lifecycle, real counters, real stages (lazily times out overdue workers)
//   results       one page of one result group
//   property      one canonical property, with every listing and its exact link
//   compare       two properties of the same search, factual rows only
//   cancel        stop a search the customer no longer wants
//
// FREE: nothing here reserves, charges or settles. The model call is recorded
// in cost_events and the search's telemetry (Admin only).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { hasCurrentIdentity, resultCatalogue } from '../_shared/marketplaceCatalogue.ts';
import { ownedSearchHistory } from '../_shared/marketplaceHistory.ts';
import {
  SEARCH_BRIEF_INSTRUCTIONS, SEARCH_BRIEF_JSON_SCHEMA, briefFromModel, sanitizeBrief, toSearchPlanDraft,
} from '../../../src/research-core/marketplace/brief.ts';
import { evaluateReadiness } from '../../../src/research-core/marketplace/readiness.ts';
import {
  type MarketplaceWorkerDefinition, buildSearchRequest, eligibleWorkers,
} from '../../../src/research-core/marketplace/worker-contract.ts';
import {
  isTerminalSearch, progressOf, stagesOf, type SearchStatus, type WorkerRunState,
} from '../../../src/research-core/marketplace/lifecycle.ts';
import { compareProperties } from '../../../src/research-core/marketplace/comparison.ts';
import { RESULT_GROUPS, type ResultGroup } from '../../../src/research-core/marketplace/pipeline.ts';
import { browseResults, catalogueRevision, isCurrentResult, type CustomerProperty } from '../../../src/research-core/marketplace/browse-results.ts';
import {
  consumeUnderstandQuota, loadMarketplaceSwitches, openaiStructured, processAndStore, recordAiUsage,

} from '../_shared/marketplaceSearch.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Expose-Headers': 'Retry-After',
};
const json = (value: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(value), {
  status, headers: { ...CORS, 'Content-Type': 'application/json', ...extra },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A search with no worker answer within this long is closed by its own deadline. */
const SEARCH_DEADLINE_MS = 20 * 60 * 1000;

// deno-lint-ignore no-explicit-any
type Db = any;

/** The customer-safe summary of a search: no cost, no internals, no worker errors. */
async function summary(db: Db, search: Record<string, unknown>) {
  const { data: runs } = await db.from('discovery_marketplace_worker_runs')
    .select('worker_id,status,deadline_at,returned_count').eq('search_id', search.id);
  const states: WorkerRunState[] = (runs ?? []).map((r: Record<string, unknown>) => ({
    workerId: String(r.worker_id), status: r.status as WorkerRunState['status'], deadlineAt: String(r.deadline_at), returnedCount: Number(r.returned_count) || 0,
  }));
  /* Read-time freshness applies to counts as well as cards, including saved searches. */
  const counts: Record<string, number> = { BEST: 0, OWNER: 0, UPGRADE: 0, MORE: 0 };
  const catalogue = (await resultCatalogue(db, search)).filter((p) => isCurrentResult(p));
  for (const p of catalogue) counts[p.group] += 1;
  const stats = (search.stats ?? {}) as Record<string, number>;
  const status = search.status as SearchStatus;
  return {
    id: search.id,
    status,
    terminal: isTerminalSearch(status),
    brief: search.brief,
    createdAt: search.created_at,
    resultsAvailableAt: search.results_available_at ?? null,
    progress: progressOf(states),
    stages: stagesOf({
      discovered: Number(stats.raw ?? 0), validated: Number(stats.validated ?? 0),
      uniqueProperties: Number(stats.uniqueProperties ?? 0), processed: !!search.processed_at, terminal: isTerminalSearch(status),
    }),
    counters: {
      listingsDiscovered: Number(stats.raw ?? 0),
      listingsValidated: Number(stats.validated ?? 0),
      uniqueProperties: Number(stats.uniqueProperties ?? 0),
      strongMatches: catalogue.filter((p) => p.intelligence?.strong).length,
      sourcesCompleted: states.filter((s) => s.status === 'COMPLETE' || s.status === 'PARTIAL').length,
      sourcesTotal: states.length,
    },
    groups: counts,
    /* Every valid matching property, across all groups; ranking groups never cap it. */
    totalProperties: Object.values(counts).reduce((a, b) => a + b, 0),
    /* Partial: some sources could not be checked. Which ones, and why, is Admin's business. */
    partial: status === 'PARTIAL_COMPLETE',
    unavailable: status === 'FAILED' ? (search.failure_reason === 'NO_ELIGIBLE_WORKERS' ? 'NO_SOURCES' : 'FAILED') : null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const baseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!baseUrl || !serviceKey) return json({ error: 'not configured' }, 500);
  const db = createClient(baseUrl, serviceKey, { auth: { persistSession: false } });

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Unauthorized' }, 401);
  const { data: caller } = await db.auth.getUser(token);
  if (!caller?.user) return json({ error: 'Unauthorized' }, 401);
  const { data: profile } = await db.from('users').select('id,suspended_at').eq('auth_id', caller.user.id).maybeSingle();
  if (!profile?.id) return json({ error: 'no Homatch profile for this account' }, 403);
  if (profile.suspended_at) return json({ error: 'ACCOUNT_SUSPENDED' }, 403);
  const userId = String(profile.id);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? '');
  const switches = await loadMarketplaceSwitches(db);

  /* Ownership: the only way a search id is ever resolved. */
  const ownSearch = async (id: unknown) => {
    if (typeof id !== 'string' || !UUID.test(id)) return null;
    const { data } = await db.from('discovery_marketplace_searches').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
    return data ?? null;
  };

  try {
    if (action === 'capabilities') {
      const { count } = await db.from('discovery_marketplace_workers').select('worker_id', { count: 'exact', head: true })
        .eq('state', 'ACTIVE').eq('enabled', true);
      return json({ marketplaceEnabled: switches.enabled, activeSources: switches.enabled ? Number(count ?? 0) : 0, deepSearchAvailable: false });
    }

    if (action === 'history') {
      // History remains readable when acquisition is disabled. Ownership comes
      // exclusively from the authenticated profile, never from a client user id.
      const history = await ownedSearchHistory(db, userId, body.page);
      return json({ ...history, items: history.items.map((item) => ({ ...item, brief: sanitizeBrief(item.brief) })) });
    }

    if (!switches.enabled && (action === 'start' || action === 'understand')) return json({ error: 'MARKETPLACE_SEARCH_OFF' }, 409);

    if (action === 'understand') {
      const text = String(body.text ?? '').trim().slice(0, 2000);
      if (text.length < 3) return json({ error: 'TEXT_REQUIRED' }, 400);
      /* Per-user quota BEFORE any model call; atomic in Postgres, fails closed. */
      const quota = await consumeUnderstandQuota(db, userId);
      if (!quota.allowed) {
        console.warn('marketplace-search understand rate_limited', quota.window);
        return json({ error: 'RATE_LIMIT_EXCEEDED', code: 'RATE_LIMIT_EXCEEDED', retryAfterSeconds: quota.retryAfterSeconds },
          429, { 'Retry-After': String(quota.retryAfterSeconds) });
      }
      const r = await openaiStructured({
        name: 'homatch_search_brief', instructions: SEARCH_BRIEF_INSTRUCTIONS, input: text, schema: SEARCH_BRIEF_JSON_SCHEMA, maxOutputTokens: 900,
      });
      await recordAiUsage(db, 'SEARCH_INTELLIGENCE', r);
      /* No model is not a dead end: an empty brief asks every question one by one. */
      const brief = briefFromModel(r.ok ? r.parsed : null, text);
      return json({ understood: r.ok, brief, readiness: evaluateReadiness(brief) });
    }

    if (action === 'start') {
      const key = String(body.idempotencyKey ?? '');
      if (!/^[A-Za-z0-9_-]{8,120}$/.test(key)) return json({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);
      const { data: prior } = await db.from('discovery_marketplace_searches').select('*').eq('user_id', userId).eq('idempotency_key', key).maybeSingle();
      if (prior) return json({ search: await summary(db, prior), replayed: true });

      /* THE GATE. The client's view of readiness is never trusted. */
      const brief = sanitizeBrief(body.brief);
      const readiness = evaluateReadiness(brief);
      if (readiness.state !== 'READY') return json({ error: 'SEARCH_NOT_READY', readiness }, 422);
      if (switches.providersKilled && !switches.myhomeEnabled && !switches.ssgeEnabled) return json({ error: 'SOURCES_PAUSED' }, 409);

      /* NO DUPLICATE SEARCH. A reconnect, refresh or second tab that lost its idempotency key
         still reaches the customer's open search for the same request instead of a new one. */
      const criteria = (b: ReturnType<typeof sanitizeBrief>) => {
        const { originalText: _t, originalLanguage: _l, ...rest } = toSearchPlanDraft(b);
        return JSON.stringify(rest);
      };
      const sameRequest = criteria(brief);
      const { data: open } = await db.from('discovery_marketplace_searches').select('*').eq('user_id', userId)
        .in('status', ['CREATED', 'READY', 'DISPATCHING', 'SEARCHING', 'PROCESSING', 'RESULTS_AVAILABLE'])
        .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()).order('created_at', { ascending: false }).limit(10);
      const twin = (open ?? []).find((o: Record<string, unknown>) => criteria(sanitizeBrief(o.brief)) === sameRequest);
      if (twin) return json({ search: await summary(db, twin), replayed: true });

      const { data: plan, error: planErr } = await db.from('discovery_search_plans').insert({
        direction: 'SUPPLY', user_id: userId, market: brief.country, plan_kind: 'MARKETPLACE', plan_version: 1,
        plan: { kind: 'MARKETPLACE', brief, readiness, searchPlanDraft: toSearchPlanDraft(brief) },
      }).select('id').single();
      if (planErr || !plan) throw new Error(`plan insert failed: ${planErr?.message ?? 'no row'}`);
      const searchId = crypto.randomUUID();
      const request = buildSearchRequest(brief, { searchId, searchPlanId: plan.id });
      await db.from('discovery_search_plans').update({ plan: { kind: 'MARKETPLACE', brief, readiness, request, searchPlanDraft: toSearchPlanDraft(brief) } }).eq('id', plan.id);

      const { data: workerRows } = await db.from('discovery_marketplace_workers').select('*').eq('state', 'ACTIVE').eq('enabled', true);
      const workers: MarketplaceWorkerDefinition[] = (workerRows ?? []).map((w: Record<string, unknown>) => ({
        workerId: String(w.worker_id), sourceId: String(w.source_key), sourceName: String(w.source_name), sourceType: w.source_type as never,
        supportedMarkets: (w.supported_markets ?? []) as string[], supportedLanguages: (w.supported_languages ?? []) as string[],
        supportedPropertyTypes: (w.supported_property_types ?? []) as never, supportedTransactionTypes: (w.supported_transaction_types ?? []) as never,
        supportedFilters: (w.supported_filters ?? []) as never, executionMode: w.execution_mode as never,
        timeoutMs: Number(w.timeout_ms), maxResults: Number(w.max_results), state: w.state as never, enabled: !!w.enabled, health: w.health as never,
      }));
      const eligible = eligibleWorkers(workers, request).filter((worker) => worker.workerId === 'myhome-agent'
        ? switches.myhomeEnabled : worker.workerId === 'ssge-agent' ? switches.ssgeEnabled : !switches.providersKilled);
      const now = new Date();
      const { data: search, error: searchErr } = await db.from('discovery_marketplace_searches').insert({
        id: searchId, user_id: userId, search_plan_id: plan.id, idempotency_key: key,
        status: eligible.length ? 'DISPATCHING' : 'FAILED', failure_reason: eligible.length ? null : 'NO_ELIGIBLE_WORKERS',
        brief: { ...brief, readiness }, request, workers_total: eligible.length,
        deadline_at: new Date(now.getTime() + SEARCH_DEADLINE_MS).toISOString(),
        completed_at: eligible.length ? null : now.toISOString(),
      }).select('*').single();
      if (searchErr || !search) throw new Error(`search insert failed: ${searchErr?.message ?? 'no row'}`);
      /* CONCURRENT DISPATCH: one run per eligible worker, all in ONE insert. Every worker can
         claim its run immediately and independently; nothing waits for another worker. */
      if (eligible.length) {
        await db.from('discovery_marketplace_worker_runs').insert(eligible.map((w) => ({
          search_id: searchId, worker_id: w.workerId, request: { ...request, maxResults: w.maxResults },
          deadline_at: new Date(now.getTime() + w.timeoutMs).toISOString(),
        })));
      }
      return json({ search: await summary(db, search) }, 202);
    }

    if (action === 'status') {
      let search = body.searchId ? await ownSearch(body.searchId) : null;
      if (!body.searchId) {
        /* Resume: the customer's most recent search, wherever they left it. */
        /* Bare Find Property is a results workspace, not a "latest row" lookup. A newer
           failed search must not hide the customer's last usable catalogue. Prefer the
           newest search that actually has properties; only fall back to the latest row
           when the account has never produced results. */
        const { data: usable } = await db.from('discovery_marketplace_searches').select('*').eq('user_id', userId)
          .gt('properties_count', 0).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (usable) search = usable;
        else {
          const { data: latest } = await db.from('discovery_marketplace_searches').select('*').eq('user_id', userId)
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          search = latest ?? null;
        }
      }
      if (!search) return json({ search: null });
      if (!isTerminalSearch(search.status)) {
        /* Lazily close overdue workers so a dead worker cannot hold a search open forever. */
        const overdue = Date.parse(search.deadline_at ?? '') <= Date.now();
        const { data: late } = await db.from('discovery_marketplace_worker_runs').select('id')
          .eq('search_id', search.id).in('status', ['QUEUED', 'SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING'])
          .lte('deadline_at', new Date().toISOString()).limit(1);
        if (overdue || (late ?? []).length) {
          await processAndStore(db, search.id);
          search = await ownSearch(search.id);
        }
      }
      return json({ search: await summary(db, search) });
    }

    if (action === 'browse') {
      const search = await ownSearch(body.searchId);
      if (!search) return json({ error: 'NOT_FOUND' }, 404);
      const now = new Date();
      const properties = await resultCatalogue(db, search);
      const revision = await catalogueRevision(properties, now);
      if (body.revision && body.revision !== revision) return json({ error: 'RESULTS_CHANGED' }, 409);
      return json({ ...browseResults(properties, body.filters, Number(body.page) || 1, now), revision });
    }

    if (action === 'results') {
      const search = await ownSearch(body.searchId);
      if (!search) return json({ error: 'NOT_FOUND' }, 404);
      const group = String(body.group ?? 'BEST') as ResultGroup;
      if (!RESULT_GROUPS.includes(group)) return json({ error: 'BAD_GROUP' }, 400);
      const offset = Math.max(0, Math.trunc(Number(body.offset) || 0));
      const limit = Math.max(1, Math.min(24, Math.trunc(Number(body.limit) || 12)));
      const properties = (await resultCatalogue(db, search)).filter((p) => p.group === group && isCurrentResult(p))
        .sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
      const total = properties.length;
      return json({ group, items: properties.slice(offset, offset + limit), total, nextOffset: offset + limit < total ? offset + limit : null });
    }

    if (action === 'property' || action === 'compare') {
      const search = await ownSearch(body.searchId);
      if (!search) return json({ error: 'NOT_FOUND' }, 404);
      const keys = action === 'compare' ? [body.a, body.b] : [body.key];
      if (keys.some((k) => typeof k !== 'string' || k.length > 240)) return json({ error: 'BAD_KEY' }, 400);
      // Fetch only the requested dossier(s), never every property's details.
      const { data: detailRows, error: detailError } = await db.from('discovery_marketplace_properties')
        .select('view').eq('search_id', search.id).in('property_key', keys);
      if (detailError) throw detailError;
      const stored = (detailRows ?? []).map((row) => row.view as CustomerProperty);
      // Older capped catalogues are rebuilt read-only by the existing adapter.
      const details = stored.length === keys.length && stored.every(hasCurrentIdentity)
        ? stored : (await resultCatalogue(db, search)).filter((p) => keys.includes(p.key));
      const byKey = new Map(details
        .filter((p) => isCurrentResult(p)).map((p) => [p.key, p]));
      if (keys.some((k) => !byKey.has(k as string))) return json({ error: 'NOT_FOUND' }, 404);
      if (action === 'property') return json({ property: byKey.get(keys[0] as string), request: search.request });
      const view = (k: unknown) => byKey.get(k as string) as Record<string, any>;
      const asComparable = (v: Record<string, any>) => ({
        key: v.key, facts: v.facts, freshness: v.freshness.state, lastVerifiedAt: v.freshness.lastVerifiedAt, seller: v.seller.classification, sourceCount: v.sourceCount,
      });
      return json({ a: view(keys[0]), b: view(keys[1]), rows: compareProperties(asComparable(view(keys[0])), asComparable(view(keys[1]))) });
    }

    if (action === 'cancel') {
      const search = await ownSearch(body.searchId);
      if (!search) return json({ error: 'NOT_FOUND' }, 404);
      if (!isTerminalSearch(search.status)) {
        const now = new Date().toISOString();
        await db.from('discovery_marketplace_searches').update({ status: 'CANCELLED', cancelled_at: now, completed_at: now, updated_at: now }).eq('id', search.id);
        await db.from('discovery_marketplace_worker_runs').update({ status: 'FAILED', completed_at: now, updated_at: now, errors: [{ code: 'CANCELLED_BY_CUSTOMER', message: '' }] })
          .eq('search_id', search.id).in('status', ['QUEUED', 'SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING']);
      }
      return json({ search: await summary(db, (await ownSearch(search.id))!) });
    }

    return json({ error: 'UNKNOWN_ACTION' }, 400);
  } catch (error) {
    console.error('marketplace-search', action, error instanceof Error ? error.message : String(error));
    return json({ error: 'INTERNAL' }, 500);
  }
});
