// THE ONLY CODE THAT TALKS TO APIFY — and only to memo23 Actors.
//
// The generic Apify execution stays deleted (retiredProviders.ts); Apify is a
// live provider again (owner, 2026-10-04) ONLY through this module, which
// exists because the owner authorised memo23 Actors for FIND BUYERS / FIND
// TENANTS (2026-10-04). It:
//   * reads APIFY_API_TOKEN from the edge environment, server-side only;
//   * never logs, returns or stores the token (errors are scrubbed);
//   * refuses any Actor id that is not a memo23 Actor;
//   * caps every run at the reservation (maxItems + maxTotalChargeUsd).
//
// Callers: _shared/findBuyers/executor.ts (runs), the admin verify action and
// provider-health-check (accountCheck: one free account read, never a run).

const API = 'https://api.apify.com/v2';

export class Memo23Error extends Error {
  status: number;
  retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

function token(): string {
  const t = Deno.env.get('APIFY_API_TOKEN') ?? '';
  if (!t) throw new Memo23Error('APIFY_NOT_CONFIGURED', 503, false);
  return t;
}

/** Is the provider credential present? (Readiness only; the token itself never leaves this file.) */
export function providerConfigured(): boolean {
  return Boolean(Deno.env.get('APIFY_API_TOKEN'));
}

/** memo23~name or memo23/name; nothing else may be executed. */
export function assertMemo23ActorId(actorId: string): string {
  const id = String(actorId ?? '').trim().replace('/', '~');
  if (!/^memo23~[a-z0-9][a-z0-9-]{1,80}$/.test(id)) throw new Memo23Error('ACTOR_NOT_ALLOWED', 400, false);
  return id;
}

export function scrub(text: string): string {
  const t = Deno.env.get('APIFY_API_TOKEN') ?? '';
  let out = String(text ?? '');
  if (t) out = out.split(t).join('[redacted]');
  return out.replace(/apify_api_[A-Za-z0-9]+/g, '[redacted]').slice(0, 500);
}

async function call(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 25_000): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token()}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Memo23Error) throw error;
    throw new Memo23Error(`NETWORK: ${scrub(error instanceof Error ? error.message : String(error))}`, 0, true);
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const msg = scrub(data?.error?.message ?? data?.error?.type ?? text);
    /* 402/403 = account/billing problems: not retryable, the actor goes FAILED. */
    throw new Memo23Error(`HTTP_${res.status}: ${msg}`, res.status, res.status >= 500 || res.status === 429);
  }
  return data;
}

export interface StartedRun { runId: string; datasetId: string | null; status: string }

export async function startRun(
  actorId: string,
  input: Record<string, unknown>,
  caps: { maxItems: number; maxTotalChargeUsd: number; timeoutSeconds: number },
): Promise<StartedRun> {
  const id = assertMemo23ActorId(actorId);
  const q = new URLSearchParams({
    timeout: String(Math.max(30, Math.min(3600, Math.round(caps.timeoutSeconds)))),
    maxItems: String(Math.max(1, Math.round(caps.maxItems))),
    /* Pay-per-event Actors stop charging at this ceiling; never above the reservation. */
    maxTotalChargeUsd: Math.max(0.01, caps.maxTotalChargeUsd).toFixed(4),
  });
  const data = await call('POST', `/acts/${id}/runs?${q}`, input);
  const run = data?.data;
  if (!run?.id) throw new Memo23Error('START_NO_RUN_ID', 502, true);
  return { runId: String(run.id), datasetId: run.defaultDatasetId ? String(run.defaultDatasetId) : null, status: String(run.status ?? 'READY') };
}

export async function getRun(runId: string): Promise<any> {
  const data = await call('GET', `/actor-runs/${encodeURIComponent(runId)}`);
  return data?.data ?? null;
}

export async function abortRun(runId: string): Promise<void> {
  await call('POST', `/actor-runs/${encodeURIComponent(runId)}/abort`).catch(() => undefined);
}

export async function datasetItems(datasetId: string, limit: number): Promise<{ items: unknown[]; total: number | null }> {
  const q = new URLSearchParams({ clean: 'true', format: 'json', limit: String(Math.max(1, Math.min(1000, limit))) });
  const res = await fetch(`${API}/datasets/${encodeURIComponent(datasetId)}/items?${q}`, {
    headers: { Authorization: `Bearer ${token()}` },
    signal: AbortSignal.timeout(25_000),
  }).catch((e) => { throw new Memo23Error(`NETWORK: ${scrub(String(e))}`, 0, true); });
  if (!res.ok) throw new Memo23Error(`HTTP_${res.status}: dataset`, res.status, res.status >= 500);
  const total = Number(res.headers.get('x-apify-pagination-total'));
  const items = await res.json().catch(() => []);
  return { items: Array.isArray(items) ? items : [], total: Number.isFinite(total) ? total : null };
}

/**
 * Admin → Providers "Test" for APIFY: one free account read (GET /users/me).
 * Starts no run, names no Actor, costs nothing; returns no secret.
 */
export async function accountCheck(): Promise<{ ok: true; username: string | null; plan: string | null }> {
  const me = (await call('GET', '/users/me', undefined, 15_000))?.data ?? {};
  return { ok: true, username: typeof me.username === 'string' ? me.username : null, plan: typeof me.plan?.id === 'string' ? me.plan.id : null };
}

/** The Actor's current definition: pricing and input schema, for admin verification. */
export async function actorDefinition(actorId: string): Promise<{
  title: string | null;
  pricing: { model: 'PAY_PER_RESULT' | 'PAY_PER_EVENT' | 'UNKNOWN'; pricePer1kMicros: number | null; startFeeMicros: number; raw: unknown };
  schemaProperties: string[];
}> {
  const id = assertMemo23ActorId(actorId);
  const act = (await call('GET', `/acts/${id}`))?.data ?? {};
  const infos: any[] = Array.isArray(act.pricingInfos) ? act.pricingInfos : [];
  const now = Date.now();
  const current = infos
    .filter((p) => !p.startedAt || Date.parse(p.startedAt) <= now)
    .sort((a, b) => Date.parse(b.startedAt ?? 0) - Date.parse(a.startedAt ?? 0))[0] ?? null;
  const pricing = pricingFromInfo(current);
  let schemaProperties: string[] = [];
  const buildId = act?.taggedBuilds?.latest?.buildId;
  if (buildId) {
    const build = (await call('GET', `/actor-builds/${encodeURIComponent(buildId)}`).catch(() => null))?.data ?? null;
    let schema: any = build?.actorDefinition?.input ?? build?.inputSchema ?? null;
    if (typeof schema === 'string') { try { schema = JSON.parse(schema); } catch { schema = null; } }
    if (schema?.properties && typeof schema.properties === 'object') schemaProperties = Object.keys(schema.properties);
  }
  return { title: act.title ?? null, pricing: { ...pricing, raw: current }, schemaProperties };
}

const usdToMicros = (usd: unknown) => {
  const n = Number(usd);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000) : null;
};

export function pricingFromInfo(info: any): { model: 'PAY_PER_RESULT' | 'PAY_PER_EVENT' | 'UNKNOWN'; pricePer1kMicros: number | null; startFeeMicros: number } {
  if (!info) return { model: 'UNKNOWN', pricePer1kMicros: null, startFeeMicros: 0 };
  if (info.pricingModel === 'PRICE_PER_DATASET_ITEM') {
    const per = usdToMicros(info.pricePerUnitUsd);
    return { model: 'PAY_PER_RESULT', pricePer1kMicros: per == null ? null : per * 1000, startFeeMicros: 0 };
  }
  if (info.pricingModel === 'PAY_PER_EVENT') {
    const events: Record<string, any> = info.pricingPerEvent?.actorChargeEvents ?? {};
    let start = 0; let perItem: number | null = null;
    for (const [name, e] of Object.entries(events)) {
      const p = usdToMicros(e?.eventPriceUsd);
      if (p == null) continue;
      if (/start/i.test(name)) start += p;
      else if (perItem == null || /result|item|post|comment|group|message|video|profile/i.test(name)) perItem = Math.max(perItem ?? 0, p);
    }
    return { model: perItem == null ? 'UNKNOWN' : 'PAY_PER_EVENT', pricePer1kMicros: perItem == null ? null : perItem * 1000, startFeeMicros: start };
  }
  return { model: 'UNKNOWN', pricePer1kMicros: null, startFeeMicros: 0 };
}

/**
 * What a finished run cost, from the run object itself where possible.
 * PROVIDER_REPORTED: charged events × the run's own event prices, or the
 *   platform usage Apify reports for a non-paid Actor.
 * RUN_PRICE_X_BILLED_UNITS: pay-per-result items × the run's own unit price.
 * null amount = unknown (booked as UNKNOWN, never as zero).
 */
export function runCost(run: any, billedItems: number | null): { micros: number | null; basis: 'PROVIDER_REPORTED' | 'RUN_PRICE_X_BILLED_UNITS' | 'UNKNOWN'; billing: Record<string, unknown> } {
  const info = run?.pricingInfo ?? null;
  const billing: Record<string, unknown> = {
    pricingModel: info?.pricingModel ?? null,
    usageTotalUsd: run?.usageTotalUsd ?? null,
    chargedEventCounts: run?.chargedEventCounts ?? null,
    pricePerUnitUsd: info?.pricePerUnitUsd ?? null,
    billedItems,
  };
  if (info?.pricingModel === 'PAY_PER_EVENT' && run?.chargedEventCounts && typeof run.chargedEventCounts === 'object') {
    const events: Record<string, any> = info.pricingPerEvent?.actorChargeEvents ?? {};
    let micros = 0; let known = true;
    for (const [name, n] of Object.entries(run.chargedEventCounts as Record<string, number>)) {
      const p = usdToMicros(events[name]?.eventPriceUsd);
      if (p == null) { known = false; continue; }
      micros += p * Number(n || 0);
    }
    return known ? { micros, basis: 'PROVIDER_REPORTED', billing } : { micros: null, basis: 'UNKNOWN', billing };
  }
  if (info?.pricingModel === 'PRICE_PER_DATASET_ITEM') {
    const per = usdToMicros(info.pricePerUnitUsd);
    if (per != null && billedItems != null) return { micros: per * billedItems, basis: 'RUN_PRICE_X_BILLED_UNITS', billing };
    return { micros: null, basis: 'UNKNOWN', billing };
  }
  const usage = usdToMicros(run?.usageTotalUsd);
  if (usage != null && (!info || ['FREE', 'FLAT_PRICE_PER_MONTH'].includes(String(info?.pricingModel)))) {
    return { micros: usage, basis: 'PROVIDER_REPORTED', billing };
  }
  return { micros: null, basis: 'UNKNOWN', billing };
}

export const TERMINAL_RUN_STATES = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED']);
