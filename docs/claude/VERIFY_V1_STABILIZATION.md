# Verify V1 stabilisation (phase 1)

Branch: `claude/verify-v1-stabilization`. It merges the five fix branches listed
below on top of `claude/verify-v2-audit`.

**Not pushed, not migrated, not deployed.** Findings F1–F7 refer to
`VERIFY_V2_AUDIT.md`; the V2 design is in `VERIFY_V2_PLAN.md`.

## Commits by fix

| Fix | Branch | Commits |
|---|---|---|
| F1: job state machine | `claude/verify-v1-state-cogs` | `e2bd6662` |
| F7: COGS attribution | `claude/verify-v1-state-cogs` | `347c22e8` |
| F4: PDF visuals and gallery empty state | `claude/verify-v1-visuals` | `f1a7caaa`, `5a4c8bae` |
| F2 / F3: official-source status | `claude/verify-v1-source-status` | `541a8d2c`, `cd727815`, `651d5e4b` |
| F6: market profile and eligibility | `claude/verify-v1-market` | `5fa7be12`, `7cf830b0`, `95a319f3` |
| F5: coordinates and location contract | `claude/verify-v1-location` | `e9e58f75`, `b3dd39e3`, `fa199e69` |

## Validation on the merged tree

| Check | Result |
|---|---|
| `tsgo -p tsconfig.check.json` | pass |
| `check:edge` (102 functions) | pass |
| `i18n:check`, `i18n:keys` | pass |
| `homatch:migrations` | pass |
| `vite build` | pass |
| Unit + matrix + edge suites | 9,614 / 9,624 pass. The baseline was 9,500 / 9,509. All 10 failures existed before this work: Meta Ads fee, 2 × i18n registry, TEST 15 CPU budget, adminStringSplit, Build Output dir, 2 × release `plan.mjs`, serviceControlsExpand, plus the design-studio timing test, which passes when run alone (13/13). |
| official-worker `npm test` | 690 / 690. The baseline was 658 / 659; its one failure, `admissionQueue`, passes now. |

Not run:
- SQL tests (`tests/sql/*`): no local Postgres.
- Deno end-to-end runs of the edge functions.
- Live portal, CAPTCHA, or OpenAI runs.

## Deployment footprint (when approved)

| Runtime | What deploys |
|---|---|
| Migrations | `20261120090000_verify_background_job_terminal_stage.sql` and `20261120090100_verify_cogs_attribution.sql`. Both are additive: `create or replace` of a function and views, with existing columns kept and new ones appended. |
| Edge functions | `jobs-worker`, `research-agent`, `verify-synthesis` |
| Railway | `homatch-official-worker` |
| Frontend | Vercel (gallery empty state, location labels, admin COGS breakdown, job progress) |

Suggested order:
1. Migrations.
2. Railway worker.
3. Edge functions.
4. Frontend.

Each step tolerates the previous version of the others.

## Open items before production proof

1. **RS.ge raw answers.** Two stored raw answers in the private bucket
   `verify-evidence` decide the final RS.ge parser fix:
   - `sha256/15/15ae5f8c….json`
   - `sha256/fc/fcd58cec….json`

   The fix now in place makes RS.ge fail honestly and logs the answer's
   structure. It does not yet parse the answer.
2. **Market coverage replay.** The district-or-skip rule was replayed on 2
   stored jobs only. Before deploying, replay it on the last 30 jobs, to
   measure how many lose their portal search because no district resolves.
3. **Location conflict rule** (owner decision). When an unlinked situational
   drawing disagrees with a house-precision geocode of the registry address,
   the code currently shows no centre.
4. **Customer meter.** `verify_job_cost` still prices research-agent's terra
   SYNTHESIS stage at luna rates, about $0.085 per job below raw cost. This was
   left unchanged on purpose; changing it is a pricing decision.
