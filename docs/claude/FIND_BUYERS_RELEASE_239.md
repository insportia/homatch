# Find Buyers / Tenants — release checklist for PR #239

Status: **READY FOR INTEGRATION — NOT MERGED, NOT DEPLOYED.** Planned order
(owner, 2026-10-16): #237 → #238 → #239, then one coordinated production
release. Nothing below is run without the owner's explicit approval.

## 0. Before release (after #237 and #238 merge)

1. Rebase `claude/nifty-hopper-snzn2d` onto the latest `main`;
   re-run `npm run homatch:migrations`, `npx tsgo -p tsconfig.check.json`,
   `npm run i18n:check`, `npm run i18n:keys`, the Find Buyers browser suites.
   If `translations.ts` conflicts, take main's bundle and re-apply
   `node scripts/find-buyers-ux-i18n-apply.mjs` (idempotent).
2. CI on the new head: every check green (23 on 95b06ceb).
3. Confirm that `20261109100000` is still the newest-but-unapplied Find
   Buyers migration and that no other migration took that version.

## 1. Migration — `20261109100000_find_buyers_research_opportunities.sql`

- Additive and read-only: `create or replace function
  public.find_buyers_research_opportunities(p_job_id uuid)` — `stable`,
  `security definer`, `search_path ''`. No table, column, policy or data change.
- Access: service role, an admin, or the campaign's / property's owner;
  anything else (including a job that does not exist) raises `FORBIDDEN`.
  `revoke all … from public, anon`; `grant execute … to authenticated, service_role`.
- Depends on objects already in production: `find_buyers_campaigns`,
  `find_buyers_assessments`, `find_buyers_leads`, `raw_signals`, `properties`,
  `admin_settings`, `is_admin()`, `auth_user_id()`,
  `find_buyers_signal_is_current()`.
- Apply BEFORE the frontend that calls it ships. The UI already degrades to
  lead-derived opportunities when the RPC is missing (browser-tested), so the
  order is safe either way.
- Verify after apply (read-only):
  - ledger row named `find_buyers_research_opportunities`;
  - `select proname, prosecdef from pg_proc where proname = 'find_buyers_research_opportunities';` → 1 row, `prosecdef = true`;
  - `select has_function_privilege('anon', 'public.find_buyers_research_opportunities(uuid)', 'execute');` → `false`.
- Rollback: `drop function public.find_buyers_research_opportunities(uuid);`
  (nothing else depends on it).

## 2. Edge functions

| Function | Why | Note |
|---|---|---|
| `discovery-queue-worker` | `driver.ts` runs the native Telegram assessment at campaign close; executor/pipeline/adaptive/campaign changes (v5 qualification, comments, language-first probing, honest counters) | Also deployed by #237 (Find Property offer jobs). Deploy ONCE from the final `main` that contains #237 + #238 + #239. |
| `community-sync` | Find Buyers Telegram sync also reads verified communities | — |

Proof after deploy: `refs/deployed/*` + exact artifact (PROVEN_EXACT), per
`docs/claude/RELEASE.md`. Railway: no worker files changed — no Railway deploy.

## 3. Frontend

Vercel production build from the same final `main`. Routes added:
`/property/:id/buyers/lead/:leadId`.

## 4. Money

- New campaigns keep `paid_discovery_37_63_v1`: HOMATCH 37% / providers 63%
  of the total price; charge = provider spend consumed ÷ 0.63, capped at the
  reservation (`src/research-core/billing/paidDiscoveryPolicy.ts`). #239 does
  not change the policy, reservations or settlement.
- No paid Actor run, campaign, budget, wallet, billing record or flag is
  changed by this release.

## 5. Admin registration — FB_POST_SEARCH, FB_PAGE_POSTS, FB_AD_LIBRARY

Owner action, **after** the release. Admin → Find Buyers → Actors →
**Register & verify**. Verification reads the price and input schema from
Apify (metadata only; it starts no Actor and spends nothing) and writes the
row **disabled**.

| Actor key | Apify Actor | Purpose | Priority | Probe | Max results | Timeout | Concurrency |
|---|---|---|---|---|---|---|---|
| `FB_POST_SEARCH` | `memo23~facebook-search-scraper` | SEARCH — public posts by listing keyword (Pages, agencies, developers, listings); logged out, no engagement counts | 55 | 15 | 60 | 300 s | 2 |
| `FB_PAGE_POSTS` | `memo23~facebook-page-posts-scraper` | POSTS_AND_COMMENTS — feeds of public Pages that published a comparable listing, comments attached; public Pages only | 50 | 10 | 40 | 300 s | 2 |
| `FB_AD_LIBRARY` | `memo23~facebook-ads-library-scraper-ppe` | SEARCH — competitor property ads by listing phrase and country; the Library has no comments, a comparable ad queues its Page feed | 52 | 20 | 50 | 240 s | 1 |

Source: `REGISTRY_SEEDS` in `src/research-core/findBuyers/actorCatalog.ts`;
written by `verifyActor` in `supabase/functions/_shared/findBuyers/admin.ts`.

A campaign plans an Actor only when ALL hold (`enabledActorMap`,
`supabase/functions/_shared/findBuyers/campaign.ts`):

1. `enabled = true` — a separate operator decision after verification;
2. not `emergency_disabled`, `health` ≠ `DISABLED`;
3. `pricing_verified_at` set and newer than the pricing max age, with
   `pricing_model` ≠ `UNKNOWN` and `price_per_1k_micros` known. If Apify does
   not state a price, verification leaves `pricing_verified_at` empty and says
   so in `last_error`; the price must then be set by hand and marked verified.

Lifecycle shown in Admin (`actorLifecycle`): REGISTERED → VERIFIED (price +
input schema) → PROVEN (a real successful run returned real text at a real
public URL — set automatically by the executor, never by metadata) → ACTIVE
(proven and enabled).

Dependencies: `FB_PAGE_POSTS` is seeded by `FB_POST_SEARCH` and by
`FB_AD_LIBRARY` (an ad's Page); `FB_COMMENTS` (already registered) reads the
comments of qualifying posts when they did not arrive inline.

**Enabling makes the first campaign that plans the Actor its proof run, and
that run is paid.** Enabling therefore needs the owner's explicit approval,
with the provider, cost cap and expected customer charge shown first.
APIFY scope: memo23 Actors only, through `_shared/findBuyers/memo23Client.ts`;
Admin → Providers' APIFY switch stops every run.
