# Communications Hub — go-live checklist

Branch `feat/ai-communications-hub`, frozen at `4dd4d251`. Nothing here has been
executed. Every fact below was read from the repository or from a read-only
query against production on 2026-09-12.

---

## A. OWNER ACTIONS

### A1. The migration

Two files, applied in this order. The order is their filename order and the
CLI enforces it — the second depends on tables the first creates.

```
1  supabase/migrations/20260912110000_communications_hub.sql   (12 tables, RLS, seeds)
2  supabase/migrations/20260912110500_communications_functions.sql  (13 functions)
```

Applied by the existing workflow, which is the only path that also repairs the
historical migration ledger:

```
GitHub → Actions → "Deploy Homatch" → Run workflow
  branch: main          ← only after the merge in section C
  run_migrations: true  ← this input exists precisely because it is disabled on push
```

**What it does to tables that already exist.** Six CHECK constraints are dropped
and re-added wider, and columns are added to `outreach_campaigns`,
`outreach_sends`, `outreach_contacts`, `outreach_contact_lists` and
`background_jobs`. All additive; every added column is nullable or has a
default.

Verified against production, not assumed — each current constraint is a strict
subset of its replacement:

| Constraint | Now | After | Added |
|---|---|---|---|
| `outreach_campaigns_campaign_type_check` | 6 values | 7 | `WHATSAPP` |
| `outreach_campaigns_status_check` | 8 | 11 | `REVIEW_REQUIRED`, `APPROVED`, `COMPLIANCE_PAUSED` |
| `outreach_sends_channel_check` | 3 | 4 | `WHATSAPP` |
| `outreach_sends_status_check` | 14 | 17 | `RINGING`, `READ`, `CANCELLED` |
| `background_jobs_product_type_check` | 9 | 11 | `WHATSAPP_CAMPAIGN`, `AI_TALK` |
| `background_jobs_subject_type_check` | 5 | 6 | `CAMPAIGN` |

**Lock risk: none worth planning around.** `outreach_campaigns`,
`outreach_sends`, `outreach_contacts` and `outreach_contact_lists` all hold
**0 rows** in production today; `background_jobs` holds 1. There is no
existing row that can violate a new constraint and nothing to rewrite.

**Collision risk: none.** Production has 0 tables matching `comm_%` and 0
functions matching `comm_%`. Every seeding insert is `on conflict do nothing`.

### A2. Verification after the migration

Run as a single read-only block. Every line should report what the right-hand
column says.

```sql
-- 1. All 12 tables exist
select count(*) as tables_created
from information_schema.tables
where table_schema = 'public' and table_name like 'comm\_%';
-- expect: 12

-- 2. All 13 functions exist
select count(*) as functions_created
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'comm\_%';
-- expect: 13

-- 3. RLS is ON for every one of them. A table with RLS off is readable
--    by any signed-in customer, which for comm_messages is everyone's
--    conversations.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename like 'comm\_%'
order by tablename;
-- expect: 12 rows, rowsecurity = true on every one

-- 4. Every one of them actually has a policy. RLS on with no policy
--    denies everything, which fails closed but fails.
select tablename, count(*) as policies
from pg_policies
where schemaname = 'public' and tablename like 'comm\_%'
group by tablename order by tablename;
-- expect: 12 rows, policies >= 1 each

-- 5. The widened constraints took
select conname, pg_get_constraintdef(oid) like '%WHATSAPP%' as has_whatsapp
from pg_constraint
where conname in ('outreach_campaigns_campaign_type_check','outreach_sends_channel_check');
-- expect: both true

-- 6. Routing seeded, and the one capability nobody has observed stays off
select role, provider, enabled, kill_switch from public.comm_provider_routes
order by role, priority;
-- expect: 7 rows; WHATSAPP_CALL/META enabled = false

-- 7. Products registered and still unpriced — see A5 before changing this
select code, enabled, pricing_active, standard_retail_cents
from public.billable_products where code in ('AI_CALL','WHATSAPP','AI_TALK')
order by code;
-- expect: 3 rows, enabled = false, pricing_active = false

-- 8. The platform WhatsApp number is recorded as TEST, not production
select label, environment, status from public.comm_channel_accounts where owner_id is null;
-- expect: environment = 'TEST', status = 'PENDING'

-- 9. Nothing was destroyed. Compare to the numbers taken before the run.
select
  (select count(*) from public.outreach_campaigns) as campaigns,
  (select count(*) from public.outreach_sends)     as sends,
  (select count(*) from public.outreach_contacts)  as contacts,
  (select count(*) from public.background_jobs)    as jobs;
-- expect: >= the pre-migration counts (0, 0, 0, 1 as of 2026-09-12)
```

### A3. The Meta credential

**Which one.** `META_WHATSAPP_ACCESS_TOKEN`. It is the only one that is wrong.
Confirmed live against production today:

```json
{"ok":false,
 "configured":{"access_token":true,"phone_number_id":true,"waba_id":true},
 "phone_status":401,"waba_status":401}
```

All three are **present**. Graph rejects the token on both the phone-number read
and the WABA read. That is an expired or revoked token, not a missing one — do
not re-enter the other four looking for a typo.

**Where it is reissued.** Meta Business Manager / developers.facebook.com, on
the app that owns the WhatsApp Business Account. A permanent System User token
is the right kind; a 24-hour tester token will expire and reproduce exactly this
state. Required scopes: `whatsapp_business_messaging`,
`whatsapp_business_management`.

**Where it is updated.** Supabase edge-function secrets, nowhere else. It is not
in the database, not in `.env`, and not in Vercel.

```
Supabase dashboard → Project ptxajsjhobhvsfhmutjn
  → Edge Functions → Secrets → META_WHATSAPP_ACCESS_TOKEN → update
```

The other four stay as they are: `META_WHATSAPP_PHONE_NUMBER_ID`,
`META_WHATSAPP_BUSINESS_ACCOUNT_ID`, `META_WHATSAPP_APP_SECRET`,
`META_WHATSAPP_VERIFY_TOKEN`.

**Verifying it without exposing it.** Never paste the token into a terminal, a
browser URL, a chat message or a curl command — a URL lands in server logs and
shell history. The verification is done by the server that already holds it:

```
Admin → Providers → Communications routing → "Test connections"
```

That posts to `comm-provider-status`, which reads the phone number and the WABA
and sends nothing. It returns names and booleans only — there is no field on the
response type that can carry a value. Read:

| Field | Before reissue | After a good reissue |
|---|---|---|
| `health` | `DOWN` | `HEALTHY` |
| `errorCode` | `AUTH` | `null` |
| `credentialsPresent` | `true` | `true` |
| `credentialsRejected` | `true` | absent |

The panel also renders it in words: *"Every WhatsApp credential is configured,
and Meta rejected them…"* changes to Working.

The test costs nothing and messages nobody — it is two GETs. There is
deliberately no "send me a test message" button: a test that costs money is one
people learn not to press, and one that messages a real number eventually
messages the wrong one.

### A4. The webhook subscription

Only possible after A3 succeeds and after the functions are deployed (C4).

```
Meta app → WhatsApp → Configuration → Webhooks
  Callback URL:  https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/whatsapp-webhook
  Verify token:  the value already in META_WHATSAPP_VERIFY_TOKEN
  Subscribe to:  messages
```

Meta verifies by issuing a GET carrying `hub.challenge`. If it fails with 401,
the function deployed with JWT verification on — see D2.

### A5. Pricing — a decision, not a step

The migration registers `AI_CALL`, `WHATSAPP` and `AI_TALK` with
`pricing_active = false` and `standard_retail_cents = 0`. It does not invent a
price, because Meta bills per conversation category and a number in a migration
would be a guess.

**Know what that means before going live.** With pricing inactive, a campaign
still launches and still places real calls. `beginExecution()` returns
`PRODUCT_PRICING_INACTIVE`, and `comm-campaign-launch` treats that as *run,
reserve nothing* — charging for something with no configured price would be
worse than not charging. `billable_products.enabled = false` does not stop it
either; it takes the same path.

So the platform pays the Cartesia and Vapi cost and bills nobody. Bounded by the
per-tier daily cap (a NEW account is $25/day) but not by zero.

Two acceptable ways to go live, and a decision is required:

- **Dormant.** Set `kill_switch = true` on the `TELEPHONY` and `MESSAGING`
  routes. That reaches `evaluateKillSwitch` and pauses dispatch. Screens work,
  nothing sends, nothing costs. This is the recommended first state.
- **Priced.** Set real rates in the pricing tables, then `pricing_active = true`
  and `enabled = true`. Only after B has passed.

### A6. The dispatcher tick

Nothing sends until this exists. The migration does not create it, and that is
the correct default — see A5.

```sql
select cron.schedule(
  'homatch-comm-dispatch', '30 seconds',
  $$ select net.http_post(
       url := 'https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/comm-dispatch-worker',
       headers := jsonb_build_object('Content-Type','application/json',
                                     'x-worker-secret', current_setting('app.worker_token', true)),
       body := '{}'::jsonb) $$);
```

The worker authenticates on `x-worker-secret` against `WORKER_TOKEN`, falling
back to the service role key. Match whichever the other three cron jobs already
use (`homatch-jobs-worker`, `homatch-verify-driver`,
`homatch-worker-quarter-hour`) rather than introducing a fourth pattern.

---

## B. REAL-CALL ACCEPTANCE TEST

One outbound call to a consenting native Georgian speaker who knows they are
being recorded for a test. Budget 10 minutes. Two people: one takes the call,
one watches `/outreach/calls/log` and the Supabase function logs.

Everything below except B9 is a judgement a Georgian speaker makes on the call.
B9 is measured from the transcript timestamps.

**Setup.** One agent, Georgian primary, `recording_enabled = true` for this test
only. One contact: the tester's own number. Campaign of exactly 1.

| # | What to do | PASS | FAIL |
|---|---|---|---|
| B1 | **Georgian STT.** Say: `გამარჯობა, მინდა ორ ოთახიანი ბინა ვაკეში, ას ოთხმოცი ათას დოლარამდე.` | Transcript is recognisable Georgian; `ვაკე`, `ორი ოთახი` and `180 000` all present and correct | Any of the three wrong or missing, or transcript is Latin-transliterated |
| B2 | **Natural TTS.** Listen to the opening line and one full answer. | A Georgian speaker calls it natural or lightly accented but clearly Georgian; stress and sentence melody are Georgian | Robotic, wrong stress, Russian or English phonology applied to Georgian, or audibly mispronounced `ყ` `წ` `ჭ` `ღ` |
| B3 | **Barge-in.** While the agent is mid-sentence, start talking over it. | Agent stops within ~0.5 s and listens | Keeps talking to the end of its sentence, or stops and then restarts the same sentence |
| B4 | **Cough test.** Cough once while the agent speaks. Say nothing. | Agent keeps going | Agent stops for a cough |
| B5 | **End-of-turn.** Say `მინდა ბინა ვაკეში და…`, pause ~1 s, then continue `…საბურთალოზეც`. | Agent waits through the pause and hears the whole thing | Agent answers during the pause, on `და` |
| B6 | **Finished turn.** Ask a short complete question and stop. | Agent replies within roughly 0.6–1.0 s | Replies instantly, cutting you off; or leaves a silence over ~2 s |
| B7 | **Names.** Give a Georgian name: `ჩემი სახელია ნინო ქავთარაძე.` | Name captured correctly and used back correctly at least once | Mangled, or read back in the wrong case so it sounds wrong |
| B8 | **Addresses.** `ჭავჭავაძის გამზირი, ორმოცდაათი.` | District/street recognised; house number 50 correct | Street lost, or number wrong |
| B9 | **Numbers and prices.** `ბიუჯეტი ას ოთხმოცი ათასი დოლარი` then `სამოცდაათი კვადრატი`. | 180 000 and 70 both correct, currency USD, nothing invented | Any digit wrong, or a currency asserted that was never said |
| B10 | **Language switch.** Mid-call: `Извините, давайте по-русски.` then continue in Russian. | Agent switches within one turn and stays in Russian | Keeps answering in Georgian, or flip-flops between turns |
| B11 | **Mouth-to-ear latency.** From the transcript, take end-of-caller-speech → start-of-agent-audio, five times. | Median ≤ 1.2 s and no single turn > 2.0 s | Median > 1.5 s, or any turn > 3 s |
| B12 | **Termination.** Say `მადლობა, ნახვამდის.` and let the agent end it. | Call ends cleanly; `outreach_sends.status = 'COMPLETED'`, `call_ended_at` set, `duration_sec` within ±2 s of the real duration | Hangs open, ends abruptly mid-sentence, or the row stays `ANSWERED` |
| B13 | **Hang-up recovery.** Second call: hang up abruptly mid-sentence. | Row settles to a terminal status within 60 s; cost recorded for what was used | Row stuck in `ANSWERED`/`RINGING`, or no cost row |
| B14 | **Handoff.** Third call: say `დამაკავშირეთ ოპერატორთან.` | Agent acknowledges and stops trying to qualify; conversation mode changes to a human-pending state | Ignores it and carries on |
| B15 | **Recording and privacy.** After B12. | Recording exists only because it was enabled for this test; the default remains off; it is not readable without a signed URL | Recording present with the default off, or publicly fetchable |
| B16 | **Cost settled.** After all calls. | `/outreach/billing` shows each call with a duration and either a charge or an explicit "No price set" | Any call shown as `$0.00` while pricing is inactive |

**Overall PASS** = B1, B2, B5, B6, B9, B11, B12 all pass. Those seven are the
product. A failure in any of them is a no-go.

**Conditional** = B3, B4, B7, B8, B10, B13–B16 may each fail once and be fixed
by tuning (Admin → Settings → Voice behaviour) or by an agent-prompt edit,
then retested. Two consecutive failures on the same item is a no-go.

Record the transcript, the measured latencies and a one-line verdict per row.
This is the only evidence that will exist for the three items the automated
corpus explicitly cannot cover: acoustic STT accuracy, TTS naturalness, and real
mouth-to-ear latency.

---

## C. PRODUCTION DEPLOYMENT SEQUENCE

Each step names its rollback point. Do not begin a step until the previous one
is verified.

### C0 — Baseline (rollback point 0)

```sql
-- Record these four numbers. Every later check compares against them.
select (select count(*) from public.outreach_campaigns) as campaigns,
       (select count(*) from public.outreach_sends)     as sends,
       (select count(*) from public.outreach_contacts)  as contacts,
       (select count(*) from public.background_jobs)    as jobs;
```

Take a Supabase point-in-time restore marker, and note the current production
deployment id from Vercel. **Rollback 0: nothing has changed yet.**

### C1 — Reissue and verify the Meta token (A3)

Independent of everything else and reversible. Do it first so a failure here
costs nothing.
**Rollback 1: restore the previous secret value. No schema or code has moved.**

### C2 — Apply the migration (A1), then verify (A2)

Run with `run_migrations: true` from `main` **after** C5's merge, or from a
maintenance window before it — the migration is additive and the current code
does not read the new tables, so it is safe in either order. Applying it first
is preferred: it is the step most worth isolating.

**Rollback 2 — the important one.** These migrations have no down script. Undo
is either a point-in-time restore to the C0 marker, or this, which is safe only
because the tables are new and empty:

```sql
begin;
drop table if exists
  comm_messages, comm_conversations, comm_extractions, comm_risk_assessments,
  comm_account_trust, comm_talk_sessions, comm_webhook_events,
  comm_whatsapp_templates, comm_channel_accounts, comm_agent_versions,
  comm_agents, comm_provider_routes cascade;
-- The widened CHECK constraints and added columns are additive and harmless;
-- leave them. Reverting them would break nothing and gain nothing.
commit;
```

**Do not run that if any `comm_` table has acquired rows.** Re-check first.

### C3 — Preview smoke test

On the branch preview, before any merge:
`https://homatch-git-feat-ai-communications-hub-insportia.vercel.app`

With the schema now applied, the preview reaches the same production database,
so this is the first time the screens see real tables.

1. `/outreach` — renders, KPIs are zeros not errors
2. `/outreach/agents` — create a draft agent, save, reload, it persists
3. `/outreach/billing` — balance shown, no usage yet, no `$0.00` claims
4. `/admin/providers` — Test connections: Cartesia and Vapi healthy, Meta
   healthy if C1 succeeded
5. `/admin/settings` — change a voice value, save, reload, it persisted
6. `/outreach/whatsapp/inbox` — empty state, not an error

**Rollback 3: none needed — nothing was promoted. If anything fails, stop here.**

### C4 — Merge to main

Only on explicit approval. Open the PR, let `pr-check.yml` run, merge.
**Rollback 4: `git revert` the merge commit. Production is still serving the
previous deployment until C5.**

### C5 — Production deploy

The push to `main` triggers the workflow. It deploys the frontend and now — for
the first time — all ten Communications functions, seven with JWT verification
and three without (see D2).

Watch the `deploy-functions` job. It fails loudly per function.
**Rollback 5: Vercel → Deployments → the C0 deployment id → Promote to
Production. Edge functions roll back by re-running the workflow on the reverted
commit.**

### C6 — Production smoke test

Same six checks as C3, against the production domain, signed in as an admin.
Then:

7. Meta → Webhooks → Verify and save (A4). It must succeed, not 401.
8. Confirm nothing is sending: `TELEPHONY` and `MESSAGING` routes still
   kill-switched, and no `homatch-comm-dispatch` cron job yet.

**Rollback 6: as rollback 5.**

### C7 — Enable sending (separate decision, separate day)

Schedule the dispatcher (A6), settle pricing (A5), then run section B against
production with one real call. Nothing before this point can place a call.

**Rollback 7: `select cron.unschedule('homatch-comm-dispatch');` and set
`kill_switch = true` on both routes. Takes effect within one tick.**

---

## D. FINAL BLOCKERS

Four. Nothing optional is listed.

### D1 — The Meta access token is rejected *(owner, external)*
Configured and refused with 401 on both endpoints, verified live today. WhatsApp
send, sync, templates and inbound all stay dead until it is reissued. Cannot be
fixed from this repository. **→ A3.**

### D2 — The Communications functions were not in the deploy workflow *(fixed on the branch, at `4dd4d251`)*
All ten were absent from both arrays in `.github/workflows/deploy.yml`, so a
merge would have shipped the schema and the entire frontend with no backend —
every screen calling a function that does not exist.

Worse, `whatsapp-webhook` and `voice-webhook` had to go in the `--no-verify-jwt`
array specifically. Meta and Vapi send no Authorization header; in the JWT array
the gateway 401s them before the function runs, Meta's subscription handshake
cannot complete, and no inbound message, delivery receipt or call event ever
arrives — silently, with every screen still looking correct.

Fixed, with `supabase/config.toml` matched so a hand-run deploy agrees, and
`tests/matrix/deployCoverage.test.mjs` failing if it regresses. **Listed as a
blocker because it is only fixed on this frozen branch; it blocks until this
branch is the thing that ships.**

### D3 — Pricing is inactive, and that does not stop a campaign *(owner decision)*
Not a defect — a deliberate refusal to invent a price — but a live financial
exposure. With `pricing_active = false`, a campaign launches, places real calls
at real provider cost, and reserves and charges nothing; `enabled = false` does
not stop it either. Bounded only by the per-tier daily cap ($25/day for a NEW
account).

Go live with the `TELEPHONY` and `MESSAGING` routes kill-switched, **or** set
real pricing first. Choosing neither means shipping a product that spends money
and bills nobody. **→ A5.**

### D4 — Acoustic Georgian quality is unverified *(owner, external)*
Every text-level decision is measured and regression-guarded (67-utterance
corpus, 10.8% interruption rate against 100% for a fixed endpointer). STT
accuracy from real telephony audio, TTS naturalness and true mouth-to-ear
latency have never been observed. Section B is the only thing that can settle
them, and it needs a real Georgian speaker on a real call. **→ B.**

---

### Not blockers — recorded so they are not mistaken for one

- **No cron job for the dispatcher.** Deliberate: it is what keeps a
  freshly-deployed system dormant. Becomes a step only at C7.
- **Three smoke-test functions live in production but not in the repository**
  (`meta-whatsapp-smoke-test`, `cartesia-smoke-test`, `vapi-smoke-test`),
  deployed by hand during development. `meta-whatsapp-smoke-test` is public
  (`verify_jwt: false`) and tells an anonymous caller whether the WhatsApp
  credentials are configured and working. It returns no secret value, so this
  is untidy rather than dangerous — but it should be deleted once
  `comm-provider-status` is deployed, which supersedes it.
- **`import-property/index.ts(287,3)` TS1117**, a duplicate object key. Predates
  this branch, belongs to another workstream, and `check:edge` still reports all
  63 functions legal.
- **Five older functions deploy `--no-verify-jwt` with no caller check visible
  in their source** (`classify-signals`, `dataforseo-search`, `run-matching`,
  `social-collect`, `spend-cap-check`). A pattern match, not a verified finding
  — `payment-webhook` looked identical until its real signature check was read.
  Worth someone reading. Not this branch's, and not a blocker for it.

---

## CLOSEOUT UPDATE — 2026-09-13

Re-verified on the merged tree at `f8ecf35a`. What changed since this document
was written:

**Billing now fails closed (was D3, now fixed in code).** `evaluateExecutionGate`
runs per send, immediately before the provider adapter. No active price, no
resolvable price, a zero price on a product not declared free, a malformed
number, an insufficient balance, a missing reservation, an active kill switch,
a domain or compliance verdict that is not ALLOW — each refuses, and 22 tests
assert `provider.calls === 0` rather than a verdict string. The launch path
refuses the same case so the customer is told why in the moment they ask.

**"Held for a human" was dialling.** The first version of that gate refused
BLOCK and let everything else through — including REVIEW, which is what the
classifier actually returns for political campaigning, unrelated e-commerce, a
generic blast and B2B lead generation. Only ALLOW allows now, on both the
domain and the compliance axis. A 15-case release corpus proves it end to end.

**Outbound arrives switched off.** The route seed gave TELEPHONY and MESSAGING
`enabled=true` with `kill_switch` defaulting to false, so outbound would have
been live the instant the migration landed. Both now arrive kill-switched.

**A2 verification query 6 expectation changes** — `TELEPHONY` and `MESSAGING`
now expect `kill_switch = true` on arrival, not false.

**Live provider state, re-checked:** Cartesia 200, Vapi 200, Meta 401 on both
endpoints with all three credentials present. Meta is unchanged.

**Migration pre-flight, re-run:** 0 `comm_` tables, 0 `comm_` functions, all
four outreach tables still empty, every FK target present, `is_admin()` present,
`notification_type` present with none of the nine new values, 0 index
collisions, 0 trigger collisions. WAL archiving on; recovery point
`2026-09-12 20:11:53+00`, LSN `15/77004BE0`.

**One thing this document got wrong.** It said the migration could be applied
by the deploy workflow with `run_migrations: true`. It cannot, safely: that job
runs `supabase db push`, and the ledger head is `20260911230000` while nine
later migrations sit unrecorded — several of them already applied by hand
(`site_pages`, `market_snapshots`, `finance_provider_prices`,
`intelligence_entities` all exist). A push would replay all nine before
reaching the Communications pair. The repair list in the workflow covers only
the 2026-08-27/29 baseline, not these.

That ledger drift is pre-existing and is not this workstream's to resolve. The
Communications migrations must therefore be applied **selectively**, not by
`db push`.

---

## CLOSEOUT UPDATE — 2026-09-14

Re-verified against LIVE production, not against the tree. Three of the four
things this document asks an owner to do have since been done, and the
document said otherwise for two days.

**A1 and A2 are done. The migration is applied.** `information_schema` shows
all 12 `comm_` tables; `pg_proc` shows all 14 `comm_` functions;
`supabase_migrations.schema_migrations` records `20260912110000` and
`20260912110500` plus the six part-split versions and the two least-privilege
grant migrations. The 2026-09-13 update above says "0 comm_ tables, 0 comm_
functions" — that was true when it was written and has not been true since the
twelfth. Section A1 must not be run again.

**D1 is closed. The Meta token is accepted.** The smoke test returns 200 for
both the phone number and the WABA, with all three credentials present. The
401 recorded on the twelfth and repeated on the thirteenth is stale.

**A4 was never possible, for a reason nobody had recorded.**
`META_WHATSAPP_VERIFY_TOKEN` and `META_WHATSAPP_APP_SECRET` were both unset, so
the deployed webhook answered **503 to everything** — including Meta's GET
handshake, which is the step that subscribes the webhook at all. The
subscription could not have been created no matter how many times somebody
pressed the button.

The verify token is a value we choose, so it is now set and the handshake is
verified in production: the correct token returns 200 with the challenge
echoed, a wrong one returns 403. The app secret is Meta's and remains the one
genuine external blocker — see FINAL BLOCKERS below.

**The connected test number belonged to nobody.** `comm_channel_accounts` held
one CONNECTED Meta account with real identifiers and `owner_id` NULL, and
`whatsapp-webhook` returns early on an account with no owner. Even with the
signature working, every inbound message would have been dropped before
anything happened. Assigned to the admin; one update reassigns it.

**Every communications notification was failing on a foreign key.** The
comm_ and outreach_ tables key `owner_id` on `auth.users.id`; `notifications`
references `public.users.id`. Eight of the sixteen producers handed the first
to the second, the insert failed, and the helper swallowed it — an inbound
message, a rejected template, a qualified lead, a requested callback, a
compliance pause and a finished campaign told nobody, and never had.
`notify_emit` now resolves either identity. Verified before and after against
production.

**Email is two-way.** There was no inbound path at all. `email-webhook` is
deployed with Svix signature verification, replay protection through
`comm_claim_webhook_event`, tenant resolution from the address the mail
arrived at, and recording through `comm_record_inbound` into the same inbox.
Proven live: a signed delivery opened a conversation and notified the owner, a
retry of it changed nothing, a delivery to an unclaimed address was recorded
as unroutable and attached to nobody, and a second tenant's mail landed in the
second tenant's inbox and nowhere else.

### FINAL BLOCKERS — 2026-09-14

Two, both outside this repository, both one screen each.

**B1 — The Meta app secret.** Meta App Dashboard → your WhatsApp app →
**App settings → Basic** → **App secret → Show** → copy. Then set it as a
Supabase Edge Function secret named `META_WHATSAPP_APP_SECRET`. Until it is
set, `whatsapp-webhook` answers 503 to every delivery and writes nothing —
which is correct, fail-closed behaviour, and completely silent from outside.
Everything else on the Homatch side is done and verified.

With that set, the subscription is one screen: Meta App Dashboard → **WhatsApp
→ Configuration** → **Edit** →
Callback URL `https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/whatsapp-webhook`,
Verify token = the value in `META_WHATSAPP_VERIFY_TOKEN`, **Verify and save**,
then **Manage** → subscribe the **messages** field.

**B2 — The Resend inbound endpoint.** Resend dashboard → **Webhooks** → **Add
Webhook** → endpoint
`https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/email-webhook`, event
**email.received**. Resend then shows a signing secret beginning `whsec_`;
that value must replace `RESEND_WEBHOOK_SECRET`, which currently holds a
placeholder set so the path could be proven end to end. Inbound mail also
needs the MX record Resend gives for the receiving domain, and the address it
receives on must match a row in `comm_channel_accounts`
(`replies@homatch.live` is configured and owned).

Neither is a code change, and neither can be done from this repository.
