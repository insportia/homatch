// HOMATCH FOR DEVELOPERS — sending inventory to outside brokers.
//
// A broker is not a teammate. They do not get a workspace login, they do not
// see the pipeline, and they must not see another broker's terms — so this is
// deliberately NOT built on dev_members. An invite carries its own token, its
// own commission terms, its own expiry and its own list of units, and it is
// resolved through the share-link machinery that already exists rather than
// through a second access system.
//
// WHAT A BROKER SEES. The units named on their own invite, at the prices those
// units are published at. Not the workspace, not the leads, not the other
// brokers, not what anybody else was offered.

import { supabase, run, runList } from './client';
import type { DevBrokerInvite } from './types';

export interface BrokerInviteRow extends DevBrokerInvite {
  unit_count: number;
}

export async function listBrokerInvites(workspaceId: string): Promise<BrokerInviteRow[]> {
  const rows = await runList<DevBrokerInvite>(
    'listBrokerInvites',
    supabase.from('dev_broker_invites').select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false }),
    workspaceId,
  );
  return rows.map((r) => ({ ...r, unit_count: (r.unit_ids ?? []).length }));
}

export interface CreateBrokerInviteInput {
  projectId?: string | null;
  brokerName: string;
  brokerEmail?: string | null;
  commissionType: 'PERCENT' | 'FIXED';
  commissionValue: number;
  currency: string;
  terms?: string | null;
  unitIds: string[];
  validUntil?: string | null;
}

export async function createBrokerInvite(
  workspaceId: string, input: CreateBrokerInviteInput,
): Promise<DevBrokerInvite> {
  return run<DevBrokerInvite>(
    'createBrokerInvite',
    supabase.from('dev_broker_invites').insert({
      workspace_id: workspaceId,
      project_id: input.projectId ?? null,
      broker_name: input.brokerName,
      broker_email: input.brokerEmail ?? null,
      commission_type: input.commissionType,
      commission_value: input.commissionValue,
      currency: input.currency,
      terms: input.terms ?? null,
      // An empty list would mean "everything, forever", which is not a thing
      // anybody should be able to agree to by leaving a field blank.
      unit_ids: input.unitIds,
      valid_until: input.validUntil ?? null,
      status: 'INVITED',
    }).select().single(),
    workspaceId,
  );
}

export async function revokeBrokerInvite(inviteId: string): Promise<void> {
  await runList(
    'revokeBrokerInvite',
    supabase.from('dev_broker_invites')
      .update({ status: 'REVOKED' }).eq('id', inviteId).select('id'),
    inviteId,
  );
}

/**
 * The link a broker is actually sent.
 *
 * The same /s/ route every other share uses, so revoking it is immediate and
 * the activity it gathers is readable in the same place. No second public
 * surface, no second thing to secure.
 */
export function brokerInviteUrl(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/s/${token}`;
}
