-- The data half of the 2026-09-19 re-verification. Separate statement
-- because a value added to an enum in a transaction cannot be used
-- inside that same transaction.
--
-- APPLIED-AND-RECORDED, NOT PENDING. This file's version prefix is the
-- version supabase_migrations.schema_migrations actually holds for it,
-- and supabase/migration-baseline.json was extended in the same change.

-- ── PTI / LTV: re-checked, unchanged, freshness advanced ────────────
--
-- All six figures on nbg.gov.ge/page/pti-da-ltv-motkhovnebi still read
-- exactly as the knowledge base holds them (GEL 25/50, FX 20/30 at the
-- 1,500 GEL income boundary; LTV 90 GEL / 70 FX). The page still states
-- no effective date, so effective_from stays null rather than being
-- invented — last_verified_at is the honest field for "we looked today".
update public.mortgage_rules
   set last_verified_at = date '2026-09-19'
 where status = 'ACTIVE'
   and type in ('PTI_LIMIT', 'LTV_LIMIT', 'EFFECTIVE_RATE_METHODOLOGY');

-- ── The National Bank's policy rate ─────────────────────────────────
insert into public.mortgage_rules (
  type, title, data, human_explanation, official_source_url, source_authority,
  effective_from, effective_to, last_verified_at, status, version, country, currency
) values (
  'REFERENCE_RATE',
  'National Bank of Georgia monetary policy (refinancing) rate',
  jsonb_build_object(
    'rateName', 'NBG_refinancing_rate',
    'ratePercent', 8.25,
    'decisionDate', '2026-09-09',
    'nextReviewDate', null
  ),
  'mortgage_kb_explain_reference_rate',
  'https://nbg.gov.ge/en/page/monetary-policy-rate',
  'National Bank of Georgia',
  date '2026-09-09', null, date '2026-09-19', 'ACTIVE', 1, 'GE', 'GEL'
);

-- ── Decree 388: the conditions, made checkable ──────────────────────
--
-- The existing row stays the historical version; this supersedes it.
-- What changed: four criteria gained a machine-evaluable question so
-- "likely match" can be computed instead of guessed, citizenship became
-- an explicitly mandatory criterion, and the 2020-mechanism exclusion —
-- stated in the decree and missing from the knowledge base — was added.
-- The most recent amendment (Decree No. 218 of 21 May 2026) is recorded.
with previous as (
  select id from public.mortgage_rules
   where type = 'SUBSIDY_PROGRAM' and status = 'ACTIVE' and country = 'GE'
   limit 1
)
insert into public.mortgage_rules (
  type, title, data, human_explanation, official_source_url, source_authority,
  effective_from, effective_to, last_verified_at, status, version,
  supersedes_rule_id, country, currency, eligibility_dimensions
)
select
  'SUBSIDY_PROGRAM',
  'Subsidized Mortgage Loan — families with children (Decree No. 388, as amended by No. 218 of 21 May 2026)',
  jsonb_build_object(
    'programName', 'Subsidized Mortgage Loan',
    'administrator', 'Government of Georgia (Decree No. 388, 2 August 2021; last amended by Decree No. 218, 21 May 2026)',
    'maxLoanAmount', 200000,
    'currency', 'GEL',
    'durationMonths', 60,
    'citizenshipRequired', true,
    'subsidyDescription', 'mortgage_kb_subsidy_description_rate_reduction',
    'propertyConditionKey', 'mortgage_kb_subsidy_property_condition',
    'subsidyRateFormula', jsonb_build_object(
      'oneToTwoChildren', 'NBG_refinancing_rate_minus_3.5pp_capped_at_6pct',
      'threeOrMoreChildren', 'NBG_refinancing_rate_minus_1.5pp_capped_at_8pct'
    ),
    'eligibilityCriteria', jsonb_build_array(
      jsonb_build_object(
        'key', 'georgian_citizenship',
        'description', 'mortgage_kb_subsidy_eligibility_citizenship',
        'mandatory', true,
        'question', jsonb_build_object(
          'id', 'citizenship', 'type', 'YES_NO',
          'promptKey', 'mortgage_kb_subsidy_q_citizenship', 'satisfiedWhenYes', true
        )
      ),
      jsonb_build_object(
        'key', 'no_prior_2020_mechanism',
        'description', 'mortgage_kb_subsidy_eligibility_no_prior_scheme',
        'mandatory', true,
        'question', jsonb_build_object(
          'id', 'prior_scheme', 'type', 'YES_NO',
          'promptKey', 'mortgage_kb_subsidy_q_prior_scheme', 'satisfiedWhenYes', false
        )
      ),
      jsonb_build_object(
        'key', 'children_born_after_2021_09_01',
        'description', 'mortgage_kb_subsidy_eligibility_child_born_after',
        'question', jsonb_build_object(
          'id', 'child_after_2021', 'type', 'YES_NO',
          'promptKey', 'mortgage_kb_subsidy_q_child_after_2021', 'satisfiedWhenYes', true
        )
      ),
      jsonb_build_object(
        'key', 'three_plus_children_by_2022_09_01',
        'description', 'mortgage_kb_subsidy_eligibility_three_plus_children',
        'question', jsonb_build_object(
          'id', 'three_plus_children', 'type', 'NUMBER',
          'promptKey', 'mortgage_kb_subsidy_q_children_count', 'satisfiedWhenAtLeast', 3
        )
      ),
      jsonb_build_object(
        'key', 'adopted_child_after_2021_09_01',
        'description', 'mortgage_kb_subsidy_eligibility_adopted_child',
        'question', jsonb_build_object(
          'id', 'adopted_after_2021', 'type', 'YES_NO',
          'promptKey', 'mortgage_kb_subsidy_q_adopted_after_2021', 'satisfiedWhenYes', true
        )
      ),
      jsonb_build_object(
        'key', 'single_parent_or_widow',
        'description', 'mortgage_kb_subsidy_eligibility_single_parent_widow',
        'question', jsonb_build_object(
          'id', 'single_parent', 'type', 'YES_NO',
          'promptKey', 'mortgage_kb_subsidy_q_single_parent', 'satisfiedWhenYes', true
        )
      )
    )
  ),
  'mortgage_kb_subsidy_human_explanation',
  'https://www.matsne.gov.ge/ka/document/view/5231778',
  'Government of Georgia / LEPL Legislative Herald of Georgia (Matsne)',
  date '2021-09-01', null, date '2026-09-19', 'ACTIVE', 2,
  previous.id, 'GE', 'GEL',
  jsonb_build_object('requiresChildren', true, 'citizenshipRequired', 'GE')
from previous;

update public.mortgage_rules
   set status = 'SUPERSEDED'
 where type = 'SUBSIDY_PROGRAM' and status = 'ACTIVE' and version = 1 and country = 'GE';
