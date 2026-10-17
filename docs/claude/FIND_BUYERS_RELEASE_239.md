# Find Buyers / Tenants — release record for PR #239 (Release B)

Status: **MERGED, DEPLOYED AND PROVEN IN PRODUCTION (2026-10-17).**
Release order as planned by the owner: #237 → #238 → #241 (migration only) →
single-migration apply → #239.

| | |
|---|---|
| Merge commit | `c1086f0e6d1e3d1ebba283b8ad2c4408e802b616` (approved head `3c490c5f`) |
| Deploy run | [`39011630277`](https://github.com/insportia/homatch/actions/runs/39011630277) — success; DB-migration job skipped |
| `refs/deployed/edge` | `eddf0f8f` → `c1086f0e` (advanced only after the artifact proof) |
| `refs/deployed/frontend` | `8218107c` → `c1086f0e` |
| Vercel production | `dpl_4MQLywtqFddJt3amTfV6r2D4rtRc` — READY. Rollback target: `dpl_2aeJxnrbLRSwHGEFrfpugewis6wk` (`8218107c`) |
| Railway | not deployed (no `official-worker/` change) |

## 1. Migration — `20261109100000_find_buyers_research_opportunities.sql`

Merged with #241 and applied **singly** through the Supabase migration API,
never `supabase db push` (production's ledger records apply-time versions, so a
push would replay ~130 already-applied migrations — see issue #243).

- Ledger row `20261017061959` / `find_buyers_research_opportunities`.
- `public.find_buyers_research_opportunities(uuid)`: `stable`, `security
  definer`, `search_path ''`; body MD5 `8d75efe2df1b3d6da26d637c88943634`;
  `anon` cannot execute (`has_function_privilege` → `false`).
- Additive and read-only; no table, column, policy or data change.
- Rollback: `drop function public.find_buyers_research_opportunities(uuid);`
  (nothing else depends on it).

#239 itself carries no migration. The deploy step "Apply verified publishing
migration" exits immediately unless `publishing-engine` is owed; it was not,
and the ledger still ends at `20261020090000`.

## 2. Edge functions — exactly the five owed, all PROVEN_EXACT

| Function | Before | After | Why it was owed |
|---|---|---|---|
| `discovery-queue-worker` | v74 | **v75** | executor / pipeline / adaptive / campaign (v5 qualification, comments, language-first probing, honest counters); native Telegram assessment at close |
| `community-sync` | v26 | **v27** | Telegram sync also reads verified communities |
| `match-campaign` | v86 | **v87** | Find Buyers campaign planning and qualification modules |
| `find-property-run` | v23 | **v24** | bundles the shared Find Buyers modules only |
| `marketplace-search` | v20 | **v21** | bundles the shared Find Buyers modules only |

`community-sync` and `match-campaign` were first deduplicated by the platform
(STALE); the workflow's single deterministic recovery redeployed each once and
both then proved exact. Nothing else was deployed (`homatch-ai` v70 and
`marketplace-worker-ingest` v19 unchanged).

## 3. Frontend

Vercel production build of `c1086f0e`. Route added:
`/property/:id/buyers/lead/:leadId`. No runtime errors after release.

## 4. Money and preservation (verified read-only after release)

- Policy unchanged: `paid_discovery_37_63_v1` — HOMATCH 37% / providers 63% of
  the total price; charge = provider spend consumed ÷ 0.63, capped at the
  reservation (`src/research-core/billing/paidDiscoveryPolicy.ts`).
  `find_buyers_provider_share_bps = 6300`.
- Preserved exactly: 6 campaigns (all terminal), 44 leads, 149 Actor runs,
  11 enabled Actors, `find_buyers_social_enabled = true`.
- No open Actor-run reservation, no open credit reservation, no credit-ledger
  movement and no new Actor run since the merge.
- Find Property: `find_property_social_enabled = false`, 0 Find Property Actor
  runs; free portal search unaffected.

## 5. FB_POST_SEARCH, FB_PAGE_POSTS, FB_AD_LIBRARY — REGISTERED, DISABLED

Registered on 2026-10-17 with exactly the row `verifyActor`
(`supabase/functions/_shared/findBuyers/admin.ts`) writes for an unregistered
seed (`REGISTRY_SEEDS`, `src/research-core/findBuyers/actorCatalog.ts`):
`enabled = false`, `health = UNKNOWN`, `pricing_model = UNKNOWN`,
`pricing_verified_at = null`. No Actor was started; nothing was spent.

| Actor key | Apify Actor | Purpose | Priority | Probe | Max results | Timeout | Concurrency |
|---|---|---|---|---|---|---|---|
| `FB_POST_SEARCH` | `memo23~facebook-search-scraper` | SEARCH — public posts by listing keyword | 55 | 15 | 60 | 300 s | 2 |
| `FB_PAGE_POSTS` | `memo23~facebook-page-posts-scraper` | POSTS_AND_COMMENTS — public Page feeds, comments attached | 50 | 10 | 40 | 300 s | 2 |
| `FB_AD_LIBRARY` | `memo23~facebook-ads-library-scraper-ppe` | SEARCH — competitor property ads by phrase and country | 52 | 20 | 50 | 240 s | 1 |

A registered row cannot run. Three independent gates refuse it:

1. planners — `enabledActorMap` (`_shared/findBuyers/campaign.ts`), follow-ups
   in `_shared/findBuyers/executor.ts`, `loadOfferActors`
   (`_shared/findProperty/socialOffers.ts`) — need `enabled`, not quarantined,
   and fresh verified pricing;
2. `find_buyers_reserve_actor_run` and `find_property_reserve_actor_run` return
   `ACTOR_DISABLED` / `PRICING_NOT_VERIFIED`; no reservation → no Apify call;
3. Admin → Providers' APIFY switch stops every memo23 run.

Remaining owner steps, in order:

1. **Verify** (free): Admin → Find Buyers → Actors → *Register & verify* on
   each row. It reads price and input schema from Apify (metadata only) and
   leaves the row disabled. If Apify states no price, set it by hand and mark
   it verified.
2. **Enable** (paid): the first campaign that plans an enabled Actor is its
   proof run and is paid. Needs explicit owner approval with provider, cost cap
   and expected customer charge shown first.

Lifecycle in Admin (`actorLifecycle`): REGISTERED → VERIFIED → PROVEN (set by
the executor after a real run returns real public text) → ACTIVE.
Dependencies: `FB_PAGE_POSTS` is seeded by `FB_POST_SEARCH` and by
`FB_AD_LIBRARY`; `FB_COMMENTS` reads comments that did not arrive inline.
APIFY scope: memo23 Actors only, through `_shared/findBuyers/memo23Client.ts`.
