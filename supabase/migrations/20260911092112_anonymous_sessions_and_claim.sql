-- HOMATCH — letting somebody try Verify and the assistant before they sign up,
-- without making anybody's report readable by a stranger.
--
-- THE SHAPE OF THE PROBLEM
--
-- An anonymous visitor has no auth.uid(), so RLS cannot identify them, and a
-- UUID they happen to know must never be the thing that authorises access —
-- research_jobs.id is a guessable-shaped identifier that appears in URLs.
--
-- So anonymous work is owned by a SESSION, the session is proven by a secret
-- the browser holds, and only the server ever sees the secret. Nothing here
-- grants the `anon` role any access at all: these tables stay closed and the
-- edge functions act with the service role after checking the token
-- themselves. No existing policy is relaxed.

create table if not exists public.anonymous_sessions (
  id             uuid primary key default gen_random_uuid(),
  -- Only the HASH is stored. A database leak must not hand anybody a working
  -- session, exactly as with human_verification_handoffs.
  token_sha256   text        not null unique,
  created_at     timestamptz not null default now(),
  -- Short-lived by design: an unclaimed session is an anonymous stranger's,
  -- and keeping it forever is neither useful nor polite.
  expires_at     timestamptz not null default (now() + interval '7 days'),
  claimed_at     timestamptz,
  claimed_by     uuid references auth.users(id) on delete set null,
  -- What the session has spent, so an anonymous visitor cannot run up an
  -- unbounded bill before signing in.
  user_messages  smallint    not null default 0,
  research_jobs  smallint    not null default 0,
  user_agent_sha text,
  constraint anon_claim_is_complete
    check ((claimed_at is null) = (claimed_by is null))
);

comment on table public.anonymous_sessions is
  'Ownership for work done before sign-in. Proven by a token the browser holds; only its sha256 is stored. No role has any policy here: the service role acts on it after verifying the token.';

create index if not exists anonymous_sessions_expiry_idx
  on public.anonymous_sessions (expires_at) where claimed_at is null;

-- Closed by default and FORCED, so even a table owner is held to the (absent)
-- policies. Nothing but the service role can reach this.
alter table public.anonymous_sessions enable row level security;
alter table public.anonymous_sessions force row level security;

-- ---------------------------------------------------------------------------
-- The two things an anonymous visitor can create.
--
-- user_id becomes nullable so a row can be owned by a session instead, and a
-- CHECK keeps it to exactly one owner. Every existing row has a user_id, so
-- it already satisfies the constraint.
--
-- An anonymous row has user_id IS NULL, which no existing RLS policy matches
-- — so it is invisible to every signed-in user, which is precisely the
-- requirement that a finished report must not become publicly readable.
-- ---------------------------------------------------------------------------

alter table public.ai_conversations
  add column if not exists anon_session_id uuid
  references public.anonymous_sessions(id) on delete cascade;

alter table public.ai_conversations alter column user_id drop not null;

alter table public.ai_conversations
  drop constraint if exists ai_conversations_one_owner_ck;
alter table public.ai_conversations
  add constraint ai_conversations_one_owner_ck
  check (num_nonnulls(user_id, anon_session_id) = 1);

create index if not exists ai_conversations_anon_idx
  on public.ai_conversations (anon_session_id) where anon_session_id is not null;

alter table public.research_jobs
  add column if not exists anon_session_id uuid
  references public.anonymous_sessions(id) on delete cascade;

alter table public.research_jobs alter column user_id drop not null;

alter table public.research_jobs
  drop constraint if exists research_jobs_one_owner_ck;
alter table public.research_jobs
  add constraint research_jobs_one_owner_ck
  check (num_nonnulls(user_id, anon_session_id) = 1);

create index if not exists research_jobs_anon_idx
  on public.research_jobs (anon_session_id) where anon_session_id is not null;
