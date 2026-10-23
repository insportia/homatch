# Verify — synthesis metering discrepancy (documented, not changed)

Found 2026-10-23 on job `176264ba`. **Customer billing is not changed by this note.**

| Ledger | synthesis stage |
|---|---|
| `verify_stage_cogs` / `cost_events` VERIFY_SYNTHESIS (internal COGS) | **$0.0682** — 20,178 in / 2,322 out on gpt-5.6-terra |
| `verify_job_cost()` (customer meter) | **$0.0068** |

## Cause

`supabase/migrations/20261026100000_verify_credit_budget.sql` sets the billing policy
`ai_models = { default: gpt-5.6-terra, synthesis: gpt-5.6-luna, verify_synthesis: gpt-5.6-luna }`
(line 94) and prices each research stage from that map (line 310). research-agent's
SYNTHESIS stage runs on the research model (terra; `costModels.synthesis` on the job says
so), so the meter prices it at luna rates — 10× lower. The report call
(`verify_synthesis`) is correctly luna.

## Effect

- V1: the meter under-counts each report by ≈ $0.061 (≈ 0.6 credit).
- V2: no RA SYNTHESIS call is made, so there is no line and no discrepancy.

## Options (owner decision; billing workstream)

1. Price `synthesis` from the job's own `costModels.synthesis` (what COGS does).
2. Set the policy map's `synthesis` to gpt-5.6-terra.
3. Leave it: V2 removes the call.
