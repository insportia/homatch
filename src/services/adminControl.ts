/*
 * The Admin control centre's reads and writes, in one place.
 *
 * Every call here is an admin_* SQL function that checks is_admin() itself
 * (migrations 20260928200000..230000). Nothing in this file is authorisation;
 * it is a typed door. Errors are thrown, never swallowed into an empty list —
 * "the query failed" and "there is nothing" must not look the same on an
 * operations screen.
 */
import { supabase } from '@/db/supabase';

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
}

/* Blank filter values are sent as null, so an empty box means "any". */
function clean(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = v === '' || v === undefined ? null : v;
  }
  return out;
}

export interface UserBrief {
  id: string;
  email: string | null;
  full_name: string | null;
  username: string | null;
  is_admin: boolean;
}

export interface Paged<T> { rows: T[] }
/** Every paged row carries the filtered total as `total`. */
export const totalOf = (rows: Array<{ total?: number }>): number => Number(rows[0]?.total ?? 0);

/* ── overview ─────────────────────────────────────────────────────── */
export interface OverviewCounts {
  generated_at: string;
  users: { total: number; registered: number; admins: number; new_7d: number };
  properties: { total: number; active: number; archived: number; with_reference: number };
  intelligence: { signals: number; active: number; last_24h: number };
  effective_demands: number;
  matches: { internal: number; internal_compatible: number; external: number; legacy: number };
  notifications: { total: number; unread: number; last_24h: number; pushed: number };
  announcements: { draft: number; published: number };
  campaigns: { total: number; active: number; paused: number };
  billing: { credits_per_usd: number; wallet_balance_credits: number; wallet_reserved_credits: number; payments_completed_30d: number };
  providers: { total: number; by_status: Record<string, number> };
  health: { last_checked_at: string | null; db_reachable: boolean | null; storage_reachable: boolean | null; last_match_run_at: string | null; last_match_run_ok: boolean | null };
  impersonation: { enabled: boolean; active_sessions: number };
  audit: { last_24h: number };
}
export const getOverviewCounts = () => call<OverviewCounts>('admin_overview_counts');

/* ── users ────────────────────────────────────────────────────────── */
export interface UserSearchRow {
  id: string;
  auth_id: string | null;
  email: string | null;
  full_name: string | null;
  username: string | null;
  is_admin: boolean;
  created_at: string;
  registered: boolean;
  last_sign_in_at: string | null;
  has_phone: boolean;
  phone_hint: string | null;
  matched_by: 'USER_ID' | 'PROPERTY_REFERENCE' | 'EMAIL' | 'USERNAME' | 'PHONE' | 'TEXT';
  property_reference: number | null;
}
export const searchUsers = (query: string, limit = 25) =>
  call<UserSearchRow[]>('admin_search_users', { p_query: query, p_limit: limit });

/* ── lookup ───────────────────────────────────────────────────────── */
export interface LookupHit {
  kind: 'property' | 'user' | 'internal_match' | 'external_match' | 'legacy_match' | 'conversation'
    | 'campaign' | 'signal' | 'notification' | 'announcement';
  id: string;
  label: string | null;
  detail?: string | null;
  reference?: number | null;
  path: string;
}
export const adminLookup = (query: string) => call<LookupHit[]>('admin_lookup', { p_query: query });

/** Worth asking the database about: a reference, a uuid, or an email. */
export function looksLikeIdentifier(q: string): boolean {
  const s = q.trim();
  return /^#?\d{6}$/.test(s)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
    || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/* ── audit ────────────────────────────────────────────────────────── */
export interface AuditRow {
  id: string;
  created_at: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  admin: { id: string; email: string | null } | null;
  admin_ref: string;
  target: UserBrief | null;
  metadata: Record<string, unknown> | null;
  total: number;
}
export interface AuditFilters { admin?: string; action?: string; target?: string; from?: string; to?: string }
export const listAudit = (f: AuditFilters, limit: number, offset: number) =>
  call<{ actions: string[]; rows: AuditRow[] }>('admin_audit_log_list', clean({
    p_admin: f.admin, p_action: f.action, p_target: f.target, p_from: f.from, p_to: f.to,
    p_limit: limit, p_offset: offset,
  }));

/* ── properties ───────────────────────────────────────────────────── */
export interface PropertyRow {
  id: string;
  homatch_id: number | null;
  title: string | null;
  property_type: string | null;
  transaction_type: string | null;
  matching_status: string | null;
  archived_at: string | null;
  is_deleted: boolean;
  source_type: string | null;
  source_domain: string | null;
  city: string | null;
  district: string | null;
  country_code: string | null;
  created_at: string;
  owner: UserBrief | null;
  contact_phone_present: boolean;
  campaign_status: string | null;
  internal_matches: number;
  total: number;
}
export interface PropertyFilters {
  ref?: string; owner?: string; status?: string; transaction?: string;
  city?: string; district?: string; from?: string; to?: string;
}
export const searchProperties = (f: PropertyFilters, limit: number, offset: number) =>
  call<Paged<PropertyRow>>('admin_properties_search', clean({
    p_homatch_id: f.ref && /^\d{6}$/.test(f.ref.replace('#', '')) ? Number(f.ref.replace('#', '')) : null,
    p_owner: f.owner, p_status: f.status, p_transaction: f.transaction,
    p_city: f.city, p_district: f.district, p_created_from: f.from, p_created_to: f.to,
    p_limit: limit, p_offset: offset,
  }));

export interface PropertyDetail {
  id: string;
  homatch_id: number | null;
  title: string | null;
  property_type: string | null;
  transaction_type: string | null;
  matching_status: string | null;
  matchability_score: number | null;
  archived_at: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  owner: UserBrief | null;
  owner_has_phone: boolean | null;
  contact_phone_present: boolean;
  contact_phone_country: string | null;
  provenance: {
    source_type: string | null; source_domain: string | null; source_url: string | null;
    source_language: string | null; extraction_confidence: number | null;
    developer_id: string | null; canonical_group_id: string | null;
    last_import: { status: string; error_code: string | null; created_at: string; provider: string | null } | null;
  };
  facts: {
    country_code: string | null; city: string | null; district: string | null;
    price: number | null; currency: string | null; area: number | null; bedrooms: number | null; rooms: number | null;
  };
  matching: {
    campaign: { id: string; status: string; languages: string[] | null; created_at: string } | null;
    last_job: { id: string; status: string; completed_at: string | null; matches_created: number; failure_reason: string | null } | null;
    internal_matches: number; internal_compatible: number; legacy_matches: number; interest_signals: number;
  };
}
export const getPropertyDetail = (id: string) => call<PropertyDetail | null>('admin_property_detail', { p_property_id: id });
export const revealPropertyContact = (id: string, reason: string) =>
  call<{ listing_phone: string | null; owner_phone: string | null }>('admin_property_reveal_contact', { p_property_id: id, p_reason: reason });

/* ── intelligence ─────────────────────────────────────────────────── */
export type Firmness = 'REQUIRED' | 'PREFERRED' | 'FLEXIBLE';
export interface SignalRow {
  id: string;
  actor: UserBrief | null;
  source_surface: string;
  source_event_id: string;
  source_at: string;
  side: string;
  act: string;
  dimension: string | null;
  polarity: string;
  attribution: string;
  explicit: boolean;
  confidence: number;
  scope: string;
  strength: Record<string, Firmness>;
  constraints: Record<string, unknown>;
  property_id: string | null;
  property_homatch_id: number | null;
  intent_profile_id: string | null;
  conversation_id: string | null;
  status: 'ACTIVE' | 'WITHDRAWN' | 'SUPERSEDED';
  superseded_by: string | null;
  withdrawn_at: string | null;
  withdrawn_reason: string | null;
  created_at: string;
  total: number;
}
export interface SignalFilters {
  user?: string; surface?: string; act?: string; side?: string; status?: string;
  from?: string; to?: string; ref?: string; signal?: string;
}
export const listSignals = (f: SignalFilters, limit: number, offset: number) =>
  call<Paged<SignalRow>>('admin_intent_signals', clean({
    p_user: f.user, p_source_surface: f.surface, p_act: f.act, p_side: f.side, p_status: f.status,
    p_from: f.from, p_to: f.to,
    p_homatch_id: f.ref && /^\d{6}$/.test(f.ref.replace('#', '')) ? Number(f.ref.replace('#', '')) : null,
    p_signal_id: f.signal, p_limit: limit, p_offset: offset,
  }));

export interface EffectiveDemand {
  user: UserBrief | null;
  projections: Array<{
    subscription_id: string; intent_profile_id: string | null; side: string; is_active: boolean;
    created_at: string; last_notified_at: string | null; origin: 'CONVERSATION' | 'SEARCH' | 'UNKNOWN';
    intent_type: string | null; transaction_type: string | null; country: string | null; city: string | null;
    district: string | null; neighborhoods: string[] | null; property_types: string[] | null;
    bedrooms_min: number | null; bedrooms_max: number | null; area_min: number | null; area_max: number | null;
    budget_min: number | null; budget_max: number | null; currency: string | null; confidence: number | null;
    criteria: Record<string, unknown>;
  }>;
  firmness: Record<string, Firmness>;
  signals: { active: number; withdrawn: number; superseded: number; last_stated_at: string | null };
}
export const getEffectiveDemand = (userId: string) =>
  call<EffectiveDemand>('admin_user_effective_demand', { p_user_id: userId });

/* ── matches ──────────────────────────────────────────────────────── */
export interface SupplyMatchRow {
  id: string;
  kind: 'INTERNAL' | 'EXTERNAL';
  compatibility: string;
  score: number;
  deal_kind: string | null;
  demand_role: string | null;
  supply_role: string | null;
  agreed: string[];
  conflicted: string[];
  unknown_dimensions: string[];
  flexible_dimensions: string[];
  created_at: string;
  updated_at: string;
  demand_id: string | null;
  property: { id: string; homatch_id: number | null; title: string | null } | null;
  supply_user: UserBrief | null;
  demand_user: UserBrief | null;
  counterparty: null;
  external_refs: { signal_id: string; observation_id: string } | null;
  campaign: { id: string; status: string; owner: UserBrief | null; property_homatch_id: number | null } | null;
  notifications: Array<{ side: string; recipient: string; created_at: string; read: boolean; pushed_at: string | null }> | null;
  conversation_exists: boolean | null;
  total: number;
}
export interface MatchFilters {
  kind?: 'INTERNAL' | 'EXTERNAL'; ref?: string; user?: string; deal?: string; compatibility?: string;
  from?: string; to?: string; id?: string;
}
export const listSupplyMatches = (f: MatchFilters, limit: number, offset: number) =>
  call<Paged<SupplyMatchRow> & { counts: { internal: number; external: number } }>('admin_supply_matches', clean({
    p_kind: f.kind,
    p_homatch_id: f.ref && /^\d{6}$/.test(f.ref.replace('#', '')) ? Number(f.ref.replace('#', '')) : null,
    p_user: f.user, p_deal_kind: f.deal, p_compatibility: f.compatibility,
    p_from: f.from, p_to: f.to, p_id: f.id, p_limit: limit, p_offset: offset,
  }));

/* ── notifications ────────────────────────────────────────────────── */
export interface NotificationRow {
  id: string;
  recipient: UserBrief | null;
  type: string;
  kind: string | null;
  priority: string | null;
  title: string | null;
  created_at: string;
  read: boolean;
  seen_at: string | null;
  read_at: string | null;
  pushed_at: string | null;
  entity_type: string | null;
  entity_id: string | null;
  property_id: string | null;
  deep_link: string | null;
  dedupe_key: string | null;
  group_key: string | null;
  total: number;
}
export interface NotificationFilters {
  type?: string; recipient?: string; read?: '' | 'read' | 'unread'; pushed?: '' | 'yes' | 'no';
  from?: string; to?: string; id?: string;
}
export const listNotifications = (f: NotificationFilters, limit: number, offset: number) =>
  call<Paged<NotificationRow> & { types: string[] }>('admin_notifications_list', clean({
    p_type: f.type, p_recipient: f.recipient,
    p_read: f.read === 'read' ? true : f.read === 'unread' ? false : null,
    p_pushed: f.pushed === 'yes' ? true : f.pushed === 'no' ? false : null,
    p_from: f.from, p_to: f.to, p_id: f.id, p_limit: limit, p_offset: offset,
  }));

/* ── announcements ────────────────────────────────────────────────── */
export type LocaleText = Partial<Record<'en' | 'ka' | 'ru' | 'tr' | 'ar' | 'he', string>>;
export interface AnnouncementRow {
  id: string;
  slug: string;
  title: LocaleText;
  body: LocaleText | null;
  deep_link: string | null;
  audience: string;
  published_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: UserBrief | null;
  delivered: number;
  read: number;
}
export const listAnnouncements = () => call<AnnouncementRow[]>('admin_announcements_list');
export const saveAnnouncement = (a: { id: string | null; slug: string; title: LocaleText; body: LocaleText; deep_link: string }) =>
  call<AnnouncementRow>('admin_announcement_save', {
    p_id: a.id, p_slug: a.slug, p_title: a.title, p_body: a.body, p_deep_link: a.deep_link || null,
  });
export const publishAnnouncement = (slug: string) =>
  call<{ accounts: number; newly_delivered: number; already_delivered: number }>('admin_announcement_publish', { p_slug: slug });
export const setAnnouncementArchived = (slug: string, archived: boolean) =>
  call<AnnouncementRow>('admin_announcement_set_archived', { p_slug: slug, p_archived: archived });

/* ── campaigns ────────────────────────────────────────────────────── */
export interface CampaignRow {
  id: string;
  state: string;
  created_at: string;
  updated_at: string;
  language_mode: string | null;
  languages_selected: string[] | null;
  languages_resolved: string[] | null;
  property: { id: string; homatch_id: number | null; title: string | null; transaction_type: string | null; city: string | null } | null;
  owner: UserBrief | null;
  wallet_balance_credits: number | null;
  budget_credits: number;
  spent_credits: number;
  provider_cogs_usd: number;
  runs: number;
  last_run: { status: string; completed_at: string | null; matches_created: number } | null;
  total: number;
}
export interface CampaignFilters { owner?: string; state?: string; transaction?: string; language?: string; id?: string }
export const listCampaigns = (f: CampaignFilters, limit: number, offset: number) =>
  call<Paged<CampaignRow> & { credits_per_usd: number }>('admin_campaigns_list', clean({
    p_owner: f.owner, p_state: f.state, p_transaction: f.transaction, p_language: f.language, p_id: f.id,
    p_limit: limit, p_offset: offset,
  }));

/* ── system ───────────────────────────────────────────────────────── */
export interface SystemFacts {
  generated_at: string;
  background_jobs: {
    by_state_24h: Record<string, number>; in_flight: number; stale_heartbeat: number;
    last_completed_at: string | null; last_failed_at: string | null; last_failed_code: string | null;
  };
  matching_jobs: { last_completed_at: string | null; last_failed_at: string | null; last_failure_reason: string | null; runs_24h: number };
  providers: Array<{
    provider: string; status: string; last_tested_at: string | null; last_success_at: string | null;
    latency_ms: number | null; success_count: number; failure_count: number; last_error: string | null;
  }>;
  health_log: { last: { checked_at: string; db_reachable: boolean; storage_reachable: boolean; supabase_reachable: boolean; notes: string | null } | null; checks_24h: number };
}
export const getSystemFacts = () => call<SystemFacts>('admin_system_facts');

/* ── impersonation ────────────────────────────────────────────────── */
export interface ImpersonationSessionRow {
  id: string;
  admin: { id: string; email: string | null } | null;
  target: UserBrief | null;
  reason: string;
  started_at: string;
  expires_at: string | null;
  ended_at: string | null;
  ended_reason: string | null;
  revoked: boolean;
}
export const listImpersonationSessions = (limit = 20) =>
  call<{ enabled: boolean; rows: ImpersonationSessionRow[] }>('admin_impersonation_sessions', { p_limit: limit });

async function invokeImpersonation(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('impersonate-user', { body });
  if (error) {
    let message = error.message;
    try {
      const ctx = (error as { context?: { json?: () => Promise<{ error?: string; code?: string }> } }).context;
      const parsed = ctx?.json ? await ctx.json() : null;
      if (parsed?.error) message = parsed.code ? `${parsed.code}: ${parsed.error}` : parsed.error;
    } catch { /* keep the transport message */ }
    throw new Error(message);
  }
  return data as Record<string, unknown>;
}

export const startImpersonation = (targetUserId: string, reason: string) =>
  invokeImpersonation({ action: 'start', target_user_id: targetUserId, reason });
export const endImpersonationById = (sessionId: string) =>
  invokeImpersonation({ action: 'end', session_id: sessionId });
