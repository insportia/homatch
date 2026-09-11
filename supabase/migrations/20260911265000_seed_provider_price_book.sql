/* ══════════════════════════════════════════════════════════════════════
 * THE RATES VERIFY IS PRICED AT
 * ══════════════════════════════════════════════════════════════════════
 *
 * Source: developers.openai.com/api/docs/pricing, retrieved 2026-09-11.
 * Rationale, exclusions and the three double-count traps: docs/COGS_PRICE_BOOK.md
 *
 * Verify meters OpenAI and nothing else — checked against cost_events, where
 * DATAFORSEO and APIFY belong to the discovery product and have not run since
 * August. The official-source worker is local Playwright Chromium on a fixed
 * Railway subscription, so it is a margin input, not a per-job meter.
 *
 * There is deliberately NO REASONING_TOKEN rate: OpenAI folds reasoning into
 * output_tokens, and cogs.ts reads a missing rate as "included in output"
 * rather than "free". Adding one would double-charge every run.
 *
 * Rates are never edited in place. To change one, close it with effective_to
 * and insert the successor, so a past job still prices at what it cost.
 */

insert into public.provider_price_book (provider, model, unit, rate, per_units, currency, effective_from, effective_to, source, notes)
values
  ('OPENAI','gpt-5.6-terra','INPUT_TOKEN',        2.00, 1000000,'USD','2026-07-30T00:00:00Z',null,
   'developers.openai.com/api/docs/pricing (retrieved 2026-09-11)','GPT-5.6 Terra standard short-context input. Launch pricing effective 2026-07-30.'),
  ('OPENAI','gpt-5.6-terra','CACHED_INPUT_TOKEN', 0.20, 1000000,'USD','2026-07-30T00:00:00Z',null,
   'developers.openai.com/api/docs/pricing (retrieved 2026-09-11)','Cached input is a SUBSET of input_tokens; cogs.ts subtracts it from billed input rather than adding.'),
  ('OPENAI','gpt-5.6-terra','OUTPUT_TOKEN',      12.00, 1000000,'USD','2026-07-30T00:00:00Z',null,
   'developers.openai.com/api/docs/pricing (retrieved 2026-09-11)','Reasoning tokens are inside output_tokens and are deliberately NOT priced separately.'),
  ('OPENAI','gpt-5.6-luna','INPUT_TOKEN',         0.20, 1000000,'USD','2026-07-30T00:00:00Z',null,
   'developers.openai.com/api/docs/pricing (retrieved 2026-09-11)','GPT-5.6 Luna. Used by verify-synthesis only.'),
  ('OPENAI','gpt-5.6-luna','CACHED_INPUT_TOKEN',  0.02, 1000000,'USD','2026-07-30T00:00:00Z',null,
   'developers.openai.com/api/docs/pricing (retrieved 2026-09-11)','Subset of input_tokens.'),
  ('OPENAI','gpt-5.6-luna','OUTPUT_TOKEN',        1.20, 1000000,'USD','2026-07-30T00:00:00Z',null,
   'developers.openai.com/api/docs/pricing (retrieved 2026-09-11)','Reasoning folded into output; no separate REASONING_TOKEN rate.'),
  ('OPENAI', null,          'WEB_SEARCH_CALL',   10.00,    1000,'USD','2026-07-30T00:00:00Z',null,
   'developers.openai.com/api/docs/pricing (retrieved 2026-09-11)','Reasoning-model rate: $10.00/1k calls. Search-content tokens are billed at model rates and ALREADY appear inside usage.input_tokens, so they are priced there and must not be added again here. Provider-wide because both gpt-5.6 models are reasoning models; an exact-model row would override it. The page states no effective date; 2026-07-30 adopted to align with the GPT-5.6 price list covering all measured runs.')
on conflict do nothing;
