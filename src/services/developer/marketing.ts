// HOMATCH FOR DEVELOPERS — paid-traffic attribution.
//
// THE SHAPE OF THIS FILE IS THE SHAPE OF WHAT IS POSSIBLE TODAY.
//
// There is no token field, no OAuth dance and no spend call, because pulling
// campaign data from Meta or Google needs a credential issued to a reviewed
// application and this deployment has none. Inventing a field to paste one
// into would be worse than not having it: an access token belongs in the
// platform's secret store, referenced by name, never in a table a customer's
// browser reads. `credential_ref` is that name, and it is written by an
// operator, not from here.
//
// What IS here is the half that pays for itself without anybody's permission:
// the mapping from a campaign identifier to the source string the CRM reports
// on. A lead arriving with utm_source=meta_towerA becomes a lead whose source
// reads "Meta — Tower A" in the pipeline and in sales-by-source, with nobody
// tagging anything by hand.

import { supabase, run, runList } from './client';
import type { DevAdConnection } from './types';

export async function listAdConnections(workspaceId: string): Promise<DevAdConnection[]> {
  return runList<DevAdConnection>(
    'listAdConnections',
    supabase.from('dev_ad_connections').select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true }),
    workspaceId,
  );
}

export interface CreateAdConnectionInput {
  provider: DevAdConnection['provider'];
  accountLabel?: string | null;
  externalAccountId?: string | null;
}

export async function createAdConnection(
  workspaceId: string, input: CreateAdConnectionInput,
): Promise<DevAdConnection> {
  return run<DevAdConnection>(
    'createAdConnection',
    supabase.from('dev_ad_connections').insert({
      workspace_id: workspaceId,
      provider: input.provider,
      account_label: input.accountLabel ?? null,
      external_account_id: input.externalAccountId ?? null,
      // The honest starting state. It becomes CONNECTED only when an operator
      // has provisioned a credential and something has actually used it.
      status: 'PENDING_CREDENTIALS',
      status_detail: 'Awaiting platform credentials.',
    }).select().single(),
    workspaceId,
  );
}

export async function setLeadSourceMap(
  connectionId: string, map: Record<string, string>,
): Promise<DevAdConnection> {
  return run<DevAdConnection>(
    'setLeadSourceMap',
    supabase.from('dev_ad_connections')
      .update({ source_map: map }).eq('id', connectionId).select().single(),
    connectionId,
  );
}

export async function deleteAdConnection(connectionId: string): Promise<void> {
  await runList(
    'deleteAdConnection',
    supabase.from('dev_ad_connections').delete().eq('id', connectionId).select('id'),
    connectionId,
  );
}

/**
 * The source string a lead from this campaign should carry.
 *
 * Checked against every connection's map, so a workspace running Meta and
 * Google at once does not need to know which one a click came from — the
 * campaign identifier is unique enough on its own. Returns null when nothing
 * matches, and a null source is recorded as UNRECORDED rather than guessed.
 */
export function resolveLeadSource(
  connections: DevAdConnection[], campaignId: string | null | undefined,
): string | null {
  if (!campaignId) return null;
  const key = campaignId.trim();
  if (!key) return null;
  for (const connection of connections) {
    const mapped = connection.source_map?.[key];
    if (mapped) return mapped;
  }
  return null;
}
