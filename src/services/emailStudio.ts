// HOMATCH EMAIL STUDIO — the client's only door to the studio.
//
// Owner RPCs (ownership checked in Postgres) for drafts, audience and stats; the
// outreach-send edge function (body.action = "studio_*") for anything that needs the
// listing's real photos, the AI, or the email provider. No lead address ever comes
// back through here — recipients are display names and reason codes.

import { supabase } from '@/db/supabase';
import type { EmailContent } from '@/emailStudio/blocks';
import type { TemplateId } from '@/emailStudio/templates';
import type { PropertyEmailData } from '@/emailStudio/render';
import { parseEligibility, type EligibilitySummary } from '@/emailStudio/eligibility';

export interface StudioProperty {
  propertyId: string;
  homatchId: number | null;
  title: string | null;
  transactionType: string | null;
  propertyType: string | null;
  city: string | null;
  district: string | null;
  price: number | null;
  currency: string | null;
  segment: string | null;
  premiumEligible: boolean;
}

export interface CampaignStats {
  recipients: number;
  pending: number;
  sending: number;
  sent: number;
  delivered: number;
  bounced: number;
  complaints: number;
  failed: number;
  skipped: number;
  unsubscribed: number;
  opened: number;
  clicked: number;
  repliedTracked: boolean;
  opensApproximate: boolean;
}

export interface CampaignRecipient {
  recipientId: string;
  unlockId: string | null;
  displayName: string | null;
  status: string;
  skipReason: string | null;
  reason: string | null;
}

export interface StudioCampaign {
  campaignId: string;
  propertyId: string | null;
  templateId: TemplateId;
  name: string;
  language: string;
  content: EmailContent;
  status: 'DRAFT' | 'REVIEWED' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED';
  reviewedHash: string | null;
  sentAt: string | null;
  updatedAt: string;
  stats: CampaignStats;
  recipients: CampaignRecipient[];
}

export interface CampaignSummary {
  campaignId: string;
  name: string;
  templateId: TemplateId;
  status: StudioCampaign['status'];
  propertyTitle: string | null;
  homatchId: number | null;
  subject: string | null;
  sentAt: string | null;
  updatedAt: string;
  stats: CampaignStats;
}

export interface RenderResult {
  html: string;
  text: string;
  subject: string;
  droppedImages: number;
  property: PropertyEmailData & { segment: string | null };
  templates: Record<TemplateId, { available: boolean; reason?: string }>;
}

export interface ReviewResult {
  versionHash: string;
  recipients: number;
  eligible: number;
  reasons: Record<string, number>;
  costCredits: number;
  dailyCap: number;
  dailyUsed: number;
  sendingEnabled: boolean;
  sendingState: string;
  sender: { fromName: string; fromAddress: string; replyTo: string | null; replyToKind: string };
  droppedImages: number;
}

export interface SendResult {
  ok: boolean;
  state?: string;
  error?: string;
  sent?: number;
  failed?: number;
  skipped?: number;
  remaining?: number;
  capRemaining?: number;
}

export class StudioError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new StudioError(error.message || 'RPC_FAILED');
  return data as T;
}

async function invoke<T>(action: string, body: Record<string, unknown>): Promise<T & { ok: boolean; state?: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke('outreach-send', { body: { action, ...body } });
  if (error) {
    // A non-2xx answer still carries our JSON body; surface its code.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const parsed = await ctx.json().catch(() => null) as { error?: string; state?: string } | null;
      if (parsed) return { ok: false, ...parsed } as T & { ok: boolean };
    }
    throw new StudioError('NETWORK');
  }
  return data as T & { ok: boolean; state?: string; error?: string };
}

export const emailStudio = {
  myProperties: () => rpc<StudioProperty[]>('email_studio_my_properties'),
  eligibleRecipients: async (matchIds: string[] | null): Promise<EligibilitySummary> =>
    parseEligibility(await rpc('email_studio_eligible_recipients', { p_match_ids: matchIds && matchIds.length ? matchIds : null })),
  listCampaigns: () => rpc<CampaignSummary[]>('email_studio_list_campaigns'),
  getCampaign: (campaignId: string) => rpc<StudioCampaign>('email_studio_get_campaign', { p_campaign_id: campaignId }),
  saveDraft: (p: { campaignId?: string | null; propertyId: string | null; templateId: TemplateId; language: string; name?: string; content: EmailContent }) =>
    rpc<StudioCampaign>('email_studio_save_draft', { p }),
  setRecipients: (campaignId: string, unlockIds: string[]) =>
    rpc<StudioCampaign>('email_studio_set_recipients', { p_campaign_id: campaignId, p_unlock_ids: unlockIds }),
  stats: (campaignId: string) => rpc<CampaignStats>('email_studio_campaign_stats', { p_campaign_id: campaignId }),
  deleteDraft: (campaignId: string) => rpc<boolean>('email_studio_delete_draft', { p_campaign_id: campaignId }),

  render: (p: { propertyId: string; templateId: TemplateId; language: string; content: EmailContent | null }) =>
    invoke<RenderResult>('studio_render', p),
  generate: (p: { propertyId: string; templateId: TemplateId; language: string }) =>
    invoke<{ source: 'AI' | 'TEMPLATE'; reason?: string; copy: { subject: string; preheader: string; headline: string; body: string; cta: string } }>('studio_generate', p),
  review: (campaignId: string) => invoke<ReviewResult>('studio_review', { campaignId }),
  sendTest: (campaignId: string) => invoke<{ sentTo?: string }>('studio_test', { campaignId }),
  send: (campaignId: string, versionHash: string) =>
    invoke<SendResult>('studio_send', { campaignId, versionHash, approved: true }),
};
