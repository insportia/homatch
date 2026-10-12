// verify-synthesis `translate` — the report's CONTENT in the customer's language.
//
// The caller has already been shown to be allowed to read the job (the same
// RLS-scoped read as the report itself, in index.ts). Here:
//
//   1. the texts are validated and de-duplicated (textTranslation.ts limits);
//   2. the cache (verify_text_translations, keyed on the TEXT) answers what it
//      knows — free, shared by every report;
//   3. the misses are sent to the model in small JSON chunks, each answer
//      checked (numbers, codes, URLs, {{placeholders}} kept; not left in
//      Georgian) before it is cached or returned; refused answers get one
//      second pass in smaller chunks;
//   4. the model's token usage is priced from provider_price_book and written
//      to cost_events against the job (REPORT_TRANSLATION_VERIFY) with an
//      explicit pricing_state — UNPRICED, never a silent zero;
//   5. every model call is first taken from the job+language hourly allowance
//      (verify_translation_quota_take); an exhausted allowance answers what
//      the cache knows and says `limited`.
//
// Nothing here throws to the customer: a failed chunk only means those texts
// stay Georgian until the page asks again.

import {
  buildTranslationPrompt,
  chunkTexts,
  MODEL_CHUNK_CHARS,
  parseTranslationOutput,
  sourceHash,
  type TranslateRequest,
} from '../../../src/verify/translation/textTranslation.ts';
import { priceStage, type PriceRow, type StageUsage } from '../../../src/verify/cogs.ts';
import { pricingStateForDerivedCost } from '../_shared/providerCost.ts';

/** Per job and language, per hour: model calls and characters sent to the model. */
export const QUOTA_MAX_CALLS_PER_HOUR = 200;
export const QUOTA_MAX_CHARS_PER_HOUR = 400_000;
/** Model calls in flight for one request. */
const CONCURRENCY = 4;
const MODEL_TIMEOUT_MS = 60_000;
/** Items per model call in the second pass. */
const RETRY_CHUNK_TEXTS = 8;

export const TRANSLATION_OPERATION = 'REPORT_TRANSLATION_VERIFY';

export interface TranslateResult {
  translations: Record<string, string>;
  cached: number;
  translated: number;
  failed: number;
  limited: boolean;
  skipped: number;
}

type Usage = { input_tokens: number; output_tokens: number; cached_tokens: number };

function textOf(p: any): string {
  if (p?.output_text) return p.output_text;
  const a: string[] = [];
  for (const i of p?.output || []) {
    if (i?.type === 'message') for (const c of i.content || []) if (c?.type === 'output_text' && c.text) a.push(c.text);
  }
  return a.join('\n').trim();
}

async function callModel(apiKey: string, model: string, req: TranslateRequest, texts: string[]): Promise<{ out: Record<string, string>; usage: Usage | null; mayHaveBilled: boolean }> {
  const { system, user } = buildTranslationPrompt(req.lang, texts);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MODEL_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        text: { format: { type: 'json_object' } },
      }),
    });
    if (!res.ok) {
      console.error(`verify-synthesis translate: ${model} HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
      // The provider refused the request: nothing was generated, nothing billed.
      return { out: {}, usage: null, mayHaveBilled: false };
    }
    const body = await res.json();
    const u = body?.usage ?? null;
    const usage: Usage | null = u ? {
      input_tokens: Number(u.input_tokens) || 0,
      output_tokens: Number(u.output_tokens) || 0,
      cached_tokens: Number(u.input_tokens_details?.cached_tokens) || 0,
    } : null;
    return { out: parseTranslationOutput(textOf(body), texts), usage, mayHaveBilled: true };
  } catch (e) {
    console.error('verify-synthesis translate: model call failed', e instanceof Error ? e.message : String(e));
    // A timeout or a dropped connection may still have been billed: unknown, not zero.
    return { out: {}, usage: null, mayHaveBilled: true };
  } finally {
    clearTimeout(timer);
  }
}

/** Runs fns with at most `n` in flight. */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const x = items[i++]; await fn(x); }
  });
  await Promise.all(workers);
}

/**
 * Records what the model calls of ONE request cost, against the job.
 * A call that answered with no usage report is recorded as UNPRICED with its
 * character count, never as a zero that reads "free".
 */
async function recordCost(db: any, jobId: string, req: TranslateRequest, model: string, usages: Usage[], unmetered: number, chars: number): Promise<void> {
  try {
    const usage: StageUsage = {
      input_tokens: usages.reduce((a, u) => a + u.input_tokens, 0),
      output_tokens: usages.reduce((a, u) => a + u.output_tokens, 0),
      input_tokens_details: { cached_tokens: usages.reduce((a, u) => a + u.cached_tokens, 0) },
    };
    const { data: rows, error: priceError } = await db
      .from('provider_price_book')
      .select('provider, model, unit, rate, per_units, currency, effective_from, effective_to')
      .eq('provider', 'OPENAI');
    if (priceError) console.error(`verify-synthesis translate: price book unavailable: ${priceError.message ?? priceError}`);
    const stage = priceStage({ stage: 'translation', model, usage }, { provider: 'OPENAI', rows: (rows ?? []) as PriceRow[], at: new Date() });
    const anyUsage = usages.length > 0;
    const resolved = pricingStateForDerivedCost({
      costUsd: stage?.costUsd ?? 0,
      // A call that reported no usage cannot be priced: the total is a floor.
      fullyPriced: !!stage?.priced && unmetered === 0,
      consumedNothing: !anyUsage && unmetered === 0,
    });
    const { error } = await db.from('cost_events').insert([{
      provider: 'OPENAI',
      // Deliberately NOT VERIFY_*: recordVerificationCost writes those once per job.
      operation_type: TRANSLATION_OPERATION,
      source: [
        `model=${model}`,
        `lang=${req.lang}`,
        `chars=${chars}`,
        `calls=${usages.length + unmetered}`,
        unmetered ? `unmetered_calls=${unmetered}` : null,
        stage && !stage.priced ? `unpriced=${stage.unpricedUnits.join('+')}` : null,
      ].filter(Boolean).join(';'),
      units: stage?.totalTokens ?? 0,
      cost_usd: resolved.cost_usd,
      pricing_state: resolved.pricing_state,
      success: true,
      cache_hit: (stage?.cachedInputTokens ?? 0) > 0,
      job_id: jobId,
    }]);
    if (error) console.error(`verify-synthesis translate: could not record cost for ${jobId}: ${error.message ?? error}`);
  } catch (e) {
    console.error('verify-synthesis translate: cost recording threw', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Translates `req.texts` (already validated by parseTranslateRequest) using the
 * service client `db` for the cache, the allowance and the cost row.
 */
export async function translateTexts(
  db: any,
  req: TranslateRequest,
  opts: { apiKey: string | null | undefined; model: string; skipped?: number },
): Promise<TranslateResult> {
  const result: TranslateResult = { translations: {}, cached: 0, translated: 0, failed: 0, limited: false, skipped: opts.skipped ?? 0 };
  if (!req.texts.length) return result;

  const hashes = new Map<string, string>();
  for (const t of req.texts) hashes.set(await sourceHash(t), t);

  // 1. The cache. `source` is compared too, so a hash collision can never serve another text's translation.
  const keys = [...hashes.keys()];
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await db
      .from('verify_text_translations')
      .select('source_hash, source, translated')
      .eq('lang', req.lang)
      .in('source_hash', keys.slice(i, i + 200));
    if (error) { console.error(`verify-synthesis translate: cache read failed: ${error.message ?? error}`); continue; }
    for (const row of data ?? []) {
      const text = hashes.get(row.source_hash);
      if (text && row.source === text && typeof row.translated === 'string') {
        result.translations[text] = row.translated;
        result.cached++;
      }
    }
  }

  const misses = req.texts.filter((t) => !(t in result.translations));
  if (!misses.length) return result;
  if (!opts.apiKey) { result.failed = misses.length; return result; }

  // 2. The model, in chunks, each taken from the hourly allowance first.
  const usages: Usage[] = [];
  let unmetered = 0;
  let sentChars = 0;
  const fresh: { source_hash: string; lang: string; source: string; translated: string; model: string }[] = [];
  const hashOf = new Map([...hashes].map(([h, t]) => [t, h]));
  const translateChunk = async (chunk: string[]): Promise<string[]> => {
    const chars = chunk.reduce((a, t) => a + t.length, 0);
    const { data: allowed, error } = await db.rpc('verify_translation_quota_take', {
      p_job_id: req.jobId, p_lang: req.lang, p_chars: chars,
      p_max_chars: QUOTA_MAX_CHARS_PER_HOUR, p_max_calls: QUOTA_MAX_CALLS_PER_HOUR,
    });
    if (error || allowed !== true) {
      if (error) console.error(`verify-synthesis translate: quota check failed: ${error.message ?? error}`);
      result.limited = true;
      return [];
    }
    sentChars += chars;
    const { out, usage, mayHaveBilled } = await callModel(opts.apiKey!, opts.model, req, chunk);
    if (usage) usages.push(usage);
    else if (mayHaveBilled) unmetered++;
    const refused: string[] = [];
    for (const t of chunk) {
      const tr = out[t];
      if (tr) {
        result.translations[t] = tr;
        result.translated++;
        fresh.push({ source_hash: hashOf.get(t)!, lang: req.lang, source: t, translated: tr, model: opts.model });
      } else refused.push(t);
    }
    return refused;
  };
  const retry: string[] = [];
  await pool(chunkTexts(misses), CONCURRENCY, async (chunk) => { retry.push(...(await translateChunk(chunk))); });
  // One second pass, in small chunks, for answers the guard refused (a lost
  // number, a skipped item): a smaller request is usually answered faithfully.
  if (retry.length && !result.limited) {
    await pool(chunkTexts(retry, MODEL_CHUNK_CHARS, RETRY_CHUNK_TEXTS), CONCURRENCY, async (chunk) => { await translateChunk(chunk); });
  }
  result.failed = req.texts.length - Object.keys(result.translations).length;

  // 3. Shared from now on, by every report.
  if (fresh.length) {
    const { error } = await db.from('verify_text_translations').upsert(fresh, { onConflict: 'source_hash,lang', ignoreDuplicates: true });
    if (error) console.error(`verify-synthesis translate: cache write failed: ${error.message ?? error}`);
  }
  // 4. COGS, whenever a model call was made — failed ones included (they may still bill).
  if (sentChars > 0) await recordCost(db, req.jobId, req, opts.model, usages, unmetered, sentChars);
  return result;
}
