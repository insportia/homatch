# Find Property: social listings from the existing Apify infrastructure (2026-10-17)

**Status: implemented, NOT live.**
- In production, `find_property_social_enabled` = false and `find_property_discovery_enabled` = false.
- No paid run has ever started: `find_property_actor_runs` = 0, and there were 0 paid discovery runs in the last 24 hours.
- Turning this on needs the migration, the deploy and the owner's switch, in that order.

## What it does
A buyer's or tenant's paid social OFFER campaign runs memo23 Actors on public social sources. It goes through the one memo23 client (`_shared/findBuyers/memo23Client.ts`), the one Actor registry (`find_buyers_actor_registry`) and the one APIFY switch. Find Buyers modules are not changed.

1. **Plan.** The plan is property specific and covers six languages.
   - `offerCampaign.ts` `SEARCH_WORDS` has keyword-search words per language (ka, ru, en, tr, ar, he), per property kind (apartment, house, land, commercial), and per transaction.
   - Georgian, Russian and English are always searched. The customer's interface language is searched too (`offerSearchLanguages`).
   - Known groups and channels are read whatever language they are in.
2. **Qualify.** `qualifyOffer` keeps only posts that OFFER the searched transaction in the searched city.
   - A request ("looking for a flat") is rejected as `NOT_AN_OFFER`.
   - `socialCandidate` checks the direction again before a post can become a listing.
3. **Store.** Offers go to `supply_observations` (adapter `fp-social-offers-2`). Each one keeps:
   - the post URL;
   - the price, area, rooms and floor;
   - the description and publication date;
   - the Actor run (`field_origins.memo23ActorRunId`) and the network;
   - the post's own photos (`image_urls`, from `offerImages`). Author, avatar, group and page images are never taken, and no photo is invented.
4. **Show.** Results appear only after the campaign has ended (`discoveryRun.ts` `publishSocialListings` → `processAndStore`).
   - The offers join the search's portal candidates. They are ranked by the same pipeline and filtered by the same rules.
   - A post that is a possible duplicate of a portal listing is not shown twice. It stays reachable from that property's possible duplicates as its original post (`PossibleMatchView.repost`).
   - A property known only from social posts is labelled "Social post · unverified" on the card. The property page explains that HOMATCH has not verified it.
   - Such a property is never a Best Match on its own.

## v2 (2026-10-18): batched runs, one confirmation, its own results

**Why.** The owner ran "paid" search and saw portal listings only. Production showed:
- 0 paid `discovery_runs` and 0 Actor runs, so no money was spent on Find Property;
- the 15.8 credits settled that day were a separate Find Buyers campaign.

The Deep card started only the FREE search. The campaign needed a second approval on the next screen, so the customer saw the portal progress and the portal results. The old plan was also weak: about 60 one-community probes, each paying a start fee and queueing behind 2 per-Actor and 4 global memo23 slots, and no TikTok.

**Runs, batched** (`offerCampaign.ts` `planOfferJobs`, `socialOffers.ts` `offerInput`):

| Network | Actor | Run shape |
|---|---|---|
| Facebook | `FB_GROUP_POSTS` | Every group of the city (or naming no other city: `cityHint`) in one run per keyword. The keyword goes in `search` (verified schema property). Up to 25 groups a run, keyword-major. |
| Telegram | `TELEGRAM_CHANNEL` | Up to 25 channels a run, any language. |
| Instagram | `IG_PROFILE_POSTS` | The registered in-city profiles. The Actor's verified input is profile URLs only, so hashtag pages are not sent. |
| TikTok | `TIKTOK` | One run, `mode: 'search'`, every keyword plus the city. |
| VK | `VK_POSTS_COMMENTS` | Unavailable: the Actor is FAILED/disabled. |

A run asks for the Actor's `max_results` for each community or keyword. Migration `20261114090000` lets `find_property_reserve_actor_run(…, p_target_count)` allow that:
- at most 25 targets and 1000 items;
- timeout = the Actor's timeout per `max_results` block, at most 20 minutes (the campaign deadline is 30).

The campaign budget, switches, pricing freshness, concurrency and Admin caps are unchanged, and they apply to the whole run.

The planner gives every network its first run before any network gets a second. The run that no longer fits whole is shrunk to the remaining budget.

Each stored post is attributed to the community it came from (`communityKey`). A post no community claims is stored under its network's inactive holder row:
- `homatch:fp-fb-post-search`
- `homatch:fp-telegram-offers`
- `homatch:fp-instagram-offers`
- `homatch:fp-tiktok-search`

**One confirmation.**
- The Deep card shows the exact maximum and the terms, with one approval box.
- The free search starts (the campaign extends its subscription). The campaign then starts with the same approval: a one-shot, per-tab token (`rememberDeepConsent` / `takeDeepConsent`, 10 minutes, idempotency key).
- The server re-prices the same amount before anything is reserved. A reload never starts anything.
- While `?deep=` is on the URL, the page shows the campaign, never the portal search.

**Process only.** The customer sees:
- searching posts → reading them → checking matches → preparing results;
- real progress: runs finished of runs planned, to 85%; matching 90%; end 100%.

No network or site is named. A client-sent network list is ignored: Admin's `find_property_social_networks` decides.

**Its own results.** "View results" opens `?view=paid&fp_socialOnly=true`. It holds social listings and social reposts of portal homes (`isSocialResult`). It has its own tab once a campaign has delivered results.

**Tests:**
- `findPropertySocialListings` (batched plan, budget fit);
- `findPropertySocialBilling` (batched input, per-group attribution, `p_target_count`);
- `tests/sql/run-find-property-batched.sh` (applied twice);
- the browser suite: the one-confirm flow, no network names, the paid view.

## Discovery quality (2026-10-18, before the first paid test)

Three gaps were checked against production evidence; apify.com is not reachable from the build environment.

- **Facebook keyword field (`search`) is never sent.**
  - It is listed in the group Actor's schema, but no production run has ever used it: all 141 Find Buyers runs had `query: null`. Its meaning (search inside the groups, or something else) is unverified.
  - Each run now reads the groups' recent posts, 25 groups per run, once.
  - `qualifyOffer` keeps only offers of the searched transaction and city, in all six languages. A separate keyword copy per language is no longer needed, so the same budget covers more groups.
  - `maxItems` is a total cap across the run's groups. Proof: billed results never exceeded the requested limit in 141 runs, many of them over 4–5 groups.
- **Instagram reads profile pages only** (`isInstagramProfileUrl`).
  - The only registered "profile" is a hashtag page (`explore/tags/tbilisihousing`). It billed 1 item and returned 0 useful results in each of 7 production runs.
  - Hashtag, post, reel and story pages are excluded. With no compatible profile, Instagram is reported unavailable (`NO_KNOWN_SOURCE`) and costs nothing.
- **Community relevance** (`communityRelevance`):

  | Level | Meaning |
  |---|---|
  | PROVEN | Has stored property offers (`supply_observations`, last 180 days, paged) |
  | LIKELY | Handle or name says real estate (ka/ru/en/tr/ar/he terms) |
  | UNRELATED | Casino, crypto, jobs, food, books, … |
  | NEUTRAL | Nothing either way |

  Rules applied:
  - Telegram is read only when PROVEN or LIKELY. Facebook groups (registered as real-estate communities) are read unless UNRELATED.
  - PROVEN communities go first, most offers first.
  - A community whose name mentions only another city is skipped, for example a "Batumi" group filed under Tbilisi.

  On production data (Tbilisi sale): 53 of 55 Facebook groups and 41 of 101 Telegram channels are eligible. 12 Telegram channels are UNRELATED and 41 have no evidence of relevance.

### Reaching older listings (2026-10-18)

**Evidence** (production, last 10 days, 89 group runs, 1664 stored posts):
- `onlyPostsNewerThan` is honoured: 0 posts older than the floor.
- The Actor returns posts newest-first and stops at the run's total `maxItems`. 24 of 89 runs hit the cap.
- The average span returned per run is 2.0 days (max 27.5). Inside a capped batch, the busiest group takes most of the posts.

So depth per group is set by posts per group, not by the date window. Find Property asks for 120 days (sale) or 45 days (rent).

**What the planner does now** (verified mechanisms only):
- **Breadth at small budgets:** 25 groups per run. At $5 that is about 34 posts per group over 50 groups.
- **Depth when affordable:** the planner picks the fewest groups per run that the whole budget covers, down to 10. That reaches the Actor's per-group maximum (`max_results` 100), for example about 66 posts per group at $10 and 100 at $30.
- **`search` is gated:** it is honoured only when the registry contract marks it verified (`input_contract.verifiedFields` contains `search`). Restoring keyword runs is then a reviewed registry change, not a code change.

**Open: capabilities named in the schema but never exercised.**
- Fields: `search`, `searchKeywordByYear`, `onlyPostsOlderThan` (time slicing), `resumeCursor` (continuation), `postsPerRequest`, `viewOption`.
- To verify, either read the Actor's published input schema descriptions (apify.com, unreachable from the build environment), or run an owner-approved micro-probe: one group, `maxItems` 10–20, about $0.02–0.04 each.
- Only a field proven by a real run is added to `verifiedFields`.

**Next step after the first paid test: accumulate instead of re-buying.**
- Every campaign stores its offers (`supply_observations`). Results could also serve stored offers from the same communities inside the age window, so older listings come from storage and paid runs read only the new posts.
- This needs an owner decision on reuse across campaigns.

### Instagram: plan to restore it
- **Profiles:** register real Georgian real-estate profiles (agencies, developers) as `INSTAGRAM_PROFILE` sources. The verified profile Actor reads them unchanged, about $0.04 start fee plus $0.80 per 1000 posts.
- **Hashtags / keywords:**
  - Register a memo23 Instagram hashtag or search Actor in `find_buyers_actor_registry`, disabled.
  - The owner verifies its pricing and input contract (Admin, free metadata read), then runs one micro-probe.
  - Only then is it enabled and added to the planner as its own stage (`IG_HASHTAG_POSTS`), fed from `HASHTAGS` per city.
  - The hashtag page currently registered as a "profile" is reclassified, never sent to the profile Actor.
- **Until then** Instagram reports `NO_KNOWN_SOURCE` and costs nothing.

## Money (37% HOMATCH / 63% providers, unchanged)
- **No token, no campaign.** `loadOfferSettings.configured` gates `enabled`. The preview says `PROVIDER_NOT_CONFIGURED`, and start is refused before `beginExecution` reserves anything.
- **The customer pays for confirmed work only.** `find_property_customer_micros` (migration `20261110100000`) counts:
  - Actor runs that have a provider run id;
  - at their actual cost, or at their reservation when the cost is unknown.

  It never counts unstarted reservations or `START_AMBIGUOUS` starts. A start is `START_AMBIGUOUS` when it got a 5xx or network error, or when the campaign ended mid-start.
- **HOMATCH absorbs ambiguous starts.** They stay in `cost_events` (UNPRICED, at their reservation) and in `find_property_committed_micros` (the provider budget). `discovery_runs.provider_cost_usd` reports the committed figure.
- **The customer's live figure uses the same sum.** `my_find_property_campaign.creditsUsed` reads the customer sum.

## Actors, evaluated one by one (production registry, read 2026-10-17)

| Actor key | memo23 Actor | State | Property listings? | Used |
|---|---|---|---|---|
| FB_GROUP_POSTS | `memo23~apify-facebook-group-scraper` | enabled, HEALTHY, $1.50/1k, pricing verified 2026-10-04 | Yes: Georgian real-estate groups carry owner and agent offers with price, area and photos. 44 public GE groups, 41 with a city. | **Yes** |
| TELEGRAM_CHANNEL | `memo23~telegram-channel-scraper` | enabled, HEALTHY, $0.25/1k | Yes: listing channels. Text-rich; photos depend on the post. 51 channels, none with a city (city read from the post). | **Yes** |
| IG_PROFILE_POSTS | `memo23~apify-instagram-profile-scraper` | enabled, HEALTHY, $0.80/1k | Partly: captions and photos, but the price is often missing (posts without a price are dropped). 1 profile registered. | **Yes** |
| FB_POST_SEARCH | `memo23~facebook-search-scraper` | registered 2026-10-17 08:58, **disabled, unpriced** (pricing UNKNOWN) | Yes, for keyword search | No: ready only after the owner verifies it (free) and enables it (separate approval) |
| FB_PAGE_POSTS | `memo23~facebook-page-posts-scraper` | registered 2026-10-17 08:58, **disabled, unpriced** | Yes, for agency pages | No (same; no registered Page sources either) |
| VK_POSTS_COMMENTS | `memo23~vk-posts-comments-scraper` | **disabled, FAILED** | Rare in Georgia | No |
| FB_GROUP_SEARCH, LINKEDIN_GROUPS | group finders | — | No: they find communities, not posts | No |
| FB_COMMENTS, IG_COMMENTS, YOUTUBE_COMMENTS | comments | — | No: comments are the demand side (Find Buyers) | No |
| TIKTOK | `memo23~tiktok-scraper` | enabled, HEALTHY, $2.00/1k | Some: video captions with price (posts without one are dropped) | **Yes** (v2, keyword search) |
| X_PROFILE, THREADS_PROFILE, LINKEDIN_POSTS, REDDIT, QUORA, BLUESKY | — | — | No structured Georgian listing market | No |
| FB_AD_LIBRARY | `memo23~facebook-ads-library-scraper-ppe` | registered 2026-10-17, disabled, unpriced; Verify developer-ads scope | Possible later (ads are offers; its normaliser emits POST items) | No: not in CLAUDE.md's Find Property scope without owner approval |

Nothing is activated by this change. Any Actor that is not registered, not enabled, emergency-disabled, health DISABLED, or not freshly priced is `ready = false`, and the planner skips it.

## Verification done (non-billable)
- **Production, read-only SQL:**
  - the registry rows above;
  - the switches (both OFF; APIFY not disabled);
  - the source counts;
  - 0 Actor runs, 0 stored social offers;
  - the migration not yet applied.
- **No Apify call was made.** This session has no provider token, external hosts are blocked here, and a call could cost money.
- **Local checks:**
  - unit tests: `findPropertySocialListings`, plus `findPropertySocialBilling`, which runs on a fake database and a fake Apify;
  - SQL: `tests/sql/run-find-property-social-listings.sh` on a throwaway Postgres, applying the migration twice;
  - the browser suite, with social badge/note and campaign states in six locales.

## Limitations
- **Possible duplicates only, never merged.** Deduplication against the portals is "possible duplicate" evidence: shared photos or description, plus the same details and place. A repost with different photos and different text still shows, labelled as a social post. Social posts have no address, so the identity engine never merges them outright.
- **Pricing freshness.** Actor pricing was verified 2026-10-04 and expires 2026-11-03 (30 days). After that every Actor is "not ready" until it is re-verified.
- **Shared-client status.** `memo23Client.ts` still answers a missing token with 503. Find Property no longer reaches it (the token is checked first). Changing that shared file is a Find Buyers decision; its session agreed a non-5xx status is right.
- **Release order.** The migration must be applied before the edge functions are deployed: `storeOffers` writes `image_urls`.
- **Not run against the live provider.** Nothing has been checked end to end against the real provider. The first real campaign needs owner approval and a small budget.

## First paid campaign audit and strict results (2026-10-18)

Campaign `f8833757` (50 credits, Tbilisi · Vake · buy · apartment · 3 rooms · 2 bedrooms ·
80–110 m² · new build / under construction · $120–160k), reconciled read-only:

| | Value |
|---|---|
| Reserved / settled / released | 50 / 49.9 / 0.1 credits (`usage_reservations` SETTLED, ledger reserve + capture + release ids present) |
| Provider cost (PROVIDER_REPORTED) | FB groups $1.508 + $1.019, TikTok $0.365, Telegram $0.251 (ABORTED at its own cap) = **$3.143** |
| Revenue | 49.9 credits = $4.99 → gross spread **$1.847 (37.0%)** before VAT and payment fees (not modelled) |
| Posts fetched → offers stored → distinct | 2,846 → 600 → 371 (229 reposts) |
| Strict verdicts (campaignMatch v1) | exact 0 · potential 4 · alternative 3 · rejected 364 (area 224, price 203, district 179, type 142, rooms 110, bedrooms 107, >30 days 71) |

**Why "600 offers" but one result.** Nothing was lost or hidden. The campaign reads
communities' recent posts city-wide; `offers_found` counted every Tbilisi sale offer
(any type, district, price). Its offers were then only re-ranked inside the free
marketplace search with that search's filters, where exactly one social post (a $152k
Facebook post, district unstated) survived. Separately, `results_found` (7) counted the
free search's deliveries, portals included, so three different numbers described one
campaign.

**Telegram.** 1000 posts were billed ($0.251, the run's reservation = Apify
`maxTotalChargeUsd`; the run stopped at that cap, which is the designed behaviour) and 0
became offers. The Telegram Actor's OUTPUT shape has never been verified
(`output_contract_verified_at` null); no Telegram mapping exists in the normaliser. The
worker now records the returned field NAMES (`rawKeys`, never values) when a paid run
yields nothing, so the mapping can be fixed from evidence. Until then Telegram is a
known low-yield allocation (owner decision whether to keep it in paid campaigns).

**Now.** Every ended campaign is judged against the exact request
(`src/research-core/findProperty/campaignMatch.ts`): EXACT (every requirement stated and
met), POTENTIAL (nothing contradicts; unstated requirements listed as unverified, never
inferred; at least two of type/price/area/rooms/bedrooms confirmed), ALTERNATIVE (one of
price/area off by ≤15%; shown only on request), REJECTED (with reasons). Verdicts and a
snapshot of each post are kept in `find_property_campaign_results`; the counts in
`discovery_runs.campaign_outcome`; `results_found` = exact + potential. The campaign has
its own page `/find-property/campaign/:runId` (owner or admin, read through
`find-property-run` action `results`), with held / charged / released credits and no
provider cost. Admin → Discovery shows per-campaign economics (`admin_campaigns`): revenue,
provider cost per run with provider run id and pricing basis, reserved vs actual, budget
use, gross spread, cost per available match; VAT, fees and net margin stay "not modelled".

**20-credit test campaign.** `admin_settings.find_property_test_campaign`
`{enabled, credits: 20, testers: [user ids]}` — OFF by default; admins and listed testers
only; exactly that amount; same reservation (full budget), 37/63 allocation
($2 → $1.26 provider budget), settlement and release. `beginExecution`'s
`minViableOverrideCredits` can only lower the product minimum for that one reservation.

### Paying for fewer, better posts (2026-10-18, before the next live campaign)

**What the providers can filter server-side** (registry `input_contract.schemaProperties`;
apify.com is unreachable from the build environment, so nothing beyond the stored schemas is assumed):

| Actor | Server-side filters | Used |
|---|---|---|
| FB_GROUP_POSTS | `startUrls` (which groups), `onlyPostsNewerThan` (verified), `search` / `searchKeywordByYear` (in-group keyword, **never exercised**) | groups + date; `search` only once verified (one approved micro-probe ≈ $0.02) |
| TIKTOK | `mode: search` + `input` keywords (verified in production) | the request's own phrases |
| TELEGRAM_CHANNEL | channel `usernames`/`startUrls`, `oldestDate`/`newestDate` — no keyword | **excluded** (below) |
| IG_PROFILE_POSTS | profile `startUrls` only | profiles only (none registered) |
| VK_POSTS_COMMENTS | `searchQuery`, `targets`, dates | disabled (health FAILED) |
| FB_POST_SEARCH / FB_PAGE_POSTS | no stored schema, unpriced | disabled |

No Actor filters by price, rooms, area or property type: social posts are free text, so those
requirements can only be checked after the fetch — which is why the fetch itself must be narrow.

**Before any run**
- `requestQueries`: transaction + rooms + type + the wanted district, per language
  ("იყიდება 3 ოთახიანი ბინა ვაკეში", "продается 3-комнатная квартира Ваке",
  "3 room apartment for sale Vake Tbilisi") for keyword Actors.
- Source order: stored offers of this transaction **in the wanted district**
  (`districtEvidence`), then a community named after the district (one named after another
  district last), then proven, real-estate-named, in-city, priority. Small budgets therefore
  read the most relevant communities.
- A small budget covers every network's first run before any run is shrunk to fill it.

**During the campaign — probe-first.** Each network's first run is a probe; its later runs wait
for it and are cancelled **before reserving anything ($0)** when the probe billed ≥ 100 posts and
none could fit the request (strict verdict ≠ REJECTED, counted per run as `useful`). Runs already
started are never aborted.

**Telegram.** Root cause found from stored evidence (258 posts of the same Actor in
`raw_signals`): posts carry channel + message id but no post URL, and offers require an https
link. `telegramPostUrl` builds Telegram's public link `https://t.me/<channel>/<id>`; offline over
those 258 posts: 258 links, 26 Tbilisi sale offers, 123 rent offers. Telegram nevertheless stays
**out of offer campaigns** (`OUTPUT_UNVERIFIED`) until the registry's
`output_contract_verified_at` is set for TELEGRAM_CHANNEL — an owner decision; no paid Telegram
run without approval.

**Backfill safety.** `persistCampaignResults` writes only the campaign's own result rows
(upsert on `run_id, observation_id`, then removes only its stale rows) and
`discovery_runs.campaign_outcome`; it calls no RPC, no wallet, ledger or provider code, and judges
as of the campaign's end so a later backfill gives the same verdicts. Settlement already
happened once (`claimSettlement`); a results read can never charge.
