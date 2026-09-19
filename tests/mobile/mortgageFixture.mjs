// Fixtures for the Home Financing workspace gate.
//
// Kept beside fixture.mjs rather than inside it: that file is the
// verification report's adversarial payload and is already long, and
// nothing here is shared with it.

/* ────────────────────────────────────────────────────────────────────
 * THE KNOWLEDGE BASE, AS PRODUCTION SERVES IT
 *
 * The nine ACTIVE rows, copied out of the production database rather
 * than invented, because part of what is under test is whether the page
 * can render what production actually sends: long authority names, a
 * six-criterion subsidy programme, and i18n keys stored in COLUMN
 * VALUES. A prettier fixture would test a prettier product — and the
 * defect that shipped (a raw key printed at customers) lived exactly in
 * the gap between the two.
 *
 * Refresh with:
 *   select * from public.mortgage_rules where status='ACTIVE' and country='GE';
 * ──────────────────────────────────────────────────────────────────── */
export const MORTGAGE_RULES = [
  {
    id: 'c39bb5ef-7b28-469a-85b5-ff65f35d5fb8', type: 'PTI_LIMIT',
    title: 'PTI limit — GEL loans, monthly net income below 1,500 GEL',
    data: { currencyClass: 'LOCAL', maxPtiPercent: 25, incomeTierMaxMonthlyNet: 1500 },
    human_explanation: 'mortgage_kb_explain_pti_gel_low_income',
    official_source_url: 'https://nbg.gov.ge/page/pti-da-ltv-motkhovnebi',
    source_authority: 'National Bank of Georgia',
    effective_from: null, effective_to: null, last_verified_at: '2026-09-19',
    status: 'ACTIVE', version: 1, supersedes_rule_id: null,
    country: 'GE', currency: 'GEL',
    eligibility_dimensions: { incomeCurrencyEquivalentThreshold: 1500 },
    created_at: '2026-09-07T17:31:41.921181+00:00',
  },
  {
    id: '2c174bdf-1f49-4d7f-96a8-343ec445fbee', type: 'PTI_LIMIT',
    title: 'PTI limit — GEL loans, monthly net income 1,500 GEL or above',
    data: { currencyClass: 'LOCAL', maxPtiPercent: 50, incomeTierMaxMonthlyNet: null },
    human_explanation: 'mortgage_kb_explain_pti_gel_high_income',
    official_source_url: 'https://nbg.gov.ge/page/pti-da-ltv-motkhovnebi',
    source_authority: 'National Bank of Georgia',
    effective_from: null, effective_to: null, last_verified_at: '2026-09-19',
    status: 'ACTIVE', version: 1, supersedes_rule_id: null,
    country: 'GE', currency: 'GEL',
    eligibility_dimensions: { incomeCurrencyEquivalentThreshold: 1500 },
    created_at: '2026-09-07T17:31:41.921181+00:00',
  },
  {
    id: '1436caf3-38f5-4c4f-ade4-0cebab63c131', type: 'PTI_LIMIT',
    title: 'PTI limit — foreign-currency loans, monthly net income below 1,500 GEL-equivalent',
    data: { currencyClass: 'FOREIGN', maxPtiPercent: 20, incomeTierMaxMonthlyNet: 1500 },
    human_explanation: 'mortgage_kb_explain_pti_fx_low_income',
    official_source_url: 'https://nbg.gov.ge/page/pti-da-ltv-motkhovnebi',
    source_authority: 'National Bank of Georgia',
    effective_from: null, effective_to: null, last_verified_at: '2026-09-19',
    status: 'ACTIVE', version: 1, supersedes_rule_id: null,
    country: 'GE', currency: null,
    eligibility_dimensions: { incomeCurrencyEquivalentThreshold: 1500 },
    created_at: '2026-09-07T17:31:41.921181+00:00',
  },
  {
    id: '57342a93-6656-49d9-900a-8f3517009c7a', type: 'PTI_LIMIT',
    title: 'PTI limit — foreign-currency loans, monthly net income 1,500 GEL-equivalent or above',
    data: { currencyClass: 'FOREIGN', maxPtiPercent: 30, incomeTierMaxMonthlyNet: null },
    human_explanation: 'mortgage_kb_explain_pti_fx_high_income',
    official_source_url: 'https://nbg.gov.ge/page/pti-da-ltv-motkhovnebi',
    source_authority: 'National Bank of Georgia',
    effective_from: null, effective_to: null, last_verified_at: '2026-09-19',
    status: 'ACTIVE', version: 1, supersedes_rule_id: null,
    country: 'GE', currency: null,
    eligibility_dimensions: { incomeCurrencyEquivalentThreshold: 1500 },
    created_at: '2026-09-07T17:31:41.921181+00:00',
  },
  {
    id: '2cf2105f-f106-4afd-86b9-0b599eff4a3c', type: 'LTV_LIMIT',
    title: 'LTV limit — GEL-denominated loans',
    data: { currencyClass: 'LOCAL', maxLtvPercent: 90 },
    human_explanation: 'mortgage_kb_explain_ltv_gel',
    official_source_url: 'https://nbg.gov.ge/page/pti-da-ltv-motkhovnebi',
    source_authority: 'National Bank of Georgia',
    effective_from: null, effective_to: null, last_verified_at: '2026-09-19',
    status: 'ACTIVE', version: 1, supersedes_rule_id: null,
    country: 'GE', currency: 'GEL', eligibility_dimensions: null,
    created_at: '2026-09-07T17:31:41.921181+00:00',
  },
  {
    id: '1342d0b7-fb1f-4619-9cae-bdd28065582c', type: 'LTV_LIMIT',
    title: 'LTV limit — foreign-currency-denominated loans',
    data: { currencyClass: 'FOREIGN', maxLtvPercent: 70 },
    human_explanation: 'mortgage_kb_explain_ltv_fx',
    official_source_url: 'https://nbg.gov.ge/page/pti-da-ltv-motkhovnebi',
    source_authority: 'National Bank of Georgia',
    effective_from: null, effective_to: null, last_verified_at: '2026-09-19',
    status: 'ACTIVE', version: 1, supersedes_rule_id: null,
    country: 'GE', currency: null, eligibility_dimensions: null,
    created_at: '2026-09-07T17:31:41.921181+00:00',
  },
  {
    id: '9e324261-c83e-4bf0-a330-571f77bcaf37', type: 'EFFECTIVE_RATE_METHODOLOGY',
    title: 'Effective interest rate — official calculator inputs',
    data: {
      projectMethodology: 'IRR_CASH_FLOW_ESTIMATE',
      officialCalculatorInputs: [
        'loanAmountAndCurrency', 'gracePeriodMonths', 'maturityAfterGrace',
        'annualInterestRatePercent', 'issuanceAndPaymentDates', 'paymentFrequency',
        'oneTimeFinancialCostsAtIssuance', 'periodicFinancialCosts',
        'periodicFinancialCostsPercentOfRemainingPrincipal',
      ],
    },
    human_explanation: 'mortgage_kb_explain_effective_rate_methodology',
    official_source_url: 'https://nbg.gov.ge/en/calculators?calculator=loaneffectiveinterest',
    source_authority: 'National Bank of Georgia',
    effective_from: null, effective_to: null, last_verified_at: '2026-09-19',
    status: 'ACTIVE', version: 1, supersedes_rule_id: null,
    country: 'GE', currency: null, eligibility_dimensions: null,
    created_at: '2026-09-07T17:31:41.921181+00:00',
  },
  {
    id: '3229be6f-3c6c-44dd-9562-7ea6e5200982', type: 'SUBSIDY_PROGRAM',
    title: 'Subsidized Mortgage Loan — families with children (Decree No. 388, as amended by No. 218 of 21 May 2026)',
    data: {
      currency: 'GEL',
      programName: 'Subsidized Mortgage Loan',
      administrator: 'Government of Georgia (Decree No. 388, 2 August 2021; last amended by Decree No. 218, 21 May 2026)',
      maxLoanAmount: 200000,
      durationMonths: 60,
      subsidyDescription: 'mortgage_kb_subsidy_description_rate_reduction',
      subsidyRateFormula: {
        oneToTwoChildren: 'NBG_refinancing_rate_minus_3.5pp_capped_at_6pct',
        threeOrMoreChildren: 'NBG_refinancing_rate_minus_1.5pp_capped_at_8pct',
      },
      citizenshipRequired: true,
      titleKey: 'mortgage_kb_subsidy_title',
      administratorKey: 'mortgage_kb_subsidy_administrator',
      eligibilityCriteria: [
        {
          key: 'georgian_citizenship', role: 'MANDATORY', mandatory: true,
          description: 'mortgage_kb_subsidy_eligibility_citizenship',
          metKey: 'mortgage_kb_subsidy_met_citizenship',
          failureKey: 'mortgage_kb_subsidy_failed_citizenship',
          question: { id: 'citizenship', type: 'YES_NO', promptKey: 'mortgage_kb_subsidy_q_citizenship', satisfiedWhenYes: true },
        },
        {
          key: 'no_prior_2020_mechanism', role: 'MANDATORY', mandatory: true,
          description: 'mortgage_kb_subsidy_eligibility_no_prior_scheme',
          metKey: 'mortgage_kb_subsidy_met_no_prior_scheme',
          failureKey: 'mortgage_kb_subsidy_failed_no_prior_scheme',
          question: { id: 'prior_scheme', type: 'YES_NO', promptKey: 'mortgage_kb_subsidy_q_prior_scheme', satisfiedWhenYes: false },
        },
        {
          key: 'children_born_after_2021_09_01', role: 'ROUTE',
          description: 'mortgage_kb_subsidy_eligibility_child_born_after',
          metKey: 'mortgage_kb_subsidy_met_child_under_one',
          question: { id: 'child_after_2021', type: 'YES_NO', promptKey: 'mortgage_kb_subsidy_q_child_after_2021', satisfiedWhenYes: true },
        },
        {
          key: 'adopted_child_after_2021_09_01', role: 'ROUTE',
          description: 'mortgage_kb_subsidy_eligibility_adopted_child',
          metKey: 'mortgage_kb_subsidy_met_adopted_child',
          question: { id: 'adopted_after_2021', type: 'YES_NO', promptKey: 'mortgage_kb_subsidy_q_adopted_after_2021', satisfiedWhenYes: true },
        },
        {
          key: 'three_plus_children_by_2022_09_01', role: 'CONTEXT', routeClosedOn: '2022-09-01',
          description: 'mortgage_kb_subsidy_eligibility_three_plus_children',
          question: { id: 'three_plus_children', type: 'NUMBER', promptKey: 'mortgage_kb_subsidy_q_children_count', satisfiedWhenAtLeast: 3 },
        },
        {
          key: 'single_parent_or_widow', role: 'CONTEXT',
          description: 'mortgage_kb_subsidy_eligibility_single_parent_widow',
          question: { id: 'single_parent', type: 'YES_NO', promptKey: 'mortgage_kb_subsidy_q_single_parent', satisfiedWhenYes: true },
        },
      ],
      propertyConditionKey: 'mortgage_kb_subsidy_property_condition',
    },
    human_explanation: 'mortgage_kb_subsidy_human_explanation',
    official_source_url: 'https://www.matsne.gov.ge/ka/document/view/5231778',
    source_authority: 'Government of Georgia / LEPL Legislative Herald of Georgia (Matsne)',
    effective_from: '2021-09-01', effective_to: null, last_verified_at: '2026-09-19',
    status: 'ACTIVE', version: 2, supersedes_rule_id: '800bd4c1-07f7-4595-8d57-f00ebff7f82d',
    country: 'GE', currency: 'GEL',
    eligibility_dimensions: { requiresChildren: true, citizenshipRequired: 'GE' },
    created_at: '2026-09-19T12:26:49.281952+00:00',
  },
  {
    id: '50f4074e-3e8c-45f5-9cfe-786e2ca13bd7', type: 'REFERENCE_RATE',
    title: 'National Bank of Georgia monetary policy (refinancing) rate',
    data: { rateName: 'NBG_refinancing_rate', ratePercent: 8.25, decisionDate: '2026-09-09', nextReviewDate: null },
    human_explanation: 'mortgage_kb_explain_reference_rate',
    official_source_url: 'https://nbg.gov.ge/en/page/monetary-policy-rate',
    source_authority: 'National Bank of Georgia',
    effective_from: '2026-09-09', effective_to: null, last_verified_at: '2026-09-19',
    status: 'ACTIVE', version: 1, supersedes_rule_id: null,
    country: 'GE', currency: 'GEL', eligibility_dimensions: null,
    created_at: '2026-09-19T12:26:49.281952+00:00',
  },
];

/**
 * A fully entered financing scenario, written into localStorage under
 * the key the workspace persists to.
 *
 * The point is DENSITY. An empty workspace fits any phone; what has to
 * fit is a 240-month amortization schedule, an eight-segment rate
 * decomposition, a term ladder, and a PTI panel carrying an authority
 * name and a verification date.
 *
 * One field is deliberately null — the early-repayment fee — because
 * the honest "this is not known and is not being assumed to be zero"
 * notice is itself a layout that has to fit.
 */
export const MORTGAGE_DRAFT = {
  propertyPrice: 185000,
  currency: 'GEL',
  downPayment: 37000,
  termMonths: 240,
  nominalAnnualRatePercent: 12.4,

  rateType: 'INDEXED',
  originationFeePercent: 1,
  monthlyFeeFlat: 12,
  mandatoryInsuranceAnnualFlat: 320,
  valuationFeeFlat: 150,
  gracePeriodMonths: 3,
  effectiveAnnualRatePercentFromBank: 14.9,

  monthlyNetIncome: 3200,
  existingMonthlyDebtObligations: 450,

  extraPaymentAmount: 5000,
  extraPaymentMonth: 24,
  recurringMonthlyExtra: 100,
  knownEarlyRepaymentFeeFlat: null,

  ownRemainingPrincipal: 92000,
  ownRemainingTermMonths: 168,
  ownNominalRatePercent: 15.2,
  refiNewRatePercent: 12.1,
  refiNewTermMonths: 180,
  refinancingFeesFlat: 900,
};

export const MORTGAGE_DRAFT_KEY = 'homatch.mortgage.draft.v1';
export const MORTGAGE_TOPIC_KEY = 'homatch.mortgage.topic.v1';

/**
 * The optional tools, and the module each one must produce.
 *
 * Five, not the nine the page used to open with: the monthly payment is
 * now the result, the effective rate and the term ladder live under
 * Details, and "before you sign" is reading rather than a workflow.
 */
export const MORTGAGE_TOOLS = [
  { id: 'EARLY_REPAYMENT', anchor: '#early-input' },
  { id: 'COMPARE_OFFERS', anchor: '#offers-input' },
  { id: 'AFFORDABILITY', anchor: '#affordability, #income' },
  { id: 'REFINANCING', anchor: '#refi-input' },
  { id: 'GOVERNMENT_PROGRAMS', anchor: '[id^="program-"]' },
];

/** What a result rendered in each currency must and must not contain. */
export const CURRENCY_MARKERS = {
  GEL: { present: ['₾', 'GEL'], absent: ['₺', '£', '€', 'AED'] },
  USD: { present: ['$', 'USD'], absent: ['₾', '₺', '£', '€', 'AED'] },
  EUR: { present: ['€', 'EUR'], absent: ['₾', '₺', '£', 'AED'] },
  GBP: { present: ['£', 'GBP'], absent: ['₾', '₺', '€', 'AED'] },
  TRY: { present: ['₺', 'TRY'], absent: ['₾', '£', '€', 'AED'] },
  AED: { present: ['AED', 'د.إ'], absent: ['₾', '₺', '£', '€'] },
};
