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

export interface LiveChatMessageRow {
  id: string; seq: number; user_id: string; body: string; reply_to_id: string | null;
  edited_at: string | null; deleted_at: string | null; hidden_by_admin: boolean; hidden_reason: string | null;
  created_at: string;
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
