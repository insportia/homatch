// PROPERTY CONVERSATIONS — the AI helpers behind send-message's `action` requests.
//
//   translate_draft    the sender's draft → the recipient's language. Returns text; never sends.
//   translate_message  a message in the conversation → the reader's language, cached.
//   assist             approved templates filled from VERIFIED listing data; `improve` and
//                      `translation_ready` use the model under a no-new-facts prompt, and a
//                      rewrite that introduces a number or currency sign is thrown away.
//   transcribe         a voice message → text (OpenAI transcription), cached; optionally
//                      translated. No voice-to-voice anything.
//
// Every caller is a participant of the conversation, checked here with the service role.
// Every model call is rate-limited per user (fail closed: these spend money) and booked in
// cost_events at measured tokens/seconds; a rate the price book does not hold is UNPRICED,
// never $0-as-fact. Without OPENAI_API_KEY every action answers TRANSLATION_UNAVAILABLE.

import { callLlm, llmAvailable } from './comm/llm.ts';
import { transcribeSpeech, transcriptionAvailable } from './comm/transcribe.ts';
import { estimatedProviderCost } from './providerCost.ts';
import {
  AI_RATE_LIMIT, ASSIST_MODES, LANGUAGE_NAMES, assistSystemPrompt, isUuid, rewriteIntroducesFacts,
  translateSystemPrompt, type AssistMode,
} from './propertyChat.ts';
import { DM_MAX_BODY_CHARS, DM_MEDIA_BUCKET, baseMime, detectChatLanguage, isChatLanguage } from '../../../src/chat/conversation.ts';
import { fillTemplate, type OfferFacts } from '../../../src/chat/templates.ts';

// deno-lint-ignore no-explicit-any
type Db = any;
export interface AiResult { status: number; body: Record<string, unknown> }

export const CHAT_AI_ACTIONS = ['translate_draft', 'translate_message', 'assist', 'transcribe'] as const;
export type ChatAiAction = (typeof CHAT_AI_ACTIONS)[number];
export const isChatAiAction = (a: unknown): a is ChatAiAction =>
  typeof a === 'string' && (CHAT_AI_ACTIONS as readonly string[]).includes(a);

const ok = (body: Record<string, unknown>): AiResult => ({ status: 200, body });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): AiResult => ({ status, body: { error, ...extra } });
const UNAVAILABLE = (): AiResult => ok({ error: 'TRANSLATION_UNAVAILABLE' });

async function consumeAiQuota(db: Db, userId: string): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const L = AI_RATE_LIMIT;
  try {
    const { data, error } = await db.rpc('consume_marketplace_rate_limit', {
      p_user_id: userId, p_operation: L.operation, p_burst_limit: L.burstLimit, p_burst_seconds: L.burstSeconds,
      p_daily_limit: L.dailyLimit, p_daily_seconds: L.dailySeconds,
    });
    if (error || !data) return { allowed: false, retryAfterSeconds: 60 };
    if (data.allowed === true) return { allowed: true };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.trunc(Number(data.retry_after_seconds)) || 60) };
  } catch {
    return { allowed: false, retryAfterSeconds: 60 };
  }
}

/** One cost_events row at measured usage. Unpriced stays UNPRICED (cost_usd 0 + the state that says so). */
async function bookTokens(db: Db, operation: string, r: { ok: boolean; inputTokens: number; outputTokens: number; model: string }) {
  if (r.inputTokens + r.outputTokens <= 0) return { costUsd: null as number | null, pricingState: null as string | null };
  const inCost = await estimatedProviderCost(db, { provider: 'OPENAI', unit: 'INPUT_TOKEN', units: r.inputTokens, model: r.model });
  const outCost = await estimatedProviderCost(db, { provider: 'OPENAI', unit: 'OUTPUT_TOKEN', units: r.outputTokens, model: r.model });
  const cost = inCost !== null && outCost !== null ? inCost + outCost : null;
  const pricingState = cost === null ? 'UNPRICED' : 'ESTIMATED';
  await db.from('cost_events').insert({
    provider: 'OPENAI', operation_type: operation, source: 'send-message',
    units: r.inputTokens + r.outputTokens, cost_usd: cost ?? 0, success: r.ok, cache_hit: false, pricing_state: pricingState,
  }).then(() => undefined, () => undefined);
  return { costUsd: cost, pricingState };
}

async function bookAudio(db: Db, seconds: number, model: string, success: boolean) {
  const units = Math.max(0, Math.ceil(seconds));
  if (units <= 0) return { costUsd: null as number | null, pricingState: null as string | null };
  const cost = await estimatedProviderCost(db, { provider: 'OPENAI', unit: 'AUDIO_SECOND', units, model });
  const pricingState = cost === null ? 'UNPRICED' : 'ESTIMATED';
  await db.from('cost_events').insert({
    provider: 'OPENAI', operation_type: 'CHAT_TRANSCRIBE', source: 'send-message',
    units, cost_usd: cost ?? 0, success, cache_hit: false, pricing_state: pricingState,
  }).then(() => undefined, () => undefined);
  return { costUsd: cost, pricingState };
}

interface ConvRow { id: string; initiator_id: string; recipient_id: string; property_id: string | null }

async function participantConversation(db: Db, conversationId: unknown, meId: string): Promise<ConvRow | null> {
  if (!isUuid(conversationId)) return null;
  const { data } = await db.from('conversations').select('id,initiator_id,recipient_id,property_id').eq('id', conversationId).maybeSingle();
  if (!data || (data.initiator_id !== meId && data.recipient_id !== meId)) return null;
  return data as ConvRow;
}

async function participantMessage(db: Db, messageId: unknown, meId: string) {
  if (!isUuid(messageId)) return null;
  const { data: m } = await db.from('messages')
    .select('id,conversation_id,sender_id,body,kind,media_path,media_meta,original_body,original_lang')
    .eq('id', messageId).maybeSingle();
  if (!m) return null;
  const conv = await participantConversation(db, m.conversation_id, meId);
  return conv ? { message: m, conv } : null;
}

async function preferredLanguage(db: Db, userId: string): Promise<string | null> {
  const { data } = await db.from('users').select('preferred_language').eq('id', userId).maybeSingle();
  const l = String(data?.preferred_language ?? '').toLowerCase().slice(0, 2);
  return isChatLanguage(l) ? l : null;
}

/** One model translation, booked. */
async function translateText(db: Db, text: string, sourceLang: string, targetLang: string) {
  const res = await callLlm({
    system: translateSystemPrompt(LANGUAGE_NAMES[sourceLang] ?? 'the original language', LANGUAGE_NAMES[targetLang]),
    user: text, json: true, maxTokens: Math.min(3000, 300 + text.length * 2),
  });
  const booked = await bookTokens(db, 'CHAT_TRANSLATE', res);
  const parsed = res.parsed as { translation?: unknown } | null;
  const translation = typeof parsed?.translation === 'string' ? parsed.translation.trim().slice(0, 8000) : '';
  return { translation: res.ok && translation ? translation : null, model: res.model, ...booked };
}

/* ── translate_draft ─────────────────────────────────────────────────────── */

async function translateDraft(db: Db, meId: string, body: Record<string, unknown>): Promise<AiResult> {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return fail(400, 'TEXT_REQUIRED');
  if (text.length > DM_MAX_BODY_CHARS) return fail(400, 'MESSAGE_TOO_LONG');
  let target: string | null = typeof body.targetLang === 'string' && isChatLanguage(body.targetLang) ? body.targetLang : null;
  if (!target && body.conversationId) {
    const conv = await participantConversation(db, body.conversationId, meId);
    if (!conv) return fail(404, 'Conversation not found');
    target = await preferredLanguage(db, conv.initiator_id === meId ? conv.recipient_id : conv.initiator_id);
  }
  if (!target) return fail(400, 'TARGET_LANGUAGE_UNKNOWN');
  const source = detectChatLanguage(text);
  if (source === target) return ok({ sourceLang: source, targetLang: target, translation: text, sameLanguage: true });
  if (!llmAvailable()) return UNAVAILABLE();
  const quota = await consumeAiQuota(db, meId);
  if (!quota.allowed) return fail(429, 'RATE_LIMITED', { retryAfterSeconds: quota.retryAfterSeconds });
  const r = await translateText(db, text, source ?? 'auto', target);
  if (!r.translation) return UNAVAILABLE();
  return ok({ sourceLang: source, targetLang: target, translation: r.translation, sameLanguage: false });
}

/* ── translate_message ───────────────────────────────────────────────────── */

async function translateMessage(db: Db, meId: string, body: Record<string, unknown>): Promise<AiResult> {
  const found = await participantMessage(db, body.messageId, meId);
  if (!found) return fail(404, 'Message not found');
  const target = typeof body.targetLang === 'string' && isChatLanguage(body.targetLang)
    ? body.targetLang : await preferredLanguage(db, meId);
  if (!target) return fail(400, 'TARGET_LANGUAGE_UNKNOWN');
  const m = found.message;
  const text = String(m.body ?? '').trim();
  if (!text) return fail(400, 'NOTHING_TO_TRANSLATE');
  /* The sender wrote it in the reader's language and approved a translation: the
     original IS the reader's text, at no cost and with no model in between. */
  if (m.original_body && m.original_lang === target) {
    return ok({ messageId: m.id, targetLang: target, sourceLang: m.original_lang, translation: m.original_body, original: true });
  }
  const source = detectChatLanguage(text);
  if (source === target) return ok({ messageId: m.id, targetLang: target, sourceLang: source, translation: text, sameLanguage: true });

  const { data: cached } = await db.from('message_translations').select('text,source_lang')
    .eq('message_id', m.id).eq('kind', 'TRANSLATION').eq('target_lang', target).maybeSingle();
  if (cached) return ok({ messageId: m.id, targetLang: target, sourceLang: cached.source_lang, translation: cached.text, cached: true });

  if (!llmAvailable()) return UNAVAILABLE();
  const quota = await consumeAiQuota(db, meId);
  if (!quota.allowed) return fail(429, 'RATE_LIMITED', { retryAfterSeconds: quota.retryAfterSeconds });
  const r = await translateText(db, text, source ?? 'auto', target);
  if (!r.translation) return UNAVAILABLE();
  await db.from('message_translations').upsert({
    message_id: m.id, kind: 'TRANSLATION', target_lang: target, source_lang: source, text: r.translation,
    model: r.model, cost_usd: r.costUsd, pricing_state: r.pricingState,
  }, { onConflict: 'message_id,kind,target_lang', ignoreDuplicates: true });
  return ok({ messageId: m.id, targetLang: target, sourceLang: source, translation: r.translation, cached: false });
}

/* ── assist ──────────────────────────────────────────────────────────────── */

/** The listing's own facts, only when the caller owns it and it is live. */
async function verifiedOfferFacts(db: Db, meId: string, propertyId: string): Promise<OfferFacts | null> {
  const { data: p } = await db.from('properties').select('id,user_id,is_deleted,archived_at').eq('id', propertyId).maybeSingle();
  if (!p || p.user_id !== meId || p.is_deleted || p.archived_at) return null;
  const { data: f } = await db.from('property_facts').select('city,district,total_price,currency,bedrooms,area')
    .eq('property_id', propertyId).limit(1).maybeSingle();
  return {
    city: f?.city ?? null, district: f?.district ?? null, bedrooms: f?.bedrooms ?? null,
    area: f?.area == null ? null : Number(f.area), price: f?.total_price == null ? null : Number(f.total_price),
    currency: f?.currency ?? null,
  };
}

async function assist(db: Db, meId: string, body: Record<string, unknown>): Promise<AiResult> {
  const mode = body.mode as AssistMode;
  if (!ASSIST_MODES.includes(mode)) return fail(400, 'INVALID_MODE');
  const lang = typeof body.lang === 'string' && isChatLanguage(body.lang) ? body.lang : 'en';

  if (mode === 'introduction' || mode === 'follow_up' || mode === 'viewing') {
    return ok({ mode, lang, draft: fillTemplate(mode, lang), source: 'TEMPLATE' });
  }
  if (mode === 'offer') {
    let propertyId = isUuid(body.propertyId) ? body.propertyId : null;
    if (!propertyId && body.conversationId) {
      const conv = await participantConversation(db, body.conversationId, meId);
      propertyId = conv?.property_id ?? null;
    }
    if (!propertyId) return fail(400, 'PROPERTY_REQUIRED');
    const facts = await verifiedOfferFacts(db, meId, propertyId);
    if (!facts) return fail(403, 'PROPERTY_NOT_YOURS');
    return ok({ mode, lang, draft: fillTemplate('offer', lang, facts), source: 'TEMPLATE' });
  }

  const draft = typeof body.draft === 'string' ? body.draft.trim() : '';
  if (!draft) return fail(400, 'TEXT_REQUIRED');
  if (draft.length > DM_MAX_BODY_CHARS) return fail(400, 'MESSAGE_TOO_LONG');
  if (!llmAvailable()) return ok({ error: 'AI_UNAVAILABLE' });
  const quota = await consumeAiQuota(db, meId);
  if (!quota.allowed) return fail(429, 'RATE_LIMITED', { retryAfterSeconds: quota.retryAfterSeconds });
  const written = detectChatLanguage(draft) ?? lang;
  const res = await callLlm({
    system: assistSystemPrompt(mode, LANGUAGE_NAMES[written] ?? 'the original language'),
    user: draft, json: true, maxTokens: Math.min(3000, 300 + draft.length * 2),
  });
  await bookTokens(db, 'CHAT_ASSIST', res);
  const parsed = res.parsed as { draft?: unknown } | null;
  const out = typeof parsed?.draft === 'string' ? parsed.draft.trim() : '';
  if (!res.ok || !out) return ok({ error: 'AI_UNAVAILABLE' });
  /* The guarantee the UI promises: no new facts. A rewrite that brings a figure the
     writer never wrote is discarded, and the writer keeps their own text. */
  if (rewriteIntroducesFacts(draft, out)) return ok({ error: 'AI_REWRITE_REJECTED' });
  return ok({ mode, lang: written, draft: out.slice(0, DM_MAX_BODY_CHARS), source: 'AI' });
}

/* ── transcribe ──────────────────────────────────────────────────────────── */

async function transcribe(db: Db, meId: string, body: Record<string, unknown>): Promise<AiResult> {
  const found = await participantMessage(db, body.messageId, meId);
  if (!found) return fail(404, 'Message not found');
  const m = found.message;
  if (m.kind !== 'VOICE' || !m.media_path) return fail(400, 'NOT_A_VOICE_MESSAGE');
  const target = typeof body.targetLang === 'string' && isChatLanguage(body.targetLang) ? body.targetLang : null;

  let transcript: string | null = null;
  let spoken: string | null = null;
  const { data: cached } = await db.from('message_translations').select('text,source_lang')
    .eq('message_id', m.id).eq('kind', 'TRANSCRIPT').eq('target_lang', '').maybeSingle();
  if (cached) {
    transcript = cached.text;
    spoken = cached.source_lang ?? null;
  } else {
    if (!transcriptionAvailable()) return UNAVAILABLE();
    const quota = await consumeAiQuota(db, meId);
    if (!quota.allowed) return fail(429, 'RATE_LIMITED', { retryAfterSeconds: quota.retryAfterSeconds });
    const { data: blob, error } = await db.storage.from(DM_MEDIA_BUCKET).download(m.media_path);
    if (error || !blob) return fail(404, 'MEDIA_NOT_FOUND');
    const audio = new Uint8Array(await blob.arrayBuffer());
    const meta = (m.media_meta ?? {}) as Record<string, unknown>;
    const res = await transcribeSpeech({ audio, mime: baseMime(String(meta.mime ?? 'audio/webm')) || 'audio/webm' });
    const seconds = typeof meta.duration_seconds === 'number' ? meta.duration_seconds : 0;
    const booked = await bookAudio(db, seconds, res.model, res.ok);
    if (!res.ok) return UNAVAILABLE();
    transcript = (res.text ?? '').trim();
    if (!transcript) return ok({ messageId: m.id, transcript: '', empty: true });
    spoken = detectChatLanguage(transcript) ?? (res.language && isChatLanguage(res.language) ? res.language : null);
    await db.from('message_translations').upsert({
      message_id: m.id, kind: 'TRANSCRIPT', target_lang: '', source_lang: spoken, text: transcript.slice(0, 8000),
      model: res.model, cost_usd: booked.costUsd, pricing_state: booked.pricingState,
    }, { onConflict: 'message_id,kind,target_lang', ignoreDuplicates: true });
  }

  if (!target || !transcript || spoken === target) {
    return ok({ messageId: m.id, transcript, sourceLang: spoken });
  }
  /* The translated transcript is a TEXT translation of the transcript — cached per
     language like any other — never a synthesised voice. */
  const { data: tr } = await db.from('message_translations').select('text')
    .eq('message_id', m.id).eq('kind', 'TRANSLATION').eq('target_lang', target).maybeSingle();
  if (tr) return ok({ messageId: m.id, transcript, sourceLang: spoken, translation: tr.text, targetLang: target });
  if (!llmAvailable()) return ok({ messageId: m.id, transcript, sourceLang: spoken, translationError: 'TRANSLATION_UNAVAILABLE' });
  const quota = await consumeAiQuota(db, meId);
  if (!quota.allowed) return ok({ messageId: m.id, transcript, sourceLang: spoken, translationError: 'RATE_LIMITED' });
  const r = await translateText(db, transcript, spoken ?? 'auto', target);
  if (!r.translation) return ok({ messageId: m.id, transcript, sourceLang: spoken, translationError: 'TRANSLATION_UNAVAILABLE' });
  await db.from('message_translations').upsert({
    message_id: m.id, kind: 'TRANSLATION', target_lang: target, source_lang: spoken, text: r.translation,
    model: r.model, cost_usd: r.costUsd, pricing_state: r.pricingState,
  }, { onConflict: 'message_id,kind,target_lang', ignoreDuplicates: true });
  return ok({ messageId: m.id, transcript, sourceLang: spoken, translation: r.translation, targetLang: target });
}

/** The router send-message calls for any body carrying an AI `action`. */
export async function handleChatAi(db: Db, meId: string, action: ChatAiAction, body: Record<string, unknown>): Promise<AiResult> {
  switch (action) {
    case 'translate_draft': return translateDraft(db, meId, body);
    case 'translate_message': return translateMessage(db, meId, body);
    case 'assist': return assist(db, meId, body);
    case 'transcribe': return transcribe(db, meId, body);
  }
}
