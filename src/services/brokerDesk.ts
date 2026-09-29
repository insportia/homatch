// Broker desk client services.
//
// Every rule lives server-side (supabase/migrations/20260930140000_broker_lifecycle.sql):
// ownership, the one-profile-per-owner rule, what an owner may change,
// verification, the directory price, suspension. These wrappers only call the
// RPCs and translate their refusal codes; nothing here decides anything.

import { supabase } from '@/db/supabase';

export type AccountType = 'PERSONAL' | 'BROKER' | 'AGENCY';
export type VerificationState = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'SUSPENDED';
export type ListingStatus = 'DRAFT' | 'PENDING_REVIEW' | 'NEEDS_CHANGES' | 'APPROVED' | 'ACTIVE' | 'EXPIRED' | 'REJECTED' | 'SUSPENDED';
export type LeadState = 'NEW' | 'REVIEWED' | 'CONTACTED' | 'IN_PROGRESS' | 'WON' | 'CLOSED';

export const LEAD_STATES: LeadState[] = ['NEW', 'REVIEWED', 'CONTACTED', 'IN_PROGRESS', 'WON', 'CLOSED'];
/** States that need an opened contact (enforced again by set_match_lead_state). */
export const CONTACT_LEAD_STATES: LeadState[] = ['CONTACTED', 'IN_PROGRESS', 'WON'];

export interface BrokerProfile {
  id: string;
  display_name: string;
  role: 'BROKER' | 'AGENCY';
  status: ListingStatus;
  cities: string[] | null;
  districts: string[] | null;
  languages: string[] | null;
  deal_kinds: string[] | null;
  property_types: string[] | null;
  segments: string[] | null;
  contact_phone: string | null;
  contact_email: string | null;
  whatsapp: string | null;
  telegram: string | null;
  website: string | null;
  about: string | null;
  contact_person: string | null;
  experience_years: number | null;
  logo_url: string | null;
  paid_until: string | null;
  review_note: string | null;
  onboarding_completed_at: string | null;
  verification_state: VerificationState;
  verification_note: string | null;
  verification_submitted_at: string | null;
  verified_at: string | null;
  created_at: string;
}

export interface DeskProperty {
  id: string;
  homatch_id: string | null;
  title: string | null;
  transaction_type: string | null;
  property_type: string | null;
  matching_status: string | null;
  listed_by_role: 'OWNER' | 'BROKER' | 'AGENCY' | null;
  created_at: string;
  archived_at: string | null;
  current_leads: number;
  opened_contacts: number;
  campaign_status: string | null;
}

export interface DeskClientSearch {
  id: string;
  side: string | null;
  client_label: string | null;
  on_behalf: boolean | null;
  is_active: boolean;
  created_at: string;
  criteria: Record<string, unknown> | null;
}

export interface BrokerDeskSummary {
  active_window_days: number;
  account: { account_type: AccountType; suspended: boolean; suspension_reason: string | null } | null;
  profile: BrokerProfile | null;
  documents: { id: string; kind: string; created_at: string }[];
  balance: number | null;
  properties: DeskProperty[];
  leads: Partial<Record<LeadState, number>>;
  client_searches: DeskClientSearch[];
  purchases: { credits: number; period_end: string; created_at: string }[];
  listing_price_credits: number | null;
  listing_duration_days: number | null;
}

/** A server refusal, with the code the RPC raised (e.g. ACCOUNT_SUSPENDED). */
export class BrokerRpcError extends Error {
  constructor(public code: string) { super(code); }
}

const CODE = /^[A-Z][A-Z_]{2,}$/;
function fail(error: { message: string }): never {
  const code = error.message.trim();
  throw new BrokerRpcError(CODE.test(code) ? code : 'UNKNOWN');
}

export async function brokerDeskSummary(): Promise<BrokerDeskSummary> {
  const { data, error } = await supabase.rpc('broker_desk_summary');
  if (error) fail(error);
  const raw = (data ?? {}) as Partial<BrokerDeskSummary>;
  return {
    active_window_days: Number(raw.active_window_days ?? 30),
    account: raw.account ?? null,
    profile: (raw.profile ?? null) as BrokerProfile | null,
    documents: raw.documents ?? [],
    balance: raw.balance == null ? null : Number(raw.balance),
    properties: raw.properties ?? [],
    leads: raw.leads ?? {},
    client_searches: raw.client_searches ?? [],
    purchases: raw.purchases ?? [],
    listing_price_credits: raw.listing_price_credits == null ? null : Number(raw.listing_price_credits),
    listing_duration_days: raw.listing_duration_days == null ? null : Number(raw.listing_duration_days),
  };
}

export interface BrokerProfileInput {
  display_name: string;
  role: 'BROKER' | 'AGENCY';
  cities: string[];
  districts: string[];
  languages: string[];
  deal_kinds: string[];
  property_types: string[];
  segments: string[];
  contact_phone: string | null;
  contact_email: string | null;
  whatsapp: string | null;
  telegram: string | null;
  website: string | null;
  about: string | null;
  contact_person: string | null;
  experience_years: number | null;
  logo_url: string | null;
}

export async function saveBrokerProfile(p: BrokerProfileInput): Promise<string> {
  const { data, error } = await supabase.rpc('broker_profile_save', {
    p_display_name: p.display_name,
    p_role: p.role,
    p_cities: p.cities,
    p_districts: p.districts,
    p_languages: p.languages,
    p_deal_kinds: p.deal_kinds,
    p_property_types: p.property_types,
    p_segments: p.segments,
    p_contact_phone: p.contact_phone,
    p_contact_email: p.contact_email,
    p_whatsapp: p.whatsapp,
    p_telegram: p.telegram,
    p_website: p.website,
    p_about: p.about,
    p_contact_person: p.contact_person,
    p_experience_years: p.experience_years,
    p_logo_url: p.logo_url,
  });
  if (error) fail(error);
  return data as string;
}

export async function completeBrokerOnboarding(): Promise<void> {
  const { error } = await supabase.rpc('broker_complete_onboarding');
  if (error) fail(error);
}

export async function submitBrokerDirectory(): Promise<void> {
  const { error } = await supabase.rpc('broker_directory_submit');
  if (error) fail(error);
}

export async function setMyAccountType(type: AccountType): Promise<void> {
  const { error } = await supabase.rpc('set_my_account_type', { p_type: type });
  if (error) fail(error);
}

/**
 * Buy or renew the public directory period. The key is created once per
 * click-intent by the caller and reused on retry, so a double submit returns
 * the first result instead of charging twice.
 */
export async function purchaseBrokerListing(idempotencyKey: string): Promise<{ duplicate: boolean; charged_credits: number; paid_until: string }> {
  const { data, error } = await supabase.rpc('broker_directory_purchase', { p_idempotency_key: idempotencyKey });
  if (error) fail(error);
  const raw = data as Record<string, unknown>;
  return { duplicate: raw.duplicate === true, charged_credits: Number(raw.charged_credits ?? 0), paid_until: String(raw.paid_until ?? '') };
}

export function newIdempotencyKey(prefix: string): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}:${rnd}`;
}

const LOGO_BUCKET = 'broker-logos';
const DOC_BUCKET = 'broker-verification';
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_DOC_BYTES = 10 * 1024 * 1024;

function safeName(name: string): string {
  const ext = (name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

/** Uploads into the owner's own folder (storage policy) and returns the public URL. */
export async function uploadBrokerLogo(authId: string, file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new BrokerRpcError('LOGO_NOT_IMAGE');
  if (file.size > MAX_LOGO_BYTES) throw new BrokerRpcError('FILE_TOO_LARGE');
  const path = `${authId}/${safeName(file.name)}`;
  const { error } = await supabase.storage.from(LOGO_BUCKET).upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw new BrokerRpcError('UPLOAD_FAILED');
  return supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Private bucket: only the owner and admins can read the file. */
export async function uploadVerificationDocument(authId: string, kind: string, file: File): Promise<void> {
  if (file.size > MAX_DOC_BYTES) throw new BrokerRpcError('FILE_TOO_LARGE');
  const path = `${authId}/${safeName(file.name)}`;
  const { error } = await supabase.storage.from(DOC_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw new BrokerRpcError('UPLOAD_FAILED');
  const { error: e2 } = await supabase.rpc('broker_verification_add_document', { p_kind: kind, p_storage_path: path });
  if (e2) fail(e2);
}

export async function submitBrokerVerification(): Promise<void> {
  const { error } = await supabase.rpc('broker_verification_submit');
  if (error) fail(error);
}

export async function setMatchLeadState(matchId: string, state: LeadState): Promise<void> {
  const { error } = await supabase.rpc('set_match_lead_state', { p_match_id: matchId, p_state: state });
  if (error) fail(error);
}

// ── Admin ────────────────────────────────────────────────────────────────

export interface BrokerReviewItem {
  id: string;
  signal_id: string;
  status: 'PENDING' | 'ACCEPTED' | 'DISMISSED' | 'DUPLICATE';
  [key: string]: unknown;
}

export async function adminListBrokerReview(status = 'PENDING', limit = 100): Promise<BrokerReviewItem[]> {
  const { data, error } = await supabase.rpc('admin_list_broker_review', { p_status: status, p_limit: limit });
  if (error) fail(error);
  return (data ?? []) as BrokerReviewItem[];
}

export async function adminResolveBrokerReview(id: string, action: 'ACCEPT' | 'DISMISS', note: string | null): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('admin_resolve_broker_review', { p_item_id: id, p_action: action, p_note: note });
  if (error) fail(error);
  return (data ?? {}) as Record<string, unknown>;
}

export async function adminSetBrokerVerification(listingId: string, state: VerificationState, note: string | null): Promise<void> {
  const { error } = await supabase.rpc('admin_set_broker_verification', { p_listing_id: listingId, p_state: state, p_note: note });
  if (error) fail(error);
}

export async function adminSetUserSuspension(userId: string, suspend: boolean, reason: string | null): Promise<void> {
  const { error } = await supabase.rpc('admin_set_user_suspension', { p_user_id: userId, p_suspend: suspend, p_reason: reason });
  if (error) fail(error);
}

export interface AdminBrokerDetail {
  listing: BrokerProfile & { owner_user_id: string };
  user: { id: string; email: string | null; full_name: string | null; account_type: AccountType; suspended_at: string | null; suspension_reason: string | null; created_at: string } | null;
  documents: { id: string; kind: string; path: string; created_at: string }[];
  properties: number;
  purchases: { credits: number; period_start: string; period_end: string }[];
  audit: { action: string; created_at: string; metadata: Record<string, unknown> | null }[];
}

export async function adminBrokerDetail(listingId: string): Promise<AdminBrokerDetail> {
  const { data, error } = await supabase.rpc('admin_broker_detail', { p_listing_id: listingId });
  if (error) fail(error);
  return data as AdminBrokerDetail;
}

/** Short-lived signed link for an admin to open a private verification document. */
export async function adminSignedDocumentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(path, 300);
  return error ? null : data.signedUrl;
}
