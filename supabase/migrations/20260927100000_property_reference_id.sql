-- Homatch — the permanent six-digit reference for a Homatch-native property.
--
-- WHY A SECOND IDENTITY AT ALL
--
-- `properties.id` is a uuid and stays one: it carries every foreign key in the
-- schema and a primary-key migration to obtain a shorter number would be a
-- dangerous trade for a display convenience. But a uuid is not something a
-- customer reads out on the phone, an operator types into a search box, or a
-- contract cites. So the row gains a SECOND identity whose only job is to be
-- said out loud, and the two never compete: relationships use the uuid,
-- humans use the six digits.
--
-- WHY IT IS RANDOM AND NOT SEQUENTIAL
--
-- A sequential reference publishes the size and the growth rate of the
-- business to anybody who creates two properties a week apart, and it makes
-- every other property's reference guessable. Random over 100000–999999 tells
-- a reader nothing except which property it is.
--
-- HOW UNIQUENESS IS ACTUALLY GUARANTEED
--
-- Not by generating and hoping, and not by "check then insert" — between the
-- check and the insert another transaction can take the number. The claim is
-- made by INSERTING into a registry whose primary key IS the number:
--
--     insert ... on conflict do nothing returning homatch_id
--
-- That either returns the number, meaning this transaction owns it, or returns
-- nothing, meaning somebody else got there first and we pick again. It is one
-- atomic statement, it is bounded at 200 attempts, and it fails loudly rather
-- than assigning a duplicate. The unique index on properties.homatch_id is the
-- second line of the same defence.
--
-- The registry is also why a rolled-back insert does not leak a number: the
-- claim is in the same transaction as the property, so it rolls back with it.
--
-- WHY IT CANNOT CHANGE
--
-- A reference that moves is worse than no reference — it has been written
-- down. The freeze trigger restores the old value rather than raising, so an
-- ordinary edit that happens to send the whole row still succeeds and simply
-- cannot move the number.
--
-- EXTERNALLY DISCOVERED INTELLIGENCE GETS NOTHING HERE. This table holds
-- Homatch-native properties — rows owned by a real Homatch account. Discovered
-- listings live in raw_signals and supply_listings and keep their source
-- identity; giving them a Homatch reference would be the platform claiming
-- something it does not have.

-- ── the registry ─────────────────────────────────────────────────────────
create table if not exists public.property_reference_ids (
  homatch_id  integer primary key
                check (homatch_id between 100000 and 999999),
  claimed_at  timestamptz not null default now()
);

comment on table public.property_reference_ids is
  'Every six-digit Homatch property reference ever allocated. The primary key IS the claim: allocation is an insert, so two transactions cannot take the same number.';

-- Nobody reads this from a browser. It exists for the allocator, which runs
-- as the definer, and for an operator auditing allocations.
alter table public.property_reference_ids enable row level security;

-- ── the column ───────────────────────────────────────────────────────────
alter table public.properties
  add column if not exists homatch_id integer;

comment on column public.properties.homatch_id is
  'The permanent six-digit reference a customer or an operator uses for this property. Assigned server-side at insert, never chosen by the client, never changed.';

create unique index if not exists properties_homatch_id_key
  on public.properties (homatch_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.properties'::regclass
      and conname = 'properties_homatch_id_range'
  ) then
    alter table public.properties
      add constraint properties_homatch_id_range
      check (homatch_id is null or homatch_id between 100000 and 999999)
      not valid;
  end if;
end $$;

-- ── allocation ───────────────────────────────────────────────────────────
create or replace function public.assign_property_reference_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate integer;
  claimed   integer;
  attempts  integer := 0;
begin
  /*
   * WHATEVER THE CLIENT SENT IS DISCARDED. A customer does not choose their
   * own reference — an insert that carried one would be choosing, and RLS
   * lets a customer write their own rows.
   */
  loop
    candidate := 100000 + floor(random() * 900000)::integer;
    insert into public.property_reference_ids (homatch_id)
      values (candidate)
      on conflict do nothing
      returning homatch_id into claimed;
    exit when claimed is not null;

    attempts := attempts + 1;
    if attempts >= 200 then
      /* Explicit. 200 collisions in a 900,000-wide space means the space is
         nearly exhausted or random() is not random, and silently returning a
         null reference would hide either. */
      raise exception
        'could not allocate a Homatch property reference after % attempts', attempts
        using errcode = 'HM001';
    end if;
  end loop;

  new.homatch_id := claimed;
  return new;
end $$;

drop trigger if exists properties_assign_reference_id on public.properties;
create trigger properties_assign_reference_id
  before insert on public.properties
  for each row execute function public.assign_property_reference_id();

-- ── immutability ─────────────────────────────────────────────────────────
create or replace function public.freeze_property_reference_id()
returns trigger
language plpgsql
as $$
begin
  /* Restored rather than refused: an edit that sends the whole row back — a
     price change, an archive, a status change — must still succeed, and must
     still be unable to move the reference. */
  if old.homatch_id is not null and new.homatch_id is distinct from old.homatch_id then
    new.homatch_id := old.homatch_id;
  end if;
  return new;
end $$;

drop trigger if exists properties_freeze_reference_id on public.properties;
create trigger properties_freeze_reference_id
  before update on public.properties
  for each row execute function public.freeze_property_reference_id();

-- ── backfill ─────────────────────────────────────────────────────────────
--
-- Existing properties get a reference through the same allocator, one at a
-- time, with the same bound.
--
-- THE updated_at TRIGGER IS DISABLED FOR THE DURATION, and that is the point
-- rather than a shortcut: `update_updated_at()` would stamp now() onto every
-- historical row, and a property whose owner last touched it in March would
-- report having been edited by this migration. ALTER TABLE takes an ACCESS
-- EXCLUSIVE lock, so no concurrent update can slip through the window.
alter table public.properties disable trigger trg_properties_updated_at;

do $$
declare
  r         record;
  candidate integer;
  claimed   integer;
  attempts  integer;
begin
  for r in select id from public.properties where homatch_id is null loop
    attempts := 0;
    claimed  := null;
    loop
      candidate := 100000 + floor(random() * 900000)::integer;
      insert into public.property_reference_ids (homatch_id)
        values (candidate)
        on conflict do nothing
        returning homatch_id into claimed;
      exit when claimed is not null;

      attempts := attempts + 1;
      if attempts >= 200 then
        raise exception
          'backfill could not allocate a reference for property %', r.id
          using errcode = 'HM001';
      end if;
    end loop;

    update public.properties set homatch_id = claimed where id = r.id;
  end loop;
end $$;

alter table public.properties enable trigger trg_properties_updated_at;

-- ── the lookup this exists to serve ──────────────────────────────────────
-- Admin searches by reference. The unique index above already serves an exact
-- equality lookup; this comment is here so the next person does not add a
-- second index for the same query.
