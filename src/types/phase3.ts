// Homatch Phase 3 type extensions
export type MessageStatus = 'SENT' | 'DELIVERED' | 'SEEN' | 'FAILED';
export type ConversationStatus = 'ACTIVE' | 'BLOCKED' | 'MUTED' | 'ARCHIVED';
export type ViewingRequestStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'RESCHEDULE_PROPOSED' | 'CANCELLED' | 'COMPLETED';
export type LeadType = 'BUYER_INTENT' | 'RENTER_INTENT' | 'INVESTOR_INTENT' | 'POSSIBLE_BUYER' | 'POSSIBLE_RENTER';
export type TrustConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
export type ActiveSearchSide = 'DEMAND' | 'SUPPLY';

export interface Conversation {
  id: string;
  property_id?: string;
  match_id?: string;
  initiator_id: string;
  recipient_id: string;
  status: ConversationStatus;
  initiator_muted: boolean;
  recipient_muted: boolean;
  first_contact_email_sent: boolean;
  last_message_at?: string;
  created_at: string;
  updated_at: string;
  // joined
  other_user?: ConversationParticipant;
  unread_count?: number;
  last_message?: Message;
}

export interface ConversationParticipant {
  id: string;
  full_name?: string;
  avatar_url?: string;
  email: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  status: MessageStatus;
  delivered_at?: string;
  seen_at?: string;
  created_at: string;
}

export interface ContactShare {
  id: string;
  conversation_id: string;
  sharer_id: string;
  phone?: string;
  whatsapp?: string;
  telegram?: string;
  created_at: string;
}

export interface ViewingRequest {
  id: string;
  property_id: string;
  requester_id: string;
  owner_id: string;
  conversation_id?: string;
  status: ViewingRequestStatus;
  preferred_date: string;
  preferred_time?: string;
  note?: string;
  proposed_date?: string;
  proposed_time?: string;
  propose_note?: string;
  completed_by?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  // joined
  property?: { title: string; city?: string; cover_photo_url?: string };
  requester?: ConversationParticipant;
}

export interface ExternalContactUnlock {
  id: string;
  user_id: string;
  match_id: string;
  signal_id?: string;
  lead_type: LeadType;
  lead_label: string;
  match_score?: number;
  location_label?: string;
  transaction?: string;
  budget_min?: number;
  budget_max?: number;
  budget_currency?: string;
  requirements?: string;
  source?: string;
  confidence?: number;
  freshness_days?: number;
  credits_charged: number;
  actual_cost: number;
  unlocked_at?: string;
  created_at: string;
}

export interface ExternalUnlockPreview {
  match_score: number;
  lead_type: LeadType;
  lead_label: string;
  is_confirmed: boolean;
  location: string;
  transaction: string;
  budget_min?: number;
  budget_max?: number;
  budget_currency?: string;
  requirements?: string;
  source: string;
  confidence: number;
  freshness_days?: number;
  customer_price: number;
  currency: string;
  already_unlocked: boolean;
}

export interface PropertyTrustScore {
  id: string;
  property_id: string;
  score: number;
  confidence: TrustConfidence;
  risk_indicators: string[];
  price_conflict: boolean;
  area_conflict: boolean;
  location_conflict: boolean;
  duplicate_images: boolean;
  data_stale: boolean;
  cadastral_mismatch: boolean;
  source_confidence?: number;
  last_checked_at: string;
}

export interface CanonicalPropertyGroup {
  id: string;
  canonical_property_id?: string;
  source_count: number;
  min_price?: number;
  max_price?: number;
  price_currency?: string;
  price_diff?: number;
  last_deduped_at?: string;
  sources?: CanonicalPropertySource[];
}

export interface CanonicalPropertySource {
  id: string;
  group_id: string;
  property_id?: string;
  source_url?: string;
  source_name?: string;
  price?: number;
  price_currency?: string;
  is_canonical: boolean;
}

export interface DeveloperProfile {
  id: string;
  name: string;
  slug?: string;
  country?: string;
  city?: string;
  website?: string;
  description?: string;
  score: number;
  score_breakdown: Record<string, unknown>;
  completed_projects: number;
  active_projects: number;
  years_active?: number;
  permits?: unknown;
  restrictions?: unknown;
  public_risk_evidence: unknown[];
  is_sponsored: boolean;
  projects?: DeveloperProject[];
  last_checked_at: string;
}

export interface DeveloperProject {
  id: string;
  developer_id: string;
  name: string;
  city?: string;
  status: string;
  units?: number;
  floors?: number;
  completion_year?: number;
  commissioned: boolean;
  notes?: string;
}

export interface PAYGOperation {
  id: string;
  provider: string;
  operation: string;
  actual_cost: number;
  markup_multiplier: number;
  customer_price: number;
  currency: string;
  is_active: boolean;
}

export interface ActiveSearchSubscription {
  id: string;
  user_id: string;
  intent_id?: string;
  search_criteria?: Record<string, unknown>;
  property_id?: string;
  side: ActiveSearchSide;
  is_active: boolean;
  last_notified_at?: string;
  notify_in_app: boolean;
  notify_push: boolean;
  created_at: string;
}
