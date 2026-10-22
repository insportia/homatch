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

## Pre-production round (2026-10-23)

### RS.ge parser

The two stored raw answers were read (read-only) from `verify-evidence`. Both
are **valid, complete records** of active, VAT-registered LLCs, in RS.ge's
columnar shape: `Data.Fields` plus `Data.Rows`, and `Summary._Count`.

- The old parser treated the first answer as UNPARSEABLE.
- On the second, the old code believed the page's empty grid and stored a
  false "no taxpayer record".

The fix is commit `90ab02c2`:
- columnar answers are read;
- RS.ge's column codes are mapped;
- a masked identifier is matched against the searched one;
- a row that names a different identifier is never confirmed.

Both real answers are now the test fixtures.

### Location

Commit `961377f0`. The address geocode now counts as HOUSE precision only when
Nominatim's own `house_number` equals the number in the registry address.

- **When a drawing disagrees with that geocode:** the validated geocode
  becomes the centre, labelled approximate. The drawing is kept as a flagged
  candidate (`DRAWING_SET_ASIDE`, in the V2 contract, with a report note in
  six locales).
- **Against a street-precision geocode:** the conflict stays and no distances
  are given.
- **Live check:** Tskneti hwy 31 returns `house_number` 31, building level.

### Market replay

Commit `92f44c9e`. The gate was replayed read-only on the last 30 completed
jobs, which cover 7 distinct properties. Two defects showed up and were fixed:

- A building's 3,711.2 m² was taken as an apartment's size. Such an area is
  now refused and kept as evidence.
- A village plot (Tsavkisi) lost its own Tsavkisi comparables. A settlement
  named in the address now locates the subject.

All other exclusions were correct (wrong district, wrong type, out of size
band). Per distinct property:

| Property | Before (stored) | After |
|---|---|---|
| Dighomi apartment 79.5 m² | 195 listings (185 city-wide) | RANGE from 54 |
| Krtsanisi apartment 94.1 m² | 252 listings | RANGE from 109 |
| Krtsanisi apartment `.503` | 41 listings (35 from other districts) | too few (2) |
| Parking 12 m² | 185 city-wide flats | not valued (parking is not searchable) |
| Bagebi development project | 103 city-wide flats | too few (2) |
| Tsavkisi land 1,100 m² | 3 village plots | 2 in band; too few for a range (needs 3) |
| Unit `.603` | 6 listings | type unknown, not valued |

Stored listings came from the old city-wide searches, so these counts are a
floor. The new district-scoped searches can only find more same-district
listings.

### Migrations and security

- **`20261120090000` on PGlite** (real Postgres):
  - applies cleanly, and re-applies idempotently;
  - its SQL test file passes;
  - 20 repeated finishes produce one terminal stage;
  - non-VERIFY jobs are unchanged.
- **`20261120090100` against production, read-only:**
  - the view bodies run as SELECTs;
  - every existing column keeps its position;
  - dependents (`finance_cost_facts`, `market_refresh_roi`) are unaffected,
    and `market_refresh_roi` reads only the `market` stage;
  - the reference job computes $0.952924.
- **Grants:**
  - `background_job_finish` is unchanged (service_role only);
  - `verify_cogs_job` loses anon EXECUTE and keeps its `is_admin` / service
    check.
- **Customer pricing:** `verify_job_cost` reads `costUsage` (unchanged) and
  non-OPENAI `cost_events` only, so the new OPENAI `VERIFY_REPORT` row is not
  billed.
- **Spend:** the one-retry RS.ge path can add at most one $0.003 solve to a
  job.

The release plan is in `VERIFY_V1_RELEASE_PLAN.md`.

## Open items before production proof (as of the first round; 1–3 resolved above)

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
