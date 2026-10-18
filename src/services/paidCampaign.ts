/*
 * Find Property — the paid social OFFER campaign, client side.
 *
 * The server decides everything that costs money: the preview's price split and
 * plan come from find-property-run, the reservation happens only after the
 * customer confirms the exact price, and progress / money are read back from
 * the server (my_find_property_campaign). Nothing here computes a charge.
 */
import { supabase } from '@/db/supabase';

/** Admin-side vocabulary only: the customer is never shown which networks are searched (owner, 2026-10-18). */
export type OfferNetwork = 'FACEBOOK' | 'INSTAGRAM' | 'TELEGRAM' | 'TIKTOK' | 'VK';

export interface CampaignPreview {
  available: boolean;
  unavailableReason: 'PROVIDER_OFF' | 'PROVIDER_NOT_CONFIGURED' | 'PAID_CAMPAIGNS_OFF' | 'NO_SEARCHABLE_SOURCES' | null;
  priceCredits: number; creditsPerUsd: number; minCredits: number; maxCredits: number | null;
  priceUsd: number;
  policy: string; charging: 'CONSUMED_DIV_0_63_CAPPED';
  networks: OfferNetwork[];
  plannedRuns: number;
  plannedByNetwork: Record<OfferNetwork, number>;
  unavailableNetworks: Array<{ network: OfferNetwork; reason: 'NO_READY_ACTOR' | 'NO_KNOWN_SOURCE' }>;
  skippedForBudget: number;
  /** The temporary TEST amount, offered only to admins / listed testers while Admin keeps it on. */
  testOption?: { credits: number } | null;
  testCampaign?: boolean;
}

/* ── A campaign's own results (find-property-run action 'results') ─────────────────── */
export type MatchCategory = 'EXACT' | 'POTENTIAL' | 'ALTERNATIVE' | 'REJECTED';
export type CheckKey = 'transaction' | 'city' | 'district' | 'propertyType' | 'price' | 'area' | 'rooms' | 'bedrooms' | 'buildingStatus' | 'fresh';
export interface MatchCheck { key: CheckKey; state: 'MATCH' | 'UNVERIFIED' | 'FAIL'; expected: string | null; actual: string | null }
export interface CampaignCriteria {
  transaction: 'SALE' | 'RENT'; city: string | null; districts: string[];
  propertyType: string | null;
  priceUsd: { min: number | null; max: number | null } | null; areaSqm: { min: number | null; max: number | null } | null;
  rooms: { min: number | null; max: number | null } | null; bedrooms: { min: number | null; max: number | null } | null;
  buildingStatuses: string[];
}
export interface CampaignOutcome {
  fetched: number; candidates: number; unique: number; duplicates: number;
  exact: number; potential: number; alternative: number; rejected: number;
  rejectedBy: Partial<Record<string, number>>; available: number;
  /** How these results were captured (campaignResults.ts): at settlement, or rebuilt later. */
  provenance?: { captured: 'CAMPAIGN_END' | 'RECONSTRUCTED'; verified: boolean; bookedOffers: number; attributedOffers: number; changedAfterEnd: number; fxSources: string[] };
}
export interface CampaignSettlement {
  status: 'HELD' | 'SETTLING' | 'SETTLED' | 'RELEASED' | string;
  reservedCredits: number | null; chargedCredits: number | null; releasedCredits: number | null; settledAt?: string | null;
}
export interface CampaignResultItem {
  id: string; category: MatchCategory; rank: number; checks: MatchCheck[]; rejectReasons: string[]; duplicates: number;
  url: string | null; network: string | null; title: string | null; excerpt: string;
  priceUsd: number | null; price: { amount: number; currency: string } | null;
  areaSqm: number | null; rooms: number | null; bedrooms: number | null; floor: number | null; totalFloors: number | null;
  propertyType: string | null; city: string | null; district: string | null; publishedAt: string | null;
  images: string[]; duplicateUrls: string[];
}
export interface CampaignResults {
  run: { id: string; status: string; createdAt: string; completedAt: string | null; searchId: string | null; originalText: string | null; criteria: CampaignCriteria };
  outcome: CampaignOutcome | null;
  settlement: CampaignSettlement;
  view: 'MATCHES' | 'EXACT' | 'POTENTIAL' | 'ALTERNATIVE'; sort: string; page: number; pageSize: number; total: number;
  items: CampaignResultItem[];
}

export async function campaignResults(runId: string, opts: { view?: string; sort?: string; page?: number; pageSize?: number } = {}): Promise<{ data: CampaignResults | null; reasonCode: string | null }> {
  const r = await invoke({ action: 'results', runId, ...opts });
  return r.status === 200 && r.data?.success ? { data: r.data as CampaignResults, reasonCode: null } : { data: null, reasonCode: r.reasonCode ?? 'LOAD_FAILED' };
}

/** Admin only: recorded campaign economics. VAT / payment fees stay null (not modelled). */
export interface CampaignEconomics {
  id: string; status: string; createdAt: string; completedAt: string | null;
  revenueCredits: number | null; revenueUsd: number | null; reservedCredits: number | null;
  providerBudgetUsd: number | null; providerCostUsd: number | null; providerReservedUsd: number; providerCostComplete: boolean;
  budgetUtilization: number | null; grossSpreadUsd: number | null; vatUsd: null; paymentFeesUsd: null; netMarginUsd: null;
  outcome: CampaignOutcome | null; costPerAvailableUsd: number | null;
  actorRuns: Array<{ actorKey: string; stage: string; network: string; status: string; requestedLimit: number | null; reservedUsd: number; actualUsd: number | null; costBasis: string | null; providerRunId: string | null; billed: number | null; fetched: number | null; offers: number | null; error: string | null }>;
}
export async function adminCampaignEconomics(limit = 20): Promise<CampaignEconomics[] | null> {
  const r = await invoke({ action: 'admin_campaigns', limit });
  return r.status === 200 && Array.isArray(r.data?.campaigns) ? r.data.campaigns as CampaignEconomics[] : null;
}

export interface CampaignState {
  id: string; status: string; stage: string | null; createdAt: string; deadlineAt: string | null; completedAt: string | null;
  failureReason: string | null; networks: OfferNetwork[]; policy: string | null;
  creditsAuthorized: number | null; creditsCharged: number | null;
  creditsUsed: number;
  offersFound: number; resultsFound: number | null;
  unavailable: Array<{ network: OfferNetwork; reason: string }>; skippedForBudget: number;
  sources: Array<{ network: string; planned: number; done: number; running: number; failed: number; budget: number }>;
}

export const OPEN_CAMPAIGN = ['QUEUED', 'SEARCHING', 'PAUSED', 'MATCHING'];

async function invoke(body: Record<string, unknown>): Promise<{ data: any; reasonCode: string | null; status: number }> {
  const { data, error } = await supabase.functions.invoke('find-property-run', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    const parsed = context && typeof context.json === 'function' ? await context.json().catch(() => null) : null;
    return { data: parsed, reasonCode: String(parsed?.reasonCode ?? 'START_FAILED'), status: Number(context?.status ?? 500) };
  }
  return { data, reasonCode: data?.reasonCode ?? null, status: 200 };
}

/** The Find Property subscription a free marketplace search created (own rows only, RLS). */
export async function subscriptionForSearch(marketplaceSearchId: string): Promise<string | null> {
  const { data } = await supabase.from('active_search_subscriptions').select('id')
    .eq('side', 'SUPPLY').eq('is_active', true).eq('search_criteria->>marketplaceSearchId', marketplaceSearchId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data?.id ? String(data.id) : null;
}

/** language: the customer's interface language, also searched for posts (offerSearchLanguages).
 *  The server searches every network Admin enabled; the customer buys the process. */
export async function previewCampaign(subscriptionId: string, credits: number, language?: string) {
  const r = await invoke({ action: 'preview', subscriptionId, authorizedMaxCredits: credits, language });
  return { preview: (r.data?.preview ?? null) as CampaignPreview | null, reasonCode: r.data?.preview ? null : r.reasonCode, minCredits: r.data?.minBudgetCredits as number | undefined };
}

export async function startCampaign(subscriptionId: string, credits: number, idempotencyKey: string, language?: string) {
  const r = await invoke({
    action: 'start', subscriptionId, authorizedMaxCredits: credits, idempotencyKey, language,
    confirm: { priceCredits: credits, acceptedTerms: true },
  });
  return { runId: r.data?.runId ? String(r.data.runId) : null, reasonCode: r.data?.runId ? null : r.reasonCode };
}

/** The temporary test amount when this account may use it (admins / listed testers, Admin switch on). */
export async function testCampaignOption(): Promise<{ credits: number } | null> {
  const r = await invoke({ action: 'test_option' }).catch(() => null);
  const o = r?.data?.testOption;
  return o && Number.isFinite(Number(o.credits)) ? { credits: Number(o.credits) } : null;
}

export async function stopCampaign(runId: string): Promise<boolean> {
  const r = await invoke({ action: 'stop', runId });
  return r.status === 200 && r.data?.success === true;
}

export async function latestCampaignId(subscriptionId: string): Promise<string | null> {
  const { data } = await supabase.from('discovery_runs').select('id').eq('subscription_id', subscriptionId)
    .not('pricing_policy', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data?.id ? String(data.id) : null;
}

export async function campaignState(runId: string): Promise<CampaignState> {
  const { data, error } = await supabase.rpc('my_find_property_campaign', { p_run_id: runId });
  if (error) throw new Error(error.message);
  const d = data as CampaignState | null;
  if (!d || typeof d !== 'object' || Array.isArray(d) || !Array.isArray(d.sources)) throw new Error('UNEXPECTED_CAMPAIGN_SHAPE');
  return d;
}

/*
 * ONE confirmation (owner, 2026-10-18): the customer approves the exact maximum on the
 * Deep Search card; the free search that the campaign extends starts first, then the
 * campaign starts with that same approval. The approval is a one-shot, per-tab token
 * bound to that search and that price: read once, removed when read, and too old after
 * ten minutes — a reload or a shared link never starts (or charges) anything by itself.
 */
export interface DeepConsent { searchId: string; credits: number; key: string; at: number }
const CONSENT_KEY = 'hm_fp_deep_consent';
const CONSENT_TTL_MS = 10 * 60_000;

export function rememberDeepConsent(searchId: string, credits: number): void {
  try { sessionStorage.setItem(CONSENT_KEY, JSON.stringify({ searchId, credits, key: crypto.randomUUID(), at: Date.now() } satisfies DeepConsent)); } catch { /* no storage: the panel asks again */ }
}

/* Taken approvals stay readable in this page's memory: a remount (or a strict-mode double
   render) gets the same approval with the same idempotency key, so the server answers with
   the campaign it already started — never a second one. */
const taken = new Map<string, DeepConsent>();

export function takeDeepConsent(searchId: string, now = Date.now()): DeepConsent | null {
  const fresh = (c: DeepConsent | undefined | null) =>
    c && Number.isFinite(c.credits) && c.credits > 0 && typeof c.key === 'string' && now - Number(c.at) <= CONSENT_TTL_MS ? c : null;
  if (taken.has(searchId)) return fresh(taken.get(searchId));
  try {
    const raw = sessionStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as DeepConsent;
    if (c?.searchId !== searchId) return null;
    sessionStorage.removeItem(CONSENT_KEY);
    taken.set(searchId, c);
    return fresh(c);
  } catch { return null; }
}

/** Every paid campaign's own, stable results page. */
export const campaignResultsPath = (runId: string) => `/find-property/campaign/${encodeURIComponent(runId)}`;

/** The search's mixed paid view (social offers re-ranked with portals) — kept for old links. */
export const paidResultsPath = (searchId: string) => `/find-property/search/${encodeURIComponent(searchId)}?view=paid&fp_socialOnly=true&page=1`;
