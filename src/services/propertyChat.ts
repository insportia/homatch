// PROPERTY CONVERSATIONS — the browser's side of direct messages.
//
// Every send goes through the send-message edge function (rate limit, block check, offer
// cap, server-built property cards); the client never inserts a message row. Media goes
// to the private dm-media bucket under {me}/{conversation}/ first, then the message
// references it. AI help (translate, assist, transcribe) is the same function with an
// `action` — it returns text and never sends anything on the person's behalf.

import { supabase } from '@/db/supabase';
import {
  DM_IMAGE_MIME, DM_MAX_MEDIA_BYTES, DM_MEDIA_BUCKET, DM_VOICE_MAX_SECONDS, baseMime, dmMediaPath,
  type MessageKind,
} from '@/chat/conversation';
import type { AssistTemplateMode } from '@/chat/templates';

export interface PropertyCardSnapshot {
  id: string; homatch_id: number | null; title: string | null; price: number | null; currency: string | null;
  city: string | null; district: string | null; bedrooms: number | null; area: number | null; cover: string | null;
  transaction_type?: string | null; property_type?: string | null;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  status: 'SENDING' | 'SENT' | 'DELIVERED' | 'SEEN' | 'FAILED';
  created_at: string;
  delivered_at?: string | null;
  seen_at?: string | null;
  kind: MessageKind;
  media_path?: string | null;
  media_meta?: { mime?: string; size?: number; duration_seconds?: number; width?: number; height?: number } | null;
  reply_to_id?: string | null;
  property_card?: PropertyCardSnapshot | null;
  original_body?: string | null;
  original_lang?: string | null;
  translated_to?: string | null;
  client_message_id?: string | null;
  /** Client-only: what to resend when a send failed. */
  _retry?: SendInput | null;
  /** Client-only: a local preview URL for an optimistic photo/voice. */
  _localUrl?: string | null;
}

export interface ChatConversation {
  id: string;
  property_id: string | null;
  initiator_id: string;
  recipient_id: string;
  status: string;
  initiator_muted: boolean;
  recipient_muted: boolean;
  last_message_at: string | null;
  created_at: string;
  counterpart: { id: string; name: string | null; avatar_url: string | null };
  last_message: Pick<ChatMessage, 'id' | 'body' | 'status' | 'created_at' | 'sender_id' | 'kind'> | null;
  unread_count: number;
  muted_by_me: boolean;
}

export interface ConversationContext {
  conversationId: string;
  status: string;
  counterpart: { id: string; displayName: string | null; avatarUrl: string | null; preferredLanguage: string | null };
  myLanguage: string | null;
  property: {
    id: string; homatchId: number | null; title: string | null; city: string | null; district: string | null;
    price: number | null; currency: string | null; bedrooms: number | null; area: number | null; cover: string | null; isMine: boolean;
  } | null;
  mutedByMe: boolean;
  blockedByMe: boolean;
  blockedByThem: boolean;
  canSend: boolean;
  awaitingFirstReply: boolean;
  offerMessagesRemaining: number | null;
}

/** A refusal the UI can explain: the server's code plus, for rate limits, how long to wait. */
export class ChatActionError extends Error {
  code: string;
  status?: number;
  retryAfterSeconds?: number;
  constructor(code: string, status?: number, retryAfterSeconds?: number) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function callSendMessage<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('send-message', { body });
  if (error) {
    const context = (error as { context?: { status?: number; json?: () => Promise<unknown> } }).context;
    let payload: Record<string, unknown> | null = null;
    try { payload = (await context?.json?.()) as Record<string, unknown>; } catch { payload = null; }
    const retry = Number(payload?.retry_after_seconds ?? payload?.retryAfterSeconds);
    throw new ChatActionError(String(payload?.error ?? error.message ?? 'SEND_FAILED'), context?.status,
      Number.isFinite(retry) ? retry : undefined);
  }
  return data as T;
}

/* ── conversations & messages ─────────────────────────────────────────────── */

const firstName = (full: string | null | undefined): string | null => {
  const s = String(full ?? '').trim();
  return s ? s.split(/\s+/)[0] : null;
};

export async function getPropertyConversations(myId: string): Promise<ChatConversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select(`
      id,property_id,initiator_id,recipient_id,status,initiator_muted,recipient_muted,last_message_at,created_at,
      initiator:users!conversations_initiator_id_fkey(id,full_name,avatar_url),
      recipient:users!conversations_recipient_id_fkey(id,full_name,avatar_url),
      messages(id,body,status,created_at,sender_id,kind)
    `)
    .or(`initiator_id.eq.${myId},recipient_id.eq.${myId}`)
    .in('status', ['ACTIVE', 'MUTED', 'BLOCKED'])
    .order('last_message_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((c: Record<string, unknown>) => {
    const msgs = ((c.messages ?? []) as ChatConversation['last_message'][]).filter(Boolean) as NonNullable<ChatConversation['last_message']>[];
    msgs.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const mine = c.initiator_id === myId;
    const other = (mine ? c.recipient : c.initiator) as { id: string; full_name?: string | null; avatar_url?: string | null } | null;
    return {
      id: c.id as string,
      property_id: (c.property_id as string | null) ?? null,
      initiator_id: c.initiator_id as string,
      recipient_id: c.recipient_id as string,
      status: String(c.status),
      initiator_muted: !!c.initiator_muted,
      recipient_muted: !!c.recipient_muted,
      last_message_at: (c.last_message_at as string | null) ?? null,
      created_at: c.created_at as string,
      counterpart: { id: other?.id ?? (mine ? c.recipient_id : c.initiator_id) as string, name: firstName(other?.full_name), avatar_url: other?.avatar_url ?? null },
      last_message: msgs.length ? msgs[msgs.length - 1] : null,
      unread_count: msgs.filter((m) => m.sender_id !== myId && m.status !== 'SEEN').length,
      muted_by_me: mine ? !!c.initiator_muted : !!c.recipient_muted,
    };
  });
}

export async function getThreadMessages(conversationId: string, limit = 300): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as ChatMessage[]).reverse();
}

export async function getConversationContext(conversationId: string): Promise<ConversationContext> {
  const { data, error } = await supabase.rpc('my_conversation_context', { p_conversation_id: conversationId });
  if (error) throw error;
  return data as ConversationContext;
}

/** Read receipts with the caller's users.id (the RPC resolves it). Returns how many were marked. */
export async function markConversationSeen(conversationId: string): Promise<number> {
  const { data, error } = await supabase.rpc('mark_conversation_seen', { p_conversation_id: conversationId });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function setConversationMuted(conversationId: string, muted: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_conversation_muted', { p_conversation_id: conversationId, p_muted: muted });
  if (error) throw error;
  return !!data;
}

export async function blockConversationCounterpart(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('block_conversation_counterpart', { p_conversation_id: conversationId });
  if (error) throw error;
}

export async function unblockConversationCounterpart(conversationId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('unblock_conversation_counterpart', { p_conversation_id: conversationId });
  if (error) throw error;
  return !!data;
}

export interface CachedTranslation { messageId: string; kind: 'TRANSLATION' | 'TRANSCRIPT'; targetLang: string | null; sourceLang: string | null; text: string }

export async function getMessageTranslations(conversationId: string, targetLang: string): Promise<CachedTranslation[]> {
  const { data, error } = await supabase.rpc('my_message_translations', { p_conversation_id: conversationId, p_target_lang: targetLang });
  if (error) throw error;
  return (data ?? []) as CachedTranslation[];
}

/* ── sending ──────────────────────────────────────────────────────────────── */

export interface SendInput {
  conversationId: string;
  recipientId: string;
  clientMessageId: string;
  kind?: MessageKind;
  body?: string;
  replyToId?: string | null;
  /** PHOTO/VOICE: an already-uploaded dm-media path. */
  mediaPath?: string | null;
  mediaMeta?: Record<string, unknown> | null;
  /** PROPERTY: the id of one of the sender's own properties. Nothing else about it is sent. */
  cardPropertyId?: string | null;
  /** An approved translation: body is the translation, these record what was written. */
  originalBody?: string | null;
  originalLang?: string | null;
  translatedTo?: string | null;
}

export async function sendPropertyMessage(input: SendInput): Promise<ChatMessage> {
  const res = await callSendMessage<{ message: ChatMessage }>({
    conversation_id: input.conversationId,
    recipient_id: input.recipientId,
    client_message_id: input.clientMessageId,
    kind: input.kind ?? 'TEXT',
    body: input.body ?? '',
    reply_to_id: input.replyToId ?? null,
    media_path: input.mediaPath ?? null,
    media_meta: input.mediaMeta ?? null,
    card_property_id: input.cardPropertyId ?? null,
    original_body: input.originalBody ?? null,
    original_lang: input.originalLang ?? null,
    translated_to: input.translatedTo ?? null,
  });
  return res.message;
}

/** Upload one attachment under {me}/{conversation}/ — the only place the bucket accepts it. */
export async function uploadDmMedia(senderId: string, conversationId: string, blob: Blob): Promise<string> {
  if (blob.size > DM_MAX_MEDIA_BYTES) throw new ChatActionError('MEDIA_TOO_LARGE');
  const path = dmMediaPath(senderId, conversationId, crypto.randomUUID(), blob.type);
  const { error } = await supabase.storage.from(DM_MEDIA_BUCKET).upload(path, blob, {
    contentType: baseMime(blob.type) || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new ChatActionError('MEDIA_UPLOAD_FAILED');
  return path;
}

export function photoProblem(file: File): 'pc_photo_type' | 'pc_photo_too_large' | null {
  if (!(DM_IMAGE_MIME as readonly string[]).includes(baseMime(file.type))) return 'pc_photo_type';
  if (file.size > DM_MAX_MEDIA_BYTES) return 'pc_photo_too_large';
  return null;
}

export function voiceMeta(blob: Blob, seconds: number): Record<string, unknown> {
  const duration = Math.min(DM_VOICE_MAX_SECONDS, Math.round(seconds * 10) / 10);
  return { duration_seconds: duration, mime: baseMime(blob.type), size: blob.size };
}

const mediaUrlCache = new Map<string, { url: string; until: number }>();

/** Short-lived signed URL; the bucket is private and only participants may sign. */
export async function getDmMediaUrl(path: string): Promise<string> {
  const hit = mediaUrlCache.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(DM_MEDIA_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new ChatActionError('MEDIA_URL_FAILED');
  mediaUrlCache.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

/* ── the caller's own properties (Attach Property) ────────────────────────── */

export interface AttachableProperty {
  id: string; homatch_id: number | null; title: string | null; cover: string | null;
  city: string | null; district: string | null; price: number | null; currency: string | null;
}

export async function listAttachableProperties(myId: string): Promise<AttachableProperty[]> {
  const { data, error } = await supabase
    .from('properties')
    .select('id,homatch_id,title,cover_photo_url,property_facts(city,district,total_price,currency)')
    .eq('user_id', myId)
    .eq('is_deleted', false)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((p: Record<string, unknown>) => {
    const factsRaw = p.property_facts as Record<string, unknown> | Record<string, unknown>[] | null;
    const f = (Array.isArray(factsRaw) ? factsRaw[0] : factsRaw) ?? {};
    return {
      id: p.id as string,
      homatch_id: (p.homatch_id as number | null) ?? null,
      title: (p.title as string | null) ?? null,
      cover: (p.cover_photo_url as string | null) ?? null,
      city: (f.city as string | null) ?? null,
      district: (f.district as string | null) ?? null,
      price: f.total_price == null ? null : Number(f.total_price),
      currency: (f.currency as string | null) ?? null,
    };
  });
}

/* ── AI help (never sends) ────────────────────────────────────────────────── */

export interface DraftTranslation { sourceLang: string | null; targetLang: string; translation: string; sameLanguage?: boolean }

/** The draft in the recipient's language for the sender to review. Errors carry a code. */
export async function translateDraft(text: string, conversationId: string, targetLang?: string): Promise<DraftTranslation> {
  const r = await callSendMessage<DraftTranslation & { error?: string }>({ action: 'translate_draft', text, conversationId, targetLang });
  if (r.error) throw new ChatActionError(r.error);
  return r;
}

export async function translateMessage(messageId: string, targetLang: string): Promise<{ translation: string; sourceLang: string | null; original?: boolean; sameLanguage?: boolean }> {
  const r = await callSendMessage<{ translation?: string; sourceLang?: string | null; original?: boolean; sameLanguage?: boolean; error?: string }>({
    action: 'translate_message', messageId, targetLang,
  });
  if (r.error || !r.translation) throw new ChatActionError(r.error ?? 'TRANSLATION_UNAVAILABLE');
  return { translation: r.translation, sourceLang: r.sourceLang ?? null, original: r.original, sameLanguage: r.sameLanguage };
}

export type AssistMode = AssistTemplateMode | 'improve' | 'translation_ready';

export async function assistDraft(o: {
  mode: AssistMode; lang: string; conversationId: string; propertyId?: string | null; draft?: string;
}): Promise<{ draft: string; source: 'TEMPLATE' | 'AI' }> {
  const r = await callSendMessage<{ draft?: string; source?: 'TEMPLATE' | 'AI'; error?: string }>({
    action: 'assist', mode: o.mode, lang: o.lang, conversationId: o.conversationId, propertyId: o.propertyId ?? undefined, draft: o.draft,
  });
  if (r.error || !r.draft) throw new ChatActionError(r.error ?? 'AI_UNAVAILABLE');
  return { draft: r.draft, source: r.source ?? 'TEMPLATE' };
}

export interface TranscriptResult {
  transcript: string; sourceLang: string | null; translation?: string; targetLang?: string; translationError?: string; empty?: boolean;
}

export async function transcribeVoice(messageId: string, targetLang?: string): Promise<TranscriptResult> {
  const r = await callSendMessage<TranscriptResult & { error?: string }>({ action: 'transcribe', messageId, targetLang });
  if (r.error) throw new ChatActionError(r.error);
  return r;
}

/** The i18n key that explains a refusal from send-message. */
export function sendErrorKey(err: unknown): string {
  const code = err instanceof ChatActionError ? err.code : '';
  switch (code) {
    case 'RATE_LIMITED': return 'pc_err_rate';
    case 'DUPLICATE_MESSAGE': return 'pc_err_duplicate';
    case 'OFFER_CAP_REACHED': return 'pc_err_offer_cap';
    case 'RECIPIENT_NOT_ACCEPTING_OFFERS': return 'pc_err_not_accepting';
    case 'Cannot send message':
    case 'Conversation recipient mismatch': return 'pc_err_blocked';
    case 'MEDIA_TOO_LARGE': return 'pc_photo_too_large';
    case 'MEDIA_TYPE_INVALID': return 'pc_photo_type';
    case 'VOICE_TOO_LONG': return 'pc_voice_limit';
    case 'MEDIA_UPLOAD_FAILED':
    case 'MEDIA_NOT_FOUND':
    case 'MEDIA_PATH_INVALID': return 'pc_err_media';
    default: return 'pc_err_generic';
  }
}
