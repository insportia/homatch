# Homatch AI Communications Hub

What this subsystem is, where each decision lives, and what has to be true
before it can be switched on.

No secret values appear in this file. Where a credential matters, only its
NAME is given.

---

## 1. What it replaced, and what it did not

Outreach was four cards that said "disabled". It is now one product area:
AI calling, WhatsApp, agents, campaigns, contacts, analytics.

Nothing that worked was forked:

| Concern | Where it lives | What changed |
|---|---|---|
| Campaigns, contacts, lists, sends | `outreach_*` | Widened. New columns, wider CHECK constraints. No data moved. |
| Wallet, credits, reservations | `credit_*`, `usage_*`, `_shared/billing.ts` | Untouched. Reached only through `beginExecution` / `settleExecution` / `releaseExecution`. |
| Provider COGS, margin, reconciliation | `finance_provider_*` | Two product rows added. The existing double-count guard is used, not replaced. |
| Durable jobs | `background_jobs` | Two new `product_type` values, one new `subject_type`. |
| AI Chat | `ai_conversations`, `ai_messages` | Untouched. AI Chat is a separate product and AI TALK does not replace it. |

Twelve tables are new. Each carries the reason it had to be new in a comment
immediately above it in
`supabase/migrations/20260912110000_communications_hub.sql`.

---

## 2. The one rule that shapes everything

**A frontend check is not enforcement.**

The real-estate boundary, the risk engine, the cost engine and the provider
status maps all run twice:

- `src/lib/comm/*` — the browser, so the campaign builder can preview a verdict
  and an estimate without a round trip.
- `supabase/functions/_shared/comm/generated/*` — the server, which decides.

They genuinely exist twice on disk because Vite cannot bundle from
`supabase/functions` and Deno cannot read `src/`. So the edge copies are
**generated**:

```
node scripts/sync-comm-domain.mjs          # regenerate
node scripts/sync-comm-domain.mjs --check  # CI: fail if they drift
```

A test (`src/lib/comm/__tests__/researchAndContracts.test.mjs`) runs the
`--check` form, so an edit to the browser copy that forgets the server copy is
a red build rather than a campaign allowed in one place and blocked in the
other.

---

## 3. Architecture

```
                       ┌────────────────────────────┐
  browser              │  comm-campaign-launch      │
  campaign builder ───▶│  action: preview | launch  │
                       └────────────┬───────────────┘
                                    │ decideLaunch()   _shared/comm/policy.ts
                 ┌──────────────────┴───────────────────┐
                 │ ownership → eligibility → domain →   │
                 │ compliance → risk → trust →          │
                 │ provider health → spend/balance      │
                 └──────────────────┬───────────────────┘
                                    │ writes comm_risk_assessments (always)
                                    ▼
                    comm_enqueue_campaign()   one send row per contact,
                                              deterministic idempotency key
                                    │
                                    ▼
                       ┌────────────────────────────┐
       pg_cron /  ────▶│  comm-dispatch-worker      │
       worker tick     │  claims a batch, executes  │
                       └───────┬────────────┬───────┘
                               │            │
                    createMetaProvider   createVapiProvider
                               │            │
                          Meta Cloud     Vapi (PSTN)
                               │            │
                       whatsapp-webhook  voice-webhook
                               └─────┬──────┘
                                     ▼
                    dedup → normalise status → extract → cost → settle
```

### Edge functions

| Function | JWT | What it does |
|---|---|---|
| `comm-campaign-launch` | required | Runs the gate. `preview` writes only an assessment; `launch` enqueues, reserves and sets RUNNING. |
| `comm-dispatch-worker` | internal | Claims sends and executes them. Re-evaluates the kill switch between batches. |
| `whatsapp-webhook` | **disabled** | Meta cannot present a JWT. Verifies `X-Hub-Signature-256` itself. |
| `whatsapp-send` | required | The only application path that sends a WhatsApp message. |
| `whatsapp-sync` | admin or internal | Pulls template status and account facts back from Meta. |
| `voice-webhook` | **disabled** | Call lifecycle from Vapi. Verifies a shared secret when one is configured. |
| `comm-agent` | required | Generate, publish, preview and live-test an agent. |
| `cartesia-access-token` | required | Short-lived browser grant for in-product voice. Rate limited. |
| `ai-talk-session` | required (anon key) | The homepage demo's allowance, grant and consumption ledger. |
| `comm-provider-status` | admin | Read-only provider health. Never sends anything. |

### The auth matrix (§140)

- **User-invoked** — JWT required, and the user id comes from the *verified
  token*. A `userId` in a request body is attacker-controlled and is ignored
  everywhere.
- **Provider webhook** — JWT disabled, because the provider cannot present one.
  Permitted **only** because the body implements its own verification.
- **Internal worker** — a shared secret (`WORKER_TOKEN`), compared in constant
  time. Absent secret means refuse, never means allow.
- **Admin** — JWT, then `public.is_admin()` evaluated in Postgres for that
  token. Never a claim the client sent.

---

## 4. The races, and where they are closed

All four are closed in SQL, in `20260912110500_communications_functions.sql`.
None of them is closed in TypeScript, because a `SELECT` followed by an
`UPDATE` loses every one of them under load while passing every test.

| Race | Closed by |
|---|---|
| Two workers place the same call | `comm_claim_sends` — one `UPDATE`, `FOR UPDATE SKIP LOCKED` |
| A redelivered webhook charges twice | `comm_claim_webhook_event` — unique index on `(provider, event_key)` |
| Two launches enqueue the same contact | unique index on `outreach_sends.idempotency_key` |
| AI and a human both reply | `comm_set_conversation_mode` — conditional update on the expected mode |
| A retry overlaps a live attempt | the lease in `next_attempt_at`, reclaimed by `comm_reclaim_stale_sends` |

**Out-of-order webhooks.** Meta delivers `sent` after `read` often enough that
it is designed for: `comm_apply_message_status` ranks the states and refuses to
move a message backwards. Calls do the same through
`isForwardCallTransition`.

---

## 5. Money

```
raw eligible COGS  +  markup  +  tax  =  customer charge
```

No number in the code is a rate. Markup comes from `billable_products`, tax
from `admin_settings.tax_rate_bps`, provider rates from
`finance_provider_prices`. 18% VAT is current commercial modelling, not a
constant.

**The double-count guard.** Vapi reports a total *and* its parts. Summing
everything it returns overstates every call by roughly a factor of two — in the
direction that looks healthy. `computeCogs()` drops any component that declares
itself `bundledWith` a component that is also present, and the dropped lines
are written to `finance_provider_cost_events` with
`counts_as_cogs = false, is_double_count_guard = true` so a breakdown can still
show them while the roll-up ignores them.

**Order of truth** (§44): provider invoice → provider actual → configured price
→ fallback estimate. `isBetterCostSource()` enforces it; an estimate never
overwrites a measured actual.

**Reserve and capture.** The hold is the *maximum*, not the expectation — a
hold that only covers the likely cost runs out mid-campaign. Unused amounts are
released.

---

## 6. The real-estate boundary

Four stages, and only the last one costs money:

1. **RULE** — structure settles it. An agent on a real-estate template, or a
   campaign bound to a `property_id`, is real estate by construction. A
   prohibited term still blocks it.
2. **KEYWORD** — weighted evidence in six languages.
3. **CLASSIFIER** — a local score over that evidence.
4. **LLM** — only what stages 1–3 could not settle.

Two properties that are tested rather than assumed:

- A model can **never** overturn a deterministic BLOCK. The text being judged
  is written by the person being judged, so prompt injection through a campaign
  description is a live attack surface.
- `"investment opportunity"` alone is **not** evidence of real estate, and
  piling property vocabulary around a prohibited word does not rescue it.

---

## 7. Voice

**Cartesia's agents websocket carries four events — `ack`, `media_output`,
`clear`, `transfer_call` — and no transcript.** That was checked against the
API reference, and it decides the architecture: the microphone feeds two
sockets at once.

```
mic ──┬──▶ wss://api.cartesia.ai/agents/stream/{agentId}   the conversation
      └──▶ wss://api.cartesia.ai/stt/websocket             the visible words
```

The second stream costs a little STT and is what makes a partial *revisable*
rather than appended — §24's named failure.

One base Cartesia agent serves every Homatch agent. `start.agent.system_prompt`,
`start.agent.introduction` and `config.voice_id` are per-session overrides, so
`comm_agent_versions` stays the only source of truth and no mutable agent
object is left behind at the provider.

**Turn taking.** `decideEndpoint()` waits longer after `და` than after a full
stop, and never ends a turn below a 260 ms floor. **Language** stabilises on
script evidence rather than locking on the first 200 ms. **Barge-in** ducks
before it stops, and ignores the agent's own first syllable when echo
cancellation is not trustworthy.

Admin tuning lives in `admin_settings.comm_voice_tuning`. Only settings a
provider actually supports are exposed; there are no placebo controls.

---

## 8. Secrets, by name only

Already present and verified working:

```
CARTESIA_API_KEY                    live, 200
VAPI_PRIVATE_API_KEY                live, 200
META_WHATSAPP_ACCESS_TOKEN          present
META_WHATSAPP_PHONE_NUMBER_ID       present
META_WHATSAPP_BUSINESS_ACCOUNT_ID   present
OPENAI_API_KEY                      used for stage 4 and extraction
```

Required before the corresponding capability works:

```
META_WHATSAPP_APP_SECRET      inbound WhatsApp. Without it the webhook
                              returns 503 and processes nothing. It does NOT
                              fall back to trusting the caller.
META_WHATSAPP_VERIFY_TOKEN    the GET subscription handshake.
VAPI_WEBHOOK_SECRET           call events are accepted without signature
                              verification until this is set, and Admin
                              reports the provider as DEGRADED, not HEALTHY.
```

---

## 9. Production readiness for WhatsApp

A working test number is **not** a production sender, and every screen that
shows one says so.

Before production:

1. A dedicated business number that is not already registered on WhatsApp.
   Never a personal number.
2. A long-lived or system-user access token. A temporary token expires within
   24 hours — which is exactly what happened to the current one.
3. Business verification with Meta, where required for the account.
4. `META_WHATSAPP_APP_SECRET` and `META_WHATSAPP_VERIFY_TOKEN` set, and the
   webhook subscribed at
   `https://<project>.supabase.co/functions/v1/whatsapp-webhook`.
5. At least one APPROVED template, so a conversation can be started at all.

`comm_channel_accounts.environment` carries `TEST` or `PRODUCTION` and is what
the UI reads. It is never inferred.

---

## 10. Testing

```
pnpm lint          type-check, biome, .rules, tailwind, i18n, tests, build
pnpm test          1813 tests
pnpm check:edge    parses every edge function
pnpm test:worker   the Railway worker
pnpm i18n:all      coverage, key existence, hardcoded-string audit
pnpm build
node --test tests/mobile/heroMobile.test.mjs   real 320/375/390/430 viewports
```

Provider smoke tests are read-only and free. There is deliberately no "send me
a test message" button: a test that costs money is a test people learn not to
press, and one that messages a real number eventually messages the wrong one.

---

## 11. Applying the schema

The two migrations are **in the repository and not applied**. `supabase db push`
is knowingly broken against this project (documented in `.github/workflows/
deploy.yml`), so they are applied deliberately, in order:

```
20260912110000_communications_hub.sql       tables, columns, RLS
20260912110500_communications_functions.sql the SQL the races depend on
```

Both are additive: new tables, nullable or defaulted columns, and CHECK
constraints that only widen. A test asserts that every value legal before the
migration is still legal after it, and that no added column is `NOT NULL`
without a default — so the schema can be applied before the frontend merges
without breaking the frontend already in production (§146).
