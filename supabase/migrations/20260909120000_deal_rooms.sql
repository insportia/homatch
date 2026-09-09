-- Homatch Deal Room
--
-- The buyer's persistent workspace for ONE potential transaction. A completed
-- Verify creates or attaches to a Deal Room; the customer returns days or
-- weeks later and continues from where they stopped.
--
-- DESIGN NOTES
-- ------------
-- 1. Deal Rooms REFERENCE Verify, they do not copy it. `research_jobs` already
--    holds the evidence; duplicating a multi-megabyte result_json per deal
--    room would double storage and immediately drift. `verify_job_id` plus
--    `verify_snapshot` (a small denormalised header: address, area, verdict)
--    gives a stable, cheap view without the payload.
-- 2. A later Verify refresh points `verify_job_id` at the newer job while
--    every decision artefact (notes, answered questions, uploaded documents)
--    survives, because those live in their own tables keyed by deal room.
-- 3. RLS everywhere, owner-only, with NO permissive fallback. Sharing is a
--    future feature and is deliberately absent rather than half-built.
--
-- NOT APPLIED. Written locally for review; deployment is a separate decision.

-- ---------------------------------------------------------------------------
-- deal_rooms
-- ---------------------------------------------------------------------------
create table if not exists public.deal_rooms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Property identity. cadastral_code is the natural key a buyer recognises.
  cadastral_code text,
  title text,
  address text,

  -- The Verify this room is currently built on. Nullable so a room can exist
  -- before/independently of a completed Verify.
  verify_job_id uuid references public.research_jobs(id) on delete set null,
  -- Small denormalised header ONLY (address, area, property type, verdict).
  -- Never the evidence payload.
  verify_snapshot jsonb not null default '{}'::jsonb,
  verify_refreshed_at timestamptz,

  -- Derived property classification, used to adapt the action plan.
  property_type text check (property_type in (
    'DEVELOPER_APARTMENT','PRIVATE_APARTMENT','PRIVATE_HOUSE','LAND',
    'COMMERCIAL','UNKNOWN'
  )) default 'UNKNOWN',

  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','ARCHIVED','CLOSED')),

  -- Total Property Budget inputs the customer configured. Only known,
  -- user-entered or evidenced amounts — never invented taxes or fees.
  budget jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- One active room per user per property: re-verifying the same cadastral code
-- must reuse the room, not fragment the buyer's history across duplicates.
create unique index if not exists deal_rooms_user_cadastral_active_uidx
  on public.deal_rooms (user_id, cadastral_code)
  where deleted_at is null and cadastral_code is not null;

create index if not exists deal_rooms_user_idx on public.deal_rooms (user_id, updated_at desc);
create index if not exists deal_rooms_verify_job_idx on public.deal_rooms (verify_job_id);

-- ---------------------------------------------------------------------------
-- deal_room_documents
-- ---------------------------------------------------------------------------
create table if not exists public.deal_room_documents (
  id uuid primary key default gen_random_uuid(),
  deal_room_id uuid not null references public.deal_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- What the document IS, so the checklist can reason about coverage.
  doc_key text not null,
  label text not null,

  -- The lifecycle the buyer actually experiences.
  state text not null default 'RECOMMENDED' check (state in (
    'RECOMMENDED',      -- Homatch suggests requesting it
    'REQUESTED',        -- buyer has asked the seller/developer
    'PROVIDED',         -- received, not yet analysed
    'ANALYZED',         -- contract analysis has run over it
    'VERIFIED_BY_VERIFY',-- already evidenced by an official source
    'SUPERSEDED',       -- replaced by a newer version
    'NOT_APPLICABLE'
  )),
  -- Set when the document is already evidenced by Verify, so the buyer is
  -- never asked to chase something Homatch already has.
  evidence_ref text,

  storage_path text,
  mime_type text,
  size_bytes bigint,
  uploaded_at timestamptz,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deal_room_documents_room_idx
  on public.deal_room_documents (deal_room_id, state);
create unique index if not exists deal_room_documents_room_key_uidx
  on public.deal_room_documents (deal_room_id, doc_key);

-- ---------------------------------------------------------------------------
-- deal_room_action_items  (Buyer Action Plan)
-- ---------------------------------------------------------------------------
create table if not exists public.deal_room_action_items (
  id uuid primary key default gen_random_uuid(),
  deal_room_id uuid not null references public.deal_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  action_key text not null,
  title text not null,
  why text,                       -- why this matters, in customer language
  category text,                  -- OWNERSHIP / HANDOVER / CONSTRUCTION / ...
  priority smallint not null default 2 check (priority between 1 and 3),

  -- What in Verify caused this action to be generated. NO EVIDENCE = NO FACT
  -- applies to recommendations too: an action with no grounding is a guess.
  grounded_in jsonb not null default '[]'::jsonb,

  state text not null default 'OPEN'
    check (state in ('OPEN','IN_PROGRESS','DONE','DISMISSED')),
  completed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deal_room_action_items_room_idx
  on public.deal_room_action_items (deal_room_id, state, priority);
create unique index if not exists deal_room_action_items_room_key_uidx
  on public.deal_room_action_items (deal_room_id, action_key);

-- ---------------------------------------------------------------------------
-- deal_room_questions  (Questions to ask)
-- ---------------------------------------------------------------------------
create table if not exists public.deal_room_questions (
  id uuid primary key default gen_random_uuid(),
  deal_room_id uuid not null references public.deal_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  question_key text not null,
  question text not null,
  why text,
  audience text not null default 'DEVELOPER'
    check (audience in ('DEVELOPER','SELLER','AGENT','LAWYER','BANK')),
  category text,
  grounded_in jsonb not null default '[]'::jsonb,

  asked boolean not null default false,
  answer text,
  answered_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deal_room_questions_room_idx
  on public.deal_room_questions (deal_room_id, audience);
create unique index if not exists deal_room_questions_room_key_uidx
  on public.deal_room_questions (deal_room_id, question_key);

-- ---------------------------------------------------------------------------
-- deal_room_notes
-- ---------------------------------------------------------------------------
create table if not exists public.deal_room_notes (
  id uuid primary key default gen_random_uuid(),
  deal_room_id uuid not null references public.deal_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deal_room_notes_room_idx
  on public.deal_room_notes (deal_room_id, created_at desc);

-- ---------------------------------------------------------------------------
-- renovation_scenarios
-- ---------------------------------------------------------------------------
create table if not exists public.renovation_scenarios (
  id uuid primary key default gen_random_uuid(),
  deal_room_id uuid references public.deal_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- NOT NULL by design: a scenario the customer can see in a list must be
  -- identifiable. The service guarantees a non-empty value (see
  -- scenarioName() in services/renovationPricing.ts), falling back to a
  -- deterministic generated label rather than passing null.
  name text not null,
  market text not null default 'tbilisi',

  -- Everything needed to reproduce the estimate exactly.
  inputs jsonb not null,              -- property spec, level, tiers, overrides
  -- The computed result, stored so a saved scenario never silently changes
  -- when the price book is updated.
  result jsonb not null,

  /*
   * PRICE-VERSION IDENTITY lives in ONE place, added by
   * 20260910100000_renovation_price_book.sql as `price_book_version_id`
   * (a FK to renovation_price_book_versions) together with `estimate_state`.
   *
   * This table originally carried `price_book_version integer NOT NULL` and
   * `provisional_prices boolean`. Both are deliberately absent now:
   *
   *   - the integer dated from when the price book was a hard-coded constant
   *     with a monotonic version number. Versions are rows now, so the row is
   *     the identity; keeping an integer beside the FK would be two
   *     representations of one concept, free to drift.
   *   - `provisional_prices` could only ever be false for a customer-visible
   *     estimate, because a PRICED scenario is structurally reachable only
   *     from VERIFIED items inside a PUBLISHED version. A column that cannot
   *     vary is not a safeguard, it is a second source of truth.
   *
   * Neither migration has been applied anywhere, so this is a corrected
   * initial schema rather than a compatibility fix-up.
   */

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists renovation_scenarios_room_idx
  on public.renovation_scenarios (deal_room_id, updated_at desc);
create index if not exists renovation_scenarios_user_idx
  on public.renovation_scenarios (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- deal_room_ai_threads  (Ask Homatch AI)
-- ---------------------------------------------------------------------------
create table if not exists public.deal_room_ai_threads (
  id uuid primary key default gen_random_uuid(),
  deal_room_id uuid not null references public.deal_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deal_room_ai_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.deal_room_ai_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  -- Which evidence the answer was grounded in. An assistant message with an
  -- empty grounding is a general explanation, and the UI must label it as
  -- such rather than as a fact about this property.
  grounded_in jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists deal_room_ai_threads_room_idx
  on public.deal_room_ai_threads (deal_room_id, updated_at desc);
create index if not exists deal_room_ai_messages_thread_idx
  on public.deal_room_ai_messages (thread_id, created_at);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
-- security invoker + a pinned search_path, matching owns_deal_room() below and
-- every other function this project defines. A trigger function with a mutable
-- search_path is what Supabase's advisor flags as "Function Search Path
-- Mutable": it runs on every write to eight tables, so it is exactly the kind
-- of function that should not resolve unqualified names through a caller-
-- controlled path.
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'deal_rooms','deal_room_documents','deal_room_action_items',
    'deal_room_questions','deal_room_notes','renovation_scenarios',
    'deal_room_ai_threads'
  ]
  loop
    execute format(
      'drop trigger if exists %I on public.%I; '
      'create trigger %I before update on public.%I '
      'for each row execute function public.touch_updated_at();',
      t || '_touch', t, t || '_touch', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Owner-only on every table, for every command, with no permissive fallback.
-- Child tables carry their own user_id AND re-check the parent's ownership, so
-- a forged deal_room_id cannot attach a row to someone else's room.
-- ---------------------------------------------------------------------------
alter table public.deal_rooms              enable row level security;
alter table public.deal_room_documents     enable row level security;
alter table public.deal_room_action_items  enable row level security;
alter table public.deal_room_questions     enable row level security;
alter table public.deal_room_notes         enable row level security;
alter table public.renovation_scenarios    enable row level security;
alter table public.deal_room_ai_threads    enable row level security;
alter table public.deal_room_ai_messages   enable row level security;

alter table public.deal_rooms              force row level security;
alter table public.deal_room_documents     force row level security;
alter table public.deal_room_action_items  force row level security;
alter table public.deal_room_questions     force row level security;
alter table public.deal_room_notes         force row level security;
alter table public.renovation_scenarios    force row level security;
alter table public.deal_room_ai_threads    force row level security;
alter table public.deal_room_ai_messages   force row level security;

drop policy if exists deal_rooms_owner on public.deal_rooms;
create policy deal_rooms_owner on public.deal_rooms
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Helper: the caller owns this deal room.
create or replace function public.owns_deal_room(room uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.deal_rooms d
    where d.id = room and d.user_id = (select auth.uid()) and d.deleted_at is null
  );
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'deal_room_documents','deal_room_action_items','deal_room_questions',
    'deal_room_notes','renovation_scenarios','deal_room_ai_threads'
  ]
  loop
    execute format('drop policy if exists %I on public.%I;', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (user_id = (select auth.uid()) and (deal_room_id is null or public.owns_deal_room(deal_room_id))) '
      'with check (user_id = (select auth.uid()) and (deal_room_id is null or public.owns_deal_room(deal_room_id)));',
      t || '_owner', t
    );
  end loop;
end $$;

-- Messages hang off a thread, so ownership is checked through it as well as
-- directly.
drop policy if exists deal_room_ai_messages_owner on public.deal_room_ai_messages;
create policy deal_room_ai_messages_owner on public.deal_room_ai_messages
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.deal_room_ai_threads th
      where th.id = thread_id and th.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.deal_room_ai_threads th
      where th.id = thread_id and th.user_id = (select auth.uid())
    )
  );

-- anon gets nothing. Explicit, so a future default-grant change cannot open
-- these tables by accident.
revoke all on public.deal_rooms              from anon;
revoke all on public.deal_room_documents     from anon;
revoke all on public.deal_room_action_items  from anon;
revoke all on public.deal_room_questions     from anon;
revoke all on public.deal_room_notes         from anon;
revoke all on public.renovation_scenarios    from anon;
revoke all on public.deal_room_ai_threads    from anon;
revoke all on public.deal_room_ai_messages   from anon;
