# HOMATCH object storage: Cloudflare R2 architecture

Cloudflare R2 is HOMATCH's primary object store. Supabase Storage remains only
where there is a demonstrated reason (below). Postgres stays the system of
record for ownership, metadata and authorisation.

Sources of truth in code:

| Concern | File |
|---|---|
| What a key may look like, per namespace/category content policy | `supabase/functions/_shared/storage/keys.ts` |
| Who may read/write/delete a key | `public.storage_authorize(key, action)` (latest: `20261107090000_storage_r2_routing.sql`) |
| Browser upload/read/delete (presigned, HEAD-verified commit) | `supabase/functions/storage-sign` + `src/services/storage/objectStore.ts` |
| Bucket-path routing (R2 first, Supabase fallback, per-bucket write switch) | `_shared/storage/routed.ts` (server), `src/services/storage/routed.ts` (browser) |
| Copy of legacy Supabase objects into R2 (size + md5 + sha256 + HEAD) | `supabase/functions/storage-migrate` |
| End-to-end proof (signed/unsigned/expired/tampered reads, delete) | `supabase/functions/storage-selftest` |
| R2 index | `public.storage_objects` |
| Inventory and the write switch (admin) | `storage_admin_inventory()`, `storage_admin_set_write_target()`; Admin → Storage → "Storage by service" |
| Disposable-object retention | `docs/infra/STORAGE_RETENTION.md` §10–11 |

## 1. Bucket and prefix architecture

One private R2 bucket (`homatch-storage`). Public bucket access is disabled;
every read is a short-lived SigV4 URL (≤ 15 min) minted after
`storage_authorize` says yes. Security separation is by **prefix + Postgres
rule**, not by bucket, so there is one credential set and one place to audit.

Top-level prefixes, as seen in the Cloudflare dashboard:

```
users/<users.id>/<category>/[<entity uuid>/]<object uuid>.<ext>   everything a person owns (new scheme)
    property-photos/<property id>/          Property listings
    design-studio-floorplans|models|thumbnails/<ds_project id>/   Design Studio (customer)
    deal-room-documents/<deal room id>/     Contracts / Deal Room (category ready; uploads still path-routed, below)
    mortgage-documents/<offer id>/          Mortgages
    developer-documents|developer-media/<workspace id>/   Developer projects
    expat-attachments/<task id>/            Expat tasks
    generated-reports/                      Generated reports (retention category `generated_report`)
design-studio/catalog/<public|licensed|restricted>/<area>/<hma>/<hmv>/<file>   Design Studio catalogue (licensed assets)
meta-ads-media/<users.id>/...               Meta Ads creatives (images, videos, covers/, ai/<job>/, composed/)
deal-room-documents/<auth uid>/<room>/<doc>.<ext>   Contracts (bucket-path routed)
mortgage-offer-documents/<auth uid>/<uuid>.<ext>    Mortgage offers (bucket-path routed)
developer-documents/<workspace>/<folder>/<key>.<ext>  Developer documents (bucket-path routed)
voice-auditions/...                         AI TALK voice samples (staff only)
site-assets/ system/ research/              HOMATCH-owned assets
diagnostics/  retention-selftest/           self-tests only
```

Why `users/<id>/<service>/…` rather than `<service>/<user>/…`: every file a
person owns sits under one prefix, which is what account export, account
deletion and the per-key ownership rule need; the service is the next segment,
so a person's folder reads by service. The Admin "Storage by service" panel
gives the cross-account per-service view that a prefix browser cannot.

Key rules (enforced by `parseKey` and `storage_authorize`): uuids only, no
names, emails, phone numbers or uploaded filenames in any key (the display name
is `storage_objects.original_filename`); fixed depth per category; extension
chosen from the declared MIME type; no `..`, empty segments, backslashes or
control characters.

## 2. Bucket-path routing (this change)

Products that already store a Supabase *path* keep storing exactly that path.
In R2 the same file is `<bucket>/<path>` — the key storage-migrate copies to.
Therefore:

- **Reads** (`readRouted`, `signRouted`, `signedRoutedUrl`) try R2 first and
  fall back to Supabase Storage. They work for a file in either store, before,
  during and after a migration, and do not depend on the write switch.
- **Writes** (`writeRouted`, `uploadRouted`) go where `storage_r2_routing`
  says for that bucket: `SUPABASE` (seeded) or `R2`. Browser R2 writes go
  through storage-sign (PENDING row → presigned PUT → HEAD-verified commit →
  ACTIVE); server R2 writes PUT, confirm by HEAD (size must match), index
  ACTIVE with sha256, and remove the object if any step fails (no orphans).
- **Removes** reach both stores; the R2 index row is kept, marked `DELETED`.
- **No row is rewritten.** Rolling a bucket back is one call
  (`storage_admin_set_write_target(bucket, 'SUPABASE')`) and reads keep working.

Routed buckets: `meta-ads-media`, `deal-room-documents`,
`mortgage-offer-documents`, `developer-documents`.

## 3. Current vs target, by service (production, 2026-10-16)

| Service | Today | Target | Status / reason |
|---|---|---|---|
| Design Studio catalogue + customer files (10,966 objects, ~16 GB) | R2 | R2 | Done (pre-existing) |
| Property listing photos | R2 (`users/…/property-photos/`); legacy Supabase fallback reader | R2 | Done; legacy bucket holds 0 objects |
| Meta Ads creatives (13 objects, 15 MB) | Supabase `meta-ads-media` | R2 `meta-ads-media/…` | Routed; copy + switch per §4 |
| Contracts / Deal Room (8 objects, 1.2 MB; 5 already copied) | Supabase `deal-room-documents` | R2 `deal-room-documents/…` | Routed; switch after verification |
| Mortgage offer documents (0 objects) | Supabase | R2 | Routed; new keys no longer contain the customer's filename |
| Developer documents (0 objects) | Supabase | R2 | Routed |
| AI TALK voice samples (9 objects) | Supabase + verified R2 copies | R2 | Copied; reads still Supabase (staff-only feature) |
| Verify official-document cache (10 objects) | Supabase `verify-documents` | **Supabase** | Kept: retention v2 allowlist (`retention_location_eligible`) and its 30-day rule are bound to this bucket; Verify is a protected surface |
| Verify evidence (87, 43 MB) and report visuals (165, 141 MB) | Supabase | **Supabase** (for now) | Kept: content-addressed shared caches written by research-agent/verify-queue (signed upload URLs), protected surface; a move needs its own reviewed cutover |
| Developer media, broker logos, site assets | Supabase (public buckets) | **Supabase** | Kept: live pages link to stable public URLs; R2 here has no public delivery |
| DM / live-chat media, broker verification, contact imports | Supabase (empty today) | Supabase | Kept: small, short-lived, RLS-bound to conversation membership |
| Generated reports | — (no producer) | R2 `users/…/generated-reports/` | Category + retention ready |

## 4. Migration procedure per routed bucket

1. **Copy** (non-destructive): run `storage-migrate` with a single-use proof
   ticket. Each object is verified by size, Supabase-vs-R2 md5, sha256 of the
   bytes read back out of R2, and HEAD; `storage_objects.verified_at` is stamped
   only when all agree. A differing existing destination is `CONFLICT`, never
   overwritten.
2. **Verify reads**: compare `copied_to_r2` with object counts (Admin
   inventory); run `storage-selftest` (signed read, unsigned/tampered/expired
   refused); confirm `storage_authorize` owner/other/admin/anon in production.
3. **Switch new uploads**: `storage_admin_set_write_target(bucket, 'R2')`
   (audited in `admin_audit_log`). A category counts as fully migrated only
   after a real new upload is observed as an ACTIVE R2 row AND its read works.
4. **Rollback**: switch back to `SUPABASE`. Nothing else changes; files written
   to R2 while switched stay readable (R2-first reads).
5. **Source cleanup** (separate, owner-approved, never automatic): only when
   every referencing row resolves to a `verified_at` R2 copy, after a soak
   period, with a dated manifest of the Supabase objects to remove and their
   sha256. Until then the Supabase original is the rollback.

## 5. Retention interaction

Retention v2 deletes only `retention_location_eligible` locations: the Verify
document cache in Supabase (`verify-documents/files/<id>`), R2
`users/<id>/generated-reports/<uuid>`, and the self-test keys. None of the
routed buckets is eligible; routing cannot make any customer file deletable.
Adding a location requires a reviewed migration.

## 6. Costs

Not estimated in-product. Object counts and bytes come from the two indexes;
spend comes from the Cloudflare and Supabase invoices.
