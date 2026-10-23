# Email Marketing — coordinated release plan

Branch `claude/email-crm-resend-integration`, migration `20261124090000_email_marketing_crm_resend.sql`.
Nothing here is done until the owner approves each gated step (merge, migration, deploy,
sending, wallet charges). Tier: REPO_FULL (routes, shared types, access control on
`admin_settings` / `comm_messages`), so the PR's validation run is the release evidence.

## What ships switched off

| Control | State after deploy | Turned on by |
|---|---|---|
| `provider_kill_switch` (admin_settings) | `true` (production today) | owner, step 6 |
| `email_studio_sending_enabled`, `outreach_email_sending_enabled` | `false` (production today) | owner, step 6 |
| `billable_products` EMAIL_PLAN_PRO / EMAIL_PLAN_SCALE / EMAIL_OVERAGE_1K | `kill_switch = true` (seeded) | owner, step 7 |
| `email_marketing_route` | `TRANSACTIONAL` (Broadcasts not used) | owner only, after the contact-price review |
| `email_marketing_tenant_daily_cap` | 5000 per customer per day | admin setting |
| `email_marketing_provider_monthly_cap` | 0 (off) — **must be set in step 5** | admin setting |

With these, applying the migration and deploying the code sends no email and charges no wallet.

## Order (the migration gate forces it)

`scripts/release/migration-gate.mjs` refuses every edge deploy until each repo migration is in
the production ledger, so the migration is applied first.

1. **PR green** — pr-check REPO_FULL run passes. Owner approves the merge.
2. **Merge to main.** Vercel ships the frontend in ~20 s: the Email inbox, Plan and Domains
   pages appear; their actions fail closed (the `email-marketing` function is not deployed yet,
   products are kill-switched).
3. **Apply the migration**: Actions → Deploy → `workflow_dispatch` with `run_migrations: true`
   (a push never applies migrations). Proof: `20261124090000` in
   `supabase_migrations.schema_migrations`; `select count(*) from email_plans` = 3;
   `select code, kill_switch from billable_products where code like 'EMAIL_%'` all `true`.
4. **Edge deploy** of the owed functions: `email-marketing` (new, JWT), `email-webhook`,
   `outreach-send`, `jobs-worker`. Proof: PROVEN_EXACT per function (refs/deployed/edge +
   artifact hash), and the Supabase version moves N→N+1 for each (an unchanged version means
   it did not ship; a new function can need a second run).
5. **Key, plan and capacity** (read-only, no sending):
   - Set `admin_settings.email_marketing_resend_key_env` to the NAME of the dedicated marketing
     key's secret (the value stays in Supabase secrets; nothing prints it).
   - Admin → Communication → Email → *Refresh provider usage* (`usage_refresh`). It reports
     `keyEnv` and `keyFallback` (names only). `keyFallback = true` means the marketing key was
     not found and the auth/transactional `RESEND_API_KEY` would be used — stop and fix the
     secret name before going further. The snapshot's `emails.monthly.limit`,
     `domains.limit`, `contacts` identify the active Resend plan. `GET /usage` needs a
     full-access key; a sending-only key returns 401 and the snapshot says so.
   - Set `email_marketing_provider_monthly_cap` to the plan's monthly limit (minus the
     transactional/auth volume that shares the account).
6. **Sending, test recipients only** — owner sets `provider_kill_switch = false` and one
   sending flag, then runs the acceptance tests below against owner-authorised addresses.
7. **Wallet charges** — only after the tests pass, the owner turns the three EMAIL_* product
   kill switches off. Card recurring billing does not exist (payment provider in mock mode):
   renewals are wallet-only and opt-in.

## Rollback

| Problem | Action | Effect |
|---|---|---|
| Any sending problem | `provider_kill_switch = true` | every send path stops before the provider |
| Billing problem | `update billable_products set kill_switch = true where code like 'EMAIL_%'` | wallet_reserve refuses; nothing new is charged |
| Broadcast problem | `email_marketing_route = 'TRANSACTIONAL'` | next campaign batch uses /emails |
| Edge regression | redeploy the previous artifact of the function (refs/deployed/edge history) | code back; schema stays (all additive) |
| Frontend regression | Vercel → promote the previous production deployment | pages back |
| Wrong plan charge | a settled charge cannot be released; refund with `wallet_grant_credits` (service role, owner-approved) referencing the `email_billing_events` id | customer made whole |

The migration is additive (new tables, columns, functions, triggers, one index). It is not
rolled back by a down-migration: switching the products and sending off is the rollback.
Two behaviours change for existing data and stay safe if code is rolled back: opt-outs now
propagate across an owner's rows with the same address, and `email_meta` / `html_body` on
`comm_messages` are server-write only.

## Real end-to-end acceptance tests (step 6, owner-authorised addresses only)

Each test names its proof; "green" without the proof is not a pass.

1. **Transactional send + quota** — a Studio test send and a 2-contact outreach campaign to
   owner addresses with `consent_status = CONSENTED`. Proof: Resend message ids on the rows,
   `email_quota_reservations` SETTLED with `sent` = accepted count, Free period `used` +N.
2. **Consent enforcement** — a contact with consent UNKNOWN in the same list. Proof: no
   `outreach_sends` row for it; recording consent on the contact profile then includes it.
   An unsubscribed contact cannot be re-consented (CONTACT_OPTED_OUT).
3. **Webhook delivery** — Proof: `comm_webhook_events` rows keyed `svix:<id>` for
   `email.sent` / `email.delivered`, the send row DELIVERED, a redelivery counted as a
   duplicate. A bounce to a Resend test bounce address suppresses the address for the owner.
4. **Inbox reply** — reply from the owner's mailbox to a campaign email. Proof: the reply
   arrives on `r-<token>@<reply domain>`, lands in that owner's `/inbox/email` thread with
   HTML, `sender_check = PASS` for a DMARC-passing mailbox; answering from the inbox threads
   (`In-Reply-To`) and the reply's delivery event updates the CRM message.
5. **Custom domain** — add an owner-controlled subdomain. Proof: DNS records shown, status
   `DNS_PENDING` → `VERIFIED` only after Resend verifies; a send then uses it as From.
   (DNS changes are the domain owner's; HOMATCH's own DNS/MX are not touched.)
6. **Campaign continuation** — a RUNNING campaign with more contacts than one batch. Proof:
   jobs-worker re-claims it each minute until no CONSENTED contact without a send is left,
   then COMPLETED.
7. **Wallet billing** (after step 7, on an owner test wallet) — buy Pro. Proof: one SETTLED
   `usage_reservations` row of 500 credits, one `email_billing_events` row, an ACTIVE
   period of 50,000; a second click is ALREADY_ACTIVE with no second charge. Overage: enable
   with cap 1, exceed by 10. Proof: one OVERAGE_BLOCKS event of 22 credits, `blocks_state`
   BILLED; Finance V2 revenue lines show VAT 18% then 37/63.
8. **Broadcast route** (only if the owner chooses it) — route BROADCAST, a 2-contact campaign.
   Proof: a Resend segment + broadcast id on the campaign, rows SENT with the broadcast id,
   webhook events attributed by `broadcast_id` + recipient.

## Economics (VAT-inclusive prices unchanged; Resend list prices verified 2026-10-22)

Net = gross / 1.18; allocation of net: HOMATCH 37 %, execution 63 %. Provider cost is separate.

| Plan | Gross | VAT | Net | HOMATCH 37 % | Execution 63 % |
|---|---|---|---|---|---|
| Pro, 50,000/month | $50.00 | $7.63 | $42.37 | $15.68 | $26.69 |
| Scale, 100,000/month | $220.00 | $33.56 | $186.44 | $68.98 | $117.46 |
| Overage, per 1,000 | $2.20 | $0.34 | $1.86 | $0.69 | $1.17 |

Provider cost of a customer at full use, by how the shared Resend account is billed:

| Scenario | Provider cost | Contribution (net − cost) | Execution allocation − cost |
|---|---|---|---|
| Pro at full use, marginal $0.90/1k (account on Scale $90/100k, or in Resend overage) | $45.00 | **−$2.63** | **−$18.31** |
| Pro at full use, account on Resend Pro 100k ($35 → $0.35/1k) | $17.50 | +$24.87 | +$9.19 |
| Pro sent as Broadcasts to 50,000 contacts (contact-priced Marketing plan) | ~$250 | **−$207.63** | **−$223.31** |
| Pro sent as Broadcasts to 5,000 contacts ($40) | $40.00 | +$2.37 | **−$13.31** |
| Scale at full use, $0.90/1k | $90.00 | +$96.44 | +$27.46 |
| Overage block, $0.90/1k | $0.90 | +$0.96 | +$0.27 |

Pro breaks even on contribution at ~47,100 emails/month and on the execution allocation at
~29,700 emails/month when the marginal provider price is $0.90/1k. Custom customer domains
push the account toward Resend Scale (domain limits), which is exactly the $0.90/1k case.

Safeguards in this PR (prices and quotas untouched): Pro and Scale stay on the transactional
route by default; per-customer daily cap; provider-wide monthly cap tied to the active Resend
plan; usage snapshot with an alert threshold (80 %); overage only with explicit consent and a
customer cap. Proposed for an owner decision: keep Broadcasts off for Pro (or cap Pro
contacts per month); pick the Resend tier from aggregate committed volume (economics.ts
`cheapestTx`); review Pro's price or allowance if most Pro customers use >30k/month on a
$0.90/1k account.
