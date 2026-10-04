// OpenAI for FIND BUYERS: schema-constrained JSON, measured tokens, priced
// from the admin price book (admin_settings.find_buyers_openai_price_book).
// The cost is ESTIMATED (tokens × price book): OpenAI does not return a
// charged amount per call, and this module never calls it ACTUAL.

export interface PriceBook { model: string; inputPerMTokMicros: number; outputPerMTokMicros: number }
export const DEFAULT_PRICE_BOOK: PriceBook = { model: 'gpt-4o-mini', inputPerMTokMicros: 150_000, outputPerMTokMicros: 600_000 };

export function parsePriceBook(raw: unknown): PriceBook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return {
    model: typeof r.model === 'string' && r.model ? r.model : DEFAULT_PRICE_BOOK.model,
    inputPerMTokMicros: n(r.inputPerMTokMicros, DEFAULT_PRICE_BOOK.inputPerMTokMicros),
    outputPerMTokMicros: n(r.outputPerMTokMicros, DEFAULT_PRICE_BOOK.outputPerMTokMicros),
  };
}

export function tokenCostMicros(book: PriceBook, inputTokens: number, outputTokens: number): number {
  return Math.ceil((inputTokens * book.inputPerMTokMicros + outputTokens * book.outputPerMTokMicros) / 1_000_000);
}

export interface JsonCallResult<T> { data: T | null; inputTokens: number; outputTokens: number; costMicros: number; model: string; error: string | null }

export async function openAiJson<T>(
  book: PriceBook,
  system: string,
  user: unknown,
  schema: { name: string; strict: boolean; schema: unknown },
  opts: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<JsonCallResult<T>> {
  const key = Deno.env.get('OPENAI_API_KEY') ?? '';
  if (!key) return { data: null, inputTokens: 0, outputTokens: 0, costMicros: 0, model: book.model, error: 'OPENAI_NOT_CONFIGURED' };
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: book.model,
        temperature: 0,
        max_tokens: opts.maxTokens ?? 1500,
        response_format: { type: 'json_schema', json_schema: schema },
        messages: [{ role: 'system', content: system }, { role: 'user', content: typeof user === 'string' ? user : JSON.stringify(user) }],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
    });
    const body = await res.json().catch(() => ({}));
    const inputTokens = Number(body?.usage?.prompt_tokens ?? 0);
    const outputTokens = Number(body?.usage?.completion_tokens ?? 0);
    const costMicros = tokenCostMicros(book, inputTokens, outputTokens);
    if (!res.ok) return { data: null, inputTokens, outputTokens, costMicros, model: book.model, error: `OPENAI_${res.status}` };
    let data: T | null = null;
    try { data = JSON.parse(String(body?.choices?.[0]?.message?.content ?? 'null')); } catch { data = null; }
    return { data, inputTokens, outputTokens, costMicros, model: book.model, error: data ? null : 'OPENAI_BAD_JSON' };
  } catch (error) {
    return { data: null, inputTokens: 0, outputTokens: 0, costMicros: 0, model: book.model, error: `OPENAI_NETWORK: ${String(error).slice(0, 120)}` };
  }
}

/** Ledger + cost_events through the idempotent RPC. */
export async function recordAiCost(
  db: any,
  opts: { key: string; matchingJobId: string | null; kind: 'AI' | 'TRANSLATION'; operation: string; result: { model: string; inputTokens: number; outputTokens: number; costMicros: number }; metadata?: Record<string, unknown> },
) {
  if (opts.result.inputTokens + opts.result.outputTokens === 0) return;
  await db.rpc('find_buyers_record_ai_cost', {
    p_idempotency_key: opts.key,
    p_matching_job_id: opts.matchingJobId,
    p_kind: opts.kind,
    p_operation: opts.operation,
    p_model: opts.result.model,
    p_input_tokens: opts.result.inputTokens,
    p_output_tokens: opts.result.outputTokens,
    p_micros: opts.result.costMicros,
    p_metadata: opts.metadata ?? {},
  });
}
