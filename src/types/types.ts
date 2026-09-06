// ============================================================
// HOMATCH — Core Type Definitions (Part 1)
// ============================================================

// --- Enums ---

export type TransactionType = 'SALE' | 'RENT' | 'INVESTMENT';
export type PropertyType =
  | 'APARTMENT'
  | 'HOUSE'
  | 'VILLA'
  | 'COMMERCIAL'
  | 'LAND'
  | 'OFFICE'
  | 'PENTHOUSE'
  | 'STUDIO'
  | 'TOWNHOUSE'
  | 'OTHER';
export type PropertySourceType = 'URL_IMPORT' | 'PRIVATE_LISTING';
export type MatchingStatus = 'ACTIVE' | 'PAUSED' | 'DRAFT' | 'COMPLETED';
export type ImportStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CACHED';
export type ImportErrorCode =
  | 'INVALID_URL'
  | 'NOT_A_LISTING'
  | 'SOURCE_BLOCKED'
  | 'JS_RENDER_REQUIRED'
  | 'RENDER_PROVIDER_UNAVAILABLE'
  | 'EXTRACTION_FAILED'
  | 'LOGIN_REQUIRED'
  | 'RATE_LIMITED';
export type PhotoVisibility = 'PUBLIC' | 'PRIVATE' | 'AUTHENTICATED';
export type AddressVisibility = 'FULL' | 'CITY_ONLY' | 'HIDDEN';
export type ActivityEventType =
  | 'PROPERTY_ADDED'
  | 'IMPORT_STARTED'
  | 'IMPORT_COMPLETED'
  | 'IMPORT_FAILED'
  | 'PRIVATE_LISTING_CREATED'
  | 'MATCHING_STARTED'
  | 'MATCHING_PAUSED'
  | 'PROPERTY_DELETED'
  | 'MATCH_AVAILABLE'
  | 'MATCH_UNLOCKED'
  | 'CREDITS_TOPPED_UP'
  | 'CREDITS_CHARGED'
  | 'CAMPAIGN_PAUSED'
  | 'CAMPAIGN_RESUMED';
export type NotificationType =
  | 'IMPORT_COMPLETED'
  | 'IMPORT_FAILED'
  | 'MATCHING_STARTED'
  | 'MATCHING_PAUSED'
  | 'LOW_CREDITS'
  | 'CREDITS_LOW'
  | 'MATCH_FOUND'
  | 'MATCH_AVAILABLE'
  | 'MATCH_UNLOCKED'
  | 'CREDITS_TOPPED_UP'
  | 'CAMPAIGN_PAUSED';
export type ConditionType = 'NEW' | 'GOOD' | 'NEEDS_RENOVATION' | 'UNDER_CONSTRUCTION';
export type BuildingType = 'PANEL' | 'BRICK' | 'MONOLITH' | 'WOOD' | 'OTHER';
export type HeatingType = 'CENTRAL' | 'GAS' | 'ELECTRIC' | 'NONE' | 'OTHER';

// --- User & Preferences ---

export interface User {
  id: string;           // Homatch internal UUID
  auth_id: string;      // Supabase auth.uid()
  email: string;
  full_name?: string;
  nickname?: string | null;
  phone?: string | null;
  avatar_url?: string;
  is_admin: boolean;
  plan?: string;
  preferred_language?: string | null;
  created_at: string;
  updated_at: string;
}

// --- Admin ---

export type ProviderStatus =
  | 'NOT_CONFIGURED'
  | 'MOCK'
  | 'CONFIGURED_UNVERIFIED'
  | 'REAL_TEST_PASSED'
  | 'ERROR';

export interface AdminSetting {
  id: string;
  key: string;
  value: unknown;
  description?: string;
  updated_by?: string;
  updated_at: string;
}

export interface ProviderHealth {
  id: string;
  provider: string;
  status: ProviderStatus;
  last_tested_at?: string;
  last_success_at?: string;
  latency_ms?: number;
  last_error?: string;
  success_count: number;
  failure_count: number;
  updated_at: string;
}

export interface AdminOverviewStats {
  total_users: number;
  total_properties: number;
  total_campaigns: number;
  raw_signals: number;
  qualified_signals: number;
  total_matches: number;
  total_unlocks: number;
  unlock_conversion_rate: number;
  cache_hit_rate: number;
  credits_purchased: number;
  credits_consumed: number;
  cogs_usd: number;
  revenue_usd: number;
  gross_profit_usd: number;
  gross_margin_pct: number;
}

export interface AdminProviderCostRow {
  provider: string;
  total_cost_usd: number;
  total_calls: number;
  success_count: number;
  failure_count: number;
  cache_hits: number;
  cost_per_qualified_signal: number;
  cost_per_unlock: number;
}

export interface SpendCapConfig {
  global: number;
  dataforseo: number;
  apify: number;
  zenrows: number;
  scrapingbee: number;
  brightdata: number;
  openai: number;
  resend: number;
  twilio: number;
  retell: number;
}

export interface SpendCapStatus {
  provider: string;
  cap_usd: number;
  spent_usd: number;
  pct: number;
  warning: boolean;  // >= 80%
  blocked: boolean;  // >= 100%
}

export interface PricingConfig {
  min_credits: number;
  max_credits: number;
  base_potential: number;
  base_good: number;
  base_strong: number;
  base_very_strong: number;
  base_exceptional: number;
  multiplier_recency: number;
  multiplier_source_quality: number;
  multiplier_cogs: number;
}

// ── Research products / pricing / provider treasury ──────────
export type ResearchProductCategory = 'TELEGRAM' | 'FACEBOOK' | 'GOOGLE';

export interface ResearchProduct {
  id: string;
  code: string;
  name: string;
  category: ResearchProductCategory;
  unit_count: number;
  price_cents: number; // VAT-inclusive retail price
  vat_rate_bps: number;
  reference_cogs_cents: number;
  target_contribution_cents: number;
  currency: string;
  enabled: boolean;
  sort_order: number;
}

export interface ResearchPurchase {
  id: string;
  user_id: string;
  product_code: string;
  units_purchased: number;
  units_used: number;
  units_remaining: number;
  price_cents_snapshot: number;
  vat_rate_bps_snapshot: number;
  status: 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED' | 'CANCELLED';
  created_at: string;
}

export interface ResearchProviderTreasuryRow {
  id: string;
  provider_code: string;
  display_name: string;
  enabled: boolean;
  kill_switch: boolean;
  billing_model: 'SUBSCRIPTION' | 'PAYG';
  billing_currency: string;
  reference_cost_usd_cents: number | null;
  included_usage: number | null;
  current_usage: number;
  estimated_cogs_cents: number;
  actual_cogs_cents: number | null;
  daily_cap_cents: number | null;
  monthly_cap_cents: number | null;
  daily_spend_cents: number;
  monthly_spend_cents: number;
  health_status: 'ACTIVE' | 'DEGRADED' | 'DOWN' | 'LOCKED' | 'NOT_CONFIGURED';
  last_success_at: string | null;
  last_failure_at: string | null;
  notes: string | null;
  effective_date: string;
}

// ── Live Chat ─────────────────────────────────────────────────
export interface LiveChatProfile {
  user_id: string;
  nickname: string;
  avatar_color: string;
  suspended: boolean;
  suspended_reason?: string | null;
  last_active_at: string;
}

export interface LiveChatMessage {
  id: string;
  seq: number;
  user_id: string;
  body: string;
  reply_to_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  hidden_by_admin: boolean;
  hidden_reason: string | null;
  created_at: string;
  author?: LiveChatProfile | null;
  reply_to?: { id: string; body: string; nickname: string } | null;
}

export interface LiveChatReport {
  id: string;
  message_id: string;
  reporter_id: string;
  reason: string;
  status: 'PENDING' | 'DISMISSED' | 'HIDDEN' | 'USER_SUSPENDED';
  created_at: string;
}

export interface UserPreference {
  id: string;
  user_id: string;
  language: SupportedLanguage;
  created_at: string;
  updated_at: string;
}

// --- Market ---

export interface Market {
  id: string;
  country_code: string;
  country_name: string;
  enabled: boolean;
  launch_priority: number;
  default_currency: string;
  supported_languages: SupportedLanguage[];
  query_pack_id?: string;
  created_at: string;
  updated_at: string;
}

// --- Property ---

export interface Property {
  id: string;
  user_id: string;
  source_type: PropertySourceType;
  title?: string;
  transaction_type?: TransactionType;
  property_type?: PropertyType;
  matching_status: MatchingStatus;
  matchability_score?: number;
  cover_photo_url?: string;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  // Joined relations
  facts?: PropertyFacts;
  photos?: PropertyPhoto[];
  import?: PropertyImport;
  search_profile?: SearchProfile;
}

export interface PropertyFacts {
  id: string;
  property_id: string;
  source_url?: string;
  canonical_url?: string;
  external_listing_id?: string;
  source_listing_id?: string;
  source_domain?: string;
  source_language?: string;
  extraction_confidence?: number;
  // Location — global free-text; no dropdown restriction
  country?: string;
  country_code?: string;
  region?: string;
  city?: string;
  district?: string;
  neighborhood?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  // Price
  total_price?: number;
  price_per_sqm?: number;
  currency?: string;
  // Size
  area?: number;
  rooms?: number;        // total room count (living + sleeping)
  bedrooms?: number;     // sleeping rooms only — null if unproven
  bathrooms?: number;
  floor?: number;
  total_floors?: number;
  // Building
  construction_status?: ConditionType;
  condition?: ConditionType;
  new_build?: boolean;
  building_type?: BuildingType;
  // Amenities (boolean flags)
  parking?: boolean;
  balcony?: boolean;
  terrace?: boolean;
  elevator?: boolean;
  security?: boolean;
  concierge?: boolean;
  yard?: boolean;
  furnished?: boolean;
  heating?: HeatingType;
  air_conditioning?: boolean;
  view?: string;
  // Text
  description?: string;
  original_description?: string;
  features?: string[];
  // Media (imported from URL or extracted)
  cover_image?: string;
  gallery_images?: string[];
  // Privacy
  photo_visibility?: PhotoVisibility;
  address_visibility?: AddressVisibility;
  // Dates
  listing_created_at?: string;
  listing_updated_at?: string;
  created_at: string;
  updated_at: string;
}

export interface PropertyPhoto {
  id: string;
  property_id: string;
  storage_path: string;
  public_url?: string;
  display_order: number;
  is_cover: boolean;
  visibility: PhotoVisibility;
  original_filename?: string;
  file_size?: number;
  width?: number;
  height?: number;
  created_at: string;
}

export interface PropertyImport {
  id: string;
  property_id?: string;
  user_id: string;
  source_url: string;
  canonical_url?: string;
  status: ImportStatus;
  error_code?: ImportErrorCode;
  error_message?: string;
  pipeline_log?: PipelineLogEntry[];
  raw_html_sample?: string;
  extracted_data?: Record<string, unknown>;
  render_provider_used?: string;
  mock_mode?: boolean;
  created_at: string;
  updated_at: string;
}

export interface PipelineLogEntry {
  step: string;
  success: boolean;
  message?: string;
  duration_ms?: number;
  timestamp: string;
}

export interface SearchProfile {
  id: string;
  property_id: string;
  user_id: string;
  transaction_type?: TransactionType;
  property_type?: PropertyType;
  country?: string;
  region?: string;
  city?: string;
  district?: string;
  min_price?: number;
  max_price?: number;
  currency?: string;
  min_area?: number;
  max_area?: number;
  min_bedrooms?: number;
  max_bedrooms?: number;
  new_build?: boolean;
  keywords?: string[];
  ai_summary?: string;
  created_at: string;
  updated_at: string;
}

// ── PART 2 ENUMS ─────────────────────────────────────────────

export type IntentType =
  | 'BUY' | 'RENT' | 'INVEST' | 'RELOCATE_BUY' | 'RELOCATE_RENT'
  | 'SELLER' | 'AGENT_AD' | 'PROPERTY_AD' | 'SPAM' | 'NOISE' | 'UNKNOWN';

export const BUYER_INTENT_TYPES: IntentType[] = [
  'BUY', 'RENT', 'INVEST', 'RELOCATE_BUY', 'RELOCATE_RENT',
];

export type SignalPlatform =
  | 'GOOGLE' | 'BING' | 'FACEBOOK' | 'TELEGRAM' | 'INSTAGRAM' | 'VK'
  | 'FORUM' | 'WEBSITE' | 'OTHER';

export type SourceType =
  | 'FACEBOOK_GROUP' | 'TELEGRAM_GROUP' | 'VK_COMMUNITY'
  | 'INSTAGRAM_PROFILE' | 'FORUM' | 'WEBSITE' | 'SEARCH_RESULT';

export type ClassificationStatus =
  | 'PENDING' | 'FILTERED_OUT' | 'CANDIDATE' | 'CLASSIFIED' | 'ERROR';

export type SignalStrength =
  | 'POTENTIAL' | 'GOOD' | 'STRONG' | 'VERY_STRONG' | 'EXCEPTIONAL';

export type MatchStatus =
  | 'NEW' | 'PREVIEWED' | 'UNLOCKED' | 'ARCHIVED' | 'REJECTED';

export type LedgerType =
  | 'TOP_UP' | 'MATCH_UNLOCK' | 'ADMIN_ADJUSTMENT' | 'REFUND'
  | 'SERVICE_RESERVE' | 'SERVICE_CAPTURE' | 'SERVICE_RELEASE';

export type PaymentStatus =
  | 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';

export type CostProvider =
  | 'DATAFORSEO' | 'APIFY' | 'ZENROWS' | 'SCRAPINGBEE'
  | 'BRIGHTDATA' | 'OPENAI' | 'OTHER';

export type IntegrationStatus =
  | 'NOT_CONFIGURED' | 'MOCK' | 'CONFIGURED' | 'REAL_TEST_PASSED' | 'ERROR';

export type CampaignStatus =
  | 'ACTIVE' | 'PAUSED' | 'LOW_BALANCE' | 'ARCHIVED';

// ── MATCHING CAMPAIGN ─────────────────────────────────────────

export interface MatchingCampaign {
  id: string;
  property_id: string;
  user_id: string;
  status: CampaignStatus;
  status_v2: CampaignStatus;
  created_at: string;
  updated_at: string;
}

// ── QUERY PACK ────────────────────────────────────────────────

export interface QueryPack {
  id: string;
  country: string;
  city?: string;
  district?: string;
  language: string;
  transaction?: string;
  property_type?: string;
  intent_type?: string;
  priority: number;
  active: boolean;
  queries: string[];
  last_run_at?: string;
  next_run_at?: string;
  created_at: string;
  updated_at: string;
}

// ── SOURCE REGISTRY ───────────────────────────────────────────

export interface SourceRegistryEntry {
  id: string;
  platform: SignalPlatform;
  source_type: SourceType;
  external_id?: string;
  name?: string;
  url: string;
  country_code: string;
  language?: string;
  active: boolean;
  priority: number;
  quality_score?: number;
  provider?: string;
  last_collected_at?: string;
  last_successful_at?: string;
  failure_count: number;
  created_at: string;
  updated_at: string;
}

// ── RAW SIGNAL ────────────────────────────────────────────────

export interface RawSignal {
  id: string;
  source_id?: string;
  platform: SignalPlatform;
  external_id?: string;
  source_url?: string;
  author_public_name?: string;
  author_public_url?: string;
  original_text: string;
  language?: string;
  published_at?: string;
  discovered_at: string;
  last_seen_at: string;
  content_fingerprint?: string;
  provider?: string;
  classification_status: ClassificationStatus;
  created_at: string;
}

// ── INTENT PROFILE ────────────────────────────────────────────

export interface IntentProfile {
  id: string;
  signal_id?: string;
  intent_type: IntentType;
  country?: string;
  region?: string;
  city?: string;
  district?: string;
  neighborhoods?: string[];
  transaction_type?: string;
  property_types?: string[];
  bedrooms_min?: number;
  bedrooms_max?: number;
  area_min?: number;
  area_max?: number;
  budget_min?: number;
  budget_max?: number;
  currency?: string;
  timeline?: string;
  relocation_intent: boolean;
  investment_intent: boolean;
  language?: string;
  intent_confidence?: number;
  specificity_score?: number;
  actionability_score?: number;
  original_text?: string;
  translated_text?: string;
  ai_model?: string;
  ai_cost_usd?: number;
  created_at: string;
}

// ── MATCH ─────────────────────────────────────────────────────

export interface Match {
  id: string;
  property_id: string;
  campaign_id?: string;
  signal_id?: string;
  intent_profile_id?: string;
  match_score: number;
  intent_confidence: number;
  signal_strength: SignalStrength;
  match_reasons: string[];
  mismatch_reasons?: string[];
  unlock_price_credits: number;
  status: MatchStatus;
  mock_mode?: boolean;
  // Whether this match is for an external (non-Homatch) signal
  is_external?: boolean;
  is_homatch_user?: boolean;
  // Locked preview (always safe to expose before unlock)
  preview_platform?: SignalPlatform;
  preview_language?: string;
  preview_city?: string;
  preview_budget_min?: number;
  preview_budget_max?: number;
  preview_currency?: string;
  preview_bedrooms?: number;   // integer, not string
  preview_excerpt?: string;
  preview_recency?: string;
  created_at: string;
  updated_at: string;
}

// ── MATCH UNLOCK (full reveal) ────────────────────────────────

export interface MatchUnlock {
  id: string;
  match_id: string;
  user_id: string;
  credits_charged: number;
  ledger_entry_id?: string;
  // Only returned after successful unlock
  full_signal_text?: string;
  full_source_url?: string;
  full_profile_url?: string;
  full_intent_json?: IntentProfile;
  created_at: string;
}

// ── CREDIT ACCOUNT ────────────────────────────────────────────

export interface CreditAccount {
  id: string;
  user_id: string;
  balance: number;
  created_at: string;
  updated_at: string;
}

// ── CREDIT LEDGER ─────────────────────────────────────────────

export interface CreditLedgerEntry {
  id: string;
  user_id: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  type: LedgerType;
  reference?: string;
  payment_id?: string;
  created_at: string;
}

// ── PAYMENT ───────────────────────────────────────────────────

export interface Payment {
  id: string;
  user_id: string;
  provider: string;
  provider_id?: string;
  amount_usd: number;
  credits_issued: number;
  status: PaymentStatus;
  webhook_verified: boolean;
  idempotency_key?: string;
  metadata?: Record<string, unknown>;
  receipt_url?: string | null;
  invoice_url?: string | null;
  total_cents?: number | null;
  currency?: string;
  created_at: string;
  updated_at: string;
}

// ── COST EVENT ────────────────────────────────────────────────

export interface CostEvent {
  id: string;
  provider: CostProvider;
  operation_type: string;
  source?: string;
  market?: string;
  request_id?: string;
  units?: number;
  cost_usd: number;
  success: boolean;
  cache_hit: boolean;
  property_id?: string;
  signal_id?: string;
  timestamp: string;
}

// ── PROVIDER STATUS MAP ───────────────────────────────────────

export interface ProviderStatusMap {
  dataforseo: IntegrationStatus;
  apify_facebook: IntegrationStatus;
  apify_telegram: IntegrationStatus;
  apify_instagram: IntegrationStatus;
  apify_vk: IntegrationStatus;
  openai: IntegrationStatus;
  payment: IntegrationStatus;
}

// ── MATCHING ENGINE RESULT ────────────────────────────────────

export interface MatchEngineResult {
  propertyId: string;
  intentProfileId: string;
  matchScore: number;
  intentConfidence: number;
  signalStrength: SignalStrength;
  matchReasons: string[];
  mismatchReasons: string[];
  unlockPriceCredits: number;
  previewExcerpt: string;
}

// ── UNLOCK REQUEST / RESPONSE ─────────────────────────────────

export interface UnlockRequest {
  matchId: string;
}

export interface UnlockResponse {
  success: boolean;
  unlock?: MatchUnlock;
  newBalance?: number;
  error?: string;
  errorCode?: string;
}

// --- Activity & Notifications ---

export interface ActivityEvent {
  id: string;
  user_id: string;
  property_id?: string;
  event_type: ActivityEventType;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body?: string;
  read: boolean;
  property_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

// --- Matchability ---

export interface MatchabilityBreakdown {
  score: number; // 0-100
  factors: MatchabilityFactor[];
  improvements: string[];
}

export interface MatchabilityFactor {
  name: string;
  weight: number;
  score: number;
  label: string;
}

// --- Languages ---

export type SupportedLanguage = 'en' | 'ka' | 'ru' | 'tr' | 'ar' | 'he';
export const RTL_LANGUAGES: SupportedLanguage[] = ['ar', 'he'];
export const SUPPORTED_LANGUAGES: { code: SupportedLanguage; label: string; nativeLabel: string }[] = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'ka', label: 'Georgian', nativeLabel: 'ქართული' },
  { code: 'ru', label: 'Russian', nativeLabel: 'Русский' },
  { code: 'tr', label: 'Turkish', nativeLabel: 'Türkçe' },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية' },
  { code: 'he', label: 'Hebrew', nativeLabel: 'עברית' },
];

// --- Georgia Locations ---

// ── Phase 7: Community & Outreach Engine ─────────────────────

export type CommunityPlatform = 'TELEGRAM' | 'FACEBOOK' | 'VK' | 'REDDIT' | 'LINKEDIN' | 'THREADS' | 'WHATSAPP' | 'OTHER';
export type PostingPolicy = 'OPEN' | 'APPROVAL_REQUIRED' | 'CLOSED' | 'UNKNOWN';
export type CommunityRecStatus = 'PENDING' | 'OPEN' | 'POST_GENERATED' | 'COPIED' | 'POSTED' | 'SKIPPED';
export type SocialPostStatus = 'DRAFT' | 'REVIEWED' | 'POSTED' | 'SKIPPED' | 'CANCELLED';
export type SocialPostMode = 'manual' | 'ai_draft' | 'shorter' | 'professional' | 'investor' | 'buyer' | 'translate';
export type OutreachCampaignType = 'EMAIL' | 'SMS' | 'AI_CALL' | 'COMMUNITY' | 'DIRECT_MATCH' | 'MULTI_CHANNEL';
export type OutreachCampaignStatus = 'DRAFT' | 'READY' | 'SCHEDULED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
export type OutreachProvider = 'WIX' | 'AWS_SES' | 'RETELL' | 'VAPI' | 'TWILIO' | 'MOCK';
export type OutreachQueueStatus = 'PENDING' | 'SUPPRESSED' | 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'BOUNCED' | 'COMPLAINED' | 'OPTED_OUT';
export type AiCallStatus = 'DRAFT' | 'QUEUED' | 'DIALING' | 'ANSWERED' | 'NO_ANSWER' | 'BUSY' | 'FAILED' | 'COMPLETED' | 'OPTED_OUT';
export type ContactListStatus = 'PENDING' | 'ANALYZING' | 'READY' | 'FAILED' | 'ARCHIVED';
export type LeadType = 'BUYER' | 'INVESTOR' | 'AGENT' | 'TENANT' | 'OTHER' | 'UNKNOWN';
export type PhoneConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNRESOLVED';
export type AdminRoleType = 'SUPER_ADMIN' | 'SUPPORT_ADMIN' | 'BILLING_ADMIN' | 'READ_ONLY';
export type ConsentStatus = 'active' | 'withdrawn';

export interface Community {
  id: string;
  platform: CommunityPlatform;
  canonical_id: string;
  canonical_url: string;
  name: string;
  description?: string;
  language?: string;
  country?: string;
  region?: string;
  city?: string;
  tags?: string[];
  topics?: string[];
  member_count?: number;
  posting_policy?: PostingPolicy;
  posting_allowed?: boolean | null;
  allows_auto_post?: boolean;
  /** primary = dedicated real-estate community; secondary = general/expat/classifieds
   *  community where housing posts appear alongside other topics. */
  housing_focus?: 'primary' | 'secondary';
  is_active?: boolean;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface CommunityRecommendation {
  id: string;
  property_id: string;
  community_id: string;
  owner_id: string;
  score: number;
  rationale: Record<string, unknown>;
  status: CommunityRecStatus;
  posted_at?: string;
  campaign_id?: string;
  created_at?: string;
  updated_at?: string;
  // Joined fields
  platform?: CommunityPlatform;
  name?: string;
  canonical_url?: string;
  member_count?: number;
  language?: string;
  country?: string;
  city?: string;
  posting_policy?: PostingPolicy;
  tags?: string[];
}

export interface SocialPost {
  id: string;
  owner_id: string;
  property_id?: string;
  community_id?: string;
  recommendation_id?: string;
  platform: string;
  language: string;
  content: string;
  content_version?: number;
  generation_mode?: SocialPostMode;
  status: SocialPostStatus;
  posted_at?: string;
  campaign_id?: string;
  ai_instructions?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface ContactList {
  id: string;
  owner_id: string;
  name: string;
  description?: string;
  source_filename?: string;
  source_format?: 'CSV' | 'XLSX' | 'JSON' | 'MANUAL';
  raw_storage_path?: string;
  total_rows?: number;
  valid_rows?: number;
  invalid_rows?: number;
  duplicate_rows?: number;
  missing_email?: number;
  missing_phone?: number;
  segments?: Array<{ name: string; count: number; criteria: Record<string, unknown> }>;
  column_map?: Record<string, string>;
  import_status: ContactListStatus;
  retention_until?: string;
  terms_consent_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Contact {
  id: string;
  list_id: string;
  owner_id: string;
  full_name?: string;
  email?: string;
  phone?: string;
  phone_raw?: string;
  company?: string;
  country?: string;
  city?: string;
  language?: string;
  budget_min?: number;
  budget_max?: number;
  currency?: string;
  lead_type?: LeadType;
  tags?: string[];
  notes?: string;
  custom_fields?: Record<string, unknown>;
  raw_row?: Record<string, unknown>;
  email_valid?: boolean;
  phone_valid?: boolean;
  phone_e164_confidence?: PhoneConfidence;
  country_inferred?: boolean;
  language_inferred?: boolean;
  is_duplicate?: boolean;
  validation_flags?: string[];
  do_not_contact?: boolean;
  do_not_call?: boolean;
  unsubscribed?: boolean;
  suppressed?: boolean;
  created_at?: string;
}

export interface OutreachCampaign {
  id: string;
  owner_id: string;
  name: string;
  campaign_type: OutreachCampaignType;
  status: OutreachCampaignStatus;
  property_id?: string;
  contact_list_id?: string;
  subject?: string;
  html_body?: string;
  text_body?: string;
  language?: string;
  sender_name?: string;
  sender_email?: string;
  reply_to?: string;
  ai_instructions?: string;
  scheduled_at?: string;
  provider?: OutreachProvider;
  audience_count?: number;
  sent_count?: number;
  delivered_count?: number;
  open_count?: number;
  click_count?: number;
  bounce_count?: number;
  complaint_count?: number;
  unsubscribe_count?: number;
  cost_estimate_usd?: number;
  cost_actual_usd?: number;
  call_script?: string;
  call_agent_config?: Record<string, unknown>;
  sms_template?: string;
  approved_by?: string;
  approved_at?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface AiCallRecord {
  id: string;
  campaign_id?: string;
  owner_id: string;
  contact_id?: string;
  phone_number: string;
  status: AiCallStatus;
  provider?: OutreachProvider;
  provider_call_id?: string;
  agent_config?: Record<string, unknown>;
  language?: string;
  duration_sec?: number;
  transcript?: string;
  summary?: string;
  detected_language?: string;
  intent?: string;
  qualification_score?: number;
  lead_score?: number;
  follow_up_needed?: boolean;
  follow_up_notes?: string;
  cost_usd?: number;
  call_started_at?: string;
  call_ended_at?: string;
  created_at?: string;
}

export interface AdminRole {
  id: string;
  user_id: string;
  role: AdminRoleType;
  granted_by?: string;
  granted_at?: string;
  revoked_at?: string;
  notes?: string;
}

export interface AdminAuditEvent {
  id: string;
  admin_id: string;
  target_id?: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface ImpersonationSession {
  id: string;
  admin_id: string;
  target_user_id: string;
  reason: string;
  started_at?: string;
  ended_at?: string;
}

export interface TermsConsent {
  id: string;
  user_id: string;
  terms_version: string;
  privacy_version: string;
  legal_purpose: string;
  accepted_at?: string;
  status: ConsentStatus;
  withdrawn_at?: string;
}

export interface CostPreview {
  channel: string;
  unit_count: number;
  unit_label: string;
  unit_price: number;
  total_estimate_usd: number;
  breakdown: string;
  requires_approval: boolean;
  approval_threshold_usd: number;
}

export interface ImpersonationBanner {
  message: string;
  admin_email: string;
  reason: string;
}

export interface User360 {
  user: User | null;
  properties: Array<{ id: string; title: string; property_type: string; matching_status: string; created_at: string }>;
  campaigns: Array<{ id: string; name: string; campaign_type: string; status: string; audience_count: number; cost_estimate_usd: number; created_at: string }>;
  contact_lists: Array<{ id: string; name: string; import_status: string; total_rows: number; valid_rows: number; created_at: string }>;
  credits: { balance: number; lifetime_purchased: number; lifetime_spent: number } | null;
  ai_conversations: Array<{ id: string; created_at: string }>;
  recent_cost_events: Array<{ operation_type: string; cost_usd: number; timestamp: string; property_id: string }>;
}

export interface GeoLocation {
  country: string;
  region?: string;
  city: string;
  districts?: string[];
}

export const GE_LOCATIONS: GeoLocation[] = [
  {
    country: 'GE',
    city: 'Tbilisi',
    districts: [
      'Vake', 'Saburtalo', 'Krtsanisi', 'Ortachala', 'Vera', 'Mtatsminda',
      'Sololaki', 'Avlabari', 'Isani', 'Didube', 'Dighomi', 'Gldani',
      'Nadzaladevi', 'Samgori',
    ],
  },
  { country: 'GE', city: 'Batumi' },
  { country: 'GE', city: 'Kutaisi' },
  { country: 'GE', city: 'Rustavi' },
  { country: 'GE', city: 'Borjomi' },
  { country: 'GE', city: 'Bakuriani' },
  { country: 'GE', city: 'Gudauri' },
  { country: 'GE', city: 'Kobuleti' },
];

// --- Import flow context ---

export interface PendingAnalysis {
  url: string;
  timestamp: number;
}

// --- Transaction case CRM (post-due-diligence: offer -> contract -> closing) ---

export type TransactionCaseStage =
  | 'DUE_DILIGENCE'
  | 'OFFER_MADE'
  | 'UNDER_CONTRACT'
  | 'CLOSING'
  | 'CLOSED'
  | 'ABANDONED';

export interface TransactionCaseChecklistItem {
  label: string;
  done: boolean;
}

export interface TransactionCase {
  id: string;
  user_id: string;
  property_id: string | null;
  research_job_id: string | null;
  title: string;
  stage: TransactionCaseStage;
  counterparty_name: string | null;
  counterparty_contact: string | null;
  offer_amount: number | null;
  offer_currency: string | null;
  target_closing_date: string | null;
  notes: string | null;
  checklist: TransactionCaseChecklistItem[];
  // Normalized property/entity identity (cadastral code, or entity name+type)
  // used to find-or-create exactly one case per property per user instead of
  // creating a duplicate on every research run — see
  // computeResearchDedupeKey() in services/transactionCases.ts.
  dedupe_key: string | null;
  current_version: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

// Database-computed, never client-supplied: see trg_transaction_case_version_snapshot.
export interface TransactionCaseVersion {
  id: string;
  case_id: string;
  version: number;
  snapshot: TransactionCase;
  created_by: string | null;
  created_at: string;
}

export interface TransactionCaseEvent {
  id: string;
  case_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

// A row of research_jobs (the Verify due-diligence pipeline), as read back
// by the client for case-history purposes only — this is deliberately NOT
// the full shape research-agent works with server-side, just the columns
// the /cases and Verify UIs need to list and reopen past reports.
// result_json is typed loosely (VerifyPage owns the real report shape) —
// omitted entirely from list queries and only fetched when opening one
// specific report, since it can be a large dossier.
export interface ResearchJobRecord {
  id: string;
  mode: string;
  query: string;
  status: string;
  stage: string;
  error: string | null;
  result_json: Record<string, unknown> | null;
  case_id: string | null;
  supersedes_job_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  // Verify History sidebar fields (20260906130000_research_jobs_verify_history.sql):
  // title/deleted_at are plain user-set columns; the rest are STORED generated
  // columns extracted from result_json so the history list can search/filter/
  // display without ever fetching the full per-row dossier.
  title: string | null;
  deleted_at: string | null;
  entity_name: string | null;
  project_name: string | null;
  address: string | null;
  developer_name: string | null;
  company_name: string | null;
  coverage_level: string | null;
  outstanding_count: number | null;
}
