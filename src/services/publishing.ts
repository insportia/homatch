// The Publishing workspace's one door to the server: the publishing-engine edge
// function. Every call is authenticated with the signed-in session; ownership,
// validation and every status transition are decided server-side.

import { supabase } from '@/db/supabase';
import type { EventRow, ListingDraft, ListingRow, PortalId, PortalInfo, PublicationRow, Validation } from '@/publishing/model';

export interface Workspace { portals: PortalInfo[]; listings: ListingRow[]; publications: PublicationRow[] }
export interface ListingDetail { listing: ListingRow; publications: PublicationRow[]; events: EventRow[] }

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
export const linkPublication = (propertyId: string, portalId: PortalId, externalUrl: string) => call<ListingDetail>('publication.link', { propertyId, portalId, externalUrl });
export const checkPublication = (propertyId: string, portalId: PortalId) => call<ListingDetail>('publication.check', { propertyId, portalId });
export const retryPublication = (propertyId: string, portalId: PortalId) => call<ListingDetail>('publication.retry', { propertyId, portalId });
export const unpublishPublication = (propertyId: string, portalId: PortalId) => call<ListingDetail>('publication.unpublish', { propertyId, portalId });
export const confirmRemoved = (propertyId: string, portalId: PortalId) => call<ListingDetail>('publication.confirmRemoved', { propertyId, portalId });
export const markPortalUpdated = (propertyId: string, portalId: PortalId) => call<ListingDetail>('publication.markUpdated', { propertyId, portalId });
