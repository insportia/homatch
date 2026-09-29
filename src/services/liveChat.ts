// ============================================================
// HOMATCH — Live Chat data layer
// Deliberately separate from services/api3.ts (the 1:1 conversations
// system) — same separation as the AI assistant already has from
// human chat. Private-message hand-off reuses api3's sendMessage,
// it is not duplicated here.
// ============================================================
import { supabase } from '@/db/supabase';
import type { LiveChatMessage, LiveChatProfile } from '@/types/types';

const PAGE_SIZE = 50;

export async function getMyLiveChatProfile(userId: string): Promise<LiveChatProfile | null> {
  const { data } = await supabase.from('live_chat_profiles').select('*').eq('user_id', userId).maybeSingle();
  return (data as LiveChatProfile) ?? null;
}

export async function isNicknameAvailable(nickname: string): Promise<boolean> {
  const { data } = await supabase.from('live_chat_profiles').select('user_id').ilike('nickname', nickname).maybeSingle();
  return !data;
}

export async function createLiveChatProfile(userId: string, nickname: string, avatarColor: string): Promise<LiveChatProfile> {
  const { data, error } = await supabase
    .from('live_chat_profiles')
    .insert({ user_id: userId, nickname, avatar_color: avatarColor })
    .select('*')
    .single();
  if (error) throw error;
  return data as LiveChatProfile;
}

export async function updateLiveChatNickname(userId: string, nickname: string): Promise<void> {
  const { error } = await supabase.from('live_chat_profiles').update({ nickname }).eq('user_id', userId);
  if (error) throw error;
}

export async function touchLiveChatActivity(userId: string): Promise<void> {
  await supabase.from('live_chat_profiles').update({ last_active_at: new Date().toISOString() }).eq('user_id', userId);
}

export type LiveChatMessageKind = 'TEXT' | 'PHOTO' | 'VOICE';

export interface LiveChatMessageRow {
  id: string; seq: number; user_id: string; body: string; reply_to_id: string | null;
  edited_at: string | null; deleted_at: string | null; hidden_by_admin: boolean; hidden_reason: string | null;
  created_at: string;
  kind: LiveChatMessageKind;
  media_path: string | null;
  media_meta: { duration_seconds?: number; width?: number; height?: number; mime?: string; size?: number } | null;
}

// Loads the most recent page, or older messages before `beforeSeq` for
// infinite-scroll pagination (Master Prompt §39 — never load unlimited history).
export async function getLiveChatMessages(beforeSeq?: number): Promise<LiveChatMessageRow[]> {
  let query = supabase.from('live_chat_messages').select('*').order('seq', { ascending: false }).limit(PAGE_SIZE);
  if (beforeSeq != null) query = query.lt('seq', beforeSeq);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as LiveChatMessageRow[]).reverse();
}

export async function getLiveChatProfiles(userIds: string[]): Promise<Record<string, LiveChatProfile>> {
  if (userIds.length === 0) return {};
  const { data } = await supabase.from('live_chat_profiles').select('*').in('user_id', [...new Set(userIds)]);
  const map: Record<string, LiveChatProfile> = {};
  for (const p of (data ?? []) as LiveChatProfile[]) map[p.user_id] = p;
  return map;
}

export async function sendLiveChatMessage(userId: string, body: string, replyToId?: string | null): Promise<LiveChatMessageRow> {
  const { data, error } = await supabase
    .from('live_chat_messages')
    .insert({ user_id: userId, body, reply_to_id: replyToId ?? null })
    .select('*')
    .single();
  if (error) throw error;
  return data as LiveChatMessageRow;
}

/* ── MEDIA MESSAGES ──────────────────────────────────────────────────────
 * Photos and voice notes are MESSAGING features, not AI features: an upload
 * to the private live-chat-media bucket (under the sender's own prefix —
 * storage policy and the message row's CHECK both enforce it), then an
 * ordinary message row of the matching kind. No model is ever consulted.
 */

const MEDIA_BUCKET = 'live-chat-media';
export const LIVE_CHAT_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const LIVE_CHAT_MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const LIVE_CHAT_VOICE_MAX_SECONDS = 60;

function mediaExt(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime.startsWith('audio/webm')) return 'webm';
  if (mime.startsWith('audio/ogg')) return 'ogg';
  if (mime.startsWith('audio/mp4')) return 'm4a';
  return 'bin';
}

async function uploadLiveChatMedia(userId: string, blob: Blob): Promise<string> {
  const path = `${userId}/${crypto.randomUUID()}.${mediaExt(blob.type)}`;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, blob, {
    contentType: blob.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function sendLiveChatPhoto(
  userId: string, file: File, caption: string, replyToId?: string | null,
): Promise<LiveChatMessageRow> {
  if (!LIVE_CHAT_IMAGE_MIME.includes(file.type as (typeof LIVE_CHAT_IMAGE_MIME)[number])) {
    throw new Error('UNSUPPORTED_IMAGE_TYPE');
  }
  if (file.size > LIVE_CHAT_MAX_MEDIA_BYTES) throw new Error('MEDIA_TOO_LARGE');
  const path = await uploadLiveChatMedia(userId, file);
  const { data, error } = await supabase
    .from('live_chat_messages')
    .insert({
      user_id: userId, body: caption, kind: 'PHOTO', media_path: path,
      media_meta: { mime: file.type, size: file.size }, reply_to_id: replyToId ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as LiveChatMessageRow;
}

export async function sendLiveChatVoice(
  userId: string, blob: Blob, durationSeconds: number, replyToId?: string | null,
): Promise<LiveChatMessageRow> {
  /* The client's own honesty check; the DB CHECK repeats it server-side. */
  const duration = Math.round(durationSeconds * 10) / 10;
  if (!(duration > 0) || duration > LIVE_CHAT_VOICE_MAX_SECONDS) throw new Error('VOICE_TOO_LONG');
  if (blob.size > LIVE_CHAT_MAX_MEDIA_BYTES) throw new Error('MEDIA_TOO_LARGE');
  const path = await uploadLiveChatMedia(userId, blob);
  const { data, error } = await supabase
    .from('live_chat_messages')
    .insert({
      user_id: userId, body: '', kind: 'VOICE', media_path: path,
      media_meta: { duration_seconds: duration, mime: blob.type, size: blob.size },
      reply_to_id: replyToId ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as LiveChatMessageRow;
}

/** Short-lived signed URL for a media message. The bucket is private. */
export async function getLiveChatMediaUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw (error ?? new Error('MEDIA_URL_FAILED'));
  return data.signedUrl;
}

/* ── REACTIONS ───────────────────────────────────────────────────────────
 * A fixed palette (mirrors the DB CHECK), one row per (message, user,
 * emoji), realtime through the same publication as messages.
 */

export const LIVE_CHAT_REACTIONS = ['👍', '❤️', '😂', '👀', '🔥', '🙏'] as const;
export type LiveChatReactionEmoji = (typeof LIVE_CHAT_REACTIONS)[number];

export interface LiveChatReactionRow {
  message_id: string; user_id: string; emoji: string; created_at: string;
}

export async function getLiveChatReactions(messageIds: string[]): Promise<LiveChatReactionRow[]> {
  if (messageIds.length === 0) return [];
  const { data, error } = await supabase
    .from('live_chat_reactions').select('*').in('message_id', messageIds);
  if (error) throw error;
  return (data ?? []) as LiveChatReactionRow[];
}

export async function addLiveChatReaction(userId: string, messageId: string, emoji: LiveChatReactionEmoji): Promise<void> {
  const { error } = await supabase
    .from('live_chat_reactions')
    .upsert({ message_id: messageId, user_id: userId, emoji }, { onConflict: 'message_id,user_id,emoji', ignoreDuplicates: true });
  if (error) throw error;
}

export async function removeLiveChatReaction(userId: string, messageId: string, emoji: string): Promise<void> {
  const { error } = await supabase
    .from('live_chat_reactions')
    .delete().eq('message_id', messageId).eq('user_id', userId).eq('emoji', emoji);
  if (error) throw error;
}

/* ── SAVED MESSAGES (private bookmarks) ──────────────────────────────────
 * A save is private: RLS is owner-only and nothing here notifies anyone.
 */

export async function saveLiveChatMessage(userId: string, messageId: string): Promise<void> {
  const { error } = await supabase
    .from('live_chat_saved')
    .upsert({ user_id: userId, message_id: messageId }, { onConflict: 'user_id,message_id', ignoreDuplicates: true });
  if (error) throw error;
}

export async function unsaveLiveChatMessage(userId: string, messageId: string): Promise<void> {
  const { error } = await supabase
    .from('live_chat_saved').delete().eq('user_id', userId).eq('message_id', messageId);
  if (error) throw error;
}

export async function getMySavedMessageIds(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('live_chat_saved').select('message_id').eq('user_id', userId);
  return ((data ?? []) as Array<{ message_id: string }>).map((r) => r.message_id);
}

/** The saved list, newest save first, joined to the messages the viewer can
 *  still see. A save whose source message was deleted or hidden simply does
 *  not come back — the UI states that truthfully rather than inventing it. */
export async function getMySavedMessages(userId: string): Promise<Array<{ saved_at: string; message: LiveChatMessageRow }>> {
  const { data, error } = await supabase
    .from('live_chat_saved')
    .select('created_at, live_chat_messages(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{ created_at: string; live_chat_messages: LiveChatMessageRow | null }>;
  return rows
    .filter((r) => r.live_chat_messages && !r.live_chat_messages.deleted_at && !r.live_chat_messages.hidden_by_admin)
    .map((r) => ({ saved_at: r.created_at, message: r.live_chat_messages as LiveChatMessageRow }));
}

export async function editLiveChatMessage(messageId: string, body: string): Promise<void> {
  const { error } = await supabase.from('live_chat_messages').update({ body }).eq('id', messageId);
  if (error) throw error;
}

export async function deleteLiveChatMessage(messageId: string): Promise<void> {
  const { error } = await supabase.from('live_chat_messages').update({ deleted_at: new Date().toISOString() }).eq('id', messageId);
  if (error) throw error;
}

export async function reportLiveChatMessage(messageId: string, reporterId: string, reason: string): Promise<void> {
  const { error } = await supabase.from('live_chat_reports').insert({ message_id: messageId, reporter_id: reporterId, reason });
  if (error) throw error;
}

export async function blockLiveChatUser(blockerId: string, blockedId: string): Promise<void> {
  const { error } = await supabase.from('conversation_blocks').insert({ blocker_id: blockerId, blocked_id: blockedId });
  if (error) throw error;
}

export async function getMyBlockedUserIds(blockerId: string): Promise<string[]> {
  const { data } = await supabase.from('conversation_blocks').select('blocked_id').eq('blocker_id', blockerId);
  return (data ?? []).map((r: { blocked_id: string }) => r.blocked_id);
}
