// HOMATCH EMAIL STUDIO — the server side, routed through outreach-send.
//
// outreach-send hands every request whose body carries `action: "studio_*"` here and
// keeps its own behaviour byte-for-byte for every other body (production is at the
// edge-function cap, so the studio does not get a function of its own).
//
//   studio_render    email-safe HTML from the seller's blocks + the seller's OWN
//                    listing, loaded here (real photos only, never a placeholder)
//   studio_generate  AI draft of subject/headline/body/CTA from the listing facts;
//                    a guarded, never-inventing prompt; template copy as fallback
//   studio_review    the eligibility re-check, the approved version hash, the
//                    price (0 credits) and who the email is from
//   studio_test      one email to the caller's own address; only with sending on
//   studio_send      explicit approval + the reviewed hash; ≤ 50 recipients a
//                    call, through the same Resend adapter outreach uses
//
// THE RULES
//   · A lead's address never leaves this runtime. It is read at send time by a
//     service-role claim and handed to the adapter, and nothing else.
//   · Email is never simulated. Sending off, kill switch on, provider switched
//     off, no API key or spend cap reached → a clear state, and nothing is
//     written as sent. (outreach-send's "EMAIL IS NEVER SIMULATED" rule.)
//   · A recipient is emailed at most once per campaign: only PENDING rows are
//     claimable, and the claim is a row lock in Postgres, not a read here.
//   · Every campaign email carries a signed one-click unsubscribe link; the
//     renderer refuses to produce one without it.
//   · Campaigns are free. Provider cost is recorded in cost_events.

import { authenticate, serviceClient, json, logEvent, redact } from './comm/auth.ts';
import { callLlm, llmAvailable } from './comm/llm.ts';
import { getEmailAdapter } from './outreach_providers.ts';
import { checkSpendCap } from './spend_cap.ts';
import { loadDisabledProviders } from './providerSwitch.ts';
import { estimatedProviderCost } from './providerCost.ts';
import { signUnsubscribeToken } from './suppression.ts';
import { renderEmail, type PropertyEmailData } from '../../../src/emailStudio/render.ts';
import { defaultContent, normalizeContent } from '../../../src/emailStudio/blocks.ts';
import {
  TEMPLATE_COPY, TEMPLATE_IDS, asEmailLang, isTemplateId, templateAvailability, type TemplateId,
} from '../../../src/emailStudio/templates.ts';
import { checkDraft, DRAFT_SYSTEM_PROMPT } from '../../../src/emailStudio/copyGuard.ts';
import { galleryImages } from '../../../src/property/gallery.ts';

type Sb = ReturnType<typeof serviceClient>;

const SITE = (Deno.env.get('PUBLIC_SITE_URL') || 'https://www.homatch.live').replace(/\/+$/, '');
const PHOTO_BUCKET = 'property-photos';
/** Email images must outlive the inbox visit; the photo itself is PUBLIC visibility. */
const EMAIL_IMAGE_SECONDS = 60 * 60 * 24 * 30;
const MAX_IMAGES = 12;
const SEND_BATCH = 50;

export function isStudioAction(body: unknown): boolean {
  const a = (body as { action?: unknown } | null)?.action;
  return typeof a === 'string' && a.startsWith('studio_');
}

interface Owner {
  id: string;
  authId: string;
  email: string | null;
  displayName: string;
  language: string;
}

async function loadOwner(sb: Sb, authId: string): Promise<Owner | null> {
  const { data } = await sb.from('users')
    .select('id, email, full_name, nickname, suspended_at, preferred_language')
    .eq('auth_id', authId).maybeSingle();
  if (!data || data.suspended_at) return null;
  const name = String(data.nickname || data.full_name || '').trim() || 'HOMATCH';
  return {
    id: data.id as string, authId, email: (data.email as string | null) ?? null,
    displayName: name.replace(/[<>"\r\n]/g, '').slice(0, 60),
    language: String(data.preferred_language ?? 'en'),
  };
}

/* ── the seller's own listing ─────────────────────────────────────────────── */

function toSupabasePath(stored: string): string {
  return stored.startsWith(`${PHOTO_BUCKET}/`) ? stored.slice(PHOTO_BUCKET.length + 1) : stored;
}

interface LoadedProperty {
  data: PropertyEmailData;
  segment: string | null;
  propertyId: string;
}

async function loadProperty(sb: Sb, ownerId: string, propertyId: string): Promise<LoadedProperty | null> {
  if (!/^[0-9a-f-]{36}$/i.test(propertyId)) return null;
  const { data: p } = await sb.from('properties')
    .select('id, user_id, homatch_id, title, transaction_type, property_type, cover_photo_url, is_deleted')
    .eq('id', propertyId).eq('user_id', ownerId).maybeSingle();
  if (!p || p.is_deleted) return null;

  const [{ data: f }, { data: photos }, { data: seg }] = await Promise.all([
    sb.from('property_facts')
      .select('city, district, address, total_price, currency, area, rooms, bedrooms, bathrooms, floor, total_floors, gallery_images, photo_visibility, address_visibility')
      .eq('property_id', propertyId).maybeSingle(),
    sb.from('property_photos').select('storage_path, public_url, is_cover, display_order, visibility').eq('property_id', propertyId),
    sb.from('property_market_segments').select('segment').eq('property_id', propertyId).maybeSingle(),
  ]);

  /* Photos only when the owner made them public; the address only when it is FULL. */
  const photosPublic = !f?.photo_visibility || f.photo_visibility === 'PUBLIC';
  const keys = photosPublic
    ? galleryImages({
      coverPhotoUrl: p.cover_photo_url as string | null,
      photos: ((photos ?? []) as Array<Record<string, unknown>>)
        .filter((r) => !r.visibility || r.visibility === 'PUBLIC')
        .map((r) => ({
          storage_path: r.storage_path as string | null, public_url: r.public_url as string | null,
          is_cover: r.is_cover as boolean | null, display_order: r.display_order as number | null,
        })),
      galleryImages: Array.isArray(f?.gallery_images) ? f!.gallery_images as string[] : [],
    }).slice(0, MAX_IMAGES)
    : [];

  const images: string[] = [];
  for (const key of keys) {
    if (/^https:\/\//i.test(key)) { images.push(key); continue; }
    if (/^(http:|data:|blob:)/i.test(key) || key.startsWith('users/')) continue; // not email-safe / R2-only
    const { data: signed } = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(toSupabasePath(key), EMAIL_IMAGE_SECONDS);
    if (signed?.signedUrl) images.push(signed.signedUrl);
  }

  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  return {
    propertyId,
    segment: (seg?.segment as string | null) ?? null,
    data: {
      title: (p.title as string | null) ?? null,
      homatchId: num(p.homatch_id),
      transactionType: (p.transaction_type as string | null) ?? null,
      propertyType: (p.property_type as string | null) ?? null,
      city: (f?.city as string | null) ?? null,
      district: f?.address_visibility === 'HIDDEN' ? null : ((f?.district as string | null) ?? null),
      address: !f?.address_visibility || f.address_visibility === 'FULL' ? ((f?.address as string | null) ?? null) : null,
      price: num(f?.total_price),
      currency: (f?.currency as string | null) ?? null,
      area: num(f?.area),
      rooms: num(f?.rooms),
      bedrooms: num(f?.bedrooms),
      bathrooms: num(f?.bathrooms),
      floor: num(f?.floor),
      totalFloors: num(f?.total_floors),
      images,
    },
  };
}

/** The facts an AI draft may use — exactly these, nothing else. */
function draftFacts(p: LoadedProperty) {
  const d = p.data;
  return {
    title: d.title, transactionType: d.transactionType, propertyType: d.propertyType,
    city: d.city, district: d.district, price: d.price, currency: d.currency, area: d.area,
    rooms: d.rooms, bedrooms: d.bedrooms, bathrooms: d.bathrooms, floor: d.floor, totalFloors: d.totalFloors,
    photos: d.images.length, marketSegment: p.segment,
  };
}

/* ── can we send at all? ──────────────────────────────────────────────────── */

type Gate =
  | { ok: true; adapter: ReturnType<typeof getEmailAdapter>; unitPrice: number }
  | { ok: false; state: string };

const truthy = (v: unknown) => v === true || v === 'true';

async function sendingGate(sb: Sb): Promise<Gate> {
  const { data: rows } = await sb.from('admin_settings').select('key, value').in('key', [
    'email_studio_sending_enabled', 'provider_kill_switch', 'outreach_email_provider', 'outreach_email_price_per_1k',
  ]);
  const s = Object.fromEntries((rows ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  if (!truthy(s['email_studio_sending_enabled'])) return { ok: false, state: 'SENDING_DISABLED' };
  if (truthy(s['provider_kill_switch'])) return { ok: false, state: 'PROVIDER_KILL_SWITCH' };
  if ((await loadDisabledProviders(sb)).has('RESEND')) return { ok: false, state: 'PROVIDER_DISABLED' };
  const provider = String(s['outreach_email_provider'] ?? 'RESEND').replace(/"/g, '');
  const adapter = getEmailAdapter(true, provider);
  // The factory falls back to the mock adapter without a key. That is a refusal
  // here, never a simulated send recorded as real.
  if (adapter.provider !== 'RESEND') return { ok: false, state: 'PROVIDER_NOT_CONFIGURED' };
  const cap = await checkSpendCap(sb, 'RESEND');
  if (!cap.allowed) return { ok: false, state: 'SPEND_CAP_REACHED' };
  const perK = Number(s['outreach_email_price_per_1k'] ?? 0.5);
  return { ok: true, adapter, unitPrice: (Number.isFinite(perK) ? perK : 0.5) / 1000 };
}

async function sender(sb: Sb, owner: Owner): Promise<{ fromName: string; fromAddress: string; replyTo: string | null; replyToKind: 'INBOX' | 'ACCOUNT_EMAIL' | 'NONE' }> {
  /* Replies must reach somebody. The sending domain has no MX, so a connected
     HOMATCH inbound address wins; otherwise the seller's own account address,
     which the seller sees in the review before approving. */
  const { data: inbound } = await sb.from('comm_channel_accounts')
    .select('provider_account_id').eq('owner_id', owner.authId).eq('channel', 'EMAIL').eq('status', 'CONNECTED')
    .limit(1).maybeSingle();
  const inbox = (inbound as { provider_account_id?: string } | null)?.provider_account_id ?? null;
  return {
    fromName: `${owner.displayName} via HOMATCH`,
    fromAddress: 'no-reply@auth.homatch.live',
    replyTo: inbox ?? owner.email,
    replyToKind: inbox ? 'INBOX' : owner.email ? 'ACCOUNT_EMAIL' : 'NONE',
  };
}

async function unsubscribeUrl(recipientId: string): Promise<string> {
  const token = await signUnsubscribeToken(`email-studio:${recipientId}`, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1/email-webhook?esu=${encodeURIComponent(recipientId)}&t=${token}`;
}

async function recordCost(sb: Sb, row: Record<string, unknown>): Promise<void> {
  const { error } = await sb.from('cost_events').insert({ source: 'outreach-send:email-studio', cache_hit: false, ...row });
  if (error) logEvent('email-studio', 'cost_record_failed', { error: redact(error.message) });
}

/* ── the router ───────────────────────────────────────────────────────────── */

export async function handleStudioAction(req: Request, body: Record<string, unknown>): Promise<Response> {
  try {
    const caller = await authenticate(req);
    if (!caller) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
    const sb = serviceClient();
    const owner = await loadOwner(sb, caller.userId);
    if (!owner) return json({ ok: false, error: 'ACCOUNT_UNAVAILABLE' }, 403);

    switch (body.action) {
      case 'studio_render': return await actionRender(sb, owner, body);
      case 'studio_generate': return await actionGenerate(sb, owner, body);
      case 'studio_review': return await actionReview(sb, caller.sb as unknown as Sb, owner, body);
      case 'studio_test': return await actionTest(sb, owner, body);
      case 'studio_send': return await actionSend(sb, owner, body);
      default: return json({ ok: false, error: 'UNKNOWN_ACTION' }, 400);
    }
  } catch (e) {
    logEvent('email-studio', 'action_failed', { action: String(body.action ?? ''), error: redact((e as Error)?.message) });
    return json({ ok: false, error: 'INTERNAL' }, 500);
  }
}

function templateOf(v: unknown): TemplateId {
  return isTemplateId(v) ? v : 'PROPERTY_INTRODUCTION';
}

async function actionRender(sb: Sb, owner: Owner, body: Record<string, unknown>): Promise<Response> {
  const property = await loadProperty(sb, owner.id, String(body.propertyId ?? ''));
  if (!property) return json({ ok: false, error: 'PROPERTY_NOT_FOUND' }, 404);
  const templateId = templateOf(body.templateId);
  const lang = asEmailLang(body.language ?? owner.language);
  const content = body.content && typeof body.content === 'object' ? body.content : defaultContent(templateId, lang);
  const out = renderEmail({
    content, templateId, lang, property: property.data, preview: true, unsubscribeUrl: null,
    listingUrl: `${SITE}/property/${property.propertyId}`, senderName: `${owner.displayName} via HOMATCH`,
  });
  return json({
    ok: true, html: out.html, text: out.text, subject: out.subject, droppedImages: out.droppedImages,
    property: { ...property.data, segment: property.segment },
    templates: Object.fromEntries(TEMPLATE_IDS.map((id) => [id, templateAvailability(id, property.segment)])),
  });
}

async function actionGenerate(sb: Sb, owner: Owner, body: Record<string, unknown>): Promise<Response> {
  const property = await loadProperty(sb, owner.id, String(body.propertyId ?? ''));
  if (!property) return json({ ok: false, error: 'PROPERTY_NOT_FOUND' }, 404);
  const templateId = templateOf(body.templateId);
  const lang = asEmailLang(body.language ?? owner.language);
  const fallback = TEMPLATE_COPY[templateId][lang];
  const templateCopy = { subject: fallback.headline, preheader: fallback.body.slice(0, 140), ...fallback };

  if (!llmAvailable()) return json({ ok: true, source: 'TEMPLATE', reason: 'AI_UNAVAILABLE', copy: templateCopy });
  const { count } = await sb.from('rate_limit_events').select('*', { count: 'exact', head: true })
    .eq('operation', 'email_studio_generate').eq('user_id', owner.id)
    .gte('created_at', new Date(Date.now() - 3_600_000).toISOString());
  if ((count ?? 0) >= 20) return json({ ok: true, source: 'TEMPLATE', reason: 'RATE_LIMITED', copy: templateCopy });
  await sb.from('rate_limit_events').insert({ operation: 'email_studio_generate', user_id: owner.id });

  const facts = draftFacts(property);
  const result = await callLlm({
    system: DRAFT_SYSTEM_PROMPT,
    user: JSON.stringify({
      language: lang, template: templateId, tone: templateId === 'PERSONAL_FOLLOW_UP' ? 'personal, first person' : 'professional',
      approvedExample: fallback, facts,
    }),
    json: true, maxTokens: 600, timeoutMs: 25_000,
  });
  if (result.ok) {
    const inCost = await estimatedProviderCost(sb, { provider: 'OPENAI', unit: 'INPUT_TOKEN', units: result.inputTokens, model: result.model });
    const outCost = await estimatedProviderCost(sb, { provider: 'OPENAI', unit: 'OUTPUT_TOKEN', units: result.outputTokens, model: result.model });
    const raw = inCost != null && outCost != null ? inCost + outCost : null;
    await recordCost(sb, {
      provider: 'OPENAI', operation_type: 'email_studio_generate', units: result.inputTokens + result.outputTokens,
      cost_usd: raw ?? 0, success: true, pricing_state: raw == null ? 'UNPRICED' : 'ESTIMATED',
    });
  }
  const draft = result.ok ? checkDraft(result.parsed, facts) : null;
  if (!draft) return json({ ok: true, source: 'TEMPLATE', reason: result.ok ? 'DRAFT_REJECTED' : 'AI_FAILED', copy: templateCopy });
  return json({ ok: true, source: 'AI', copy: draft });
}

async function loadCampaign(sb: Sb, ownerId: string, campaignId: unknown) {
  if (typeof campaignId !== 'string' || !/^[0-9a-f-]{36}$/i.test(campaignId)) return null;
  const { data } = await sb.from('email_studio_campaigns').select('*').eq('id', campaignId).eq('owner_user_id', ownerId).maybeSingle();
  return data as null | {
    id: string; property_id: string | null; template_id: string; language: string; content: unknown; status: string; reviewed_hash: string | null;
  };
}

async function actionReview(sb: Sb, callerSb: Sb, owner: Owner, body: Record<string, unknown>): Promise<Response> {
  const campaign = await loadCampaign(sb, owner.id, body.campaignId);
  if (!campaign) return json({ ok: false, error: 'CAMPAIGN_NOT_FOUND' }, 404);
  const property = campaign.property_id ? await loadProperty(sb, owner.id, campaign.property_id) : null;
  if (!property) return json({ ok: false, error: 'PROPERTY_NOT_FOUND' }, 404);
  const templateId = templateOf(campaign.template_id);
  if (!templateAvailability(templateId, property.segment).available) return json({ ok: false, error: 'TEMPLATE_UNAVAILABLE' }, 422);
  const content = normalizeContent(campaign.content, property.data.images.length);
  if (!content.subject.trim()) return json({ ok: false, error: 'SUBJECT_REQUIRED' }, 422);

  // The owner RPC under the caller's own token: ownership is checked in Postgres.
  const { data: review, error } = await callerSb.rpc('email_studio_review', { p_campaign_id: campaign.id });
  if (error) return json({ ok: false, error: 'REVIEW_FAILED', detail: error.message }, 422);
  const gate = await sendingGate(sb);
  return json({
    ok: true, ...(review as Record<string, unknown>),
    sender: await sender(sb, owner),
    sendingState: gate.ok ? 'READY' : gate.state,
    droppedImages: renderEmail({
      content, templateId, lang: campaign.language, property: property.data, preview: true, unsubscribeUrl: null,
      listingUrl: `${SITE}/property/${property.propertyId}`, senderName: owner.displayName,
    }).droppedImages,
  });
}

async function actionTest(sb: Sb, owner: Owner, body: Record<string, unknown>): Promise<Response> {
  const campaign = await loadCampaign(sb, owner.id, body.campaignId);
  if (!campaign) return json({ ok: false, error: 'CAMPAIGN_NOT_FOUND' }, 404);
  const gate = await sendingGate(sb);
  if (!gate.ok) return json({ ok: false, state: gate.state });
  if (!owner.email) return json({ ok: false, error: 'NO_ACCOUNT_EMAIL' }, 422);
  const property = campaign.property_id ? await loadProperty(sb, owner.id, campaign.property_id) : null;
  if (!property) return json({ ok: false, error: 'PROPERTY_NOT_FOUND' }, 404);
  const { data: allowed } = await sb.rpc('email_studio_record_test', { p_owner: owner.id, p_campaign_id: campaign.id });
  if (allowed !== true) return json({ ok: false, error: 'TEST_LIMIT_REACHED' }, 429);

  const from = await sender(sb, owner);
  const lang = asEmailLang(campaign.language);
  /* The test goes to the seller themself, not to a lead: there is no recipient
     row to sign, so the footer link points at their own settings. A real
     campaign email always gets the signed per-recipient link (actionSend). */
  const out = renderEmail({
    content: campaign.content, templateId: templateOf(campaign.template_id), lang, property: property.data,
    listingUrl: `${SITE}/property/${property.propertyId}`, senderName: owner.displayName,
    unsubscribeUrl: `${SITE}/settings`,
  });
  const result = await gate.adapter.send({
    to: owner.email, subject: `[TEST] ${out.subject}`, html: out.html, text: out.text,
    from_name: from.fromName, from_email: from.fromAddress, reply_to: from.replyTo ?? undefined,
  });
  if (!result.is_mock) {
    await recordCost(sb, {
      provider: 'RESEND', operation_type: 'EMAIL_STUDIO_TEST', units: 1,
      cost_usd: result.success ? gate.unitPrice : 0, success: result.success, pricing_state: 'ESTIMATED',
    });
  }
  if (!result.success) return json({ ok: false, error: 'PROVIDER_ERROR' }, 502);
  const masked = owner.email.replace(/^(.).*(@.*)$/, '$1***$2');
  return json({ ok: true, sentTo: masked });
}

async function actionSend(sb: Sb, owner: Owner, body: Record<string, unknown>): Promise<Response> {
  if (body.approved !== true) return json({ ok: false, error: 'APPROVAL_REQUIRED' }, 422);
  const campaign = await loadCampaign(sb, owner.id, body.campaignId);
  if (!campaign) return json({ ok: false, error: 'CAMPAIGN_NOT_FOUND' }, 404);

  const gate = await sendingGate(sb);
  if (!gate.ok) return json({ ok: false, state: gate.state });

  const property = campaign.property_id ? await loadProperty(sb, owner.id, campaign.property_id) : null;
  if (!property) return json({ ok: false, error: 'PROPERTY_NOT_FOUND' }, 404);
  const templateId = templateOf(campaign.template_id);
  if (!templateAvailability(templateId, property.segment).available) return json({ ok: false, error: 'TEMPLATE_UNAVAILABLE' }, 422);

  const { data: begin, error: beginErr } = await sb.rpc('email_studio_begin_send', {
    p_owner: owner.id, p_campaign_id: campaign.id, p_version_hash: String(body.versionHash ?? ''),
  });
  if (beginErr) throw new Error(beginErr.message);
  if (begin !== 'OK') return json({ ok: false, state: begin });

  const { data: claim, error: claimErr } = await sb.rpc('email_studio_claim_recipients', {
    p_owner: owner.id, p_campaign_id: campaign.id, p_limit: SEND_BATCH,
  });
  if (claimErr) throw new Error(claimErr.message);
  const c = claim as { claimed?: Array<Record<string, string | null>>; skipped?: number; capRemaining?: number; remaining?: number; error?: string };
  if (c.error) return json({ ok: false, state: c.error });

  const from = await sender(sb, owner);
  const lang = asEmailLang(campaign.language);
  let sent = 0, failed = 0;

  for (const r of c.claimed ?? []) {
    const recipientId = String(r.recipientId);
    /* The call to action opens the canonical HOMATCH conversation with this
       seller about this listing — the place a reply belongs. */
    const { data: conv } = await sb.rpc('ensure_conversation', {
      p_initiator: owner.id, p_recipient: r.leadUserId, p_property: property.propertyId,
    });
    const listingUrl = conv ? `${SITE}/chat?conversation=${encodeURIComponent(String(conv))}` : `${SITE}/find-property`;
    let ok = false; let messageId: string | null = null; let err: string | null = null; let isMock = false;
    try {
      const out = renderEmail({
        content: campaign.content, templateId, lang, property: property.data, listingUrl,
        senderName: owner.displayName, unsubscribeUrl: await unsubscribeUrl(recipientId),
      });
      const result = await gate.adapter.send({
        to: String(r.email), subject: out.subject, html: out.html, text: out.text,
        from_name: from.fromName, from_email: from.fromAddress, reply_to: from.replyTo ?? undefined,
        campaign_id: campaign.id,
      });
      ok = result.success && !result.is_mock;
      isMock = result.is_mock;
      messageId = result.provider_message_id ?? null;
      err = result.success ? (result.is_mock ? 'MOCK_ADAPTER_REFUSED' : null) : (result.error ?? 'PROVIDER_ERROR');
    } catch (e) {
      err = String((e as Error)?.message ?? e).slice(0, 300);
    }
    const cost = ok ? gate.unitPrice : 0;
    await sb.rpc('email_studio_mark_sent', {
      p_recipient_id: recipientId, p_success: ok, p_provider: isMock ? 'MOCK' : 'RESEND',
      p_provider_message_id: messageId, p_error: err ? redact(err) : null, p_cost_usd: cost,
    });
    if (!isMock) {
      await recordCost(sb, { provider: 'RESEND', operation_type: 'EMAIL_STUDIO_SEND', units: 1, cost_usd: cost, success: ok, pricing_state: 'ESTIMATED' });
    }
    if (ok) sent++; else failed++;
  }

  const { data: status } = await sb.rpc('email_studio_finish_send', { p_campaign_id: campaign.id });
  const remaining = Number(c.remaining ?? 0);
  logEvent('email-studio', 'batch_sent', { sent, failed, skipped: c.skipped ?? 0, remaining });
  return json({
    ok: true, sent, failed, skipped: c.skipped ?? 0, remaining,
    capRemaining: c.capRemaining ?? 0,
    state: remaining > 0 && (c.capRemaining ?? 0) <= 0 ? 'DAILY_CAP_REACHED' : (status ?? 'SENDING'),
  });
}
