export type Operation = 'publish' | 'update' | 'remove' | 'status' | 'renew' | 'deactivate';
export type Verification = 'DISCOVERED' | 'ADAPTER_IMPLEMENTED' | 'MOCK_TESTED' | 'AUTH_TESTED' | 'LIVE_CREATE_VERIFIED' | 'LIVE_EDIT_VERIFIED' | 'LIVE_DELETE_VERIFIED' | 'PRODUCTION_READY' | 'ASSISTED_ONLY' | 'BLOCKED';
export type Phase = 'preparing' | 'validating' | 'connecting' | 'uploading' | 'submitting' | 'reconciling' | 'awaiting_moderation' | 'published' | 'action_required' | 'failed';
export interface NormalizedProperty {
  id: string;
  ownerId: string;
  version: number;
  title: string;
  transaction: 'sale' | 'rent' | 'daily_rent';
  type: 'apartment' | 'house' | 'land' | 'commercial';
  location: { country: string; city: string; district?: string; address?: string; latitude?: number; longitude?: number };
  area: number;
  rooms?: number;
  bedrooms?: number;
  bathrooms?: number;
  floor?: number;
  totalFloors?: number;
  condition?: string;
  renovation?: string;
  amenities: { furniture?: boolean; parking?: boolean; balcony?: boolean; heating?: string; elevator?: boolean };
  price: { amount: number; currency: 'GEL' | 'USD' | 'EUR' };
  contact: { phone: string; name?: string };
  description: string;
  photos: Array<{ storagePath: string; sha256: string; mime: string; bytes: number; cover: boolean }>;
  portalFields: Record<string, Record<string, string | number | boolean>>;
}
export interface PortalCapabilities {
  operations: Readonly<Record<Operation, boolean>>;
  connection: 'authorized_browser' | 'official_api' | 'direct_on_portal' | 'unverified';
  otp: 'homatch' | 'portal_only' | 'none' | 'unverified';
  permission: 'verified' | 'pending' | 'restricted';
  verification: Verification;
  photoLimits: { maxCount: number; maxBytes: number; mime: string[] } | null;
  paid: boolean | null;
}
export type AdapterErrorCode = 'UNSUPPORTED_CAPABILITY' | 'PERMISSION_UNVERIFIED' | 'RECONNECT_REQUIRED' | 'CHALLENGE_REQUIRED' | 'CONFLICT' | 'AMBIGUOUS_SUBMISSION' | 'RATE_LIMITED' | 'VALIDATION_FAILED' | 'PORTAL_RESTRICTED';
export class AdapterError extends Error {
  constructor(public readonly code: AdapterErrorCode, public readonly portalId: string) {
    super(`${portalId}:${code}`);
    this.name = 'AdapterError';
  }
}
export interface ValidationIssue { field: string; code: 'required' | 'invalid' | 'unsupported' | 'unverified_limit' }
export interface ConnectionContext { userId: string; accountId: string; attemptId: string; expiresAt: string }
export interface ConnectionResult { state: 'connected' | 'action_required'; challengeId?: string }
export interface ExecutionContext {
  jobId: string;
  userId: string;
  accountId: string;
  listing: NormalizedProperty;
  externalId?: string;
  expectedExternalVersion?: string;
  signal: AbortSignal;
  event: (phase: Phase) => Promise<void>;
}
export interface PublicationResult {
  externalId: string;
  externalUrl: string;
  externalVersion?: string;
  status: 'published' | 'awaiting_moderation' | 'removed' | 'inactive';
}
export interface PortalAdapter {
  id: string;
  version: string;
  getCapabilities(): PortalCapabilities;
  getRegistrationUrl(): string | null;
  beginConnection(context: ConnectionContext): Promise<ConnectionResult>;
  resumeConnection(context: ConnectionContext): Promise<ConnectionResult>;
  validateListing(listing: NormalizedProperty): Promise<ValidationIssue[]>;
  publish(context: ExecutionContext): Promise<PublicationResult>;
  update(context: ExecutionContext): Promise<PublicationResult>;
  remove(context: ExecutionContext): Promise<PublicationResult>;
  getStatus(context: ExecutionContext): Promise<PublicationResult>;
  /** Must resolve a timed-out submission without submitting anything. Null is NOT proof of absence. */
  reconcile(context: ExecutionContext): Promise<{ state: 'found'; result: PublicationResult } | { state: 'absent_verified' } | { state: 'unknown' }>;
}
