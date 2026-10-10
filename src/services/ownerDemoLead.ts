/*
 * OWNER DEMO LEAD — Demo Mode in HOMATCH Leads.
 *
 * Every call is a SECURITY DEFINER function (20261029090000_owner_demo_lead.sql) that
 * answers only the owner of the property who is also in the demo audience (an
 * administrator or a listed demo tester), resolved from the caller's own session.
 * Nothing here reaches the wallet, the real lead feed, CRM, conversations, messages,
 * notifications or Email Studio sending: the demo lives in the demo_* tables.
 */

import { supabase } from '@/db/supabase';
import type { OwnerDemoPayload } from '@/leads/ownerDemo';

export type OwnerDemoAction =
  | 'VIEW_DETAILS' | 'UNLOCK' | 'TOGGLE_SAVED' | 'SAVE_CRM' | 'SET_STAGE' | 'ADD_NOTE'
  | 'OPEN_CHAT' | 'ATTACH_OFFER' | 'SAVE_EMAIL_DRAFT' | 'NOTIFICATIONS_READ' | 'WALKTHROUGH_DONE';

export class OwnerDemoError extends Error {
  constructor(public code: string) { super(code); }
}

function codeOf(error: { message?: string } | null): string {
  const m = String(error?.message ?? '');
  const known = m.match(/DEMO_[A-Z_]+/);
  return known ? known[0] : 'DEMO_FAILED';
}

function asPayload(data: unknown): OwnerDemoPayload {
  const p = data as OwnerDemoPayload | null;
  if (!p || p.is_demo !== true || !p.conversation_id) throw new OwnerDemoError('DEMO_NOT_FOUND');
  return {
    ...p,
    state: p.state ?? {},
    events: Array.isArray(p.events) ? p.events : [],
    messages: Array.isArray(p.messages) ? p.messages : [],
  };
}

/** Whether the Demo Mode entry should be shown. False on any doubt. */
export async function ownerDemoAvailable(propertyId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('owner_demo_lead_available', { p_property_id: propertyId });
  if (error) return false;
  return data === true;
}

export async function openOwnerDemo(propertyId: string): Promise<OwnerDemoPayload> {
  const { data, error } = await supabase.rpc('owner_demo_lead_open', { p_property_id: propertyId });
  if (error) throw new OwnerDemoError(codeOf(error));
  return asPayload(data);
}

export async function ownerDemoAct(conversationId: string, action: OwnerDemoAction, payload: Record<string, unknown> = {}): Promise<OwnerDemoPayload> {
  const { data, error } = await supabase.rpc('owner_demo_lead_act', {
    p_conversation_id: conversationId, p_action: action, p_payload: payload,
  });
  if (error) throw new OwnerDemoError(codeOf(error));
  return asPayload(data);
}

export async function resetOwnerDemo(conversationId: string): Promise<OwnerDemoPayload> {
  const { data, error } = await supabase.rpc('owner_demo_lead_reset', { p_conversation_id: conversationId });
  if (error) throw new OwnerDemoError(codeOf(error));
  return asPayload(data);
}

/** A message in the simulated thread; the server stores it and the simulated reply. */
export async function sendOwnerDemoMessage(conversationId: string, body: string, lang: string): Promise<void> {
  const { error } = await supabase.rpc('demo_send_message', { p_conversation_id: conversationId, p_body: body, p_lang: lang });
  if (error) throw new OwnerDemoError(codeOf(error));
}
