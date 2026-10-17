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

## Money (37% HOMATCH / 63% providers, unchanged)
- **No token, no campaign.** `loadOfferSettings.configured` gates `enabled`. The preview says `PROVIDER_NOT_CONFIGURED`, and start is refused before `beginExecution` reserves anything.
- **The customer pays for confirmed work only.** `find_property_customer_micros` (migration `20261110090000`) counts:
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
| FB_POST_SEARCH | `memo23~facebook-search-scraper` (catalog seed) | **not registered** in production | Yes, for keyword search | No: becomes ready only after Admin verifies it and confirms its price |
| FB_PAGE_POSTS | `memo23~facebook-page-posts-scraper` (seed) | **not registered** | Yes, for agency pages | No (no registered Page sources either) |
| VK_POSTS_COMMENTS | `memo23~vk-posts-comments-scraper` | **disabled, FAILED** | Rare in Georgia | No |
| FB_GROUP_SEARCH, LINKEDIN_GROUPS | group finders | — | No: they find communities, not posts | No |
| FB_COMMENTS, IG_COMMENTS, YOUTUBE_COMMENTS | comments | — | No: comments are the demand side (Find Buyers) | No |
| TIKTOK, X_PROFILE, THREADS_PROFILE, LINKEDIN_POSTS, REDDIT, QUORA, BLUESKY | — | — | No structured Georgian listing market | No |
| FB_AD_LIBRARY | `memo23~facebook-ads-library-scraper-ppe` | Verify developer-ads scope only | — | No (not allowed here) |

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
