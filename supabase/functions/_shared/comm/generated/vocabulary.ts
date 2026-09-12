// GENERATED FILE — DO NOT EDIT.
//
// Copied from src/lib/comm/vocabulary.ts by scripts/sync-comm-domain.mjs so that the
// server enforces exactly what the browser previews. Edit the source file and
// re-run `node scripts/sync-comm-domain.mjs`; scripts/check-comm-sync.mjs
// fails the build if these drift.

// HOMATCH Communications — the one vocabulary.
//
// Every list here is the exact set a Postgres CHECK constraint allows, from
// supabase/migrations/20260912110000_communications_hub.sql. They are repeated
// in TypeScript for one reason: so a component can never render a status the
// database would refuse to store, and so a test can fail the moment the two
// drift apart.
//
// WHY PROVIDER WORDS ARE NOT IN HERE
//
// Meta says "sent/delivered/read/failed". Vapi says "queued/ringing/in-progress/
// ended" with an endedReason. Retell said something else again. If any of those
// words reach a React component, then adding a fourth provider means editing
// the inbox. They are translated once, in statusMap.ts, and what comes out is
// the vocabulary below. The provider's own word is kept beside the row in
// provider_status_raw so support can still see it.

export const CHANNELS = ['WHATSAPP', 'AI_CALL', 'SMS', 'EMAIL'] as const;
export type Channel = (typeof CHANNELS)[number];

export const CAMPAIGN_TYPES = [
  'EMAIL', 'SMS', 'AI_CALL', 'COMMUNITY', 'DIRECT_MATCH', 'MULTI_CHANNEL', 'WHATSAPP',
] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export const CAMPAIGN_STATUSES = [
  'DRAFT', 'READY', 'REVIEW_REQUIRED', 'APPROVED', 'SCHEDULED', 'RUNNING',
  'PAUSED', 'COMPLIANCE_PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Statuses a campaign can never leave on its own. */
export const TERMINAL_CAMPAIGN_STATUSES: readonly CampaignStatus[] = ['COMPLETED', 'CANCELLED', 'FAILED'];

/**
 * The distinction §52 exists to protect: a customer may resume what they
 * paused and may not resume what the kill switch paused. This is checked on
 * the server too — it is here so the UI can also decline to offer the button.
 */
export function isUserResumable(status: CampaignStatus): boolean {
  return status === 'PAUSED';
}

export function isRunningLike(status: CampaignStatus): boolean {
  return status === 'RUNNING' || status === 'SCHEDULED';
}

export const SEND_STATUSES = [
  'PENDING', 'QUEUED', 'SENDING', 'DIALING', 'RINGING', 'ANSWERED', 'SENT',
  'DELIVERED', 'READ', 'COMPLETED', 'FAILED', 'NO_ANSWER', 'BUSY',
  'CANCELLED', 'BOUNCED', 'OPTED_OUT', 'SUPPRESSED',
] as const;
export type SendStatus = (typeof SEND_STATUSES)[number];

export const TERMINAL_SEND_STATUSES: readonly SendStatus[] = [
  'COMPLETED', 'FAILED', 'NO_ANSWER', 'BUSY', 'CANCELLED', 'BOUNCED', 'OPTED_OUT', 'SUPPRESSED',
];

export function isSendTerminal(status: SendStatus): boolean {
  return TERMINAL_SEND_STATUSES.includes(status);
}

/** A call that is on the wire right now — what the Live Calls panel shows. */
export const LIVE_CALL_STATUSES: readonly SendStatus[] = ['DIALING', 'RINGING', 'ANSWERED'];

export function isCallLive(status: SendStatus): boolean {
  return LIVE_CALL_STATUSES.includes(status);
}

export const MESSAGE_STATUSES = [
  'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED', 'DELETED',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/**
 * Delivery only ever moves forward. Meta can and does deliver a `sent`
 * callback after a `read` callback — the webhook must not walk the row
 * backwards on a late or reordered event (§31).
 */
const MESSAGE_STATUS_RANK: Record<MessageStatus, number> = {
  QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3,
  // Terminal-ish and off the ladder: they win over progress but not over each
  // other, and RECEIVED belongs to inbound messages which never climb at all.
  FAILED: 4, RECEIVED: 4, DELETED: 5,
};

export function isForwardMessageTransition(from: MessageStatus, to: MessageStatus): boolean {
  return MESSAGE_STATUS_RANK[to] > MESSAGE_STATUS_RANK[from];
}

export const CONVERSATION_MODES = [
  'AI_ACTIVE', 'HUMAN_ACTIVE', 'PENDING_HANDOFF', 'PAUSED', 'CLOSED',
] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[number];

export const LEAD_STAGES = [
  'NEW', 'REACHED', 'ENGAGED', 'QUALIFIED', 'INTERESTED',
  'CALLBACK', 'VIEWING', 'CONVERTED', 'LOST',
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** The funnel the Overview draws. LOST and CALLBACK are outcomes, not steps. */
export const FUNNEL_STAGES: readonly LeadStage[] = [
  'REACHED', 'ENGAGED', 'QUALIFIED', 'INTERESTED', 'VIEWING', 'CONVERTED',
];

export const AGENT_STATUSES = ['DRAFT', 'READY', 'PAUSED', 'NEEDS_ATTENTION', 'ARCHIVED'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_TEMPLATES = [
  'BUYER_QUALIFICATION', 'SELLER_QUALIFICATION', 'PROPERTY_FOLLOWUP',
  'VIEWING_CONFIRMATION', 'COLD_REACTIVATION', 'DEVELOPER_SALES',
  'RENTAL_INQUIRY', 'MORTGAGE_FOLLOWUP', 'INVESTOR_QUALIFICATION', 'CUSTOM',
] as const;
export type AgentTemplate = (typeof AGENT_TEMPLATES)[number];

export const TEMPLATE_STATUSES = [
  'DRAFT', 'SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED',
] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

/**
 * The only state in which Meta will accept a business-initiated template send.
 * Generating copy with AI does not move a template one step along this (§37).
 */
export function isTemplateSendable(status: TemplateStatus): boolean {
  return status === 'APPROVED';
}

export const TRUST_TIERS = ['NEW', 'TRUSTED', 'VERIFIED', 'ELEVATED', 'RESTRICTED'] as const;
export type TrustTier = (typeof TRUST_TIERS)[number];

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const POLICY_DECISIONS = ['ALLOW', 'REVIEW', 'BLOCK', 'THROTTLE'] as const;
export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

export const PROVIDER_ROLES = [
  'ORCHESTRATOR', 'STT', 'TTS', 'LLM', 'TELEPHONY', 'MESSAGING', 'WHATSAPP_CALL',
] as const;
export type ProviderRole = (typeof PROVIDER_ROLES)[number];

export const CALL_OUTCOMES = [
  'QUALIFIED', 'INTERESTED', 'CALLBACK', 'NOT_INTERESTED',
  'NO_ANSWER', 'BUSY', 'FAILED', 'HUMAN_HANDOFF', 'VOICEMAIL',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/**
 * What a customer is allowed to be told about their own compliance state
 * (§131). The internal decision and the thresholds behind it stay in Admin.
 */
export function customerFacingComplianceLabel(
  decision: PolicyDecision | null | undefined,
): 'READY' | 'NEEDS_REVIEW' | 'PAUSED_FOR_SAFETY' {
  if (decision === 'BLOCK') return 'PAUSED_FOR_SAFETY';
  if (decision === 'REVIEW') return 'NEEDS_REVIEW';
  return 'READY';
}
