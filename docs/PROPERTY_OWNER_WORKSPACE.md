# Property Owner Workspace (seller side)

Owner → My Property → Property Detail → buyer/tenant discovery. Not Marketplace
Search (buyer side, PR #72).

## Why the imported photo disappeared (production property 244486)

Traced end to end on 2026-10-03:

1. `import-property` extracts image URLs from the portal page and returns them; it
   never downloads them. `URLImportPage` writes the portal's own URL
   (`https://static-statements.tnet.ge/…/XXB2rD26a8603155deb3.webp`) into
   `properties.cover_photo_url`, `property_facts.cover_image` and
   `property_facts.gallery_images`. `property_photos` is empty and HOMATCH storage
   holds nothing for it.
2. Every view therefore **hotlinks** myhome.ge's image CDN. `resolveImageSrc`
   returns absolute URLs untouched; `PrivateImage` rendered them with the site's
   `strict-origin-when-cross-origin` referrer.
3. When that host stops serving the file to us (listing edited/removed at the
   source, or the host refusing a foreign referrer — `PrivateImage`'s own comment
   records it was already refusing in production), `onError` fired and the
   fallback was a blank/grey box with no explanation.

What could not be determined from this environment: whether tnet.ge removed the
file or refuses our referrer — outbound requests to myhome.ge / tnet.ge are
blocked by the session's egress policy. The fix covers both: external images are
now requested with `referrerPolicy="no-referrer"` (the same policy the Find
Property cards already use for these hosts), and when the file is genuinely gone
the owner is told so and offered the exact listing and "update in HOMATCH".
HOMATCH never copies the third-party image into its own storage.

## Canonical media

`src/property/gallery.ts` — HOMATCH-managed storage keys always lead (owner's
cover first, then their order); external portal images follow, deduplicated,
never first. A broken external link can never stand in front of a working
managed photo. Provenance (`source_url`, `cover_image`, `gallery_images`) is kept.

## 30-day freshness (server-authoritative)

Migration `20261011100000_property_owner_lifecycle.sql`:

| Object | Purpose |
|---|---|
| `properties.freshness_anchor_at` | start of the current window (creation or last renewal) |
| `properties.owner_confirmed_at` | last explicit owner confirmation; null = never |
| `property_freshness_state()` | ACTIVE 0–23 d · EXPIRING_SOON 24–29 d · EXPIRED 30+ d |
| `my_property_lifecycle(ids)` | the owner's view, computed with the DB clock |
| `renew_property(id)` | free, owner-only, row-locked, idempotent (60 s) |
| `set_property_availability(id, bool)` | "no longer available" on archive semantics; fixes the missing `archived_at` grant |
| `properties_freshness_guard` trigger | matching cannot be switched on while EXPIRED |
| `property_freshness_sweep()` + cron `homatch-property-freshness` (hourly :23) | pauses expired discovery (records it), notifies at 24 d and 30 d |
| `property_facts_keep_provenance` / `_stamp_import` | source URL / listing id / health survive owner edits; `imported_at` stamped server-side |
| `record_property_source_check()` (service role) | source health; LISTING_NOT_FOUND only after two consecutive not-found |

Backfill: existing rows get a full window from the moment the migration runs;
`owner_confirmed_at` stays null; `imported_at` for URL imports = `created_at`.
Nothing is deleted when a property expires; matches, photos, provenance and
history are untouched. Renewal resumes exactly the matching the sweep paused.

Discovery guard in three places: client pre-check (`startMatchingCampaign`), the
DB trigger, and `match-campaign` (409 `PROPERTY_EXPIRED`, before any campaign row
is touched; pause/resume/stop unaffected).

Source health has no automatic checker yet: states stay UNKNOWN until a real
check calls `record_property_source_check`. The UI says nothing for UNKNOWN.

## Release

- Migration: apply once (Supabase MCP, as for every post-baseline migration).
- Edge: `match-campaign` (existing function, no new slot).
- Frontend: Vercel.
- Tests: `tests/sql/run-property-lifecycle.sh`, `tests/matrix/propertyOwnerWorkspace.test.mjs`,
  `tests/mobile/propertyOwnerWorkspace.test.mjs` (suite `mobile:routes`).
