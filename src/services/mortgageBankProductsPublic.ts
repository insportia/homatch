// Bank mortgage products as the public sees them (public.mortgage_bank_products).
//
// RLS already hides anything not VERIFIED, not inside its review window or not yet in force,
// except from admins. The same conditions are applied here as well, so an admin looking at the
// consumer page sees exactly what a customer sees, never a draft.
import { supabase } from '@/db/supabase';

export interface PublicBankProduct {
  id: string;
  bankName: string;
  productName: string;
  currency: string;
  minTermMonths: number | null;
  maxTermMonths: number | null;
  rateFromPercent: number | null;
  rateToPercent: number | null;
  rateType: 'FIXED' | 'VARIABLE' | 'INDEXED' | null;
  effectiveRateFromPercent: number | null;
  minDownPaymentPercent: number | null;
  notes: string | null;
  sourceUrl: string;
  verifiedAt: string;
}

const COLS = 'id,bank_name,product_name,currency,min_term_months,max_term_months,rate_from_percent,rate_to_percent,rate_type,effective_rate_from_percent,min_down_payment_percent,notes,source_url,verified_at,effective_from,review_due_days,review_status';
const n = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Shown to the public: VERIFIED, verified within its review window, and already in force. */
export function isPubliclyCurrent(row: { review_status: string; verified_at: string | null; review_due_days: number; effective_from: string | null }, today: Date = new Date()): boolean {
  if (row.review_status !== 'VERIFIED' || !row.verified_at) return false;
  const day = today.toISOString().slice(0, 10);
  const due = new Date(`${row.verified_at.slice(0, 10)}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + row.review_due_days);
  if (due.toISOString().slice(0, 10) < day) return false;
  return !row.effective_from || row.effective_from.slice(0, 10) <= day;
}

export async function listPublicBankProducts(currency?: string): Promise<PublicBankProduct[]> {
  let query = supabase.from('mortgage_bank_products').select(COLS).eq('review_status', 'VERIFIED').order('bank_name');
  if (currency) query = query.eq('currency', currency);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[])
    .filter((r) => isPubliclyCurrent(r as Parameters<typeof isPubliclyCurrent>[0]))
    .map((r) => ({
      id: String(r.id), bankName: String(r.bank_name), productName: String(r.product_name), currency: String(r.currency),
      minTermMonths: n(r.min_term_months), maxTermMonths: n(r.max_term_months),
      rateFromPercent: n(r.rate_from_percent), rateToPercent: n(r.rate_to_percent),
      rateType: (r.rate_type as PublicBankProduct['rateType']) ?? null,
      effectiveRateFromPercent: n(r.effective_rate_from_percent), minDownPaymentPercent: n(r.min_down_payment_percent),
      notes: (r.notes as string | null) ?? null, sourceUrl: String(r.source_url), verifiedAt: String(r.verified_at),
    }));
}
