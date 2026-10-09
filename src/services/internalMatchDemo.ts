/*
 * THE INTERNAL-MATCH DEMO — one demo buyer, a simulated private channel.
 *
 * Every call is a SECURITY DEFINER function (20261024120000_internal_match_demo.sql)
 * that answers only an administrator or a listed tester. Nothing here touches the
 * real conversations/messages tables, notifications or credits: the demo lives in
 * demo_buyer_profiles / demo_conversations / demo_messages and nowhere else.
 */

import { supabase } from '@/db/supabase';
import type { DemoMatchPayload } from '@/matching/internalMatch';

export type DemoSender = 'OWNER' | 'DEMO_BUYER';

export interface DemoMessage {
  id: string;
  seq: number;
  conversation_id: string;
  sender: DemoSender;
  body: string;
  is_simulated: boolean;
  language: string | null;
  sent_at: string;
  delivered_at: string | null;
  seen_at: string | null;
  created_at: string;
}

export interface DemoThread {
  conversation: {
    id: string;
    demo_buyer_id: string;
    property_id: string;
    demo_unlocked_at: string | null;
    is_demo: true;
  };
  messages: DemoMessage[];
}

/** The demo buyer for this property, or null for anybody outside the demo audience. */
export async function getDemoMatch(propertyId: string): Promise<DemoMatchPayload | null> {
  const { data, error } = await supabase.rpc('demo_internal_match_for_property', { p_property_id: propertyId });
  if (error) throw error;
  if (!data || typeof data !== 'object') return null;
  const payload = data as DemoMatchPayload;
  return payload.is_demo === true && payload.profile ? payload : null;
}

export async function openDemoConversation(demoBuyerId: string, propertyId: string): Promise<string> {
  const { data, error } = await supabase.rpc('demo_open_conversation', {
    p_demo_buyer_id: demoBuyerId,
    p_property_id: propertyId,
  });
  if (error) throw error;
  return String(data);
}

export async function listDemoMessages(conversationId: string): Promise<DemoThread> {
  const { data, error } = await supabase.rpc('demo_list_messages', { p_conversation_id: conversationId });
  if (error) throw error;
  const thread = (data ?? {}) as Partial<DemoThread>;
  if (!thread.conversation) throw new Error('DEMO_NOT_FOUND');
  return { conversation: thread.conversation, messages: thread.messages ?? [] };
}

/** Stores the message and the simulated reply; returns both. */
export async function sendDemoMessage(
  conversationId: string,
  body: string,
  lang: string,
): Promise<{ message: DemoMessage; reply: DemoMessage }> {
  const { data, error } = await supabase.rpc('demo_send_message', {
    p_conversation_id: conversationId,
    p_body: body,
    p_lang: lang,
  });
  if (error) throw error;
  return data as { message: DemoMessage; reply: DemoMessage };
}

/** Records a simulated unlock. Charges nothing and reveals nothing. */
export async function unlockDemoContact(conversationId: string): Promise<{ demo_unlocked_at: string; charged_credits: 0 }> {
  const { data, error } = await supabase.rpc('demo_unlock_contact', { p_conversation_id: conversationId });
  if (error) throw error;
  return data as { demo_unlocked_at: string; charged_credits: 0 };
}

/** The delivery state a message has reached, from its own clock. */
export function deliveryState(message: Pick<DemoMessage, 'delivered_at' | 'seen_at'>): 'SENT' | 'DELIVERED' | 'SEEN' {
  if (message.seen_at) return 'SEEN';
  if (message.delivered_at) return 'DELIVERED';
  return 'SENT';
}
