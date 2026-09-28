// HOMATCH — how an activity event reads to the customer.
//
// One map, shared by the Activity page and the dashboard's activity card, so
// an event type is never described two ways in two places — and so both
// surfaces agree on which rows are FEED ENTRIES at all.
//
// The rules the map encodes:
//   - Every rendered label is a translation key. A raw UPPER_SNAKE enum is a
//     database value, not prose, and never reaches a customer's screen.
//   - Pure page-open telemetry (…_PAGE_OPENED and friends) returns null: a
//     customer activity feed records what somebody DID, not which screens
//     they looked at.
//   - An unknown event type also returns null. New backend types appear
//     before the frontend learns their words; hiding them beats printing the
//     enum, and adding the words is a one-line change here.

/** The translation-key type `t()` accepts (see LanguageContext: plain string). */
type TKey = string;

const ACTIVITY_LABEL_KEY: Record<string, TKey> = {
  PROPERTY_ADDED: 'activity_property_added',
  IMPORT_STARTED: 'activity_import_started',
  IMPORT_COMPLETED: 'activity_import_completed',
  IMPORT_FAILED: 'activity_import_failed',
  PRIVATE_LISTING_CREATED: 'activity_private_created',
  MATCHING_STARTED: 'activity_matching_started',
  MATCHING_PAUSED: 'activity_matching_paused',
  PROPERTY_DELETED: 'activity_property_deleted',
  MATCH_AVAILABLE: 'activity_match_available',
  MATCH_UNLOCKED: 'activity_match_unlocked',
  CREDITS_TOPPED_UP: 'activity_credits_topped_up',
  CREDITS_CHARGED: 'activity_credits_charged',
  CAMPAIGN_PAUSED: 'activity_campaign_paused',
  CAMPAIGN_RESUMED: 'activity_campaign_resumed',
  // Mortgage
  MORTGAGE_CALCULATED: 'act_mortgage_calculated',
  MORTGAGE_OFFER_UPLOADED: 'act_mortgage_offer_uploaded',
  MORTGAGE_OFFERS_COMPARED: 'act_mortgage_offers_compared',
  MORTGAGE_SCENARIO_SAVED: 'act_mortgage_scenario_saved',
  MORTGAGE_TERM_COMPARED: 'act_mortgage_term_compared',
  MORTGAGE_AFFORDABILITY_CHECKED: 'act_mortgage_affordability',
  MORTGAGE_SUBSIDY_CHECKED: 'act_mortgage_subsidy',
  // Investment
  INVESTMENT_ANALYSIS_COMPLETED: 'act_invest_analysis_done',
  INVESTMENT_RESEARCH_REQUESTED: 'act_invest_research_requested',
  INVESTMENT_STRATEGY_SELECTED: 'act_invest_strategy_selected',
  INVESTMENT_PROPERTY_ATTACHED: 'act_invest_property_attached',
  INVESTMENT_EVIDENCE_APPLIED: 'act_invest_evidence_applied',
};

/*
 * Telemetry, named so a reader can tell it apart from "not mapped yet".
 * INVESTMENT_CONSULTATION_TURN is a per-message counter inside a
 * conversation the customer already sees in full — a feed row per turn
 * would be noise about noise.
 */
const TELEMETRY_ONLY = new Set([
  'MORTGAGE_PAGE_OPENED',
  'PROPERTY_MORTGAGE_OPENED',
  'MORTGAGE_TOPIC_OPENED',
  'INVESTMENT_PAGE_OPENED',
  'INVESTMENT_CONSULTATION_TURN',
]);

/**
 * The translation key for an activity event's feed label, or null when the
 * row does not belong in a customer-facing feed (telemetry, unknown type).
 * Callers filter null rows out rather than rendering a raw enum.
 */
export function activityLabelKey(eventType: string): TKey | null {
  if (TELEMETRY_ONLY.has(eventType)) return null;
  return ACTIVITY_LABEL_KEY[eventType] ?? null;
}
