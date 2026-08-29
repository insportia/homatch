// HOMATCH — API layer (frontend data access)
// All Supabase queries go through this file.

import { supabase } from '@/db/supabase';
import type {
  Property,
  PropertyFacts,
  PropertyPhoto,
  PropertyImport,
  SearchProfile,
  ActivityEvent,
  Notification,
  User,
  UserPreference,
  SupportedLanguage,
  TransactionType,
  PropertyType,
  MatchingStatus,
  Match,
  MatchUnlock,
  CreditAccount,
  CreditLedgerEntry,
  CostEvent,
  AdminOverviewStats,
  AdminSetting,
  ProviderHealth,
  SpendCapStatus,
  SpendCapConfig,
  AdminProviderCostRow,
  PricingConfig,
} from '@/types/types';

// ============================================================
// USERS
// ============================================================

export async function getUser(authId: string): Promise<User | null> {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('auth_id', authId)
    .maybeSingle();
  return data ?? null;
}

export async function getUserPreference(userId: string): Promise<UserPreference | null> {
  const { data } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return data ?? null;
}

export async function upsertUserLanguage(userId: string, language: SupportedLanguage) {
  await supabase.from('user_preferences').upsert({
    user_id: userId,
    language,
  });
}

// ============================================================
// PROPERTIES
// ============================================================

export async function getProperties(userId: string, cursor?: string, limit = 20): Promise<Property[]> {
  let query = supabase
    .from('properties')
    .select(`
      *,
      facts:property_facts(*),
      photos:property_photos(id, public_url, is_cover, display_order, visibility),
      search_profile:search_profiles(*)
    `)
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data } = await query;
  return Array.isArray(data) ? data : [];
}

export async function getProperty(id: string): Promise<Property | null> {
  const { data } = await supabase
    .from('properties')
    .select(`
      *,
      facts:property_facts(*),
      photos:property_photos(*),
      import:property_imports(*),
      search_profile:search_profiles(*)
    `)
    .eq('id', id)
    .eq('is_deleted', false)
    .maybeSingle();
  return data ?? null;
}

export interface CreatePropertyInput {
  userId: string;
  sourceType: 'URL_IMPORT' | 'PRIVATE_LISTING';
  title?: string;
  transactionType?: TransactionType;
  propertyType?: PropertyType;
}

export async function createProperty(input: CreatePropertyInput): Promise<string | null> {
  const { data, error } = await supabase
    .from('properties')
    .insert({
      user_id: input.userId,
      source_type: input.sourceType,
      title: input.title ?? null,
      transaction_type: input.transactionType ?? null,
      property_type: input.propertyType ?? null,
      matching_status: 'DRAFT',
    })
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('createProperty error:', error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function updateProperty(
  id: string,
  updates: Partial<{ title: string; matching_status: MatchingStatus; matchability_score: number; cover_photo_url: string; transaction_type: TransactionType; property_type: PropertyType }>
) {
  await supabase.from('properties').update(updates).eq('id', id);
}

export async function softDeleteProperty(id: string) {
  await supabase.from('properties').update({ is_deleted: true }).eq('id', id);
}

// ============================================================
// PROPERTY FACTS
// ============================================================

export async function upsertPropertyFacts(facts: Partial<PropertyFacts> & { property_id: string }) {
  const { error } = await supabase
    .from('property_facts')
    .upsert(facts, { onConflict: 'property_id' });
  if (error) console.error('upsertPropertyFacts error:', error.message);
}

// ============================================================
// PROPERTY PHOTOS
// ============================================================

export async function getPropertyPhotos(propertyId: string): Promise<PropertyPhoto[]> {
  const { data } = await supabase
    .from('property_photos')
    .select('*')
    .eq('property_id', propertyId)
    .order('display_order', { ascending: true })
    .limit(5);
  return Array.isArray(data) ? data : [];
}

export async function countPropertyPhotos(propertyId: string): Promise<number> {
  const { count } = await supabase
    .from('property_photos')
    .select('*', { count: 'exact', head: true })
    .eq('property_id', propertyId);
  return count ?? 0;
}

export async function addPropertyPhoto(photo: Omit<PropertyPhoto, 'id' | 'created_at'>) {
  const { data, error } = await supabase
    .from('property_photos')
    .insert(photo)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

export async function deletePropertyPhoto(id: string) {
  await supabase.from('property_photos').delete().eq('id', id);
}

export async function setCoverPhoto(propertyId: string, photoId: string) {
  // Remove all cover flags then set new one
  await supabase
    .from('property_photos')
    .update({ is_cover: false })
    .eq('property_id', propertyId);
  await supabase
    .from('property_photos')
    .update({ is_cover: true })
    .eq('id', photoId);
}

export async function uploadPropertyPhoto(
  userId: string,
  propertyId: string,
  file: File
): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const filename = `${userId}/${propertyId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { data, error } = await supabase.storage
    .from('property-photos')
    .upload(filename, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  const { data: urlData } = supabase.storage
    .from('property-photos')
    .getPublicUrl(data.path);
  return urlData.publicUrl;
}

// ============================================================
// PROPERTY IMPORTS
// ============================================================

export async function createImport(input: { userId: string; sourceUrl: string; mockMode?: boolean }): Promise<string | null> {
  const { data, error } = await supabase
    .from('property_imports')
    .insert({
      user_id: input.userId,
      source_url: input.sourceUrl,
      status: 'PENDING',
      mock_mode: input.mockMode ?? false,
    })
    .select('id')
    .maybeSingle();
  if (error) return null;
  return data?.id ?? null;
}

export async function getImport(id: string): Promise<PropertyImport | null> {
  const { data } = await supabase
    .from('property_imports')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return data ?? null;
}

export async function updateImport(id: string, updates: Partial<PropertyImport>) {
  await supabase.from('property_imports').update(updates).eq('id', id);
}

// ============================================================
// SEARCH PROFILES
// ============================================================

export async function createSearchProfile(
  propertyId: string,
  userId: string,
  facts: Partial<PropertyFacts>
): Promise<void> {
  const priceFlex = 0.2;
  const areaFlex = 0.2;
  const minPrice = facts.total_price ? facts.total_price * (1 - priceFlex) : undefined;
  const maxPrice = facts.total_price ? facts.total_price * (1 + priceFlex) : undefined;
  const minArea = facts.area ? facts.area * (1 - areaFlex) : undefined;
  const maxArea = facts.area ? facts.area * (1 + areaFlex) : undefined;

  await supabase.from('search_profiles').upsert({
    property_id: propertyId,
    user_id: userId,
    transaction_type: facts.source_url ? undefined : undefined, // set from property
    country: facts.country,
    region: facts.region,
    city: facts.city,
    district: facts.district,
    min_price: minPrice ?? null,
    max_price: maxPrice ?? null,
    currency: facts.currency,
    min_area: minArea ?? null,
    max_area: maxArea ?? null,
    min_bedrooms: facts.bedrooms ? Math.max(1, facts.bedrooms - 1) : null,
    max_bedrooms: facts.bedrooms ? facts.bedrooms + 1 : null,
    new_build: facts.new_build,
  }, { onConflict: 'property_id' });
}

// ============================================================
// ACTIVITY EVENTS
// ============================================================

export async function logActivity(
  userId: string,
  eventType: ActivityEvent['event_type'],
  propertyId?: string,
  metadata?: Record<string, unknown>
) {
  await supabase.from('activity_events').insert({
    user_id: userId,
    event_type: eventType,
    property_id: propertyId ?? null,
    metadata: metadata ?? null,
  });
}

export async function getActivityEvents(userId: string, limit = 30): Promise<ActivityEvent[]> {
  const { data } = await supabase
    .from('activity_events')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return Array.isArray(data) ? data : [];
}

// ============================================================
// NOTIFICATIONS
// ============================================================

export async function getNotifications(userId: string, limit = 20): Promise<Notification[]> {
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return Array.isArray(data) ? data : [];
}

export async function markNotificationRead(id: string) {
  await supabase.from('notifications').update({ read: true }).eq('id', id);
}

export async function markAllNotificationsRead(userId: string) {
  await supabase.from('notifications').update({ read: true }).eq('user_id', userId);
}

// ============================================================
// MATCHES
// ============================================================

export async function getMatches(
  propertyId: string,
  cursor?: string,
  limit = 20
): Promise<Match[]> {
  let q = supabase
    .from('matches')
    .select(
      'id, property_id, campaign_id, signal_id, intent_profile_id, match_score, intent_confidence, signal_strength, match_reasons, mismatch_reasons, unlock_price_credits, status, preview_platform, preview_language, preview_city, preview_budget_min, preview_budget_max, preview_currency, preview_bedrooms, preview_excerpt, preview_recency, created_at, updated_at'
    )
    .eq('property_id', propertyId)
    .neq('status', 'REJECTED')
    .order('match_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (cursor) q = q.lt('created_at', cursor);

  const { data } = await q;
  return Array.isArray(data) ? data : [];
}

export async function getMatchCounts(propertyId: string): Promise<{
  total: number;
  newCount: number;
  strongCount: number;
}> {
  const { data } = await supabase
    .from('matches')
    .select('id, status, signal_strength')
    .eq('property_id', propertyId)
    .neq('status', 'REJECTED');

  const rows = Array.isArray(data) ? data : [];
  return {
    total: rows.length,
    newCount: rows.filter(r => r.status === 'NEW').length,
    strongCount: rows.filter(r =>
      ['STRONG', 'VERY_STRONG', 'EXCEPTIONAL'].includes(r.signal_strength)
    ).length,
  };
}

export async function getUnlockedMatch(
  matchId: string
): Promise<MatchUnlock | null> {
  const { data } = await supabase
    .from('match_unlocks')
    .select(
      'id, match_id, user_id, credits_charged, full_signal_text, full_source_url, full_profile_url, full_intent_json, created_at'
    )
    .eq('match_id', matchId)
    .maybeSingle();
  return data ?? null;
}

export async function markMatchPreviewed(matchId: string) {
  await supabase
    .from('matches')
    .update({ status: 'PREVIEWED' })
    .eq('id', matchId)
    .eq('status', 'NEW');
}

export async function unlockMatch(matchId: string): Promise<{
  success: boolean;
  unlock?: MatchUnlock;
  newBalance?: number;
  error?: string;
  errorCode?: string;
}> {
  const { data, error } = await supabase.functions.invoke('atomic-unlock', {
    body: { matchId },
  });

  if (error) {
    const msg = await error?.context?.text?.().catch(() => error.message);
    let parsed: { error?: string; error_code?: string } = {};
    try { parsed = JSON.parse(msg); } catch { /* ignore */ }
    return { success: false, error: parsed.error ?? msg, errorCode: parsed.error_code };
  }

  return data as { success: boolean; unlock?: MatchUnlock; newBalance?: number };
}

// ============================================================
// CREDITS
// ============================================================

export async function getCreditAccount(userId: string): Promise<CreditAccount | null> {
  const { data } = await supabase
    .from('credit_accounts')
    .select('id, user_id, balance, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  return data ?? null;
}

export async function getCreditLedger(
  userId: string,
  cursor?: string,
  limit = 30
): Promise<CreditLedgerEntry[]> {
  let q = supabase
    .from('credit_ledger')
    .select('id, user_id, amount, balance_before, balance_after, type, reference, payment_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (cursor) q = q.lt('created_at', cursor);

  const { data } = await q;
  return Array.isArray(data) ? data : [];
}

export async function initiateTopUp(amountUsd: number): Promise<{
  success: boolean;
  checkoutUrl?: string;
  creditsToIssue?: number;
  mock?: boolean;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke('credits-topup', {
    body: {
      amountUsd,
      successUrl: `${window.location.origin}/credits?topup=success`,
      cancelUrl: `${window.location.origin}/credits?topup=cancelled`,
    },
  });

  if (error) {
    const msg = await error?.context?.text?.().catch(() => error.message);
    return { success: false, error: msg };
  }
  return data;
}

// ============================================================
// CAMPAIGNS
// ============================================================

export async function startMatchingCampaign(
  propertyId: string,
  userId: string
): Promise<{ jobId: string; campaignId: string } | null> {
  // 1. Upsert campaign record
  let campaignId: string;
  const { data: existing } = await supabase
    .from('matching_campaigns')
    .select('id, status_v2')
    .eq('property_id', propertyId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('matching_campaigns')
      .update({ status_v2: 'ACTIVE' })
      .eq('id', existing.id);
    await supabase
      .from('properties')
      .update({ matching_status: 'ACTIVE' })
      .eq('id', propertyId);
    campaignId = existing.id;
  } else {
    const { data } = await supabase
      .from('matching_campaigns')
      .insert({ property_id: propertyId, user_id: userId, status_v2: 'ACTIVE' })
      .select('id')
      .single();
    if (!data) return null;
    campaignId = data.id;
  }
  await logActivity(userId, 'MATCHING_STARTED', propertyId);

  // 2. Start the long-running Edge Function without blocking the UI.
  // The function persists matching_jobs immediately, so discover that exact row
  // by idempotency key and return its ID while provider work continues.
  const idempotencyKey = `ui-${propertyId}-${Date.now()}`;
  let invocationFailure: Error | null = null;
  const invocation = supabase.functions.invoke('match-campaign', {
    body: { propertyId, campaignId, idempotencyKey },
  }).then(({ data, error }) => {
    if (error) throw new Error(`match-campaign EF error: ${error.message}`);
    if (!data?.jobId) throw new Error('match-campaign returned no jobId');
    return { jobId: String(data.jobId), campaignId };
  }).catch((error: unknown) => {
    invocationFailure = error instanceof Error ? error : new Error(String(error));
    return null;
  });

  // matching_jobs is normally visible through RLS within the first second.
  for (let attempt = 0; attempt < 30; attempt++) {
    const { data: createdJob } = await supabase
      .from('matching_jobs')
      .select('id')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (createdJob?.id) {
      return { jobId: String(createdJob.id), campaignId };
    }
    if (invocationFailure) throw invocationFailure;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const completed = await invocation;
  if (!completed) {
    throw invocationFailure ?? new Error('match-campaign did not create a matching job');
  }
  return completed;
}
export async function pauseMatchingCampaign(
  propertyId: string,
  userId: string
): Promise<void> {
  await supabase
    .from('matching_campaigns')
    .update({ status_v2: 'PAUSED' })
    .eq('property_id', propertyId);

  await supabase
    .from('properties')
    .update({ matching_status: 'PAUSED' })
    .eq('id', propertyId);

  await logActivity(userId, 'MATCHING_PAUSED', propertyId);

  await supabase.from('notifications').insert({
    user_id: userId,
    type: 'MATCHING_PAUSED',
    title: 'Matching paused',
    body: 'Your matching campaign has been paused.',
    property_id: propertyId,
  });
}

// ============================================================
// COST EVENTS (admin read)
// ============================================================

export async function getRecentCostEvents(limit = 50): Promise<CostEvent[]> {
  const { data } = await supabase
    .from('cost_events')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(limit);
  return Array.isArray(data) ? data : [];
}

// ============================================================
// MATCHABILITY
// ============================================================

// ── ADMIN API ─────────────────────────────────────────────────────────────────

export async function isCurrentUserAdmin(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from('users').select('is_admin').eq('auth_id', user.id).single();
  return data?.is_admin === true;
}

export async function getAdminOverviewStats(): Promise<AdminOverviewStats> {
  const [usersRes, propertiesRes, campaignsRes, rawSignalsRes, qualifiedRes,
         matchesRes, unlocksRes, creditsRes, cogsRes] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }),
    supabase.from('properties').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    supabase.from('matching_campaigns').select('id', { count: 'exact', head: true }),
    supabase.from('raw_signals').select('id', { count: 'exact', head: true }),
    supabase.from('raw_signals').select('id', { count: 'exact', head: true }).eq('classification_status', 'CLASSIFIED'),
    supabase.from('matches').select('id', { count: 'exact', head: true }),
    supabase.from('match_unlocks').select('credits_charged'),
    supabase.from('credit_ledger').select('amount, type'),
    supabase.from('cost_events').select('cost_usd'),
  ]);
  const totalUnlocks = unlocksRes.data?.length ?? 0;
  const totalMatches = matchesRes.count ?? 0;
  const revenue = (unlocksRes.data ?? []).reduce((s, r) => s + Number(r.credits_charged ?? 0), 0);
  const cogs = (cogsRes.data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  const creditsPurchased = (creditsRes.data ?? [])
    .filter(r => r.type === 'TOP_UP').reduce((s, r) => s + Number(r.amount), 0);
  const creditsConsumed = (creditsRes.data ?? [])
    .filter(r => r.type === 'MATCH_UNLOCK').reduce((s, r) => s + Math.abs(Number(r.amount)), 0);
  const grossProfit = revenue - cogs;
  return {
    total_users: usersRes.count ?? 0,
    total_properties: propertiesRes.count ?? 0,
    total_campaigns: campaignsRes.count ?? 0,
    raw_signals: rawSignalsRes.count ?? 0,
    qualified_signals: qualifiedRes.count ?? 0,
    total_matches: totalMatches,
    total_unlocks: totalUnlocks,
    unlock_conversion_rate: totalMatches > 0 ? (totalUnlocks / totalMatches) * 100 : 0,
    cache_hit_rate: 0, // populated from cost_events cache_hit flag
    credits_purchased: creditsPurchased,
    credits_consumed: creditsConsumed,
    cogs_usd: cogs,
    revenue_usd: revenue,
    gross_profit_usd: grossProfit,
    gross_margin_pct: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
  };
}

export async function getAdminUsers(limit = 50, offset = 0) {
  const { data } = await supabase.from('users')
    .select('*, credit_accounts(balance)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  return data ?? [];
}

export async function getAdminProperties(limit = 50, offset = 0) {
  const { data } = await supabase.from('properties')
    .select('*, property_facts(*), users(email)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  return data ?? [];
}

export async function getAdminCampaigns(limit = 50, offset = 0) {
  const { data } = await supabase.from('matching_campaigns')
    .select('*, properties(title, property_facts(city)), users(email)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  return data ?? [];
}

export async function getAdminSources(limit = 100, offset = 0) {
  const { data } = await supabase.from('source_registry')
    .select('*')
    .order('quality_score', { ascending: false })
    .range(offset, offset + limit - 1);
  return data ?? [];
}

export async function toggleSourceActive(sourceId: string, active: boolean) {
  await supabase.from('source_registry').update({ active }).eq('id', sourceId);
}

export async function getAdminSignals(limit = 50, offset = 0, status?: string) {
  let q = supabase.from('raw_signals').select('*').order('discovered_at', { ascending: false });
  if (status) q = q.eq('classification_status', status);
  const { data } = await q.range(offset, offset + limit - 1);
  return data ?? [];
}

export async function getAdminMatches(limit = 50, offset = 0) {
  const { data } = await supabase.from('matches')
    .select('*, properties(title), users(email)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  return data ?? [];
}

export async function getAdminPayments(limit = 50, offset = 0) {
  const { data } = await supabase.from('payments')
    .select('*, users(email)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  return data ?? [];
}

export async function getProviderHealth(): Promise<ProviderHealth[]> {
  const { data } = await supabase.from('provider_health').select('*').order('provider');
  return (data ?? []) as ProviderHealth[];
}

export async function getAdminSettings(): Promise<AdminSetting[]> {
  const { data } = await supabase.from('admin_settings').select('*').order('key');
  return (data ?? []) as AdminSetting[];
}

export async function updateAdminSetting(key: string, value: unknown): Promise<void> {
  await supabase.from('admin_settings')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('key', key);
}

export async function getSpendCapStatus(): Promise<SpendCapStatus[]> {
  // Get current month cost per provider
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [settings, costs] = await Promise.all([
    supabase.from('admin_settings').select('key, value').like('key', 'spend_cap_%'),
    supabase.from('cost_events')
      .select('provider, cost_usd')
      .gte('timestamp', monthStart.toISOString()),
  ]);
  const caps: Record<string, number> = {};
  for (const s of settings.data ?? []) {
    // Values are stored as JSON-quoted strings e.g. `"250"` — strip quotes before parsing
    const raw = typeof s.value === 'string' ? s.value.replace(/^"|"$/g, '') : String(s.value ?? '0');
    caps[s.key.replace('spend_cap_', '')] = Number(raw);
  }
  const spent: Record<string, number> = {};
  for (const c of costs.data ?? []) {
    const k = (c.provider as string).toLowerCase();
    spent[k] = (spent[k] ?? 0) + Number(c.cost_usd ?? 0);
  }
  // Sum all for global
  const globalSpent = Object.values(spent).reduce((a, b) => a + b, 0);
  const providers = ['global', 'dataforseo', 'apify', 'zenrows', 'scrapingbee', 'brightdata', 'openai'];
  return providers.map(p => {
    const capUsd = caps[p] ?? 999999;
    const spentUsd = p === 'global' ? globalSpent : (spent[p] ?? 0);
    const pct = capUsd > 0 ? (spentUsd / capUsd) * 100 : 0;
    return { provider: p.toUpperCase(), cap_usd: capUsd, spent_usd: spentUsd, pct, warning: pct >= 80, blocked: pct >= 100 };
  });
}

export async function getProviderCostBreakdown(): Promise<AdminProviderCostRow[]> {
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  const { data } = await supabase.from('cost_events')
    .select('provider, cost_usd, success, cache_hit')
    .gte('timestamp', monthStart.toISOString());
  const rows: Record<string, AdminProviderCostRow> = {};
  for (const c of data ?? []) {
    const p = c.provider as string;
    if (!rows[p]) rows[p] = { provider: p, total_cost_usd: 0, total_calls: 0, success_count: 0, failure_count: 0, cache_hits: 0, cost_per_qualified_signal: 0, cost_per_unlock: 0 };
    rows[p].total_cost_usd += Number(c.cost_usd ?? 0);
    rows[p].total_calls += 1;
    if (c.success) rows[p].success_count += 1; else rows[p].failure_count += 1;
    if (c.cache_hit) rows[p].cache_hits += 1;
  }
  return Object.values(rows);
}

export async function getAdminImportDiagnostics(limit = 50, offset = 0) {
  const { data } = await supabase.from('property_imports')
    .select('*, properties(title)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  // Normalise: source_url is the canonical field; keep backward compat with old 'url' column
  return (data ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    source_url: r.source_url ?? r.url,
    fetch_strategy: r.fetch_strategy ?? r.render_provider_used ?? 'DIRECT',
    fallback_chain: r.fallback_chain ?? [],
  }));
}

export async function getPricingConfig(): Promise<PricingConfig> {
  const { data } = await supabase.from('admin_settings').select('key, value').like('key', 'pricing_%');
  const m: Record<string, number> = {};
  for (const s of data ?? []) m[s.key] = Number(s.value);
  return {
    min_credits: m['pricing_min_credits'] ?? 0.10,
    max_credits: m['pricing_max_credits'] ?? 10.0,
    base_potential: m['pricing_base_potential'] ?? 0.50,
    base_good: m['pricing_base_good'] ?? 1.00,
    base_strong: m['pricing_base_strong'] ?? 2.00,
    base_very_strong: m['pricing_base_very_strong'] ?? 3.50,
    base_exceptional: m['pricing_base_exceptional'] ?? 5.00,
    multiplier_recency: m['pricing_multiplier_recency'] ?? 1.3,
    multiplier_source_quality: m['pricing_multiplier_source_quality'] ?? 1.2,
    multiplier_cogs: m['pricing_multiplier_cogs'] ?? 1.15,
  };
}

export async function updatePricingConfig(cfg: Partial<PricingConfig>): Promise<void> {
  const keyMap: Record<keyof PricingConfig, string> = {
    min_credits: 'pricing_min_credits', max_credits: 'pricing_max_credits',
    base_potential: 'pricing_base_potential', base_good: 'pricing_base_good',
    base_strong: 'pricing_base_strong', base_very_strong: 'pricing_base_very_strong',
    base_exceptional: 'pricing_base_exceptional', multiplier_recency: 'pricing_multiplier_recency',
    multiplier_source_quality: 'pricing_multiplier_source_quality', multiplier_cogs: 'pricing_multiplier_cogs',
  };
  await Promise.all(
    (Object.entries(cfg) as [keyof PricingConfig, number][]).map(([k, v]) =>
      supabase.from('admin_settings').update({ value: v, updated_at: new Date().toISOString() }).eq('key', keyMap[k])
    )
  );
}

export async function updateSpendCaps(caps: Partial<SpendCapConfig>): Promise<void> {
  await Promise.all(
    (Object.entries(caps) as [string, number][]).map(([k, v]) =>
      supabase.from('admin_settings').update({ value: v, updated_at: new Date().toISOString() }).eq('key', `spend_cap_${k}`)
    )
  );
}

export function calculateMatchability(facts: Partial<PropertyFacts> | null): {
  score: number;
  improvements: string[];
} {
  if (!facts) return { score: 0, improvements: ['Complete property details to start matching.'] };

  const checks: { pass: boolean; weight: number; hint?: string }[] = [
    { pass: !!facts.country, weight: 5, hint: undefined },
    { pass: !!facts.city, weight: 10, hint: 'Add a city to improve matching.' },
    { pass: !!facts.district, weight: 10, hint: 'Add a district to improve matching precision.' },
    { pass: !!facts.neighborhood, weight: 5, hint: 'Add a neighborhood for more specific matching.' },
    { pass: !!facts.total_price, weight: 15, hint: 'Add a price to improve buyer matching.' },
    { pass: !!facts.area, weight: 10, hint: 'Add the area size to improve matching.' },
    { pass: !!facts.bedrooms, weight: 8, hint: 'Specify the number of bedrooms.' },
    { pass: !!facts.bathrooms, weight: 4, hint: undefined },
    { pass: !!facts.description && (facts.description?.length ?? 0) > 50, weight: 12, hint: 'A detailed description helps Homatch find better matches.' },
    { pass: !!facts.new_build !== undefined, weight: 5, hint: undefined },
    { pass: !!facts.condition, weight: 5, hint: 'Specify the property condition.' },
    { pass: (facts.parking || facts.elevator || facts.balcony) === true, weight: 5, hint: 'Add amenities to improve match quality.' },
    { pass: false, weight: 6, hint: 'Add photos to improve match quality.' }, // photos counted externally
  ];

  const maxScore = checks.reduce((s, c) => s + c.weight, 0);
  const earnedScore = checks.filter(c => c.pass).reduce((s, c) => s + c.weight, 0);
  const score = Math.round((earnedScore / maxScore) * 100);
  const improvements = checks.filter(c => !c.pass && c.hint).map(c => c.hint as string);

  return { score: Math.max(0, Math.min(100, score)), improvements };
}

// ============================================================
// DEMO / MOCK MATCHING
// ============================================================

/** Seed 6 mock match fixtures for a property via Edge Function. */
export async function seedDemoMatches(propertyId: string): Promise<{
  success: boolean;
  seeded: number;
  message: string;
  error?: string;
}> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { success: false, seeded: 0, message: 'Not authenticated', error: 'UNAUTHORIZED' };

  try {
    const res = await supabase.functions.invoke('seed-demo-matches', {
      body: { propertyId },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.error) throw new Error(res.error.message);
    return res.data as { success: boolean; seeded: number; message: string };
  } catch (e: any) {
    return { success: false, seeded: 0, message: e.message ?? 'Unknown error', error: e.message };
  }
}
