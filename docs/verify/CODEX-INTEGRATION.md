# Integrating the Codex NAPR/MyGov Service176 and RS.ge workers

Rule: the three official workstreams stay separate. TAS, NAPR/MyGov and
RS.ge each keep their own worker code and contract. They meet only at the
Verify orchestration, evidence and reporting layers. Nothing here rebuilds
either Codex worker. Neither one's code is in this repository or on GitHub
yet (status: **DEFERRED / BLOCKED — awaiting the Codex code**).

## Where each source plugs in today

### NAPR/MyGov Service176 (step `mygov`, adapter `service176-public-api`)

- **Dispatch:** `official-worker/src/orchestrator/ResearchOrchestrator.ts`
  `runStep`: `if (key === 'mygov') return runMyGovApiStep(query, entities);`.
  It runs before any browser page and never pauses for a human. The
  cadastral step plan is `['TAS_MAP','tas','mygov']` (`ResearchContext.ts`).
- **Current implementation:** `official-worker/src/workflows/mygov/MyGovApiWorkflow.ts`
  plus `workflows/mygov/service176/*` (merged in PR #119).
- **Result contract** (`LegacySourceResult`, `workflows/WorkflowResult.ts`):
  - Identity fields: `source:'mygov'`, `adapter:'service176-public-api'`,
    and `status` (SEARCH_CONFIRMED | NO_RESULT_CONFIRMED | BLOCKED |
    SUBMITTED_UNCONFIRMED | FAILED | TIMEOUT).
  - `traversal`: `{providerState, search:{cadastralCode, records[{appID, regNumber, status}]}, records[{recordId, info, documents[]}], continuations, documentReferences, failures, requests, nonBlocking}`.
  - `documents[]` entries: `{url, complete, sha256, title, rawText, pageCount, sourceReference{url, recordId, cadastralCode, registrationNumber}, contentMetadata{status, contentType, signature:'%PDF-', byteLength, finalUrl}}`.
- **Consumers:**
  - research-agent `pollBrowser` stores the result in `browserOfficial.results`.
  - `service176PromptEvidence()` sends at most 6 validated documents to the prompt.
  - `projectService176Evidence()` produces `result_json.service176Evidence`.
  - `evidencePackage.ts` builds tier-1 OFFICIAL_REGISTRY items from it.
  - `src/verify/intelligence/service176Evidence.ts` is the projection.
- **Proof tests:**
  - `src/verify/intelligence/__tests__/service176.test.mjs`
  - `official-worker/test/mygovApiWorkflow.test.mjs`
  - `official-worker/test/mygovOrchestratorIntegration.test.mjs`
  - `docs/service176/RELEASE-MAP.md`

### RS.ge Taxpayers Registry (step `rstax`)

- **Entry:** worker `POST /research/rstax-entity` (needs `idCode`); dispatch at
  `ResearchOrchestrator.runStep` (`rstax`).
- **Current implementation:** `workflows/financial/RsTaxpayerWorker.ts` (Playwright;
  CAPTCHA via WAITING_HUMAN).
- **Result contract:**
  - `LegacySourceResult` with `source:'rstax'`.
  - `taxpayerData: RsTaxpayerPublicData {identificationCode, taxpayerName, legalForm, status, registrationDate, vatStatus, address, otherPublicFields}`.
  - SEARCH_CONFIRMED only with parsed evidence.
- **Consumers:**
  - research-agent `startFinancialEntity` / `pollFinancialEntity` append it to
    `browserOfficial.results`.
  - `legalStatus.taxpayerStatus` via `sourceOutcome('rstax')`.
  - There is no evidence projection for `taxpayerData` yet.
- **Important — RS.ge does not run automatically today.** research-agent
  seeds `_financialQueue = ['enreg','debtor']`, and `buildEntitySteps` leaves
  out `rstax` because of the CAPTCHA. The native Codex worker is what would
  make it run.

## Integration seams (prepared; activated only with the Codex code)

1. **One adapter per worker, no rewrite.**
   - Place the Codex code in its own directory
     (`workflows/mygov/codex/…`, `workflows/financial/rsge-native/…`) exactly as
     delivered, plus one thin adapter that returns the SAME `LegacySourceResult`
     shape above.
   - For Service176, keep `adapter:'service176-public-api'`, or extend the
     filter in `projectService176Evidence` to accept the new adapter name.
     Nothing downstream changes.
2. **Selection switch — the TAS pattern, copied.**
   - Settings: `verify_mygov_implementation` / `verify_rstax_implementation` =
     `{active:'CURRENT'|'CODEX', fallback}`.
   - research-agent reads each setting with a safe default and forwards it in
     `/research`. The worker branches in `runStep` and falls back in-step on
     FAILED.
   - Admin gets TEST / ACTIVATE / ROLLBACK cards next to TAS. Today the
     Admin panel already lists both sources as "pending integration".
3. **RS.ge activation.**
   - Add `'rstax'` back to the research-agent financial queue behind
     `verify_rstax_implementation.active === 'CODEX'`, so today's behaviour is
     unchanged until activation.
   - Add a `taxpayerData` projection (an `rsTaxpayerEvidence`, built like
     `service176Evidence`) into tier 1 of the evidence package.
4. **Report.**
   - Both sources already reach the report through the evidence package and
     `legalStatus`.
   - The customer report shows findings only; raw records stay internal.
   - Official status from TAS is not merged with registry ownership.
     Ownership and encumbrances come from NAPR, and taxpayer standing from RS.ge.
5. **Contract tests to add when the code arrives.**
   - Feed each Codex worker's own fixtures through the adapter.
   - Assert the `LegacySourceResult` fields above.
   - Assert `projectService176Evidence` / the RS projection output, and that a
     FAILED run falls back.

## Unknown until the Codex code is received

- Its output shape: matches `LegacySourceResult`, or needs adapter work.
- HTTP-only or browser. This decides whether it runs before `ctx.newPage()`.
- How it handles CAPTCHA and continuation: non-blocking BLOCKED, or
  WAITING_HUMAN.
- The RS.ge input key (idCode or something else).
- Runtime dependencies, budgets, and its own test fixtures.

## Acceptance (per worker, after deploy, owner-approved)

- Admin TEST against the owner's reference identifiers (free reads).
- One paid Verify run with the current implementation and one with CODEX.
  Compare evidence items, status and report.
- Rollback = setting back to CURRENT.

## CAPTCHA (2Captcha) — audit result, 2026-10-08

- **Repository search.** I searched every branch and commit for `2captcha`,
  `twocaptcha`, `captcha_api` and similar names. There is no client, no
  secret reference and no configuration.
- **The only trace.** The owner's local PowerShell history mentions 2Captcha
  near the Service176 commands. That code lives with the Codex workstream and
  was never pushed.
- **The current product rule is the opposite:**
  - The customer completes a verification in their OWN browser (commit
    689939fa, "Hand the CAPTCHA to the customer's own browser, not ours").
  - Otherwise the source is skipped and marked unverified.
  - `researchAccess.test.mjs` asserts that nothing in the research core
    solves a CAPTCHA.
- **What is built now.**
  - Detection and classification: `providerOutcomes` distinguishes
    CAPTCHA_REQUIRED / CAPTCHA_FAILED from SOURCE_CHANGED /
    TEMPORARILY_UNAVAILABLE / TIMEOUT.
  - Bounded waits: a verification left unattended for 20 minutes is skipped,
    and the rest of the research continues.
  - Admin counters: verifications requested, and waits released while
    unattended.
- **What is needed to enable automated solving:**
  - The owner's explicit decision, including confirmation that it is
    permitted for these sources.
  - The Codex code that contains the integration.
  - A server-side secret.
  - A per-provider attempt cap and spending cap.
  - Acceptance of the solution confirmed by the source itself.
  - A kill switch.
  - Admin cost tracking.
  - Removal of the research-core guard only for the official-worker
    adapters.
