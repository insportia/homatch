// Home Financing buyer intent: the person's own opt-in to receive property offers.
//
// An active opt-in becomes one ordinary member search in HOMATCH Matching (see migration
// 20261201093000): sellers find the person there among the other buyer leads, and unlock them
// there at the MORTGAGE price. Nothing is sold, previewed or unlocked from Home Financing.
//
// The opt-in carries only what the person chose on the opt-in form, plus the listing they were
// looking at when they opted in (if any). No mortgage figure (income, debts, rate, payment) is
// read or sent from here, and the server never reads mortgage_scenarios for this either.

import { supabase } from '@/db/supabase';

/** Bumped whenever the opt-in wording changes, so each consent records what was shown. */
export const MORTGAGE_LEAD_CONSENT_VERSION = 'mbl-2026-10-25-matching';

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
  /** Sellers can find this person in Matching now (active, and an area to match on). */
  inMatching: boolean;
  /** The account-wide "receive property offers" setting; when off, Matching shows nobody this person. */
  acceptsOffers: boolean;
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
