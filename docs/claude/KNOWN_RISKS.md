# KNOWN RISKS AND SHARP EDGES

Things that have already bitten a session once. Read before they bite twice.

## Deployment

- **CLI success ≠ deployed.** Two silent CLI deploy failures shipped green
  steps; only the exact artifact proof (`scripts/edgeArtifacts.mjs`,
  PROVEN_EXACT) caught them. Trust refs/deployed/* advancement + artifact
  proof, nothing else.
- **Pushing to `main` does not apply migrations.** Migrations are applied
  deliberately, in order, against production — the deploy workflow's ledger
  comparison (`npm run deploy:status`) is the authority.
- **`refs/deployed/*` cannot be pushed from a session** (proxy silently
  no-ops). Only the CI run advances them.
- **`ezbr_sha256` is not reproducible** and is never proof. The eszip module
  diff is.
- **Node resolves what Deno will not.** A bare `@supabase/supabase-js` import
  passes every Node-run test (node_modules has it) and fails the Deno bundler
  after merge; a failed function also stops its deploy list, so later
  functions (and the no-JWT step) stay owed (run 38932203655). `check:edge`
  now refuses any import that is not relative / URL / `jsr:` / `npm:` /
  `node:` unless the function's own `deno.json` maps it.
- **Hand-deploy pair**: `impersonate-user`, `unlock-external-contact` are
  excluded from CI's owed set; changing them means hand-deploying them and
  proving the artifact.

## Database

- **Append-only migrations.** Never edit an applied migration; the hygiene
  gate (`npm run homatch:migrations`) grandfathers frozen history explicitly.
- **The runner owns the transaction.** No top-level `begin/commit` in new
  migrations (the broker-directory migration had to be patched for this).
- **RLS + SECURITY DEFINER everywhere**: never disable RLS; grants are
  guarded by `tests/matrix/functionGrants.test.mjs`.
- **Property contact phones are private.** Required at creation ≠ public.
  No public, indexable, or client-trusted path may expose them.

## Product semantics

- **Internal vs external match.** Never fabricate a HOMATCH user from an
  external lead. Native messaging uses canonical conversations only.
- **Telemetry ≠ intent.** The native pipeline (interaction → source event →
  interpretation → deterministic validation → effective intent) is the only
  path to a match; objection ≠ rejection ≠ interest.
- **Property IDs** are permanent six-digit server-generated immutable.

## Environment (cloud sessions)

- Egress denies homatch.live and *.supabase.co directly: use
  `mcp__Vercel__web_fetch_vercel_url` for site fetches and `pg_net` for
  server-side probes.
- GitHub Actions log blobs are unreachable; use the jobs/steps API.
- Containers are ephemeral: anything not committed and pushed dies with the
  container, including the CBM index cache (`~/.cache/codebase-memory-mcp`).

## Tooling honesty

- The affected-test selector is an iteration aid; only `homatch:check:full`
  plus the pipeline gates decide a release.
- Generated maps are stamped with the HEAD that produced them; a stale stamp
  means regenerate, not trust.
- CBM's index is a map of code, never proof of production state, and its
  in-degree-0 results are not proof of dead code.

## Migration history: clean rebuild

- The repository history is NOT replayable end to end from an empty database.
  `scripts/claude/replay-migrations.sh` (against a throwaway local Postgres,
  with `supabase/replay/platform-bootstrap.sql`) replays it with two repairs:
  the eight legacy `000xx_` files run at their chronological place, and
  `supabase/replay/before/<version>.sql` fills gaps where production objects
  were created by hand and only declared later (the discovery_query_queue
  claim/cost columns; `increment_source_failure`, `rls_auto_enable`).
- It stops at `20260829180000_outreach_schema_reconciliation`: that migration
  renames columns of outreach tables that were built in production by hand
  and were never declared by any migration. Reconstructing them would mean
  inventing their shape. Applied migrations stay frozen; the fix, when
  wanted, is a fragment derived from a production schema dump, not a guess.
- Production ledger versions are MCP-generated for migrations applied through
  the Supabase migration API (e.g. repo 20260929220000 = ledger
  20260929131644). `supabase db push` would therefore see already-applied
  migrations as pending: do not run the workflow_dispatch migrate job without
  first aligning the ledger.

## meta-oauth reads "deduplicated / already-current" in multi-function push deploys
Runs #845 and #848 both left meta-oauth STALE (version unchanged, index.ts mismatched) while the
other owed functions in the same run moved and proved. A single-function dispatch
(`redeploy=meta-oauth`, runs #846/#849) proved it exact both times. The artifact proof caught it;
until the cause is known, redeploy meta-oauth on its own when the proof flags it.

## Entry bundle ratchet at 2.25MB (translations split per language, 2026-09-30; raised 2026-10-16)

`tests/browser/accessibilityAudit.test.mjs` fails the Validate job — and so
blocks every edge deploy — when the Vite entry chunk passes its ceiling. The
entry peaked at 6.21MB (all six languages of `src/i18n/translations.ts` were
imported synchronously); the owner approved 6.5MB for the Meta Ads release
with per-language loading named as the follow-up. That follow-up is done:

- English ships in the entry; ka/ru/tr/ar/he are separate chunks cut from
  `translations.ts` at build time by the `i18nLanguageChunks` plugin in
  `vite.config.ts` and read through `src/i18n/bundles.ts`. `translations.ts`
  stays the single source for apply-scripts, gates and tests.
- `main.tsx` renders after the visitor's language arrives (bounded at 4s; a
  failed chunk renders English), and a switch loads before it switches, so no
  flash of English. `tests/browser/languageChunks.test.mjs` holds both.
- Entry 6.21MB → 1.62MB; ceiling 6.5MB → 2MB.
- 2026-10-16: ceiling 2MB → 2.25MB on the owner's approval. main had reached
  2,095,069 bytes (gzip 599,713 / brotli 481,749); the Service Control Center
  added 10,376 (+3,590 gzip / +2,313 brotli): 6,018 English strings, 3,073 the
  route gate, 777 routes/nav/icon. Way back down (follow-up, not done): move
  admin-only modules already in the entry (AdminLayout, admin/navigation,
  AdminSearch, adminControl, admin/labels, ~24KB) and admin-only English
  strings out of it.
- Keep new runtime code off `@/i18n/translations` and `@/i18n/appContent`
  (value imports): either one puts all six languages back into the entry. Use
  `@/i18n/bundles` or `@/i18n/locales`; type imports are free.
- Watch-out seen during this release: Vercel auto-deploys `main` even when the
  Validate job fails, so a failed deploy run can leave a NEW frontend live
  against OLD edge functions. Check both after every main merge.

## Find Property HTML portals (2026-10-15, PR #210)

- Adapters read public HTML that the sites can change at any time. Each parser is
  pinned by real-page fixtures (`official-worker/test/fixtures/portals/`), and
  `scripts/portals/live-check.mjs` re-proves them end to end from a network that
  reaches `.ge` hosts (a GitHub runner; the cloud dev sandbox cannot).
- Home.ge and Allhome.ge have no usable public search: Home.ge's search pages
  return an empty body, and Allhome.ge's live under robots-disallowed
  `/index.php?*`. Both are read from the site's own sitemap, newest id first,
  with 24 listing pages per index read. The sitemaps are cached for 6 hours in
  process memory (Home.ge's are about 12 MB each).
- Price/area filters on Home.ge and Allhome.ge apply only after the listing page
  is read (shared `contradiction()` in `portals/acquire.mjs`); a narrow budget
  can therefore yield few results from a large read.
- Brokeri.ge adds a handful of listings a month; most of its catalogue is older
  than the platform's 30-day listing-age policy (`freshness.ts`), so most
  Brokeri results are rejected by the pipeline (correctly). Do not loosen the
  policy for one source.
- No portal publishes a contact number on the listing page except Place.ge and
  Brokeri.ge; Home.ge/Allhome.ge reveal numbers only through a click-through
  request, which is never automated.
- Districts (2026-10-16): portal sources apply a strict district check in the
  worker (`portals/places.mjs`) — a listing naming any place other than a requested,
  known district is dropped; one naming none is kept. Home.ge narrows by sitemap
  slug; Place.ge's server ignores every district parameter (live probe 2026-10-16),
  so it, Allhome and Brokeri check districts only after reading. Adaptive depth
  (2026-10-16, `acquire.mjs`): when a request can only be checked after reading,
  a source keeps reading (Place.ge to 8 pages, Brokeri/Allhome/Home.ge to 6
  windows; a re-read sitemap yields its next unread window) until 24 listings fit,
  the source runs out, or the job's time budget (60 s reserve) — the report's
  `queryApplied.adaptiveDepth` says which. An honest empty result is still possible
  for a small district. A district outside `normalize/place.ts` disables the
  narrowing (city read).
- Requested districts are compared under every spelling in `normalize/place.ts`
  (`districtFit`), so a Latin request ("Krtsanisi") excludes a listing that names a
  different Georgian neighbourhood instead of keeping it as "district unverified"
  (found in a live production search, 2026-10-16). A neighbourhood inside a district
  (Ortachala for a Krtsanisi request) is still a different place; ask for both.
- SS.ge (2026-10-16): a district SS.ge's own location list cannot resolve used to
  fail the whole source with 0 pages (production search 645ba0d0, Krtsanisi +
  Ortachala). It now reads the city instead (never a partial district set) and
  reports `queryApplied.districtFallback`; the results pipeline checks districts per
  listing. Which of the two names SS.ge misses is still unproven offline (its
  location list is fetched live).
- Search results reuse recent observations from earlier searches (cache); those are
  not live results for the new search and must not be counted as such in tests.
- Prices below 10 (Home.ge's "1 ₾" placeholder) are dropped as no price
  (`withoutPlaceholderPrice`), never shown as in-budget.
- Korter.ge is BLOCKED_BY_TERMS (terms §5.3: "You must not use any scraping
  technology on the Site") and Binebi.ge answers every public page with a
  Cloudflare challenge. Neither is registered; a test pins that.

## Find Property → HOMATCH network: native matching scale (2026-10-16)

- The 500-property / 600-search windows are gone: `supply-matching` and
  `run-matching-v2` read every candidate in keyset pages and resume from
  `match_scan_checkpoints` / the leased `native_match_property_queue` when an
  invocation runs out of time; matches are retired only after a complete pass.
- Throughput: scoring is ~6 µs per pair (`scripts/bench/nativeMatching.mjs`,
  100k properties ≈ 0.6 s CPU per demand); at scale the cost is database I/O and
  one `upsert_native_match` RPC per compatible pair, so a very large pass spans
  several 15-minute sweeps — the response's `coverage` says how far it got.
- The global memo23 lane counts Find Property runs and Find Buyers runs from the
  Find Property side only; `find_buyers_reserve_actor_run` (Find Buyers' workstream)
  still counts only its own table, so the combined in-flight total can exceed
  `discovery_provider_concurrency.APIFY_MEMO23` by Find Property's share.

## Find Property: criteria no source publishes (2026-10-16)

SS.ge never publishes a construction year and MyHome almost never does (1 of 385
recent listings, as ">2000"). A search with a maximum building age therefore cannot
have strong matches: every result keeps BUILDING_AGE unverified. This is correct
(strong = every requested fact confirmed); the results header now names the
missing facts ("why not strong"). Do not relax the rule to hide it.
