// Phase 3 API layer — Chat, Viewing, Unlock, Developer, Active Search
import { supabase } from '@/db/supabase';
import type {
  Conversation, Message, ContactShare, ViewingRequest,
  ExternalContactUnlock, ExternalUnlockPreview,
  PropertyTrustScore, CanonicalPropertyGroup,
  DeveloperProfile, PAYGOperation, ActiveSearchSubscription,
} from '@/types/phase3';

// ── HELPERS ─────────────────────────────────────────────────────────────────

async function callEF<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? '';
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? `EF ${fn} returned ${res.status}`);
  return json as T;
}

// ── CONVERSATIONS ────────────────────────────────────────────────────────────

export async function getConversations(userId: string): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select(`
      *,
      initiator:users!conversations_initiator_id_fkey(id,full_name,avatar_url,email),
      recipient:users!conversations_recipient_id_fkey(id,full_name,avatar_url,email),
      messages(id,body,status,created_at,sender_id)
    `)
    .or(`initiator_id.eq.${userId},recipient_id.eq.${userId}`)
    .eq('status', 'ACTIVE')
    .order('last_message_at', { ascending: false, nullsFirst: false });

  if (error) throw error;
  return (data ?? []).map((c) => {
    const msgs = (c.messages ?? []) as Message[];
    const lastMsg = msgs.length ? msgs[msgs.length - 1] : undefined;
    const unread = msgs.filter(
      (m: Message) => m.sender_id !== userId && m.status !== 'SEEN'
    ).length;
    const isInitiator = c.initiator_id === userId;
    return {
      ...c,
      messages: undefined,
      initiator: undefined,
      recipient: undefined,
      other_user: isInitiator ? c.recipient : c.initiator,
      last_message: lastMsg,
      unread_count: unread,
    } as Conversation;
  });
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function sendMessage(
  recipientId: string,
  body: string,
  conversationId?: string,
  propertyId?: string,
): Promise<{ message: Message; conversation_id: string }> {
  return callEF<{ message: Message; conversation_id: string }>('send-message', {
    recipient_id: recipientId,
    body,
    conversation_id: conversationId,
    property_id: propertyId,
  });
}

export async function markMessageSeen(messageId: string): Promise<void> {
  await supabase.from('message_receipts').upsert({
    message_id: messageId,
    user_id: (await supabase.auth.getUser()).data.user?.id,
    status: 'SEEN',
  }, { onConflict: 'message_id,user_id' });
  await supabase.from('messages').update({ status: 'SEEN', seen_at: new Date().toISOString() }).eq('id', messageId);
}

export async function getContactShare(conversationId: string, sharerId: string): Promise<ContactShare | null> {
  const { data } = await supabase.from('conversation_contact_shares')
    .select('*').eq('conversation_id', conversationId).eq('sharer_id', sharerId).maybeSingle();
  return data ?? null;
}

export async function shareContactInfo(
  conversationId: string,
  sharerId: string,
  info: { phone?: string; whatsapp?: string; telegram?: string },
): Promise<void> {
  await supabase.from('conversation_contact_shares').upsert({
    conversation_id: conversationId,
    sharer_id: sharerId,
    ...info,
  }, { onConflict: 'conversation_id,sharer_id' });
}

// ── VIEWING REQUESTS ─────────────────────────────────────────────────────────

export async function createViewingRequest(
  propertyId: string,
  preferredDate: string,
  preferredTime?: string,
  note?: string,
): Promise<ViewingRequest> {
  const result = await callEF<{ viewing_request: ViewingRequest }>('viewing-request', {
    action: 'create',
    property_id: propertyId,
    preferred_date: preferredDate,
    preferred_time: preferredTime,
    note,
  });
  return result.viewing_request;
}

export async function updateViewingRequest(
  viewingRequestId: string,
  action: 'accept' | 'decline' | 'propose_reschedule' | 'cancel' | 'complete',
  extra?: Record<string, unknown>,
): Promise<ViewingRequest> {
  const result = await callEF<{ viewing_request: ViewingRequest }>('viewing-request', {
    action,
    viewing_request_id: viewingRequestId,
    ...extra,
  });
  return result.viewing_request;
}

export async function getViewingRequests(
  userId: string,
  role: 'requester' | 'owner' | 'both' = 'both',
): Promise<ViewingRequest[]> {
  let query = supabase
    .from('viewing_requests')
    .select(`
      *,
      property:properties(title,city,cover_photo_url),
      requester:users!viewing_requests_requester_id_fkey(id,full_name,avatar_url,email)
    `)
    .order('created_at', { ascending: false });

  if (role === 'requester') query = query.eq('requester_id', userId);
  else if (role === 'owner') query = query.eq('owner_id', userId);
  else query = query.or(`requester_id.eq.${userId},owner_id.eq.${userId}`);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// ── EXTERNAL CONTACT UNLOCK ──────────────────────────────────────────────────

export async function previewExternalUnlock(
  matchId: string,
  idempotencyKey: string,
): Promise<{ preview: ExternalUnlockPreview }> {
  return callEF<{ preview: ExternalUnlockPreview }>('unlock-external-contact', {
    match_id: matchId,
    idempotency_key: idempotencyKey,
    confirm: false,
  });
}

export async function confirmExternalUnlock(
  matchId: string,
  idempotencyKey: string,
): Promise<ExternalUnlockPreview & { contact?: Record<string, string>; credits_charged: number }> {
  return callEF('unlock-external-contact', {
    match_id: matchId,
    idempotency_key: idempotencyKey,
    confirm: true,
  });
}

export async function getUnlockedContacts(userId: string): Promise<ExternalContactUnlock[]> {
  const { data, error } = await supabase
    .from('external_contact_unlocks')
    .select('*')
    .eq('user_id', userId)
    .not('unlocked_at', 'is', null)
    .order('unlocked_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ── PROPERTY TRUST SCORE ─────────────────────────────────────────────────────

export async function getPropertyTrustScore(propertyId: string): Promise<PropertyTrustScore | null> {
  const { data } = await supabase
    .from('property_trust_scores')
    .select('*')
    .eq('property_id', propertyId)
    .maybeSingle();
  return data ?? null;
}

// ── CANONICAL GROUPS ─────────────────────────────────────────────────────────

export async function getCanonicalGroup(propertyId: string): Promise<CanonicalPropertyGroup | null> {
  const { data: prop } = await supabase.from('properties').select('canonical_group_id').eq('id', propertyId).maybeSingle();
  if (!prop?.canonical_group_id) return null;

  const { data } = await supabase
    .from('canonical_property_groups')
    .select('*, canonical_property_sources(*)')
    .eq('id', prop.canonical_group_id)
    .maybeSingle();
  return data ? { ...data, sources: data.canonical_property_sources } : null;
}

// ── DEVELOPER PROFILE ────────────────────────────────────────────────────────

export async function getDeveloperProfile(developerIdOrPropertyId: string, byProperty = false): Promise<DeveloperProfile | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? '';
  const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/developer-score`;
  const url = byProperty
    ? base
    : `${base}?developer_id=${developerIdOrPropertyId}`;

  const res = await fetch(url, {
    method: byProperty ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      ...(byProperty ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(byProperty ? { body: JSON.stringify({ property_id: developerIdOrPropertyId }) } : {}),
  });
  if (!res.ok) return null;
  return res.json();
}

// ── ACTIVE SEARCH ────────────────────────────────────────────────────────────

export async function getActiveSearchSubscriptions(userId: string): Promise<ActiveSearchSubscription[]> {
  const { data, error } = await supabase
    .from('active_search_subscriptions')
    .select('*, properties(title,city)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createActiveSearch(
  side: 'DEMAND' | 'SUPPLY',
  opts: { property_id?: string; search_criteria?: Record<string, unknown>; intent_id?: string },
): Promise<ActiveSearchSubscription> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: homUser } = await supabase.from('users').select('id').eq('auth_id', user!.id).maybeSingle();
  const { data, error } = await supabase
    .from('active_search_subscriptions')
    .insert({ user_id: homUser!.id, side, ...opts })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function toggleActiveSearch(id: string, isActive: boolean): Promise<void> {
  await supabase.from('active_search_subscriptions').update({ is_active: isActive }).eq('id', id);
}

export async function deleteActiveSearch(id: string): Promise<void> {
  await supabase.from('active_search_subscriptions').delete().eq('id', id);
}

// ── PAYG PRICING ─────────────────────────────────────────────────────────────

export async function getPAYGOperations(): Promise<PAYGOperation[]> {
  const { data, error } = await supabase
    .from('payg_pricing_operations')
    .select('*')
    .eq('is_active', true)
    .order('provider');
  if (error) throw error;
  return data ?? [];
}

// ── RESEARCH PRODUCTS ────────────────────────────────────────────────────────

export async function purchaseResearchProduct(productCode: string): Promise<{
  success: boolean; purchaseId: string; productCode: string; unitsPurchased: number; priceCents: number;
}> {
  return callEF('research-purchase', { productCode });
}
