# Where real intent already exists in Homatch

Read from the database and the repository, not from a list somebody wrote down. Every row
below was confirmed against `information_schema`, `pg_class`, the route table and the page
that writes it.

This is an engineering document. None of it is customer-facing vocabulary.

## The surfaces that can express intent

| Surface | Canonical name | Persisted as | Actor | Property context | Status |
|---|---|---|---|---|---|
| Common live chat | `LIVE_CHAT` | `live_chat_messages` | `user_id` | none — resolved from a verified six-digit reference | **SEMANTICALLY INTERPRETED** — `ingest-live-chat` |
| Private message | `PRIVATE_MESSAGE` | `messages` → `conversations` | `sender_id` | **`conversations.property_id`** | **DETERMINISTIC CONTEXT + SEMANTIC MEANING** — `send-message` |
| Viewing request | `VIEWING_REQUEST` | `viewing_requests` | `requester_id` | `property_id` | **DETERMINISTICALLY MAPPED** — `viewing-request` |
| Find Property | `SEARCH_PLAN` | `intent_profiles` + `active_search_subscriptions` | subscription `user_id` | — | **DETERMINISTICALLY MAPPED** — `find-property-plan` |
| AI Chat | `AI_CHAT` | `ai_messages` → `ai_conversations`; extraction in `ai_chat_leads` | `ai_conversations.user_id` | none | **RESERVED, NOT YET INGESTED** — see below |
| Property creation | — | `properties` (+ `search_profiles`) | `user_id` | itself | **ALREADY CANONICAL SUPPLY** — it is the entity, not evidence about one |

### AI Chat is reserved rather than wired, and that is a decision

`ai_chat_leads` holds 28 real extractions with a transaction, a location, a budget and a
confidence. What it never captured is **who was speaking about whom**, **how wide the
statement reached**, and **whether a constraint was a rule or a preference** — the three
fields that decide whether a signal is safe to act on.

Mapping them would mean inventing those three. A row whose attribution nobody recorded
cannot be assumed to be SELF, because the one that is not is the one that tells an owner
somebody is interested who was talking about their brother. So the surface is declared,
the historical rows keep their provenance, and the backfill is a separate job that reads
the original conversations rather than guessing from the extraction.

### What `live_chat_messages` already gives us, for free

`reply_to_id`, `edited_at`, `deleted_at`. Reply attribution and edit/delete re-evaluation
are not features to be invented — the columns exist and carry real semantics. A quoted
requirement must stay attributed to whoever wrote it, and a message that is edited or
deleted must not leave a strong intent standing behind it.

### What `conversations` already gives us

`property_id` **and** `match_id`. When somebody writes "is this still available" inside a
property conversation, which property they mean is a column, not a question for a language
model. Deterministic context outranks semantic guessing, and here it exists.

## Already an extraction, and that is the problem

`ai_chat_leads` holds **28 real rows** with `transaction_type`, `property_type`,
`location_text`, `budget_min/max`, `currency`, `bedrooms`, `timeline`, `confidence`.

It is a per-surface intent model, built for one page, and it cannot express:

- which **side** the person is on
- whether they were speaking about **themselves**
- the **scope** of what they said
- **REQUIRED vs PREFERRED**
- a **property** reference
- **positive vs negative**

So it is a legitimate SOURCE and not a canonical model. The canonical layer absorbs it
rather than standing beside it — which is exactly the proliferation the architecture is
meant to stop, caught before there were five of them.

## Not intent, and must never become it

`activity_events` is product telemetry. Its enum is
`MORTGAGE_PAGE_OPENED, INVESTMENT_PAGE_OPENED, MORTGAGE_CALCULATED, …` — opening a page,
running a calculator, comparing terms. Alongside it: `pwa_events` (1,175 rows),
`usage_events`, `promotion_funnel_events`, `rate_limit_events`, `dt_events`,
`matching_job_events`, `cost_events`, `voice_usage_events`, `*_lifecycle_events`.

None of these may produce a customer-facing claim that a person is interested in a
property. They are worth nothing to matching and everything to operations.

**There is no `PROPERTY_VIEWED` event and no viewer identity anywhere in the schema**, so
the "User X looked at your property" failure is not merely forbidden — it has no data to
be built from. Stated here so nobody adds the column later thinking it is wanted.

## No favourites exist

Searched for `favorite`, `favourite`, `saved`, `bookmark`, `shortlist`, `wishlist`,
`watch`. **No table.** Saves are therefore out of scope as a signal — not deprioritised,
absent. Nothing here invents one.

## Out of scope, deliberately

| Surface | Why |
|---|---|
| `comm_messages`, `comm_conversations`, `comm_extractions` | The outreach domain. The owner talking **to external contacts** through WhatsApp, email and voice — keyed on `auth.users`, not a native user↔user relationship. Already has its own extraction for its own purpose. |
| `deal_room_*` | Verify. Frozen, and stays frozen. A completion event may notify; nothing here reads or changes it. |
| `comm_talk_sessions` | AI TALK, the homepage voice demo. A separate workstream. `docs/communications.md` records that AI Chat is a different product from AI TALK; this touches neither. |
| `social_posts` | Owner-authored promotion of their own listing. Supply that is already canonical — the property exists. |
| `partner_inquiries` | A public form, no authenticated actor. |
| `external_contact_unlocks` | A billing event on external intelligence, not an expression of requirements. |

## The shape this implies

One canonical signal, many sources. Each source contributes a **reference** to its own
event — never a copy of the text — and normalises into the same structure the matcher
already understands.

```
live_chat_messages ─┐
messages ───────────┤
viewing_requests ───┼──> intent_signals ──> effective demand / supply / interest
ai_messages ────────┤      (canonical)           │
intent_profiles ────┘                            └──> assessMatch() ──> supply_matches
properties ─────────────────────────────────────────────────┘
```

No second matcher. No per-surface intelligence. No copied message bodies.
