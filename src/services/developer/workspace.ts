// HOMATCH FOR DEVELOPERS — the workspace, its team, and what needs attention.

import { run, runList, rpc, supabase } from './client';
import type { DevWorkspace, DevMember, DevRole, WorkspaceOverview } from './types';

export interface DevAuditRow {
  id: string;
  workspace_id: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  created_at: string;
}

export interface MembershipSummary {
  workspace: DevWorkspace;
  role: DevRole;
}

/**
 * Every workspace this account belongs to, with the role it holds in each.
 *
 * Two queries rather than a join, because dev_members and dev_workspaces have
 * different policies and PostgREST would apply the embed under the parent's.
 *
 * `userId` IS NOT OPTIONAL, AND THAT IS THE WHOLE POINT.
 *
 * dev_members' read policy lets a member see the WHOLE TEAM — which is
 * correct, and is what the team screen is built on. So a query that asks for
 * "the membership rows I can see" comes back with one row per colleague, and
 * building a workspace→role map from it keeps whichever row happened to be
 * last. The first end-to-end run showed the workspace OWNER labelled
 * "Finance" in the sidebar, and the quick actions an owner should have were
 * hidden, because a finance controller's row sorted after theirs.
 *
 * The server was never fooled — dev_can() asks auth_user_id() — so this was
 * an interface that misrepresented the person's own role rather than a
 * privilege hole. It still made the product wrong on first sight.
 */
export async function listMyWorkspaces(userId: string): Promise<MembershipSummary[]> {
  const memberships = await runList<{ workspace_id: string; role: DevRole }>(
    'listMyWorkspaces.members',
    supabase.from('dev_members')
      .select('workspace_id, role')
      .eq('user_id', userId)
      .eq('status', 'ACTIVE'),
  );
  if (memberships.length === 0) return [];

  const workspaces = await runList<DevWorkspace>(
    'listMyWorkspaces.workspaces',
    supabase
      .from('dev_workspaces')
      .select('*')
      .in('id', memberships.map((m) => m.workspace_id))
      .order('created_at', { ascending: true }),
  );

  const roleByWorkspace = new Map(memberships.map((m) => [m.workspace_id, m.role]));
  return workspaces
    .map((workspace) => ({ workspace, role: roleByWorkspace.get(workspace.id) as DevRole }))
    .filter((m) => Boolean(m.role));
}

export async function createWorkspace(input: {
  name: string; country?: string | null; city?: string | null; currency?: string;
}): Promise<string> {
  return rpc<string>('dev_create_workspace', {
    p_name: input.name,
    p_country: input.country ?? null,
    p_city: input.city ?? null,
    p_currency: input.currency ?? 'USD',
  });
}

export async function updateWorkspace(
  id: string,
  patch: Partial<Pick<DevWorkspace,
    'name' | 'legal_name' | 'country' | 'city' | 'website' | 'brand_logo_url' |
    'brand_color' | 'default_currency' | 'feature_flags'>>,
): Promise<DevWorkspace> {
  return run<DevWorkspace>(
    'updateWorkspace',
    supabase.from('dev_workspaces').update(patch).eq('id', id).select().single(),
    id,
  );
}

/**
 * Pending invitations are claimed here, not at sign-up. A person may be
 * invited after they already have an account, and a claim that only ran once
 * would never find them.
 */
export async function claimPendingInvites(): Promise<number> {
  return rpc<number>('dev_claim_invites', {});
}

export async function listTeam(workspaceId: string): Promise<DevMember[]> {
  return runList<DevMember>(
    'listTeam',
    supabase.from('dev_team').select('*').eq('workspace_id', workspaceId).order('created_at'),
    workspaceId,
  );
}

export interface InviteResult {
  status: 'ADDED' | 'INVITED';
  user_id?: string;
  email?: string;
  role: DevRole;
}

export async function inviteMember(
  workspaceId: string, email: string, role: DevRole, title?: string | null,
): Promise<InviteResult> {
  return rpc<InviteResult>('dev_invite_member', {
    p_workspace: workspaceId, p_email: email, p_role: role, p_title: title ?? null,
  }, workspaceId);
}

export async function setMemberRole(
  workspaceId: string, userId: string, role: DevRole,
): Promise<void> {
  await rpc<void>('dev_set_member_role', {
    p_workspace: workspaceId, p_user_id: userId, p_role: role,
  }, workspaceId);
}

export async function removeMember(workspaceId: string, userId: string): Promise<void> {
  await rpc<void>('dev_remove_member', { p_workspace: workspaceId, p_user_id: userId }, workspaceId);
}

export interface PendingInvite {
  id: string; workspace_id: string; email: string; role: DevRole;
  status: string; created_at: string;
}

export async function listPendingInvites(workspaceId: string): Promise<PendingInvite[]> {
  return runList<PendingInvite>(
    'listPendingInvites',
    supabase.from('dev_member_invites').select('*')
      .eq('workspace_id', workspaceId).eq('status', 'PENDING').order('created_at'),
    workspaceId,
  );
}

/** Everything the Home screen shows, in one round trip. Counts obey the caller's role. */
export async function getOverview(workspaceId: string): Promise<WorkspaceOverview> {
  return rpc<WorkspaceOverview>('dev_workspace_overview', { p_workspace: workspaceId }, workspaceId);
}

/**
 * Sweep reservations whose hold has run out. Flags them; releases the unit
 * only if the workspace turned that on (§135). Safe to call on every load of
 * the Home screen — it is a no-op when nothing has expired.
 */
export async function expireReservations(workspaceId: string): Promise<number> {
  return rpc<number>('dev_expire_reservations', { p_workspace: workspaceId }, workspaceId);
}

export async function listAudit(workspaceId: string, limit = 100): Promise<DevAuditRow[]> {
  return runList<DevAuditRow>(
    'listAudit',
    supabase.from('dev_audit_log').select('*')
      .eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(limit),
    workspaceId,
  );
}

/**
 * Is this account Homatch studio staff?
 *
 * Asked of the server rather than inferred from anything on the client,
 * because it gates the technical half of the product. A false answer here
 * only hides controls; dev_is_studio() in every policy is what enforces it.
 */
export async function isStudioStaff(): Promise<boolean> {
  const { data, error } = await supabase.rpc('dev_is_studio');
  if (error) {
    // Fail CLOSED. An unreadable answer must never be read as "yes".
    return false;
  }
  return data === true;
}
