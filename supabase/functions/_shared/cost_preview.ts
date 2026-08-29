// ── Cost Preview & Approval (Phase 7) ─────────────────────────
// Computes estimated customer-facing price BEFORE any execution.
// Provider COGS tracked separately. No real transactions here.

export interface PricingConfig {
  email_price_per_1k: number;       // USD
  sms_unit_price: number;           // USD per SMS
  call_price_per_min: number;       // USD per minute
  community_recommend_price: number; // USD per recommendation
}

export interface CostPreview {
  channel: string;
  unit_count: number;
  unit_label: string;
  unit_price: number;
  total_estimate_usd: number;
  breakdown: string;
  requires_approval: boolean;
  approval_threshold_usd: number;
}

const DEFAULT_APPROVAL_THRESHOLD = 5.0; // USD

export function previewEmailCost(
  recipientCount: number,
  config: PricingConfig
): CostPreview {
  const total = (recipientCount / 1000) * config.email_price_per_1k;
  return {
    channel: 'EMAIL',
    unit_count: recipientCount,
    unit_label: 'recipients',
    unit_price: config.email_price_per_1k,
    total_estimate_usd: parseFloat(total.toFixed(4)),
    breakdown: `${recipientCount} recipients × $${config.email_price_per_1k}/1k = $${total.toFixed(4)}`,
    requires_approval: total >= DEFAULT_APPROVAL_THRESHOLD,
    approval_threshold_usd: DEFAULT_APPROVAL_THRESHOLD,
  };
}

export function previewSmsCost(
  recipientCount: number,
  config: PricingConfig
): CostPreview {
  const total = recipientCount * config.sms_unit_price;
  return {
    channel: 'SMS',
    unit_count: recipientCount,
    unit_label: 'recipients',
    unit_price: config.sms_unit_price,
    total_estimate_usd: parseFloat(total.toFixed(4)),
    breakdown: `${recipientCount} SMS × $${config.sms_unit_price} = $${total.toFixed(4)}`,
    requires_approval: total >= DEFAULT_APPROVAL_THRESHOLD,
    approval_threshold_usd: DEFAULT_APPROVAL_THRESHOLD,
  };
}

export function previewCallCost(
  recipientCount: number,
  avgDurationMin: number,
  config: PricingConfig
): CostPreview {
  const total = recipientCount * avgDurationMin * config.call_price_per_min;
  return {
    channel: 'AI_CALL',
    unit_count: recipientCount,
    unit_label: 'calls',
    unit_price: config.call_price_per_min,
    total_estimate_usd: parseFloat(total.toFixed(4)),
    breakdown: `${recipientCount} calls × ~${avgDurationMin}min × $${config.call_price_per_min}/min = $${total.toFixed(4)}`,
    requires_approval: total >= DEFAULT_APPROVAL_THRESHOLD,
    approval_threshold_usd: DEFAULT_APPROVAL_THRESHOLD,
  };
}
