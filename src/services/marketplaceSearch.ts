// Find Property — Marketplace Search client. Every call goes through the
// marketplace-search edge function, which resolves the caller and returns only
// the customer-safe view (no ranking internals, no cost, no worker errors).
// There is no fixture or fallback data in this file: when the service cannot
// answer, the interface says so.

import { supabase } from '@/db/supabase';
import type { SearchIntelligenceBrief } from '@/research-core/marketplace/brief';
import type { BrowsePage, ResultFilters } from '@/research-core/marketplace/browse-results';
import type { ComparisonRow } from '@/research-core/marketplace/comparison';
import type { SearchStage, SearchStatus } from '@/research-core/marketplace/lifecycle';
import type { ResultGroup, ResultProperty } from '@/research-core/marketplace/pipeline';
import type { Readiness } from '@/research-core/marketplace/readiness';

export type { BrowsePage, ResultFilters } from '@/research-core/marketplace/browse-results';

export type PropertyView = Omit<ResultProperty, 'internal'> & { tradeoffs?: string[] };

export interface MarketplaceCapabilities {
  marketplaceEnabled: boolean;
  activeSources: number;
  deepSearchAvailable: boolean;
}

export interface SearchSummary {
  id: string;
  status: SearchStatus;
  terminal: boolean;
  brief: SearchIntelligenceBrief;
  createdAt: string;
  resultsAvailableAt: string | null;
  progress: { sourcesTotal: number; sourcesCompleted: number; sourcesFailed: number; fraction: number | null };
  stages: Array<{ stage: SearchStage; state: 'DONE' | 'ACTIVE' | 'PENDING' }>;
  counters: {
    listingsDiscovered: number; listingsValidated: number; uniqueProperties: number;
    strongMatches: number; sourcesCompleted: number; sourcesTotal: number;
  };
  groups: Record<ResultGroup, number>;
  /** Every valid matching property across all groups (exact database count). */
  totalProperties: number;
  partial: boolean;
  unavailable: 'NO_SOURCES' | 'FAILED' | null;
}

export class MarketplaceError extends Error {
  readonly code: string;
  readonly detail: unknown;
  constructor(code: string, detail?: unknown) { super(code); this.code = code; this.detail = detail; }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('marketplace-search', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    const payload = context && typeof context.json === 'function' ? await context.json().catch(() => null) : null;
    throw new MarketplaceError(String(payload?.error ?? 'REQUEST_FAILED'), payload);
  }
  return data as T;
}

export async function getCapabilities(): Promise<MarketplaceCapabilities> {
  try {
    return await call<MarketplaceCapabilities>({ action: 'capabilities' });
  } catch {
    /* Unreachable service: Marketplace Search is not offered, the existing Find Property is. */
    return { marketplaceEnabled: false, activeSources: 0, deepSearchAvailable: false };
  }
}

export const understand = (text: string) =>
  call<{ understood: boolean; brief: SearchIntelligenceBrief; readiness: Readiness }>({ action: 'understand', text });

export const startSearch = (brief: SearchIntelligenceBrief, idempotencyKey: string) =>
  call<{ search: SearchSummary; replayed?: boolean }>({ action: 'start', brief, idempotencyKey });

export const searchStatus = (searchId?: string) =>
  call<{ search: SearchSummary | null }>(searchId ? { action: 'status', searchId } : { action: 'status' });

export interface SearchHistoryItem {
  id: string;
  status: SearchStatus;
  brief: SearchIntelligenceBrief;
  createdAt: string;
  completedAt: string | null;
  /** Saved counts at processing time, not a claim about today's inventory. */
  uniqueProperties: number | null;
  strongMatches: number | null;
  sourcesTotal: number | null;
  sourcesTerminal: number | null;
  rawListings: number | null;
}

export const searchHistory = async (page = 1) => {
  const result = await call<{ page: number; hasMore: boolean; items: SearchHistoryItem[] }>({ action: 'history', page });
  if (!result || !Array.isArray(result.items) || typeof result.hasMore !== 'boolean') throw new MarketplaceError('REQUEST_FAILED');
  return result;
};

export const searchResults = (searchId: string, group: ResultGroup, offset = 0, limit = 12) =>
  call<{ group: ResultGroup; items: PropertyView[]; total: number; nextOffset: number | null }>({ action: 'results', searchId, group, offset, limit });

export type SearchBrowsePage = BrowsePage & { revision: string };
export const browseSearchResults = (searchId: string, filters: ResultFilters, page = 1, revision?: string) =>
  call<SearchBrowsePage>({ action: 'browse', searchId, filters, page, revision });

export const propertyDetail = (searchId: string, key: string) =>
  call<{ property: PropertyView }>({ action: 'property', searchId, key });

export const compareTwo = (searchId: string, a: string, b: string) =>
  call<{ a: PropertyView; b: PropertyView; rows: ComparisonRow[] }>({ action: 'compare', searchId, a, b });

export const cancelSearch = (searchId: string) =>
  call<{ search: SearchSummary }>({ action: 'cancel', searchId });

/* ── Admin only (admin_marketplace_search_intelligence refuses everyone else) ── */

export interface AdminMarketplaceOverview {
  generated_at: string;
  enabled: boolean;
  workers: Array<{ worker_id: string; source_key: string; state: string; enabled: boolean; execution_mode: string; health: { status?: string } | null }>;
  searches: Array<{
    id: string; user_id: string; status: string; failure_reason: string | null; workers_total: number; workers_terminal: number;
    properties_count: number; strong_matches: number; ai_status: string; created_at: string; completed_at: string | null;
    ai: Array<{ call: string; model: string; inputTokens: number; outputTokens: number; costUsd: number | null }> | null;
    stats: Record<string, unknown> | null;
  }>;
}

export interface AdminMarketplaceDetail {
  search: Record<string, unknown> | null;
  plan: Record<string, unknown> | null;
  worker_runs: Array<{ worker_id: string; status: string; discovered: number; returned: number; rejected: number; errors: unknown; metrics: unknown; latency_ms: number | null }>;
  properties: Array<{ key: string; group: string; rank: number; score: number; internal: Record<string, unknown>; source_count: number; seller: { classification?: string } | null; price_discrepancy: { significant?: boolean; differencePct?: number } | null }>;
}

export async function adminMarketplaceOverview(): Promise<AdminMarketplaceOverview> {
  const { data, error } = await supabase.rpc('admin_marketplace_search_intelligence', { p_search_id: null });
  if (error) throw new MarketplaceError('ADMIN_RPC_UNAVAILABLE', error.message);
  return data as AdminMarketplaceOverview;
}

export async function adminMarketplaceDetail(searchId: string): Promise<AdminMarketplaceDetail> {
  const { data, error } = await supabase.rpc('admin_marketplace_search_intelligence', { p_search_id: searchId });
  if (error) throw new MarketplaceError('ADMIN_RPC_UNAVAILABLE', error.message);
  return data as AdminMarketplaceDetail;
}
