-- Homatch — the second matching path: a real account on both sides.
--
-- WHAT EXISTED, AND WHY IT WAS NOT ENOUGH
--
-- Every match in the product was HOMATCH ↔ EXTERNAL. `matches` pairs a property with a
-- raw_signal; `supply_matches` pairs an intent_profile with a supply_observation. Both
-- are correct and both stay. But `raw_signals` has no user column and the only foreign
-- key to `users` from any matching table is `matches.user_id`, which is the OWNER — so
-- there was no relationship in the schema where two Homatch accounts faced each other,
-- and no honest way to offer one account a way to message or call another.
--
-- WHAT THIS ADDS IS NOT A SECOND MATCHER
--
-- The same table, the same assessment columns, the same engine. A native match is a
-- `supply_matches` row whose supply is a Homatch PROPERTY instead of an external
-- observation. Nothing about compatibility, constraint strength, scoring or rationale
-- differs — assessMatch() in research-core decides both, which is why a flat that
-- matches a buyer is a flat whose buyer matches it in both directions and both paths.
--
-- THE TWO IDENTITIES ARE STORED, NOT DERIVED AT READ TIME
--
-- `supply_user_id` and `demand_user_id` are written by the worker, under the service
-- role, from the owning rows — properties.user_id for supply, and
-- active_search_subscriptions.user_id for demand. They are never accepted from a client:
-- supply_matches has RLS on and no policies, so nothing but a service-role function can
-- write here at all.
--
-- Storing them is what makes the row able to answer "may this person message that
-- person" without re-deriving two joins at every call site, and what makes the
-- self-match rule enforceable by the database rather than by whoever remembers.
--
-- SELF-MATCH IS A CONSTRAINT, NOT A FILTER
--
-- An owner who also has a search must not be offered their own flat. A WHERE clause in
-- the worker would be one place to forget; a CHECK is every place at once.
--
-- PROVENANCE IS RECORDED BECAUSE THE ACTIONS DIFFER
--
-- Not for a tab in the interface — the customer wants relevance, not a taxonomy — but
-- because a native result may offer Message and Call and an external one may not. A row
-- that could not say which it was would eventually offer one of them to a stranger found
-- on a forum, which is the fabrication this whole distinction exists to prevent.

alter table public.supply_matches
  add column if not exists property_id     uuid references public.properties(id) on delete cascade,
  add column if not exists supply_user_id  uuid references public.users(id) on delete cascade,
  add column if not exists demand_user_id  uuid references public.users(id) on delete cascade,
  add column if not exists source_kind     text not null default 'EXTERNAL_INTELLIGENCE';

comment on column public.supply_matches.property_id is
  'The Homatch-native property on the supply side. Null for an external observation. Mutually exclusive with signal_id/observation_id — see supply_matches_one_supply_kind.';
comment on column public.supply_matches.supply_user_id is
  'The account that owns the supply. Resolved server-side from properties.user_id; never accepted from a client.';
comment on column public.supply_matches.demand_user_id is
  'The account that owns the demand. Resolved server-side from active_search_subscriptions.user_id; never accepted from a client.';
comment on column public.supply_matches.source_kind is
  'INTERNAL_HOMATCH or EXTERNAL_INTELLIGENCE. Recorded because the contact actions a result may offer differ, not because the customer is shown a taxonomy.';

do $$
begin
  /* ── one kind of supply per row ─────────────────────────────────────── */
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.supply_matches'::regclass
      and conname = 'supply_matches_one_supply_kind'
  ) then
    alter table public.supply_matches
      add constraint supply_matches_one_supply_kind
      check (
        (source_kind = 'INTERNAL_HOMATCH'
          and property_id is not null
          and observation_id is null)
        or
        (source_kind = 'EXTERNAL_INTELLIGENCE'
          and property_id is null)
      )
      /* NOT VALID: every existing row is external and has no property_id, so they all
         satisfy this — but they are not re-read, because validating a table under a
         worker's write load buys nothing here. */
      not valid;
  end if;

  /* ── nobody matches themselves ──────────────────────────────────────── */
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.supply_matches'::regclass
      and conname = 'supply_matches_not_self'
  ) then
    alter table public.supply_matches
      add constraint supply_matches_not_self
      check (
        supply_user_id is null
        or demand_user_id is null
        or supply_user_id <> demand_user_id
      )
      not valid;
  end if;
end $$;

/*
 * THE NATIVE RELATIONSHIP'S IDENTITY.
 *
 * One row per (demand, property) pair, forever. A matching worker re-runs on a schedule
 * and re-evaluates what it finds; without this it would write a new row every tick and
 * a customer would watch one flat arrive nine times.
 *
 * Partial, because the external path has its own identity — (signal_id, observation_id)
 * — and a native row has neither of those.
 */
create unique index if not exists supply_matches_native_key
  on public.supply_matches (intent_profile_id, property_id)
  where property_id is not null;

/* The two questions a customer surface asks: what is there for my property, and what is
   there for my search. */
create index if not exists supply_matches_supply_user_idx
  on public.supply_matches (supply_user_id, match_score desc)
  where source_kind = 'INTERNAL_HOMATCH' and compatibility = 'COMPATIBLE';

create index if not exists supply_matches_demand_user_idx
  on public.supply_matches (demand_user_id, match_score desc)
  where source_kind = 'INTERNAL_HOMATCH' and compatibility = 'COMPATIBLE';

/*
 * WHO MAY READ A NATIVE MATCH.
 *
 * supply_matches has had RLS on and no policies since it was created, which means the
 * table is reachable only by the service role — every customer read goes through an edge
 * function that decides what to disclose. That is the existing authorisation model and
 * it stays: this migration adds no SELECT policy, so nothing becomes readable from a
 * browser that was not readable before.
 *
 * The user columns above are what let those functions answer "is this person one of the
 * two parties" in one comparison instead of two joins.
 */
