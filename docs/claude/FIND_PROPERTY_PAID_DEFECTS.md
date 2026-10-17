# Find Property paid Extended Search: open defects (2026-10-17)

Status: **paid search stays OFF**. In production, `find_property_social_enabled` = false and `find_property_discovery_enabled` = false. No paid run has been started in the last 24h. Both defects below block go-live. Each is independent and can ship as its own PR.

Code references are against main `8218107c`.

## Defect 1: the customer is charged when the provider is not configured, or when a run start is ambiguous

**Symptom.** If `APIFY_API_TOKEN` is missing, or Apify answers 5xx or a network error when a run starts, the customer still pays even though no provider work was done. On today's registry a $5 campaign would be charged about 23 credits.

**Root cause.** Three things combine:
1. **The missing token looks like a server error.** `supabase/functions/_shared/findBuyers/memo23Client.ts:29` throws `Memo23Error('APIFY_NOT_CONFIGURED', 503, false)`, a 5xx status.
2. **Every 5xx start is booked at the full reservation.** `supabase/functions/_shared/findProperty/socialOffers.ts:194-196` treats `status === 0 || status >= 500` on start as "the run may exist" and books it with cost basis `UNKNOWN`. UNKNOWN rows count at their full reservation in `find_property_committed_micros`.
3. **Settlement charges that booked amount.** `settlePaidSocialRun` (`supabase/functions/_shared/findPropertySettlement.ts`, `creditsForSpend` → `wallet_settle`) charges committed spend ÷ 0.63, even when nothing was delivered.

**Nothing upstream stops it.** No Find Property path checks `providerConfigured()`. Find Buyers does, in `_shared/findBuyers/readiness.ts:11-13`; Find Property's `loadOfferSettings` (`socialOffers.ts:46-53`), `find-property-run` preview/start and `paidAvailability.ts` do not.

**Safe fix (small, test-first):**
1. **No money moves without a token.** In `loadOfferSettings`, add `configured: providerConfigured()` and require it in `enabled`. `find-property-run` preview/start then returns `PROVIDER_OFF` / unavailable before `beginExecution` reserves anything. `paidAvailability.ts` already follows `offers.enabled`.
2. **A missing token is not a 5xx.** In `memo23Client.ts:29`, use a non-5xx status (e.g. 412) so the start path books `NOT_STARTED` at 0. Check that Find Buyers `executor.ts` handles it the same way.
3. **The customer never pays for an ambiguous start.** In the ambiguous-start branch (`socialOffers.ts:194-198`), first look the run up at Apify. If it doesn't exist, book `NOT_STARTED` at 0.
   - If it can't be determined, keep booking it as HOMATCH COGS (`UNPRICED`, so cost is never silently zero) but mark the row `START_AMBIGUOUS`.
   - Exclude `START_AMBIGUOUS` rows from the customer settlement sum.
4. **Tests:**
   - token missing → preview unavailable and no reservation;
   - 503 on start → customer charge 0 and a COGS row exists;
   - a normal run → unchanged ÷ 0.63 charge capped at the reservation.

## Defect 2: offers found by the paid campaign are never shown to the customer

**Symptom.** A paid campaign stores the offers it finds and the matcher scores them. The customer only ever sees two numbers: "offers found" and "results delivered".

**Root cause:**
- **Offers are stored and matched, but in other tables.** Offers are upserted into `supply_observations` (`socialOffers.ts` `storeOffers`). `supply-matching` then writes `supply_matches` for the run's intent profile.
- **The live UI never reads those tables.** The live Find Property route renders `MarketplaceSearchExperience`, which reads only `discovery_marketplace_*`. `PaidCampaignPanel.tsx:250,272-273` renders only `offersFound` / `resultsFound`.
- **The only readers are elsewhere.** `src/services/findProperty.ts:249` `readResults()` is used only by the legacy page and the broker's `ClientSearchResults.tsx:17`.

**Safe fix:**
1. **Owner-only read.** Add a read RPC (or reuse `readResults(limit, subscriptionId)`), scoped to the campaign's run (observations whose provenance names this run's actor runs) and checked against `auth.uid()`.
2. **Show the offers in the campaign view.** Add an offers list to `DeepSearchPanel` / `PaidCampaignPanel`:
   - Use the existing compact card style (photo, price, place, rooms/area, real source on the card, link to the original post).
   - Copy in six locales through an apply-script pair.
   - Include an empty state when matched = 0.
3. **Decide whether customers see unmatched offers.** Customers are charged for consumed spend even when nothing matched (37/63 policy). Either show raw unmatched offers in a separate "other offers we found" group, or state the policy plainly on the confirmation step.
4. **Tests:**
   - a browser premise that a campaign with delivered offers renders them;
   - an RLS test that another user cannot read them.

## Before turning paid search on
- Both fixes above are merged, deployed and proven.
- Actor pricing is re-verified before 2026-11-03, when the 30-day freshness window lapses and every actor becomes "not ready".
- `find_property_discovery_enabled` and `find_property_social_enabled` are switched on only with explicit owner approval.
