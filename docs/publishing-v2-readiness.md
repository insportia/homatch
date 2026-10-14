# Publishing V2 release evidence

This change extends the existing Publishing Engine. It does not authorize a production release or any real portal mutation.

## Implemented boundaries

- Existing `/property/publish`, authentication, canonical normalization, legacy jobs and adapters remain available. The route now renders native HOMATCH components instead of an iframe.
- Incomplete drafts persist through an optimistic version check; display IDs come from a database sequence. Canonical revisions and individual remote observations remain separate.
- A server-owned operation queue records payload snapshots, revisions, idempotency keys, attempts and expiring fenced leases. Pending edits coalesce. Uncertain remote writes require reconciliation rather than blind retries. Status checks alone do not advance content synchronization.
- Portal connection records contain only non-sensitive metadata. Merely finding a form does not constitute verified authentication. No cookies, passwords or OTPs are collected.
- Publication, editing, photo changes and visibility actions require independently verified capability evidence. Both current adapters still have **no verified V2 operations**. Management method names are extension points, not proof of working portal automation.
- Customers can inspect and queue supported lifecycle operations for selected portals; unverified operations remain action-required. Archiving refuses unresolved external listings. The private photo bucket is accessed through owner-checked publishing APIs.
- AI uses the existing OpenAI helper and key, with an audited per-owner quota. Suggestions require review and never replace text silently. Provider execution and translation quality have not been tested live.
- Existing admin authorization protects inspection, publishing pricing, audited retries and confirmed wallet refunds. Uncertain remote mutations cannot be forced through retry. Registry maintenance controls and broader administrative search remain incomplete.

## Billing policy

The default price is 10 HOMATCH credits per listing per 24-hour period, shared across destinations. Activation requires explicit consent to the server price and reserves existing wallet credits. Capture waits for verified publication on every selected destination. Failed/unverified activation releases its reservation after the verification window. Drafts are free.

Billing uses existing `wallet_reserve`, `wallet_settle`, `wallet_release` and `wallet_admin_adjust` functions. Subscription row locks, wallet idempotency keys and unique listing/period billing events prevent duplicate capture. Pricing cannot exceed previously approved daily credits without new consent. UTC timestamps define billing periods; downtime does not trigger historical back-charges.

Fully paused listings stop renewing after their paid period. Partial pauses remain billable. Insufficient balance stops new paid operations; it does not claim that remote listings were hidden. Stale remote verification also stops billing pending reconciliation. Existing pg_cron is reused only when already installed; no new service is provisioned.

The isolated PostgreSQL proof uses a **synthetic wallet boundary**. It proves publishing transaction/concurrency behavior, not full production credit-lot allocation or ledger integration. The actual wallet migration must be exercised in a safe Supabase environment before release. No production balance has been changed.

## Verification and remaining gates

Local publishing tests cover legacy MyHome/SS.ge fixtures, draft/publication validation, capability evidence, stale remote results, authenticated API boundaries and six-language copy coverage. The existing Publishing Engine CI validates PostgreSQL 17 migrations, RLS isolation, revision coalescing, competing browser leases and concurrent daily charging. Existing application CI covers TypeScript, lint, i18n, build and desktop/mobile route regressions; its latest results must be green before review approval.

A read-only production preflight found zero publishing listings/jobs/external references at implementation time; repeat this check before release. Insufficient-credit events create a durable notification using the existing notification table and the owner?s language.

Still required: authenticated portal inspection and independently verified selectors for editing, photos, pause/hide, resume, free refresh, deletion and readback; controlled publish/delete test authorization; actual wallet/ledger staging tests; registry maintenance and broader admin search; portfolio pagination; authenticated end-to-end media and AI testing. Portal capabilities must remain disabled until their individual evidence exists. Paid promotion is never a refresh fallback.

## Extension installation/update

Use the reviewed `publishing-extension` directory from the exact release commit. In Chrome open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select that directory. To update, replace the directory with the reviewed version, click **Reload** on the extension and reload HOMATCH and portal tabs. V2 reports extension version 0.3.0.

Connect each portal from Publishing → Connected platforms, authenticate directly there, return to HOMATCH and check the connection. Current adapters may correctly report action-required because authenticated session evidence has not yet been implemented/live verified. Installation is distinct from portal authentication and from capability verification.

## Coordinated release

Keep this PR draft until implementation gaps and required CI checks are resolved. Review the additive migration against existing production dependencies without applying it there. Validate it in a safe environment together with actual wallet functions. After explicit release approval, use the existing deployment architecture for the migration, publishing function, frontend and matching extension as one coordinated release, then verify the exact production SHA. Do not merge or deploy this draft automatically.
