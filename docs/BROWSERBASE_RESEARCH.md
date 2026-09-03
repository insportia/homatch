# Homatch Browser Research / CAPTCHA handoff

## Goal

Use Browserbase as the browser layer for property/cadastral research. Supported CAPTCHA challenges are attempted automatically. A human is only interrupted when browser automation cannot complete verification.

## Runtime flow

`RESEARCHING -> BROWSER_SESSION -> AUTO_VERIFICATION -> RESEARCHING`

Fallback:

`AUTO_VERIFICATION_FAILED -> HUMAN_VERIFICATION_REQUIRED -> LIVE_VIEW -> USER_VERIFIED -> RESUME_RESEARCH`

The same Browserbase session must be preserved during handoff so cookies/session state are not lost.

## Production secrets

Set these as Supabase Edge Function secrets (never frontend env vars):

- `BROWSERBASE_API_KEY` — required
- `BROWSERBASE_PROJECT_ID` — optional if Browserbase infers project from API key

The existing `OPENAI_API_KEY` remains server-side for synthesis/reasoning.

## Implemented

- `browserbase-handoff` Edge Function
- authenticated user/session validation
- allowlisted official research targets
- Browserbase EU session (`eu-central-1`)
- `browserSettings.solveCaptchas = true`
- session recording + logging enabled
- 15 minute keep-alive session
- Live View URL retrieval from `/v1/sessions/{id}/debug`
- reusable `HumanVerificationBrowser` UI component

## Next integration point

`VerifyPage` should show `HumanVerificationBrowser` only when a research job reports `HUMAN_VERIFICATION_REQUIRED`. Do not interrupt users pre-emptively when automatic verification succeeds.

## Evidence contract

Browser access and AI synthesis are separate concerns. Every extracted fact should retain:

- source URL
- source type/domain
- retrieved timestamp
- raw evidence/excerpt
- normalized fact
- confidence
- verification status

Rule: **NO EVIDENCE = NO FACT**.

The final property intelligence report should distinguish official/registry evidence, public-web evidence, Homatch data, conflicts, and unavailable facts.
