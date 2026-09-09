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
  Payment,
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
  ResearchProduct,
  ResearchPurchase,
  ResearchProviderTreasuryRow,
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

/**
 * matchability_score is deliberately absent: it is produced by run-matching-v2
 * under the service role and shown on the dashboard as the property's matching
 * strength, so a client that could set it could rate its own listing. The
 * database now revokes the column too; this keeps the two in step.
 */
export async function updateProperty(
  id: string,
  updates: Partial<{ title: string; matching_status: MatchingStatus; cover_photo_url: string; transaction_type: TransactionType; property_type: PropertyType }>
) {
  const { error } = await supabase.from('properties').update(updates).eq('id', id);
  if (error) console.error('updateProperty error:', error.message);
  return !error;
}

export async function softDeleteProperty(id: string) {
  const { error } = await supabase.from('properties').update({ is_deleted: true }).eq('id', id);
  if (error) console.error('softDeleteProperty error:', error.message);
  return !error;
}

// ============================================================
// PROPERTY FACTS
// ============================================================

/**
 * Throws. The facts ARE the listing -- price, city, area, rooms -- and both
 * callers (PrivateListingPage and URLImportPage) already wrap this in a
 * try/catch that shows the customer a real error. Logging and continuing meant
 * "Property added successfully!" for a property with no price and no location,
 * which then matches nothing and looks to the owner like the matching engine
 * is broken.
 */
export async function upsertPropertyFacts(facts: Partial<PropertyFacts> & { property_id: string }) {
  const { error } = await supabase
    .from('property_facts')
    .upsert(facts, { onConflict: 'property_id' });
  if (error) throw new Error(`Could not save the property details: ${error.message}`);
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
  // .select() so a DELETE that matched nothing is distinguishable from one that
  // did: PostgREST returns 204 either way.
  const { data, error } = await supabase.from('property_photos').delete().eq('id', id).select('id');
  if (error) throw new Error(`Could not delete the photo: ${error.message}`);
  if (!data || data.length === 0) throw new Error('That photo no longer exists.');
}

export async function setCoverPhoto(propertyId: string, photoId: string) {
  // Clearing the old cover and setting the new one are two statements; if the
  // second fails silently the property is left with no cover at all, which is
  // worse than the state it started in.
  const { error: clearErr } = await supabase
    .from('property_photos')
    .update({ is_cover: false })
    .eq('property_id', propertyId);
  if (clearErr) throw new Error(`Could not change the cover photo: ${clearErr.message}`);

  const { data, error: setErr } = await supabase
    .from('property_photos')
    .update({ is_cover: true })
    .eq('id', photoId)
    .select('id');
  if (setErr) throw new Error(`Could not change the cover photo: ${setErr.message}`);
  if (!data || data.length === 0) throw new Error('That photo is no longer part of this property.');
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
  const { error } = await supabase.from('property_imports').update(updates).eq('id', id);
  if (error) console.error('updateImport error:', error.message);
  return !error;
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

  // The search profile is what the matching engine matches demand against. A
  // property without one is invisible to matching, so a failure here is not a
  // detail to log -- it is the listing not working.
  //
  // (The `transaction_type` line that used to sit here read
  // `facts.source_url ? undefined : undefined`, which is undefined either way.
  // It looked like it set the field and never did; transaction_type comes from
  // the property row.)
  const { error } = await supabase.from('search_profiles').upsert({
    property_id: propertyId,
    user_id: userId,
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
  if (error) throw new Error(`Could not save the matching profile: ${error.message}`);
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

// `read` is the only column a customer may write; the database now grants only
// that one. Errors are surfaced rather than dropped, so a bell that refuses to
// clear says why instead of silently staying lit.
export async function markNotificationRead(id: string) {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
  if (error) console.error('markNotificationRead error:', error.message);
  return !error;
}

export async function markAllNotificationsRead(userId: string) {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('user_id', userId);
  if (error) console.error('markAllNotificationsRead error:', error.message);
  return !error;
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

  if (cursor) {
    // Composite seek-pagination cursor: "<match_score>|<created_at>" of the last row
    // shown on the previous page. A plain `created_at < cursor` filter here would
    // silently corrupt pagination — results are sorted by match_score FIRST, so a
    // later page could skip a higher-scored-but-earlier-created row entirely, or
    // re-show a row already seen on a previous page. This expresses the standard
    // seek-pagination predicate for a two-column sort:
    //   match_score < cursorScore  OR  (match_score = cursorScore AND created_at < cursorCreatedAt)
    const separatorIndex = cursor.indexOf('|');
    const cursorScore = Number(separatorIndex >= 0 ? cursor.slice(0, separatorIndex) : NaN);
    const cursorCreatedAt = separatorIndex >= 0 ? cursor.slice(separatorIndex + 1) : '';
    if (!Number.isNaN(cursorScore) && cursorCreatedAt) {
      q = q.or(`match_score.lt.${cursorScore},and(match_score.eq.${cursorScore},created_at.lt.${cursorCreatedAt})`);
    }
  }

  const { data } = await q;
  return Array.isArray(data) ? data : [];
}

// Cursor string for the LAST row of a getMatches() page, to pass as the `cursor`
// argument on the next call. Returns undefined when there's nothing to page from
// (empty page) — callers should treat that as "no more pages".
export function nextMatchesCursor(page: Match[]): string | undefined {
  const last = page[page.length - 1];
  if (!last) return undefined;
  return `${last.match_score}|${last.created_at}`;
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

/**
 * Records that the customer opened a match.
 *
 * Goes through an RPC rather than a direct UPDATE: matches has no UPDATE policy
 * for a customer, so the previous `.from('matches').update(...)` matched zero
 * rows and PostgREST returned 204 with no error -- the preview was never
 * recorded, which also meant the matching cleanup sweep still treated an
 * opened match as an untouched NEW row it could reject.
 *
 * Returns the match's resulting status, or null if it could not be recorded.
 */
export async function markMatchPreviewed(matchId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('mark_match_previewed', { p_match_id: matchId });
  if (error) {
    console.error('[markMatchPreviewed] failed:', error.message);
    return null;
  }
  return (data as string | null) ?? null;
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

export async function getMyPayments(userId: string, limit = 20): Promise<Payment[]> {
  const { data } = await supabase
    .from('payments')
    .select('id, user_id, provider, amount_usd, credits_issued, status, created_at, updated_at, receipt_url, invoice_url, total_cents, currency')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return Array.isArray(data) ? (data as Payment[]) : [];
}

// ============================================================
// PROFILE
// ============================================================

export interface ProfileUpdatePayload {
  full_name?: string | null;
  nickname?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
  preferred_language?: string | null;
}

// Only ever touches non-privileged columns. is_admin/plan are additionally
// hard-protected server-side by the trg_protect_privileged_user_columns
// trigger, which silently reverts any client-supplied change to them unless
// the caller is service_role — this call could never elevate privileges
// even if the payload were tampered with.
export async function updateMyProfile(userId: string, patch: ProfileUpdatePayload): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('users').update(patch).eq('id', userId);
  if (error) return { success: false, error: error.message };
  return { success: true };
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
    // Both writes are checked. Launching a campaign whose status never changed
    // leaves the engine and the UI disagreeing about whether it is running.
    const { error: campErr } = await supabase
      .from('matching_campaigns')
      .update({ status_v2: 'ACTIVE' })
      .eq('id', existing.id);
    if (campErr) throw new Error(`Could not activate the campaign: ${campErr.message}`);

    const { error: propErr } = await supabase
      .from('properties')
      .update({ matching_status: 'ACTIVE' })
      .eq('id', propertyId);
    if (propErr) throw new Error(`Could not activate the property: ${propErr.message}`);

    campaignId = existing.id;
  } else {
    const { data, error: insertErr } = await supabase
      .from('matching_campaigns')
      .insert({ property_id: propertyId, user_id: userId, status_v2: 'ACTIVE' })
      .select('id')
      .single();
    if (insertErr || !data) {
      throw new Error(`Could not create the campaign: ${insertErr?.message ?? 'no row returned'}`);
    }
    campaignId = data.id;
  }
  await logActivity(userId, 'MATCHING_STARTED', propertyId);

  // 2. Start the long-running Edge Function without blocking the UI.
  // The function persists matching_jobs immediately, so discover that exact row
  // by idempotency key and return its ID while provider work continues.
  const idempotencyKey = `ui-${propertyId}-${Date.now()}`;
  // The Edge Function canonicalises its stored idempotency key with the user ID,
  // so discover the newly-created row by property + launch timestamp instead of
  // requiring the caller-supplied key to be stored verbatim.
  const launchedAfter = new Date(Date.now() - 5_000).toISOString();
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
      .eq('property_id', propertyId)
      .gte('created_at', launchedAfter)
      .order('created_at', { ascending: false })
      .limit(1)
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
  // "Pause" is a promise that the engine stops spending the customer's credits
  // on this property, so a pause that did not land must not be reported as one.
  const { error: campErr } = await supabase
    .from('matching_campaigns')
    .update({ status_v2: 'PAUSED' })
    .eq('property_id', propertyId);
  if (campErr) throw new Error(`Could not pause the campaign: ${campErr.message}`);

  const { error: propErr } = await supabase
    .from('properties')
    .update({ matching_status: 'PAUSED' })
    .eq('id', propertyId);
  if (propErr) throw new Error(`Could not pause the property: ${propErr.message}`);

  await logActivity(userId, 'MATCHING_PAUSED', propertyId);

  const { error: notifyErr } = await supabase.from('notifications').insert({
    user_id: userId,
    type: 'MATCHING_PAUSED',
    title: 'Matching paused',
    body: 'Your matching campaign has been paused.',
    property_id: propertyId,
  });
  // The pause itself succeeded; failing to announce it is worth a log, not an
  // exception that would make the caller believe nothing was paused.
  if (notifyErr) console.error('[pauseMatchingCampaign] notification failed:', notifyErr.message);
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
    // properties has no deleted_at column (only is_deleted boolean — see
    // softDeleteProperty()/getProperties() above); filtering on deleted_at
    // here always threw a PostgREST "column does not exist" error that was
    // silently swallowed (only `data`/`count` destructured, `error`
    // ignored), so total_properties was always reported as 0.
    supabase.from('properties').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
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
  // Same fix as getAdminOverviewStats() above: properties has no deleted_at
  // column, so this always errored (silently, since `error` isn't checked
  // here either) and the admin properties list was always empty.
  const { data } = await supabase.from('properties')
    .select('*, property_facts(*), users(email)')
    .eq('is_deleted', false)
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

export interface AdminOutreachChannelStats {
  channel: 'EMAIL' | 'SMS' | 'AI_CALL';
  sent: number;
  success: number;
  failed: number;
  cost_usd: number;
}

export interface AdminOutreachCampaignRow {
  id: string;
  name: string;
  campaign_type: string;
  status: string;
  sent_count: number;
  cost_actual_usd: number;
  created_at: string;
  owner_email: string | null;
}

export interface AdminOutreachOverview {
  channels: AdminOutreachChannelStats[];
  total_campaigns: number;
  total_sends: number;
  total_cost_usd: number;
  recent_campaigns: AdminOutreachCampaignRow[];
}

// Cross-user Email/SMS/AI_CALL campaign observability. Was completely absent
// at the admin level before this (Task #65 audit) -- AdminCampaignsPage
// queries matching_campaigns, an unrelated sponsored-placement feature; the
// only other admin-adjacent read of outreach_campaigns was a single-user
// drill-down in admin-user360. outreach_campaigns.owner_id references
// auth.users, not public.users, so it can't be embedded via `users(email)`
// like matching_campaigns/payments/matches can -- resolved with a manual
// auth_id -> email lookup instead.
export async function getAdminOutreachOverview(limit = 50): Promise<AdminOutreachOverview> {
  const [campaignsRes, sendsRes] = await Promise.all([
    supabase.from('outreach_campaigns')
      .select('id, name, campaign_type, status, sent_count, cost_actual_usd, created_at, owner_id')
      .order('created_at', { ascending: false })
      .limit(limit),
    // Capped at 5000 most-recent sends rather than an unbounded full-table
    // scan -- fine for "recent channel performance" observability; a true
    // all-time rollup at higher volume should move to a server-side
    // aggregate (count()/sum() RPC) instead of fetching rows client-side.
    supabase.from('outreach_sends').select('channel, status, cost_usd').order('created_at', { ascending: false }).limit(5000),
  ]);

  const campaigns = campaignsRes.data ?? [];
  const sends = sendsRes.data ?? [];

  const ownerIds = Array.from(new Set(campaigns.map((c) => c.owner_id).filter(Boolean)));
  const emailByAuthId: Record<string, string> = {};
  if (ownerIds.length > 0) {
    const { data: owners } = await supabase.from('users').select('auth_id, email').in('auth_id', ownerIds);
    for (const o of owners ?? []) {
      if (o.auth_id) emailByAuthId[o.auth_id] = o.email;
    }
  }

  const CHANNELS: Array<'EMAIL' | 'SMS' | 'AI_CALL'> = ['EMAIL', 'SMS', 'AI_CALL'];
  const SUCCESS_STATUSES = new Set(['SENT', 'DELIVERED', 'DIALING', 'ANSWERED', 'COMPLETED']);
  const channels: AdminOutreachChannelStats[] = CHANNELS.map((channel) => {
    const rows = sends.filter((s) => s.channel === channel);
    const failed = rows.filter((s) => s.status === 'FAILED').length;
    const success = rows.filter((s) => SUCCESS_STATUSES.has(s.status)).length;
    const cost_usd = rows.reduce((sum, s) => sum + Number(s.cost_usd ?? 0), 0);
    return { channel, sent: rows.length, success, failed, cost_usd: Math.round(cost_usd * 100) / 100 };
  });

  return {
    channels,
    total_campaigns: campaigns.length,
    total_sends: sends.length,
    total_cost_usd: Math.round(channels.reduce((s, c) => s + c.cost_usd, 0) * 100) / 100,
    recent_campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      campaign_type: c.campaign_type,
      status: c.status,
      sent_count: c.sent_count ?? 0,
      cost_actual_usd: Number(c.cost_actual_usd ?? 0),
      created_at: c.created_at,
      owner_email: c.owner_id ? emailByAuthId[c.owner_id] ?? null : null,
    })),
  };
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

/**
 * Admin settings are written through admin_set_setting, not with a direct
 * UPDATE. The direct write had two silent failure modes: a key that was never
 * seeded matched zero rows (PostgREST answers 204 with no error, so a spend cap
 * or pricing knob "saved" without existing), and nothing was ever recorded in
 * admin_audit_log -- which held zero rows despite existing since phase 7.
 *
 * These keys include provider_kill_switch, the spend caps and the credit
 * pricing table. Who changed them, and when, is worth knowing.
 */
export async function updateAdminSetting(key: string, value: unknown, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_set_setting', {
    p_key: key,
    p_value: value,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(`Could not save "${key}": ${error.message}`);
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
  // Derive the provider list from whatever spend_cap_* settings actually
  // exist rather than a hardcoded list -- the previous hardcoded list
  // (dataforseo/apify/zenrows/scrapingbee/brightdata/openai) predated the
  // outreach providers (resend/twilio/retell) and silently never showed
  // their live spend/blocked status here even though AdminSpendCapsPage
  // lets an admin set caps for them and cost_events has real RETELL rows.
  const providers = ['global', ...Object.keys(caps).filter((p) => p !== 'global').sort()];
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
      updateAdminSetting(keyMap[k], v, 'pricing config')
    )
  );
}

export async function updateSpendCaps(caps: Partial<SpendCapConfig>): Promise<void> {
  await Promise.all(
    (Object.entries(caps) as [string, number][]).map(([k, v]) =>
      updateAdminSetting(`spend_cap_${k}`, v, 'spend cap')
    )
  );
}

// ============================================================
// RESEARCH PRODUCTS / PRICING / PROVIDER TREASURY
// ============================================================

export async function getResearchProducts(): Promise<ResearchProduct[]> {
  const { data } = await supabase.from('research_products').select('*').order('sort_order');
  return (data ?? []) as ResearchProduct[];
}

export async function updateResearchProduct(code: string, patch: Partial<ResearchProduct>): Promise<void> {
  await supabase.from('research_products').update({ ...patch, updated_at: new Date().toISOString() }).eq('code', code);
}

export async function getMyResearchPurchases(): Promise<ResearchPurchase[]> {
  const { data } = await supabase.from('research_purchases').select('*').order('created_at', { ascending: false });
  return (data ?? []) as ResearchPurchase[];
}

export async function getVatRateBps(): Promise<number> {
  const { data } = await supabase.from('admin_settings').select('value').eq('key', 'vat_rate_bps').maybeSingle();
  return Number(data?.value ?? 1800);
}

// The VAT rate applied to every research purchase. Same audited path as the
// rest of admin_settings -- and the same reason: a direct UPDATE on a key that
// has no row reports success and changes nothing.
export async function updateVatRateBps(bps: number): Promise<void> {
  await updateAdminSetting('vat_rate_bps', bps, 'VAT rate');
}

export async function getResearchProviderTreasury(): Promise<ResearchProviderTreasuryRow[]> {
  const { data } = await supabase.from('research_providers').select('*').order('provider_code');
  return (data ?? []) as ResearchProviderTreasuryRow[];
}

export async function updateResearchProvider(providerCode: string, patch: Partial<ResearchProviderTreasuryRow>): Promise<void> {
  await supabase.from('research_providers').update({ ...patch, updated_at: new Date().toISOString() }).eq('provider_code', providerCode);
}

// ============================================================
// LIVE CHAT MODERATION (admin)
// ============================================================

export async function getLiveChatReports() {
  const { data } = await supabase
    .from('live_chat_reports')
    .select('*, live_chat_messages(id, body, user_id, hidden_by_admin, deleted_at, created_at)')
    .order('created_at', { ascending: false })
    .limit(200);
  return data ?? [];
}

export async function dismissLiveChatReport(reportId: string): Promise<void> {
  await supabase.from('live_chat_reports').update({ status: 'DISMISSED', resolved_at: new Date().toISOString() }).eq('id', reportId);
}

export async function hideLiveChatMessage(messageId: string, reportId: string, reason: string): Promise<void> {
  await supabase.from('live_chat_messages').update({ hidden_by_admin: true, hidden_reason: reason }).eq('id', messageId);
  await supabase.from('live_chat_reports').update({ status: 'HIDDEN', resolved_at: new Date().toISOString() }).eq('id', reportId);
}

export async function suspendLiveChatUser(userId: string, reportId: string, reason: string): Promise<void> {
  await supabase.from('live_chat_profiles').update({ suspended: true, suspended_reason: reason, suspended_at: new Date().toISOString() }).eq('user_id', userId);
  await supabase.from('live_chat_reports').update({ status: 'USER_SUSPENDED', resolved_at: new Date().toISOString() }).eq('id', reportId);
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
