-- THE ADMINISTRATOR, IN THE READER'S LANGUAGE.
--
-- The row's `administrator` reads, verbatim:
--
--   Government of Georgia (Decree No. 388, 2 August 2021; last amended
--   by Decree No. 218, 21 May 2026)
--
-- It is written for the people who maintain this knowledge base, and it
-- was printed under a Georgian eligibility result: English prose, two
-- decree numbers and a semicolon, in the one place a family is reading
-- whether the state will help them buy a flat.
--
-- The decree citation is not lost. It is one tap away behind
-- official_source_url, which points at the consolidated text, and the
-- administrator column keeps saying exactly what it said to the people
-- who curate it.

update public.mortgage_rules
   set data = data || jsonb_build_object(
         'administratorKey', 'mortgage_kb_subsidy_administrator')
 where type = 'SUBSIDY_PROGRAM'
   and country = 'GE'
   and status = 'ACTIVE';
