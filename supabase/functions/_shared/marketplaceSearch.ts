// MARKETPLACE SEARCH — server helpers shared by marketplace-search (customer)
// and marketplace-worker-ingest (workers).
//
// processAndStore() is the one place a search's results are (re)computed: it
// loads every raw candidate the workers reported, runs the deterministic
// pipeline (src/research-core/marketplace/pipeline.ts), upserts the canonical
// properties in batches, derives the search status from real worker state and,
// once every worker has finished, asks OpenAI for Results Intelligence over the
// strongest few properties. Idempotent: running it twice gives the same rows.
//
// No billing anywhere: Marketplace Search is free. Every model call is
// recorded in cost_events and in the search's own telemetry; an unpriced call
// is recorded as UNPRICED, never as free.

import { processSearch, publicView, type ResultProperty } from '../../../src/research-core/marketplace/pipeline.ts';
import {
  acceptIntelligence, applyIntelligence, buildFactSheets, buildIntelligenceInput,
  RESULTS_INTELLIGENCE_INSTRUCTIONS, RESULTS_INTELLIGENCE_JSON_SCHEMA,
} from '../../../src/research-core/marketplace/results-intelligence.ts';
import {
  deriveSearchStatus, isTerminalSearch, type SearchStatus, type WorkerRunState,
} from '../../../src/research-core/marketplace/lifecycle.ts';
import type { ExternalListingCandidate, MarketplaceSearchRequest, WorkerRunStatus } from '../../../src/research-core/marketplace/worker-contract.ts';
import { converterFrom, ratesFromTable } from '../../../src/research-core/match/structured-gates.ts';
import type { AiUsage, SearchTelemetry } from '../../../src/research-core/marketplace/telemetry.ts';
import { type RunLease, reapDecision } from '../../../src/research-core/marketplace/dispatch.ts';
import { estimatedProviderCost } from './providerCost.ts';

// deno-lint-ignore no-explicit-any
type Db = any;

export const MARKETPLACE_SWITCH = 'marketplace_search_enabled';
/**
 * Per-user quota for the OpenAI-backed `understand` action. Conservative: a
 * person refining one request rarely needs more than a handful of readings.
 * Enforced atomically in Postgres (consume_marketplace_rate_limit) on the
 * platform's rate_limit_events table.
 */
export const UNDERSTAND_RATE_LIMIT = {
  operation: 'marketplace_search_understand',
  burstLimit: 10,
  burstSeconds: 10 * 60,
  dailyLimit: 40,
  dailySeconds: 24 * 60 * 60,
} as const;

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; window: 'BURST' | 'DAILY' | 'UNAVAILABLE' };

/** Fails CLOSED: if the quota cannot be read, the paid call does not happen. */
export async function consumeUnderstandQuota(db: Db, userId: string): Promise<RateLimitDecision> {
  const L = UNDERSTAND_RATE_LIMIT;
  try {
    const { data, error } = await db.rpc('consume_marketplace_rate_limit', {
      p_user_id: userId, p_operation: L.operation,
      p_burst_limit: L.burstLimit, p_burst_seconds: L.burstSeconds,
      p_daily_limit: L.dailyLimit, p_daily_seconds: L.dailySeconds,
    });
    if (error || !data) return { allowed: false, retryAfterSeconds: 60, window: 'UNAVAILABLE' };
    if (data.allowed === true) return { allowed: true };
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.trunc(Number(data.retry_after_seconds)) || L.burstSeconds),
      window: data.window === 'DAILY' ? 'DAILY' : 'BURST',
    };
  } catch {
    return { allowed: false, retryAfterSeconds: 60, window: 'UNAVAILABLE' };
  }
}

/** PostgREST returns at most 1000 rows per request; every full read pages at this size. */
export const PAGE_ROWS = 1000;

/**
 * Read EVERY row of a query, page by page. A single select silently stops at
 * the server's row cap, which would drop listings and so hide valid results.
 */
// deno-lint-ignore no-explicit-any
export async function readAll<T>(query: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await query(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE_ROWS) return out;
  }
}

/**
 * Apply lease/deadline decisions (dispatch.ts) to non-terminal runs: an expired
 * lease is re-queued while its retry budget lasts, a run that already delivered
 * keeps its results as PARTIAL, a run past its deadline closes. Each run is
 * decided alone; no run's failure touches another.
 */
export async function reapRuns(db: Db, rows: Array<Record<string, unknown>>, maxAttemptsOf: (workerId: string) => number, now = new Date()) {
  const changed: Array<{ id: string; status: string }> = [];
  for (const r of rows) {
    const lease: RunLease = {
      id: String(r.id), workerId: String(r.worker_id), status: r.status as WorkerRunStatus, attempts: Number(r.attempts) || 0,
      returnedCount: Number(r.returned_count) || 0, leaseExpiresAt: (r.lease_expires_at as string) ?? null, deadlineAt: String(r.deadline_at),
    };
    const d = reapDecision(lease, now, maxAttemptsOf(lease.workerId));
    if (!d) continue;
    const update = d.action === 'REQUEUE'
      ? { status: 'QUEUED', lease_expires_at: null, updated_at: now.toISOString() }
      : { status: d.status, lease_expires_at: null, completed_at: now.toISOString(), updated_at: now.toISOString(),
          errors: [...((r.errors as unknown[]) ?? []), { code: d.reason, message: '' }] };
    /* Guarded on the status we decided from, so a concurrent report always wins. */
    const { data } = await db.from('discovery_marketplace_worker_runs').update(update)
      .eq('id', lease.id).eq('status', lease.status).select('id,status');
    if (data?.length) { changed.push({ id: lease.id, status: update.status }); r.status = update.status; }
  }
  return changed;
}

export const searchModel = () =>
  Deno.env.get('OPENAI_SEARCH_MODEL') ?? Deno.env.get('OPENAI_FAST_MODEL') ?? Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

const truthy = (v: unknown) => v === true || v === 'true' || (typeof v === 'string' && v.replace(/"/g, '') === 'true');

/** Product and provider switches. The MyHome exception is explicit and scoped
 * to this marketplace adapter; the global provider kill switch is preserved. */
export async function loadMarketplaceSwitches(db: Db): Promise<{ enabled: boolean; providersKilled: boolean; myhomeEnabled: boolean }> {
  const { data } = await db.from('admin_settings').select('key,value').in('key', [MARKETPLACE_SWITCH, 'provider_kill_switch', 'marketplace_myhome_enabled']);
  const map = new Map((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  return {
    enabled: truthy(map.get(MARKETPLACE_SWITCH)),
    myhomeEnabled: truthy(map.get('marketplace_myhome_enabled')),
    /* An unreadable kill switch is treated as ON: dispatching is the thing it guards. */
    providersKilled: map.has('provider_kill_switch') ? truthy(map.get('provider_kill_switch')) : true,
  };
}

/** One strict structured-output call through the Responses API. */
export async function openaiStructured(args: {
  name: string; instructions: string; input: string; schema: unknown; maxOutputTokens?: number;
}): Promise<{ ok: boolean; parsed: unknown; inputTokens: number; outputTokens: number; model: string; note: string | null }> {
  const model = searchModel();
  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) return { ok: false, parsed: null, inputTokens: 0, outputTokens: 0, model, note: 'no_model_configured' };
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: args.maxOutputTokens ?? 1200,
        input: [{ role: 'system', content: args.instructions }, { role: 'user', content: args.input }],
        text: { format: { type: 'json_schema', name: args.name, strict: true, schema: args.schema } },
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const payload = r.ok ? await r.json() : null;
    const inputTokens = Number(payload?.usage?.input_tokens ?? 0);
    const outputTokens = Number(payload?.usage?.output_tokens ?? 0);
    if (!payload) return { ok: false, parsed: null, inputTokens, outputTokens, model, note: `model_http_${r.status}` };
    let text = typeof payload.output_text === 'string' ? payload.output_text : '';
    if (!text) for (const o of payload.output ?? []) for (const c of o?.content ?? []) if (typeof c?.text === 'string') text = c.text;
    try {
      return { ok: true, parsed: JSON.parse(text), inputTokens, outputTokens, model, note: null };
    } catch {
      return { ok: false, parsed: null, inputTokens, outputTokens, model, note: 'model_returned_unparseable_json' };
    }
  } catch {
    return { ok: false, parsed: null, inputTokens: 0, outputTokens: 0, model, note: 'model_unreachable' };
  }
}

/** cost_events row + a telemetry entry. Unpriced stays UNPRICED (cost null in telemetry). */
export async function recordAiUsage(db: Db, call: AiUsage['call'], r: { ok: boolean; inputTokens: number; outputTokens: number; model: string }): Promise<AiUsage> {
  const inCost = await estimatedProviderCost(db, { provider: 'OPENAI', unit: 'INPUT_TOKEN', units: r.inputTokens, model: r.model });
  const outCost = await estimatedProviderCost(db, { provider: 'OPENAI', unit: 'OUTPUT_TOKEN', units: r.outputTokens, model: r.model });
  const cost = inCost !== null && outCost !== null ? inCost + outCost : null;
  if (r.inputTokens + r.outputTokens > 0) {
    await db.from('cost_events').insert({
      provider: 'OPENAI', operation_type: `MARKETPLACE_${call}`, source: 'marketplace-search',
      units: r.inputTokens + r.outputTokens, cost_usd: cost ?? 0, success: r.ok, cache_hit: false,
      pricing_state: cost === null ? 'UNPRICED' : 'ESTIMATED',
    });
  }
  return { call, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: cost, ok: r.ok, at: new Date().toISOString() };
}

/** Operator-entered current rates only (fx_rates). A pair with no rate stays unconvertible. */
async function loadConverter(db: Db) {
  const { data } = await db.from('fx_rates').select('base_currency,quote_currency,rate,effective_from').is('effective_to', null);
  return converterFrom(ratesFromTable((data ?? []) as never));
}

const chunk = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

export interface ProcessOutcome {
  status: SearchStatus;
  properties: number;
  strongMatches: number;
}

/**
 * Recompute one search from everything its workers reported. Safe to call
 * from any number of concurrent reports: properties are upserted by
 * (search_id, property_key) and stale keys are removed afterwards.
 */
export async function processAndStore(db: Db, searchId: string, now = new Date()): Promise<ProcessOutcome | null> {
  const started = Date.now();
  const { data: search } = await db.from('discovery_marketplace_searches')
    .select('id,status,request,telemetry,ai_status,results_available_at').eq('id', searchId).maybeSingle();
  if (!search) return null;
  if (search.status === 'CANCELLED') return { status: 'CANCELLED', properties: 0, strongMatches: 0 };

  const { data: runRows } = await db.from('discovery_marketplace_worker_runs')
    .select('id,worker_id,status,deadline_at,returned_count,attempts,lease_expires_at,errors,metrics').eq('search_id', searchId);
  const workerIds = [...new Set((runRows ?? []).map((r: Record<string, unknown>) => String(r.worker_id)))];
  const { data: workerRows } = workerIds.length
    ? await db.from('discovery_marketplace_workers').select('worker_id,max_attempts').in('worker_id', workerIds)
    : { data: [] };
  const attemptsOf = new Map<string, number>((workerRows ?? []).map((w: { worker_id: string; max_attempts: number }) => [w.worker_id, Number(w.max_attempts) || 3] as [string, number]));
  await reapRuns(db, (runRows ?? []) as Array<Record<string, unknown>>, (id) => attemptsOf.get(id) ?? 3, now);
  const runs: WorkerRunState[] = (runRows ?? []).map((r: Record<string, unknown>) => ({
    workerId: String(r.worker_id), status: r.status as WorkerRunStatus, deadlineAt: r.deadline_at as string, returnedCount: Number(r.returned_count) || 0,
  }));

  /* EVERY listing every worker reported, paged: nothing is dropped at a row cap. */
  const listingRows = await readAll<{ raw: ExternalListingCandidate; worker_run_id: string }>((from, to) =>
    db.from('discovery_marketplace_listings').select('raw,worker_run_id').eq('search_id', searchId)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to));
  const workerOfRun = new Map<string, string>((runRows ?? []).map((r: Record<string, unknown>) => [String(r.id), String(r.worker_id)] as [string, string]));
  const candidates = listingRows.map((l) => ({
    workerId: workerOfRun.get(l.worker_run_id) ?? 'unknown', candidate: l.raw,
  }));

  const request = search.request as MarketplaceSearchRequest;
  const output = processSearch({ request, candidates, converter: await loadConverter(db), now });
  const derived = deriveSearchStatus(search.status as SearchStatus, runs, {
    properties: output.properties.length, strongMatches: output.stats.strongMatches,
  });

  const telemetry: SearchTelemetry = search.telemetry ?? { ai: [], workers: [], processingMs: [] };
  let properties: Array<ResultProperty & { tradeoffs?: string[] }> = output.properties;
  let aiStatus = search.ai_status as string;
  /* OpenAI call 2: once, when every worker has finished, over the strongest few only. */
  if (isTerminalSearch(derived.status) && aiStatus === 'NOT_STARTED') {
    if (!properties.length) aiStatus = 'SKIPPED';
    else {
      const sheets = buildFactSheets(properties);
      const r = await openaiStructured({
        name: 'homatch_results_intelligence',
        instructions: RESULTS_INTELLIGENCE_INSTRUCTIONS,
        input: JSON.stringify(buildIntelligenceInput(request, sheets)),
        schema: RESULTS_INTELLIGENCE_JSON_SCHEMA,
      });
      telemetry.ai.push(await recordAiUsage(db, 'RESULTS_INTELLIGENCE', r));
      if (r.ok) {
        properties = applyIntelligence(properties, acceptIntelligence(r.parsed, sheets).accepted);
        aiStatus = 'DONE';
      } else aiStatus = 'FAILED';
    }
  }

  const rows = properties.map((p) => ({
    search_id: searchId, property_key: p.key, result_group: p.group, rank: p.rank, score: p.score,
    view: publicView(p), internal: p.internal,
  }));
  for (const batch of chunk(rows, 500)) {
    await db.from('discovery_marketplace_properties').upsert(batch, { onConflict: 'search_id,property_key' });
  }
  const keep = rows.map((r) => r.property_key);
  const existing = await readAll<{ property_key: string }>((from, to) =>
    db.from('discovery_marketplace_properties').select('property_key').eq('search_id', searchId).order('property_key').range(from, to));
  const keepSet = new Set(keep);
  const stale = existing.map((e) => e.property_key).filter((k) => !keepSet.has(k));
  for (const batch of chunk(stale, 200)) {
    await db.from('discovery_marketplace_properties').delete().eq('search_id', searchId).in('property_key', batch);
  }

  telemetry.processingMs = [...(telemetry.processingMs ?? []), Date.now() - started].slice(-50);
  const terminalRuns = runs.filter((r) => ['COMPLETE', 'PARTIAL', 'FAILED', 'TIMED_OUT', 'BLOCKED'].includes(r.status)).length;
  const strongMatches = output.stats.strongMatches;
  await db.from('discovery_marketplace_searches').update({
    status: derived.status,
    failure_reason: derived.failureReason,
    workers_total: runs.length,
    workers_terminal: terminalRuns,
    properties_count: properties.length,
    strong_matches: strongMatches,
    stats: output.stats,
    ai_status: aiStatus,
    telemetry,
    processed_at: now.toISOString(),
    results_available_at: search.results_available_at ?? (derived.status === 'RESULTS_AVAILABLE' || (isTerminalSearch(derived.status) && properties.length) ? now.toISOString() : null),
    completed_at: isTerminalSearch(derived.status) ? now.toISOString() : null,
    updated_at: now.toISOString(),
  }).eq('id', searchId).neq('status', 'CANCELLED');
  return { status: derived.status, properties: properties.length, strongMatches };
}
