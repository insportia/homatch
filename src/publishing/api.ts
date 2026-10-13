import { supabase } from '@/db/supabase';
export interface PublishingPortal {
  id: string;
  name: string;
  domain: string;
  registration_url: string | null;
  enabled: boolean;
  maintenance: boolean;
  permission: string;
  verification: string;
  operations: Record<string, boolean>;
  metadata: {
    paid?: boolean | null;
    connection?: string;
    connectionEnabled?: boolean;
    missingFields?: string[];
  };
}
export interface PublishingAccount {
  id: string;
  portal_id: string;
  status: string;
  last_connected_at: string | null;
  error_code: string | null;
}
export interface PublishingJob {
  id: string;
  property_id: string;
  portal_id: string;
  operation: string;
  phase: string;
  state: string;
  created_at: string;
  updated_at: string;
  submission_started: boolean;
  error_code: string | null;
}
export interface Publication {
  id: string;
  property_id: string;
  portal_id: string;
  external_id: string | null;
  external_url: string | null;
  status: string;
  last_synced_at: string | null;
  current_price: number | null;
  current_currency: string | null;
}
export interface PublishingSnapshot {
  portals: PublishingPortal[];
  accounts: PublishingAccount[];
  jobs: PublishingJob[];
  publications: Publication[];
  selections: Array<{ property_id: string; portal_ids: string[] }>;
  events: Array<{
    id: number;
    job_id: string;
    portal_id: string;
    event: string;
    created_at: string;
  }>;
  versions: Array<{ id: string; property_id: string; version: number }>;
}
export const emptySnapshot = (): PublishingSnapshot => ({
  portals: [],
  accounts: [],
  jobs: [],
  publications: [],
  selections: [],
  events: [],
  versions: [],
});
export async function publishingRequest<T = Record<string, unknown>>(
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke('publisher-center', {
    body,
    signal: AbortSignal.timeout(20000),
  });
  if (error || !data || data.code) throw new Error('PUBLISHING_UNAVAILABLE');
  return data as T;
}
export function portalEligible(
  portal: PublishingPortal,
  accounts: PublishingAccount[],
  operation = 'publish',
) {
  return (
    portal.enabled &&
    !portal.maintenance &&
    portal.permission === 'verified' &&
    portal.operations[operation] === true &&
    accounts.some(
      (account) =>
        account.portal_id === portal.id && account.status === 'connected',
    )
  );
}
export { publishingStatusKey, originalListingUrl } from './presentation';
