-- THE SUBSIDY RULE, RECONCILED WITH THE DECREE IT CLAIMS TO IMPLEMENT.
--
-- Source read on 2026-09-19: Government of Georgia Decree No. 388 of
-- 2 August 2021, consolidated text at
-- matsne.gov.ge/ka/document/view/5231778, as amended by Decree No. 218
-- of 21 May 2026; corroborated against enterprisegeorgia.gov.ge.
--
-- THREE THINGS IN THE ROW DID NOT MATCH IT, AND TWO OF THEM PRODUCED
-- FALSE MATCHES — the one error a programme checker must never make.
--
--   1. BEING A SINGLE PARENT WAS A WAY IN. The decree lists
--      "ოჯახს/მარტოხელა მშობელს/ქვრივს" INSIDE each child condition of
--      Article 2 §5, not beside them. A single parent with no
--      qualifying child satisfies nothing, and the old data said they
--      likely matched. It is CONTEXT now.
--
--   2. HAVING THREE CHILDREN WAS A LIVE WAY IN. Article 2 §5(b) admits
--      a family with three or more children only where the loan is
--      taken "2022 წლის 1 სექტემბრის ჩათვლით" — up to and including
--      1 September 2022. That window closed four years ago. The answer
--      still matters, because it selects which subsidy formula applies
--      (3.5 points off, or 1.5), so the question stays and becomes
--      CONTEXT with the closing date recorded on it.
--
--   3. THE CHILD CONDITION LEFT OUT THE AGE. Article 2 §5(a) requires a
--      child UNDER ONE YEAR OLD at the time the loan is taken, born
--      after 1 September 2021. The question asked only about the birth
--      date, so a family whose child was born in 2022 and is now four
--      answered yes. The prompt and description keys are unchanged; the
--      strings behind them now carry the age, in all six languages.
--
-- ALSO: the row's `title` is English administrative prose with a decree
-- number in it, and it was rendered verbatim on the Georgian page.
-- `titleKey` is the customer-facing name. The English title stays where
-- the people who maintain this row can read it.
--
-- Nothing about the money changes. maxLoanAmount, durationMonths and
-- both rate formulas are exactly as they were and exactly as the decree
-- states them.

update public.mortgage_rules
   set data = data
     || jsonb_build_object('titleKey', 'mortgage_kb_subsidy_title')
     || jsonb_build_object('eligibilityCriteria', jsonb_build_array(
          jsonb_build_object(
            'key', 'georgian_citizenship',
            'role', 'MANDATORY',
            'mandatory', true,
            'description', 'mortgage_kb_subsidy_eligibility_citizenship',
            'metKey', 'mortgage_kb_subsidy_met_citizenship',
            'failureKey', 'mortgage_kb_subsidy_failed_citizenship',
            'question', jsonb_build_object(
              'id', 'citizenship', 'type', 'YES_NO',
              'promptKey', 'mortgage_kb_subsidy_q_citizenship',
              'satisfiedWhenYes', true)
          ),
          jsonb_build_object(
            'key', 'no_prior_2020_mechanism',
            'role', 'MANDATORY',
            'mandatory', true,
            'description', 'mortgage_kb_subsidy_eligibility_no_prior_scheme',
            'metKey', 'mortgage_kb_subsidy_met_no_prior_scheme',
            'failureKey', 'mortgage_kb_subsidy_failed_no_prior_scheme',
            'question', jsonb_build_object(
              'id', 'prior_scheme', 'type', 'YES_NO',
              'promptKey', 'mortgage_kb_subsidy_q_prior_scheme',
              'satisfiedWhenYes', false)
          ),
          jsonb_build_object(
            'key', 'children_born_after_2021_09_01',
            'role', 'ROUTE',
            'description', 'mortgage_kb_subsidy_eligibility_child_born_after',
            'metKey', 'mortgage_kb_subsidy_met_child_under_one',
            'question', jsonb_build_object(
              'id', 'child_after_2021', 'type', 'YES_NO',
              'promptKey', 'mortgage_kb_subsidy_q_child_after_2021',
              'satisfiedWhenYes', true)
          ),
          jsonb_build_object(
            'key', 'adopted_child_after_2021_09_01',
            'role', 'ROUTE',
            'description', 'mortgage_kb_subsidy_eligibility_adopted_child',
            'metKey', 'mortgage_kb_subsidy_met_adopted_child',
            'question', jsonb_build_object(
              'id', 'adopted_after_2021', 'type', 'YES_NO',
              'promptKey', 'mortgage_kb_subsidy_q_adopted_after_2021',
              'satisfiedWhenYes', true)
          ),
          jsonb_build_object(
            'key', 'three_plus_children_by_2022_09_01',
            'role', 'CONTEXT',
            'routeClosedOn', '2022-09-01',
            'description', 'mortgage_kb_subsidy_eligibility_three_plus_children',
            'question', jsonb_build_object(
              'id', 'three_plus_children', 'type', 'NUMBER',
              'promptKey', 'mortgage_kb_subsidy_q_children_count',
              'satisfiedWhenAtLeast', 3)
          ),
          jsonb_build_object(
            'key', 'single_parent_or_widow',
            'role', 'CONTEXT',
            'description', 'mortgage_kb_subsidy_eligibility_single_parent_widow',
            'question', jsonb_build_object(
              'id', 'single_parent', 'type', 'YES_NO',
              'promptKey', 'mortgage_kb_subsidy_q_single_parent',
              'satisfiedWhenYes', true)
          )
        )),
       last_verified_at = date '2026-09-19'
 where type = 'SUBSIDY_PROGRAM'
   and country = 'GE'
   and status = 'ACTIVE';
