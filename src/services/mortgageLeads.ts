// Mortgage-interested buyers: the buyer's own opt-in, and the seller's view of who fits a listing.
//
// The opt-in carries only what the person chose on the opt-in form, plus the listing they were
// looking at when they opted in (if any). No mortgage figure (income, debts, rate, payment) is
// read or sent from here, and the server never reads mortgage_scenarios for this either.

import { supabase } from '@/db/supabase';
import { UnlockError } from './homatchLeads';

/** Bumped whenever the opt-in wording changes, so each consent records what was shown. */
export const MORTGAGE_LEAD_CONSENT_VERSION = 'mbl-2026-10-24';

export type Timeframe = 'NOW' | 'MONTHS_3' | 'MONTHS_6' | 'LATER';

export interface BuyerIntentInput {
  city: string | null;
  district: string | null;
  propertyTypes: string[];
  roomsMin: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  currency: string | null;
  timeframe: Timeframe | null;
  propertyId: string | null;
  sharePhone: boolean;
  shareEmail: boolean;
}

export interface BuyerIntent extends BuyerIntentInput {
  status: 'ACTIVE' | 'WITHDRAWN';
  consentedAt: string;
  withdrawnAt: string | null;
  lastSignalAt: string;
}

export async function getMyBuyerIntent(): Promise<BuyerIntent | null> {
  const { data, error } = await supabase.rpc('my_mortgage_buyer_intent');
  if (error) throw error;
  return (data as BuyerIntent | null) ?? null;
}

export async function setMyBuyerIntent(input: BuyerIntentInput): Promise<BuyerIntent | null> {
  const { data, error } = await supabase.rpc('set_my_mortgage_buyer_intent', { p: input, p_consent_version: MORTGAGE_LEAD_CONSENT_VERSION });
  if (error) throw error;
  return (data as BuyerIntent | null) ?? null;
}

export async function withdrawMyBuyerIntent(): Promise<BuyerIntent | null> {
  const { data, error } = await supabase.rpc('withdraw_my_mortgage_buyer_intent');
  if (error) throw error;
  return (data as BuyerIntent | null) ?? null;
}

export interface MortgageLeadPreview {
  ref: string;
  unlocked: boolean;
  propertySpecific: boolean;
  budgetFit: 'WITHIN' | 'STRETCH' | 'UNKNOWN';
  city: string | null;
  district: string | null;
  propertyTypes: string[];
  roomsMin: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  currency: string | null;
  timeframe: Timeframe | null;
  research: 'REPEATED' | 'SINGLE';
  freshness: 'RECENT' | 'EARLIER' | 'OLDER';
  activeMonth: string;
  language: string | null;
}

export interface MortgageLeadFeed {
  price: { credits: number; cents: number; active: boolean } | null;
  disabled: boolean;
  items: MortgageLeadPreview[];
}

export async function getMortgageLeadFeed(propertyId: string): Promise<MortgageLeadFeed> {
  const { data, error } = await supabase.rpc('mortgage_buyer_leads_feed', { p_property_id: propertyId });
  if (error) throw error;
  const f = (data ?? {}) as Partial<MortgageLeadFeed>;
  return {
    price: f.price ? { credits: Number(f.price.credits), cents: Number(f.price.cents), active: Boolean(f.price.active) } : null,
    disabled: Boolean(f.disabled),
    items: (f.items ?? []) as MortgageLeadPreview[],
  };
}

export function newMortgageUnlockKey(): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `mlu:${rnd}`;
}

export interface MortgageUnlockResult { unlocked: string[]; alreadyUnlocked: string[]; chargedCredits: number; duplicate: boolean }

export async function unlockMortgageLeads(args: { propertyId: string; refs: string[]; expectedCredits: number; idempotencyKey: string }): Promise<MortgageUnlockResult> {
  const { data, error } = await supabase.functions.invoke('atomic-unlock', { body: { kind: 'mortgage_leads', ...args } });
  if (error) {
    let code = 'INTERNAL';
    try {
      const body = await (error as { context?: Response }).context?.json?.();
      if (body && typeof body.error === 'string') code = body.error;
    } catch { /* keep INTERNAL */ }
    throw new UnlockError(code);
  }
  const r = (data ?? {}) as Partial<MortgageUnlockResult>;
  return {
    unlocked: (r.unlocked ?? []) as string[], alreadyUnlocked: (r.alreadyUnlocked ?? []) as string[],
    chargedCredits: Number(r.chargedCredits ?? 0), duplicate: Boolean(r.duplicate),
  };
}

export interface MortgageLeadContact {
  restricted: boolean;
  reason?: 'WITHDRAWN' | 'BLOCKED' | 'UNAVAILABLE' | 'OPTED_OUT';
  displayName?: string | null;
  language?: string | null;
  phone?: string | null;
  email?: string | null;
}

export async function getMortgageLeadContact(ref: string): Promise<MortgageLeadContact> {
  const { data, error } = await supabase.rpc('mortgage_lead_contact', { p_ref: ref });
  if (error) throw error;
  return data as MortgageLeadContact;
}
