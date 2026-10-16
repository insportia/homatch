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

## Verification matrix (2026-10-16)

| Portal | CHECK_SESSION | CREATE | STATUS | UPDATE / PRICE / DESCRIPTION / PHOTOS | PAUSE / REACTIVATE | DELETE |
|---|---|---|---|---|---|---|
| MyHome.ge | fixture-tested | fixture-tested (fills, verifies, free-publication check, submits only with live approval) | fixture-tested | not explored | not explored | not explored |
| SS.ge | fixture-tested | fixture-tested (fills and verifies; **always stops at PREPARED**) | fixture-tested | not explored | not explored | not explored |
| Place.ge, Home.ge, Brokeri.ge, Allhome.ge, Korter.ge, Binebi.ge | — | not explored | — | — | — | — |

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

## Turning it on (Phase D — needs the owner)

1. Apply migration `20261108090000_publishing_central_accounts.sql` (SQL Editor; it contains a DROP).
2. Set the edge secret `PUBLISHING_CREDENTIALS_KEY` (32 random bytes, base64).
3. Set Railway variable `PUBLISHING_AUTOMATION_ENABLED=1` on `homatch-official-worker`.
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
