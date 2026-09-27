/*
 * Operational words for stored codes.
 *
 * The database says TRANSACTION_INTENT, INSUFFICIENT_INFORMATION, LOW_BALANCE.
 * An operator should read "Wants to transact", "Not enough information",
 * "Low balance" — in their own language. Each domain below maps a stored code
 * to a translation key; a code with no entry (a value added after this file)
 * is shown humanised rather than hidden, so a new state is visible the day it
 * appears instead of rendering as a blank.
 */
import type { TranslationKey } from '@/i18n/translations';

type Domain = Record<string, TranslationKey>;

export const LABELS = {
  act: {
    REQUIREMENT: 'admin_cc_act_requirement',
    INTEREST: 'admin_cc_act_interest',
    REJECTION: 'admin_cc_act_rejection',
    OBJECTION: 'admin_cc_act_objection',
    INQUIRY: 'admin_cc_act_inquiry',
    TRANSACTION_INTENT: 'admin_cc_act_transaction_intent',
  },
  side: {
    DEMAND: 'admin_cc_side_demand',
    SUPPLY: 'admin_cc_side_supply',
    PROPERTY_INTEREST: 'admin_cc_side_property_interest',
  },
  surface: {
    LIVE_CHAT: 'admin_cc_surface_live_chat',
    PRIVATE_MESSAGE: 'admin_cc_surface_private_message',
    VIEWING_REQUEST: 'admin_cc_surface_viewing_request',
    SEARCH_PLAN: 'admin_cc_surface_search_plan',
    AI_CHAT: 'admin_cc_surface_ai_chat',
  },
  signalStatus: {
    ACTIVE: 'admin_cc_signal_active',
    WITHDRAWN: 'admin_cc_signal_withdrawn',
    SUPERSEDED: 'admin_cc_signal_superseded',
  },
  scope: {
    PROPERTY: 'admin_cc_scope_property',
    SEARCH: 'admin_cc_scope_search',
    GENERAL: 'admin_cc_scope_general',
  },
  attribution: {
    SELF: 'admin_cc_attr_self',
    THIRD_PARTY: 'admin_cc_attr_third_party',
    QUOTED: 'admin_cc_attr_quoted',
    UNKNOWN: 'admin_cc_attr_unknown',
  },
  firmness: {
    REQUIRED: 'admin_cc_firm_required',
    PREFERRED: 'admin_cc_firm_preferred',
    FLEXIBLE: 'admin_cc_firm_flexible',
    UNKNOWN: 'admin_cc_firm_unknown',
  },
  dimension: {
    PARTICIPANTS: 'admin_cc_dim_participants',
    TRANSACTION: 'admin_cc_dim_transaction',
    CITY: 'admin_cc_dim_city',
    DISTRICT: 'admin_cc_dim_district',
    PROPERTY_TYPE: 'admin_cc_dim_property_type',
    PRICE: 'admin_cc_dim_price',
    AREA: 'admin_cc_dim_area',
    BEDROOMS: 'admin_cc_dim_bedrooms',
  },
  compatibility: {
    COMPATIBLE: 'admin_cc_compat_compatible',
    INSUFFICIENT_INFORMATION: 'admin_cc_compat_insufficient',
    INCOMPATIBLE: 'admin_cc_compat_incompatible',
  },
  deal: {
    SALE: 'admin_cc_deal_sale',
    RENT: 'admin_cc_deal_rent',
    SHORT_STAY: 'admin_cc_deal_short_stay',
    COMMERCIAL: 'admin_cc_deal_commercial',
    LAND: 'admin_cc_deal_land',
    INVESTMENT: 'admin_cc_deal_investment',
  },
  propertyStatus: {
    ACTIVE: 'admin_cc_pstatus_active',
    PAUSED: 'admin_cc_pstatus_paused',
    DRAFT: 'admin_cc_pstatus_draft',
    COMPLETED: 'admin_cc_pstatus_completed',
    ARCHIVED: 'admin_cc_pstatus_archived',
    DELETED: 'admin_cc_pstatus_deleted',
  },
  campaignState: {
    ACTIVE: 'admin_cc_pstatus_active',
    PAUSED: 'admin_cc_pstatus_paused',
    LOW_BALANCE: 'admin_cc_cstate_low_balance',
    ARCHIVED: 'admin_cc_pstatus_archived',
  },
  origin: {
    CONVERSATION: 'admin_cc_origin_conversation',
    SEARCH: 'admin_cc_origin_search',
    UNKNOWN: 'admin_cc_attr_unknown',
  },
  matchedBy: {
    USER_ID: 'admin_cc_matched_user_id',
    PROPERTY_REFERENCE: 'admin_cc_matched_property_ref',
    EMAIL: 'admin_cc_matched_email',
    USERNAME: 'admin_cc_matched_username',
    PHONE: 'admin_cc_matched_phone',
    TEXT: 'admin_cc_matched_text',
  },
  lookupKind: {
    property: 'admin_cc_kind_property',
    user: 'admin_cc_kind_user',
    internal_match: 'admin_cc_kind_internal_match',
    external_match: 'admin_cc_kind_external_match',
    legacy_match: 'admin_cc_kind_legacy_match',
    conversation: 'admin_cc_kind_conversation',
    campaign: 'admin_cc_kind_campaign',
    signal: 'admin_cc_kind_signal',
    notification: 'admin_cc_kind_notification',
    announcement: 'admin_cc_kind_announcement',
  },
} satisfies Record<string, Domain>;

export type LabelDomain = keyof typeof LABELS;

/** "LOW_BALANCE" -> "Low balance". For codes this file does not know yet. */
export function humanize(code: string | null | undefined): string {
  if (!code) return '—';
  const words = String(code).replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function labelFor(
  t: (key: string, vars?: Record<string, string | number>) => string,
  domain: LabelDomain,
  code: string | null | undefined,
): string {
  if (!code) return '—';
  const key = (LABELS[domain] as Domain)[code];
  return key ? t(key) : humanize(code);
}
