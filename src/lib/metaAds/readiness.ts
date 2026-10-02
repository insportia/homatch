// READINESS — one semantic map from what the HOMATCH check found to where the
// owner fixes it:  check key / detail code → step → field.
//
// Every row of the check, every "N things left" counter and the footer hint
// use this table, so a tap always lands on the control that resolves it.
// Copy is always an i18n key HOMATCH ships: a code this table does not know
// falls back to the check's own title, never to the code itself.
//
// Severity is the server's: ACTION_REQUIRED = BLOCKER (launch held),
// WARNING = WARNING (launch allowed), advice RECOMMENDATION = RECOMMENDATION.

export type StepKey = 'account' | 'offer' | 'goal' | 'destination' | 'audience' | 'budget' | 'creative' | 'placements' | 'brief' | 'review';
export type Severity = 'BLOCKER' | 'WARNING' | 'RECOMMENDATION';
export interface IssueTarget { step: StepKey; field: string }

/** Where each server check is fixed. A check missing here is a test failure. */
export const CHECK_TARGET: Record<string, IssueTarget> = {
  connection: { step: 'account', field: 'connect' },
  permissions: { step: 'account', field: 'connect' },
  page_selected: { step: 'account', field: 'page' },
  ad_account_selected: { step: 'account', field: 'ad_account' },
  ad_account_active: { step: 'account', field: 'ad_account' },
  ad_account_currency: { step: 'account', field: 'ad_account' },
  ad_account_funding: { step: 'account', field: 'ad_account' },
  managed_access: { step: 'account', field: 'ad_account' },
  integration_mode: { step: 'account', field: 'connect' },
  property_owned: { step: 'offer', field: 'offer' },
  domain_scope: { step: 'offer', field: 'offer' },
  goal_enabled: { step: 'goal', field: 'goal' },
  destination: { step: 'destination', field: 'url' },
  destination_reachable: { step: 'destination', field: 'url' },
  tracking: { step: 'destination', field: 'pixel' },
  lead_form: { step: 'destination', field: 'form' },
  lead_terms: { step: 'destination', field: 'form' },
  messaging_destination: { step: 'destination', field: 'messaging' },
  audience: { step: 'audience', field: 'audience_type' },
  targeting: { step: 'audience', field: 'locations' },
  budget: { step: 'budget', field: 'daily' },
  duration: { step: 'budget', field: 'days' },
  balance: { step: 'review', field: 'funding' },
  creatives: { step: 'creative', field: 'creative' },
  placements: { step: 'placements', field: 'placements' },
  policy_classified: { step: 'audience', field: 'locations' },
};

/* A detail code can point more precisely than its check. */
const CODE_TARGET: Record<string, IssueTarget> = {
  LOCATION_REQUIRED: { step: 'audience', field: 'locations' },
  TOO_MANY_LOCATIONS: { step: 'audience', field: 'locations' },
  PIN_INVALID: { step: 'audience', field: 'locations' },
  AGE_RANGE_INVALID: { step: 'audience', field: 'who' },
  GENDER_INVALID: { step: 'audience', field: 'who' },
  LANGUAGE_KEY_INVALID: { step: 'audience', field: 'languages' },
  TOO_MANY_LANGUAGES: { step: 'audience', field: 'languages' },
  NO_MEDIA: { step: 'creative', field: 'media' },
  MEDIA_REQUIRED: { step: 'creative', field: 'media' },
  CREATIVE_REQUIRED: { step: 'creative', field: 'media' },
  PRIMARY_TEXT_REQUIRED: { step: 'creative', field: 'primary' },
  HEADLINE_REQUIRED: { step: 'creative', field: 'headline' },
  TEXT_TOO_LONG: { step: 'creative', field: 'primary' },
  CLAIM_GUARANTEE: { step: 'creative', field: 'primary' },
};

/** Client-side step gaps (steps.ts stepGap) → the field that closes them. */
export const GAP_TARGET: Record<string, IssueTarget> = {
  madsb_gap_connect: { step: 'account', field: 'connect' },
  madsb_gap_reconnect: { step: 'account', field: 'connect' },
  madsb_gap_page: { step: 'account', field: 'page' },
  madsb_gap_ad_account: { step: 'account', field: 'ad_account' },
  madsb_gap_offer: { step: 'offer', field: 'offer' },
  madsb_gap_offer_title: { step: 'offer', field: 'offer' },
  madsb_gap_goal: { step: 'goal', field: 'goal' },
  madsb_gap_url: { step: 'destination', field: 'url' },
  madsb_gap_pixel: { step: 'destination', field: 'pixel' },
  madsb_gap_form: { step: 'destination', field: 'form' },
  madsb_gap_messaging: { step: 'destination', field: 'messaging' },
  mm_c_gap_locations: { step: 'audience', field: 'locations' },
  madsb_gap_budget: { step: 'budget', field: 'daily' },
  madsb_gap_days: { step: 'budget', field: 'days' },
  madsb_gap_media: { step: 'creative', field: 'media' },
  madsb_gap_text: { step: 'creative', field: 'primary' },
  madsb_gap_headline: { step: 'creative', field: 'headline' },
  madsb_gap_placements: { step: 'placements', field: 'placements' },
  madsb_gap_preflight: { step: 'review', field: 'check' },
};

const firstCode = (detail?: string | null) => String(detail ?? '').split(',')[0]?.trim() ?? '';

export function issueTarget(checkKey: string, detail?: string | null): IssueTarget {
  return CODE_TARGET[firstCode(detail)] ?? CHECK_TARGET[checkKey] ?? { step: 'review', field: 'check' };
}

export function severityOf(state: string | undefined, ok?: boolean): Severity | null {
  const s = state ?? (ok ? 'READY' : 'ACTION_REQUIRED');
  return s === 'ACTION_REQUIRED' ? 'BLOCKER' : s === 'WARNING' ? 'WARNING' : null;
}

/** The title of a check. An unknown check reads as a plain "needs attention". */
export function checkTitleKey(key: string): string {
  return key in CHECK_TARGET ? `mads_check_${key}` : 'mm_r_check_other';
}

/** Every detail-code key HOMATCH ships (the test proves each one exists in all six locales). */
export const DETAIL_KEYS: ReadonlySet<string> = new Set([
  'madsb_pfd_account_currency', 'madsb_pfd_account_status', 'madsb_pfd_audience_not_found', 'madsb_pfd_audience_not_ready',
  'madsb_pfd_budget_above_maximum', 'madsb_pfd_budget_below_minimum', 'madsb_pfd_claim_guarantee', 'madsb_pfd_connected',
  'madsb_pfd_creative_required', 'madsb_pfd_destination_url_invalid', 'madsb_pfd_disconnected', 'madsb_pfd_error', 'madsb_pfd_expired',
  'madsb_pfd_goal_disabled', 'madsb_pfd_headline_required', 'madsb_pfd_http_error', 'madsb_pfd_instagram_placement_without_account',
  'madsb_pfd_instagram_required', 'madsb_pfd_lead_form_required', 'madsb_pfd_media_incompatible', 'madsb_pfd_media_placement_mismatch',
  'madsb_pfd_messaging_destination_required', 'madsb_pfd_min_days', 'madsb_pfd_mock_mode_nothing_reaches_meta', 'madsb_pfd_no_media',
  'madsb_pfd_no_payment_method_visible', 'madsb_pfd_no_placement_selected', 'madsb_pfd_pixel_required',
  'madsb_pfd_primary_text_required', 'madsb_pfd_revoked', 'madsb_pfd_short', 'madsb_pfd_text_too_long', 'madsb_pfd_unreachable',
  'madsb_pfd_whatsapp_not_enabled', 'madsb_pfd_whatsapp_required',
  // Added in this pass: targeting, ownership, guard and the media rule.
  'madsb_pfd_location_required', 'madsb_pfd_too_many_locations', 'madsb_pfd_location_key_invalid', 'madsb_pfd_location_type_invalid',
  'madsb_pfd_location_country_invalid', 'madsb_pfd_country_code_invalid', 'madsb_pfd_pin_invalid', 'madsb_pfd_age_range_invalid',
  'madsb_pfd_gender_invalid', 'madsb_pfd_language_key_invalid', 'madsb_pfd_too_many_languages', 'madsb_pfd_property_not_owned',
  'madsb_pfd_meta_ads_access_suspended', 'madsb_pfd_media_required', 'madsb_pfd_duration_below_minimum',
  'madsb_pfd_goal_unsupported', 'madsb_pfd_destination_goal_mismatch', 'mm_r_pfd_permissions',
]);
