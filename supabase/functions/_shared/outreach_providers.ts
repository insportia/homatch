// ── Outreach Provider Abstraction (Phase 7) ──────────────────
// Real adapters (Resend / Twilio / Retell) are implemented below, but the
// factory functions only ever return them when the caller explicitly passes
// enabled=true (driven by admin_settings.outreach_*_sending_enabled /
// outreach_calling_enabled) AND the provider's API key secret is configured.
// Any other case — flag off, key missing, kill switch active — silently
// falls back to the zero-network Mock adapter. This keeps "install the code"
// and "don't spend money yet" both true at once.

export type EmailProvider = 'RESEND' | 'WIX' | 'AWS_SES' | 'MOCK';
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
  webhook_url?: string;
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

// ── MOCK adapters (zero network) ──────────────────────────────
export class MockEmailAdapter {
  readonly provider: EmailProvider = 'MOCK';
  async send(params: SendEmailParams): Promise<EmailSendResult> {
    console.log('[MockEmailAdapter] MOCK send to:', params.to, '| subject:', params.subject);
    return { success: true, provider_message_id: `mock_email_${Date.now()}_${Math.random().toString(36).slice(2)}`, is_mock: true };
  }
  async validateCredentials(): Promise<boolean> { return true; }
}

export class MockVoiceAdapter {
  readonly provider: VoiceProvider = 'MOCK';
  async initiateCall(params: InitiateCallParams): Promise<CallInitResult> {
    console.log('[MockVoiceAdapter] MOCK call to:', params.to_phone);
    return { success: true, provider_call_id: `mock_call_${Date.now()}_${Math.random().toString(36).slice(2)}`, is_mock: true };
  }
}

export class MockSmsAdapter {
  readonly provider: SmsProvider = 'MOCK';
  async send(params: SendSmsParams): Promise<SmsSendResult> {
    console.log('[MockSmsAdapter] MOCK SMS to:', params.to, '| body length:', params.body.length);
    return { success: true, provider_message_id: `mock_sms_${Date.now()}_${Math.random().toString(36).slice(2)}`, is_mock: true };
  }
}

// ── Resend Email Adapter (real, only reached when enabled) ────
export class ResendEmailAdapter {
  readonly provider: EmailProvider = 'RESEND';
  constructor(private apiKey: string) {}

  async send(params: SendEmailParams): Promise<EmailSendResult> {
    try {
      const from = params.from_name
        ? `${params.from_name} <${params.from_email || 'noreply@homatch.live'}>`
        : (params.from_email || 'Homatch <noreply@homatch.live>');
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to: [params.to], subject: params.subject, html: params.html,
          text: params.text, reply_to: params.reply_to,
        }),
        signal: AbortSignal.timeout(20000),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: json?.message || `Resend HTTP ${res.status}`, is_mock: false };
      return { success: true, provider_message_id: json?.id, is_mock: false };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), is_mock: false };
    }
  }
  async validateCredentials(): Promise<boolean> {
    try {
      const res = await fetch('https://api.resend.com/emails', { headers: { Authorization: `Bearer ${this.apiKey}` } });
      return res.status !== 401;
    } catch { return false; }
  }
}

// ── Twilio SMS Adapter (real, only reached when enabled) ───────
export class TwilioSmsAdapter {
  readonly provider: SmsProvider = 'TWILIO';
  constructor(private accountSid: string, private authToken: string, private fromNumber: string) {}

  async send(params: SendSmsParams): Promise<SmsSendResult> {
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
      const body = new URLSearchParams({ To: params.to, From: this.fromNumber, Body: params.body });
      const auth = btoa(`${this.accountSid}:${this.authToken}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(20000),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: json?.message || `Twilio HTTP ${res.status}`, is_mock: false };
      return { success: true, provider_message_id: json?.sid, is_mock: false };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), is_mock: false };
    }
  }
}

// ── Retell Voice Adapter (real, only reached when enabled) ─────
export class RetellAdapter {
  readonly provider: VoiceProvider = 'RETELL';
  constructor(private apiKey: string, private agentId: string, private fromNumber: string) {}

  async initiateCall(params: InitiateCallParams): Promise<CallInitResult> {
    try {
      const res = await fetch('https://api.retellai.com/v2/create-phone-call', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_number: this.fromNumber,
          to_number: params.to_phone,
          override_agent_id: this.agentId,
          retell_llm_dynamic_variables: { agent_config: JSON.stringify(params.agent_config), language: params.language || 'en' },
          metadata: { campaign_id: params.campaign_id, webhook_url: params.webhook_url },
        }),
        signal: AbortSignal.timeout(20000),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: json?.message || `Retell HTTP ${res.status}`, is_mock: false };
      return { success: true, provider_call_id: json?.call_id, is_mock: false };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), is_mock: false };
    }
  }
}

// ── Provider factories ─────────────────────────────────────────
// enabled must come from admin_settings (outreach_*_sending_enabled /
// outreach_calling_enabled) AND provider_kill_switch must be false — callers
// are responsible for checking the kill switch before calling these.
export function getEmailAdapter(emailEnabled: boolean, provider?: string): MockEmailAdapter | ResendEmailAdapter {
  if (!emailEnabled) return new MockEmailAdapter();
  const key = Deno.env.get('RESEND_API_KEY');
  if ((provider ?? 'RESEND').toUpperCase() === 'RESEND' && key) return new ResendEmailAdapter(key);
  return new MockEmailAdapter();
}

export function getVoiceAdapter(callingEnabled: boolean, provider?: string): MockVoiceAdapter | RetellAdapter {
  if (!callingEnabled) return new MockVoiceAdapter();
  const key = Deno.env.get('RETELL_API_KEY');
  const agentId = Deno.env.get('RETELL_AGENT_ID');
  const fromNumber = Deno.env.get('RETELL_FROM_NUMBER');
  if ((provider ?? 'RETELL').toUpperCase() === 'RETELL' && key && agentId && fromNumber) {
    return new RetellAdapter(key, agentId, fromNumber);
  }
  return new MockVoiceAdapter();
}

export function getSmsAdapter(smsEnabled: boolean, provider?: string): MockSmsAdapter | TwilioSmsAdapter {
  if (!smsEnabled) return new MockSmsAdapter();
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const fromNumber = Deno.env.get('TWILIO_FROM_NUMBER');
  if ((provider ?? 'TWILIO').toUpperCase() === 'TWILIO' && sid && token && fromNumber) {
    return new TwilioSmsAdapter(sid, token, fromNumber);
  }
  return new MockSmsAdapter();
}
