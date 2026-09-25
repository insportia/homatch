-- HOMATCH — when did we last actually check this was still true?
--
-- WHAT raw_signals COULD ALREADY ANSWER, AND WHAT IT COULD NOT
--
-- It has discovered_at, last_seen_at and content_fingerprint. Those answer
-- "when did this arrive" and "has the text moved". They do not answer the
-- question a customer paying for results is actually buying:
--
--   WHEN DID WE LAST CONFIRM THIS IS STILL TRUE?
--
-- "We found this six weeks ago" and "we checked this yesterday" are different
-- claims, and with three columns they are indistinguishable. A listing
-- discovered in March and re-read yesterday looks identical to one discovered
-- in March and never seen again.
--
-- FIVE TIMESTAMPS, FIVE REASONS
--
--   discovered_at       when it arrived. IMMUTABLE -- a trigger enforces it,
--                       because if this moves every age in the product is
--                       wrong and nothing says so.
--   last_seen_at        when we last OBSERVED it. A failed fetch does not
--                       advance it: we tried, we did not see it.
--   last_verified_at    when we last CONCLUSIVELY confirmed it. Advances only
--                       on UNCHANGED_VALID, CHANGED_VALID, INVALID or REMOVED.
--   content_changed_at  when the fingerprint actually moved. So "the price
--                       changed" stays distinguishable from "we re-read it
--                       and it said the same thing".
--   expires_at          when it stops being deliverable without a re-check.
--
-- THE EDGE THIS SCHEMA IS SHAPED AROUND
--
-- A revalidation job runs, the fetch times out, and somebody sets
-- last_verified_at = now() in the same statement that records the attempt.
-- From then on the stalest evidence in the system is the evidence that looks
-- newest, and the only rows it happens to are the ones from sources refusing
-- us. So last_verified_at is written ONLY by
-- src/research-core/discovery/revalidation.ts's applyRevalidation, which
-- refuses to advance it on an inconclusive outcome, and validation_state
-- carries UNVERIFIABLE to say so out loud.
--
-- NOTHING IS BACKFILLED AS VERIFIED
--
-- All 868 existing signals get validation_state = 'UNVERIFIED' and a NULL
-- last_verified_at, because not one of them has ever been re-read. Setting it
-- to discovered_at would mark the entire corpus permanently verified at the
-- moment it arrived, which is the exact lie this column exists to prevent.

-- ── the columns ──────────────────────────────────────────────────────────
alter table public.raw_signals
  add column if not exists last_verified_at timestamptz,
  add column if not exists content_changed_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists validation_state text not null default 'UNVERIFIED',
  add column if not exists failed_checks integer not null default 0,
  add column if not exists last_revalidation_outcome text;

comment on column public.raw_signals.last_verified_at is
  'When we last CONCLUSIVELY confirmed this is still true. NULL means never '
  're-read -- which is what every signal that predates this column is, and '
  'what a first sighting is. An inconclusive check never advances it.';

comment on column public.raw_signals.content_changed_at is
  'When the fingerprint last actually moved. Distinguishes "the price '
  'changed" from "we re-read it and it said the same thing".';

comment on column public.raw_signals.expires_at is
  'When this stops being deliverable without a re-check. Seven days from the '
  'last verification by default; the window is a product decision, not a '
  'constant, and the delivery gate takes it as a parameter.';

comment on column public.raw_signals.validation_state is
  'UNVERIFIED (never re-read), VALID, INVALID (re-read, no longer qualifies), '
  'REMOVED (gone), UNVERIFIABLE (we tried and could not read it). '
  'UNVERIFIABLE is deliberately not a verdict about the listing.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'raw_signals_validation_state_check') then
    alter table public.raw_signals
      add constraint raw_signals_validation_state_check
      check (validation_state in ('UNVERIFIED', 'VALID', 'INVALID', 'REMOVED', 'UNVERIFIABLE'))
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'raw_signals_revalidation_outcome_check') then
    alter table public.raw_signals
      add constraint raw_signals_revalidation_outcome_check
      check (last_revalidation_outcome is null or last_revalidation_outcome in (
        'UNCHANGED_VALID', 'CHANGED_VALID', 'INVALID', 'REMOVED', 'INACCESSIBLE', 'UNKNOWN'
      ))
      not valid;
  end if;

  /*
   * THE RULE, IN THE DATABASE.
   *
   * A row cannot claim to have been verified while saying it has never been
   * verified. This is not a nicety: the UNVERIFIED + last_verified_at
   * combination is exactly what a careless revalidation writer produces, and
   * catching it here means it fails loudly at the write rather than quietly
   * at the next delivery.
   */
  if not exists (select 1 from pg_constraint where conname = 'raw_signals_verification_coherence_check') then
    alter table public.raw_signals
      add constraint raw_signals_verification_coherence_check
      check (
        (validation_state = 'UNVERIFIED' and last_verified_at is null)
        or (validation_state <> 'UNVERIFIED')
      )
      not valid;
  end if;
end $$;

alter table public.raw_signals validate constraint raw_signals_validation_state_check;
alter table public.raw_signals validate constraint raw_signals_revalidation_outcome_check;
alter table public.raw_signals validate constraint raw_signals_verification_coherence_check;

-- ── discovered_at cannot move ────────────────────────────────────────────
--
-- Enforced rather than documented. An UPDATE that changes it is a bug in the
-- writer, and a bug that silently rewrites the age of every piece of evidence
-- is one nobody would find.
create or replace function public.raw_signals_freeze_discovered_at()
returns trigger
language plpgsql
as $$
begin
  if new.discovered_at is distinct from old.discovered_at then
    raise exception
      'raw_signals.discovered_at is immutable (signal %, % -> %)',
      old.id, old.discovered_at, new.discovered_at
      using hint = 'Use last_seen_at for an observation and last_verified_at for a confirmation.';
  end if;
  return new;
end $$;

drop trigger if exists raw_signals_freeze_discovered_at on public.raw_signals;
create trigger raw_signals_freeze_discovered_at
  before update on public.raw_signals
  for each row
  execute function public.raw_signals_freeze_discovered_at();

-- ── what is deliverable ──────────────────────────────────────────────────
--
-- Mirrors judgeDelivery() in src/research-core/discovery/revalidation.ts so a
-- query can filter without pulling every row into a worker. A test asserts
-- the two agree; the TypeScript is the definition and this is the index.
create or replace function public.evidence_deliverable(
  p_validation_state text,
  p_last_verified_at timestamptz,
  p_discovered_at timestamptz,
  p_window_days integer default 7,
  p_at timestamptz default now()
)
returns boolean
language sql
immutable
as $$
  select case
    -- Gone or no longer qualifying: never, whatever the dates say.
    when p_validation_state in ('REMOVED', 'INVALID') then false
    -- Verified inside the window.
    when p_last_verified_at is not null
      then p_last_verified_at >= p_at - make_interval(days => greatest(1, coalesce(p_window_days, 7)))
    -- Tried and failed: not deliverable on the strength of a first sighting,
    -- because we already know we cannot confirm it.
    when p_validation_state = 'UNVERIFIABLE' then false
    -- Never re-checked, but seen inside the window. Deliverable, and a weaker
    -- claim than a verification -- the caller renders the difference.
    else p_discovered_at >= p_at - make_interval(days => greatest(1, coalesce(p_window_days, 7)))
  end
$$;

comment on function public.evidence_deliverable is
  'Mirrors judgeDelivery() in src/research-core/discovery/revalidation.ts. '
  'Evidence outside the window is REVALIDATED before delivery, not delivered '
  'with a caveat: a caveat puts a judgement on the customer that they have no '
  'way to make.';

-- The delivery filter and the revalidation queue both read this.
create index if not exists raw_signals_freshness_idx
  on public.raw_signals (validation_state, last_verified_at nulls first, discovered_at);

-- ── the configurable window ──────────────────────────────────────────────
insert into public.admin_settings (key, value)
values ('evidence_delivery_window_days', '7'::jsonb)
on conflict (key) do nothing;
