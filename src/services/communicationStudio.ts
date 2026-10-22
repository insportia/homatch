// EMAIL STUDIO + MESSAGE ASSIST — the browser's side of the server contract.
//
//   AI           communication-studio-ai (drafts only; never sends)
//   documents    email_studio_documents (owner RLS): drafts and templates
//   photos       the property's own PUBLIC photos, for the image picker
//   send         email_studio_prepare_audience (eligible, non-opted-out copies
//                of the owner's own contacts) → outreach-campaign-preview
//                (creates the EMAIL campaign with the rendered HTML) →
//                outreach-send (Resend, suppression, unsubscribe footer,
//                per-contact claim). Nothing is sent without the caller having
//                confirmed, and a document that already created a campaign
//                reuses it, so a retried send cannot mail anyone twice.
import { supabase } from '@/db/supabase';
import {
  type EmailDesign, renderEmailHtml, renderEmailText, sanitizeDesign,
} from '@/communication/emailDesign';

export class StudioError extends Error {
  constructor(public code: string, message?: string) { super(message ?? code); }
}

async function invokeAi<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('communication-studio-ai', { body });
  if (error) {
    let code = 'GENERATION_FAILED';
    try {
      const ctx = (error as { context?: Response }).context;
      const parsed = ctx ? await ctx.json() : null;
      if (parsed?.code) code = String(parsed.code);
    } catch { /* keep the generic code */ }
    throw new StudioError(code);
  }
  const d = data as { ok?: boolean; code?: string } & T;
  if (!d?.ok) throw new StudioError(d?.code ?? 'GENERATION_FAILED');
  return d;
}

export type RewriteMode = 'improve' | 'shorten' | 'professional' | 'persuasive' | 'translate' | 'expand';
export type MessageChannel = 'WHATSAPP' | 'TELEGRAM' | 'SMS' | 'HOMATCH_CHAT' | 'PROFILE_DM';

export interface DraftEmail { subject: string; preheader: string; design: EmailDesign }

export const studioAi = {
  composeEmail: async (p: { instruction: string; language: string; propertyId?: string | null; design?: EmailDesign | null }): Promise<DraftEmail> => {
    const r = await invokeAi<DraftEmail>({ action: 'compose_email', ...p });
    return { subject: r.subject, preheader: r.preheader, design: sanitizeDesign(r.design) };
  },
  variations: async (p: { instruction: string; language: string; propertyId?: string | null }): Promise<DraftEmail[]> => {
    const r = await invokeAi<{ variants: DraftEmail[] }>({ action: 'variations', ...p });
    return r.variants.map((v) => ({ subject: v.subject, preheader: v.preheader, design: sanitizeDesign(v.design) }));
  },
  rewrite: async (p: { text: string; mode: RewriteMode; language: string; targetLanguage?: string; instruction?: string; propertyId?: string | null }) =>
    (await invokeAi<{ text: string }>({ action: 'rewrite', ...p })).text,
  subjects: async (p: { subject: string; design: EmailDesign; language: string; propertyId?: string | null }) =>
    (await invokeAi<{ subjects: string[] }>({ action: 'subjects', ...p })).subjects,
  cta: async (p: { language: string; instruction?: string; propertyId?: string | null }) =>
    (await invokeAi<{ labels: string[] }>({ action: 'cta', ...p })).labels,
  composeMessage: async (p: { channel: MessageChannel; instruction: string; language: string; propertyId?: string | null; recipientLanguage?: string | null }) =>
    invokeAi<{ text: string; limit: number }>({ action: 'compose_message', ...p }),
  personalize: async (p: { text: string; language: string; recipientName?: string | null; recipientLanguage?: string | null }) =>
    (await invokeAi<{ text: string }>({ action: 'personalize', ...p })).text,
};

/* ── documents ───────────────────────────────────────────────────────────── */

export interface StudioDocument {
  id: string;
  kind: 'DRAFT' | 'TEMPLATE';
  name: string;
  subject: string;
  preheader: string;
  language: string;
  property_id: string | null;
  design: EmailDesign;
  recipients: string[];
  outreach_campaign_id: string | null;
  updated_at: string;
  created_at: string;
}

const DOC_COLUMNS = 'id,kind,name,subject,preheader,language,property_id,design,recipients,outreach_campaign_id,updated_at,created_at';

function toDoc(row: Record<string, unknown>): StudioDocument {
  return {
    ...(row as unknown as StudioDocument),
    design: sanitizeDesign(row.design),
    recipients: Array.isArray(row.recipients) ? (row.recipients as unknown[]).map(String) : [],
  };
}

export async function listDocuments(kind?: 'DRAFT' | 'TEMPLATE'): Promise<StudioDocument[]> {
  let q = supabase.from('email_studio_documents').select(DOC_COLUMNS).order('updated_at', { ascending: false }).limit(100);
  if (kind) q = q.eq('kind', kind);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toDoc);
}

export async function getDocument(id: string): Promise<StudioDocument | null> {
  const { data, error } = await supabase.from('email_studio_documents').select(DOC_COLUMNS).eq('id', id).maybeSingle();
  if (error || !data) return null;
  return toDoc(data as Record<string, unknown>);
}

export interface DocumentInput {
  id?: string | null;
  kind: 'DRAFT' | 'TEMPLATE';
  name: string;
  subject: string;
  preheader: string;
  language: string;
  property_id: string | null;
  design: EmailDesign;
  recipients: string[];
}

/** Insert or update; returns the saved row. The design is sanitised before it leaves the browser. */
export async function saveDocument(input: DocumentInput): Promise<StudioDocument> {
  const row = {
    kind: input.kind,
    name: input.name.slice(0, 200),
    subject: input.subject.slice(0, 300),
    preheader: input.preheader.slice(0, 300),
    language: input.language,
    property_id: input.property_id,
    design: sanitizeDesign(input.design),
    recipients: input.recipients.slice(0, 500),
    updated_at: new Date().toISOString(),
  };
  const q = input.id
    ? supabase.from('email_studio_documents').update(row).eq('id', input.id).select(DOC_COLUMNS).single()
    : supabase.from('email_studio_documents').insert(row).select(DOC_COLUMNS).single();
  const { data, error } = await q;
  if (error || !data) throw new Error(error?.message ?? 'save_failed');
  return toDoc(data as Record<string, unknown>);
}

export async function deleteDocument(id: string): Promise<void> {
  const { error } = await supabase.from('email_studio_documents').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/* ── photos ──────────────────────────────────────────────────────────────── */

export interface StudioPhoto { url: string; cover: boolean; landscape: boolean | null }

/** The property's PUBLIC photos only: an email leaves HOMATCH, so a private photo never may. */
export async function listPublicPhotos(propertyId: string): Promise<StudioPhoto[]> {
  const { data } = await supabase.from('property_photos')
    .select('public_url,is_cover,display_order,width,height,visibility')
    .eq('property_id', propertyId).eq('visibility', 'PUBLIC')
    .order('is_cover', { ascending: false }).order('display_order', { ascending: true }).limit(30);
  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter((p) => typeof p.public_url === 'string' && String(p.public_url).startsWith('https://'))
    .map((p) => {
      const w = Number(p.width); const h = Number(p.height);
      return { url: String(p.public_url), cover: Boolean(p.is_cover), landscape: w > 0 && h > 0 ? w >= h : null };
    });
}

/**
 * Suggested photos, from facts we hold — the owner's cover choice, then their
 * gallery order, preferring landscape frames for a wide email. No model looks
 * at the pictures, and the label in the UI says so.
 */
export function suggestPhotos(photos: StudioPhoto[], count = 3): StudioPhoto[] {
  const rank = (p: StudioPhoto) => (p.cover ? 0 : p.landscape === true ? 1 : p.landscape === null ? 2 : 3);
  return photos.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).slice(0, count).map((x) => x.p);
}

/* ── send ────────────────────────────────────────────────────────────────── */

export type SendOutcome =
  | { kind: 'sent'; campaignId: string; sent: number; failed: number; excluded: number }
  | { kind: 'blocked'; campaignId: string | null; reason: string }
  | { kind: 'nobody'; excluded: number };

/**
 * Send ONE confirmed document to the chosen contacts.
 *
 * Re-running for the same document reuses its campaign: outreach-send claims
 * each contact once per campaign, so a retry after a timeout continues where it
 * stopped instead of mailing the first recipients again.
 */
export async function sendDocument(doc: StudioDocument, opts: { contactIds: string[]; dir: 'ltr' | 'rtl'; senderName?: string }): Promise<SendOutcome> {
  let campaignId = doc.outreach_campaign_id;
  let excluded = 0;
  if (!campaignId) {
    const { data: audience, error: aErr } = await supabase.rpc('email_studio_prepare_audience', {
      p_contact_ids: opts.contactIds, p_list_name: doc.name || doc.subject || 'Email Studio',
    });
    if (aErr) throw new StudioError('AUDIENCE_FAILED', aErr.message);
    const a = audience as { listId: string; eligible: number; excluded: number };
    excluded = Number(a.excluded ?? 0);
    if (!a.eligible) return { kind: 'nobody', excluded };

    const html = renderEmailHtml(doc.design, { subject: doc.subject, preheader: doc.preheader, dir: opts.dir, lang: doc.language });
    const text = renderEmailText(doc.design);
    const { data: created, error: cErr } = await supabase.functions.invoke('outreach-campaign-preview', {
      body: {
        campaign_type: 'EMAIL', name: (doc.name || doc.subject).slice(0, 200), subject: doc.subject,
        html_body: html, text_body: text, language: doc.language, contact_list_id: a.listId,
        sender_name: opts.senderName || undefined, property_id: doc.property_id ?? undefined,
      },
    });
    if (cErr) throw new StudioError('CAMPAIGN_CREATE_FAILED', cErr.message);
    campaignId = String((created as { campaign?: { id?: string }; id?: string })?.campaign?.id ?? (created as { id?: string })?.id ?? '');
    if (!campaignId) throw new StudioError('CAMPAIGN_CREATE_FAILED');
    await supabase.from('email_studio_documents').update({ outreach_campaign_id: campaignId, updated_at: new Date().toISOString() }).eq('id', doc.id);
  }

  let sent = 0;
  let failed = 0;
  /* outreach-send works in batches of 40; continue until it reports nothing left. Bounded. */
  for (let round = 0; round < 15; round++) {
    const { data, error } = await supabase.functions.invoke('outreach-send', { body: { campaign_id: campaignId } });
    if (error) {
      let reason = 'SEND_FAILED';
      try { const p = await (error as { context?: Response }).context?.json(); if (p?.reason) reason = String(p.reason); } catch { /* keep generic */ }
      if (sent === 0) return { kind: 'blocked', campaignId, reason };
      break;
    }
    const r = data as { blocked?: boolean; reason?: string; sent?: number; failed?: number; processed?: number; remaining_hint?: boolean };
    if (r?.blocked) return { kind: 'blocked', campaignId, reason: r.reason ?? 'BLOCKED' };
    sent += Number(r?.sent ?? 0);
    failed += Number(r?.failed ?? 0);
    /* A full batch hints at more; an empty or partial one means every eligible contact was claimed. */
    if (!r?.processed || !r?.remaining_hint) break;
  }
  return { kind: 'sent', campaignId, sent, failed, excluded };
}

/** Delivery state of a sent document, from the provider's own webhook-fed counters. */
export async function campaignDelivery(campaignId: string) {
  const { data } = await supabase.from('outreach_campaigns')
    .select('status,sent_count,delivered_count,bounce_count,complaint_count,unsubscribe_count,failed_count,last_send_error')
    .eq('id', campaignId).maybeSingle();
  return data as null | {
    status: string; sent_count: number; delivered_count: number; bounce_count: number;
    complaint_count: number; unsubscribe_count: number; failed_count: number; last_send_error: string | null;
  };
}
