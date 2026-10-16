# Publishing — backend browser automation

HOMATCH publishes a listing entered once in HOMATCH onto the external portals through
**HOMATCH's own portal accounts**, driven by **our own Playwright code** in the existing
Railway worker (`homatch-official-worker`). No paid browser agent, and no new service.
The admin queue (manual posting) is the fallback for everything the worker cannot yet do.

## Flow

```
customer: Publish to Selected Portals (consent)
  └─ publishing-engine  publication.publish → job QUEUED + publishing_operations CREATE
        (only when: portal has a browser adapter, the owner switched automation ON,
         and the account's captured session was verified on the real portal)
Railway worker (PUBLISHING_AUTOMATION_ENABLED=1)
  └─ publishing-worker  claim → lease, decrypted session, listing copy, signed photo URLs
       └─ fresh isolated Chromium context with the session → portal adapter
            OPENING → FILLING → UPLOADING → VERIFYING → [submit door] → SUBMITTING → CONFIRMING
       └─ heartbeat every 30 s (stage = customer-visible progress), screenshots → private bucket
  └─ publishing-worker  finish →
        SUCCEEDED + portal URL      → job VERIFYING → public page check → PUBLISHED
        PREPARED (no live approval) → admin queue ("filled automatically, not submitted")
        AUTH_REQUIRED               → account SESSION_EXPIRED, job waits (AUTH_REQUIRED)
        failure before submit       → retried with backoff (60 s · 2^n, max 3 attempts)
        anything after submit       → RECONCILIATION_REQUIRED → admin queue, NEVER resubmitted
```

**Never twice.** `publishing_op_mark_submitting` sets `submit_started_at` once, before the
portal's final publish click. A crash, lost lease or error after that point turns the
operation into `RECONCILIATION_REQUIRED`; no retry path can click publish again.

**Isolation.** One browser per worker process; one fresh context per operation; the
database allows one running operation per portal account; contexts are closed after use.

**Sessions.** The owner signs in by hand with `node scripts/publishing/capture-session.mjs
<portal>` (a visible browser; password, SMS and CAPTCHA are typed by the owner on the portal
itself). Only portal-domain cookies are sent; `publishing-engine` seals them with AES-256-GCM
(`PUBLISHING_CREDENTIALS_KEY`, edge secret). The worker gets the decrypted session only inside
a claimed operation, keeps it in memory, and sends refreshed cookies back to be re-sealed.
"Connected" is set only by the worker's CHECK_SESSION against the real portal.

**Sync.** `listing.save` on a listing with a live HOMATCH-account copy queues PRICE /
DESCRIPTION / PHOTOS / UPDATE where the portal's adapter supports that operation; otherwise
the admin queue shows the copy as outdated. Unpublish queues DELETE where supported.

## Capability matrix (2026-10-16)

VERIFIED = performed on the live portal · IMPLEMENTED BUT UNVERIFIED = adapter code exists and
passed real-Chromium fixture tests only · NOT IMPLEMENTED = no recorded workflow, the worker refuses
it (`OPERATION_NOT_EXPLORED`) and the copy goes to the admin queue — **the manual admin fallback is
not automation**.

| Operation | MyHome.ge | SS.ge |
|---|---|---|
| Session check | IMPLEMENTED BUT UNVERIFIED | IMPLEMENTED BUT UNVERIFIED |
| Create | IMPLEMENTED BUT UNVERIFIED (fills, verifies, free-publication check; submits only with live approval) | IMPLEMENTED BUT UNVERIFIED (fills and verifies; **always stops at PREPARED** — publish control not recorded) |
| Status (public page check) | IMPLEMENTED BUT UNVERIFIED | IMPLEMENTED BUT UNVERIFIED |
| Edit | NOT IMPLEMENTED | NOT IMPLEMENTED |
| Price update | NOT IMPLEMENTED | NOT IMPLEMENTED |
| Description update | NOT IMPLEMENTED | NOT IMPLEMENTED |
| Photo replacement | NOT IMPLEMENTED | NOT IMPLEMENTED |
| Pause | NOT IMPLEMENTED | NOT IMPLEMENTED |
| Reactivate | NOT IMPLEMENTED | NOT IMPLEMENTED |
| Delete | NOT IMPLEMENTED | NOT IMPLEMENTED |

Place.ge, Home.ge, Brokeri.ge, Allhome.ge, Korter.ge, Binebi.ge: every operation NOT IMPLEMENTED.

"Fixture-tested" = the adapter ran in real Chromium against local pages rebuilt from the
recorded controls (`official-worker/test/publishingAdapters.test.mjs`). **No operation has
run against a live portal**: this build environment's network policy blocks every portal
domain. Levels live in `official-worker/src/publishing/capabilities.ts` and
`supabase/functions/publishing-engine/automation.ts` (parity-tested) and are raised only with
the evidence their name states.

## Where the selectors came from

The owner's MCP exploration, as committed in `publishing-extension/adapters/{myhome,ssge}/adapter.js`
(commits `805ec2c5`, `fa1220c7`; removed from the tree in `32fee61f`). The SS.ge adapter cites
recording steps 63, 97–104, 184, 210 and 216 of a sanitized 317-action recording with 81
candidate selectors. **That recording itself was never committed** and is not available to
this session; nor is any MyHome raw exploration beyond the distilled adapter.

## Exactly what is missing (needed from the owner's MCP exploration)

MyHome.ge
1. Live confirmation of the photo-upload completion marker (the recorded adapter used
   `[data-upload-status="complete"]` / `[data-testid="uploaded-photo"]` as an unconfirmed guess).
2. The currency control for GEL / EUR (only USD is mapped), and the condition / amenity / bathroom controls.
3. Property types other than apartment (house, land, commercial, …).
4. The account's listing-management page: edit, price change, description edit, photo
   add / remove / reorder, deactivate / reactivate, delete — URLs, buttons, confirmation dialogs.

SS.ge
1. The navigation from `home.ss.ge` to the creation form (the configured create URL is the
   section page, not the form — CREATE stops with `CREATE_NAVIGATION_NOT_RECORDED` until set).
2. The photo-upload completion marker.
3. The free-publication control, the result page and how its URL carries the listing id.
4. The management workflows (as for MyHome).

Other six portals: everything (login, form, submission, management). Korter.ge's terms
forbid automated access and Binebi.ge shows a bot challenge on every page — both stay manual.

## Security model (audited 2026-10-16)

- **Screenshots** go to the private bucket `publishing-artifacts`, registered in
  `_shared/storage/keys.ts` as an ADMIN-only FLAT namespace. There is no `storage.objects`
  policy and no `storage_authorize` branch for it, so every browser caller is refused.
  Only the service role writes them (`publishing-worker`, signed upload) and reads them
  (`publishing-engine admin.operations`, after `is_admin()` on the caller's own token,
  10-minute signed URLs). Customers only ever see an operation's status and stage.
- **No secrets in captures**: nothing is typed into password / OTP fields, and every
  capture paints those inputs over (`captureMasked`, proven by a byte-identical-image test).
  Stored errors are codes only — a decrypt/JSON failure can no longer quote session text
  into `last_error` (found and fixed in this audit; regression-tested).
- **Retention**: 30 days; a deleted listing's screenshots at once (`operation_id` is set
  null, not cascaded, so they stay findable). Hourly housekeeping removes the storage
  object first, then exactly its row; a storage failure forgets nothing.
- **Worker door**: its own secret `PUBLISHING_WORKER_TOKEN` (edge secret + the same value as a
  Railway variable), compared in constant time. The `WORKER_TOKEN` that `verify-queue` and
  research share is never accepted and was not changed; while the publishing secret is unset
  (or shorter than 32 characters) the door answers 503 `PUBLISHING_WORKER_NOT_CONFIGURED` to
  everyone and the Railway runner refuses to start. Regression-tested on both sides.
- **Sessions**: AES-256-GCM with the portal id as additional data; decrypted only into the
  claim of an operation on that portal; refreshed cookies are pinned to the portal's domains
  before re-sealing; never logged.

## Migration safety (`20261108090000_publishing_central_accounts.sql`)

- **Dropped and recreated**: only the CHECK `publishing_engine_jobs_status_check` (the
  8 v1 statuses → the same 8 plus 6 central ones). Everything else is additive; the two v1
  functions are `create or replace` with the same signatures and grants.
- **Production state measured read-only (2026-10-16)**: 0 rows in `publishing_engine_jobs`;
  no triggers or views depend on it; its constraints and all four publishing function
  bodies are byte-identical (md5) to the local test chain.
- **Proof** (`tests/sql/publishing/rollback.sh`, on that production-identical chain): applies
  in one transaction; an existing v1 publication keeps its status and becomes an owner
  handoff; a second apply is refused atomically; `docs/publishing/rollback-20261108090000.sql`
  restores every function / constraint / column / grant / bucket fingerprint and keeps the
  publication. The rollback refuses to run once any central publication or operation exists.
- **Locks**: ALTER TABLE takes ACCESS EXCLUSIVE on `publishing_engine_jobs` for the
  constraint swap and the metadata-only column adds — milliseconds at 0 rows.

## Real-browser dry run (owner, on a computer that can reach the portal)

```
cd official-worker && npm ci
npx tsx scripts/publishing-dry-run.ts myhome --photo test1.jpg --photo test2.jpg
npx tsx scripts/publishing-dry-run.ts ssge --inspect
```
You sign in to the HOMATCH account in the visible window yourself. The dry run runs the
SAME adapter code as the worker, never presses Publish (live approval false and the submit
door always closed), and writes masked screenshots, `result.json` and control inventories
(labels / names / buttons — never values) to a local folder. `--inspect` never clicks: you
navigate (SS.ge: to the creation form, through photos, to the final publish step) and record
each page. Send the folder back; the missing selectors are derived from it, and each
capability level is raised only with that evidence.

## Turning it on (Phase D — needs the owner)

1. Apply migration `20261108090000_publishing_central_accounts.sql` (SQL Editor; it contains a DROP).
2. Set the edge secrets `PUBLISHING_CREDENTIALS_KEY` (32 random bytes, base64) and
   `PUBLISHING_WORKER_TOKEN` (≥ 32 random characters, e.g. `openssl rand -hex 32`).
3. Set Railway variables `PUBLISHING_WORKER_TOKEN` (same value) and
   `PUBLISHING_AUTOMATION_ENABLED=1` on `homatch-official-worker`.
4. Admin → Integrations → Property portals → MyHome.ge: register the HOMATCH account
   (identity + phone; the phone must already be verified on MyHome), then run
   `capture-session.mjs myhome` and wait for "verified on the portal".
5. Switch **automation** on (live publishing still off). Publish a controlled test listing:
   the worker fills everything and stops at PREPARED — inspect the READY_TO_SUBMIT screenshot.
6. Only with the owner's explicit approval: switch **live publishing** on, publish one
   controlled test listing, confirm the created URL, then remove it on the portal.
   Record the result and raise the level to LIVE_OPERATION_VERIFIED in both capability tables.

Confirm first that MyHome.ge's and SS.ge's terms permit automated posting from the owner's own
account; the switch is the owner's decision and is audited.
