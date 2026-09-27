-- Homatch — an objection is not a rejection, and it is not interest either.
--
-- WHAT WAS WRONG. `polarity` was carrying every semantic distinction at once, so
-- "ეს ძვირია" — this is expensive — had two possible homes and both were false:
--
--   NEGATIVE would have read a complaint about a price as a withdrawal, and quietly
--   ended a relationship that is still live. People buy things they call expensive.
--
--   POSITIVE was what it actually did, and that is worse in the other direction: a
--   grumble became evidence of interest, strengthening a native relationship on the
--   strength of somebody saying they did not like the price.
--
-- The sentence is neither. It is an OBJECTION, about the PRICE dimension, and its effect
-- on interest is nothing at all unless something else independently establishes interest.
--
-- SO THE MODEL COMPOSES INSTEAD OF ENUMERATING.
--
--   act        what kind of thing was said
--   polarity   which way it points
--   dimension  what it was about, where that is a dimension the matcher knows
--   scope      how wide it reaches
--   strength   how firmly it was meant
--   confidence how well we read it
--
-- Six small fields rather than one enum with a value per phrase. "I like it but it's
-- expensive" is then two signals from one message — an INTEREST and a PRICE OBJECTION —
-- which is what it is, rather than a single classification that has to lose half of it.
--
-- THE DIMENSION VOCABULARY IS THE MATCHER'S OWN. CITY, DISTRICT, PROPERTY_TYPE, PRICE,
-- AREA, BEDROOMS, TRANSACTION, PARTICIPANTS — the same words assessMatch() reports
-- agreements and misses in. A second vocabulary for the same concepts is how two parts of
-- one system stop being able to talk about the same fact.

alter table public.intent_signals
  add column if not exists act text not null default 'REQUIREMENT',
  add column if not exists dimension text;

comment on column public.intent_signals.act is
  'What kind of thing was said. REQUIREMENT states what somebody wants; INTEREST and REJECTION are about one specific thing; OBJECTION is a complaint about a dimension and is neither interest nor rejection; INQUIRY is a question; TRANSACTION_INTENT is an explicit intent to transact.';
comment on column public.intent_signals.dimension is
  'Which dimension an objection or a refinement is about, in the matcher own vocabulary. Null where the statement names none.';

alter table public.intent_signals drop constraint if exists intent_signals_polarity_check;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid='public.intent_signals'::regclass
                    and conname='intent_signals_act_check') then
    alter table public.intent_signals add constraint intent_signals_act_check
      check (act in ('REQUIREMENT','INTEREST','REJECTION','OBJECTION','INQUIRY','TRANSACTION_INTENT'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid='public.intent_signals'::regclass
                    and conname='intent_signals_polarity_values') then
    alter table public.intent_signals add constraint intent_signals_polarity_values
      check (polarity in ('POSITIVE','NEGATIVE','NEUTRAL'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid='public.intent_signals'::regclass
                    and conname='intent_signals_dimension_check') then
    alter table public.intent_signals add constraint intent_signals_dimension_check
      check (dimension is null or dimension in (
        'PARTICIPANTS','TRANSACTION','CITY','DISTRICT','PROPERTY_TYPE','PRICE','AREA','BEDROOMS'));
  end if;

  -- THE SIGN FOLLOWS THE ACT, so a row cannot contradict itself. A POSITIVE rejection or
  -- a NEGATIVE requirement is not a state anybody meant to write, and without this the
  -- two fields would drift apart one careless insert at a time.
  if not exists (select 1 from pg_constraint
                  where conrelid='public.intent_signals'::regclass
                    and conname='intent_signals_act_polarity_agree') then
    alter table public.intent_signals add constraint intent_signals_act_polarity_agree
      check (
        (act = 'INQUIRY' and polarity = 'NEUTRAL')
        or (act in ('REJECTION','OBJECTION') and polarity = 'NEGATIVE')
        or (act in ('REQUIREMENT','INTEREST','TRANSACTION_INTENT') and polarity = 'POSITIVE')
      );
  end if;

  -- AN OBJECTION WITH NO DIMENSION IS A MOOD. "It's expensive" is about the price; a
  -- complaint about nothing in particular cannot be acted on and must not be stored as
  -- though it could.
  if not exists (select 1 from pg_constraint
                  where conrelid='public.intent_signals'::regclass
                    and conname='intent_signals_objection_has_dimension') then
    alter table public.intent_signals add constraint intent_signals_objection_has_dimension
      check (act <> 'OBJECTION' or dimension is not null);
  end if;
end $$;

-- ONE MESSAGE CAN SAY SEVERAL THINGS.
--
-- "I like it but it's expensive, and I'd go to 170" is an interest, a price objection and
-- a refined budget — three signals from one source event. The identity therefore has to
-- include what was said, not only where it came from, or the second reading would
-- overwrite the first and the message would arrive having said one thing.
--
-- `dimension` is coalesced because null is not equal to null in a unique index, and two
-- dimensionless signals of the same act genuinely are the same signal.
drop index if exists public.intent_signals_source_key;
create unique index if not exists intent_signals_source_key
  on public.intent_signals (
    source_surface, source_event_id, side, act, coalesce(dimension, '')
  );
