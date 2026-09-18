-- A single-use ticket that lets the object store be proven from outside,
-- without inventing a user.
--
-- The proof the object store needs is not "the code compiles". It is: a real
-- byte went into the real bucket, a signed URL read it back, an unsigned URL
-- did not, and the delete really removed it. Running that requires invoking
-- an edge function, and every honest way to authorise that invocation was
-- worse than this one:
--
--   * a production account created for the purpose  -- a real admin login
--     that outlives the test;
--   * the service-role key handed to a person       -- the most powerful
--     credential in the system, copied somewhere new;
--   * an open endpoint                              -- anyone can make the
--     system write to its own bucket.
--
-- A ticket is none of those. It is minted by whoever already has database
-- access, it is stored as a SHA-256 of the token so the row itself grants
-- nothing, it expires, and it works exactly once. The function verifies it
-- with the service role it already holds.
--
-- RLS is on with NO policies, which is the point: `anon` and `authenticated`
-- have no way in at all, and only the service role -- which bypasses RLS --
-- can read or mark a ticket.

create table if not exists public.storage_proof_tickets (
  id           uuid primary key default gen_random_uuid(),
  -- The hash, never the token. A database dump cannot be replayed.
  token_sha256 text        not null unique,
  note         text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  -- What the run found, kept so a later reader can see the evidence rather
  -- than a claim that it once passed.
  result       jsonb
);

comment on table public.storage_proof_tickets is
  'Single-use, expiring tickets authorising a storage-selftest run. Service role only.';

alter table public.storage_proof_tickets enable row level security;

revoke all on public.storage_proof_tickets from anon, authenticated;

create index if not exists storage_proof_tickets_unused_idx
  on public.storage_proof_tickets (expires_at)
  where used_at is null;
