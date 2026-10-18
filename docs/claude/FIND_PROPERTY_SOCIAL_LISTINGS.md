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
