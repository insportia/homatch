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

## CAPTCHA (2Captcha) — implemented 2026-10-08 (owner decision: on by default)

- **Shared service.** `official-worker/src/captcha/captchaService.ts` is built
  on the official SDK `@2captcha/captcha-solver` 1.3.9 (exact pin, MIT,
  github.com/2captcha/2captcha-javascript).
  - **Gates:**
    - The key exists in the worker environment. It is reported by variable
      NAME only; the accepted names are listed in `CAPTCHA_KEY_NAMES`, or
      `CAPTCHA_KEY_VAR` can name another one.
    - Kill switch `CAPTCHA_AUTO_SOLVE=off`.
    - Admin policy `admin_settings.verify_captcha_auto_solve`, seeded enabled.
    - Circuit breaker (30 minutes on a bad key or zero balance).
  - **Bounds:**
    - 2 attempts per provider per job.
    - 3 solves per job.
    - `CAPTCHA_DAILY_CAP` (default 50).
    - 120 s hard timeout per solve.
  - **Duplicate prevention:** a challenge already in flight is not submitted
    again.
  - **Ledger:** outcome, latency and estimated cost. It never holds the key or
    a token.
- **Detection** (`captcha/detect.ts`): no challenge means no spend.
  - Solved: reCAPTCHA v2, v2 invisible and Enterprise v2.
  - Reported as unsupported, never solved: v3, hCaptcha and Turnstile.
- **Service176** (`MyGovApiWorkflow.ts`):
  1. NAPR gates a record with status 10/15.
  2. The site key is discovered from the NAPR viewer and its same-origin
     scripts (`NAPR_RECAPTCHA_SITEKEY` overrides).
  3. The record is solved, then continued through `resumeRecord(context,
     token)`, the source's own continuation.
  4. The record opening is the only proof of acceptance (good report);
     otherwise the token is bad-reported and retried within the cap.
  5. An unresolved record stays a non-blocking continuation.
  - The provider budget rises to 180 s when solving is enabled.
- **RS.ge** (`RsTaxpayerWorker.ts`):
  1. The visible reCAPTCHA v2 is solved.
  2. The token is placed in `g-recaptcha-response` and the page callback runs.
  3. The same Search #2 as the human-resume path runs.
  4. A parsed record or a confirmed no-result is acceptance (good report).
     The gate still standing is rejection (bad report, retry within the cap).
  5. After that, the existing human path applies, bounded by the 20-minute
     unattended release.
  - research-agent queues `rstax` only while the policy enables it.
- **Admin** (Providers → Verify official sources):
  - Configured or not, by variable name only.
  - Kill switch, breaker, solves today against the cap, estimated cost.
  - Balance on request (a free read).
  - Recent outcomes.
  - On/off switches, overall and per provider.
  - Each job's per-source attempts.
- **Tests** (`official-worker/test/captcha.test.mjs`): gates, budgets, dedupe,
  timeout, breaker, redaction, detection, Service176 (accepted / rejected /
  no CAPTCHA / no site key / hung solver), RS.ge in real Chromium (accepted /
  rejected → bounded → human fallback), and provider isolation. All use a fake
  solver; no paid solve has been made.
- **Not live-verified:**
  - NAPR's real site-key location and reCAPTCHA variant.
  - Whether RS.ge accepts an injected token.
  - Actual cost and latency.

  These are proven only by the first controlled live run (each run costs about
  $0.003 per solve).
