// HOMATCH Verify — OpenAI under load (Verify at scale, owner 2026-10-24).
//
// Every model call made by research-agent and verify-synthesis goes through
// these rules:
//   * a shared per-model budget (openai_rate_reserve, migration 20261201095000)
//     when admin_settings.openai_limits sets RPM/TPM: over it, the caller waits
//     for the next minute instead of adding to a 429 storm;
//   * Retry-After is honoured on 429/5xx (capped), otherwise exponential
//     backoff with jitter;
//   * a call that still fails is a FAILURE the driver retries, never a quietly
//     simplified report marked complete.
// Pure helpers plus one optional database call.

export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);
export const RETRY_AFTER_CAP_MS = 30_000;

/** Retry-After from the provider (retry-after-ms, then retry-after seconds or HTTP date), capped; null when absent. */
export function retryAfterMs(headers: { get(name: string): string | null } | null | undefined, now = Date.now()): number | null {
  if (!headers) return null;
  const ms = Number(headers.get('retry-after-ms'));
  if (Number.isFinite(ms) && ms > 0) return Math.min(ms, RETRY_AFTER_CAP_MS);
  const ra = headers.get('retry-after');
  if (!ra) return null;
  const s = Number(ra);
  if (Number.isFinite(s) && s >= 0) return Math.min(s * 1000, RETRY_AFTER_CAP_MS);
  const at = Date.parse(ra);
  return Number.isFinite(at) ? Math.min(Math.max(0, at - now), RETRY_AFTER_CAP_MS) : null;
}

/** Exponential backoff with jitter: ~1 s, 2 s, 4 s, 8 s … capped at 20 s. */
export function backoffMs(attempt: number, random = Math.random): number {
  return Math.round(Math.min(20_000, 1000 * 2 ** Math.max(0, attempt)) * (0.75 + random() * 0.5));
}

/** A rough token estimate for budgeting (never billing): ~3 characters per token for mixed Georgian/English. */
export function estimateTokens(...texts: Array<string | null | undefined>): number {
  return Math.ceil(texts.reduce((n, t) => n + (t ? t.length : 0), 0) / 3);
}

export interface ModelLimits { rpm: number; tpm: number }

/** admin_settings.openai_limits → the limits for one model (by exact id or the "default" entry); null = unlimited. */
export function limitsFor(raw: unknown, model: string): ModelLimits | null {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, any>) : null;
  const e = o ? o[model] ?? o.default : null;
  if (!e || typeof e !== 'object') return null;
  const rpm = Math.trunc(Number(e.rpm)), tpm = Math.trunc(Number(e.tpm));
  const out = { rpm: Number.isFinite(rpm) && rpm > 0 ? rpm : 0, tpm: Number.isFinite(tpm) && tpm > 0 ? tpm : 0 };
  return out.rpm || out.tpm ? out : null;
}

type Db = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/**
 * Waits for room in the shared budget, up to maxWaitMs. Returns the ms waited. With no limits configured,
 * or when the budget cannot be read, it does not wait (the provider's own 429 handling still applies).
 */
export async function awaitOpenAIBudget(db: Db | null, model: string, tokens: number, limits: ModelLimits | null, maxWaitMs = 120_000, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<number> {
  if (!db || !limits) return 0;
  let waited = 0;
  for (;;) {
    const { data, error } = await db.rpc('openai_rate_reserve', { p_bucket: model, p_tokens: tokens, p_rpm: limits.rpm, p_tpm: limits.tpm });
    const wait = error ? 0 : Number(data) || 0;
    if (wait <= 0) return waited;
    if (waited + wait > maxWaitMs) return waited; // waited long enough: let the provider decide
    await sleep(wait);
    waited += wait;
  }
}
