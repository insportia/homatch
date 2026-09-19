// HOMATCH INVESTMENT INTELLIGENCE — the four investment products, as data.
//
// WHY THE FORMS ARE A TABLE AND NOT JSX
//
// Four strategies, six languages, and two rules that have to hold across
// all of them: a strategy must produce its headline the moment its REQUIRED
// answers exist, and a question must never be asked when a previous answer
// already settled it. Expressing that in markup puts both rules where
// nothing can test them and every locale can drift from them.
//
// CLICK FIRST
//
// Every field declares a CONTROL, and the default is not a text box. Chips
// for anything with sensible options, a choice for anything that is really
// a decision, yes/no for a gate, and typing only where the number is
// genuinely this property's own — its price, its rent, the resale the
// investor has in mind. `presets.ts` supplies the options, computed from
// what has already been answered.
//
// DEPENDENT QUESTIONS
//
// `gate` means "only ask this if that was answered this way". Somebody
// buying for cash is never shown an interest rate; somebody whose flat is
// already renovated is never asked for a renovation budget. The gate is
// declared beside the field rather than handled in the renderer, so the
// completeness check honours it too — a hidden field can never be counted
// as missing.
//
// WHAT "REQUIRED" MEANS
//
// The minimum for the strategy to say something true, not the minimum for a
// complete analysis. Rental needs a price and a rent; it will show the
// gross yield and say plainly that there is no net yield until a running
// cost exists. Optional answers sharpen the result; they never gate it.

import type { ContextNumericField, ContextTextField } from '../consultant/context.ts';

export const STRATEGY_IDS = [
  'RENOVATE_RESELL',
  'CONSTRUCTION_RESALE',
  'RENTAL_INVESTMENT',
  'INVESTMENT_VALUE',
] as const;

export type StrategyId = (typeof STRATEGY_IDS)[number];

export function isStrategyId(value: unknown): value is StrategyId {
  return typeof value === 'string' && (STRATEGY_IDS as readonly string[]).includes(value);
}

/** What the value IS — drives formatting and the custom input's keyboard. */
export type ValueKind = 'money' | 'moneyPerSqm' | 'percent' | 'number' | 'months' | 'text';

/** How it is ANSWERED. Typing is the last resort, never the default. */
export type ControlKind =
  /** Preset chips plus a "custom" escape hatch. The workhorse. */
  | 'chips'
  /** A small set of named answers, as a segmented control. */
  | 'choice'
  /** A small set of named answers, as large cards. For real decisions. */
  | 'cards'
  /** Two answers. A gate. */
  | 'yesno'
  /** Free text. Names and places only. */
  | 'text';

export interface FieldOption {
  value: string;
  labelKey: string;
  /** Shown under the label on a card. */
  descriptionKey?: string;
}

/** Only ask this field when another field holds one of these values. */
export interface FieldGate {
  field: ContextTextField;
  equals: string[];
}

export interface FieldDef {
  field: ContextNumericField | ContextTextField;
  labelKey: string;
  kind: ValueKind;
  control: ControlKind;
  required: boolean;
  hintKey?: string;
  options?: FieldOption[];
  gate?: FieldGate;
  /**
   * Two fields answering one question in different units — a total and a
   * rate. Supplying either satisfies the requirement, and the interface
   * shows the other as a calculated figure rather than a second question.
   */
  alternativeTo?: ContextNumericField | ContextTextField;
  /** Hidden behind "more detail". Real, but not worth the first screen. */
  advanced?: boolean;
}

export interface FieldGroup {
  id: string;
  titleKey: string;
  descriptionKey?: string;
  fields: FieldDef[];
}

export interface StrategyDef {
  id: StrategyId;
  titleKey: string;
  /** The business model in four words: "Buy → Renovate → Sell". */
  flowKey: string;
  descriptionKey: string;
  groups: FieldGroup[];
}

/* ── Shared option sets ─────────────────────────────────────────────── */

const YES_NO: FieldOption[] = [
  { value: 'YES', labelKey: 'inv_yes' },
  { value: 'NO', labelKey: 'inv_no' },
];

const FINANCING_MODES: FieldOption[] = [
  { value: 'CASH', labelKey: 'inv_financing_cash' },
  { value: 'MORTGAGE', labelKey: 'inv_financing_mortgage' },
];

const RENOVATION_QUALITIES: FieldOption[] = [
  { value: 'BASIC', labelKey: 'inv_quality_basic', descriptionKey: 'inv_quality_basic_desc' },
  { value: 'STANDARD', labelKey: 'inv_quality_standard', descriptionKey: 'inv_quality_standard_desc' },
  { value: 'PREMIUM', labelKey: 'inv_quality_premium', descriptionKey: 'inv_quality_premium_desc' },
  { value: 'LUXURY', labelKey: 'inv_quality_luxury', descriptionKey: 'inv_quality_luxury_desc' },
];

const CONSTRUCTION_STAGES: FieldOption[] = [
  { value: 'FOUNDATION', labelKey: 'inv_stage_foundation' },
  { value: 'FRAME', labelKey: 'inv_stage_frame' },
  { value: 'SHELL', labelKey: 'inv_stage_shell' },
  { value: 'FINISHING', labelKey: 'inv_stage_finishing' },
  { value: 'NEAR_COMPLETE', labelKey: 'inv_stage_near_complete' },
];

const EXIT_TIMINGS: FieldOption[] = [
  { value: 'AT_COMPLETION', labelKey: 'inv_exit_at_completion' },
  { value: 'PLUS_6', labelKey: 'inv_exit_plus_6' },
  { value: 'PLUS_12', labelKey: 'inv_exit_plus_12' },
  { value: 'CUSTOM', labelKey: 'inv_exit_custom' },
];

const VALUE_STRATEGIES: FieldOption[] = [
  {
    value: 'RENTAL_INVESTMENT',
    labelKey: 'inv_value_choice_rent',
    descriptionKey: 'inv_value_choice_rent_desc',
  },
  {
    value: 'RENOVATE_RESELL',
    labelKey: 'inv_value_choice_renovate',
    descriptionKey: 'inv_value_choice_renovate_desc',
  },
  {
    value: 'CONSTRUCTION_RESALE',
    labelKey: 'inv_value_choice_construction',
    descriptionKey: 'inv_value_choice_construction_desc',
  },
];

/** The financing block, identical wherever a loan is possible. */
function financingGroup(): FieldGroup {
  return {
    id: 'financing',
    titleKey: 'inv_group_financing',
    fields: [
      {
        field: 'financingMode',
        labelKey: 'inv_f_financing_mode',
        kind: 'text',
        control: 'choice',
        required: false,
        options: FINANCING_MODES,
      },
      {
        field: 'downPaymentPercent',
        labelKey: 'inv_f_down_payment_pct',
        kind: 'percent',
        control: 'chips',
        required: false,
        gate: { field: 'financingMode', equals: ['MORTGAGE'] },
      },
      {
        field: 'mortgageAnnualRatePercent',
        labelKey: 'inv_f_mortgage_rate',
        kind: 'percent',
        control: 'chips',
        required: false,
        gate: { field: 'financingMode', equals: ['MORTGAGE'] },
      },
      {
        field: 'mortgageTermMonths',
        labelKey: 'inv_f_mortgage_term',
        kind: 'months',
        control: 'chips',
        required: false,
        gate: { field: 'financingMode', equals: ['MORTGAGE'] },
      },
    ],
  };
}

/* ── A) Renovate and resell ─────────────────────────────────────────── */

const RENOVATE_RESELL: StrategyDef = {
  id: 'RENOVATE_RESELL',
  titleKey: 'inv_strategy_renovate_title',
  flowKey: 'inv_strategy_renovate_flow',
  descriptionKey: 'inv_strategy_renovate_desc',
  groups: [
    {
      id: 'property',
      titleKey: 'inv_group_purchase',
      fields: [
        { field: 'areaSqm', labelKey: 'inv_f_area', kind: 'number', control: 'chips', required: true },
        {
          field: 'purchasePrice',
          labelKey: 'inv_f_purchase_price',
          kind: 'money',
          control: 'chips',
          required: true,
        },
        {
          field: 'acquisitionCostPercent',
          labelKey: 'inv_f_acquisition_pct',
          kind: 'percent',
          control: 'chips',
          required: false,
          hintKey: 'inv_f_acquisition_costs_hint',
        },
        {
          field: 'acquisitionCosts',
          labelKey: 'inv_f_acquisition_costs',
          kind: 'money',
          control: 'chips',
          required: false,
          alternativeTo: 'acquisitionCostPercent',
          advanced: true,
        },
      ],
    },
    {
      id: 'renovation',
      titleKey: 'inv_group_renovation',
      fields: [
        {
          /*
           * REQUIRED, because it is what makes the NEXT question clickable.
           *
           * A renovation budget with no standard behind it has nothing to
           * suggest — three rates per m² would be guessing at a different
           * job. Choosing Basic or Premium first turns the budget from an
           * empty box into three amounts for this exact area, so the
           * question that enables the other one is not optional.
           */
          field: 'renovationQuality',
          labelKey: 'inv_f_renovation_quality',
          kind: 'text',
          control: 'cards',
          required: true,
          options: RENOVATION_QUALITIES,
        },
        {
          field: 'renovationCost',
          labelKey: 'inv_f_renovation',
          kind: 'money',
          control: 'chips',
          required: true,
          hintKey: 'inv_f_renovation_hint',
        },
        {
          field: 'renovationCostPerSqm',
          labelKey: 'inv_f_renovation_per_sqm',
          kind: 'moneyPerSqm',
          control: 'chips',
          required: false,
          alternativeTo: 'renovationCost',
          advanced: true,
        },
        {
          field: 'furnishingCost',
          labelKey: 'inv_f_furnishing',
          kind: 'money',
          control: 'chips',
          required: false,
        },
        {
          field: 'otherRenovationCosts',
          labelKey: 'inv_f_other_renovation',
          kind: 'money',
          control: 'chips',
          required: false,
          advanced: true,
        },
        {
          field: 'renovationDurationMonths',
          labelKey: 'inv_f_renovation_duration',
          kind: 'months',
          control: 'chips',
          required: false,
        },
      ],
    },
    {
      id: 'holding',
      titleKey: 'inv_group_holding',
      descriptionKey: 'inv_group_holding_desc',
      fields: [
        {
          field: 'holdMonths',
          labelKey: 'inv_f_months_to_sale',
          kind: 'months',
          control: 'chips',
          required: true,
        },
        {
          field: 'monthlyHoldingCosts',
          labelKey: 'inv_f_monthly_holding',
          kind: 'money',
          control: 'chips',
          required: false,
        },
      ],
    },
    financingGroup(),
    {
      id: 'exit',
      titleKey: 'inv_group_exit',
      fields: [
        {
          field: 'exitPriceAssumption',
          labelKey: 'inv_f_expected_resale',
          kind: 'money',
          control: 'chips',
          required: true,
          hintKey: 'inv_f_expected_resale_hint',
        },
        {
          field: 'expectedResalePricePerSqm',
          labelKey: 'inv_f_expected_resale_per_sqm',
          kind: 'moneyPerSqm',
          control: 'chips',
          required: false,
          alternativeTo: 'exitPriceAssumption',
          advanced: true,
        },
        {
          field: 'sellingCostPercent',
          labelKey: 'inv_f_selling_cost_pct',
          kind: 'percent',
          control: 'chips',
          required: false,
        },
        {
          field: 'targetReturnPercent',
          labelKey: 'inv_f_target_return',
          kind: 'percent',
          control: 'chips',
          required: false,
          hintKey: 'inv_f_target_return_hint',
        },
      ],
    },
  ],
};

/* ── B) Construction resale ─────────────────────────────────────────── */

const CONSTRUCTION_RESALE: StrategyDef = {
  id: 'CONSTRUCTION_RESALE',
  titleKey: 'inv_strategy_construction_title',
  flowKey: 'inv_strategy_construction_flow',
  descriptionKey: 'inv_strategy_construction_desc',
  groups: [
    {
      id: 'property',
      titleKey: 'inv_group_purchase',
      fields: [
        { field: 'areaSqm', labelKey: 'inv_f_area', kind: 'number', control: 'chips', required: true },
        {
          field: 'purchasePrice',
          labelKey: 'inv_f_purchase_price',
          kind: 'money',
          control: 'chips',
          required: true,
        },
        {
          field: 'constructionStage',
          labelKey: 'inv_f_construction_stage',
          kind: 'text',
          control: 'choice',
          required: false,
          options: CONSTRUCTION_STAGES,
        },
        {
          field: 'acquisitionCostPercent',
          labelKey: 'inv_f_acquisition_pct',
          kind: 'percent',
          control: 'chips',
          required: false,
        },
      ],
    },
    {
      id: 'payment',
      titleKey: 'inv_group_payment_structure',
      descriptionKey: 'inv_group_payment_structure_desc',
      fields: [
        {
          field: 'upfrontPayment',
          labelKey: 'inv_f_upfront_payment',
          kind: 'money',
          control: 'chips',
          required: true,
        },
        {
          field: 'installmentMonthly',
          labelKey: 'inv_f_installment_monthly',
          kind: 'money',
          control: 'chips',
          required: false,
        },
        {
          field: 'installmentCount',
          labelKey: 'inv_f_installment_count',
          kind: 'number',
          control: 'chips',
          required: false,
        },
        {
          field: 'remainingDeveloperBalance',
          labelKey: 'inv_f_remaining_balance',
          kind: 'money',
          control: 'chips',
          required: false,
          hintKey: 'inv_f_remaining_balance_hint',
          advanced: true,
        },
        {
          field: 'financingCosts',
          labelKey: 'inv_f_financing_costs',
          kind: 'money',
          control: 'chips',
          required: false,
          advanced: true,
        },
      ],
    },
    {
      id: 'project',
      titleKey: 'inv_group_project',
      fields: [
        {
          field: 'monthsToCompletion',
          labelKey: 'inv_f_months_to_completion',
          kind: 'months',
          control: 'chips',
          required: true,
        },
        {
          field: 'expectedCompletedPrice',
          labelKey: 'inv_f_expected_completed',
          kind: 'money',
          control: 'chips',
          required: true,
          hintKey: 'inv_f_expected_completed_hint',
        },
        {
          field: 'expectedCompletedPricePerSqm',
          labelKey: 'inv_f_expected_completed_per_sqm',
          kind: 'moneyPerSqm',
          control: 'chips',
          required: false,
          alternativeTo: 'expectedCompletedPrice',
          advanced: true,
        },
        {
          field: 'projectName',
          labelKey: 'inv_f_project',
          kind: 'text',
          control: 'text',
          required: false,
          advanced: true,
        },
      ],
    },
    {
      id: 'exit',
      titleKey: 'inv_group_exit',
      fields: [
        {
          field: 'exitTiming',
          labelKey: 'inv_f_exit_timing',
          kind: 'text',
          control: 'choice',
          required: false,
          options: EXIT_TIMINGS,
        },
        {
          field: 'additionalMonthsToSale',
          labelKey: 'inv_f_months_after_completion',
          kind: 'months',
          control: 'chips',
          required: false,
          gate: { field: 'exitTiming', equals: ['CUSTOM'] },
        },
        {
          field: 'monthlyHoldingCosts',
          labelKey: 'inv_f_monthly_holding',
          kind: 'money',
          control: 'chips',
          required: false,
        },
        {
          field: 'sellingCostPercent',
          labelKey: 'inv_f_selling_cost_pct',
          kind: 'percent',
          control: 'chips',
          required: false,
        },
        {
          field: 'targetReturnPercent',
          labelKey: 'inv_f_target_return',
          kind: 'percent',
          control: 'chips',
          required: false,
        },
      ],
    },
  ],
};

/* ── C) Rental investment ───────────────────────────────────────────── */

const RENTAL_INVESTMENT: StrategyDef = {
  id: 'RENTAL_INVESTMENT',
  titleKey: 'inv_strategy_rental_title',
  flowKey: 'inv_strategy_rental_flow',
  descriptionKey: 'inv_strategy_rental_desc',
  groups: [
    {
      id: 'property',
      titleKey: 'inv_group_property',
      fields: [
        /*
         * Required here as well, for the same reason as the flip: it is
         * one click from five options, and it is what lets the price be
         * offered as brackets rather than as an empty box. A yield does
         * not need it; the question before the yield does.
         */
        { field: 'areaSqm', labelKey: 'inv_f_area', kind: 'number', control: 'chips', required: true },
        {
          field: 'purchasePrice',
          labelKey: 'inv_f_purchase_price',
          kind: 'money',
          control: 'chips',
          required: true,
        },
        {
          field: 'acquisitionCostPercent',
          labelKey: 'inv_f_acquisition_pct',
          kind: 'percent',
          control: 'chips',
          required: false,
        },
        {
          field: 'renovationNeeded',
          labelKey: 'inv_f_renovation_needed',
          kind: 'text',
          control: 'yesno',
          required: false,
          options: YES_NO,
          hintKey: 'inv_f_renovation_needed_hint',
        },
        {
          field: 'renovationCost',
          labelKey: 'inv_f_upfront_works',
          kind: 'money',
          control: 'chips',
          required: false,
          gate: { field: 'renovationNeeded', equals: ['YES'] },
        },
      ],
    },
    {
      id: 'rent',
      titleKey: 'inv_group_rent',
      fields: [
        {
          field: 'monthlyRent',
          labelKey: 'inv_f_monthly_rent',
          kind: 'money',
          control: 'chips',
          required: true,
        },
        {
          field: 'vacantMonthsPerYear',
          labelKey: 'inv_f_occupancy',
          kind: 'months',
          control: 'chips',
          required: false,
          hintKey: 'inv_f_occupancy_hint',
        },
        {
          field: 'otherAnnualIncome',
          labelKey: 'inv_f_other_income',
          kind: 'money',
          control: 'chips',
          required: false,
          advanced: true,
        },
      ],
    },
    {
      id: 'operating',
      titleKey: 'inv_group_operating',
      descriptionKey: 'inv_group_operating_desc',
      fields: [
        {
          field: 'managementPercentOfCollectedRent',
          labelKey: 'inv_f_management_pct',
          kind: 'percent',
          control: 'chips',
          required: false,
          hintKey: 'inv_f_management_pct_hint',
        },
        {
          field: 'maintenanceAnnual',
          labelKey: 'inv_f_maintenance',
          kind: 'money',
          control: 'chips',
          required: false,
        },
        {
          field: 'repairsReserveAnnual',
          labelKey: 'inv_f_repairs_reserve',
          kind: 'money',
          control: 'chips',
          required: false,
          hintKey: 'inv_f_repairs_reserve_hint',
        },
        { field: 'hoaMonthly', labelKey: 'inv_f_hoa', kind: 'money', control: 'chips', required: false },
        {
          field: 'insuranceAnnual',
          labelKey: 'inv_f_insurance',
          kind: 'money',
          control: 'chips',
          required: false,
          advanced: true,
        },
        {
          field: 'propertyTaxAnnual',
          labelKey: 'inv_f_property_tax',
          kind: 'money',
          control: 'chips',
          required: false,
          advanced: true,
        },
        {
          field: 'utilitiesPaidByOwnerAnnual',
          labelKey: 'inv_f_utilities',
          kind: 'money',
          control: 'chips',
          required: false,
          advanced: true,
        },
        {
          field: 'otherOperatingAnnual',
          labelKey: 'inv_f_other_operating',
          kind: 'money',
          control: 'chips',
          required: false,
          advanced: true,
        },
      ],
    },
    financingGroup(),
    {
      id: 'exit',
      titleKey: 'inv_group_hold_exit',
      fields: [
        {
          field: 'holdMonths',
          labelKey: 'inv_f_hold_months',
          kind: 'months',
          control: 'chips',
          required: false,
        },
        {
          field: 'includeExitScenario',
          labelKey: 'inv_f_include_exit',
          kind: 'text',
          control: 'yesno',
          required: false,
          options: YES_NO,
          hintKey: 'inv_f_include_exit_hint',
        },
        {
          field: 'exitPriceAssumption',
          labelKey: 'inv_f_future_sale_value',
          kind: 'money',
          control: 'chips',
          required: false,
          gate: { field: 'includeExitScenario', equals: ['YES'] },
          hintKey: 'inv_f_future_sale_value_hint',
        },
        {
          field: 'sellingCostPercent',
          labelKey: 'inv_f_selling_cost_pct',
          kind: 'percent',
          control: 'chips',
          required: false,
          gate: { field: 'includeExitScenario', equals: ['YES'] },
        },
      ],
    },
  ],
};

/* ── D) Investment value ────────────────────────────────────────────── */

const INVESTMENT_VALUE: StrategyDef = {
  id: 'INVESTMENT_VALUE',
  titleKey: 'inv_strategy_value_title',
  flowKey: 'inv_strategy_value_flow',
  descriptionKey: 'inv_strategy_value_desc',
  groups: [
    {
      id: 'strategy',
      titleKey: 'inv_group_intended_strategy',
      descriptionKey: 'inv_group_intended_strategy_desc',
      fields: [
        {
          field: 'valueStrategy',
          labelKey: 'inv_f_value_strategy',
          kind: 'text',
          control: 'cards',
          required: true,
          options: VALUE_STRATEGIES,
        },
      ],
    },
    {
      id: 'requirement',
      titleKey: 'inv_group_requirement',
      descriptionKey: 'inv_group_requirement_desc',
      fields: [
        {
          /*
           * First, and required, once a plan has been chosen: the area is
           * what every other suggestion in this flow is built from — the
           * rent, and the per-m² boundaries the result reports.
           */
          field: 'areaSqm',
          labelKey: 'inv_f_area',
          kind: 'number',
          control: 'chips',
          required: true,
          gate: {
            field: 'valueStrategy',
            equals: ['RENTAL_INVESTMENT', 'RENOVATE_RESELL', 'CONSTRUCTION_RESALE'],
          },
        },
        {
          field: 'benchmarkYieldPercent',
          labelKey: 'inv_f_target_yield',
          kind: 'percent',
          control: 'chips',
          required: true,
          gate: { field: 'valueStrategy', equals: ['RENTAL_INVESTMENT'] },
          hintKey: 'inv_f_target_yield_hint',
        },
        {
          field: 'targetReturnPercent',
          labelKey: 'inv_f_target_return',
          kind: 'percent',
          control: 'chips',
          required: true,
          gate: { field: 'valueStrategy', equals: ['RENOVATE_RESELL', 'CONSTRUCTION_RESALE'] },
          hintKey: 'inv_f_target_return_hint',
        },
        {
          field: 'proposedPrice',
          labelKey: 'inv_f_proposed_price',
          kind: 'money',
          control: 'chips',
          required: false,
          hintKey: 'inv_f_proposed_price_hint',
          gate: { field: 'valueStrategy', equals: ['RENTAL_INVESTMENT', 'RENOVATE_RESELL', 'CONSTRUCTION_RESALE'] },
        },
      ],
    },
    {
      id: 'rental_inputs',
      titleKey: 'inv_group_rental_inputs',
      fields: [
        {
          field: 'monthlyRent',
          labelKey: 'inv_f_monthly_rent',
          kind: 'money',
          control: 'chips',
          required: true,
          gate: { field: 'valueStrategy', equals: ['RENTAL_INVESTMENT'] },
        },
        {
          field: 'vacantMonthsPerYear',
          labelKey: 'inv_f_occupancy',
          kind: 'months',
          control: 'chips',
          required: false,
          gate: { field: 'valueStrategy', equals: ['RENTAL_INVESTMENT'] },
        },
        {
          field: 'maintenanceAnnual',
          labelKey: 'inv_f_operating_costs_total',
          kind: 'money',
          control: 'chips',
          required: false,
          gate: { field: 'valueStrategy', equals: ['RENTAL_INVESTMENT'] },
        },
      ],
    },
    {
      id: 'resale_inputs',
      titleKey: 'inv_group_resale_inputs',
      fields: [
        {
          field: 'exitPriceAssumption',
          labelKey: 'inv_f_expected_resale',
          kind: 'money',
          control: 'chips',
          required: true,
          gate: { field: 'valueStrategy', equals: ['RENOVATE_RESELL'] },
        },
        {
          field: 'renovationQuality',
          labelKey: 'inv_f_renovation_quality',
          kind: 'text',
          control: 'cards',
          required: false,
          options: RENOVATION_QUALITIES,
          gate: { field: 'valueStrategy', equals: ['RENOVATE_RESELL'] },
        },
        {
          field: 'renovationCost',
          labelKey: 'inv_f_renovation',
          kind: 'money',
          control: 'chips',
          required: false,
          gate: { field: 'valueStrategy', equals: ['RENOVATE_RESELL'] },
        },
      ],
    },
    {
      id: 'construction_inputs',
      titleKey: 'inv_group_construction_inputs',
      fields: [
        {
          field: 'expectedCompletedPrice',
          labelKey: 'inv_f_expected_completed',
          kind: 'money',
          control: 'chips',
          required: true,
          gate: { field: 'valueStrategy', equals: ['CONSTRUCTION_RESALE'] },
        },
        {
          field: 'remainingDeveloperBalance',
          labelKey: 'inv_f_remaining_balance',
          kind: 'money',
          control: 'chips',
          required: false,
          gate: { field: 'valueStrategy', equals: ['CONSTRUCTION_RESALE'] },
        },
        {
          field: 'monthsToCompletion',
          labelKey: 'inv_f_months_to_completion',
          kind: 'months',
          control: 'chips',
          required: false,
          gate: { field: 'valueStrategy', equals: ['CONSTRUCTION_RESALE'] },
        },
      ],
    },
    {
      id: 'costs',
      titleKey: 'inv_group_costs',
      fields: [
        {
          field: 'acquisitionCostPercent',
          labelKey: 'inv_f_acquisition_pct',
          kind: 'percent',
          control: 'chips',
          required: false,
          gate: { field: 'valueStrategy', equals: ['RENTAL_INVESTMENT', 'RENOVATE_RESELL', 'CONSTRUCTION_RESALE'] },
        },
        {
          field: 'sellingCostPercent',
          labelKey: 'inv_f_selling_cost_pct',
          kind: 'percent',
          control: 'chips',
          required: false,
          gate: { field: 'valueStrategy', equals: ['RENOVATE_RESELL', 'CONSTRUCTION_RESALE'] },
        },
        {
          field: 'monthlyHoldingCosts',
          labelKey: 'inv_f_monthly_holding',
          kind: 'money',
          control: 'chips',
          required: false,
          gate: { field: 'valueStrategy', equals: ['RENOVATE_RESELL', 'CONSTRUCTION_RESALE'] },
          advanced: true,
        },
        {
          field: 'holdMonths',
          labelKey: 'inv_f_months_to_sale',
          kind: 'months',
          control: 'chips',
          required: false,
          gate: { field: 'valueStrategy', equals: ['RENOVATE_RESELL', 'CONSTRUCTION_RESALE'] },
        },
      ],
    },
  ],
};

export const STRATEGIES: Record<StrategyId, StrategyDef> = {
  RENOVATE_RESELL,
  CONSTRUCTION_RESALE,
  RENTAL_INVESTMENT,
  INVESTMENT_VALUE,
};

export const STRATEGY_ORDER: StrategyId[] = [
  'RENOVATE_RESELL',
  'CONSTRUCTION_RESALE',
  'RENTAL_INVESTMENT',
  'INVESTMENT_VALUE',
];

/* ── Gating and completeness ────────────────────────────────────────── */

export type ValueOf = (field: string) => string | number | undefined;

/** Is this question worth asking, given what has been answered already? */
export function isFieldVisible(definition: FieldDef, valueOf: ValueOf): boolean {
  if (!definition.gate) return true;
  const gateValue = valueOf(definition.gate.field);
  return typeof gateValue === 'string' && definition.gate.equals.includes(gateValue);
}

export function fieldsOf(strategy: StrategyId): FieldDef[] {
  return STRATEGIES[strategy].groups.flatMap((group) => group.fields);
}

/** Every field currently on screen for this strategy. */
export function visibleFieldsOf(strategy: StrategyId, valueOf: ValueOf): FieldDef[] {
  return fieldsOf(strategy).filter((definition) => isFieldVisible(definition, valueOf));
}

/** Groups with at least one visible field. An empty group is not a section. */
export function visibleGroupsOf(strategy: StrategyId, valueOf: ValueOf): FieldGroup[] {
  return STRATEGIES[strategy].groups
    .map((group) => ({
      ...group,
      fields: group.fields.filter((definition) => isFieldVisible(definition, valueOf)),
    }))
    .filter((group) => group.fields.length > 0);
}

/**
 * Which required answers are still missing.
 *
 * A gated-away field is never missing — it was not asked. A field satisfied
 * by its alternative unit is not missing either: somebody who gave a resale
 * price per m² has answered the resale question, and asking again for the
 * total would be the form not listening.
 */
export function missingRequiredFields(strategy: StrategyId, valueOf: ValueOf): FieldDef[] {
  const filled = (field: string) => {
    const value = valueOf(field);
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    return Number.isFinite(value);
  };
  const all = fieldsOf(strategy);
  return all
    .filter((definition) => definition.required && isFieldVisible(definition, valueOf))
    .filter((definition) => {
      if (filled(definition.field)) return false;
      const alternative = all.find((other) => other.alternativeTo === definition.field);
      if (alternative && filled(alternative.field)) return false;
      return true;
    });
}

export function isStrategyReady(strategy: StrategyId, valueOf: ValueOf): boolean {
  return missingRequiredFields(strategy, valueOf).length === 0;
}

/**
 * How finished the analysis is.
 *
 * COMPLETE means every question the strategy asks has an answer — not just
 * the required ones. ESTIMATED means it can produce a result but some
 * refinements are still open, which is the state most analyses live in and
 * must be labelled rather than dressed up as final.
 */
export type AnalysisState = 'MISSING_INPUT' | 'ESTIMATED' | 'COMPLETE';

export function analysisState(strategy: StrategyId, valueOf: ValueOf): AnalysisState {
  if (!isStrategyReady(strategy, valueOf)) return 'MISSING_INPUT';
  const visible = visibleFieldsOf(strategy, valueOf).filter((f) => !f.advanced);
  const answered = visible.filter((definition) => {
    const value = valueOf(definition.field);
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    return Number.isFinite(value);
  });
  return answered.length === visible.length ? 'COMPLETE' : 'ESTIMATED';
}

/** The next unanswered question, so the interface can point at it. */
export function nextUnansweredField(strategy: StrategyId, valueOf: ValueOf): FieldDef | null {
  const missing = missingRequiredFields(strategy, valueOf);
  if (missing.length) return missing[0];
  const visible = visibleFieldsOf(strategy, valueOf).filter((f) => !f.advanced);
  return (
    visible.find((definition) => {
      const value = valueOf(definition.field);
      if (value === undefined || value === null) return true;
      if (typeof value === 'string') return value.trim().length === 0;
      return !Number.isFinite(value);
    }) ?? null
  );
}
