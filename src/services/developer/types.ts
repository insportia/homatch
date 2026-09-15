// HOMATCH FOR DEVELOPERS — the shapes.
//
// These mirror the dev_* tables one for one. They are deliberately not
// "nice" view models: a view model that quietly renames sale_price to price
// is a view model that will one day be written back to the wrong column.
// Presentation shaping happens in components, close to where it is read.

export type DevRole =
  | 'OWNER'
  | 'ADMIN'
  | 'SALES_DIRECTOR'
  | 'SALES_MANAGER'
  | 'SALES_AGENT'
  | 'MARKETING_MANAGER'
  | 'FINANCE'
  | 'LEGAL'
  | 'VIEWER';

/**
 * The capability vocabulary. This list exists in two places on purpose — here
 * and in public.dev_can() — and the SQL one is the authority. This copy is
 * only so the UI can decide what to render; a mistake here hides a button,
 * a mistake there lets somebody sell an apartment.
 */
export type DevCapability =
  | 'view'
  | 'inventory'
  | 'crm'
  | 'crm_all'
  | 'marketing'
  | 'finance'
  | 'legal'
  | 'documents'
  | 'team'
  | 'publish'
  | 'discount'
  | 'sale';

export const ROLE_CAPABILITIES: Record<DevRole, DevCapability[] | 'ALL'> = {
  OWNER: 'ALL',
  ADMIN: 'ALL',
  SALES_DIRECTOR: ['view', 'inventory', 'crm', 'crm_all', 'marketing', 'documents', 'publish', 'discount', 'sale'],
  SALES_MANAGER: ['view', 'crm', 'crm_all', 'documents', 'sale'],
  SALES_AGENT: ['view', 'crm', 'documents'],
  MARKETING_MANAGER: ['view', 'marketing', 'documents'],
  FINANCE: ['view', 'finance', 'documents'],
  LEGAL: ['view', 'legal', 'documents'],
  VIEWER: ['view'],
};

export function roleCan(role: DevRole | null, capability: DevCapability): boolean {
  if (!role) return false;
  const caps = ROLE_CAPABILITIES[role];
  if (caps === 'ALL') return true;
  return caps.includes(capability);
}

export interface DevWorkspace {
  id: string;
  owner_id: string;
  name: string;
  slug: string | null;
  legal_name: string | null;
  country: string | null;
  city: string | null;
  website: string | null;
  developer_profile_id: string | null;
  brand_logo_url: string | null;
  brand_color: string | null;
  default_currency: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  feature_flags: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DevMember {
  member_id: string;
  workspace_id: string;
  user_id: string;
  role: DevRole;
  title: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  created_at: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

export type ConstructionStatus =
  | 'PLANNED'
  | 'UNDER_CONSTRUCTION'
  | 'FINISHING'
  | 'COMPLETED'
  | 'HANDED_OVER';

export interface DevProject {
  id: string;
  workspace_id: string;
  name: string;
  slug: string | null;
  registry_project_id: string | null;
  country: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  project_type: string | null;
  construction_status: ConstructionStatus;
  handover_date: string | null;
  currency: string;
  amenities: string[];
  legal_info: Record<string, unknown>;
  cover_image_url: string | null;
  master_plan_url: string | null;
  brochure_url: string | null;
  is_published: boolean;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DevBuilding {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  code: string | null;
  floors_count: number | null;
  facade_image_url: string | null;
  sort_order: number;
}

export type UnitStatus =
  | 'AVAILABLE'
  | 'ON_HOLD'
  | 'RESERVED'
  | 'NEGOTIATION'
  | 'CONTRACT_PENDING'
  | 'SOLD'
  | 'HIDDEN';

/**
 * The three statuses the database will not let a client write directly. They
 * are listed here so the UI never offers them in a dropdown and then has to
 * explain a server error the person could not have avoided.
 */
export const WORKFLOW_ONLY_STATUSES: UnitStatus[] = ['RESERVED', 'CONTRACT_PENDING', 'SOLD'];

export interface DevUnit {
  id: string;
  workspace_id: string;
  project_id: string;
  building_id: string | null;
  floor_id: string | null;
  unit_number: string;
  floor_level: number | null;
  status: UnitStatus;
  unit_type: string | null;
  bedrooms: number | null;
  rooms: number | null;
  area_total: number | null;
  area_internal: number | null;
  area_balcony: number | null;
  area_terrace: number | null;
  orientation: string | null;
  view_text: string | null;
  ceiling_height: number | null;
  condition: string | null;
  parking: number;
  storage: number;
  floor_plan_url: string | null;
  photos: string[];
  video_url: string | null;
  price: number | null;
  currency: string;
  price_per_sqm: number | null;
  payment_plan_id: string | null;
  notes: string | null;
  hotspot: HotspotPolygon | null;
  is_published: boolean;
  published_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** Percentages of the facade image, so a re-render at another size still fits. */
export type HotspotPolygon = Array<{ x: number; y: number }>;

export type LeadStage =
  | 'NEW'
  | 'QUALIFIED'
  | 'CONTACTED'
  | 'INTERESTED'
  | 'VIEWING_SCHEDULED'
  | 'VIEWING_COMPLETED'
  | 'NEGOTIATION'
  | 'RESERVATION'
  | 'CONTRACT'
  | 'PAYMENT_PENDING'
  | 'SOLD'
  | 'LOST';

/** Set by the reservation and deal workflow; dev_set_lead_stage refuses them. */
export const WORKFLOW_ONLY_STAGES: LeadStage[] = ['RESERVATION', 'CONTRACT', 'SOLD'];

export const PIPELINE_STAGES: LeadStage[] = [
  'NEW',
  'QUALIFIED',
  'CONTACTED',
  'INTERESTED',
  'VIEWING_SCHEDULED',
  'VIEWING_COMPLETED',
  'NEGOTIATION',
  'RESERVATION',
  'CONTRACT',
  'PAYMENT_PENDING',
  'SOLD',
  'LOST',
];

export type LostReason =
  | 'PRICE'
  | 'LOCATION'
  | 'FINANCING'
  | 'TIMING'
  | 'COMPETITOR'
  | 'UNIT_UNAVAILABLE'
  | 'NO_RESPONSE'
  | 'OTHER';

/**
 * A disposition is the outcome of the last CONVERSATION. It is not the stage.
 * Keeping them apart is why a pipeline column is never called "no answer".
 */
export const DISPOSITIONS = [
  'NO_ANSWER',
  'CALL_BACK',
  'NOT_INTERESTED',
  'INTERESTED',
  'NEEDS_FINANCING',
  'REQUESTED_PAYMENT_PLAN',
  'REQUESTED_FLOOR_PLAN',
  'REQUESTED_VIEWING',
  'VIEWING_BOOKED',
  'NEGOTIATING',
  'RESERVATION_READY',
  'LOST_PRICE',
  'LOST_LOCATION',
  'LOST_TIMING',
  'OTHER',
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export interface DevLead {
  id: string;
  workspace_id: string;
  contact_id: string;
  project_id: string | null;
  stage: LeadStage;
  disposition: string | null;
  assigned_to: string | null;
  source: string | null;
  campaign_id: string | null;
  budget_min: number | null;
  budget_max: number | null;
  currency: string | null;
  preferences: Record<string, unknown>;
  score: number | null;
  score_factors: Array<{ factor: string; weight?: number }>;
  lost_reason: LostReason | null;
  lost_note: string | null;
  next_follow_up_at: string | null;
  last_activity_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Buyer identity, read through the dev_lead_contacts view. Consent travels with it. */
export interface DevLeadContact {
  lead_id: string;
  workspace_id: string;
  contact_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  language: string | null;
  country: string | null;
  city: string | null;
  company: string | null;
  consent_status: string | null;
  do_not_contact: boolean | null;
  do_not_call: boolean | null;
  unsubscribed: boolean | null;
  whatsapp_opted_out: boolean;
  suppressed: boolean | null;
  last_contacted_at: string | null;
}

export type ActivityKind =
  | 'NOTE' | 'CALL' | 'WHATSAPP' | 'EMAIL' | 'SMS' | 'MEETING' | 'VIEWING'
  | 'OFFER' | 'RESERVATION' | 'DOCUMENT' | 'PAYMENT' | 'STAGE_CHANGE'
  | 'ASSIGNMENT' | 'SHARE' | 'TASK' | 'SYSTEM';

export type ActivityProvenance =
  | 'MANUAL' | 'HOMATCH' | 'AI_CALL' | 'WHATSAPP' | 'EMAIL' | 'META' | 'GOOGLE'
  | 'IMPORT' | 'WEBSITE' | 'BROKER' | 'DOCUMENT' | 'PAYMENT' | 'SHARE_LINK';

export interface DevActivity {
  id: string;
  workspace_id: string;
  lead_id: string | null;
  contact_id: string | null;
  unit_id: string | null;
  deal_id: string | null;
  kind: ActivityKind;
  provenance: ActivityProvenance;
  direction: 'IN' | 'OUT' | null;
  title: string;
  body: string | null;
  meta: Record<string, unknown>;
  actor_id: string | null;
  occurred_at: string;
  created_at: string;
}

export interface DevTask {
  id: string;
  workspace_id: string;
  lead_id: string | null;
  unit_id: string | null;
  deal_id: string | null;
  title: string;
  body: string | null;
  assigned_to: string | null;
  due_at: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH';
  status: 'OPEN' | 'DONE' | 'CANCELLED';
  completed_at: string | null;
  created_at: string;
}

export interface DevViewing {
  id: string;
  workspace_id: string;
  lead_id: string;
  project_id: string | null;
  unit_id: string | null;
  assigned_to: string | null;
  scheduled_at: string;
  duration_min: number;
  mode: 'PHYSICAL' | 'VIRTUAL';
  status: 'SCHEDULED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  disposition: string | null;
  notes: string | null;
  created_at: string;
}

export interface PaymentMilestone {
  label: string;
  percent?: string | number;
  amount?: string | number;
  due_offset_days?: string | number;
  due_date?: string;
}

export interface DevPaymentPlan {
  id: string;
  workspace_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  milestones: PaymentMilestone[];
  is_default: boolean;
  created_at: string;
}

export interface DevOffer {
  id: string;
  workspace_id: string;
  lead_id: string;
  unit_id: string;
  base_price: number;
  discount_pct: number;
  discount_amount: number;
  final_price: number;
  currency: string;
  deposit_amount: number | null;
  payment_plan_id: string | null;
  schedule: Array<{ label: string; due_date: string | null; amount: number }>;
  valid_until: string | null;
  status: 'DRAFT' | 'SENT' | 'VIEWED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'SUPERSEDED';
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface DevReservation {
  id: string;
  workspace_id: string;
  unit_id: string;
  lead_id: string;
  offer_id: string | null;
  amount: number | null;
  currency: string;
  reserved_at: string;
  expires_at: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'CONVERTED';
  assigned_to: string | null;
  broker_id: string | null;
  source: string | null;
  notes: string | null;
  cancelled_reason: string | null;
  created_at: string;
}

export interface DevDeal {
  id: string;
  workspace_id: string;
  unit_id: string;
  lead_id: string;
  project_id: string | null;
  reservation_id: string | null;
  offer_id: string | null;
  assigned_to: string | null;
  broker_id: string | null;
  source: string | null;
  contract_number: string | null;
  contract_date: string | null;
  sale_date: string | null;
  list_price: number | null;
  discount_amount: number;
  sale_price: number;
  currency: string;
  payment_plan_id: string | null;
  status: 'CONTRACT_PENDING' | 'CONTRACTED' | 'COMPLETED' | 'CANCELLED';
  notes: string | null;
  created_at: string;
}

export interface DevScheduleRow {
  id: string;
  workspace_id: string;
  deal_id: string;
  seq: number;
  label: string;
  due_date: string | null;
  amount: number;
  currency: string;
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE';
  paid_amount: number;
}

export interface DevPayment {
  id: string;
  workspace_id: string;
  deal_id: string;
  schedule_id: string | null;
  amount: number;
  currency: string;
  paid_at: string;
  method: string | null;
  reference: string | null;
  document_id: string | null;
  /** RECORDED is a claim. CONFIRMED is finance saying they saw the money. */
  status: 'RECORDED' | 'CONFIRMED' | 'REJECTED';
  confirmed_by: string | null;
  confirmed_at: string | null;
  rejected_reason: string | null;
  notes: string | null;
  created_at: string;
}

export type DocumentType =
  | 'CONTRACT' | 'RESERVATION_AGREEMENT' | 'INVOICE' | 'PAYMENT_RECEIPT'
  | 'BANK_CONFIRMATION' | 'PAYMENT_SCHEDULE' | 'IDENTITY_DOCUMENT'
  | 'BROCHURE' | 'FLOOR_PLAN' | 'PROJECT_DOCUMENT' | 'LEGAL_DOCUMENT' | 'OTHER';

/**
 * What a reader thought a document said. It is never applied to a deal or a
 * payment on its own — a person confirms it first, which is the whole of §38.
 */
export interface DocumentExtraction {
  fields?: Record<string, { value: string | number | null; confidence?: number; evidence?: string }>;
  suggested_deal_id?: string | null;
  suggested_unit_number?: string | null;
  suggested_amount?: number | null;
  suggested_paid_at?: string | null;
  suggested_reference?: string | null;
  notes?: string;
}

export interface DevDocument {
  id: string;
  workspace_id: string;
  doc_type: DocumentType;
  title: string;
  storage_path: string;
  mime: string | null;
  size_bytes: number | null;
  project_id: string | null;
  unit_id: string | null;
  deal_id: string | null;
  lead_id: string | null;
  reservation_id: string | null;
  visibility: 'PRIVATE' | 'BUYER' | 'PUBLIC';
  status: 'UPLOADED' | 'ANALYZING' | 'EXTRACTED' | 'CONFIRMED' | 'REJECTED' | 'FAILED';
  extraction: DocumentExtraction | null;
  extraction_confidence: number | null;
  extraction_error: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface PanoramaScene {
  id: string;
  name: string;
  image_url: string;
  hotspots?: Array<{ to: string; x: number; y: number; label?: string }>;
}

export interface DevWalkthrough {
  id: string;
  workspace_id: string;
  unit_id: string | null;
  project_id: string | null;
  title: string | null;
  provider: 'EMBED' | 'PANORAMA' | 'VIDEO' | 'NATIVE';
  embed_url: string | null;
  scenes: PanoramaScene[];
  cover_image_url: string | null;
  visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE' | 'BUYER_ONLY';
  status: 'DRAFT' | 'READY' | 'PUBLISHED';
  created_at: string;
  updated_at: string;
}

export interface DevShareLink {
  id: string;
  workspace_id: string;
  token: string;
  target_type: 'UNIT' | 'PROJECT' | 'OFFER' | 'BUYER_ROOM';
  target_id: string;
  visibility: 'PUBLIC' | 'UNLISTED';
  label: string | null;
  lead_id: string | null;
  contact_id: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
}

export type ShareEvent =
  | 'OPENED' | 'UNIT_VIEWED' | 'WALKTHROUGH_OPENED' | 'FLOORPLAN_VIEWED'
  | 'PAYMENT_PLAN_VIEWED' | 'BROCHURE_OPENED' | 'PHOTOS_VIEWED'
  | 'CTA_CLICKED' | 'VIEWING_REQUESTED' | 'CONTACT_CLICKED';

export interface DevShareEventRow {
  id: string;
  workspace_id: string;
  share_link_id: string;
  event: ShareEvent;
  meta: Record<string, unknown>;
  created_at: string;
}

/** A row of the derived sales file. Columns match public.dev_sales_ledger. */
export interface SalesLedgerRow {
  deal_id: string;
  workspace_id: string;
  project: string | null;
  building: string | null;
  unit_number: string;
  floor_level: number | null;
  area_total: number | null;
  unit_type: string | null;
  bedrooms: number | null;
  buyer: string | null;
  buyer_phone: string | null;
  buyer_email: string | null;
  sales_manager: string | null;
  lead_source: string | null;
  broker: string | null;
  reserved_at: string | null;
  contract_number: string | null;
  contract_date: string | null;
  sale_date: string | null;
  list_price: number | null;
  discount_amount: number | null;
  sale_price: number;
  currency: string;
  sale_price_per_sqm: number | null;
  paid: number;
  outstanding: number;
  next_payment_due: string | null;
  next_payment_amount: number | null;
  payment_status: 'PAID' | 'OVERDUE' | 'PARTIAL' | 'PENDING';
  deal_status: string;
  unit_status: UnitStatus;
  notes: string | null;
  unit_id: string;
  lead_id: string;
  project_id: string | null;
}

/** Everything the Home screen needs, in one round trip. */
export interface WorkspaceOverview {
  units: {
    total: number; available: number; reserved: number; negotiation: number;
    contract_pending: number; sold: number; value_available: number;
  };
  leads: {
    total: number; new: number; active: number; negotiation: number;
    overdue_follow_ups: number;
  };
  viewings: { today: number; upcoming: number };
  reservations: { active: number; expiring_soon: number; expired_unresolved: number };
  sales: { this_month: number; value_this_month: number; contracted_value: number };
  money: { collected: number; collected_this_month: number; awaiting_confirmation: number };
  schedule: { overdue_count: number; overdue_amount: number; due_30d: number };
  tasks: { open: number; overdue: number };
  documents: { needs_review: number };
}

export interface ImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; unit?: string; error: string }>;
}

/** The payload dev_share_resolve returns to an anonymous visitor. */
export interface SharedUnitPayload {
  error?: 'NOT_FOUND' | 'REVOKED' | 'EXPIRED' | 'UNSUPPORTED';
  unit?: Partial<DevUnit> & { unit_number: string };
  project?: Partial<DevProject> & { name: string };
  building?: { id: string; name: string } | null;
  developer?: {
    name: string; logo_url: string | null; brand_color: string | null; website: string | null;
  };
  walkthrough?: {
    id: string; provider: DevWalkthrough['provider']; embed_url: string | null;
    scenes: PanoramaScene[]; cover_image_url: string | null; title: string | null;
  } | null;
  payment_plan?: { name: string; milestones: PaymentMilestone[] } | null;
  units?: Array<Partial<DevUnit> & { id: string; unit_number: string }>;
  share?: { target_type: string; label: string | null };
}
