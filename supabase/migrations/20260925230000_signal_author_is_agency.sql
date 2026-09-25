-- A BROKER SAYING "MY CLIENTS ARE LOOKING FOR 2BR FLATS" IS NOT A LEAD.
--
-- classifyDirection() has always returned agencyVoice alongside the
-- direction: whether the writer sounds like an agency rather than a person
-- speaking for themselves. It has had nowhere to go.
--
-- It is not a rejection on its own. An agency posting inventory is perfectly
-- good SUPPLY — that is most of what a property portal is. It is a rejection
-- for DEMAND, where "we have buyers looking for apartments in Vake" is a
-- sales pitch aimed at sellers, and treating it as a buyer would put an
-- agency's marketing in front of a customer as though it were a lead.
--
-- Homatch's whole proposition on the demand side is that these are real
-- people stating real intent. One agency post delivered as a buyer costs
-- more trust than ten missed leads.
--
-- NULL IS NOT FALSE. Every one of the 868 existing rows was classified by a
-- retired provider that never asked the question, and defaulting them to
-- "not an agency" would assert something nobody checked about 868 records.
-- Unknown stays unknown.

alter table public.raw_signals
  add column if not exists author_is_agency boolean;

comment on column public.raw_signals.author_is_agency is
  'True when the deterministic classifier judged the writer to be speaking as '
  'an agency rather than as a principal. NULL means the question was never '
  'asked -- which is the case for every signal collected before 2026-09-25, '
  'and is deliberately distinct from false. Not a rejection by itself: an '
  'agency posting inventory is valid SUPPLY. It disqualifies a post as '
  'DEMAND, where an agency advertising its buyer list is a sales pitch and '
  'not a lead.';

-- Finding the pitches among the requests is the query this exists for, and
-- it is partial so the index costs nothing for the rows that are not demand.
create index if not exists raw_signals_demand_principal_idx
  on public.raw_signals (research_direction, author_is_agency)
  where research_direction = 'DEMAND';
