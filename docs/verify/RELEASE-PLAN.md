# HOMATCH Verify — coordinated release plan (TAS + NAPR/MyGov Service176 + RS.ge)

Status: **NOT RELEASED.** PR #127 stays DRAFT. Nothing below runs without the
owner's explicit approval. One coordinated release only after the two Codex
workers (NAPR/MyGov Service176, RS.ge) are integrated — see
`CODEX-INTEGRATION.md`.

Release tier: **REPO_FULL** (`npm run homatch:release:plan`; the migration
inserts into `storage.buckets`, and the translations change reaches every
mobile shard). Deploy targets: frontend · Railway `homatch-official-worker`
· edge `research-agent`, `verify-synthesis` · 1 migration.

## 1. What is fixture-tested vs live-verified

| Capability | Fixture / unit tested | Live-verified |
|---|---|---|
| DWR search body (byte-identical to the owner's browser body) | yes | **owner, in the browser** — not from this repo |
| DWR reply evaluation (references, inline literals, exceptions, prototype keys) | yes | no |
| Exhaustive pagination + reconciliation against the server total | yes | no |
| `getUserDocumentLastMotion` detail graph (motions, attachments) | yes (structural fixture) | owner, one document (639208) |
| `NewArchitectureResponse` responses (PDF / HTML / EMPTY by bytes) | yes | owner, one motion (639208 / 4304382) |
| `DownloadServlet?downloadCase=2&attachedFileId` (root) | yes (fixture) | **NOT VERIFIED** — history shows commands, not outputs |
| Georgian PDF text via `pdf-parse` (vs owner's pdfjs) | parser injectable; fixture text | **NOT VERIFIED** |
| Decision extraction (outcome / number / issue date / valid-until) | yes, incl. negation and conflicting wording | shape for one decision only (4303543, 13/12/2018, intermediate) |
| Authority-based status, fail-closed caveats | yes | no |
| MyHome.ge / SS.ge market via worker `/verify/market` | yes (adapter fixtures) | adapters are live in Find Buyers; the Verify path is not |
| Official visuals → private bucket → 1 h signed URLs | yes | no (bucket does not exist yet) |
| Report, waiting network, Admin panel | unit + browser (stubbed network) | no |

## 1b. Provider independence (what is guaranteed, and how)

- Each worker step runs inside its own try/catch: a crash becomes that
  source's technical-failure result, and the next source still runs
  (`ResearchOrchestrator.runStep`).
- A source that needs a human verification parks the job only for a bounded
  time. After 20 minutes unattended, research-agent skips that ONE source
  through the same path as the customer's Skip button
  (`releaseUnattendedHumanWaits` → `skipHumanWait`). The job then continues
  to a report built from every other source.
  - Before this change, the 6-hour reaper failed the whole job and discarded
    the evidence already collected.
- `src/verify/providerOutcomes.ts` gives each provider its real state from
  recorded results only:
  - States: VERIFIED, COMPLETED, PARTIAL, CAPTCHA_REQUIRED, CAPTCHA_FAILED,
    SOURCE_CHANGED, TEMPORARILY_UNAVAILABLE, TIMEOUT, FAILED, NOT_VERIFIED.
  - A failure after evidence was collected is reported as PARTIAL, and that
    evidence is kept.
  - Customers see a localized list of provider limitations; Admin sees
    reasons and counts.
- **Automatic CAPTCHA solving (2Captcha): implemented and on by default.**
  - Shared worker service for Service176 and RS.ge, built on the official
    SDK.
  - Bounded, deduplicated, redacted, with a kill switch.
  - Acceptance is confirmed by the source itself.
  - See `CODEX-INTEGRATION.md`.
  - Requires the key in the Railway worker environment, which the owner
    reports as already set.

## 1c. Developer Advertising Intelligence (last research stage)

- **Where it runs.** research-agent, at `SYNTHESIS_READY`, before the report
  is written (`advanceDeveloperAds`). It does not need the worker.
  - It is non-blocking: every failure becomes an outcome and synthesis
    proceeds.
  - Outcomes: DISABLED, PROVIDER_OFF, NOT_CONFIGURED, NO_IDENTITY,
    UNSUPPORTED, TIMEOUT, FAILED.
- **One shared Apify client.** The stage uses
  `_shared/findBuyers/memo23Client.ts`; Verify keeps its own orchestration.
  - Setting `verify_developer_ads`, **seeded `enabled:false`**.
  - Caps: 2 search terms, 30 items, $0.05 per run, 120 s, 24 h cache.
  - The APIFY switch in `provider_disabled_list` also stops it.
  - Cost goes to `cost_events` with `APIFY_MEMO23` / `DEVELOPER_ADS_VERIFY`.
  - Exactly one paid run per job: the stage is claimed atomically, and on
    timeout the run is aborted and its partial items billed.
- **Actor:** `memo23~facebook-ads-library-scraper-ppe`.
  - **Schema NOT verified from the development sandbox.** apify.com and
    api.apify.com are blocked by egress, and the token exists only in
    Supabase secrets.
  - So nothing is assumed. Before each paid run, the stage reads the
    Actor's live input schema through the free `GET /acts/{id}`
    (`actorDefinition`). It sends only declared fields (`searchTerms`
    required; `searchCountries` and `maxItems` when declared). It ends
    UNSUPPORTED, without spending, when `searchTerms` is missing.
  - The output mapping (`ad_archive_id`, `page_name`, `is_active`,
    `snapshot.*`) is tolerant. Unmapped keys are recorded for diagnostics.
- **Customer report.** A "Developer advertising" section
  (`DeveloperAdvertising.tsx`), shown only when the stage completed.
  - Content: counts, platforms, themes, at most 3 examples, and verified
    profiles.
  - Links: only Meta Ad Library pages and OFFICIAL https profiles. A
    POSSIBLE profile is named and never linked; ad landing pages are never
    shown.
  - The AI assessment passes `guardAdvertising`, so no financial-strength,
    trust or "inactive" claims get through.
- **Admin.** Providers → Verify official sources → Developer advertising:
  enable switch, limits, the free "Verify Actor input" check, and recent
  stage outcomes with their cost.
- **Acceptance (owner-approved, after deploy):**
  1. Run the free Actor-input check. It must report `searchTerms` as
     supported, along with the price per 1k.
  2. Enable the stage and run one Verify on a known developer project
     (cost ≤ $0.05).
  3. Compare the advertisers and ads with the public Ad Library.
  4. Disable again if wrong (immediate, no deploy).

## 2. Migration and deployment order

All steps are reversible; each waits for the previous step's proof.

0. **Preconditions.** PR #127 green on its head (PR Checks, REPO_FULL), the
   Codex workers integrated and green, owner approval recorded, base merged.
1. **Migration** `20261022090000_verify_official_visuals_and_switches.sql`
   (before deploy; additive): private bucket `verify-official-visuals`
   (no `storage.objects` policy), settings `verify_tas_implementation =
   {"active":"LEGACY","fallback":null}`, `verify_marketplace_market_enabled
   = false`, `verify_captcha_auto_solve` (enabled), `verify_developer_ads`
   (`enabled:false`). Applied through `run_migrations` or the reviewed MCP apply after
   merge. Proof: present in the production ledger; bucket `public = false`;
   both settings at their seeded values.
2. **Railway** `homatch-official-worker` (`3e7f132b-…`, canonical service
   only, never `-v2`). The new routes (`/health/tas`, `/tas/test`,
   `/verify/market`, `/research/visual/:sha`) are inert until called; `/research`
   defaults to LEGACY. Proof: deployment SUCCESS at the merge commit;
   `/health` lists the same workflows; `/health/tas` answers.
3. **Edge** `research-agent`, `verify-synthesis` (CI deploy-scope). Proof:
   PROVEN_EXACT for both.
4. **Frontend** (Vercel Git integration). Proof: READY at the merge commit,
   aliased to `www.homatch.live`.

Code tolerates any partial order: research-agent defaults to LEGACY when the
setting is missing; the market gate defaults to off; a missing bucket only
records `_officialVisualsError`; the report renders without `officialHistory`.

## 3. Controlled production acceptance test (after deploy, before activation)

Each paid step needs the owner's explicit go.

1. **Admin → Providers → Verify official sources → TEST** (free, read-only
   against tas.ge) on the owner's reference parcels: the 639208 project and
   the cadastral code holding 1161121. Compare with the owner's known
   inventory: 19 documents; 133 responses (67 PDF, 1 HTML, 65 EMPTY);
   413 attachments (326 PDF, 87 non-PDF); 22 on 1161121.
   - Pass: search reconciled; details read = documents; no
     `DETAILS_NOT_READ`; `DownloadServlet` returns real files (first live
     proof); decision for 639208 / 4304382 = № 4303543, 2018-12-13,
     INTERMEDIATE.
   - Georgian text check: open 3 PDFs in the diagnostics and compare against
     the owner's pdfjs output. If the text is garbled or missing, API_FIRST
     stays inactive (BLOCKED on the parser).
2. **Baseline (paid, owner approval):** one Verify run on the same property with
   LEGACY active. Save the report.
3. **API_FIRST trial (paid, owner approval):** ACTIVATE API_FIRST with
   fallback = LEGACY; run the same property. Compare the reports. API_FIRST
   must show at least the same official facts, a status with its caveats,
   5–10 milestones, ≤ 6 official visuals (signed URLs that expire in 1 h),
   and no source URLs. Check diagnostics: ledger, funnel, tokens, duration.
4. **Signed URL checks:** a visual URL opens for the job owner; the same
   object path without a signature returns 400/403; after 1 h it expires.
5. **Market (paid, owner approval):** set `verify_marketplace_market_enabled`
   to true and run one Verify. Comparables appear under market research,
   deduplicated, with no listing URLs or seller contacts.
6. **NAPR/MyGov and RS.ge:** run the acceptance defined in
   `CODEX-INTEGRATION.md` for each.
7. **Hold:** keep API_FIRST active with fallback for 10 real jobs. Admin
   diagnostics must show no FAILED-without-fallback and no
   `PROCESSING_UNVERIFIED`.

## 4. Rollback and recovery

| Problem | Action | Time |
|---|---|---|
| API_FIRST wrong or failing | Admin → **ROLLBACK** (sets LEGACY; audited) | immediate, no deploy |
| Market comparables wrong | Admin marketplace switch → off | immediate |
| Developer advertising wrong or costly | Admin → Developer advertising switch → off (or the APIFY provider switch) | immediate |
| Report / UI defect | Vercel: promote the previous production deployment | minutes |
| Edge defect | redeploy the previous `refs/deployed/edge` artifact for the two functions | minutes |
| Worker defect | Railway: redeploy the previous deployment of the canonical service | minutes |
| Migration | additive; leave in place (settings inert, bucket private). If removal is ever needed, a new append-only migration — never edit history | — |

Interrupted jobs: research jobs resume from their stored stage; a worker
redeploy mid-job lets the job fall back to LEGACY or finish as partial,
marked incomplete, never conclusive.

## 5. Outstanding blockers

- NAPR/MyGov Service176 (Codex) and RS.ge (Codex) worker code not received
  (no branch or commit on GitHub; `feat/service176-integration` is the
  already-merged PR #119).
- 2Captcha is live-unverified until the first controlled solve. Before it:
  - Confirm the key's variable NAME in Admin → CAPTCHA card after deploy.
  - Expect about $0.003 per solve.
- Live access to tas.ge is impossible from the development sandbox. Every
  live TAS claim waits for step 3.1.
- `DownloadServlet` and Georgian PDF text fidelity: unverified until 3.1.
- Credential hygiene: the owner's recovered PowerShell history contains what
  looks like an API key (line 8). Rotate it at the provider and keep it only
  in the secret store.
