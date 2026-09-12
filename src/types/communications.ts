// HOMATCH Communications — the row shapes the UI reads.
//
// Deliberately hand-written rather than generated from the database, for one
// reason: the generated types describe every column, and several columns are
// things a customer must never see (§106). A type that does not contain
// `provider_cost_cents` is a type a component cannot accidentally render.
//
// The vocabularies come from src/lib/comm/vocabulary.ts, which is checked
// against the database's own CHECK constraints by a test.

import type {
  AgentStatus, AgentTemplate, CampaignStatus, CampaignType, Channel,
  ConversationMode, LeadStage, MessageStatus, SendStatus, TemplateStatus,
  TrustTier, RiskLevel, PolicyDecision,
} from '@/lib/comm/vocabulary';

export interface CommAgent {
  id: string;
  owner_id: string;
  name: string;
  purpose: string | null;
  template_code: AgentTemplate;
  status: AgentStatus;
  channels: string[];
  languages: string[];
  introduction: string | null;
  primary_goal: string | null;
  business_context: string | null;
  target_audience: string | null;
  tone: string;
  qualification_questions: unknown[];
  knowledge_notes: string | null;
  allowed_actions: string[];
  forbidden_actions: string[];
  escalation_instructions: string | null;
  callback_rules: string | null;
  voice_id: string | null;
  voice_label: string | null;
  ai_disclosure_enabled: boolean;
  property_id: string | null;
  current_version: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

/** What the Agents list shows per row, including counts that come from joins. */
export interface AgentListRow extends CommAgent {
  campaignCount: number;
  interactionCount: number;
  qualifiedCount: number;
}

export interface CommChannelAccount {
  id: string;
  owner_id: string | null;
  label: string;
  channel: 'WHATSAPP' | 'VOICE' | 'SMS';
  provider: string;
  phone_e164: string | null;
  country: string | null;
  display_name: string | null;
  capabilities: string[];
  status: 'PENDING' | 'CONNECTED' | 'ACTION_REQUIRED' | 'DISABLED';
  /** §100: a test number is not a production sender and the UI must say so. */
  environment: 'TEST' | 'PRODUCTION';
  quality_rating: string | null;
  messaging_tier: string | null;
  verification_state: string | null;
  webhook_verified_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  created_at: string;
}

export interface CommTemplate {
  id: string;
  owner_id: string;
  channel_account_id: string | null;
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  header_kind: string | null;
  header_text: string | null;
  body_text: string;
  footer_text: string | null;
  buttons: unknown[];
  variables: unknown[];
  status: TemplateStatus;
  provider_template_id: string | null;
  rejection_reason: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommConversation {
  id: string;
  owner_id: string;
  contact_id: string | null;
  channel_account_id: string | null;
  channel: Channel;
  peer_address: string;
  peer_name: string | null;
  language: string | null;
  mode: ConversationMode;
  mode_changed_at: string | null;
  status: 'OPEN' | 'ARCHIVED';
  lead_stage: LeadStage;
  lead_score: number | null;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_inbound_at: string | null;
  service_window_expires_at: string | null;
  assigned_to: string | null;
  campaign_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommMessage {
  id: string;
  conversation_id: string;
  owner_id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  author: 'CONTACT' | 'AI' | 'HUMAN' | 'SYSTEM';
  author_user_id: string | null;
  kind: string;
  body: string | null;
  media_url: string | null;
  media_mime: string | null;
  transcript: string | null;
  template_id: string | null;
  status: MessageStatus;
  error_message: string | null;
  /** What HOMATCH charged. Provider cost is admin-only and is not in this type. */
  cost_usd: number | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
}

export interface CommExtraction {
  id: string;
  contact_id: string | null;
  conversation_id: string | null;
  send_id: string | null;
  source: 'CALL' | 'WHATSAPP' | 'AI_TALK' | 'CHAT' | 'MANUAL';
  method: 'DETERMINISTIC' | 'LLM' | 'HUMAN';
  confidence: number | null;
  transaction_type: string | null;
  property_type: string | null;
  locations: string[] | null;
  budget_min: number | null;
  budget_max: number | null;
  currency: string | null;
  bedrooms: number | null;
  timeline: string | null;
  interest_level: string | null;
  objection: string | null;
  callback_requested: boolean | null;
  callback_at: string | null;
  viewing_interest: boolean | null;
  summary: string | null;
  next_action: string | null;
  created_at: string;
}

export interface CommCampaign {
  id: string;
  owner_id: string;
  name: string;
  campaign_type: CampaignType;
  status: CampaignStatus;
  contact_list_id: string | null;
  property_id: string | null;
  agent_id: string | null;
  agent_version_id: string | null;
  channel_account_id: string | null;
  template_id: string | null;
  template_variables: unknown;
  audience_count: number;
  sent_count: number | null;
  delivered_count: number | null;
  reply_count: number | null;
  cost_estimate_usd: number;
  cost_actual_usd: number;
  max_spend_usd: number | null;
  risk_level: RiskLevel | null;
  compliance_state: string | null;
  paused_reason: string | null;
  timezone: string | null;
  send_window_start: number | null;
  send_window_end: number | null;
  max_attempts: number;
  retry_gap_minutes: number;
  concurrency: number;
  scheduled_at: string | null;
  launched_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommSend {
  id: string;
  campaign_id: string;
  contact_id: string | null;
  owner_id: string;
  channel: string;
  recipient_phone: string | null;
  recipient_email: string | null;
  status: SendStatus;
  provider: string | null;
  outcome: string | null;
  lead_score: number | null;
  language: string | null;
  duration_sec: number | null;
  transcript: string | null;
  summary: string | null;
  recording_url: string | null;
  error_message: string | null;
  /** Customer-facing charge only. */
  cost_usd: number | null;
  attempt_count: number | null;
  sent_at: string | null;
  call_started_at: string | null;
  call_ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommContact {
  id: string;
  list_id: string;
  owner_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  language: string | null;
  country: string | null;
  city: string | null;
  tags: string[];
  consent_status: string;
  consent_source: string | null;
  lead_stage: LeadStage | null;
  lead_score: number | null;
  lead_type: string | null;
  transaction_type: string | null;
  property_type: string | null;
  preferred_locations: string[] | null;
  budget_min: number | null;
  budget_max: number | null;
  currency: string | null;
  bedrooms: number | null;
  timeline: string | null;
  notes: string | null;
  phone_valid: boolean | null;
  email_valid: boolean | null;
  phone_e164_confidence: string | null;
  do_not_contact: boolean | null;
  do_not_call: boolean | null;
  unsubscribed: boolean | null;
  whatsapp_opted_out: boolean;
  suppressed: boolean | null;
  suppressed_reason: string | null;
  last_contacted_at: string | null;
  created_at: string;
}

/**
 * What a customer is told about a launch decision.
 *
 * §131: they see whether it is ready, needs review, or is paused for safety.
 * The score, the weights and the thresholds are not in this type at all, so no
 * customer-facing component can render them even by accident.
 */
export interface LaunchPreview {
  ok: boolean;
  code: string;
  message: string;
  compliance: 'READY' | 'NEEDS_REVIEW' | 'PAUSED_FOR_SAFETY' | 'BLOCKED';
  audience: {
    total: number;
    eligible: number;
    suppressed: number;
    invalid: number;
    allowed: number;
  } | null;
  estimate: { minCents: number; maxCents: number; isRange: boolean; basis: string } | null;
  throughputPerHour: number | null;
  enqueued?: number;
  shortfall?: number | null;
}

export interface CommOverviewStats {
  conversationsToday: number;
  callsToday: number;
  whatsappConversations: number;
  qualifiedLeads: number;
  viewingsRequested: number;
  spendTodayUsd: number;
  answerRate: number | null;
  replyRate: number | null;
  qualificationRate: number | null;
  costPerQualifiedLeadUsd: number | null;
  averageCallDurationSec: number | null;
  aiResolutionRate: number | null;
}

export interface AttentionItem {
  id: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  code: string;
  /** An i18n key, never a pre-translated string. */
  titleKey: string;
  detail: string | null;
  href: string | null;
}

export interface ChannelStatusCard {
  channel: 'AI_CALL' | 'WHATSAPP' | 'EMAIL' | 'SMS';
  state: 'CONNECTED' | 'PARTIAL' | 'ACTION_REQUIRED' | 'DISABLED' | 'NOT_CONFIGURED';
  detail: string | null;
}

export interface TrustSummary {
  tier: TrustTier;
  outboundFrozen: boolean;
  /** Customer-facing only. Never the raw thresholds. */
  label: 'READY' | 'NEEDS_REVIEW' | 'PAUSED_FOR_SAFETY';
}

export interface RiskAssessmentRow {
  id: string;
  owner_id: string;
  campaign_id: string | null;
  agent_id: string | null;
  decision: PolicyDecision;
  risk_level: RiskLevel;
  domain_verdict: string | null;
  domain_stage: string | null;
  reasons: Array<{ code: string; weight: number; detail: string | null; source: string }>;
  score: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_decision: string | null;
  review_note: string | null;
  created_at: string;
}

export interface AnalyticsFilter {
  since: string;
  until?: string;
  channel?: string;
  campaignId?: string;
  agentId?: string;
}

/**
 * What §77's screens render.
 *
 * Note what is absent: revenue, and any figure derived from it. Homatch knows
 * what a campaign cost and how many leads it qualified; it does not know what
 * any of them eventually sold for, and §77 forbids inventing the attribution.
 */
export interface AnalyticsResult {
  series: Array<{ date: string; calls: number; messages: number; qualified: number; spend: number }>;
  funnel: Array<{ stage: string; count: number }>;
  callStats: {
    attempted: number;
    answered: number;
    /** null when nothing was attempted — a rate over zero is unknown, not 0%. */
    answerRate: number | null;
    avgDurationSec: number | null;
    outcomes: Record<string, number>;
  };
  messageStats: {
    sent: number; delivered: number; read: number;
    failed: number; replies: number; optOuts: number;
  };
  spendUsd: number;
  qualified: number;
  costPerQualifiedUsd: number | null;
}

/**
 * What Communications has cost this customer.
 *
 * §47: what they are CHARGED, and nothing else. There is deliberately no
 * provider, no COGS and no margin field anywhere in this type, so a
 * customer-facing component cannot render one even by accident — those live in
 * Admin Finance against finance_provider_cost_events.
 */
export interface CommunicationsSpendItem {
  id: string;
  at: string;
  product: 'AI_CALL' | 'WHATSAPP' | 'AI_TALK';
  /** The campaign or conversation this belonged to, for a human to recognise. */
  reference: string | null;
  /** Already formatted: "2:14" for a call, "1 message" for a send. */
  unitsLabel: string;
  /**
   * null means the unit completed but carries no charge, because the product's
   * pricing is not active. Rendering that as $0.00 would claim it was free.
   */
  amountUsd: number | null;
}

export interface CommunicationsSpend {
  totalUsd: number;
  series: Array<{ date: string; amountUsd: number }>;
  byProduct: Record<'AI_CALL' | 'WHATSAPP' | 'AI_TALK', { amountUsd: number; units: number }>;
  items: CommunicationsSpendItem[];
  campaigns: Array<{ id: string; name: string; status: string; estimateUsd: number; actualUsd: number }>;
  /** Products that produced usage but have no active price. */
  unpricedProducts: string[];
}

// ── Admin: routing and voice ────────────────────────────────────────────────

/**
 * One row of comm_provider_routes, as Admin sees it.
 *
 * §139: `credentialsPresent` is a BOOLEAN and `credentialNames` are names.
 * There is deliberately no field on this type that could hold a secret value,
 * so no component can render one.
 */
export interface ProviderRouteRow {
  role: string;
  provider: string;
  priority: number;
  enabled: boolean;
  killSwitch: boolean;
  credentialsPresent: boolean;
  credentialNames: string[];
  countryScope: string[];
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastLatencyMs: number | null;
}

export interface ProviderReportRow {
  provider: string;
  roles: string[];
  health: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'DISABLED' | 'NOT_CONFIGURED';
  credentials: Array<{ name: string; present: boolean }>;
  latencyMs: number | null;
  lastTestedAt: string | null;
  detail: string | null;
  errorCode: string | null;
  /** Only what the provider itself reported (§33). */
  facts: Record<string, unknown> | null;
}

/** Every key here is read by a specific piece of server code. See CommunicationsVoicePanel. */
export interface CommVoiceTuning {
  min_silence_ms: number;
  complete_silence_ms: number;
  continuation_grace_ms: number;
  max_silence_ms: number;
  semantic_endpointing: boolean;
  interruption_enabled: boolean;
  interruption_threshold_ms: number;
  georgian_lock_threshold: number;
  max_call_duration_sec: number;
  recording_default: boolean;
}

export interface AiTalkLimits {
  session_seconds: number;
  daily_seconds: number;
  global_concurrent: number;
  per_visitor_concurrent: number;
  daily_sessions: number;
  enabled: boolean;
}
