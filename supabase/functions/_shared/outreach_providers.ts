// ── Outreach Provider Abstraction (Phase 7) ──────────────────
// All real providers are disabled. MOCK performs zero network operations.
// Provider selection is guarded by safety flags.

export type EmailProvider = 'WIX' | 'AWS_SES' | 'MOCK';
export type VoiceProvider = 'RETELL' | 'VAPI' | 'MOCK';
export type SmsProvider = 'TWILIO' | 'RETELL' | 'MOCK';

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from_name?: string;
  from_email?: string;
  reply_to?: string;
  campaign_id?: string;
}

export interface EmailSendResult {
  success: boolean;
  provider_message_id?: string;
  error?: string;
  is_mock: boolean;
}

export interface InitiateCallParams {
  to_phone: string;
  agent_config: Record<string, unknown>;
  language?: string;
  campaign_id?: string;
  max_duration_sec?: number;
}

export interface CallInitResult {
  success: boolean;
  provider_call_id?: string;
  error?: string;
  is_mock: boolean;
}

export interface SendSmsParams {
  to: string;
  body: string;
  campaign_id?: string;
}

export interface SmsSendResult {
  success: boolean;
  provider_message_id?: string;
  error?: string;
  is_mock: boolean;
}

// ── MOCK Email Adapter (zero network) ────────────────────────
export class MockEmailAdapter {
  readonly provider: EmailProvider = 'MOCK';

  async send(params: SendEmailParams): Promise<EmailSendResult> {
    console.log('[MockEmailAdapter] MOCK send to:', params.to, '| subject:', params.subject);
    return {
      success: true,
      provider_message_id: `mock_email_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      is_mock: true,
    };
  }

  async validateCredentials(): Promise<boolean> { return true; }
}

// ── WIX Email Adapter (disabled — credentials not configured) ─
export class WixEmailAdapter {
  readonly provider: EmailProvider = 'WIX';
  constructor(_apiKey: string) {}

  async send(_params: SendEmailParams): Promise<EmailSendResult> {
    return { success: false, error: 'WIX email adapter disabled (outreach_email_sending_enabled=false)', is_mock: false };
  }
}

// ── AWS SES Adapter (disabled) ────────────────────────────────
export class AwsSesAdapter {
  readonly provider: EmailProvider = 'AWS_SES';
  constructor(_accessKey: string, _secret: string, _region: string) {}

  async send(_params: SendEmailParams): Promise<EmailSendResult> {
    return { success: false, error: 'AWS SES adapter disabled (outreach_email_sending_enabled=false)', is_mock: false };
  }
}

// ── MOCK Voice Adapter (zero network) ─────────────────────────
export class MockVoiceAdapter {
  readonly provider: VoiceProvider = 'MOCK';

  async initiateCall(params: InitiateCallParams): Promise<CallInitResult> {
    console.log('[MockVoiceAdapter] MOCK call to:', params.to_phone);
    return {
      success: true,
      provider_call_id: `mock_call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      is_mock: true,
    };
  }
}

// ── Retell Voice Adapter (disabled) ───────────────────────────
export class RetellAdapter {
  readonly provider: VoiceProvider = 'RETELL';
  constructor(_apiKey: string) {}

  async initiateCall(_params: InitiateCallParams): Promise<CallInitResult> {
    return { success: false, error: 'Retell adapter disabled (outreach_calling_enabled=false)', is_mock: false };
  }
}

// ── MOCK SMS Adapter (zero network) ───────────────────────────
export class MockSmsAdapter {
  readonly provider: SmsProvider = 'MOCK';

  async send(params: SendSmsParams): Promise<SmsSendResult> {
    console.log('[MockSmsAdapter] MOCK SMS to:', params.to, '| body length:', params.body.length);
    return {
      success: true,
      provider_message_id: `mock_sms_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      is_mock: true,
    };
  }
}

// ── Provider factory (returns MOCK when disabled) ─────────────
export function getEmailAdapter(
  emailEnabled: boolean,
  _provider?: string
): MockEmailAdapter | WixEmailAdapter | AwsSesAdapter {
  if (!emailEnabled) return new MockEmailAdapter();
  // Real adapters disabled until flag enabled + credentials configured
  return new MockEmailAdapter();
}

export function getVoiceAdapter(
  callingEnabled: boolean,
  _provider?: string
): MockVoiceAdapter | RetellAdapter {
  if (!callingEnabled) return new MockVoiceAdapter();
  return new MockVoiceAdapter();
}

export function getSmsAdapter(smsEnabled: boolean, _provider?: string): MockSmsAdapter {
  if (!smsEnabled) return new MockSmsAdapter();
  return new MockSmsAdapter();
}
