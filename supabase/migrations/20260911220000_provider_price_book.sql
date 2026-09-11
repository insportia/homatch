-- HOMATCH — what our suppliers charge, and when they started charging it.
--
-- Verify records what it consumes per stage, and until now had nowhere to
-- learn what any of it costs. Rates briefly lived in an environment variable,
-- which is better than a constant in source and still wrong for two reasons:
-- a price has a DATE, and a cost figure nobody can trace is a number nobody
-- can defend. Re-pricing last month's jobs at this month's rate quietly
-- rewrites history, and "why is this $0.22?" has no answer.
--
-- So prices live here, effective-dated and attributed. A rate has a period, a
-- source we can point at, and a record of who last touched it. Correcting a
-- price is closing one row and opening another, never editing the past.
--
-- WHEN THERE IS NO PRICE, THERE IS NO PRICE. Nothing in this design invents
-- one. Usage is still recorded in full and the job is marked UNPRICED, because
-- a plausible-looking guess is worse than a visible gap: the gap gets fixed,
-- and the guess gets quoted in a board deck.

create table if not exists public.provider_price_book (
  id uuid primary key default gen_random_uuid(),

  -- Who we are paying. Matches cost_events.provider so the two join cleanly.
  provider text not null,

  -- The specific model, where the provider bills per model. NULL means the
  -- rate applies to the provider as a whole — a per-request search or scrape
  -- charge that does not vary by model.
  model text,

  /*
   * WHAT IS BEING COUNTED.
   *
   * Text with a CHECK rather than a Postgres enum: a new billing dimension
   * arrives whenever a supplier invents one, and adding a value to a CHECK is
   * a migration rather than a schema-altering enum extension.
   *
   * Reasoning tokens are listed separately because some providers bill them
   * apart from output. Where they do NOT, leave this unit unpriced: reasoning
   * tokens are already inside output_tokens, and pricing both double-charges
   * every run.
   */
  unit text not null check (unit in (
    'INPUT_TOKEN',
    'CACHED_INPUT_TOKEN',
    'OUTPUT_TOKEN',
    'REASONING_TOKEN',
    'WEB_SEARCH_CALL',
    'TOOL_CALL',
    'PROVIDER_CALL'
  )),

  -- The rate, and the quantity it buys. Token prices are quoted per million
  -- and per-call prices per one, so the denominator is explicit instead of
  -- being a convention each reader has to remember.
  rate numeric not null check (rate >= 0),
  per_units numeric not null default 1000000 check (per_units > 0),
  currency text not null default 'USD',

  -- The period this rate was in force. NULL effective_to means "still is".
  effective_from timestamptz not null default now(),
  effective_to timestamptz,

  -- Where this number came from: a pricing page, an invoice, a contract.
  -- A cost figure with no provenance cannot be defended when questioned.
  source text,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),

  constraint price_period_is_ordered check (effective_to is null or effective_to > effective_from)
);

comment on table public.provider_price_book is
  'Effective-dated supplier rates. Internal COGS only — never customer-facing.';

/*
 * ONE RATE AT A TIME.
 *
 * Two overlapping rows for the same thing means the cost of a job depends on
 * which one the query happened to pick, and a total that changes between two
 * identical reads is worse than no total. btree_gist lets a single exclusion
 * constraint state that directly, rather than leaving it to a convention that
 * holds until someone backfills a correction.
 *
 * COALESCE on model because NULL never conflicts with NULL in an exclusion
 * constraint, which would let two provider-wide rates overlap unnoticed.
 */
create extension if not exists btree_gist;

alter table public.provider_price_book
  drop constraint if exists provider_price_book_no_overlap;

alter table public.provider_price_book
  add constraint provider_price_book_no_overlap
  exclude using gist (
    provider with =,
    coalesce(model, '') with =,
    unit with =,
    tstzrange(effective_from, effective_to, '[)') with &&
  );

create index if not exists provider_price_book_lookup
  on public.provider_price_book (provider, model, unit, effective_from desc);

/* ── who may read it ─────────────────────────────────────────────────── */

alter table public.provider_price_book enable row level security;

drop policy if exists price_book_service_all on public.provider_price_book;
create policy price_book_service_all
  on public.provider_price_book
  for all
  to service_role
  using (true)
  with check (true);

/*
 * Admins read; nobody else sees anything.
 *
 * What Homatch pays a supplier is not a fact about anybody's property, and a
 * customer must never be able to infer what their report cost to produce.
 * There is deliberately no policy for anon or authenticated, so RLS denies
 * them every row regardless of the table-level grants Postgres hands out.
 */
drop policy if exists price_book_admin_read on public.provider_price_book;
create policy price_book_admin_read
  on public.provider_price_book
  for select
  to authenticated
  -- Deliberately the same test cost_events already uses, so the two tables
  -- cannot come to disagree about who counts as an admin.
  using (
    exists (
      select 1 from public.users u
      where u.auth_id = (select auth.uid()) and u.is_admin = true
    )
  );

/* ── keeping updated_at honest ───────────────────────────────────────── */

create or replace function public.touch_provider_price_book()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists provider_price_book_touch on public.provider_price_book;
create trigger provider_price_book_touch
  before update on public.provider_price_book
  for each row execute function public.touch_provider_price_book();
