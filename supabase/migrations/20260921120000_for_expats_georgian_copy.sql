-- HOMATCH FOR EXPATS — Georgian copy corrections.
--
-- The owner read the live Georgian pages and found the prose was not of
-- production quality. It was not: four of the sentences below are wrong
-- Georgian rather than merely stiff, and two of them say something other
-- than what the English says.
--
--   healthcare-and-insurance, summary
--     "გირჩევნიათ ეს გითხრათ" puts the preference on the reader — "you
--     would rather we told you this". The English is "we would rather tell
--     you that", which is გვირჩევნია. The clause before it had the same
--     fault: "გიხსნით" agrees with a first-person-plural subject, so the
--     sentence read as though Homatch, not a residence status, admitted
--     people to the state programme.
--
--   residence-permits, summary
--     "...და ყველას ერთი უწყება." has no verb. Georgian will not carry
--     the elision across the conjunction the way English does.
--
--   residence-permits, short answer
--     "გადაწყვეტილება ... დღეს იღებს" is a calque of "the decision takes
--     thirty days"; in Georgian იღებს means the decision is doing the
--     taking. And "სწრაფი კი მეტს" is left in a case its verb never
--     supplies.
--
--   residence-permits, cost
--     "მეოცდაათე" is not how thirtieth is spelled — it is მეოცდამეათე —
--     and the three ordinals in the list were each governed differently.
--     The fact statement for the same fee had the matching slip: two of
--     the three days took დღეს and the third took -ზე.
--
-- NOTHING FACTUAL MOVES HERE. Every figure, date, fee, authority name and
-- citation is byte-for-byte what it was; only Georgian wording changes.
-- last_verified_at is therefore left alone: these pages have not been
-- re-verified, they have been proofread, and moving the date would claim
-- the first while doing the second.
--
-- The edits are applied to the serialised `ka` subtree by exact string
-- replacement. That keeps each change to the one sentence it is about and
-- leaves the other five locales, the section order and every other key
-- untouched. None of these strings contains a quote or a backslash, so
-- the text form is safe to rewrite. The DO block at the end refuses to let
-- the migration succeed if any replacement did not land.

begin;

-- 1. healthcare-and-insurance: the summary's two person errors.
update public.expat_topics
set content = jsonb_set(
  content,
  '{ka}',
  replace(
    (content -> 'ka')::text,
    'გიხსნით თუ არა რომელიმე ბინადრობის სტატუსი სახელმწიფო პროგრამას, ვერ დავადასტურეთ და გირჩევნიათ ეს გითხრათ.',
    'აძლევს თუ არა რომელიმე ბინადრობის სტატუსი სახელმწიფო პროგრამაში ჩართვის უფლებას, ვერ დავადასტურეთ და გვირჩევნია ეს გითხრათ.'
  )::jsonb
)
where country = 'GE' and slug = 'healthcare-and-insurance';

-- 2. residence-permits: the verbless second clause in the summary.
update public.expat_topics
set content = jsonb_set(
  content,
  '{ka}',
  replace(
    (content -> 'ka')::text,
    'საქართველო ათზე მეტი სახის ბინადრობის ნებართვას გასცემს და ყველას ერთი უწყება.',
    'საქართველოში ათზე მეტი სახის ბინადრობის ნებართვა არსებობს და ყველას ერთი უწყება გასცემს.'
  )::jsonb
)
where country = 'GE' and slug = 'residence-permits';

-- 3. residence-permits: the "decision takes thirty days" calque.
update public.expat_topics
set content = jsonb_set(
  content,
  '{ka}',
  replace(
    (content -> 'ka')::text,
    'სტანდარტული გადაწყვეტილება ოცდაათ კალენდარულ დღეს იღებს და 300 ლარი ღირს, სწრაფი კი მეტს.',
    'სტანდარტული გადაწყვეტილება ოცდაათ კალენდარულ დღეში მიიღება და 300 ლარი ღირს, სწრაფი კი მეტი.'
  )::jsonb
)
where country = 'GE' and slug = 'residence-permits';

-- 4. residence-permits: the misspelt thirtieth and the three loose ordinals.
update public.expat_topics
set content = jsonb_set(
  content,
  '{ka}',
  replace(
    (content -> 'ka')::text,
    'გადაწყვეტილება მეოცდაათე კალენდარულ დღეს 300 ლარად, მეოცეზე 450-ად, მეათეზე 600-ად.',
    'გადაწყვეტილება მეოცდამეათე კალენდარულ დღეს 300 ლარად, მეოცე დღეს 450-ად, მეათე დღეს 600-ად.'
  )::jsonb
)
where country = 'GE' and slug = 'residence-permits';

-- 5. The same fee stated as a sourced fact: one ordinal took the wrong
--    postposition. The numbers are untouched and the citation is not
--    involved.
update public.expat_topic_facts
set statement = jsonb_set(
  statement,
  '{ka}',
  to_jsonb(
    replace(
      statement ->> 'ka',
      'მე-20 დღეს 450 ლარი, მე-10-ზე 600 ლარი.',
      'მე-20 დღეს 450 ლარი, მე-10 დღეს 600 ლარი.'
    )
  )
)
where fact_key = 'standard-fee';

-- Refuse to commit a migration that quietly changed nothing. Each of these
-- is the phrase the edit above was supposed to remove.
do $$
declare
  leftover text;
begin
  select string_agg(label, ', ') into leftover
  from (
    select 'healthcare summary' as label
      from public.expat_topics
     where slug = 'healthcare-and-insurance'
       and (content -> 'ka')::text like '%გირჩევნიათ ეს გითხრათ%'
    union all
    select 'residence summary'
      from public.expat_topics
     where slug = 'residence-permits'
       and (content -> 'ka')::text like '%და ყველას ერთი უწყება.%'
    union all
    select 'residence short answer'
      from public.expat_topics
     where slug = 'residence-permits'
       and (content -> 'ka')::text like '%კალენდარულ დღეს იღებს%'
    union all
    select 'residence cost'
      from public.expat_topics
     where slug = 'residence-permits'
       and (content -> 'ka')::text like '%მეოცდაათე კალენდარულ%'
    union all
    select 'standard-fee statement'
      from public.expat_topic_facts
     where fact_key = 'standard-fee'
       and statement ->> 'ka' like '%მე-10-ზე%'
  ) s;

  if leftover is not null then
    raise exception 'Georgian copy fix did not apply to: %', leftover;
  end if;
end;
$$;

commit;
