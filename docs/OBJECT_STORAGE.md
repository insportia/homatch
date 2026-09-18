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
`storage-selftest`. Fifteen checks, all green — the first ten on a throwaway
diagnostics object:

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

and five on real data:

11. A migrated deal-room document read back out of R2 hashes identically to
    the Supabase original, which is still present.
12. The same for a migrated voice audition.
13. A new account-scoped private object — written, found in R2, read back
    byte-identical through a signed URL, refused without the signature, and
    present in the index with the right owner and category.
14. That object removed, and confirmed gone.
15. The bucket inventory measured from R2's own listing: 14 objects,
    1,569,425 bytes, no diagnostic object left behind, and the ledger's
    active-row count agreeing.

### The migration

14 source objects, 14 copied, 14 verified identical, 0 failed, 0 conflicted,
14 retained in Supabase. Each object was checked four ways and all four had
to agree: size, md5 (Supabase's etag against R2's — two services, neither
told the other's answer), sha256 of the source against the bytes read back
out of R2, and R2's own HEAD. Re-running copied nothing and re-verified all
14, which is what idempotent means here.

Ownership was resolved from the database, never guessed: 12 from a domain row
(`deal_room_documents.user_id`, `voice_audition_samples.created_by`), 2 from a
key prefix that matches a real account, 0 unresolved.

And against `storage-sign` from outside, with no user session: every private
namespace answers `401 UNAUTHENTICATED`, traversal and unknown namespaces answer
`400 INVALID_KEY`, and only `site-assets` — which is public today — signs.

## The account-scoped key

Everything a person owns, from now on:

```
users/<users.id>/<category>/<entity uuid>/<object uuid>.<ext>
users/<users.id>/<category>/<object uuid>.<ext>
```

A uuid rather than an email, because an address changes and is personal
information, and a key ends up in logs, in the Cloudflare dashboard and
inside a URL. The object is a uuid rather than the uploaded filename for the
same reason; the display name lives in `storage_objects.original_filename`
and is reunited with the object only in a `Content-Disposition` header.

Categories: `property-photos`, `deal-room-documents`, `developer-documents`,
`developer-media`, `mortgage-documents`, `expat-attachments`,
`generated-reports`. An unlisted one is refused, not defaulted.

**Registering creates nothing.** A prefix in object storage is a substring of
a key, not a directory, so there is nothing to make until the first upload.
The Storage Explorer still finds a new account with 0 files and 0 bytes,
because it starts from `users` and LEFT JOINs the objects.

**Developer files are workspace-owned, not account-owned.** Under
`users/<uploader>/developer-documents/<workspace>/…` the account segment
records who uploaded it; `dev_can(workspace, 'documents')` decides who may
read it. Somebody who leaves the workspace loses the file and their
colleagues keep it, which is correct and is the opposite of what a prefix
check would do.

## The searchable index

`public.storage_objects` is the authoritative record: provider, namespace,
category, object key, owner (`public.users.id`), entity type and id, purpose,
original filename, content type, byte size, sha256 and md5, visibility,
lifecycle, and — for anything copied out of Supabase — the source bucket and
path, when it was copied and when it was proven identical.

Email and registration date are NOT copied onto storage rows. They are joined
from `users`, because an address duplicated in a thousand places is an address
that is wrong in a thousand places the day somebody changes it.

`lifecycle` is the orphan detector: a write is recorded PENDING before a byte
moves and becomes ACTIVE only when `commit` has asked R2 what arrived. A
PENDING row older than an hour is an abandoned upload, and is one query away.

## The Storage Explorer

`/admin/storage`. Three SECURITY DEFINER functions back it, each checking
`is_admin()` inside itself under the caller's own token:

| Function | Answers |
|---|---|
| `storage_admin_accounts` | who is there, how much they have, when they registered |
| `storage_admin_objects` | the objects, filtered by email, account, category, entity, type, visibility, lifecycle, provider, upload date, registration date and size |
| `storage_account_summary` | one account's totals and per-category breakdown |

A non-admin calling them directly gets zero rows and a null summary — proven
in production, not assumed. Opening a private file goes through the ordinary
short-lived signed-read flow, and an admin reading somebody else's object is
written to `admin_audit_log` before the URL is returned.

## What has NOT happened

**No Supabase original has been deleted.** All 14 are still there, byte for
byte, and they are the rollback.

Reads now prefer R2 (`PRIMARY` in `images.ts`) and fall back to Supabase for
exactly one reason: the object is not in R2 yet. A 403 never falls back —
routing around an authorisation answer with a different mechanism is the
precise shape of a bypass, and `storageReadStats` counts refusals separately
from fallbacks so the difference is visible.

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
