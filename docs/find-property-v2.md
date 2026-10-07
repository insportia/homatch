# Find Property V2 release evidence

## Architecture and behavior

`/find-property` is an authenticated owned-search workspace. Metadata-only history is ordered by creation time and ID, with 12 records per page. Starting a search inserts a new search; older searches remain accessible, including when the newest search fails. Server ownership comes from authentication, never a supplied user ID. Acquisition being disabled does not disable access to saved searches.

`/find-property/new` reuses SearchBuilder and Search Intelligence. `/find-property/search/:searchId` opens exactly that saved search. `/find-property/search/:searchId/property/:propertyKey` opens a full canonical property dossier. Query parameters preserve results page, filters, sort and revision on return. Legacy `?search=` links redirect to the durable route.

Canonical resolution, complete-linkage/veto safety, hard constraints, 30-day freshness, bounded upgrades and 12-result pagination are preserved. Compact cards provide accessible touch/keyboard photo galleries, reliable dates, canonical source/listing counts and brief reasons. The dossier exposes collected photos, source observations, asking-price differences, seller evidence, match reasoning and unknowns. Unknown evidence stays unknown. Upgrade labels calculate the amount above the requested maximum, independently of the premium over a comparison property.

Property AI uses the existing useAIChat/homatch-ai conversation and AI_CHAT_RESPONSE measured billing path. Context is resolved from owned stored property evidence on the server; client facts are ignored. Context is bounded to 12 source observations, 2,400 description characters and 12,000 serialized characters. Property conversations retain their scope. Existing reservation metadata atomically claims provider execution and prevents concurrent/replayed paid turns from running twice. Ambiguous retries retain interactionId; insufficient credit preserves the conversation and question. Renovation estimates require ranges, assumptions and uncertainty, rather than invented construction prices.

No database migration, new dependency, acquisition contract change, shared billing-price change or deployment is included. The legacy read-only catalogue reconstruction is shared with dossier and AI reads to support older capped result views.

## Read-only production inspection

Five existing searches were inspected without modifying customer data or charging credits. A failed search coexists with older successful/partial searches. The 143-property search contains two upgrades at $205,000 and $215,000 against a $200,000 maximum; neither is in BEST. No above-maximum BEST result was found in the inspected searches.

One historical search stores 29 views but metadata describes 78 accepted properties; existing read-only reconstruction recovers the remaining catalogue. This compatibility is retained for property details and AI context. History counts are saved completion metadata, not a claim of today's fresh inventory.

Current inspected production searches contain one source and no multi-source price-discrepancy example. Multi-source presentation and bounded AI context are tested with fixtures; live multi-source validation remains unavailable. No entity thresholds were changed without production evidence. Unavailable publication dates, comparable prices and renovation market costs are not manufactured. Live paid AI was not invoked against customer wallets during development.

## Validation

- Marketplace/core focused regression: 88/88 passed (including initial workspace coverage).
- Server marketplace/AI routing matrix: 34/34 passed; final expanded workspace suite: 8/8 passed.
- Existing measured billing gates: 3/3 passed. Runtime boundary guard: 1/1 passed.
- Browser regression: initial 30 viewport/locale combinations passed at 375, 390, 768, 1280 and 1440 across all six locales. Three initial failures were corrected and their targeted checks passed.
- Final targeted browser runs: desktop paid-context/retry and Georgian lifecycle passed; mobile 375 English and 393 Arabic RTL, dossier failure recovery and malformed-history recovery passed. Existing exact-source attribution: 1/1 passed.
- Typecheck passed. Scoped Biome: 11 files passed. Six-language keys: 14,978 canonical keys, no missing literal keys. Earlier coverage check: 100% across six locales; the subsequent dossier-error key is supplied in all six.
- Changed edge functions/helpers: 6 files, zero syntax errors. This is a syntax check, not a Deno cross-module typecheck.
- Production Vite build passed (6,777 modules, 10.24 seconds), with existing chunk-size warnings.

Browser fixtures are test evidence, not claims of live customer UI validation. Screenshots and detailed logs are retained locally under `myhome-worker/diagnostics`. Repository-wide validation belongs to PR CI. Merge and deployment require explicit authorization.
