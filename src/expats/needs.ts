// HOMATCH FOR EXPATS — "what do you need to do?", not "which article?"
//
// WHY THIS IS NOT MORE ARTICLES
//
// Production carries six topics: two on residency, one each on banking, cost
// of living, property and healthcare. The problem was never that people had
// too much to read — it is that somebody who wants to buy a flat had no path
// through Homatch at all. They landed on a hero, four pathway anchors and a
// topic index, and had to work out for themselves that Verify is the thing
// that checks an owner and that Find a property is where a search starts.
//
// WHY THE STEPS ARE SHARED AND THE NEEDS COMPOSE THEM
//
// Buying, renting, selling and investing overlap almost entirely: all four
// check a property, three of them read an agreement, three move money, two
// register something. Writing a separate script per need would mean four
// translations of the same sentence in six languages, drifting apart the
// first time one of them was corrected. So a need is an ORDERED SELECTION of
// shared steps, and a step is described once.
//
// WHAT A STEP IS ALLOWED TO SAY
//
// What happens, what you will need, and which Homatch tool does it. It is
// deliberately PROCESS guidance and never a legal, tax or fee claim: "check
// who owns it before you pay" is a description of a sensible order of
// events; "foreigners may own land" is a statement of law that changes and
// belongs in a topic with a source and a verified date, which the topic
// system already carries.
//
// Where a step has a matching topic, the component links to it with its
// freshness. Where production has no topic for that domain yet, it says so
// rather than inventing one.

import type { TranslationKey } from '@/i18n/translations';

/** A real destination in this product. Never a route that does not exist. */
export interface NeedTool {
  labelKey: TranslationKey;
  to: string;
}

export interface NeedStep {
  key: string;
  titleKey: TranslationKey;
  /** What happens, and what the person will need for it. */
  bodyKey: TranslationKey;
  /** The Homatch tool that does this step, when one does. */
  tool?: NeedTool;
  /** The topic domain that carries the facts for this step, when one does. */
  domain?: string;
}

export const NEED_STEPS: Readonly<Record<string, NeedStep>> = {
  budget: {
    key: 'budget',
    titleKey: 'expat_step_budget_t',
    bodyKey: 'expat_step_budget_b',
    tool: { labelKey: 'expat_tool_budget', to: '/for-expats/georgia#budget' },
  },
  find_property: {
    key: 'find_property',
    titleKey: 'expat_step_find_property_t',
    bodyKey: 'expat_step_find_property_b',
    tool: { labelKey: 'dnav_find_property', to: '/ai' },
  },
  check_property: {
    key: 'check_property',
    titleKey: 'expat_step_check_property_t',
    bodyKey: 'expat_step_check_property_b',
    tool: { labelKey: 'nav_verify', to: '/verify' },
    domain: 'PROPERTY',
  },
  agreement: {
    key: 'agreement',
    titleKey: 'expat_step_agreement_t',
    bodyKey: 'expat_step_agreement_b',
    tool: { labelKey: 'nav_contracts', to: '/contracts' },
  },
  money: {
    key: 'money',
    titleKey: 'expat_step_money_t',
    bodyKey: 'expat_step_money_b',
    domain: 'BANKING',
  },
  pay: {
    key: 'pay',
    titleKey: 'expat_step_pay_t',
    bodyKey: 'expat_step_pay_b',
  },
  register: {
    key: 'register',
    titleKey: 'expat_step_register_t',
    bodyKey: 'expat_step_register_b',
    domain: 'PROPERTY',
  },
  handover: {
    key: 'handover',
    titleKey: 'expat_step_handover_t',
    bodyKey: 'expat_step_handover_b',
  },
  find_demand: {
    key: 'find_demand',
    titleKey: 'expat_step_find_demand_t',
    bodyKey: 'expat_step_find_demand_b',
    tool: { labelKey: 'dnav_find_client', to: '/property/add' },
  },
  returns: {
    key: 'returns',
    titleKey: 'expat_step_returns_t',
    bodyKey: 'expat_step_returns_b',
    tool: { labelKey: 'nav_investment', to: '/investment' },
  },
  borrow: {
    key: 'borrow',
    titleKey: 'expat_step_borrow_t',
    bodyKey: 'expat_step_borrow_b',
    tool: { labelKey: 'nav_mortgage', to: '/mortgage' },
  },
  professional: {
    key: 'professional',
    titleKey: 'expat_step_professional_t',
    bodyKey: 'expat_step_professional_b',
    tool: { labelKey: 'home_nav_partners', to: '/partners' },
  },
};

export interface ExpatNeed {
  key: string;
  labelKey: TranslationKey;
  /** One line, so the chooser can be read rather than studied. */
  hintKey: TranslationKey;
  steps: string[];
}

/**
 * The needs, in the order somebody is likely to have them.
 *
 * Eight, not fifteen: a wall of choices is the same failure as a wall of
 * text. Anything not here is still reachable — the topic index and the tools
 * are on the same page — this is the front door, not the whole building.
 */
export const EXPAT_NEEDS: readonly ExpatNeed[] = [
  {
    key: 'buy',
    labelKey: 'expat_need_buy',
    hintKey: 'expat_need_buy_h',
    steps: ['budget', 'find_property', 'check_property', 'agreement', 'money', 'register', 'handover'],
  },
  {
    key: 'rent',
    labelKey: 'expat_need_rent',
    hintKey: 'expat_need_rent_h',
    steps: ['budget', 'find_property', 'check_property', 'agreement', 'pay', 'handover'],
  },
  {
    key: 'sell',
    labelKey: 'expat_need_sell',
    hintKey: 'expat_need_sell_h',
    steps: ['find_demand', 'check_property', 'agreement', 'register', 'handover'],
  },
  {
    key: 'invest',
    labelKey: 'expat_need_invest',
    hintKey: 'expat_need_invest_h',
    steps: ['budget', 'returns', 'find_property', 'check_property', 'borrow'],
  },
  {
    key: 'money',
    labelKey: 'expat_need_money',
    hintKey: 'expat_need_money_h',
    steps: ['money', 'pay'],
  },
  {
    key: 'check',
    labelKey: 'expat_need_check',
    hintKey: 'expat_need_check_h',
    steps: ['check_property', 'agreement'],
  },
  {
    key: 'own',
    labelKey: 'expat_need_own',
    hintKey: 'expat_need_own_h',
    steps: ['find_demand', 'professional', 'returns'],
  },
  {
    key: 'help',
    labelKey: 'expat_need_help',
    hintKey: 'expat_need_help_h',
    steps: ['professional'],
  },
];

/** The steps of a need, resolved, skipping any the catalogue does not define. */
export function stepsFor(need: ExpatNeed): NeedStep[] {
  return need.steps.map((key) => NEED_STEPS[key]).filter(Boolean);
}
