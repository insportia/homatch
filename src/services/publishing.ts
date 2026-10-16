// The Publishing workspace's one door to the server: the publishing-engine edge
// function. Every call is authenticated with the signed-in session; ownership,
// validation and every status transition are decided server-side.

import { supabase } from '@/db/supabase';
import type { EventRow, ListingDraft, ListingRow, PortalId, PortalInfo, PublicationRow, Validation } from '@/publishing/model';

export interface Workspace { portals: PortalInfo[]; listings: ListingRow[]; publications: PublicationRow[] }
export interface ListingDetail { portals?: PortalInfo[]; listing: ListingRow; publications: PublicationRow[]; events: EventRow[] }

export class PublishingError extends Error {
  constructor(public code: string, public validation?: Validation, public retryAt?: string) { super(code); }
}

async function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('publishing-engine', { body: { action, ...params } });
  if (error) {
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    const body = context && typeof context.json === 'function' ? await context.json().catch(() => null) as Record<string, any> | null : null;
    throw new PublishingError(String(body?.code || 'NETWORK_ERROR'), body?.validation, body?.retryAt);
  }
  if (data && typeof data === 'object' && 'code' in data) throw new PublishingError(String((data as any).code));
  return data as T;
}

export const loadWorkspace = () => call<Workspace>('workspace');

/** null when this property has no listing yet. */
export async function loadListing(propertyId: string): Promise<ListingDetail | null> {
  try {
    return await call<ListingDetail>('listing.get', { propertyId });
  } catch (e) {
    if (e instanceof PublishingError && e.code === 'LISTING_NOT_FOUND') return null;
    throw e;
  }
}

export const saveListing = (propertyId: string, version: number, listing: ListingDraft) =>
  call<ListingDetail>('listing.save', { propertyId, version, listing });

export const archiveListing = (propertyId: string) => call<ListingDetail>('listing.archive', { propertyId });
export const restoreListing = (propertyId: string) => call<ListingDetail>('listing.restore', { propertyId });
export const deleteListing = (propertyId: string) => call<{ deleted: true }>('listing.delete', { propertyId });

export const preparePublication = (propertyId: string, portalId: PortalId) => call<ListingDetail>('publication.prepare', { propertyId, portalId });
/** `attest`: the owner's explicit statement that the listing is live — required, and only accepted, on portals HOMATCH may not check. */
export const linkPublication = (propertyId: string, portalId: PortalId, externalUrl: string, attest = false) =>
  call<ListingDetail>('publication.link', { propertyId, portalId, externalUrl, ...(attest ? { attest: true } : {}) });
export const checkPublication = (propertyId: string, portalId: PortalId) => call<ListingDetail>('publication.check', { propertyId, portalId });
export const retryPublication = (propertyId: string, portalId: PortalId) => call<ListingDetail>('publication.retry', { propertyId, portalId });
export const unpublishPublication = (propertyId: string, portalId: PortalId) => call<ListingDetail>('publication.unpublish', { propertyId, portalId });
export const confirmRemoved = (propertyId: string, portalId: PortalId) => call<ListingDetail>('publication.confirmRemoved', { propertyId, portalId });
export const markPortalUpdated = (propertyId: string, portalId: PortalId) => call<ListingDetail>('publication.markUpdated', { propertyId, portalId });

/** A copy of this listing for another of the owner's properties (text only; photos stay with their property). */
export const duplicateListing = (propertyId: string, targetPropertyId: string) =>
  call<ListingDetail>('listing.duplicate', { propertyId, targetPropertyId });

/* ── Admin → Integrations → Property portals ──────────────────────────────
 * Every call is re-authorised server-side with is_admin() on the caller's own token. */

export interface AdminProvider extends PortalInfo {
  sort: number;
  evidence: string[];
  health: { status: string | null; checkedAt: string | null; detail: string | null };
  stats: Partial<Record<PublicationRow['status'], number>>;
  configured: boolean;
}
export interface AdminAuditRow { id: number; provider_id: PortalId; action: 'UPDATE' | 'RECHECK'; before: Record<string, unknown>; after: Record<string, unknown>; created_at: string }
export interface AdminOverview { providers: AdminProvider[]; audit: AdminAuditRow[]; fieldKeys: string[] }
export type AdminPublication = Pick<PublicationRow, 'id' | 'listing_id' | 'status' | 'external_url' | 'check_attempts' | 'last_checked_at' | 'next_check_at' | 'published_at' | 'last_error' | 'updated_at'>;
export interface ProviderPatch {
  enabled?: boolean; createUrl?: string | null; logoUrl?: string | null; maxPhotos?: number | null;
  descriptionMax?: number | null; requiredFields?: string[]; verification?: 'PAGE_CHECK' | 'OWNER_CONFIRMED'; sort?: number;
}

export const adminProviders = () => call<AdminOverview>('admin.providers');
export const adminPublications = (portalId: PortalId) => call<{ publications: AdminPublication[] }>('admin.publications', { portalId });
export const adminUpdateProvider = (providerId: PortalId, patch: ProviderPatch) => call<{ ok: true }>('admin.provider.update', { providerId, patch });
export const adminRecheckProvider = (providerId: PortalId) => call<{ health: { status: string; detail: string } }>('admin.provider.recheck', { providerId });
export const adminRetryPublication = (publicationId: string) => call<{ ok: true }>('admin.publication.retry', { publicationId });

/** Ask a portal's adapter to run an API operation. Today every adapter answers with the capability it lacks. */
export async function providerOperation(portalId: PortalId, operation: 'connectAccount' | 'testConnection' | 'createListing' | 'updateListing' | 'deleteListing' | 'importListing'): Promise<string> {
  try { await call('provider.operation', { portalId, operation }); return 'OK'; } catch (e) { return e instanceof PublishingError ? e.code : 'NETWORK_ERROR'; }
}
