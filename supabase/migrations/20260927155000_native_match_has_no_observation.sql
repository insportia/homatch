-- Homatch — the other half of the same finding.
--
-- `observation_id` was NOT NULL for the same reason `signal_id` was: every supply_match
-- had an external listing on the supply side. A native match's supply is a Homatch
-- property, so requiring an observation would mean inventing one.
--
-- The rule stays stated in supply_matches_one_supply_kind, which already says an
-- external row must carry a signal and a native row must carry neither a signal nor an
-- observation. What this adds is that an external row must carry its observation too —
-- so dropping NOT NULL takes nothing away.

alter table public.supply_matches alter column observation_id drop not null;

alter table public.supply_matches drop constraint if exists supply_matches_one_supply_kind;

alter table public.supply_matches
  add constraint supply_matches_one_supply_kind
  check (
    (source_kind = 'INTERNAL_HOMATCH'
      and property_id is not null
      and signal_id is null
      and observation_id is null)
    or
    (source_kind = 'EXTERNAL_INTELLIGENCE'
      and property_id is null
      and signal_id is not null
      and observation_id is not null)
  )
  not valid;

comment on column public.supply_matches.observation_id is
  'The external listing. Null on an INTERNAL_HOMATCH row, where the supply is a Homatch property.';
