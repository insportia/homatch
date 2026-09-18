# Object storage

Binary files — contracts, photos, plans, recordings — live in object storage.
Structured data stays in Postgres. This document describes the layer that was
built to hold them, what has actually been proven about it, and what has not
happened yet.

## The shape

```
browser ──► storage-sign (edge function)
                │  1. who is this?      auth.getUser() on the caller's own JWT
                │  2. may they?         is_admin() / dev_can() / uid comparison,
                │                       asked in Postgres AS THE CALLER
                │  3. sign              AWS SigV4, 15–900 seconds, one verb,
                │                       one object
                ▼
            Cloudflare R2 (homatch-storage, private, EEUR)
```

The credential exists in exactly one runtime — Supabase Edge Functions — and is
read by exactly one module, `supabase/functions/_shared/objectStore.ts`. Vercel
is a static host and holds none. Railway holds none. The browser bundle holds
none, and a test fails the build if any of that changes.

### Files

| File | What it is |
|---|---|
| `_shared/storage/sigv4.ts` | AWS SigV4 query-string presigner. Pure, Web Crypto only. Verified against AWS's own published example. |
| `_shared/storage/keys.ts` | The key namespace and, per namespace and verb, what a caller must be. One entry per live bucket. |
| `_shared/storage/decide.ts` | The authorisation decision, with its two database answers injected so every branch is testable. |
| `_shared/objectStore.ts` | The only reader of an R2 credential. Sign, put, head, get, delete. |
| `_shared/storageAuth.ts` | Wires `decide` to real queries under the caller's token. |
| `storage-sign/index.ts` | The one door. `sign`, `exists`, `delete`, `status`. |
| `storage-selftest/index.ts` | Proves the bucket end to end. Ticket-gated. |
| `src/services/storage/objectStore.ts` | The browser's half. Holds nothing. |
| `src/services/storage/images.ts` | Resolves a stored value — URL or private path — into something an `<img>` can load. |

### Keys

A key is `<namespace>/<the object's old Supabase path>`, where the namespace is
the legacy bucket id. One R2 bucket holds all of them. The mapping is the
identity with a prefix precisely so that a migration is a copy and a rollback is
"read from the old place again".

### Who may do what

Mirrored from the twenty-two RLS policies on `storage.objects`, read out of
production rather than remembered.

| Namespace | Read | Write | Delete |
|---|---|---|---|
| `deal-room-documents` | owner | owner | owner |
| `developer-documents` | `dev_can(ws,'documents')` | same | same |
| `developer-media` | anyone | `dev_can(ws,'inventory')` | same |
| `mortgage-offer-documents` | owner | owner | owner |
| `property-photos` | any signed-in user | same | same |
| `site-assets` | anyone | admin | admin |
| `voice-auditions` | admin | admin | admin |
| `diagnostics` | admin | admin | admin |

Two of these are looser than they look, and both are loose because production
is loose in the same direction today:

- **`property-photos`** — `photos_select_own_storage` and
  `photos_delete_own_storage` check only that a session exists. Any signed-in
  user can read or delete any photo. That is a real weakness. Tightening it is
  a separate change with a visible consequence, not something to slip into the
  pass that moves the bytes.
- **`developer-media` and `site-assets`** — world-readable, because both
  buckets are public today and live pages link straight at them.

## What has been proven

Against the real `homatch-storage` bucket, on 2026-09-18, by
`storage-selftest`. Ten checks, all green:

1. All five secrets present (booleans only; no value printed or logged).
2. A real private upload — 82 bytes, etag returned by R2.
3. The object exists in R2: size and md5 both match the upload.
4. A 120-second signed read returns bytes whose SHA-256 matches what went in.
5. The same URL with no signature is refused and returns nothing (R2 answers
   `400 InvalidArgument`, not 403 — a refusal either way).
6. A signature altered by one character: `403`.
7. A valid signature for a different key, pointed at this object: `403`.
8. A 15-second URL works, then fails with `403` after waiting 17 seconds.
9. Delete.
10. Gone: `HEAD` says it does not exist, `GET` returns `404`.

And against `storage-sign` from outside, with no user session: every private
namespace answers `401 UNAUTHENTICATED`, traversal and unknown namespaces answer
`400 INVALID_KEY`, and only `site-assets` — which is public today — signs.

## What has NOT happened

**No production object has been migrated.** All 14 objects are still in
Supabase Storage and every product read and write still goes there.
`images.ts` carries a single constant, `PHOTO_PROVIDER`, which is the switch.

## A note on what a presigned URL discloses

SigV4 puts the ACCESS KEY ID in the URL, as `X-Amz-Credential`. That is an
identifier, not a secret — it cannot sign anything without the secret key,
which never leaves the edge runtime. But it does mean the account id and key id
are visible to anyone who receives a signed URL, including anonymous visitors
for the two public-read namespaces. If that becomes unwanted, the answer is a
Cloudflare custom domain for public assets, not a change to this layer.

## Proof tickets

`storage-selftest` is authorised by a row in `public.storage_proof_tickets`:
single use, expiring, stored as a SHA-256 so the row itself grants nothing. To
run the proof, insert a ticket with the hash of a token you generate, then call
the function with that token in `x-proof-ticket`. This exists so the bucket can
be proven without creating a production account or copying the service-role key
anywhere.
