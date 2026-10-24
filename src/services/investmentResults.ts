// Investment Intelligence: named, saved results (investment_saved_results, owner-only RLS).
import { supabase } from '@/db/supabase';
import type { InvestmentContext } from '@/investment/consultant/context';
import type { StrategyId } from '@/investment/strategies/definitions';

export interface SavedInvestmentResult {
  id: string;
  name: string;
  strategy: StrategyId;
  context: InvestmentContext;
  summary: { labelKey: string; value: number | null; kind: string }[];
  currency: string | null;
  createdAt: string;
}

const COLS = 'id,name,strategy,context,summary,currency,created_at';
const map = (r: Record<string, unknown>): SavedInvestmentResult => ({
  id: r.id as string, name: r.name as string, strategy: r.strategy as StrategyId,
  context: r.context as InvestmentContext, summary: (r.summary ?? []) as SavedInvestmentResult['summary'],
  currency: (r.currency as string | null) ?? null, createdAt: r.created_at as string,
});

export async function listSavedResults(): Promise<SavedInvestmentResult[]> {
  const { data, error } = await supabase.from('investment_saved_results').select(COLS).order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []).map((r) => map(r as Record<string, unknown>));
}

export async function saveResult(args: { userId: string; name: string; strategy: StrategyId; context: InvestmentContext; summary: SavedInvestmentResult['summary']; currency: string | null }): Promise<SavedInvestmentResult> {
  const { data, error } = await supabase.from('investment_saved_results')
    .insert({ user_id: args.userId, name: args.name.trim().slice(0, 80), strategy: args.strategy, context: args.context, summary: args.summary, currency: args.currency })
    .select(COLS).single();
  if (error) throw error;
  return map(data as Record<string, unknown>);
}

export async function deleteResult(id: string): Promise<void> {
  const { error } = await supabase.from('investment_saved_results').delete().eq('id', id);
  if (error) throw error;
}
