# Email Studio rebuild — audit and plan (2026-10-24)

Owner brief: "HOMATCH EMAIL STUDIO — COMPLETE PREMIUM REBUILD". One coordinated
release on branch `claude/email-studio-rebuild`; no production deploy without the
owner's explicit approval.

## Audit — what exists

| Area | Today | Verdict |
|---|---|---|
| List campaigns | `outreach_campaigns` (campaign_type EMAIL) + `outreach_sends`; created in a modal on `/outreach/email` (`EmailCampaignsPage.tsx`, 916 lines); sent by `outreach-send` (≤ batch) and `jobs-worker` broadcast continuation. Production: 3 EMAIL campaigns, all COMPLETED. | **Canonical system.** Extend, don't duplicate. |
| Property Email Studio | `/email-studio` (`EmailStudioPage.tsx`), `email_studio_campaigns/recipients/events`, `_shared/emailStudio.ts` (`studio_*` actions inside outreach-send): block content, 4 property templates, AI draft (`copyGuard.ts`), review hash, schedule. Production: **0 campaigns.** | Reuse its ideas (blocks, review hash, never-inventing AI prompt); fold the route into the new studio. Tables stay (history-safe, empty). |
| Contacts | `outreach_contact_lists`, `outreach_contacts` (consent_status, lawful basis, source_kind incl. FIND_BUYERS), `ContactListsPage` CSV import (5,000 cap), `ContactsPage`, consent card. | Reuse as Audiences. |
| Sending | Resend marketing key, sender domains (`email_sending_domains`), quota reserve/settle, suppression, signed unsubscribe, webhooks (`email-webhook`), test mode, `email_marketing_live` switch, provider caps 60/day 2,000/month. Never-simulated rule. | Keep as is. |
| Policy / risk | `_shared/comm/policy.ts` `decideLaunch()` (ownership → eligibility → domain → compliance → risk → trust → spend → approval), `comm_risk_assessments`, `comm_account_trust`, `domainClassifier` (real-estate-only; GAMBLING prohibited list in 6 languages), Admin → Risk queue with audit log. | Reuse — **but the EMAIL outreach path does not call it today.** |
| Approval | `outreach_campaigns` status has DRAFT/READY/REVIEW_REQUIRED/APPROVED/SCHEDULED/RUNNING/PAUSED/COMPLIANCE_PAUSED/COMPLETED/CANCELLED/FAILED, `approved_by/at`, `risk_level`, `compliance_state`. | **Gap: outreach-send moves any DRAFT/READY/PAUSED campaign to RUNNING and sends. No content/link risk check, no approval gate.** |
| AI | `comm/llm.ts` (`callLlm`), HOMI in `homatch-ai`. | Add a bounded, context-aware email copilot action. |
| Links | none (no redirect inspection, no SSRF guard for user URLs). | New. |
| Analytics | counters on `outreach_campaigns`, `outreach_sends` statuses, webhook events, `CommunicationsAnalyticsPage`. Opens/clicks are not tracked for outreach today. | Show provider-confirmed metrics; label opens/clicks "not tracked". |

## Decisions

1. **One campaign system:** `outreach_campaigns` (EMAIL). The designer document
   lives in a new `design jsonb` column; the rendered HTML stays in
   `html_body`/`text_body` (server re-renders on submit; client HTML is never trusted).
2. **Status mapping (compatible):** DRAFT, READY_FOR_REVIEW (new), UNDER_REVIEW
   (= existing REVIEW_REQUIRED), CHANGES_REQUESTED (new), APPROVED, REJECTED (new),
   SCHEDULED, SENDING (= RUNNING), SENT (= COMPLETED), PARTIALLY_SENT (new),
   FAILED, PAUSED. The CHECK constraint is widened, never narrowed; old rows keep
   their values and the UI maps them.
3. **Server-side gate at the send endpoint:** `outreach-send` refuses an EMAIL
   campaign unless status is APPROVED/SCHEDULED/RUNNING **and** the stored
   `approved_content_hash` equals the hash of the current subject+preview+html+
   sender+list. A material edit after approval clears approval (DB trigger) and
   the risk engine reruns on resubmit. Legacy COMPLETED/LEGACY_MOCK rows stay
   unsendable.
4. **Campaign Risk Engine** (`src/emailMarketing/risk/` shared with the edge):
   deterministic layers — domainClassifier reuse (gambling/casino prohibited),
   phishing/credential patterns, misleading-claim patterns, sender/domain
   checks, audience provenance (consent share), velocity, previous abuse —
   plus **server-side link inspection**: https-only, no IP/private/link-local/
   internal hosts (SSRF), DNS-resolved private ranges refused, manual redirect
   following (≤ 5 hops, HEAD then GET, 4 s timeout), shortener detection,
   visible-text vs destination mismatch, final destination classified with the
   same prohibited lists. Optional LLM classification only for ambiguous text;
   never the sole enforcement. Verdict: ALLOW → policy (auto-approve or queue),
   REVIEW → manual queue, BLOCK → REJECTED with reasons. Recorded in
   `comm_risk_assessments` (existing) + `email_campaign_reviews` (new decisions log).
5. **Admin review policy** setting `email_review_policy` = `MANUAL_ALL` (default)
   | `AUTO_LOW_RISK`. Hard prohibitions are not configurable.
6. **Designer:** new block model (`src/emailMarketing/designer/`) — heading,
   text, image, button, divider, spacer, columns(2), logo, social, footer,
   contact, unsubscribe; per-block properties; undo/redo; autosave (debounced,
   localStorage recovery + server draft); desktop/mobile preview; renderer to
   table-based inline-styled HTML with sanitization (no script/style injection,
   https/mailto only). Lazy-loaded route.
7. **HOMI copilot:** new `email-marketing` action `copilot` (rate-limited,
   wallet-free like the existing studio AI), JSON-schema output of proposed
   edits (subject alternatives, preview, blocks, translation); the UI shows a
   diff and applies only on confirmation; output passes the same copy guard
   (no invented prices, discounts, claims, consent).
8. **Templates:** built-in premium templates (8 kinds) as designer documents in
   code; user templates in new `email_templates` table (RLS by owner).
9. **Routes:** `/email-studio` becomes the Email Studio shell (Dashboard,
   Campaigns, New, Designer `/email-studio/campaigns/:id`, Contacts, Templates,
   Analytics, Deliverability, Sender). `/outreach/email*` routes keep working
   (redirect or render inside the shell). "New Campaign" navigates to
   `/email-studio/new`, no modal.

## Phases (one branch, one release)

1. Schema migration + state machine + send gate + approval invalidation (+ PGlite tests).
2. Risk engine + link inspector (+ unit tests incl. casino, redirect-to-casino, SSRF, shortener).
3. Edge actions: save draft, submit, admin decide, schedule/cancel, test send of a design, copilot.
4. Designer + renderer + templates.
5. Studio shell, dashboard, wizard, campaigns, analytics, deliverability, sender.
6. Admin review queue (extend Admin → Risk) + email governance controls.
7. i18n ×6, RTL, mobile; browser screenshots; end-to-end QA list (brief §16).

## Out of scope / not touched
Verify, Find Buyers, Publishing Engine, Meta Ads; SMS/calls stay blocked by
`provider_kill_switch`.
