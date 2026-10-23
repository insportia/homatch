# Verify V2 — research & web-search cost (2026-10-23)

Reference job `176264ba` (cadastral `01.18.06.014.080`, V1, production at `e38348cc`).
All figures are measured from production telemetry unless marked **estimate**.

## Baseline (measured)

| Stage | Model | In / cached / out tokens | Searches | Model $ | Search $ |
|---|---|---|---|---|---|
| identity | gpt-5.6-terra | 40,984 / 0 / 4,309 | 5 | 0.1337 | 0.050 |
| official_collection | gpt-5.6-terra | 38,499 / 4,435 / 2,937 | 0 | 0.1043 | — |
| public_research | gpt-5.6-terra | 56,915 / 4,435 / 4,783 | 6 | 0.1632 | 0.060 |
| market | gpt-5.6-terra | 41,661 / 4,435 / 4,510 | 4 | 0.1295 | 0.040 |
| synthesis (RA) | gpt-5.6-terra | 20,178 / 0 / 2,322 | 0 | 0.0682 | — |
| report (verify-synthesis) | gpt-5.6-luna | 52,875 / 11,272 / 13,938 | 0 | 0.0253 | — |

Prices (public.price_per_unit_at): terra $2.00 / $0.20 cached / $12.00 per M; luna exactly 10× cheaper; web search $0.01/call.
Total COGS (verify_job_cogs) **$0.832**: AI 0.624, search 0.150, CAPTCHA 0.042, Apify 0.016.

Corrections to that total:
- The report was built three times (504 cascade, fixed in #302); only one build has a cost row → corrected internal COGS ≈ **$0.86–0.88**.
- Customer meter `verify_job_cost()` prices `synthesis` at $0.0068 vs $0.0682 in COGS (10×). Billing — not changed here; reported.

## Root causes of avoidable research cost

1. RA SYNTHESIS ($0.068) writes three fields no customer path reads (V2: code, #297).
2. MARKET rewrote up to 25 code-gathered comparables that `finish()` then discards (V2: asks for new URLs only, #297).
3. Dynamic text before BASE: the 9.1k-char shared rules were the cacheable prefix in only 3 of 7 measured prompts per stage, never for MARKET.
4. MARKET received the official stage's full 16k JSON (documents list repeating officialEvidence and technical facts).
5. Every research stage runs on terra at API-default reasoning and search context — not configurable per stage.
6. Market correctness (both engines): register parser missed the current land label (`ნაკვეთის დანიშნულება:`), so land designation was never known; agricultural plots and reposts entered land valuations (176264ba: 6 "comparables", one plot posted 4×, median $40/m²; now 1 valid comparable at $45/m², the rest rejected with reasons).

## What changed (this branch)

| Change | Scope | Effect |
|---|---|---|
| `src/verify/v2/researchRequest.ts` — per-stage model / reasoning effort / search-context routing from `admin_settings.verify_v2_research`, stamped at creation | V2 jobs | **Defaults = V1 request.** Enables measured switching per stage |
| BASE-first prompt order + `prompt_cache_key` | V2 jobs | BASE cacheable in 7/7 prompts in every stage (V1: 3/7; MARKET 0/7) |
| Empty fields dropped from embedded JSON | V2 jobs | lossless; −0.3% to −1.4% chars |
| MARKET reads price-relevant official fields only | V2 jobs | −10.6% MARKET chars |
| `landUseOf`, `LAND_USE_MISMATCH`, repost key in `applyMarketEligibility`; register parser reads `დანიშნულება` + wrapped value | both engines | correctness |

## Savings

| Item | Per job | Basis |
|---|---|---|
| RA synthesis → code | $0.068 | measured cost of the removed call |
| MARKET no restating | ~$0.018 | **estimate** (≈1.5k output tokens) |
| BASE caching + compact context | ~$0.010–0.020 | **estimate** from measured prompt sizes (2.21 chars/token, 176264ba) |
| **Quality-neutral total** | **≈ $0.10 (≈12%)** | |

The remaining large levers are now one setting each, per stage, but are **not switched on** — each needs an offline A/B on frozen prompts (harness ready: `scratchpad/replay`), which needs an OpenAI key:

| Lever | Estimate if it passes |
|---|---|
| official_collection on luna (extraction, no search) | ~$0.09 |
| reasoning effort `low` on research stages | ~$0.04 |
| search context `low` on identity / public_research / market | ~$0.04–0.06 |

## Final authority

The customer report is written by **gpt-5.6-luna**, not the strongest model. Moving it to terra would cost ≈ +$0.25 per report (measured tokens × terra price). Not changed — owner decision.

## Rollback

Every cost change is V2-only: Admin → Providers → Verify engine → V1 (customers are on V1 now). The market correctness fix applies to both engines; revert its commit to undo.
