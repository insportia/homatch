// HOMATCH FOR DEVELOPERS — the executive read model and the work queue.
//
// dev_dashboard is SECURITY INVOKER, which is the whole point: a sales agent
// and an owner run the same SQL and see different rows, because RLS is doing
// the filtering rather than a `where assigned_to = me` somebody has to
// remember to add. Nothing here is modelled, forecast or extrapolated — every
// figure is a count or a sum of rows that exist.

import { supabase, runList, rpc } from './client';
import type { DevDashboard, DevNotification, TwinAnalytics } from './types';

export async function loadDashboard(
  workspaceId: string,
  opts: { projectId?: string | null; from?: string | null; to?: string | null } = {},
): Promise<DevDashboard> {
  return rpc<DevDashboard>('dev_dashboard', {
    p_workspace: workspaceId,
    p_project: opts.projectId ?? null,
    p_from: opts.from ?? null,
    p_to: opts.to ?? null,
  }, workspaceId);
}

export async function loadTwinAnalytics(
  workspaceId: string, projectId?: string | null, days = 30,
): Promise<TwinAnalytics> {
  return rpc<TwinAnalytics>('dt_analytics', {
    p_workspace: workspaceId, p_project: projectId ?? null, p_days: days,
  }, workspaceId);
}

// ── Notifications ──────────────────────────────────────────────────────────

/**
 * Derived from state that already exists, and deduplicated on a key, so
 * generating them twice in one morning produces one row per real situation
 * rather than an inbox of duplicates. Generation is cheap enough to run when
 * somebody opens the workspace, which is why there is no scheduler to keep
 * alive and nothing to drift.
 */
export async function generateNotifications(workspaceId: string): Promise<number> {
  return rpc<number>('dev_generate_notifications', { p_workspace: workspaceId }, workspaceId);
}

export async function listNotifications(
  workspaceId: string, opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<DevNotification[]> {
  let query = supabase
    .from('dev_notifications')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.unreadOnly) query = query.is('read_at', null);
  return runList<DevNotification>('listNotifications', query, workspaceId);
}

export async function markNotificationRead(id: string): Promise<void> {
  await runList(
    'markNotificationRead',
    supabase.from('dev_notifications')
      .update({ read_at: new Date().toISOString() }).eq('id', id).select('id'),
    id,
  );
}

export async function markAllNotificationsRead(workspaceId: string): Promise<void> {
  await runList(
    'markAllNotificationsRead',
    supabase.from('dev_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).is('read_at', null).select('id'),
    workspaceId,
  );
}

/** Where a notification takes you when you press it. */
export function notificationTarget(n: DevNotification): string {
  switch (n.entity_type) {
    case 'reservation': return '/developers/sales/reservations';
    case 'schedule': return '/developers/sales/payments';
    case 'lead': return `/developers/contacts?lead=${n.entity_id ?? ''}`;
    case 'handover': return '/developers/sales/handover';
    case 'document': return '/developers/documents';
    default: return '/developers/home';
  }
}
