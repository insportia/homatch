# Service Control Center — pausable HOMATCH services

Owner decision 2026-10-16: **Publishing, AI Call Center, AI TALK, WhatsApp, Live Chat
and Design Studio** can be paused without deleting anything, and resumed from
**Admin → System → Service Control Center** (`/admin/service-control`), with no code
change or deploy. Initial state: all six OFF.

**Expansion** (migration `20261110090000_service_controls_expand.sql`): fourteen live
products join the same table, in groups, seeded ON/ON because they are live today:
find_property, find_property_deep, find_buyers, verify, contracts, mortgage, investment,
for_expats, meta_ads, email_campaigns, ai_assistant, brokers_directory, broker_desk,
developers. The inventory (routes, entry points, gates, what keeps running, why each
platform piece has no switch) is `docs/claude/SERVICE_CONTROLS_INVENTORY.md`.

## Fail modes

| Kind | Keys | Control unreadable | Row missing | Frontend before the first answer |
|---|---|---|---|---|
| Paused by the owner | the original six (`PAUSED_BY_DEFAULT`) | refuse / hide (closed) | OFF | hidden ("busy" placeholder on its routes) |
| Paid, paused by the owner (2026-10-18) | `find_property_deep` (`PAID_CLOSED_BY_DEFAULT`) | refuse / hide (closed) | OFF | hidden; never taken from browser memory |
| Live product | the other thirteen (`LIVE_BY_DEFAULT`) | run / show (open) | ON | this browser's last answer (`localStorage` `homatch-service-visibility`), else shown |

An explicit OFF row is honoured for both. Fail-open is deliberate: an outage of the control
table must not take Verify or Find Property down. The cost: a browser that has never seen a
pause may mount a paused product's page for a moment before the answer arrives, and let it
read its own state (`capabilities`, `history`, `status`); anything that starts work is refused
by the backend.

## Brokers: two switches, hidden everywhere when off (owner, 2026-10-18)

`brokers_directory` (`/brokers`, `/brokers/:id`) and `broker_desk` (`/broker`, `/broker/onboarding`)
are separate switches. Turning a broker service's customer visibility off removes it from the
sidebar (desktop and phone drawer), the public B2B menu, the homepage Brokers section, About, the
product entry page, the AI assistant chip, AI TALK's "go to" button and the professional sign-up
option, and its addresses show "currently unavailable". This replaces the 2026-10-17 "Option A",
which left the directory public while only its sales were paused. Hiding is reversible
presentation: profiles, listings, payments and records are untouched, and Admin → Brokers stays.
The backend sales guard (refuses purchases and renewals with no charge) is unchanged.

Before this page load has read the switches, and if the first read fails, both broker services stay
hidden (`HIDDEN_UNTIL_ANSWERED`, src/lib/serviceControls/core.ts): neither a remembered answer nor
an outage brings them back. A real answer without their rows (before the migration) means live.
The backend fail mode (`LIVE_BY_DEFAULT`) is not changed by this.

## Groups

`service_group`: discovery, intelligence, marketing, communications, assistant,
professionals, design, publishing (and `other`, never pausable as a group). The Admin page
lays the cards out by group with dynamic counts. **Pause group** needs the group's key typed
(checked in the database by `service_control_pause_group`), touches only that group, and
audits each changed row as `SERVICE_CONTROL_PAUSE_GROUP`. There is no global switch:
`service_control_pause_all` is narrowed to the original six keys (its old reach) and the
Admin page no longer offers it.

## Model

| Piece | Where |
|---|---|
| State | `public.service_controls` (migration `20261109090000_service_controls.sql`): one row per service, `frontend_enabled`, `backend_enabled`, `version`, `reason`, `updated_by`, `updated_at`. CHECK: frontend ⇒ backend. RLS on, no policies; service role only. |
| Public read | `service_controls_public()`: key, frontend, backend only (anon + authenticated). |
| Writes | `service_control_set(key, frontend, backend, expected_version, reason, request_id)` → `CHANGED` / `UNCHANGED` / `CONFLICT`; `service_control_pause_all(reason, request_id)` (six keys only); `service_control_pause_group(group, confirm, reason, request_id)`. SECURITY DEFINER, `is_admin` on `auth.uid()`, every attempt in `admin_audit_log` (`entity_type = 'service_controls'`). |
| Database guard | `service_control_guard()` BEFORE INSERT on `live_chat_messages`, `live_chat_reactions`, `ds_projects` (browser-written tables) and `broker_listing_purchases` (`brokers_directory`). Raises `SERVICE_DISABLED`. |
| Edge check | `supabase/functions/_shared/serviceControl.ts`: `serviceBackendEnabled(db, key)` (service role) and `serviceBackendEnabledForCaller(db, key)` (caller's client, via `service_controls_public()`). Fail mode per key (above); 10 s cache per isolate; refusal is 503 `{code: 'SERVICE_DISABLED', service}`. |
| Admin API | `supabase/functions/service-control`: `overview` (with `group`, `failMode`) / `set` / `pause_group` / `pause_all`; admin only; activation refused `NOT_READY` (audited) while readiness lists a blocking gap; `VERSION_CONFLICT` on a stale tab. |
| Frontend | `src/lib/serviceControls` (snapshot; the six hidden until proven visible, live products as last known; refreshed every 60 s and on focus); `ServiceLink` (a link that disappears with its destination); `src/lib/serviceControls/routes.ts` (path table → `<ServiceGate>` on every matching route in `src/routes.tsx`); `src/components/serviceControls/ServiceGate.tsx` ("currently unavailable", page never mounted). |

**Propagation**: an Admin change is honoured by every edge isolate within 10 s
(cache) and by an open customer tab within 60 s or on its next focus. The database
guards are immediate.

**Effective state** (Admin card): `PAUSED` (backend off), `BACKEND_ONLY` (running,
hidden), `LIVE`, `DEGRADED` (switched on but readiness lists a blocking gap).

## Activation sequence (enforced)

1. Admin turns **backend** on. The server computes readiness; any blocking gap →
   `NOT_READY` with the list, nothing changes, the refusal is audited.
2. Health is reported back (readiness after the change).
3. Admin turns **frontend** on (impossible while the backend is off: UI disables it,
   the function refuses `FRONTEND_REQUIRES_BACKEND`, the table CHECK forbids it).

Disabling is never readiness-gated. **Pause** (per service) and **Pause group** drop
both switches at once. Turning a live product off warns that customers are using it.

## Entry points, per service

### Publishing (`publishing`)
- **Refused while paused**:
  - `publishing-engine`: every customer action, and every admin action except the read-only views (`admin.providers`, `.publications`, `.accounts`, `.queue`, `.job.get`, `.operations`).
  - `publishing-worker`: `claim` (503), and `submitting` (`{ok:false}`, so the submit door stays shut).
- **Still running**: heartbeat/finish of in-flight operations, which can only end PREPARED/FAILED, never submitted; screenshot housekeeping.
- **Hidden**: sidebar item; `/publishing*` and `/property/publish`; the property page Publish button; My Properties "Publish this property".
- **Not touched**: the Railway runner (already inert without `PUBLISHING_AUTOMATION_ENABLED=1`), migration `20261108090000` (still unapplied), all records and code.

### AI Call Center (`ai_call_center`)
- **Refused while paused**:
  - `comm-agent` (all actions);
  - `comm-campaign-launch` (test calls, and AI_CALL launch/preview, before anything is queued or reserved);
  - `comm-dispatch-worker` (skips AI_CALL campaigns; their sends stay PENDING);
  - `outreach-send` (AI_CALL);
  - `voice-ai` `preview` (agent voice previews).
- **Still running**: `voice-webhook` and `retell-webhook`, so in-flight calls close and their costs and records are written.
- **Hidden**:
  - the sidebar item, `/outreach/calls*` and `/outreach/agents*`;
  - the comms rails;
  - the homepage call-center section, launcher tile, About card and footer link;
  - the developer lead and marketing links;
  - campaign builder AI_CALL, the campaigns AI_CALL tab, "view calls";
  - the contact "Call" button, overview modules, agent setup step and agents panel.
- E-mail and SMS campaigns are not affected.

### AI TALK (`ai_talk`)
- **Refused while paused**: `ai-talk-session`, every action except `end` (start, listen tokens, converse/LLM/TTS, heartbeat, previews); `voice-ai` `speech-probe`.
- **Hidden**: the homepage hero AI TALK panel, which is not mounted at all.
- **Not touched**: voice configuration, Cartesia settings, `ai_talk_enabled`, tuning and history.

### WhatsApp (`whatsapp`)
- **Refused while paused**: `whatsapp-send` (all outbound); `comm-campaign-launch` (WHATSAPP); `comm-dispatch-worker` (WHATSAPP skipped).
- **Still running**: `whatsapp-webhook` keeps recording every inbound message, status, opt-out and template event; only its owner notifications are muted while WhatsApp is hidden. `whatsapp-sync` (admin read of Meta config) also runs.
- **Hidden**: the sidebar item, `/outreach/whatsapp*`, comms rails, overview modules, the campaign builder channel and tab, the contact WhatsApp button, and the developer links.
- **Not touched**: Meta Ads click-to-WhatsApp (its own `meta_ads_whatsapp_enabled`); WhatsApp handles shown for owners, brokers or leads.

### Live Chat (`live_chat`)
This is the community room at `/live-chat`. It is not a support inbox and makes no AI replies.
- **Refused while paused**: new messages and reactions, by the database guard.
- **Still readable**: history, reports and moderation.
- **Hidden**: the sidebar item, the desktop header item, the bottom-bar slot (the bar reflows) and the route.
- **Not touched**:
  - private messages (`/chat`, `send-message`, `conversations`/`messages`);
  - the WhatsApp/Email inbox;
  - the AI assistant;
  - `ingest-live-chat` / native-intent cron, which simply finds no new rows.

### Design Studio (`design_studio`)
- **Refused while paused**:
  - every start route in `design-studio-reconstruct`: readings, design, spec, quote, renders, edits, factory, QA, walkthrough create/retry/geometry, and the self-invoked design-spec chain;
  - `design-studio-model` inspection;
  - new projects (database guard on `ds_projects`).
- **Still running**, because they finish, settle or release already-reserved work: `render-status`, `render-generate-step`, `factory-status`, `factory-discard`, `walkthrough-status`, `walkthrough-tick` (pg_cron), and `project-delete`.
- **Hidden**: the sidebar item, `/design-studio*`, and the property page "Open in Design Studio". The build flag and admin bypass were removed; the switch is the only authority.
- **Kept on purpose**: the public share viewer (`/w/:token`, `/d/:token`). It is read-only and makes no provider calls, and links customers already sent keep working.

## Drain and resume policies
- **No new work.** Nothing already running is killed. Running work finishes through the routes and webhooks that stay open.
  - AI TALK sessions stop at their next request.
  - A Google speech-to-text socket already open on the Railway worker lasts at most its own cap (15 min). The worker cannot read the switch; this is a documented limit, so no new worker secret was added.
- **Queued work is not lost or restarted.** Paused campaigns keep their PENDING sends. On resume, the existing claim/lease protocol delivers each send once. Nothing failed or cancelled is retried automatically.
- **Publishing**:
  - an operation past its submit door is never re-run (RECONCILIATION_REQUIRED);
  - a paused claim queues nothing new;
  - on resume, queued operations are claimed only if automation is also on for that portal.
- **Design Studio**: reservations of in-flight renders settle only through the status routes, which stay open. (Production had none open at pause time, 2026-10-16.)

## Readiness (what NOT READY means)
Readiness is computed in `supabase/functions/service-control/readiness.ts`. It reports names only, never secret values.
- **Blocking**:
  - **Publishing**: its schema.
  - **AI TALK**: `CARTESIA_API_KEY` and `OPENAI_API_KEY`.
  - **AI Call Center**: `VAPI_PRIVATE_API_KEY`, and the TELEPHONY/VAPI route not killed.
  - **WhatsApp**: `META_WHATSAPP_*`, and the MESSAGING/META route not killed.
  - **Live Chat**: its table.
  - **Design Studio**: OpenAI, RunPod and R2 configuration (through `objectStore.envReport()`).
- **Notes** (not blocking):
  - each service's own switches: `ai_talk_enabled`, `billable_products` pricing, the Design Studio billing switch;
  - Publishing's pending central migration, worker token and credentials key.

## Verification
- SQL: `bash tests/sql/service_controls/run.sh` (43 checks, plus refusal of a second apply);
  `bash tests/sql/service_controls_expand/run.sh` (the six untouched, twenty rows, groups, group
  pause confirmation and audit, pause-all reach, broker guard).
- Edge:
  - `supabase/functions/_shared/__tests__/serviceControl.test.mjs`
  - `supabase/functions/service-control/__tests__/*.mjs`
  - the Publishing handler and worker pause tests
- Frontend: `src/lib/serviceControls/__tests__/core.test.mjs`, `tests/matrix/serviceControlsExpand.test.mjs`, plus the browser suites (fixtures put the six ON where a suite exercises them, and an OFF test asserts the hiding).
- Browser, expansion: `tests/mobile/serviceControlsExpand.test.mjs`. It covers:
  - all fourteen OFF: the sidebar, phone bar, home page, direct URLs and platform pages;
  - ON again;
  - before the migration;
  - an unreadable control table;
  - the Admin groups and the typed group pause.
